"""Prep kit for one job: DSA plan, core subjects, OA formats, aptitude,
interview questions, a gap-closing project and a weekly schedule.

Deterministic. The content (topics, questions, project templates) is original
and lives in data/prep.json. Questions about the company are built only from
lines quoted from the posting; nothing claims "company X asks this".
"""
from __future__ import annotations

import json
import re
from functools import lru_cache

from ..models import (
    AptitudeArea, CoreSubject, DSAPlan, GapReport, GapStatus, Importance, JobProfile, OAFormat, PrepQuestion,
    PrepTopic, PrepWeek, ProjectIdea, WeekItem,
)
from .extractor import JOB_SECTIONS, _inline_header, _is_header, _lines
from .learning import recommend
from .taxonomy import DATA_DIR, Taxonomy

LEVELS = ["none", "aware", "basic", "working", "strong", "expert"]
CORE_IDS = ("oop", "os", "dbms", "networking", "system_design", "sql")
SQL_FAMILY = {"sql", "mysql", "postgresql", "db_design"}
REVIEW_HOURS = 2.0
CORE_CAP = 12.0  # interview revision of a subject, not mastering it

PROCESS = re.compile(r"\b(online (assessment|test)|assessment|coding (round|test|challenge)|interview (process|rounds?)|"
                     r"rounds?|take[\s-]home|assignment|aptitude|hackathon|hiring (process|drive)|selection process)\b", re.I)


@lru_cache(maxsize=1)
def load_prep() -> dict:
    return json.loads((DATA_DIR / "prep.json").read_text())


def _lvl(v: float) -> str:
    return LEVELS[max(0, min(5, round(v)))]


def _cand_level(report: GapReport, skill_id: str) -> float:
    return next((s.level for s in report.candidate.skills if s.skill_id == skill_id), 0.0)


def _gap(report: GapReport, skill_id: str):
    return next((g for g in report.gaps if g.skill_id == skill_id), None)


# ---------- DSA ----------

def dsa_plan(report: GapReport, job: JobProfile) -> DSAPlan:
    g = _gap(report, "dsa")
    langs = [s.name for s in job.skills if s.category == "language" and s.importance is Importance.must]
    if g is None and not langs:
        return DSAPlan(included=False, reason="This posting doesn't ask for DSA or a programming language, so DSA is left out. "
                                              "Focus on the subjects and project below.")
    cand = g.effective_level if g else _cand_level(report, "dsa")
    target = g.required_level if g else 3.0
    reason = (f"The posting asks for {_lvl(target)}-level DSA; your resume shows {_lvl(cand)}." if g else
              f"The posting asks for programming in {', '.join(langs[:3])}, and coding rounds usually test DSA.")
    max_tier = 3 if target >= 3.5 else 2
    data_w = sum(s.weight for s in job.skills if s.category in ("data", "ml"))
    sw_w = sum(s.weight for s in job.skills if s.category in ("backend", "frontend", "mobile", "cs_fundamentals"))
    if g is None and data_w > sw_w:
        max_tier, target = 1, 2.0
        reason = (f"The posting asks for {', '.join(langs[:3])} but not DSA. Data roles sometimes include one easy "
                  f"coding question, so this plan covers the basics only.")
    topics = []
    for t in load_prep()["dsa_topics"]:
        if t["tier"] > max_tier:
            continue
        review = cand >= target or (t["tier"] == 1 and cand >= 2.5) or (t["tier"] == 2 and cand >= 3.5)
        topics.append(PrepTopic(id=t["id"], name=t["name"], hours=round(t["hours"] * (0.3 if review else 1.0), 1),
                                review=review, patterns=t["patterns"], checklist=t["checklist"]))
    if cand >= target:
        reason += " You already meet it, so this is a short revision plan."
    return DSAPlan(included=True, reason=reason, candidate_level=cand, target_level=target, topics=topics,
                   resources=recommend("dsa", cand))


# ---------- core subjects ----------

def core_subjects(report: GapReport, job: JobProfile, tax: Taxonomy) -> list[CoreSubject]:
    content = load_prep()["core_subjects"]
    job_ids = {s.skill_id for s in job.skills}
    wanted = [i for i in CORE_IDS if i in job_ids]
    if "sql" not in wanted and job_ids & SQL_FAMILY:
        wanted.append("sql")
    out = []
    for sid in wanted:
        g = _gap(report, sid)
        if g is None:  # 'sql' implied by MySQL/PostgreSQL, or collapsed into an alternative
            fam = [x for x in report.gaps if x.skill_id in SQL_FAMILY] if sid == "sql" else []
            g = max(fam, key=lambda x: x.gap, default=None)
        status = g.status if g else None
        req = g.required_level if g else 3.0
        cand = g.effective_level if g else _cand_level(report, sid)
        hours = REVIEW_HOURS if status is GapStatus.strong or (g is None and cand >= req) else min(CORE_CAP, max(3.0, g.est_hours if g else 6.0))
        out.append(CoreSubject(skill_id=sid, name=tax.get(sid).name, status=status, required_level=req,
                               candidate_level=cand, hours=round(hours, 1), topics=content[sid],
                               resources=recommend(sid, cand, limit=2)))
    out.sort(key=lambda c: c.status is GapStatus.strong)
    return out


