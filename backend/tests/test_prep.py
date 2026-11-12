import re
from pathlib import Path

from fastapi.testclient import TestClient

from app import llm
from app.engine import prep
from app.main import app
from app.models import AptitudeArea, CoreSubject, DSAPlan, PrepTopic

client = TestClient(app)
RESUME = (Path(__file__).resolve().parent.parent / "samples" / "resume_fresher.txt").read_text()


def _kit(**body):
    r = client.post("/prep", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_sde_kit_has_every_part():
    k = _kit(resume_text=RESUME, job_id="sde1-kestrel")
    assert k["job_title"] and k["company"] == "Kestrel Pay" and k["mode"] == "rules"
    assert k["dsa"]["included"] and k["dsa"]["topics"] and k["dsa"]["resources"]
    assert {c["skill_id"] for c in k["core"]} >= {"os", "dbms", "oop"}
    assert all(c["topics"] for c in k["core"])
    relevant = [f["id"] for f in k["oa_formats"] if f["relevant"]]
    assert relevant[:2] == ["coding", "cs_mcq"] and "sql" in relevant
    assert k["behavioral"] and all(q["source"] == "bank" for q in k["behavioral"])
    assert k["projects"] and k["projects"][0]["covers"]
    assert k["schedule"] and all(w["hours"] <= k["hours_per_week"] + 0.01 for w in k["schedule"])


def test_dsa_plan_matches_candidate_level():
    k = _kit(resume_text=RESUME, job_id="sde1-kestrel")
    topics = {t["id"]: t for t in k["dsa"]["topics"]}
    assert topics["arrays_strings"]["review"]          # 400+ problems solved: basics are review
    assert not topics["graphs"]["review"]
    beginner = _kit(job_id="sde1-kestrel")["dsa"]["topics"]
    assert not any(t["review"] for t in beginner)


def test_data_role_gets_light_dsa_and_sql():
    k = _kit(job_id="da-saffron")
    assert {t["id"] for t in k["dsa"]["topics"]} <= {t["id"] for t in prep.load_prep()["dsa_topics"] if t["tier"] == 1}
    assert any(c["skill_id"] == "sql" for c in k["core"])
    assert k["projects"][0]["id"] == "sales_dashboard"


def test_role_without_programming_skips_dsa():
    k = _kit(job_text="Requirements\n- Docker and Kubernetes\n- Linux administration\n- CI/CD pipelines")
    assert not k["dsa"]["included"] and not k["dsa"]["topics"]
    assert not any(i["kind"] == "dsa" for w in k["schedule"] for i in w["items"])
    assert k["projects"][0]["id"] == "k8s_deploy"


def test_company_questions_quote_the_posting():
    posting = client.get("/jobs/sde1-kestrel").json()["description"]
    k = _kit(resume_text=RESUME, job_id="sde1-kestrel")
    qs = k["company_questions"]
    assert qs and all(q["source"] == "posting" and prep.grounded(q["quote"], posting) for q in qs)
    assert len({q["quote"] for q in qs}) == len(qs)  # one question per quoted line
    assert any(q["theme"] == "Company" for q in qs)


def test_ai_questions_must_be_grounded(monkeypatch, llm_on):
    def no_extract(text):
        raise llm.LLMUnavailable("off")

    def fake(text):
        return llm.LLMPrepQuestions(questions=[
            llm.LLMPrepQuestion(question="How would you make a payment API idempotent?", theme="Role",
                                quote="Kestrel Pay builds UPI payment infrastructure"),
            llm.LLMPrepQuestion(question="Kestrel Pay always asks about Kafka internals. Explain them.", theme="Kafka",
                                quote="Kestrel Pay is known for asking Kafka questions"),
        ])
    monkeypatch.setattr(llm, "extract_job", no_extract)
    monkeypatch.setattr(llm, "extract_resume", no_extract)
    monkeypatch.setattr(llm, "prep_questions", fake)
    k = _kit(resume_text=RESUME, job_id="sde1-kestrel", use_llm=True)
    ai = [q for q in k["company_questions"] if q["source"] == "ai"]
    assert k["mode"] == "claude" and len(ai) == 1 and "idempotent" in ai[0]["question"]


def test_ai_questions_fall_back(monkeypatch, llm_on):
    def down(text):
        raise llm.LLMUnavailable("down")
    for name in ("extract_job", "extract_resume", "prep_questions"):
        monkeypatch.setattr(llm, name, down)
    k = _kit(resume_text=RESUME, job_id="sde1-kestrel", use_llm=True)
    assert k["mode"] == "rules" and k["company_questions"]


def test_aptitude_scheduled_only_when_posting_mentions_it():
    plain = _kit(job_text="Requirements\n- Java\n- Data structures and algorithms")
    assert not any(i["kind"] == "aptitude" for w in plain["schedule"] for i in w["items"])
    assert "doesn't mention it" in plain["aptitude_note"]
    apt = _kit(job_text="Requirements\n- Java\n- Data structures and algorithms\nSelection process\n- Online aptitude test, then two interviews")
    assert any(i["kind"] == "aptitude" for w in apt["schedule"] for i in w["items"])
    assert any("aptitude" in line.lower() for line in apt["posting_process"])


def test_schedule_splits_long_items_and_conserves_hours():
    dsa = DSAPlan(included=True, reason="", topics=[PrepTopic(id="dp", name="DP", hours=14), PrepTopic(id="g", name="Graphs", hours=3)])
    core = [CoreSubject(skill_id="os", name="OS", required_level=3, candidate_level=0, hours=5, topics=["x"])]
    weeks = prep.schedule(dsa, core, [AptitudeArea(area="Quant", hours=2, topics=["x"])], None, hours_per_week=6)
    items = [i for w in weeks for i in w.items]
    assert abs(sum(i.hours for i in items) - 24) < 0.01
    assert all(w.hours <= 6.01 for w in weeks)
    dp = [i.title for i in items if i.ref == "dp"]
    assert len(dp) > 1 and dp[0].endswith(f"(part 1 of {len(dp)})")
    assert prep.schedule(DSAPlan(included=False, reason=""), [], [], None, 10) == []


def test_prep_validation():
    assert client.post("/prep", json={}).status_code == 422
    assert client.post("/prep", json={"job_id": "nope"}).status_code == 404
    assert client.post("/prep", json={"job_id": "sde1-kestrel", "hours_per_week": 0}).status_code == 422


def test_prep_content_is_consistent():
    from app.engine.taxonomy import load_taxonomy
    data, tax = prep.load_prep(), load_taxonomy()
    assert all(s in tax.skills for p in data["projects"] for s in p["skills"])
    assert set(data["core_subjects"]) == set(prep.CORE_IDS)
    assert not re.search(r"https?://|www\.", str(data))  # links only come from resources.json
