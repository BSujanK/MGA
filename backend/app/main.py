"""MGA API. Run: uvicorn app.main:app --reload (from backend/). Docs at /docs."""
from __future__ import annotations

import os
import re
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import export, llm, parsing, service, tuner
from .engine.learning import recommend
from .jobs import sources
from .jobs.store import get_store
from .models import (
    CandidateProfile, ChatRequest, ChatResponse, ExportRequest, GapReport, GapRequest, JobPosting, JobProfile,
    MarketReport, MarketRequest, Resource, TailoredResume, TailorRequest, TextIn,
)

app = FastAPI(
    title="MGA - Market Gap Analysis API",
    version="0.1.0",
    description="Skill-by-skill gap analysis between candidates, job postings and the job market.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("MGA_CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "llm_enabled": llm.enabled(), "model": llm.MODEL if llm.enabled() else None,
            "skills": len(service.tax().skills), "jobs": len(get_store().all())}


@app.get("/skills")
def list_skills(category: Optional[str] = None) -> list[dict]:
    out = [{"id": s.id, "name": s.name, "category": s.category} for s in service.tax().skills.values()]
    return [s for s in out if not category or s["category"] == category]


@app.post("/analyze/job", response_model=JobProfile)
def analyze_job(body: TextIn) -> JobProfile:
    return service.analyze_job(body.text, use_llm=body.use_llm)


@app.post("/analyze/resume", response_model=CandidateProfile)
def analyze_resume(body: TextIn) -> CandidateProfile:
    return service.analyze_resume(body.text, use_llm=body.use_llm)


@app.post("/resume/parse")
async def parse_resume(file: UploadFile = File(...)) -> dict:
    """Upload a resume file; returns its text so the user can review it before analysis."""
    data = await file.read()
    try:
        text = parsing.file_to_text(file.filename or "", data)
    except parsing.UnsupportedFile as e:
        raise HTTPException(422, str(e))
    return {"filename": file.filename, "text": text, "chars": len(text)}


@app.post("/analyze/resume/file", response_model=CandidateProfile)
async def analyze_resume_file(file: UploadFile = File(...), use_llm: Optional[bool] = Form(None)) -> CandidateProfile:
    data = await file.read()
    try:
        text = parsing.file_to_text(file.filename or "", data)
    except parsing.UnsupportedFile as e:
        raise HTTPException(422, str(e))
    return service.analyze_resume(text, use_llm=use_llm)


@app.post("/gap", response_model=GapReport)
def gap(body: GapRequest) -> GapReport:
    if not body.resume_text and not body.overrides:
        raise HTTPException(422, "Provide resume_text or overrides")
    try:
        return service.gap_report(body.resume_text, job_text=body.job_text, job_id=body.job_id,
                                  overrides=body.overrides, use_llm=body.use_llm,
                                  include_resources=body.include_resources)
    except KeyError:
        raise HTTPException(404, f"Unknown job_id {body.job_id}")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/market", response_model=MarketReport)
def market(body: MarketRequest) -> MarketReport:
    return service.market_report(body.role, body.location, body.resume_text, body.overrides, body.use_llm, body.top)


@app.get("/jobs", response_model=list[JobPosting])
def jobs(role: Optional[str] = None, location: Optional[str] = None, q: Optional[str] = None,
         limit: int = Query(50, ge=1, le=200)) -> list[JobPosting]:
    return get_store().search(role=role, location=location, q=q)[:limit]


@app.get("/jobs/{job_id}", response_model=JobPosting)
def job(job_id: str) -> JobPosting:
    j = get_store().get(job_id)
    if j is None:
        raise HTTPException(404, "Job not found")
    return j


@app.post("/jobs/import", response_model=list[JobPosting])
def import_jobs(source: str = Query(pattern="^(greenhouse|lever)$"), board: str = Query(min_length=1, max_length=80)) -> list[JobPosting]:
    """Pull a company's public job board (Greenhouse board token or Lever slug) into the store."""
    try:
        fetched = sources.fetch_greenhouse(board) if source == "greenhouse" else sources.fetch_lever(board)
    except Exception as e:
        raise HTTPException(502, f"Could not fetch {source} board '{board}': {e}")
    store = get_store()
    for j in fetched:
        store.add(j)
    service._market_profiles.cache_clear()
    return fetched


@app.get("/learn/{skill_id}", response_model=list[Resource])
def learn(skill_id: str, level: float = Query(0, ge=0, le=5), limit: int = Query(5, ge=1, le=20)) -> list[Resource]:
    if skill_id not in service.tax().skills:
        raise HTTPException(404, "Unknown skill")
    return recommend(skill_id, level, limit)


# ---------- resume tuner ----------

@app.post("/resume/chat", response_model=ChatResponse)
def resume_chat(body: ChatRequest) -> ChatResponse:
    """Next interview question about the candidate's gaps for a job, plus what their answers show so far."""
    if not body.resume_text and not body.overrides:
        raise HTTPException(422, "Provide resume_text or overrides")
    try:
        return tuner.chat(body)
    except KeyError:
        raise HTTPException(404, f"Unknown job_id {body.job_id}")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/resume/tailor", response_model=TailoredResume)
def resume_tailor(body: TailorRequest) -> TailoredResume:
    """Reorder and (optionally) reword the resume for one job, using only the resume and the candidate's answers."""
    try:
        return tuner.tailor(body)
    except KeyError:
        raise HTTPException(404, f"Unknown job_id {body.job_id}")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/resume/export/docx")
def resume_export_docx(body: ExportRequest) -> Response:
    """ATS-friendly DOCX: one column, standard headings, plain bullets, no tables or images."""
    data = export.resume_docx(body.header, body.sections)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", body.filename or "resume").strip("_.") or "resume"
    if not name.lower().endswith(".docx"):
        name += ".docx"
    return Response(content=data, media_type=export.DOCX_MIME,
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
