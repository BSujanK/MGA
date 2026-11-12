"""Self-check quizzes: original multiple-choice questions per DSA topic and core subject.

A quiz is a self-check, not proof. Grading never writes user data; the frontend may
offer the suggested level as a correction in My skills, and only if the candidate chooses.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine.taxonomy import DATA_DIR

router = APIRouter(prefix="/quiz", tags=["quiz"])

MAX_SUGGESTED = 3.0
NOTE = ("This is a self-check, not proof of skill. The suggested level only becomes a correction in My skills "
        "if you choose to apply it.")
NOTE_NONE = ("This is a self-check, not proof of skill. A score this low gives no level suggestion; "
             "revise the topic and try again.")


# ---------- data ----------

def validate_quizzes(doc: dict) -> None:
    """Fail loudly on malformed quiz data."""
    seen_topics: set[str] = set()
    seen_ids: set[str] = set()
    for quiz in doc["quizzes"]:
        topic = quiz["topic"]
        assert topic not in seen_topics, f"duplicate quiz topic {topic}"
        seen_topics.add(topic)
        assert quiz["questions"], f"quiz {topic} has no questions"
        for q in quiz["questions"]:
            qid = q["id"]
            assert qid not in seen_ids, f"duplicate question id {qid}"
            seen_ids.add(qid)
            assert isinstance(q["question"], str) and q["question"].strip(), f"{qid}: empty question"
            assert len(q["options"]) == 4, f"{qid}: needs exactly 4 options"
            assert len(set(q["options"])) == 4, f"{qid}: options must be distinct"
            assert isinstance(q["answer"], int) and 0 <= q["answer"] < 4, f"{qid}: answer out of range"
            assert q["explain"].strip(), f"{qid}: missing explanation"
        assert re.fullmatch(r"[a-z0-9_]+", quiz["skill_id"]), f"{topic}: bad skill id"


@lru_cache(maxsize=1)
def load_quizzes() -> dict:
    doc = json.loads((DATA_DIR / "quizzes.json").read_text())
    validate_quizzes(doc)
    return doc


def _quiz(topic: str) -> dict:
    quiz = next((q for q in load_quizzes()["quizzes"] if q["topic"] == topic), None)
    if quiz is None:
        raise HTTPException(404, f"No quiz for topic '{topic}'")
    return quiz


load_quizzes()  # validate at import time


def suggested_level(score: int, total: int) -> Optional[float]:
    """Self-check cap: never above 3 (working), and only from a near-perfect score."""
    if total <= 0:
        return None
    ratio = score / total
    if ratio >= 5 / 6:
        return 3.0
    if ratio >= 4 / 6:
        return 2.5
    if ratio >= 3 / 6:
        return 2.0
    return None


# ---------- schemas ----------

class QuizSummary(BaseModel):
    topic: str
    name: str
    skill_id: str
    questions: int


class QuestionOut(BaseModel):
    id: str
    question: str
    options: list[str]


class QuizOut(BaseModel):
    topic: str
    name: str
    skill_id: str
    questions: list[QuestionOut]


class GradeIn(BaseModel):
    answers: dict[str, int] = Field(default={}, description="question id -> chosen option index")


class ReviewItem(BaseModel):
    id: str
    question: str
    options: list[str]
    your_answer: Optional[int] = None
    answer: int
    correct: bool
    explain: str


class GradeOut(BaseModel):
    topic: str
    score: int
    total: int
    correct: list[str]
    review: list[ReviewItem]
    suggested_level: Optional[float] = None
    skill_id: str
    note: str


# ---------- routes ----------

@router.get("", response_model=list[QuizSummary])
def list_quizzes():
    return [QuizSummary(topic=q["topic"], name=q["name"], skill_id=q["skill_id"], questions=len(q["questions"]))
            for q in load_quizzes()["quizzes"]]


@router.get("/{topic}", response_model=QuizOut)
def get_quiz(topic: str):
    quiz = _quiz(topic)
    return QuizOut(topic=topic, name=quiz["name"], skill_id=quiz["skill_id"],
                   questions=[QuestionOut(id=q["id"], question=q["question"], options=q["options"]) for q in quiz["questions"]])


@router.post("/{topic}/grade", response_model=GradeOut)
def grade_quiz(topic: str, body: GradeIn):
    quiz = _quiz(topic)
    by_id = {q["id"]: q for q in quiz["questions"]}
    unknown = sorted(set(body.answers) - set(by_id))
    if unknown:
        raise HTTPException(422, f"Unknown question ids for '{topic}': {', '.join(unknown[:5])}")
    bad = sorted(qid for qid, a in body.answers.items() if not 0 <= a < len(by_id[qid]["options"]))
    if bad:
        raise HTTPException(422, f"Answer index out of range for: {', '.join(bad[:5])}")
    review, correct = [], []
    for q in quiz["questions"]:
        mine = body.answers.get(q["id"])
        ok = mine == q["answer"]
        if ok:
            correct.append(q["id"])
        review.append(ReviewItem(id=q["id"], question=q["question"], options=q["options"], your_answer=mine,
                                 answer=q["answer"], correct=ok, explain=q["explain"]))
    total = len(quiz["questions"])
    level = suggested_level(len(correct), total)
    return GradeOut(topic=topic, score=len(correct), total=total, correct=correct, review=review,
                    suggested_level=level, skill_id=quiz["skill_id"], note=NOTE if level is not None else NOTE_NONE)