# ---------- OA formats and process ----------

def posting_lines(text: str) -> list[tuple[str, str]]:
    """(section, line) for every content line, with section names from the job extractor."""
    section, out = "must", []
    for line in _lines(text):
        header = _is_header(line, JOB_SECTIONS)
        if header:
            section = header
            continue
        inline, body = _inline_header(line, JOB_SECTIONS)
        out.append((inline or section, line))
    return out


def oa_formats(job_text: str, job: JobProfile, dsa: DSAPlan) -> tuple[list[OAFormat], list[str]]:
    low = job_text.lower()
    ids = {s.skill_id for s in job.skills}
    core = [s.name for s in job.skills if s.category == "cs_fundamentals" and s.skill_id != "dsa"]
    rel: dict[str, str | None] = {
        "coding": "The posting asks for DSA or programming." if dsa.included else None,
        "cs_mcq": f"The posting asks for {', '.join(core[:4])}." if core else None,
        "aptitude": "The posting mentions aptitude." if "aptitude" in low else None,
        "sql": "The posting asks for SQL." if ids & SQL_FAMILY else None,
        "debugging": "The posting mentions debugging or code review." if re.search(r"\b(debug\w*|code reviews?|troubleshoot\w*)\b", low) else None,
        "take_home": "The posting mentions an assignment." if re.search(r"\b(take[\s-]home|assignment)\b", low) else None,
    }
    formats = [OAFormat(**f, relevant=rel.get(f["id"]) is not None, reason=rel.get(f["id"])) for f in load_prep()["oa_formats"]]
    formats.sort(key=lambda f: not f.relevant)  # stable
    process = [line for _sec, line in posting_lines(job_text) if PROCESS.search(line)][:6]
    return formats, process


# ---------- questions ----------

def behavioral() -> list[PrepQuestion]:
    return [PrepQuestion(question=q, theme=b["theme"], source="bank") for b in load_prep()["behavioral"] for q in b["questions"]]


def _skill_question(g, quote: str) -> str:  # noqa: ARG001 - quote shown next to the question
    if g.category == "language":
        return f"What do you like and dislike about {g.name} compared with another language you know? Give an example from your own code."
    if g.category == "database":
        return f"How would you design the tables for one of your projects in {g.name}, and which indexes would you add? Why?"
    if g.category == "cs_fundamentals":
        return f"Explain the {g.name} ideas in this line to an interviewer, with an example from your own work or coursework."
    if g.status is GapStatus.strong:
        return f"Walk me through a decision you made while using {g.name}. What alternatives did you consider?"
    return f"You'll use {g.name} in this role. What do you know about it so far, and how would you get productive in your first month?"


def company_questions(job_text: str, report: GapReport) -> list[PrepQuestion]:
    """Questions built from lines quoted from the posting. No outside claims about the company."""
    lines = posting_lines(job_text)
    who = report.job.company or "this company"
    out: list[PrepQuestion] = []
    about = [ln for sec, ln in lines if sec == "about" and not re.search(r"\b(benefits?|perks?|insurance|leave|salary)\b", ln, re.I)]
    if about:
        out.append(PrepQuestion(question=f"Why do you want to work at {who}? Connect your answer to what the posting says they do.",
                                theme="Company", source="posting", quote=about[0]))
    duties = [ln for sec, ln in lines if sec == "duties"]
    for ln in duties[:3]:
        out.append(PrepQuestion(question="This role involves the line quoted below. Tell me about something you've done that's close to it, "
                                         "and what you'd still need to learn.", theme="Role", source="posting", quote=ln))
    seen = {q.quote for q in out}
    fundamentals: dict[str, list[str]] = {}
    for g in report.gaps:
        if g.importance is not Importance.must or not g.job_evidence or g.category in ("soft", "process"):
            continue
        quote = g.job_evidence[0].text
        if g.category == "cs_fundamentals":
            fundamentals.setdefault(quote, []).append(g.name)
            continue
        if quote in seen:
            continue
        seen.add(quote)
        out.append(PrepQuestion(question=_skill_question(g, quote), theme=g.name, source="posting", quote=quote))
    for quote, names in fundamentals.items():
        listed = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
        out.append(PrepQuestion(
            question=f"Be ready to explain the core ideas of {listed}, with "
                     f"{'an example' if len(names) == 1 else 'one example each'} from your projects or coursework.",
            theme=names[0] if len(names) == 1 else "CS fundamentals", source="posting", quote=quote))
    return out[:10]


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower().strip(" .;:")


