"""Gap scoring: compare a candidate profile with a job profile, skill by skill.

For every skill the job asks for, the report says how far the candidate is
from the required level, why (evidence from both sides), how long closing it
should take, and where to learn it. There is no pass/fail verdict.
"""
from __future__ import annotations

from ..models import (
    CandidateProfile, GapReport, GapStatus, GapSummary, Importance, JobProfile, SkillGap,
)
from .taxonomy import Taxonomy

MIN_TRANSFER = 0.5  # transfer credit below half a level is noise
PRIORITY_BOOST = {GapStatus.missing: 1.0, GapStatus.transferable: 0.8, GapStatus.partial: 0.6, GapStatus.strong: 0.0}


def _transfer(skill_id: str, levels: dict[str, float], tax: Taxonomy) -> tuple[float, str | None]:
    """Best partial credit from a related skill the candidate has.

    Relations are read both ways (React -> Next.js and Next.js -> React), and
    credit is capped at level 3 so a related skill can never look like mastery.
    """
    best, src = 0.0, None
    related = dict(tax.related_to(skill_id))
    for other_id, other in tax.skills.items():
        if skill_id in other.related:
            related[other_id] = max(related.get(other_id, 0.0), other.related[skill_id])
    for other_id, sim in related.items():
        lvl = levels.get(other_id, 0.0)
        credit = min(3.0, lvl * sim)
        if credit > best:
            best, src = credit, other_id
    if best < MIN_TRANSFER:
        return 0.0, None  # too weak a link to count (e.g. Python -> LLMs)
    return round(best, 2), src


def est_hours(skill_hours: float, effective: float, required: float) -> float:
    """skill_hours is the estimate from zero to level 3; levels above 3 cost more per step."""
    if effective >= required:
        return 0.0

    def cost(level: float) -> float:
        base = min(level, 3.0) / 3.0 * skill_hours
        extra = max(0.0, level - 3.0) * skill_hours * 0.6
        return base + extra

    return round(max(1.0, cost(required) - cost(effective)), 1)


def compute_gap(
    job: JobProfile,
    candidate: CandidateProfile,
    tax: Taxonomy,
    market_freq: dict[str, float] | None = None,
) -> GapReport:
    levels = {s.skill_id: s.level for s in candidate.skills}
    cand_by_id = {s.skill_id: s for s in candidate.skills}
    gaps: list[SkillGap] = []
    num = den = must_num = must_den = 0.0

    for js in job.skills:
        direct = levels.get(js.skill_id, 0.0)
        transfer, src = _transfer(js.skill_id, levels, tax)
        req = max(js.required_level, 0.5)
        alt_id, alt_level = max(((a, levels.get(a, 0.0)) for a in js.alternatives), key=lambda x: x[1], default=(None, 0.0))
        satisfied_by = alt_id if alt_level > direct and alt_level >= min(req, 3.0) else None
        if satisfied_by:
            direct = alt_level  # 'MySQL or PostgreSQL': having MySQL meets the requirement
        effective = max(direct, transfer)
        gap = round(max(0.0, req - effective), 2)
        if direct >= req:
            status = GapStatus.strong
        elif direct > 0:
            status = GapStatus.partial
        elif transfer > 0:
            status = GapStatus.transferable
        else:
            status = GapStatus.missing
        hours = est_hours(tax.get(js.skill_id).hours, effective, req)
        if status is GapStatus.transferable and hours == 0:
            hours = round(max(1.0, 0.1 * tax.get(js.skill_id).hours), 1)  # quick ramp-up from the related skill
        cover = min(effective, req) / req
        num += js.weight * cover
        den += js.weight
        if js.importance is Importance.must:
            must_num += js.weight * cover
            must_den += js.weight
        gaps.append(SkillGap(
            skill_id=js.skill_id, name=js.name, category=js.category, importance=js.importance,
            required_level=req, candidate_level=direct, effective_level=round(effective, 2), gap=gap,
            status=status, transfer_from=src if status is GapStatus.transferable else None, satisfied_by=satisfied_by,
            est_hours=hours,
            market_frequency=(market_freq or {}).get(js.skill_id),
            job_evidence=js.evidence,
            candidate_evidence=cand_by_id[k].evidence if (k := satisfied_by or js.skill_id) in cand_by_id else [],
        ))

    weights = {s.skill_id: s.weight * (1 + len(s.alternatives)) for s in job.skills}

    def priority(g: SkillGap) -> float:
        w = weights[g.skill_id]
        mf = g.market_frequency or 0.0
        return w * (g.gap / max(g.required_level, 0.5)) * (1 + mf) + PRIORITY_BOOST[g.status] * w

    gaps = _collapse_alternatives(gaps, job, tax)
    gaps.sort(key=lambda g: (g.status is GapStatus.strong, -priority(g), g.name))

    counts = {st: sum(1 for g in gaps if g.status is st) for st in GapStatus}
    readiness = round(100 * num / den, 1) if den else 0.0
    must_cov = round(100 * must_num / must_den, 1) if must_den else readiness
    hours = round(sum(g.est_hours for g in gaps), 1)
    summary = GapSummary(
        readiness=readiness, must_have_coverage=must_cov,
        strong=counts[GapStatus.strong], partial=counts[GapStatus.partial],
        transferable=counts[GapStatus.transferable], missing=counts[GapStatus.missing],
        est_hours_to_close=hours, headline=_headline(readiness, gaps, hours),
    )
    job_ids = {s.skill_id for s in job.skills}
    extra = [s for s in candidate.skills if s.skill_id not in job_ids]
    return GapReport(job=job, candidate=candidate, summary=summary, gaps=gaps, extra_skills=extra)


def _collapse_alternatives(gaps: list[SkillGap], job: JobProfile, tax: Taxonomy) -> list[SkillGap]:
    """Show 'one of Java, Go, Python, C++' as one line: the option the candidate is closest on."""
    alts = {s.skill_id: set(s.alternatives) for s in job.skills}
    by_id = {g.skill_id: g for g in gaps}
    keep: list[SkillGap] = []
    seen: set[str] = set()
    for g in gaps:
        if g.skill_id in seen:
            continue
        group = {g.skill_id} | alts.get(g.skill_id, set())
        members = [by_id[i] for i in group if i in by_id]
        best = max(members, key=lambda m: (m.candidate_level if m.satisfied_by is None else -1, m.effective_level, -m.gap))
        best.alternatives = sorted(tax.get(m.skill_id).name for m in members if m is not best)
        seen |= group
        keep.append(best)
    return keep


def _headline(readiness: float, gaps: list[SkillGap], hours: float) -> str:
    open_must = [g.name for g in gaps if g.status is not GapStatus.strong and g.importance is Importance.must]
    if not gaps:
        return "No recognised skills found in this job description yet."
    if not open_must and readiness >= 95:
        return "You cover every must-have skill for this role. Polish the nice-to-haves and apply."
    top = ", ".join(open_must[:3]) if open_must else ", ".join(g.name for g in gaps if g.status is not GapStatus.strong)[:80]
    weeks = max(1, round(hours / 10))
    return f"You're {readiness:.0f}% of the way there. Focus first on {top}: about {hours:.0f} hours (~{weeks} weeks at 10 h/week)."
