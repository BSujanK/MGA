"""Prep kit orchestration: gap report -> engine.prep -> PrepKit.

Rules-only mode builds the whole kit. With Claude enabled, it adds practice
questions grounded in the posting; any question whose quote is not literally
in the posting is dropped.
"""
from __future__ import annotations

import logging

from . import llm, service
from .engine import prep
from .jobs.store import get_store
from .models import AptitudeArea, PrepKit, PrepQuestion, PrepRequest

log = logging.getLogger("mga.prep")


def _ai_questions(job_text: str) -> list[PrepQuestion]:
    try:
        out = llm.prep_questions(job_text)
    except llm.LLMUnavailable as e:
        log.warning("AI prep questions unavailable, using posting-based questions: %s", e)
        return []
    kept = []
    for q in out.questions[:8]:
        if prep.grounded(q.quote, job_text) and q.question.strip():
            kept.append(PrepQuestion(question=q.question.strip(), theme=q.theme.strip()[:40] or "Role", source="ai", quote=q.quote.strip()))
        else:
            log.info("dropped ungrounded prep question: %r", q.question[:80])
    return kept


def prep_kit(req: PrepRequest) -> PrepKit:
    job_text, title, company = req.job_text, None, None
    if req.job_id:
        posting = get_store().get(req.job_id)
        if posting is None:
            raise KeyError(req.job_id)
        job_text, title, company = posting.description, posting.title, posting.company
    if not job_text:
        raise ValueError("Provide job_text or job_id")
    use = service._use_llm(req.use_llm)
    if req.resume_text or req.overrides:
        report = service.gap_report(req.resume_text, job_text=None if req.job_id else job_text, job_id=req.job_id,
                                    overrides=req.overrides, use_llm=use,
                                    include_resources=False)
    else:  # no resume yet: plan as a beginner
        report = _empty_report(job_text, req.job_id, use)
    report.job.title = report.job.title or title
    report.job.company = report.job.company or company
    tax = service.tax()

    dsa = prep.dsa_plan(report, report.job)
    core = prep.core_subjects(report, report.job, tax)
    formats, process = prep.oa_formats(job_text, report.job, dsa)
    content = prep.load_prep()
    aptitude = [AptitudeArea(**a) for a in content["aptitude"]]
    aptitude_relevant = any(f.id == "aptitude" and f.relevant for f in formats)
    company_qs = prep.company_questions(job_text, report)
    mode = "rules"
    if use:
        ai = _ai_questions(job_text)
        if ai:
            company_qs = ai + company_qs
            mode = "claude"
    ideas = prep.projects(report, report.job, tax)
    weeks = prep.schedule(dsa, core, aptitude if aptitude_relevant else [], ideas[0] if ideas else None, req.hours_per_week)
    return PrepKit(
        job_title=report.job.title, company=report.job.company, readiness=report.summary.readiness,
        dsa=dsa, core=core, oa_formats=formats, posting_process=process,
        aptitude=aptitude, aptitude_note=content["aptitude_note"] + ("" if aptitude_relevant else
                                                                     " This posting doesn't mention it, so it isn't in your schedule."),
        behavioral=prep.behavioral(), company_questions=company_qs, star_tip=content["star_tip"],
        projects=ideas, schedule=weeks, hours_per_week=req.hours_per_week,
        total_hours=round(sum(w.hours for w in weeks), 1), mode=mode,
    )


def _empty_report(job_text: str, job_id: str | None, use: bool):
    from .engine.gap import compute_gap
    from .models import CandidateProfile
    job = service.resolve_job(None if job_id else job_text, job_id, use)
    return compute_gap(job, CandidateProfile(skills=[]), service.tax())
