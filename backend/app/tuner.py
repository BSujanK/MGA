"""Resume tuner: interview the candidate about their gaps, then tailor the resume.

The engine decides what to ask (the candidate's top gaps for the job) and which
lines may change. Claude, when enabled, only words questions and rewords lines,
and every reworded line passes `resume_doc.check_rewrite`. Nothing the
candidate did not write or say can reach the resume.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from . import llm, service
from .engine import resume_doc as rd
from .engine.extractor import APPLIED
from .models import (
    AnswerFinding, ChatQuestion, ChatRequest, ChatResponse, ChatTurn, GapReport, GapStatus, GuardrailNote,
    Importance, JobProfile, KeywordGap, ResumeEntry, ResumeLine, ResumeSection, TailoredResume, TailorRequest,
)

log = logging.getLogger("mga.tuner")

LEVEL_NAMES = ["none", "aware", "basic", "working", "strong", "expert"]

GENERAL = [
    ("gen:impact",
     "Think of the project or internship you're proudest of. What measurable result did it have: users, "
     "speed-up, accuracy, money or time saved?",
     "Numbers make a bullet stronger. We only use numbers you give us."),
    ("gen:hidden",
     "Is there anything you've done that isn't on your resume yet: a hackathon, open-source contribution, "
     "freelance work, a college club tech role or a course project? What did you build?",
     "Early-career resumes often leave out real experience."),
]

_NEGATIVE = re.compile(
    r"^\s*(no\b|nope|nah\b|not (yet|really|much|at all)|never|i\s+(have\s+not|haven'?t|did\s*n[o']t|don'?t)|"
    r"haven'?t|have not|didn'?t|did not|none\b|nothing\b|n/?a\b|skip\b|only (heard|read)|just (heard|read)|"
    r"heard of it|i don'?t know)", re.I)
_NEG_WORD = re.compile(r"\b(not|never|no|haven'?t|didn'?t|don'?t|without|yet to|plan to|want to|will learn)\b", re.I)


def _level_name(v: float) -> str:
    return LEVEL_NAMES[max(0, min(5, round(v)))]


def is_negative(answer: str) -> bool:
    a = answer.strip()
    return len(a) < 3 or bool(_NEGATIVE.match(a))


def _affirmed_skills(text: str) -> set[str]:
    """Skills named in clauses that are not negated ('Yes, Flask, but not Docker' -> Flask)."""
    out: set[str] = set()
    for clause in re.split(r"[.;!?\n]|,\s*|\bbut\b|\bthough\b|\bhowever\b", text, flags=re.I):
        if clause.strip() and not _NEG_WORD.search(clause):
            out |= rd.skill_ids(clause, service.tax())
    return out


# ---------- interview plan ----------

@dataclass
class Target:
    id: str
    kind: str  # gap | general
    question: str
    why: str
    gap: object | None = None


def _gap_question(g, tax) -> tuple[str, str]:
    imp = "a must-have" if g.importance is Importance.must else "a nice-to-have"
    quote = f': "{g.job_evidence[0].text[:140]}"' if g.job_evidence else ""
    if g.status is GapStatus.transferable and g.transfer_from:
        rel = tax.get(g.transfer_from).name
        return (f"You've worked with {rel}. Have you also used {g.name}, even in a small project? "
                f"If yes, what did you do with it?",
                f"The job lists {g.name} as {imp}{quote}. Your {rel} experience gives partial credit.")
    if g.status is GapStatus.partial:
        secs = {e.section or "" for e in g.candidate_evidence}
        names = {"skills": "skills list", "certifications": "certifications", "education": "education",
                 "summary": "summary"}
        where = ""
        if secs and secs <= set(names) | {"implied"}:
            listed = [names[x] for x in ("skills", "certifications", "education", "summary") if x in secs]
            where = f" only in your {' and '.join(listed)}" if listed else ""
        return (f"Your resume mentions {g.name}{where}. What's the most substantial thing you've built or done "
                f"with {g.name}, and what was the result?",
                f"The job asks for {_level_name(g.required_level)}-level {g.name}{quote}. Your resume shows "
                f"{_level_name(g.candidate_level)} level.")
    why = f"The job lists {g.name} as {imp}{quote}. Your resume shows no evidence of it yet."
    if g.category == "cs_fundamentals":
        return (f"Have you applied {g.name} beyond coursework: a project, assignment, competition or internship "
                f"where you used it? What did you do?", why)
    if g.category in ("soft", "process"):
        return (f"Can you give an example that shows {g.name}: in an internship, team project, hackathon or club? "
                f"What was the situation and what did you do?", why)
    return (f"Have you used {g.name} anywhere: a course project, internship, hackathon or something you built "
            f"on your own? If yes, what did you build and what was your part?", why)


def plan(report: GapReport, max_questions: int) -> list[Target]:
    tax = service.tax()
    n_general = min(len(GENERAL), max(1, max_questions // 3))
    open_gaps = [g for g in report.gaps if g.status is not GapStatus.strong]
    open_gaps.sort(key=lambda g: g.importance is not Importance.must)  # stable: keeps priority order
    targets = []
    for g in open_gaps[: max_questions - n_general]:
        q, why = _gap_question(g, tax)
        targets.append(Target(id=f"gap:{g.skill_id}", kind="gap", question=q, why=why, gap=g))
    for gid, q, why in GENERAL[: max(n_general, max_questions - len(targets))][:max_questions - len(targets)]:
        targets.append(Target(id=gid, kind="general", question=q, why=why))
    return targets


def _followup(answer: str, t: Target) -> str | None:
    if is_negative(answer):
        return None
    name = t.gap.name  # type: ignore[union-attr]
    if len(answer) < 60 and not APPLIED.search(answer):
        return f"What did you build or do with {name}, and what was your part in it?"
    if not re.search(r"\d", answer):
        return ("What was the result? Numbers help: users, time or cost saved, speed-up, accuracy, "
                "data size or team size. Skip if you don't know.")
    return None


def _phrase(t: Target, kind: str, default: str, report: GapReport, turns: list[ChatTurn], use_llm: bool) -> tuple[str, str]:
    if not use_llm:
        return default, "scripted"
    g = t.gap
    ctx = {
        "job": {"title": report.job.title, "company": report.job.company},
        "question_type": "follow-up" if kind == "followup" else ("skill" if g else "general"),
        "default_question": default,
        "conversation": [{"q": x.question, "a": x.answer} for x in turns[-6:]],
    }
    if g is not None:
        ctx["skill"] = {"name": g.name, "status": g.status.value, "importance": g.importance.value,
                        "job_says": [e.text for e in g.job_evidence[:2]],
                        "resume_shows": [e.text for e in g.candidate_evidence[:2]]}
    try:
        return llm.phrase_question(json.dumps(ctx, ensure_ascii=False)), "claude"
    except llm.LLMUnavailable as e:
        log.warning("question phrasing unavailable, using script: %s", e)
        return default, "scripted"


def chat(req: ChatRequest) -> ChatResponse:
    use = service._use_llm(req.use_llm)
    report = service.gap_report(req.resume_text, job_text=req.job_text, job_id=req.job_id,
                                overrides=req.overrides, use_llm=use, include_resources=False)
    targets = plan(report, req.max_questions)
    answered = {t.question_id: t for t in req.turns}
    found = findings(req.turns)
    mode = "claude" if use else "scripted"

    def ask(t: Target, qid: str, kind: str, default: str, why: str) -> ChatResponse:
        q, m = _phrase(t, kind, default, report, req.turns, use)
        g = t.gap
        return ChatResponse(
            question=ChatQuestion(id=qid, kind=kind, skill_id=g.skill_id if g else None,
                                  skill_name=g.name if g else None, status=g.status if g else None,
                                  question=q, why=why),
            done=False, asked=len(req.turns), planned=len(targets), findings=found, mode=m)

    for t in targets:
        if t.id not in answered:
            return ask(t, t.id, t.kind, t.question, t.why)
        if t.kind == "gap" and f"{t.id}:more" not in answered:
            fq = _followup(answered[t.id].answer, t)
            if fq:
                return ask(t, f"{t.id}:more", "followup", fq, "A concrete result makes the bullet stronger.")
    return ChatResponse(question=None, done=True, asked=len(req.turns), planned=len(targets), findings=found, mode=mode)


# ---------- answers -> evidence ----------

def _groups(turns: list[ChatTurn]) -> list[tuple[str, str | None, str]]:
    """Merge each question with its follow-up: (base id, target skill, combined answer)."""
    order: list[str] = []
    parts: dict[str, list[str]] = {}
    skill: dict[str, str | None] = {}
    negative: set[str] = set()
    for t in turns:
        base = t.question_id.removesuffix(":more")
        if base not in parts:
            order.append(base)
            parts[base] = []
            skill[base] = t.skill_id or (base.split(":", 1)[1] if base.startswith("gap:") else None)
        a = t.answer.strip()
        if t.question_id == base and is_negative(a):
            negative.add(base)
        elif a and not is_negative(a):
            parts[base].append(a.rstrip("."))
    return [(b, skill[b], ". ".join(parts[b])) for b in order if b not in negative and parts[b]]


_AFFIRM = re.compile(r"^\s*(yes|yeah|yep|yup|sure|ok(ay)?|definitely|of course|indeed)\b[\s,.!:;-]*", re.I)
# Spoken answers use plainer verbs than resume bullets ("I used", "I set up").
_USED = re.compile(r"\b(used|using|made|containeri[sz]ed|set up|configured|coded|programmed|worked on|contributed|"
                   r"hosted|tested|analy[sz]ed|scraped|visuali[sz]ed|modell?ed|applied|solved|wrote)\b", re.I)
_LEARNING_ONLY = re.compile(r"\b(tutorial|course|watched|read about|learning|learnt|learned|studied|class)\b", re.I)
_REAL_WORK = re.compile(r"\b(project|internship|hackathon|client|production|team|app|website|api|users?)\b", re.I)


def _answer_level(text: str) -> float:
    """Working level (3) only for real use; tutorials and coursework count as basic (2)."""
    used = APPLIED.search(text) or _USED.search(text)
    if used and not (_LEARNING_ONLY.search(text) and not _REAL_WORK.search(text)):
        return 3.0
    return 2.0


def findings(turns: list[ChatTurn]) -> list[AnswerFinding]:
    tax = service.tax()
    best: dict[str, AnswerFinding] = {}
    for base, target, text in _groups(turns):
        ids = _affirmed_skills(text)
        if target and target in tax.skills:  # a non-negative answer to a question about one skill confirms it
            ids.add(target)
        level = _answer_level(text)
        for sid in ids:
            if sid not in best or best[sid].level < level:
                best[sid] = AnswerFinding(question_id=base, skill_id=sid, name=tax.get(sid).name,
                                          level=level, evidence=text[:300])
    return sorted(best.values(), key=lambda f: (-f.level, f.name))


_IRREGULAR = {"built", "wrote", "led", "made", "ran", "taught", "won", "set", "took", "drew", "found", "got", "did",
              "built,", "worked", "used"}


def to_bullet(answer: str) -> str:
    """Light, rule-based cleanup of an interview answer into a resume bullet. Same facts, same words."""
    s = re.sub(r"\s+", " ", answer).strip()
    while _AFFIRM.match(s):
        s = _AFFIRM.sub("", s, count=1)
    m = re.match(r"^(i|we)\s+(?:have\s+|'ve\s+|’ve\s+)?(\w+)\b", s, re.I) or re.match(r"^(i|we)'ve\s+(\w+)\b", s, re.I)
    if m and (m.group(2).lower().endswith("ed") or m.group(2).lower() in _IRREGULAR):
        s = s[m.start(2):]
    s = s.rstrip(" .")
    return (s[:1].upper() + s[1:])[:400] if s else s


# ---------- tailoring ----------

def _answer_section(turns: list[ChatTurn]) -> ResumeSection | None:
    entries = []
    for base, _target, text in _groups(turns):
        if len(text) < 15:
            continue
        entries.append(ResumeEntry(bullets=[ResumeLine(id=f"a:{base}", text=to_bullet(text), source="answer")]))
    if not entries:
        return None
    return ResumeSection(key="answers", title="Additional Projects & Experience", entries=entries)


def _rewrite(sections: list[ResumeSection], job: JobProfile, sources: dict[str, str]) -> tuple[list[GuardrailNote], bool]:
    """Ask Claude to reword bullets and summary lines; keep only rewrites that pass the guardrail."""
    tax = service.tax()
    lines = []
    for s in sections:
        if s.key in ("skills", "education"):
            continue
        for e in s.entries:
            pool = e.heading if s.key == "summary" else e.bullets
            for ln in pool:
                lines.append({"id": ln.id, "section": "answer" if ln.source == "answer" else s.key, "text": ln.text})
    if not lines:
        return [], False
    payload = json.dumps({
        "job": {"title": job.title, "company": job.company,
                "skills": [f"{s.name} ({s.importance.value})" for s in job.skills[:25]]},
        "lines": lines,
    }, ensure_ascii=False)
    try:
        out = llm.rewrite_lines(payload)
    except llm.LLMUnavailable as e:
        log.warning("resume rewrite unavailable, keeping original wording: %s", e)
        return [], False
    by_id = {ln.id: ln for ln in rd.all_lines(sections)}
    job_ids = {js.skill_id for js in job.skills}
    allowed = {x["id"] for x in lines}
    notes: list[GuardrailNote] = []
    for r in out.lines:
        ln = by_id.get(r.id)
        if ln is None or r.id not in allowed:
            notes.append(GuardrailNote(line_id=r.id, action="dropped", reason="the rewrite did not match any line of your resume"))
            continue
        new = re.sub(r"\s+", " ", r.text).strip()
        if not ln.text.endswith("."):
            new = new.rstrip(".")
        if new == ln.text:
            continue
        reason = rd.check_rewrite(sources.get(ln.id, ln.text), new, tax)
        lost = (rd.skill_ids(ln.text, tax) & job_ids) - rd.implied_closure(rd.skill_ids(new, tax), tax)
        if not reason and lost:
            reason = f"it dropped {', '.join(sorted(tax.get(i).name for i in lost))}, which the job asks for"
        if reason:
            notes.append(GuardrailNote(line_id=ln.id, action="reverted", reason=f"Kept your original wording: {reason}."))
            continue
        ln.original, ln.text = ln.text, new
    return notes, True


def _add_keywords(sections: list[ResumeSection], job: JobProfile, evidence: dict[str, str], notes: list[str]) -> None:
    """Name job skills the candidate has shown (answers, implied by resume) but the resume never names."""
    tax = service.tax()
    present = rd.skill_ids(rd.render_text([], sections), tax)
    add = []
    for js in job.skills:
        if js.skill_id in present or any(a in present for a in js.alternatives):
            continue
        if js.skill_id in evidence:
            add.append(js.skill_id)
            notes.append(f"Added {js.name} to your skills: {evidence[js.skill_id]}.")
    if not add:
        return
    names = ", ".join(tax.get(i).name for i in add)
    skills = next((s for s in sections if s.key == "skills"), None)
    if skills is None:
        skills = ResumeSection(key="skills", title="Skills", entries=[])
        pos = next((i + 1 for i, s in enumerate(sections) if s.key == "summary"), 0)
        sections.insert(pos, skills)
    skills.entries.append(ResumeEntry(heading=[ResumeLine(id="k:added", text=f"Additional: {names}", source="added")]))


def tailor(req: TailorRequest) -> TailoredResume:
    tax = service.tax()
    use = service._use_llm(req.use_llm)
    title = company = None
    job_text = req.job_text
    if req.job_id:
        from .jobs.store import get_store
        posting = get_store().get(req.job_id)
        if posting is None:
            raise KeyError(req.job_id)
        job_text, title, company = posting.description, posting.title, posting.company
    if not job_text:
        raise ValueError("Provide job_text or job_id")
    job = service.analyze_job(job_text, use_llm=use, title=title, company=company)

    header, sections = rd.parse_resume(req.resume_text)
    answers = _answer_section(req.turns)
    sources = {ln.id: ln.text for ln in rd.all_lines(sections)}
    if answers:
        # Rewrites of answer bullets are checked against everything the candidate said, not the cleaned bullet.
        raw = {f"a:{b}": t for b, _s, t in _groups(req.turns)}
        sources |= {ln.id: raw.get(ln.id, ln.text) for e in answers.entries for ln in e.bullets}
        after = max((i for i, s in enumerate(sections) if s.key in ("projects", "experience")), default=len(sections) - 1)
        sections.insert(after + 1, answers)

    guard: list[GuardrailNote] = []
    rewrote = False
    if use:
        guard, rewrote = _rewrite(sections, job, sources)

    notes: list[str] = []
    resume_ids = rd.skill_ids(req.resume_text, tax)
    evidence: dict[str, str] = {}
    for sid in rd.implied_closure(resume_ids, tax) - resume_ids:
        src = next((tax.get(o).name for o in resume_ids if sid in rd.implied_closure({o}, tax)), None)
        evidence[sid] = f"shown by {src} on your resume" if src else "implied by your resume"
    for f in findings(req.turns):
        evidence.setdefault(f.skill_id, "from your interview answer")
    _add_keywords(sections, job, evidence, notes)

    sections = rd.tailor_sections(sections, job, tax)
    text = rd.render_text(header, sections)
    before, _ = rd.keyword_coverage(req.resume_text, job, tax)
    after_cov, matched = rd.keyword_coverage(text, job, tax)

    shown = rd.implied_closure(resume_ids | {f.skill_id for f in findings(req.turns)}, tax)
    missing = [KeywordGap(skill_id=s.skill_id, name=s.name, importance=s.importance) for s in job.skills
               if s.skill_id not in shown and not any(a in shown for a in s.alternatives)]
    missing.sort(key=lambda k: k.importance is not Importance.must)

    top = [s.name for s in job.skills if s.skill_id in matched][:4]
    if top:
        notes.insert(0, f"Moved the lines that show {', '.join(top)} to the top of each section.")
    if answers:
        notes.append(f"Added {len(answers.entries)} line(s) from your interview answers. Check the wording and move each under the right project.")
    if missing:
        notes.append("Some skills the job asks for have no evidence yet. We never add those; they go to your learning plan.")
    if use and not rewrote:
        notes.append("AI rewording was unavailable, so your original wording is kept.")

    return TailoredResume(
        job_title=job.title, company=job.company, header=header, sections=sections,
        mode="claude" if rewrote else "rules",
        keywords_matched=[tax.get(i).name for i in sorted(matched, key=lambda i: tax.get(i).name)],
        keywords_missing=missing, coverage_before=before, coverage_after=after_cov,
        guardrail=guard, notes=notes, text=text,
    )
