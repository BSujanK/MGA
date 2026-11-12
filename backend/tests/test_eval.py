"""The evaluation set guards accuracy: rules-only numbers may not drop below eval/baseline.json."""
import json

import pytest

from app.engine.taxonomy import load_taxonomy
from eval.run import BASELINE, evaluate, headline, load_cases

TOLERANCE = 0.005


@pytest.fixture(scope="module")
def report():
    return evaluate(use_llm=False)


def test_cases_are_well_formed():
    tax = load_taxonomy()
    postings, resumes, pairs = load_cases()
    assert len(pairs) >= 30
    for d in postings.values():
        assert "(fictional)" in d["company"]
        for sid, lab in d["skills"].items():
            assert sid in tax.skills and lab["importance"] in ("must", "nice") and 1 <= lab["level"] <= 5
            assert all(a in d["skills"] for a in lab.get("alts", [])), f"{d['id']}: alt of {sid} not labeled"
    for d in resumes.values():
        assert "(synthetic" in d["text"].splitlines()[0]  # never real personal data
        assert all(sid in tax.skills and 0 < lvl <= 5 for sid, lvl in d["skills"].items())
    for p in pairs:
        assert p["resume"] in resumes and p["posting"] in postings


def test_no_regression_against_baseline(report):
    base = json.loads(BASELINE.read_text())
    now = headline(report)
    drops = {k: (base[k], now[k]) for k in base if now[k] is not None and now[k] < base[k] - TOLERANCE}
    assert not drops, f"Eval numbers dropped (baseline, now): {drops}. Fix the regression or justify and re-run --write-baseline."
