# MGA: architecture

```
Job posting ─┐                                        ┌─> Gap report (per skill, with evidence)
             ├─> Extract ─> Normalize to ─> Score ────┼─> Market report (across many postings)
Resume ──────┘   skills     skill taxonomy            └─> Learning plan (curated resources)
```

## Stack

| Layer | Now | Planned |
|---|---|---|
| API | Python 3.11+, FastAPI (`backend/`) | same |
| Engine | Rule-based extractor + optional Claude extraction | + embedding similarity for unseen skill phrases |
| Data | JSON files in `backend/app/data/` | Postgres + pgvector |
| AI | Anthropic SDK, structured outputs | + resume interview chat, resume rewriting |
| Frontend | none yet | Next.js (TypeScript), PWA (`frontend/`) |

## Backend layout

```
backend/app/
  main.py              FastAPI routes
  service.py           orchestration: text -> profiles -> reports; merges rules + Claude
  llm.py               Claude extraction (optional; falls back to rules)
  models.py            Pydantic schemas (the API contract)
  engine/
    taxonomy.py        skills, aliases, related-skill graph, implied skills, matcher
    extractor.py       rule-based job + resume extraction
    gap.py             gap scoring, statuses, readiness, priorities
    market.py          aggregate postings into market demand
    learning.py        resource recommendations
    resume_doc.py      resume structure, relevance ordering, rewrite guardrail, keyword coverage
    prep.py            prep kit: DSA plan, core subjects, OA formats, grounded questions, projects, schedule
  prepkit.py           prep kit orchestration (+ optional Claude questions, checked against the posting)
  tuner.py             resume interview (questions from gaps) + tailoring orchestration
  export.py            ATS-friendly DOCX writer
  jobs/
    store.py           job store + role search
    sources.py         Greenhouse / Lever public job board fetchers
  data/
    skills.json        taxonomy (86 skills, v0.1)
    resources.json     learning catalog
    jobs_sample.json   synthetic sample postings
    prep.json          original prep content: DSA topics, subject topics, OA formats, questions, project templates
```

## 1. Taxonomy

Each skill has:
- `id`, `name`, `category`
- `aliases`: case-insensitive
- `exact`: case-sensitive, for ambiguous words such as `Go`, `C`, `R`, `React`, `REST`, `Spring`
- `related`: transfer similarity, 0–1
- `implies`: MySQL ⇒ SQL, Spring Boot ⇒ Java
- `hours`: zero to job-ready level 3

Ambiguous short words (`Go`, `C`, `R`) only match in list context ("Python, Go, Rust").

Next: link each skill to ESCO / Lightcast Open Skills IDs through `external_ids`, and grow the taxonomy from the `unmapped` phrases Claude reports.

## 2. Extraction

**Job posting** (`extractor.extract_job`):
- **Sections** decide importance: Requirements → must; Nice to have → nice; Responsibilities → must; About us → ignored.
- **Wording** can override the section: "is a plus", "preferred" → nice; "strong", "required" → must.
- **Precedence:** an explicit must beats an explicit nice, which beats a must that only comes from a duties mention.
- **Level cues:** "expert" 4, "strong / proficient / hands-on" 3.5, "experience with" 3, "familiar / basic / exposure" 2. "N+ years" raises the level.
- **Alternatives:** skills in the same category joined by "or", "/", "one of" become one requirement ("MySQL or PostgreSQL"), with the weight split between them.
- **Weights:** must 1.0, nice 0.4, × category factor (soft/process 0.5, tools 0.7), +10% per repeat mention.

**Resume** (`extractor.extract_resume`):
- **Evidence beats claims:** listed in skills = 2, used in a project, internship or job = 3, each extra project +0.5 (capped at 4).
- A self-rating ("proficient") can lift a level by at most one step above the evidence.
- Implied skills are added (React ⇒ JavaScript).

**Claude** (`llm.py`), when enabled, reads the same text with a strict rubric and returns structured JSON. Its names are normalized through the taxonomy:
- On the job side, Claude's importance and level win.
- On the resume side, Claude can raise a level by at most one step over the rule evidence.
- Skills it finds that aren't in the taxonomy go to `unmapped`.

**Model:** `claude-opus-5-5` by default (`MGA_MODEL` overrides it), effort `low`, server-side refusal fallbacks enabled.

## 3. Scoring (`engine/gap.py`)

For each job skill with weight `w` and required level `r`:

```
direct      = candidate level (or an alternative's level, if that meets the bar)
transfer    = max over related skills k of min(3, level_k × similarity), dropped if < 0.5
effective   = max(direct, transfer)
gap         = max(0, r − effective)
status      = strong if direct ≥ r; partial if direct > 0; transferable if transfer > 0; else missing
hours       = cost(r) − cost(effective), where cost is linear to level 3, then 0.6 × hours per level above
readiness   = Σ w · min(effective, r)/r  ÷  Σ w   (× 100)
priority    = w · gap/r · (1 + market_frequency) + status boost
```

## 4. Market (`engine/market.py`)

- Extract every posting for a role.
- Compute per-skill frequency, must-have rate and average level.
- Build a composite "typical posting" (weight = frequency) and score the candidate against it.
- Rule extraction is used for bulk work. AI-enriched profiles will be computed once at ingestion and stored.

## 5. Learning (`engine/learning.py`)

- Resources are matched to the candidate's current level: below 2 → beginner, 2–3 → intermediate, above 3 → advanced.
- Free resources rank first.
- Only curated URLs are used.

## 6. Resume tuner (`tuner.py`, `engine/resume_doc.py`)

- **Interview:** the engine picks the questions from the gap report (open gaps, must-haves first, then impact and hidden-experience questions). Claude only words them.
- **Answers:** answers become findings and bullets. Negative answers and negated clauses add nothing.
- **Tailoring:**
  - The resume is parsed into sections, entries (title lines) and bullets.
  - Lines are scored by the job weights of the skills they name; implied skills count half.
  - Skills, project entries and bullets are sorted by that score. Section order and role chronology are kept.
- **Guardrail:** every AI rewrite is re-extracted. It is reverted if it brings in a skill (beyond the implied closure of its source), a number, or a large growth in length, or if it drops a job skill the line named. Job skills with no evidence are never added; they are listed for the learning plan.

## 7. Prep kit (`engine/prep.py`)

- **Content:** all written for MGA, in `data/prep.json`. Links come only from `resources.json`.
- **DSA plan:** topic tiers are cut by the job's required DSA level; topics at the candidate's level are review only.
- **Company questions:** built only from lines quoted from the posting. AI questions must carry an exact quote, or they're dropped.
- **Projects:** a template's score is the sum over the gaps it closes of weight × gap / required, + 0.15 per skill the candidate already has, − 0.05 per unrelated skill.

## 8. Frontend state

Until accounts exist, personal data stays in the browser's localStorage (`src/lib/store.ts`):
- `mga.profile.v1`: resume and skill corrections
- `mga.tuner.v1`: interview answers per job
- `mga.prep.v1`: prep items ticked off per job
- `mga.calendar.v1`: calendar events

The calendar is client-only. `.ics` export (RFC 5545: CRLF, escaping, folding, VALARM reminders) and Google Calendar template links are generated in `src/lib/calendar.ts`.

## Rules the code must keep

1. Rules-only mode must always work: no API key means no AI, and nothing breaks.
2. Every gap carries evidence. No unexplained numbers.
3. No pass/fail verdicts.
4. No invented URLs, skills or resume content.
5. Job data only from sources that allow it.
