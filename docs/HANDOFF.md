# Handoff: where the build stands

Read this first in any new session, then `CLAUDE.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.

## Decisions already made by the founder
- First market: **India, early-career tech** (students, freshers, 0–2 years).
- **Web first** (Next.js, PWA later). No fixed timeline. Team = founder + Claude.
- This is a real startup product, not a demo. Build properly and keep shipping usable slices.
- Monetization still open (candidate freemium / college placement-cell licensing / employer subscription).
- The founder asked Claude to keep building continuously ("don't stop until the limit hits").

## What exists
**Backend** (`backend/`, FastAPI, 39 tests passing):
- Engine: taxonomy (86 skills), rule extraction, optional Claude extraction (`app/llm.py`), gap scoring, market aggregation, learning catalog.
- Endpoints: `/gap`, `/market`, `/jobs`, `/jobs/import` (Greenhouse/Lever), `/learn/{skill}`, `/analyze/job`, `/analyze/resume`, `/resume/parse` (PDF/DOCX/TXT), `/analyze/resume/file`.
- Sample data: 14 synthetic postings (fictional companies) and a sample resume.

**Frontend** (`frontend/`, Next.js 16.4 App Router, Tailwind v4, builds clean):
- Pages: `/` (resume input), `/analyze` (job fit report), `/market`, `/jobs`, `/profile` (my skills + level corrections).
- The resume and corrections are stored in browser localStorage (`src/lib/profile.ts`) until accounts exist.
- The API client and types are in `src/lib/` and mirror `backend/app/models.py`.
- Next 16 has breaking changes: read `frontend/node_modules/next/dist/docs/` before using unfamiliar APIs. Tailwind v4 custom classes use `@utility` in `globals.css`, not `@apply` of other custom classes.

## Next tasks, in order
1. **Resume tuner** (`/resume` page; it's linked in the nav but not built yet):
   - Backend `POST /resume/chat`: interview questions about the candidate's top gaps for a target job. Claude when a key is set; scripted questions from the gap report otherwise.
   - Backend `POST /resume/tailor`: reorder skills and bullets by job relevance, add the candidate's own answers. Claude rewrite when available. **Guardrail:** re-extract skills from the output and drop anything not in the resume or answers. DOCX export endpoint.
2. **Prep kit** (`/prep`):
   - DSA plan, OA format overview, aptitude topics, behavioral/culture questions (original), and a gap-closing project chosen from project templates by overlap with the candidate's gaps.
   - Company-specific questions only from the posting text, or from Claude grounded in it.
3. **Calendar** (`/calendar`): localStorage events (application, OA, interview, deadline), month/list view, `.ics` export, "add to calendar" from the jobs page.
4. **Evaluation set v1**: `backend/eval/cases/*.json` with hand-labeled skills and levels for postings and resumes, plus `backend/eval/run.py` reporting precision/recall and status agreement.
5. Then Phase 2 of the roadmap: accounts, Postgres, live job ingestion.

## How to run
```bash
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && uvicorn app.main:app --reload
```
```bash
cd frontend && npm install && npm run dev
```
