"""Orchestration: text in -> profiles -> gap / market reports.

Rules always run. Claude runs on top when enabled; the two are merged so a
skill found by either side is kept, and Claude's reading of importance and
level wins where both found it.
"""
from __future__ import annotations

import logging
from functools import lru_cache

from . import llm
from .engine import extractor
from .engine.gap import compute_gap
from .engine.learning import recommend
from .engine.market import build_report
from .engine.taxonomy import Taxonomy, load_taxonomy
from .jobs.store import get_store
from .models import (
    CandidateProfile, CandidateSkill, Evidence, GapReport, GapStatus, Importance, JobProfile,
    JobSkill, MarketReport, SkillOverride,
)

log = logging.getLogger("mga.service")


def tax() -> Taxonomy:
    return load_taxonomy()


def _use_llm(flag: bool | None) -> bool:
    from .limits import llm_allowed
    if not llm_allowed.get():  # anonymous request and MGA_LLM_PUBLIC is off: rules only
        return False
    return llm.enabled() if flag is None else (flag and llm.enabled())


def _clamp(v: float) -> float:
    return max(1.0, min(5.0, float(v)))


# ---------- job ----------

def analyze_job(text: str, use_llm: bool | None = None, title: str | None = None, company: str | None = None) -> JobProfile:
    t = tax()
    rules = extractor.extract_job(text, t, title=title, company=company)
    if not _use_llm(use_llm):
        return rules
    try:
        ai = llm.extract_job(text)
    except llm.LLMUnavailable as e:
        log.warning("AI job extraction unavailable, using rules: %s", e)
        return rules
    merged = {s.skill_id: s for s in rules.skills}
    unmapped: list[str] = []
    for s in ai.skills:
        sid = t.resolve(s.name)
        if sid is None:
            unmapped.append(s.name)
            continue
        sk = t.get(sid)
        imp = Importance(s.importance)
        ev = [Evidence(text=s.evidence[:300])] if s.evidence else []
        prev = merged.get(sid)
        merged[sid] = JobSkill(
            skill_id=sid, name=sk.name, category=sk.category, importance=imp,
            required_level=_clamp(s.level), weight=(prev.weight if prev else 1.0) if imp is Importance.must else 0.4,
            years=s.years, evidence=(prev.evidence if prev else []) or ev,
        )
    skills = sorted(merged.values(), key=lambda s: (s.importance != Importance.must, -s.weight, s.name))
    return JobProfile(
        title=title or ai.title, company=company or ai.company, skills=skills,
        unmapped=sorted(set(unmapped)), extractor="rules+claude",
    )


# ---------- resume ----------

def analyze_resume(text: str | None, use_llm: bool | None = None, overrides: list[SkillOverride] | None = None) -> CandidateProfile:
    t = tax()
    profile = extractor.extract_resume(text, t) if text else CandidateProfile(skills=[])
    if text and _use_llm(use_llm):
        try:
            ai = llm.extract_resume(text)
            profile = _merge_resume(profile, ai, t)
        except llm.LLMUnavailable as e:
            log.warning("AI resume extraction unavailable, using rules: %s", e)
    if overrides:
        profile = apply_overrides(profile, overrides, t)
    return profile


def _merge_resume(rules: CandidateProfile, ai: llm.LLMResumeExtraction, t: Taxonomy) -> CandidateProfile:
    by_id = {s.skill_id: s for s in rules.skills}
    unmapped: list[str] = []
    for s in ai.skills:
        sid = t.resolve(s.name)
        if sid is None:
            unmapped.append(s.name)
            continue
        sk = t.get(sid)
        ai_level = _clamp(s.level)
        prev = by_id.get(sid)
        if prev:
            # Claude may read context the rules miss, but stays within one step of the rule evidence.
            level = max(prev.level, min(ai_level, prev.level + 1.0))
            by_id[sid] = prev.model_copy(update={"level": round(level, 2)})
        else:
            by_id[sid] = CandidateSkill(
                skill_id=sid, name=sk.name, category=sk.category, level=min(ai_level, 3.0),
                evidence=[Evidence(text=s.evidence[:300], section=s.section)] if s.evidence else [],
            )
    skills = sorted(by_id.values(), key=lambda s: (-s.level, s.name))
    return CandidateProfile(skills=skills, unmapped=sorted(set(unmapped)), extractor="rules+claude")


