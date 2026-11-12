import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app import ingest
from app.config import settings
from app.db import SessionLocal
from app.db.models import JobPostingRow
from app.jobs import store as store_mod
from app.jobs.store import get_store
from app.main import app

client = TestClient(app, headers={"X-Requested-With": "mga"})
RESUME = "Skills\nPython, SQL, Excel\nProjects\n- Built a Power BI dashboard with SQL for 3 stores"


def gh_payload(jobs):
    return {"jobs": [{"id": i, "title": t, "location": {"name": "Bengaluru"}, "absolute_url": f"https://example.com/{i}",
                      "updated_at": "2026-11-10T00:00:00Z", "content": c} for i, t, c in jobs]}


def mock(payload_by_path):
    def handler(request: httpx.Request) -> httpx.Response:
        for prefix, payload in payload_by_path.items():
            if request.url.path.startswith(prefix):
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={})
    return httpx.Client(transport=httpx.MockTransport(handler))


BACKEND = "&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Strong Java and Spring Boot&lt;/li&gt;&lt;li&gt;MySQL&lt;/li&gt;&lt;/ul&gt;"


def test_greenhouse_ingest_creates_updates_and_closes():
    first = mock({"/v1/boards/acmeco/jobs": gh_payload([(1, "Backend Engineer", BACKEND), (2, "Data Analyst", "Requirements: SQL and Excel")])})
    run = ingest.ingest_board("greenhouse", "acmeco", "Acme Co (fictional)", client=first)
    assert (run.fetched, run.created, run.updated, run.closed, run.error) == (2, 2, 0, 0, None)
    job = get_store().get("gh-acmeco-1")
    assert job.company == "Acme Co (fictional)" and "Strong Java" in job.description and "<" not in job.description
    prof = get_store().profile("gh-acmeco-1")
    assert {"java", "spring", "mysql"} <= {s.skill_id for s in prof.skills}

    second = mock({"/v1/boards/acmeco/jobs": gh_payload([(1, "Backend Engineer II", BACKEND)])})
    run = ingest.ingest_board("greenhouse", "acmeco", "Acme Co (fictional)", client=second)
    assert (run.created, run.updated, run.closed) == (0, 1, 1)
    ids = {j.id for j in get_store().search(q="acme", limit=None)}
    assert "gh-acmeco-1" in ids and "gh-acmeco-2" not in ids  # closed postings leave search

    same = ingest.ingest_board("greenhouse", "acmeco", "Acme Co (fictional)", client=second)
    assert (same.created, same.updated, same.closed) == (0, 0, 0)


def test_lever_ingest():
    payload = [{"id": "abc", "text": "QA Engineer", "categories": {"location": "Pune", "commitment": "Full-time"},
                "hostedUrl": "https://example.com/abc", "descriptionPlain": "Write Selenium tests in Java",
                "lists": [{"text": "Requirements", "content": "<li>Manual testing</li><li>SQL basics</li>"}]}]
    run = ingest.ingest_board("lever", "lotusqa", client=mock({"/v0/postings/lotusqa": payload}))
    assert run.created == 1 and not run.error
    j = get_store().get("lever-lotusqa-abc")
    assert j.employment_type == "Full-time" and "Manual testing" in j.description


def test_failed_board_is_recorded_not_raised():
    run = ingest.ingest_board("greenhouse", "missing-board", client=mock({}))
    assert run.error and "404" in run.error and run.fetched == 0


