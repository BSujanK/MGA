"""MGA API. Run: uvicorn app.main:app --reload (from backend/). Docs at /docs."""
from __future__ import annotations

import hmac
import os
import re
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import crypto, export, ingest, limits, llm, parsing, prepkit, service, tuner
from .auth import optional_user
from .db import get_db
from .db.models import Profile
from .config import settings
from .routes import auth as auth_routes
from .routes import me as me_routes
from .engine.learning import recommend
from .jobs.store import get_store
from .models import (
    CandidateProfile, ChatRequest, JobFitRequest, JobFitResponse, SkillOverride, ChatResponse, ExportRequest, GapReport, GapRequest, JobPosting, JobProfile,
    MarketReport, MarketRequest, PrepKit, PrepRequest, Resource, TailoredResume, TailorRequest, TextIn,
)

app = FastAPI(
    title="MGA - Market Gap Analysis API",
    version="0.1.0",
    description="Skill-by-skill gap analysis between candidates, job postings and the job market.",
    dependencies=[Depends(limits.llm_gate)],
)
app.add_middleware(limits.BodySizeLimit)
settings().check()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("MGA_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_credentials=True,  # session cookie; origins are an explicit allowlist, never "*"
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_routes.router)
app.include_router(me_routes.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "llm_enabled": llm.enabled(), "model": llm.MODEL if llm.enabled() else None,
            "skills": len(service.tax().skills), "jobs": get_store().count()}


@app.get("/health/ready")
def health_ready() -> dict:
    """Readiness: the database answers. /health is liveness and does not need the database to be up."""
    from sqlalchemy import text
    from .db import engine
    try:
        with engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(503, "Database unavailable")
    return {"status": "ready"}


@app.get("/skills")
def list_skills(category: Optional[str] = None) -> list[dict]:
    out = [{"id": s.id, "name": s.name, "category": s.category} for s in service.tax().skills.values()]
    return [s for s in out if not category or s["category"] == category]


@app.post("/analyze/job", response_model=JobProfile, dependencies=[Depends(limits.throttle)])
def analyze_job(body: TextIn) -> JobProfile:
    return service.analyze_job(body.text, use_llm=body.use_llm)


@app.post("/analyze/resume", response_model=CandidateProfile, dependencies=[Depends(limits.throttle)])
def analyze_resume(body: TextIn) -> CandidateProfile:
    return service.analyze_resume(body.text, use_llm=body.use_llm)


@app.post("/resume/parse", dependencies=[Depends(limits.throttle)])
async def parse_resume(file: UploadFile = File(...)) -> dict:
    """Upload a resume file; returns its text so the user can review it before analysis."""
    data = await file.read()
    try:
        text = parsing.file_to_text(file.filename or "", data)
    except parsing.UnsupportedFile as e:
        raise HTTPException(422, str(e))
    return {"filename": file.filename, "text": text, "chars": len(text)}


@app.post("/analyze/resume/file", response_model=CandidateProfile, dependencies=[Depends(limits.throttle)])
async def analyze_resume_file(file: UploadFile = File(...), use_llm: Optional[bool] = Form(None)) -> CandidateProfile:
    data = await file.read()
    try:
        text = parsing.file_to_text(file.filename or "", data)
    except parsing.UnsupportedFile as e:
        raise HTTPException(422, str(e))
    return service.analyze_resume(text, use_llm=use_llm)


@app.post("/gap", response_model=GapReport, dependencies=[Depends(limits.throttle)])
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


@app.post("/market", response_model=MarketReport, dependencies=[Depends(limits.throttle)])
def market(body: MarketRequest) -> MarketReport:
    return service.market_report(body.role, body.location, body.resume_text, body.overrides, body.use_llm, body.top)


@app.get("/jobs", response_model=list[JobPosting])
def jobs(role: Optional[str] = None, location: Optional[str] = None, q: Optional[str] = None,
         limit: int = Query(50, ge=1, le=200)) -> list[JobPosting]:
    return get_store().search(role=role, location=location, q=q, limit=limit)


@app.get("/jobs/{job_id}", response_model=JobPosting)
def job(job_id: str) -> JobPosting:
    j = get_store().get(job_id)
    if j is None:
        raise HTTPException(404, "Job not found")
    return j