def apply_overrides(profile: CandidateProfile, overrides: list[SkillOverride], t: Taxonomy) -> CandidateProfile:
    by_id = {s.skill_id: s for s in profile.skills}
    for o in overrides:
        if o.skill_id not in t.skills:
            continue
        sk = t.get(o.skill_id)
        if o.level <= 0:
            by_id.pop(o.skill_id, None)
        elif o.skill_id in by_id:
            by_id[o.skill_id] = by_id[o.skill_id].model_copy(update={"level": o.level})
        else:
            by_id[o.skill_id] = CandidateSkill(skill_id=o.skill_id, name=sk.name, category=sk.category, level=o.level,
                                               evidence=[Evidence(text="Self-assessed / verified in app", section="override")])
    return profile.model_copy(update={"skills": sorted(by_id.values(), key=lambda s: (-s.level, s.name))})


# ---------- reports ----------

def _attach_resources(gaps) -> None:
    for g in gaps:
        if g.status is not GapStatus.strong:
            g.resources = recommend(g.skill_id, g.effective_level)


def resolve_job(job_text: str | None, job_id: str | None, use_llm: bool | None = None) -> JobProfile:
    """A stored posting (pre-analyzed by rules; re-read by Claude when enabled) or pasted text."""
    if job_id:
        store = get_store()
        posting = store.get(job_id)
        if posting is None:
            raise KeyError(job_id)
        if not _use_llm(use_llm):
            return store.profile(job_id)
        return analyze_job(posting.description, use_llm=use_llm, title=posting.title, company=posting.company)
    if not job_text:
        raise ValueError("Provide job_text or job_id")
    return analyze_job(job_text, use_llm=use_llm)


def gap_report(resume_text: str | None, job_text: str | None = None, job_id: str | None = None,
               overrides: list[SkillOverride] | None = None, use_llm: bool | None = None,
               include_resources: bool = True) -> GapReport:
    job = resolve_job(job_text, job_id, use_llm)
    cand = analyze_resume(resume_text, use_llm=use_llm, overrides=overrides)
    report = compute_gap(job, cand, tax())
    if include_resources:
        _attach_resources(report.gaps)
    return report


@lru_cache(maxsize=128)
def _market_profiles(role: str, location: str | None, version: tuple[int, str]) -> tuple[JobProfile, ...]:
    # Market aggregation uses the stored rule-based profiles: deterministic and
    # computed once per posting at ingestion. `version` changes when postings do.
    store = get_store()
    ids = [p.id for p in store.search(role=role, location=location, limit=None)]
    by_id = store.profiles(ids)
    return tuple(by_id[i] for i in ids if i in by_id)


def market_report(role: str, location: str | None = None, resume_text: str | None = None,
                  overrides: list[SkillOverride] | None = None, use_llm: bool | None = None, top: int = 25) -> MarketReport:
    profiles = list(_market_profiles(role, location, get_store().version()))
    cand = analyze_resume(resume_text, use_llm=use_llm, overrides=overrides) if (resume_text or overrides) else None
    report = build_report(role, location, profiles, tax(), candidate=cand, top=top)
    _attach_resources(report.candidate_gaps)
    return report


# ---------- job fit ----------

FIT_MAX_POSTINGS = 500


def job_fits(resume_text: str | None, overrides: list[SkillOverride] | None, role: str | None, location: str | None,
             q: str | None, limit: int) -> tuple[list, int]:
    """Score the candidate against many stored postings at once. Rules only, so the ranking is stable and cheap."""
    from .models import JobCard, JobFit
    store = get_store()
    postings = store.search(role=role, location=location, q=q, limit=FIT_MAX_POSTINGS)
    profiles = store.profiles([p.id for p in postings])
    cand = analyze_resume(resume_text, use_llm=False, overrides=overrides)
    t = tax()
    out = []
    for p in postings:
        job = profiles.get(p.id)
        if job is None or not job.skills:
            continue
        rep = compute_gap(job, cand, t)
        open_must = [g.name for g in rep.gaps if g.importance is Importance.must and g.status is not GapStatus.strong]
        out.append(JobFit(job=JobCard(**p.model_dump(exclude={"description"})), readiness=rep.summary.readiness,
                          must_have_coverage=rep.summary.must_have_coverage, open_must=open_must[:5],
                          est_hours=rep.summary.est_hours_to_close))
    out.sort(key=lambda f: (-f.readiness, -f.must_have_coverage, f.est_hours))
    return out[:limit], len(postings)
