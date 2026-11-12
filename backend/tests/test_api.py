from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
RESUME = (Path(__file__).resolve().parent.parent / "samples" / "resume_fresher.txt").read_text()


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["llm_enabled"] is False


def test_jobs_search_and_get():
    jobs = client.get("/jobs", params={"role": "data analyst"}).json()
    assert jobs and all("analyst" in j["title"].lower() for j in jobs)
    assert client.get(f"/jobs/{jobs[0]['id']}").status_code == 200
    assert client.get("/jobs/nope").status_code == 404


def test_gap_by_job_id():
    r = client.post("/gap", json={"resume_text": RESUME, "job_id": "sde1-kestrel"})
    assert r.status_code == 200
    body = r.json()
    assert 0 <= body["summary"]["readiness"] <= 100
    open_gaps = [g for g in body["gaps"] if g["status"] != "strong"]
    assert open_gaps and all(g["job_evidence"] for g in open_gaps)
    assert any(g["resources"] for g in open_gaps)


def test_gap_with_text_and_overrides():
    r = client.post("/gap", json={"job_text": "Requirements\n- Strong Python\n- Docker",
                                  "overrides": [{"skill_id": "python", "level": 4}]})
    st = {g["skill_id"]: g["status"] for g in r.json()["gaps"]}
    assert st == {"python": "strong", "docker": "missing"}


def test_gap_validation():
    assert client.post("/gap", json={"job_id": "sde1-kestrel"}).status_code == 422
    assert client.post("/gap", json={"resume_text": "Python", "job_id": "nope"}).status_code == 404


def test_market():
    r = client.post("/market", json={"role": "sde", "resume_text": RESUME, "top": 10})
    body = r.json()
    assert body["postings_analyzed"] >= 3
    freqs = [s["frequency"] for s in body["skills"]]
    assert freqs == sorted(freqs, reverse=True)
    assert body["candidate_gaps"] and body["market_readiness"] is not None


def test_learn():
    res = client.get("/learn/docker").json()
    assert res and res[0]["url"].startswith("https://")
    assert client.get("/learn/unknown").status_code == 404