def grounded(quote: str, job_text: str) -> bool:
    """True if the quote really is in the posting (whitespace and case ignored)."""
    q = normalize(quote)
    return len(q) >= 12 and q in normalize(job_text)


# ---------- project ----------

def projects(report: GapReport, job: JobProfile, tax: Taxonomy, top: int = 3) -> list[ProjectIdea]:
    weights = {s.skill_id: s.weight for s in job.skills}
    gaps = {g.skill_id: g for g in report.gaps if g.status is not GapStatus.strong}
    for g in list(gaps.values()):  # 'Java, Go or C++' collapsed into one line: its options count too
        for name in g.alternatives:
            sid = tax.resolve(name)
            if sid and sid not in gaps:
                gaps[sid] = g
    have = {s.skill_id for s in report.candidate.skills if s.level >= 2}
    ideas = []
    for p in load_prep()["projects"]:
        covers = [s for s in p["skills"] if s in gaps]
        builds = [s for s in p["skills"] if s in have]
        unrelated = [s for s in p["skills"] if s not in weights and s not in have]
        score = sum(weights.get(s, 1.0 if gaps[s].importance is Importance.must else 0.4)
                    * gaps[s].gap / max(gaps[s].required_level, 0.5) for s in covers)
        score += 0.15 * len(builds) - 0.05 * len(unrelated)
        if not covers:
            score = 0.1 * len([s for s in p["skills"] if s in weights])  # no gaps left: practise what the job uses
        ideas.append(ProjectIdea(id=p["id"], title=p["title"], pitch=p["pitch"], hours=p["hours"],
                                 covers=[tax.get(s).name for s in covers], builds_on=[tax.get(s).name for s in builds],
                                 milestones=p["milestones"], stretch=p.get("stretch", []), score=round(score, 3)))
    ideas.sort(key=lambda i: (-i.score, i.title))
    return [i for i in ideas if i.score > 0][:top]


# ---------- schedule ----------

SHARES = {"dsa": 0.45, "core": 0.25, "project": 0.30}
MIN_CHUNK = 1.5


def schedule(dsa: DSAPlan, core: list[CoreSubject], aptitude: list[AptitudeArea], project: ProjectIdea | None,
             hours_per_week: float, max_weeks: int = 26) -> list[PrepWeek]:
    queues: dict[str, list[list]] = {"dsa": [], "core": [], "project": []}
    for t in dsa.topics if dsa.included else []:
        queues["dsa"].append(["dsa", t.id, t.name + (" (review)" if t.review else ""), t.hours])
    for c in core:
        queues["core"].append(["core", c.skill_id, f"{c.name}: revise core topics", c.hours])
    for a in aptitude:
        queues["core"].append(["aptitude", a.area, f"Aptitude: {a.area}", a.hours])
    if project:
        per = round(project.hours / len(project.milestones), 1)
        for i, m in enumerate(project.milestones):
            queues["project"].append(["project", f"{project.id}:{i}", m, per])

    weeks: list[list[WeekItem]] = []
    while any(queues.values()) and len(weeks) < max_weeks:
        active = {k: v for k, v in SHARES.items() if queues[k]}
        total = sum(active.values())
        items: list[WeekItem] = []
        left = hours_per_week
        # First pass by share; second pass lets any queue use the time left over.
        for first in (True, False):
            for k in active:
                budget = min(hours_per_week * active[k] / total if first else left, left)
                while queues[k] and budget >= 0.5:
                    kind, ref, title, hours = queues[k][0]
                    if first and hours > budget and budget < MIN_CHUNK:
                        break  # don't start a big item with a sliver of time
                    take = max(0.5, round(min(hours, budget) * 2) / 2)
                    _add(items, WeekItem(kind=kind, ref=ref, title=title, hours=take))
                    budget -= take
                    left -= take
                    if take >= hours - 0.01:
                        queues[k].pop(0)
                    else:
                        queues[k][0][3] = round(hours - take, 1)
            if left < 0.5:
                break
        weeks.append(items)
    # Label items that span several weeks: "Graphs (part 2 of 3)".
    chunks: dict[str, int] = {}
    for items in weeks:
        for it in items:
            chunks[it.ref] = chunks.get(it.ref, 0) + 1
    seen: dict[str, int] = {}
    out = []
    for n, items in enumerate(weeks, 1):
        for it in items:
            if chunks[it.ref] > 1:
                seen[it.ref] = seen.get(it.ref, 0) + 1
                it.title = f"{it.title} (part {seen[it.ref]} of {chunks[it.ref]})"
        out.append(PrepWeek(week=n, hours=round(sum(i.hours for i in items), 1), items=items))
    return out


def _add(items: list[WeekItem], item: WeekItem) -> None:
    for it in items:
        if it.ref == item.ref:
            it.hours += item.hours
            return
    items.append(item)
