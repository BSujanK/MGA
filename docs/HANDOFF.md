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

## Phase 2 (v0.3): accounts, Postgres, live jobs, deploy (built)
- **Stack decisions:**
  - Postgres 16 with SQLAlchemy 2 and Alembic;
  - a stateless FastAPI service, scaled by adding instances;
  - backend-owned auth: email codes plus Google sign-in, with sessions in Postgres;
  - Next.js proxies `/api` to the API, so cookies stay first-party;
  - Docker images and compose; CI in `.github/workflows/ci.yml`;
  - `docs/DEPLOY.md` for Vercel + Render/Railway + managed Postgres.
- **Data:**
  - Personal data (resume, answers, calendar notes, saved reports) is encrypted at rest.
  - `/me/export` and `DELETE /me` cover everything, including login codes and audit links.
- **Jobs:** `python -m app.ingest` pulls Greenhouse, Lever and Adzuna. Postings are stored pre-analyzed with an engine version. `/jobs/fit` ranks postings by readiness, and the jobs page shows the badges.
- **Cron jobs:** `app.ingest` (every 6 h), `app.reminders` (daily calendar emails, India time), `app.maintenance` (daily purge).
- **More features:** PDF resume export, 24 project templates, and 120 original self-check quiz questions (`/quiz`).
- **Security:** a review found 10 issues, all fixed with regression tests in `tests/test_security.py`:
  - fail-closed `MGA_ENV`;
  - atomic code checks;
  - proxy-safe IPs;
  - body and field size caps;
  - Claude only for signed-in users by default;
  - URL validation.
- **Not verified in this environment:**
  - Docker images were never built (no Docker daemon);
  - the CI workflow has not run on GitHub;
  - live Greenhouse, Lever and Adzuna calls were blocked by the sandbox network, so they are tested with mock responses only;
  - Google sign-in is tested only with a mocked token;
  - no real email provider was used.

## UI v2 (design system)
- **Design rules:** `docs/DESIGN.md`. It covers:
  - one typeface (Geist);
  - the palette: Whiteout, Black Stone, Fusion, Redline, Royal Blue, Nitro Orange;
  - the type scale;
  - one dark block and one "unexpected move" per page.
- **Shared code:** tokens and utilities are in `frontend/src/app/globals.css`, primitives in `frontend/src/components/ui.tsx`. The reference page is `frontend/src/app/page.tsx`.
- **Status:** every page is redesigned and checked at 1440 and 390 px (no horizontal scroll, no console errors).
- **Candidates for `ui.tsx`** (suggested by the page builders): `ReadinessNumeral`, a faded `Index` heading, `LevelDots`, a drawn `Check`, a pill `Segmented` control, and a `DangerZone`.

## Next tasks, in order
1. **Deploy:** follow `docs/DEPLOY.md`. You need to:
   - create Postgres, the API service and the website;
   - set `MGA_ENV=production`, `MGA_DATA_KEY`, `RESEND_API_KEY`, `MGA_TRUST_PROXY=1` and `MGA_CORS_ORIGINS`;
   - add the three cron jobs;
   - verify a sending domain in Resend;
   - optionally add a Google OAuth client ID.
2. **Job boards:** fill `backend/app/data/boards.json` with Greenhouse/Lever tokens of India tech companies, verified on their careers pages. Register for Adzuna keys and show "Jobs by Adzuna" next to Adzuna results (UI not built yet).
3. **Accuracy:** a held-out eval set labeled by other people (~100 pairs, two labelers), and `python -m eval.run --llm` with a key.
4. **Frontend for new backend features:**
   - a PDF button on the tuner (`/resume/export/pdf`);
   - quizzes on the prep page that suggest a level, applied only if the user accepts, via My skills overrides;
   - a reminder-email toggle on the account page (`/me/settings`).
5. **Legal:** lawyer review of the privacy notice (`/privacy` is marked as a draft) and terms; re-consent when `TERMS_VERSION` changes (not built).
6. **Scale later:** PgBouncer/Neon pooler when instances × workers × 15 nears the Postgres connection limit; a shared rate-limit store (Redis) if the per-instance throttles get too loose; Postgres full-text search for jobs past ~50k postings.

## How to run
```bash
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && MGA_ENV=development uvicorn app.main:app --reload
```
```bash
cd frontend && npm install && npm run dev
```
```bash
cd backend && python -m pytest -q && python -m eval.run
```
```bash
cp .env.example .env && docker compose up --build   # full stack with Postgres
```
