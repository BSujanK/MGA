import copy
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.engine import prep
from app.engine.taxonomy import load_taxonomy
from app.routes import quiz

app = FastAPI()
app.include_router(quiz.router)
client = TestClient(app)

CORE = ["oop", "os", "dbms", "networking", "system_design", "sql"]


def _data():
    return quiz.load_quizzes()["quizzes"]


def _answers(topic, wrong=0):
    """Answer key from the data; the first `wrong` questions get a wrong option."""
    qs = next(q for q in _data() if q["topic"] == topic)["questions"]
    return {q["id"]: (q["answer"] + 1) % 4 if i < wrong else q["answer"] for i, q in enumerate(qs)}


def test_every_topic_has_a_quiz_of_six():
    topics = [q["topic"] for q in _data()]
    expected = [t["id"] for t in prep.load_prep()["dsa_topics"]] + CORE
    assert sorted(topics) == sorted(expected) and len(topics) == len(set(topics))
    assert all(len(q["questions"]) == 6 for q in _data())


def test_quizzes_are_well_formed():
    tax = load_taxonomy()
    ids = []
    for qz in _data():
        assert qz["skill_id"] in tax.skills
        assert qz["skill_id"] == ("dsa" if qz["topic"] not in CORE else qz["topic"])
        for q in qz["questions"]:
            ids.append(q["id"])
            assert q["id"].startswith(qz["topic"] + "-")
            assert len(q["options"]) == 4 and len(set(q["options"])) == 4
            assert 0 <= q["answer"] < 4
            assert q["question"].strip() and q["explain"].strip()
    assert len(ids) == len(set(ids))
    assert not re.search(r"https?://|www\.", str(quiz.load_quizzes()))


def test_validation_rejects_bad_data():
    good = quiz.load_quizzes()
    bad = copy.deepcopy(good)
    bad["quizzes"][0]["questions"][0]["options"].pop()
    with pytest.raises(AssertionError):
        quiz.validate_quizzes(bad)
    bad = copy.deepcopy(good)
    bad["quizzes"][0]["questions"][0]["answer"] = 4
    with pytest.raises(AssertionError):
        quiz.validate_quizzes(bad)
    bad = copy.deepcopy(good)
    bad["quizzes"][1]["questions"][0]["id"] = bad["quizzes"][0]["questions"][0]["id"]
    with pytest.raises(AssertionError):
        quiz.validate_quizzes(bad)


def test_list_quizzes():
    r = client.get("/quiz")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 20 and all(i["questions"] == 6 for i in items)
    assert {"topic", "name", "skill_id", "questions"} == set(items[0])
    assert next(i for i in items if i["topic"] == "sql")["skill_id"] == "sql"
    assert next(i for i in items if i["topic"] == "graphs")["skill_id"] == "dsa"


def test_get_quiz_hides_answers():
    r = client.get("/quiz/hashing")
    assert r.status_code == 200
    body = r.json()
    assert body["skill_id"] == "dsa" and len(body["questions"]) == 6
    for q in body["questions"]:
        assert set(q) == {"id", "question", "options"} and len(q["options"]) == 4
    text = r.text
    assert '"answer"' not in text and '"explain"' not in text


def test_grade_all_correct():
    r = client.post("/quiz/trees/grade", json={"answers": _answers("trees")})
    assert r.status_code == 200
    g = r.json()
    assert g["score"] == 6 and g["total"] == 6 and len(g["correct"]) == 6
    assert g["suggested_level"] == 3.0 and g["skill_id"] == "dsa"
    assert "self-check" in g["note"] and "not proof" in g["note"] and "My skills" in g["note"]
    assert all(x["correct"] and x["your_answer"] == x["answer"] and x["explain"] for x in g["review"])


def test_grade_partial_and_thresholds():
    expected = {0: 3.0, 1: 3.0, 2: 2.5, 3: 2.0, 4: None, 5: None, 6: None}
    for wrong, level in expected.items():
        g = client.post("/quiz/os/grade", json={"answers": _answers("os", wrong)}).json()
        assert g["score"] == 6 - wrong
        assert g["suggested_level"] == level, wrong
        assert g["skill_id"] == "os"
        assert "self-check" in g["note"]
    assert max(v for v in expected.values() if v) <= 3.0  # a self-check never raises a skill above "working"


def test_grade_partial_review_marks_wrong_answers():
    g = client.post("/quiz/dbms/grade", json={"answers": _answers("dbms", 2)}).json()
    assert len(g["correct"]) == 4
    wrong = [x for x in g["review"] if not x["correct"]]
    assert len(wrong) == 2 and all(x["your_answer"] != x["answer"] for x in wrong)


def test_grade_empty_answers():
    g = client.post("/quiz/sql/grade", json={"answers": {}}).json()
    assert g["score"] == 0 and g["total"] == 6 and g["correct"] == []
    assert g["suggested_level"] is None and "self-check" in g["note"]
    assert len(g["review"]) == 6 and all(x["your_answer"] is None and not x["correct"] for x in g["review"])


def test_unanswered_questions_count_as_wrong():
    answers = _answers("heaps")
    answers.pop("heaps-1")
    g = client.post("/quiz/heaps/grade", json={"answers": answers}).json()
    assert g["score"] == 5 and "heaps-1" not in g["correct"]


def test_unknown_topic_is_404():
    assert client.get("/quiz/nope").status_code == 404
    assert client.post("/quiz/nope/grade", json={"answers": {}}).status_code == 404


def test_bad_answers_are_422():
    assert client.post("/quiz/trees/grade", json={"answers": {"made-up-1": 0}}).status_code == 422
    assert client.post("/quiz/trees/grade", json={"answers": {"hashing-1": 0}}).status_code == 422  # other topic's id
    assert client.post("/quiz/trees/grade", json={"answers": {"trees-1": 4}}).status_code == 422
    assert client.post("/quiz/trees/grade", json={"answers": {"trees-1": -1}}).status_code == 422
    assert client.post("/quiz/trees/grade", json={"answers": {"trees-1": "x"}}).status_code == 422
