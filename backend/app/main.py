"""MGA API. Run: uvicorn app.main:app --reload (from backend/). Docs at /docs."""
from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import llm, service
from .engine.learning import recommend
from .jobs import sources
from .jobs.store import get_store
from .models import (
    CandidateProfile, GapReport, GapRequest, JobPosting, JobProfile, MarketReport, MarketRequest,
    Resource, TextIn,
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
