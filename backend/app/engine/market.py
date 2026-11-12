"""Market view: aggregate skill demand across many postings for a role.

This is what a single chat with an AI can't do: it answers "across every
SDE-1 posting we track, which skills show up, how often, and at what level?"
and then ranks the candidate's gaps by how much of the market each one unlocks.
"""
from __future__ import annotations

from collections import defaultdict

from ..models import (
    CandidateProfile, GapStatus, Importance, JobProfile, JobSkill, MarketReport, MarketSkill,
)
from .gap import compute_gap
from .taxonomy import Taxonomy


def aggregate(profiles: list[JobProfile], tax: Taxonomy) -> list[MarketSkill]:
    n = len(profiles)
    if n == 0:
        return []
    stats: dict[str, dict] = defaultdict(lambda: {"count": 0, "must": 0, "levels": []})
    for p in profiles:
        for s in p.skills:
            st = stats[s.skill_id]
            st["count"] += 1
            st["must"] += s.importance is Importance.must
            st["levels"].append(s.required_level)
    out = []
    for sid, st in stats.items():
        sk = tax.get(sid)
        out.append(MarketSkill(
            skill_id=sid, name=sk.name, category=sk.category,
            frequency=round(st["count"] / n, 3), must_rate=round(st["must"] / st["count"], 3),
            avg_required_level=round(sum(st["levels"]) / len(st["levels"]), 2), postings=st["count"],
        ))
    out.sort(key=lambda m: (-m.frequency, -m.must_rate, m.name))
    return out


def market_job_profile(skills: list[MarketSkill], min_frequency: float = 0.15) -> JobProfile:
    """Turn market demand into one synthetic 'typical posting' for gap scoring.

    Weight is frequency: a skill in 80% of postings matters four times more
    than one in 20%. Skills most postings mark must-have stay must-have.
    """
    js = [
        JobSkill(
            skill_id=m.skill_id, name=m.name, category=m.category,
            importance=Importance.must if m.must_rate >= 0.5 else Importance.nice,
            required_level=m.avg_required_level, weight=round(m.frequency * (1.0 if m.must_rate >= 0.5 else 0.6), 3),
        )
        for m in skills if m.frequency >= min_frequency
    ]
    return JobProfile(title="Market composite", skills=js, extractor="market")


def build_report(
    role: str, location: str | None, profiles: list[JobProfile], tax: Taxonomy,
    candidate: CandidateProfile | None = None, top: int = 25,
) -> MarketReport:
    skills = aggregate(profiles, tax)
    report = MarketReport(role=role, location=location, postings_analyzed=len(profiles), skills=skills[:top])
    if candidate is not None and skills:
        freq = {m.skill_id: m.frequency for m in skills}
        gap = compute_gap(market_job_profile(skills), candidate, tax, market_freq=freq)
        report.candidate_gaps = [g for g in gap.gaps if g.status is not GapStatus.strong][:top]
        report.market_readiness = gap.summary.readiness
    return report