def test_adzuna(monkeypatch):
    payload = {"results": [{"id": "77", "title": "<strong>Data</strong> Analyst", "company": {"display_name": "Monsoon (fictional)"},
                            "location": {"display_name": "Mumbai"}, "redirect_url": "https://example.com/77",
                            "created": "2026-11-01T00:00:00Z", "description": "SQL, Excel and Power BI dashboards"}]}
    c = mock({"/v1/api/jobs/in/search/1": payload})
    run = ingest.ingest_adzuna("data analyst", "Mumbai", client=c)
    assert run.error and "ADZUNA_APP_ID" in run.error  # keys are required
    monkeypatch.setenv("ADZUNA_APP_ID", "id")
    monkeypatch.setenv("ADZUNA_APP_KEY", "key")
    settings.cache_clear()
    try:
        run = ingest.ingest_adzuna("data analyst", "Mumbai", client=c)
    finally:
        monkeypatch.undo()
        settings.cache_clear()
    assert run.created == 1 and not run.error
    j = get_store().get("adzuna-77")
    assert j.title == "Data Analyst" and j.source == "adzuna"


def test_stale_profiles_are_reanalyzed():
    with SessionLocal() as db:
        db.execute(update(JobPostingRow).where(JobPostingRow.id == "sde1-kestrel").values(profile_version="old"))
        db.commit()
    assert ingest.reanalyze() >= 1
    with SessionLocal() as db:
        assert db.get(JobPostingRow, "sde1-kestrel").profile_version == store_mod.engine_version()


def test_import_endpoint_needs_admin_token(monkeypatch):
    assert client.post("/jobs/import", params={"source": "greenhouse", "board": "x"}).status_code == 403
    monkeypatch.setenv("MGA_ADMIN_TOKEN", "s3cret")
    settings.cache_clear()
    monkeypatch.setattr(ingest, "ingest_board", lambda s, b, c=None: ingest.IngestRun(source=s, board=b, error=None))
    try:
        assert client.post("/jobs/import", params={"source": "greenhouse", "board": "x"},
                           headers={"X-Admin-Token": "wrong"}).status_code == 403
        assert client.post("/jobs/import", params={"source": "greenhouse", "board": "x"},
                           headers={"X-Admin-Token": "s3cret"}).status_code == 200
        assert client.post("/jobs/import", params={"source": "greenhouse", "board": "../etc"},
                           headers={"X-Admin-Token": "s3cret"}).status_code == 422
    finally:
        monkeypatch.undo()
        settings.cache_clear()


def test_jobs_fit_ranks_closest_first():
    r = client.post("/jobs/fit", json={"resume_text": RESUME, "limit": 50})
    assert r.status_code == 200
    body = r.json()
    scores = [f["readiness"] for f in body["jobs"]]
    assert scores == sorted(scores, reverse=True) and body["considered"] >= len(scores)
    top = body["jobs"][0]
    assert "analyst" in top["job"]["title"].lower() and "description" not in top["job"]
    analyst_only = client.post("/jobs/fit", json={"resume_text": RESUME, "role": "data analyst"}).json()["jobs"]
    assert analyst_only and all("analyst" in f["job"]["title"].lower() for f in analyst_only)
    assert client.post("/jobs/fit", json={}).status_code == 422


def test_jobs_fit_uses_saved_profile_when_signed_in():
    c = TestClient(app, headers={"X-Requested-With": "mga"})
    email = "fit-user@example.com"
    code = c.post("/auth/code", json={"email": email}).json()["dev_code"]
    c.post("/auth/verify", json={"email": email, "code": code, "accept_terms": True})
    c.put("/me/profile", json={"resume_text": RESUME})
    body = c.post("/jobs/fit", json={"limit": 5}).json()
    assert body["used_saved_profile"] and body["jobs"]


def test_market_sees_new_postings(monkeypatch):
    monkeypatch.setattr(store_mod, "VERSION_TTL", 0.0)
    before = client.post("/market", json={"role": "data analyst"}).json()["postings_analyzed"]
    payload = gh_payload([(9, "Data Analyst Intern", "Requirements: SQL, Tableau")])
    ingest.ingest_board("greenhouse", "newco", client=mock({"/v1/boards/newco/jobs": payload}))
    after = client.post("/market", json={"role": "data analyst"}).json()["postings_analyzed"]
    assert after == before + 1
