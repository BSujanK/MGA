# MGA: roadmap

Small, usable slices. Each phase ends with something a real candidate can use.

## Phase 0: core engine ✅ (v0.1)
- [x] Seed taxonomy: 86 tech skills, aliases, related and implied skills
- [x] Rule extractor for postings (importance, levels, years, "or" alternatives) and resumes (evidence-based levels)
- [x] Optional Claude extraction with structured outputs, merged onto the taxonomy
- [x] Gap scoring: 4 statuses, readiness, must-have coverage, hours, priorities
- [x] Market aggregation across postings plus candidate-vs-market gaps
- [x] Learning catalog (seed), level-matched recommendations
- [x] Job store with sample postings; Greenhouse and Lever public board import
- [x] FastAPI endpoints, 35 tests

## Phase 1: usable web MVP (next)
- [x] Next.js frontend: upload/paste resume → pick a job or paste a posting → gap report → learning plan
- [x] Resume file parsing (PDF/DOCX → text)
- [x] Market page: "SDE in Bengaluru" demand chart plus your top gaps
- [x] My skills page: candidate confirms or corrects levels (uses `overrides`); a quiz-based skill check comes later
- [ ] Evaluation set v1: 30 hand-labeled posting/resume pairs, plus a script that reports precision/recall
- [ ] Run `scripts/check_links.py` locally and fix any dead links

## Phase 2: accounts, data, live jobs
- [ ] Auth, user profiles, saved reports, delete-my-data
- [ ] Postgres (+ pgvector); store pre-analyzed postings
- [ ] Ingestion jobs: Greenhouse/Lever board list for India tech companies, Adzuna API, more ATS connectors
- [ ] Gap % shown in the job list; "jobs you're closest to"
- [ ] Taxonomy growth loop from `unmapped` phrases; ESCO/Lightcast ID mapping

## Phase 3: resume tuner ✅ (v0.2)
- [x] Interview chat that surfaces hidden skills and achievements (scripted from the gap report; Claude words questions when enabled)
- [x] Rewrite and reorder for a target posting, with no fabrication (re-extraction guardrail); diff view; inline edits
- [x] ATS-friendly DOCX export; PDF via the browser's print view

## Phase 4: prep kits and calendar
- [ ] Company/role prep kit: DSA plan, OA patterns, aptitude, culture questions, gap-closing project
- [ ] Calendar: applications, interviews, OA deadlines, hiring drives; reminders; Google Calendar sync / `.ics`

## Phase 5: employer side and colleges
- [ ] Employer dashboard with explained gaps, consented candidates only, human decisions
- [ ] College / placement-cell dashboard (batch readiness, common gaps)
- [ ] Compliance pass: consent flows, audit logs, bias checks