@app.post("/jobs/import", response_model=list[JobPosting])
def import_jobs(source: str = Query(pattern="^(greenhouse|lever)$"), board: str = Query(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$"),
                company: Optional[str] = Query(None, max_length=200), x_admin_token: Optional[str] = Header(None)) -> list[JobPosting]:
    """Admin only: pull one company's public job board now (scheduled runs use `python -m app.ingest`)."""
    token = settings().admin_token
    if not token or len(token) < 24 or not x_admin_token or \
            not hmac.compare_digest(token.encode(), x_admin_token.encode("utf-8", "replace")):
        raise HTTPException(403, "Admin token required (MGA_ADMIN_TOKEN, at least 24 characters)")
    run = ingest.ingest_board(source, board, company)
    if run.error:
        raise HTTPException(502, f"Could not fetch {source} board '{board}': {run.error}")
    return get_store().search(q=None, limit=200, board=board)


@app.post("/jobs/fit", response_model=JobFitResponse, dependencies=[Depends(limits.throttle)])
def jobs_fit(body: JobFitRequest, user=Depends(optional_user), db=Depends(get_db)) -> JobFitResponse:
    """Postings ranked by how close you already are: 'jobs you're closest to'."""
    resume, overrides, used_saved = body.resume_text, body.overrides, False
    if not resume and not overrides and user is not None:
        prof = db.get(Profile, user.id)
        if prof is not None:
            resume, overrides, used_saved = crypto.decrypt(prof.resume_enc), [SkillOverride(**o) for o in prof.overrides or []], True
    if not resume and not overrides:
        raise HTTPException(422, "Provide resume_text or overrides, or sign in with a saved resume")
    fits, considered = service.job_fits(resume, overrides, body.role, body.location, body.q, body.limit)
    return JobFitResponse(jobs=fits, considered=considered, used_saved_profile=used_saved)


@app.get("/learn/{skill_id}", response_model=list[Resource])
def learn(skill_id: str, level: float = Query(0, ge=0, le=5), limit: int = Query(5, ge=1, le=20)) -> list[Resource]:
    if skill_id not in service.tax().skills:
        raise HTTPException(404, "Unknown skill")
    return recommend(skill_id, level, limit)


# ---------- resume tuner ----------

@app.post("/resume/chat", response_model=ChatResponse, dependencies=[Depends(limits.throttle)])
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


@app.post("/resume/tailor", response_model=TailoredResume, dependencies=[Depends(limits.throttle)])
def resume_tailor(body: TailorRequest) -> TailoredResume:
    """Reorder and (optionally) reword the resume for one job, using only the resume and the candidate's answers."""
    try:
        return tuner.tailor(body)
    except KeyError:
        raise HTTPException(404, f"Unknown job_id {body.job_id}")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/resume/export/docx", dependencies=[Depends(limits.throttle)])
def resume_export_docx(body: ExportRequest) -> Response:
    """ATS-friendly DOCX: one column, standard headings, plain bullets, no tables or images."""
    data = export.resume_docx(body.header, body.sections)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", body.filename or "resume").strip("_.") or "resume"
    if not name.lower().endswith(".docx"):
        name += ".docx"
    return Response(content=data, media_type=export.DOCX_MIME,
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/resume/export/pdf", dependencies=[Depends(limits.throttle)])
def resume_export_pdf(body: ExportRequest) -> Response:
    """ATS-friendly PDF: one column, real selectable text, text bullets, no tables or images."""
    data = export.resume_pdf(body.header, body.sections)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", body.filename or "resume").strip("_.") or "resume"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return Response(content=data, media_type=export.PDF_MIME,
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------- prep kit ----------

@app.post("/prep", response_model=PrepKit, dependencies=[Depends(limits.throttle)])
def prep_kit(body: PrepRequest) -> PrepKit:
    """DSA plan, core subjects, OA formats, aptitude, interview questions, a gap-closing project and a weekly plan."""
    try:
        return prepkit.prep_kit(body)
    except KeyError:
        raise HTTPException(404, f"Unknown job_id {body.job_id}")
    except ValueError as e:
        raise HTTPException(422, str(e))
