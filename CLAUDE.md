# Working on MGA

MGA is a startup product, built by the founder with Claude. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` before changing code. Take the next unchecked item in the roadmap unless the founder asks for something else.

## Layout
- `backend/`: FastAPI + engine (Python). Run tests with `cd backend && python -m pytest -q`; score accuracy with `python -m eval.run` (see `backend/eval/README.md`).
- `frontend/`: Next.js web app. Check with `npm run build` and `npx eslint src`.
- `docs/`: product, architecture, API, roadmap. Update them when behavior changes.

## Product rules (non-negotiable)
1. **No verdicts.** Report gaps per skill with evidence; never "not eligible".
2. **Never fabricate.** No invented skills or experience in resumes, no invented URLs in learning plans (only `resources.json`), no invented "company X asks this" claims without a source.
3. **Works without AI.** Rules-only mode must always run. Every Claude call needs a fallback.
4. **Legal data only.** Job postings come from public ATS boards, partner APIs or employers. Never scrape sites whose terms forbid it.
5. **Privacy.** Resumes are personal data. No real personal data in the repo; samples stay synthetic.

## Engineering rules
- Keep the engine deterministic and explainable; AI output is normalized onto the taxonomy.
- Add or update tests for every engine change. Accuracy is the product.
- Secrets come from env (`ANTHROPIC_API_KEY`); `.env` is gitignored.
- Commit messages: short imperative summary of what changed.
