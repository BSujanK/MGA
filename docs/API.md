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
| POST | `/resume/chat` | Next interview question about the candidate's gaps for a job, plus findings from their answers |
| POST | `/resume/tailor` | Resume reordered (and, with AI, reworded) for one job, using only the resume and answers |
| POST | `/prep` | Prep kit for one job: DSA plan, core subjects, OA formats, aptitude, questions, project, weekly schedule |
| POST | `/resume/export/docx` | ATS-friendly DOCX of a (possibly edited) tailored resume |

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

## POST /resume/chat

Stateless: the client sends the whole conversation each time.

```json
{
  "resume_text": "…", "job_id": "sde1-kestrel",           // or "job_text"
  "turns": [{"question_id": "gap:os", "skill_id": "os", "question": "…", "answer": "No, only in class"}],
  "max_questions": 6
}
```

Returns `{question, done, asked, planned, findings, mode}`.
- **What gets asked:** the engine picks the questions. It asks about open gaps, must-haves first, then two general questions (`gen:impact`, `gen:hidden`). An affirmative answer with no detail or no result gets one follow-up (`gap:<skill>:more`).
- **Answers:** an empty answer means skipped. An answer starting with "no", "not yet", "never" and similar adds nothing.
- **Wording:** Claude words the question when enabled; otherwise the script is used.
- **`findings`:** skills the answers give evidence for. Level 3 for real use, 2 for coursework or tutorials. Negated clauses ("but never used Kubernetes") are ignored.

## POST /resume/tailor

`{resume_text, job_id | job_text, turns}` → `TailoredResume`:
- `header` and `sections[].entries[]`, each with `heading` and `bullets` lines. Each line has a `source`: `resume`, `answer` or `added`. `original` is set when a line was reworded.
- **Ordering:** skills and bullets are sorted by job relevance. Section order and the chronological order of roles are kept.
- **Answer bullets:** answers become bullets in "Additional Projects & Experience".
- **Added keywords:** job skills the candidate has shown but never named (MySQL ⇒ SQL, or from an answer) are added on one "Additional:" skills line, and `notes` says why.
- **Guardrail:** with AI on, Claude rewords lines, and every rewrite is re-extracted. A rewrite is reverted (`guardrail[]`) if it names a skill or a number its source line doesn't have, drops a job skill the line named, or grows a lot.
- `keywords_missing`: job skills with no evidence anywhere. They are never added; they go to the learning plan.
- `coverage_before` / `coverage_after`: weighted share of the job's skills named in the text.

## POST /resume/export/docx

`{header, sections, filename}` → `.docx`: one column, standard headings, real bullet lists, no tables or images.

## POST /prep

`{resume_text?, overrides?, job_id | job_text, hours_per_week}` → `PrepKit`. A resume is optional; without one the plan starts from the basics.
- **`dsa`:** topics from `data/prep.json`, cut to the level the job asks for. Topics the candidate already covers are marked `review` and get 30% of the time. Data/ML postings that don't ask for DSA get the basic tier only. Roles with no programming skip DSA.
- **`core`:** OOP, OS, DBMS, networks, system design and SQL, when the posting asks for them, each with a gap status, hours (capped at 12 for revision) and curated resources.
- **`oa_formats`:** generic early-career OA formats, with `relevant` and `reason` set from the posting. `posting_process` holds lines about the hiring process, quoted verbatim.
- **`aptitude`:** areas and topics. They are only scheduled when the posting mentions aptitude.
- **`company_questions`:** built from quoted posting lines (`source: posting`). With AI on, Claude adds questions (`source: ai`), and any question whose `quote` isn't literally in the posting is dropped. Nothing claims a company asks a question.
- **`behavioral`:** an original question bank plus a STAR tip.
- **`projects`:** templates ranked by how much of the candidate's gaps they close (`covers`) and what they already know (`builds_on`).
- **`schedule`:** weeks filled by share (DSA 45%, core 25%, project 30%) in chunks of at least 1.5 h. Long items span weeks as "part i of n".

## Levels

| Level | Meaning |
|---|---|
| 1 | Aware |
| 2 | Basic (course or listed) |
| 3 | Working (used in a project or internship) |
| 4 | Strong |
| 5 | Expert |
