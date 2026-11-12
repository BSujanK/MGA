import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import llm, tuner
from app.engine import resume_doc as rd
from app.engine.taxonomy import load_taxonomy
from app.main import app
from app.models import ChatTurn

client = TestClient(app)
TAX = load_taxonomy()
RESUME = (Path(__file__).resolve().parent.parent / "samples" / "resume_fresher.txt").read_text()


# ---------- structure ----------

def test_parse_resume_sections_and_entries():
    header, sections = rd.parse_resume(RESUME)
    assert header[0].startswith("Aarav Sharma")
    keys = [s.key for s in sections]
    assert keys == ["summary", "skills", "projects", "experience", "certifications", "achievements"]
    exp = sections[3]
    assert exp.entries[0].heading[0].text.startswith("Web Development Intern")
    assert len(exp.entries[0].bullets) == 2  # bullets stay under their role
    assert all(len(e.bullets) == 1 and not e.heading for e in sections[2].entries)  # headless project bullets


def test_parse_short_line_under_title_joins_heading():
    _, sections = rd.parse_resume("Experience\nSDE Intern, Acme\nJun 2025 - Aug 2025\n- Built a REST API in Flask")
    e = sections[0].entries[0]
    assert [h.text for h in e.heading] == ["SDE Intern, Acme", "Jun 2025 - Aug 2025"]
    assert [b.text for b in e.bullets] == ["Built a REST API in Flask"]


def test_reorder_skill_line_puts_job_skills_first():
    out = rd.reorder_skill_line("Languages: C, Python, Java, JavaScript", {"java": 1.0, "python": 0.4}, TAX)
    assert out == "Languages: Java, Python, C, JavaScript"
    assert rd.reorder_skill_line("Git", {"git": 1.0}, TAX) == "Git"


def test_tailor_sections_keeps_role_order_but_moves_projects():
    _, sections = rd.parse_resume(RESUME)
    job = client.post("/analyze/job", json={"text": "Requirements\n- Java and Spring Boot\n- MySQL"}).json()
    from app.models import JobProfile
    out = rd.tailor_sections(sections, JobProfile(**job), TAX)
    projects = next(s for s in out if s.key == "projects")
    assert "Spring Boot" in projects.entries[0].bullets[0].text
    assert projects.entries[0].relevance >= projects.entries[-1].relevance
    # every original line is still there, none invented
    assert sorted(ln.text for ln in rd.all_lines(sections) if "Languages" not in ln.text) == \
        sorted(ln.text for ln in rd.all_lines(out) if "Languages" not in ln.text)


# ---------- guardrail ----------

SRC = "Implemented responsive pages in React and CSS for 3 client websites"


@pytest.mark.parametrize("new,ok", [
    ("Built responsive React and CSS pages for three client websites", True),
    ("Built responsive React pages in JavaScript and CSS for 3 client websites", True),   # implied by React
    ("Built responsive React pages with TypeScript and CSS for 3 client websites", False),  # new skill
    ("Built responsive React and CSS pages for 5 client websites", False),                # new number
    ("Built React and CSS pages for 3 client websites, improving load time by 40%", False),
    ("", False),
])
def test_check_rewrite(new, ok):
    assert (rd.check_rewrite(SRC, new, TAX) is None) is ok


def test_keyword_coverage_counts_alternatives():
    from app.models import JobProfile
    job = JobProfile(**client.post("/analyze/job", json={"text": "Requirements\n- SQL (MySQL or PostgreSQL)\n- Docker"}).json())
    cov, matched = rd.keyword_coverage("Used MySQL daily", job, TAX)
    assert "mysql" in matched and "docker" not in matched and 0 < cov < 100


# ---------- interview ----------

