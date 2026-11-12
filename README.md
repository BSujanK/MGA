# MGA: Market Gap Analysis

MGA shows job seekers exactly where they stand, skill by skill, against a specific job and against the whole job market for a role. Then it helps them close the gap.

No "you're not eligible". For every skill a job asks for, MGA says whether you're **strong**, **partial**, **transferable** (a related skill gets you part of the way) or **missing**. It shows the evidence from the posting and your resume, how many hours closing it should take, and where to learn it.

First market: early-career tech candidates in India. Web first.

- Product spec: [docs/PRODUCT.md](docs/PRODUCT.md)
- How the engine works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- API: [docs/API.md](docs/API.md)
- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)

## Run the backend

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://localhost:8000/docs.

Try a gap report against a sample posting:

```bash
curl -s localhost:8000/gap -H 'content-type: application/json' \
  -d "{\"resume_text\": $(python3 -c 'import json;print(json.dumps(open("samples/resume_fresher.txt").read()))'), \"job_id\": \"sde1-kestrel\"}"
```

**AI extraction is optional.** Set `ANTHROPIC_API_KEY` (see `backend/.env.example`) to let Claude read postings and resumes with more context. Without a key, the rule engine runs alone and everything still works.

## Test

```bash
cd backend && python -m pytest -q
```

## Status

v0.1 is the core engine and API, with sample data. The web app is next. See the [roadmap](docs/ROADMAP.md).
