"""Job postings store. Today: the bundled sample file plus anything fetched
from live sources at runtime (in memory). Next: Postgres."""
from __future__ import annotations

import json
import re
from functools import lru_cache

from ..engine.taxonomy import DATA_DIR
from ..models import JobPosting

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


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, JobPosting] = {}

    def add(self, job: JobPosting) -> None:
        self._jobs[job.id] = job

    def get(self, job_id: str) -> JobPosting | None:
        return self._jobs.get(job_id)

    def all(self) -> list[JobPosting]:
        return list(self._jobs.values())

    def search(self, role: str | None = None, location: str | None = None, q: str | None = None) -> list[JobPosting]:
        jobs = self.all()
        if role:
            terms = ROLE_SYNONYMS.get(role.strip().lower(), [role.strip().lower()])
            jobs = [j for j in jobs if any(re.search(rf"\b{re.escape(t)}", j.title.lower()) for t in terms)]
        if location:
            loc = location.strip().lower()
            jobs = [j for j in jobs if loc in j.location.lower() or ("remote" in j.location.lower() and loc != "onsite")]
        if q:
            ql = q.lower()
            jobs = [j for j in jobs if ql in j.title.lower() or ql in j.company.lower() or ql in j.description.lower()]
        return jobs


@lru_cache(maxsize=1)
def get_store() -> JobStore:
    store = JobStore()
    raw = json.loads((DATA_DIR / "jobs_sample.json").read_text())
    for j in raw["jobs"]:
        store.add(JobPosting(**j))
    return store