def _chat(turns, **kw):
    r = client.post("/resume/chat", json={"resume_text": RESUME, "job_id": "sde1-kestrel", "turns": turns, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _turn(q, answer):
    return {"question_id": q["id"], "skill_id": q["skill_id"], "question": q["question"], "answer": answer}


def test_chat_asks_about_must_have_gaps_first_with_reason():
    first = _chat([])
    q = first["question"]
    assert first["mode"] == "scripted" and not first["done"]
    assert q["kind"] == "gap" and q["status"] in ("missing", "partial", "transferable")
    assert q["skill_name"] in q["why"]
    assert any(w in q["why"] for w in ("no evidence", "level", "partial credit"))


def test_chat_negative_answer_moves_on_and_affirmative_gets_followup():
    q1 = _chat([])["question"]
    nxt = _chat([_turn(q1, "No, only studied it in class")])["question"]
    assert nxt["id"] != q1["id"] and not nxt["id"].endswith(":more")

    fu = _chat([_turn(q1, "Yes, a little")])["question"]
    assert fu["id"] == q1["id"] + ":more" and fu["kind"] == "followup"

    detailed = "Yes, I implemented a process scheduler simulator in C for my OS lab with 4 algorithms"
    after = _chat([_turn(q1, detailed)])["question"]
    assert not after["id"].endswith(":more")  # has a verb and a number: no follow-up needed


def test_chat_finishes_with_general_questions_and_reports_findings():
    turns, seen = [], []
    for _ in range(20):
        r = _chat(turns, max_questions=4)
        if r["done"]:
            break
        q = r["question"]
        seen.append(q["id"])
        ans = "I built a Flask API and deployed it with Docker for 200 users" if q["id"] == "gen:hidden" else ""
        turns.append(_turn(q, ans))
    assert r["done"] and r["planned"] == 4
    assert seen[-1] == "gen:hidden" or "gen:impact" in seen
    found = {f["skill_id"]: f for f in r["findings"]}
    if "gen:hidden" in seen:
        assert found["docker"]["level"] == 3.0 and "flask" in found


def test_chat_validation():
    assert client.post("/resume/chat", json={"job_id": "sde1-kestrel"}).status_code == 422
    assert client.post("/resume/chat", json={"resume_text": RESUME, "job_id": "nope"}).status_code == 404


def test_findings_ignore_negated_skills():
    turns = [ChatTurn(question_id="gen:hidden", question="?", answer="Built a Flask app, but never used Kubernetes")]
    ids = {f.skill_id for f in tuner.findings(turns)}
    assert "flask" in ids and "kubernetes" not in ids
    assert tuner.findings([ChatTurn(question_id="gap:docker", skill_id="docker", question="?", answer="Not yet")]) == []


def test_followup_merges_into_one_finding_and_bullet():
    turns = [
        ChatTurn(question_id="gap:docker", skill_id="docker", question="?", answer="Yes, I containerized our hackathon app"),
        ChatTurn(question_id="gap:docker:more", skill_id="docker", question="?", answer="Setup time went from 2 hours to 10 minutes"),
    ]
    f = tuner.findings(turns)
    assert [x.skill_id for x in f] == ["docker"] and f[0].level == 3.0
    sec = tuner._answer_section(turns)
    assert len(sec.entries) == 1 and "10 minutes" in sec.entries[0].bullets[0].text


@pytest.mark.parametrize("answer,bullet", [
    ("Yes, I built a Flask API for our club.", "Built a Flask API for our club"),
    ("yeah sure, I've deployed it on AWS", "Deployed it on AWS"),
    ("I was the tech lead of the coding club", "I was the tech lead of the coding club"),
])
def test_to_bullet(answer, bullet):
    assert tuner.to_bullet(answer) == bullet


# ---------- tailoring ----------

def test_tailor_never_adds_skills_without_evidence():
    turns = [{"question_id": "gap:docker", "skill_id": "docker", "question": "Docker?",
              "answer": "Yes, I used Docker to containerize the Flask backend of my hackathon project"},
             {"question_id": "gap:os", "skill_id": "os", "question": "OS?", "answer": "No"}]
    r = client.post("/resume/tailor", json={"resume_text": RESUME, "job_id": "sde1-kestrel", "turns": turns})
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["mode"] == "rules"
    answers_text = " ".join(x["answer"] for x in turns)
    allowed = rd.implied_closure(rd.skill_ids(RESUME, TAX) | rd.skill_ids(answers_text, TAX), TAX)
    assert rd.skill_ids(t["text"], TAX) <= allowed
    assert "Docker" in t["keywords_matched"]
    missing = {k["skill_id"] for k in t["keywords_missing"]}
    assert "os" in missing and "docker" not in missing
    assert t["coverage_after"] >= t["coverage_before"]
    answers = next(s for s in t["sections"] if s["key"] == "answers")
    assert answers["entries"][0]["bullets"][0]["source"] == "answer"


def test_tailor_adds_implied_keyword_with_reason():
    resume = "Projects\n- Built a todo app with React and MySQL"
    t = client.post("/resume/tailor", json={"resume_text": resume, "job_text": "Requirements\n- SQL\n- JavaScript\n- Docker"}).json()
    assert {"SQL", "JavaScript"} <= set(t["keywords_matched"])
    assert any("SQL" in n and "MySQL" in n for n in t["notes"])
    assert [k["name"] for k in t["keywords_missing"]] == ["Docker"]


def test_tailor_validation():
    assert client.post("/resume/tailor", json={"resume_text": RESUME}).status_code == 422
    assert client.post("/resume/tailor", json={"resume_text": RESUME, "job_id": "nope"}).status_code == 404


def _fake_claude(monkeypatch, rewrite):
    from app import limits
    from app.config import Settings
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(limits, "settings", lambda: Settings(llm_public=True))
    def no_extract(text):
        raise llm.LLMUnavailable("off in tests")
    monkeypatch.setattr(llm, "extract_job", no_extract)
    monkeypatch.setattr(llm, "extract_resume", no_extract)
    monkeypatch.setattr(llm, "rewrite_lines", rewrite)


def test_tailor_with_claude_keeps_only_safe_rewrites(monkeypatch):
    _, sections = rd.parse_resume(RESUME)
    ids = {ln.text: ln.id for ln in rd.all_lines(sections)}
    intern = ids["Implemented responsive pages in React and CSS for 3 client websites"]
    api_line = ids["Integrated REST APIs and fixed bugs reported by QA"]
    expense = ids["Expense Tracker: developed a REST API in Java with Spring Boot and MySQL, wrote JUnit tests"]
    canteen = [v for k, v in ids.items() if k.startswith("Campus Canteen")][0]

    def rewrite(payload):
        return llm.LLMRewrite(lines=[
            llm.LLMRewrittenLine(id=intern, text="Built responsive React and CSS pages for 3 client websites"),
            llm.LLMRewrittenLine(id=api_line, text="Integrated REST APIs on Kubernetes and fixed QA bugs"),
            llm.LLMRewrittenLine(id=canteen, text="Built a React + Node.js food-ordering app used by 3000 students"),
            llm.LLMRewrittenLine(id=expense, text="Developed an expense tracker with JUnit tests"),
            llm.LLMRewrittenLine(id="s99e0b0", text="Led a team of 10"),
        ])

    _fake_claude(monkeypatch, rewrite)
    t = client.post("/resume/tailor", json={"resume_text": RESUME, "job_id": "sde1-kestrel", "use_llm": True}).json()
    assert t["mode"] == "claude"
    lines = {ln["id"]: ln for s in t["sections"] for e in s["entries"] for ln in e["heading"] + e["bullets"]}
    assert lines[intern]["text"].startswith("Built responsive") and lines[intern]["original"].startswith("Implemented")
    assert lines[api_line]["original"] is None and "Kubernetes" not in t["text"]
    assert "3000" not in t["text"]
    assert lines[expense]["original"] is None  # dropped Java / Spring Boot / MySQL, which the job asks for
    actions = {(g["line_id"], g["action"]) for g in t["guardrail"]}
    assert {(api_line, "reverted"), (canteen, "reverted"), (expense, "reverted"), ("s99e0b0", "dropped")} <= actions


def test_tailor_falls_back_when_claude_fails(monkeypatch):
    def broken(payload):
        raise llm.LLMUnavailable("down")
    _fake_claude(monkeypatch, broken)
    t = client.post("/resume/tailor", json={"resume_text": RESUME, "job_id": "sde1-kestrel", "use_llm": True}).json()
    assert t["mode"] == "rules" and any("unavailable" in n for n in t["notes"])


def test_chat_question_falls_back_to_script(monkeypatch):
    def broken(ctx):
        raise llm.LLMUnavailable("down")
    _fake_claude(monkeypatch, broken)
    monkeypatch.setattr(llm, "phrase_question", broken)
    r = client.post("/resume/chat", json={"resume_text": RESUME, "job_id": "sde1-kestrel", "use_llm": True}).json()
    assert r["mode"] == "scripted" and r["question"]["question"]


# ---------- export ----------

def test_export_docx_is_plain_and_complete():
    import docx

    t = client.post("/resume/tailor", json={"resume_text": RESUME, "job_id": "sde1-kestrel"}).json()
    r = client.post("/resume/export/docx", json={"header": t["header"], "sections": t["sections"], "filename": "../My Resume"})
    assert r.status_code == 200
    assert r.headers["content-disposition"] == 'attachment; filename="My_Resume.docx"'
    d = docx.Document(io.BytesIO(r.content))
    text = "\n".join(p.text for p in d.paragraphs)
    assert "PROJECTS" in text and "Smart India Hackathon 2025 finalist" in text
    assert not d.tables and not d.inline_shapes
    assert any(p.style.name == "List Bullet" for p in d.paragraphs)


@pytest.mark.parametrize("answer,level", [
    ("I used Docker in my hackathon project", 3.0),
    ("I followed a Docker tutorial", 2.0),
    ("Learned it in a course and used it for the course assignment", 2.0),
])
def test_answer_level_separates_learning_from_use(answer, level):
    f = tuner.findings([ChatTurn(question_id="gap:docker", skill_id="docker", question="?", answer=answer)])
    assert f and f[0].level == level


@pytest.mark.parametrize("answer", ["Only heard of it", "Not really", "nope", "I haven't", "skip", ""])
def test_negative_answers_add_nothing(answer):
    assert tuner.findings([ChatTurn(question_id="gap:docker", skill_id="docker", question="?", answer=answer)]) == []


def test_partial_question_names_where_the_skill_appears():
    from app.models import Evidence, GapStatus, Importance, SkillGap
    g = SkillGap(skill_id="dbms", name="DBMS Concepts", category="cs_fundamentals", importance=Importance.must,
                 required_level=3.5, candidate_level=2, effective_level=2, gap=1.5, status=GapStatus.partial,
                 est_hours=10, candidate_evidence=[Evidence(text="NPTEL: DBMS", section="certifications")])
    q, _ = tuner._gap_question(g, TAX)
    assert "only in your certifications" in q


def test_added_keywords_line_stays_last_in_skills():
    t = client.post("/resume/tailor", json={"resume_text": RESUME, "job_id": "sde1-kestrel"}).json()
    skills = next(s for s in t["sections"] if s["key"] == "skills")
    assert skills["entries"][-1]["heading"][0]["source"] == "added"
