# Handoff: where the build stands

Read this first in any new session, then `CLAUDE.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.

## Decisions already made by the founder
- First market: **India, early-career tech** (students, freshers, 0–2 years).
- **Web first** (Next.js, PWA later). No fixed timeline. Team = founder + Claude.
- This is a real startup product, not a demo. Build properly and keep shipping usable slices.
- Monetization still open (candidate freemium / college placement-cell licensing / employer subscription).
- The founder asked Claude to keep building continuously ("don't stop until the limit hits").

## What exists
**Backend** (`backend/`, FastAPI, 97 tests passing):
- **Engine:**
  - taxonomy (86 skills), rule extraction, optional Claude extraction (`app/llm.py`), gap scoring, market aggregation, learning catalog;
  - resume structure and guardrail (`engine/resume_doc.py`);
  - prep kit (`engine/prep.py` + `data/prep.json`).
- **Endpoints:**
  - `/gap`, `/market`, `/jobs`, `/jobs/import` (Greenhouse/Lever), `/learn/{skill}`, `/analyze/job`, `/analyze/resume`;
  - `/resume/parse` (PDF/DOCX/TXT), `/analyze/resume/file`;
  - `/resume/chat`, `/resume/tailor`, `/resume/export/docx`;
  - `/prep`.
- **Resume tuner** (`app/tuner.py`):
  - The interview asks about the top gaps (must-haves first), then about impact and hidden experience. Questions are scripted from the gap report; Claude words them when a key is set.
  - Answers become findings and bullets. Negative answers and negated clauses add nothing.
  - Tailoring reorders skills and bullets by job relevance. With Claude, lines are reworded, and every rewrite goes through `check_rewrite`, which reverts new skills, new numbers, large growth or a dropped job skill.
- **Prep kit** (`app/prepkit.py`): DSA plan cut to the job's level, core subjects, OA formats, aptitude, original behavioral questions, company questions built only from quoted posting lines (Claude questions are dropped unless their quote is literally in the posting), a gap-closing project from 14 templates, and a weekly schedule.
- **Evaluation** (`backend/eval/`): 12 postings + 12 resumes, synthetic and hand-labeled, in 30 pairs. `python -m eval.run` scores the engine; `tests/test_eval.py` fails on regressions against `eval/baseline.json`. Read `eval/README.md` before quoting numbers.
- **Sample data:** 14 synthetic postings (fictional companies) and a sample resume.

**Frontend** (`frontend/`, Next.js 16.4 App Router, Tailwind v4, builds and lints clean):
- **Pages:**
  - `/` (resume input), `/analyze` (job fit report), `/market`, `/jobs`, `/profile` (my skills + level corrections);
  - `/resume`: interview chat, then a tailored resume with diff, inline edit, remove and "move under", DOCX download, print to PDF and copy text;
  - `/prep`: tabs for weekly plan, DSA, core subjects, OA, questions and project, with progress ticks;
  - `/calendar`: list and month views, a "coming up" banner, `.ics` export with alarms, Google Calendar links.
- **Links:** the jobs page links each posting to fit, tuner, prep kit and "add to calendar"; the prep kit links "Add OA date to calendar".
- **Storage:** all personal data is in localStorage via `src/lib/store.ts` (`mga.profile.v1`, `mga.tuner.v1`, `mga.prep.v1`, `mga.calendar.v1`).
- **Shared pieces:** the API client and types in `src/lib/` mirror `backend/app/models.py`. `components/JobPicker.tsx` is the shared pick-or-paste job selector.
- **Framework notes:** Next 16 has breaking changes, so read `frontend/node_modules/next/dist/docs/` before using unfamiliar APIs. Tailwind v4 custom classes use `@utility` in `globals.css`, not `@apply` of other custom classes.

## Next tasks, in order
1. **Accuracy:** get a held-out eval set written and labeled by other people (target ~100 pairs, two labelers), and run `python -m eval.run --llm` with a key to record rules+Claude numbers. Don't quote accuracy until then.
2. **Phase 2 of the roadmap:** accounts (auth, profiles, saved reports, delete-my-data), then Postgres, then live job ingestion (Greenhouse/Lever board list for India tech companies, Adzuna). Move the localStorage stores onto accounts with an import step.
3. **Gap % in the job list** ("jobs you're closest to"), once postings are pre-analyzed at ingestion.
4. **Tuner follow-ups:**
   - PDF export from the backend, so formatting doesn't depend on the browser;
   - a "save tailored version" history per job;
   - let interview findings update My skills with one click.
5. **Prep follow-ups:**
   - mark DSA topics done from a short self-check quiz (also feeds skill levels);
   - more project templates (mobile, security, data science).
6. Run `scripts/check_links.py` locally (outbound fetches may be blocked in cloud sessions) and fix dead links.

## How to run
```bash
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && uvicorn app.main:app --reload
```
```bash
cd frontend && npm install && npm run dev
```
```bash
cd backend && python -m pytest -q && python -m eval.run
```
