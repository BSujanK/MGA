"""Job postings store, backed by the database.

Every posting is stored with its pre-analyzed JobProfile (rule extractor), so
the market report and the fit % in the job list never re-parse text on a
request. Profiles carry an engine version: when the taxonomy or extractor
changes, stale profiles are re-analyzed on next use (or in bulk by
`python -m app.ingest --reanalyze`).
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from sqlalchemy import func, or_, select, update

from ..engine.taxonomy import DATA_DIR
from ..models import JobPosting, JobProfile

# Words that mean the same role family, so "sde" also finds "Software Engineer".
ROLE_SYNONYMS = {
    "sde": ["sde", "software development engineer", "software engineer", "backend", "full stack", "developer"],
    "software engineer": ["sde", "software development engineer", "software engineer", "developer"],
    "frontend": ["frontend", "front end", "front-end", "ui engineer", "react developer"],
    "backend": ["backend", "back end", "back-end", "sde"],
    "full stack": ["full stack", "fullstack", "full-stack"],
    "data analyst": ["data analyst", "business analyst", "analyst"],
    "data engineer": ["data engineer"],
    "ml": ["machine learning", "ml engineer", "ai engineer", "data scientist"],
    "machine learning": ["machine learning", "ml engineer", "ai engineer"],
    "ai engineer": ["ai engineer", "machine learning", "generative ai"],
    "devops": ["devops", "sre", "site reliability", "cloud engineer", "platform engineer"],
    "qa": ["qa", "test", "sdet", "quality"],
    "android": ["android", "mobile"],
    "mobile": ["android", "ios", "mobile", "flutter", "react native"],
}

_ENGINE_FILES = ["data/skills.json", "engine/extractor.py", "engine/taxonomy.py"]


@lru_cache(maxsize=1)
def engine_version() -> str:
    """Changes whenever the taxonomy or extractor changes, so stored profiles get refreshed."""
    root = Path(__file__).resolve().parent.parent
    h = hashlib.sha256()
    for f in _ENGINE_FILES:
        h.update((root / f).read_bytes())
    return h.hexdigest()[:16]


def content_hash(j: JobPosting) -> str:
    return hashlib.sha256(f"{j.title}\n{j.company}\n{j.location}\n{j.description}".encode()).hexdigest()


def _to_posting(r) -> JobPosting:
    return JobPosting(id=r.id, title=r.title, company=r.company, location=r.location, experience=r.experience,
                      employment_type=r.employment_type, apply_url=r.apply_url, posted_at=r.posted_at,
                      source=r.source, description=r.description)


def _analyze(j: JobPosting) -> JobProfile:
    from ..engine.extractor import extract_job
    from ..engine.taxonomy import load_taxonomy
    return extract_job(j.description, load_taxonomy(), title=j.title, company=j.company)


class JobStore:
    """Thin repository over the job_postings table. Each call uses its own short session."""

    def _session(self):
        from ..db import SessionLocal
        return SessionLocal()

    # ----- writes -----

    def add(self, job: JobPosting, board: str | None = None, external_id: str | None = None) -> str:
        """Insert or update one posting. Returns 'created', 'updated' or 'unchanged'."""
        from ..db.models import JobPostingRow
        with self._session() as db:
            row = db.get(JobPostingRow, job.id)
            h = content_hash(job)
            status = "unchanged"
            if row is None:
                row = JobPostingRow(id=job.id, source=job.source, external_id=external_id or job.id, board=board)
                db.add(row)
                status = "created"
            elif row.content_hash != h or not row.active:
                status = "updated"
            if status != "unchanged":
                for f in ("title", "company", "location", "experience", "employment_type", "apply_url", "posted_at", "description"):
                    setattr(row, f, getattr(job, f))
                row.source, row.content_hash, row.active = job.source, h, True
                row.profile = _analyze(job).model_dump(mode="json")
                row.profile_version = engine_version()
            row.last_seen_at = datetime.now(timezone.utc)
            db.commit()
        _version_cache.clear()
        return status

    def close_missing(self, source: str, board: str, seen_ids: set[str]) -> int:
        """Mark a board's postings that disappeared from the source as inactive."""
        from ..db.models import JobPostingRow
        with self._session() as db:
            q = update(JobPostingRow).where(JobPostingRow.source == source, JobPostingRow.board == board,
                                            JobPostingRow.active.is_(True))
            if seen_ids:
                q = q.where(JobPostingRow.id.not_in(seen_ids))
            n = db.execute(q.values(active=False)).rowcount
            db.commit()
        _version_cache.clear()
        return n or 0

    # ----- reads -----

    def get(self, job_id: str) -> JobPosting | None:
        from ..db.models import JobPostingRow
        with self._session() as db:
            row = db.get(JobPostingRow, job_id)
            return _to_posting(row) if row else None

    def profile(self, job_id: str) -> JobProfile | None:
        return self.profiles([job_id]).get(job_id)

    def profiles(self, job_ids: list[str]) -> dict[str, JobProfile]:
        """Stored profiles; stale or missing ones are re-analyzed and saved."""
        from ..db.models import JobPostingRow
        out: dict[str, JobProfile] = {}
        if not job_ids:
            return out
        with self._session() as db:
            rows = db.scalars(select(JobPostingRow).where(JobPostingRow.id.in_(job_ids))).all()
            dirty = False
            for r in rows:
                if r.profile is None or r.profile_version != engine_version():
                    r.profile = _analyze(_to_posting(r)).model_dump(mode="json")
                    r.profile_version = engine_version()
                    dirty = True
                out[r.id] = JobProfile(**r.profile)
            if dirty:
                db.commit()
        return out

    def all(self) -> list[JobPosting]:
        return self.search(limit=None)

    def count(self) -> int:
        from ..db.models import JobPostingRow
        with self._session() as db:
            return db.scalar(select(func.count()).select_from(JobPostingRow).where(JobPostingRow.active.is_(True))) or 0

    def search(self, role: str | None = None, location: str | None = None, q: str | None = None,
               limit: int | None = 50, offset: int = 0, board: str | None = None) -> list[JobPosting]:
        from ..db.models import JobPostingRow
        stmt = select(JobPostingRow).where(JobPostingRow.active.is_(True))
        if board:
            stmt = stmt.where(JobPostingRow.board == board)
        terms: list[str] = []
        if role:
            terms = ROLE_SYNONYMS.get(role.strip().lower(), [role.strip().lower()])
            stmt = stmt.where(or_(*[JobPostingRow.title.ilike(f"%{t}%") for t in terms]))
        if location:
            loc = location.strip().lower()
            stmt = stmt.where(or_(JobPostingRow.location.ilike(f"%{loc}%"), JobPostingRow.location.ilike("%remote%")))
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(JobPostingRow.title.ilike(like), JobPostingRow.company.ilike(like),
                                  JobPostingRow.description.ilike(like)))
        stmt = stmt.order_by(JobPostingRow.posted_at.desc().nulls_last(), JobPostingRow.id)
        with self._session() as db:
            rows = db.scalars(stmt).all()
        jobs = [_to_posting(r) for r in rows]
        if terms:  # word-start match, so "sde" doesn't match "insider"
            jobs = [j for j in jobs if any(re.search(rf"\b{re.escape(t)}", j.title.lower()) for t in terms)]
        return jobs[offset:offset + limit] if limit is not None else jobs[offset:]

    def version(self) -> tuple[int, str]:
        """Cheap change marker for caches: (active count, last update).

        Re-read at most every VERSION_TTL seconds, so another API instance's
        ingest shows up here within a minute without a query per request.
        """
        hit = _version_cache.get("v")
        if hit is None or time.monotonic() - hit[0] > VERSION_TTL:
            from ..db.models import JobPostingRow
            with self._session() as db:
                n, last = db.execute(select(func.count(), func.max(JobPostingRow.updated_at))
                                     .where(JobPostingRow.active.is_(True))).one()
            hit = (time.monotonic(), (n or 0, str(last)))
            _version_cache["v"] = hit
        return hit[1]


VERSION_TTL = 60.0
_version_cache: dict[str, tuple[float, tuple[int, str]]] = {}


@lru_cache(maxsize=1)
def get_store() -> JobStore:
    from ..db import init
    init()
    return JobStore()


def seed_samples() -> None:
    """Load the synthetic sample postings once, so a fresh install has something to show."""
    from ..db import SessionLocal
    from ..db.models import JobPostingRow
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(JobPostingRow).where(JobPostingRow.source == "sample")):
            return
    from sqlalchemy.exc import IntegrityError
    raw = json.loads((DATA_DIR / "jobs_sample.json").read_text())
    store = JobStore()
    for j in raw["jobs"]:
        try:
            store.add(JobPosting(**j), board="sample")
        except IntegrityError:  # another worker seeded it first
            continue
