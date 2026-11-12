# MGA API (v0.1)

Base URL in development: `http://localhost:8000`. Interactive docs: `/docs`. The Pydantic models in `backend/app/models.py` are the source of truth for every shape.

Every analysis endpoint accepts `use_llm` (`true` / `false` / omitted). If omitted, Claude is used when an API key is configured; otherwise the rule engine runs alone.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Status, whether AI extraction is on, counts |
| GET | `/skills?category=` | The skill taxonomy |
| POST | `/analyze/job` | `{text}` → `JobProfile` (skills, importance, required level, evidence) |
| POST | `/analyze/resume` | `{text}` → `CandidateProfile` (skills, evidence-based level) |
| POST | `/gap` | Candidate vs. one job → `GapReport` |
| POST | `/market` | Candidate vs. the market for a role → `MarketReport` |
| GET | `/jobs?role=&location=&q=&limit=` | Search postings |
| GET | `/jobs/{id}` | One posting |
| POST | `/jobs/import?source=greenhouse\|lever&board=` | Pull a company's public job board |
| GET | `/learn/{skill_id}?level=&limit=` | Resources for a skill, matched to level |

## POST /gap

```json
{
  "resume_text": "…",                                   // or omit and use overrides only
  "overrides": [{"skill_id": "python", "level": 4}],     // optional corrections / quiz results
  "job_id": "sde1-kestrel",                              // or "job_text": "…"
  "include_resources": true
}
```

Response (abridged):

```json
{
  "summary": {
    "readiness": 69.0, "must_have_coverage": 75.2,
    "strong": 8, "partial": 2, "transferable": 1, "missing": 5,
    "est_hours_to_close": 197.7,
    "headline": "You're 69% of the way there. Focus first on Operating Systems, …"
  },
  "gaps": [
    {
      "skill_id": "os", "name": "Operating Systems", "importance": "must",
      "required_level": 3.5, "candidate_level": 0, "effective_level": 0, "gap": 3.5,
      "status": "missing", "transfer_from": null, "satisfied_by": null, "alternatives": [],
      "est_hours": 39.0,
      "job_evidence": [{"text": "Solid understanding of OOP, DBMS and operating systems concepts", "section": "must"}],
      "candidate_evidence": [],
      "resources": [{"title": "Operating Systems: Three Easy Pieces", "url": "https://pages.cs.wisc.edu/~remzi/OSTEP/", "…": "…"}]
    }
  ],
  "extra_skills": [{"skill_id": "react", "level": 3.5, "…": "…"}],
  "job": {"…": "JobProfile"}, "candidate": {"…": "CandidateProfile"}
}
```

`gaps` holds every skill the job asks for, sorted by learning priority, with strong ones last. Requirements with alternatives ("Java, Go, Python or C++") appear once, under the option the candidate is closest on. The other options are listed in `alternatives`.

## POST /market

```json
{"role": "sde", "location": "Bengaluru", "resume_text": "…", "top": 25}
```

Returns:
- `skills`: frequency, must-have rate and average level across matching postings.
- `candidate_gaps` (when a resume or overrides are given): ranked by how much of the market each gap unlocks.
- `market_readiness`.

## Levels

| Level | Meaning |
|---|---|
| 1 | Aware |
| 2 | Basic (course or listed) |
| 3 | Working (used in a project or internship) |
| 4 | Strong |
| 5 | Expert |
