"""Rule-based extraction of skills from job descriptions and resumes.

This is the deterministic baseline. It runs with no API key, is fast enough
to process thousands of postings, and is what the tests pin down. The AI
extractor (app/llm.py) adds context-aware levels on top when enabled.
"""
from __future__ import annotations

import re
from collections import defaultdict

from ..models import (
    CandidateProfile, CandidateSkill, Evidence, Importance, JobProfile, JobSkill,
)
from .taxonomy import Taxonomy

# ---------- line / section handling ----------

_BULLET = re.compile(r"^\s*(?:[-*•·▪➤►]|\d+[.)])\s*")

JOB_SECTIONS = {
    "must": re.compile(r"\b(requirements?|required|must[\s-]have|qualifications?|what you('|’)ll need|what we('|’)re looking for|skills required|eligibility|who you are|minimum)\b", re.I),
    "nice": re.compile(r"\b(nice[\s-]to[\s-]have|good[\s-]to[\s-]have|preferred|bonus|plus points?|desired|optional|added advantage)\b", re.I),
    "duties": re.compile(r"\b(responsibilit(y|ies)|what you('|’)ll do|role overview|the role|day[\s-]to[\s-]day|key result areas?)\b", re.I),
    "about": re.compile(r"\b(about (us|the company)|who we are|benefits|perks|why join)\b", re.I),
}

RESUME_SECTIONS = {
    "skills": re.compile(r"\b(technical skills|skills|tech stack|technologies|tools|core competencies|languages)\b", re.I),
    "experience": re.compile(r"\b(experience|employment|internships?|work history)\b", re.I),
    "projects": re.compile(r"\b(projects?|personal projects|academic projects)\b", re.I),
    "certifications": re.compile(r"\b(certifications?|courses|coursework|training|licenses)\b", re.I),
    "education": re.compile(r"\b(education|academics?|qualifications?)\b", re.I),
    "achievements": re.compile(r"\b(achievements?|awards|hackathons?|competitions?|accomplishments)\b", re.I),
    "summary": re.compile(r"\b(summary|objective|profile|about me)\b", re.I),
}

NICE_CUES = re.compile(r"\b(nice to have|good to have|preferred|is a plus|are a plus|a plus|bonus|added advantage|optional|desirable|ideally|exposure to)\b", re.I)
MUST_CUES = re.compile(r"\b(must|required|mandatory|essential|need to|should have|strong|proficien\w*|solid|hands[\s-]on)\b", re.I)

LEVEL_CUES: list[tuple[re.Pattern, float]] = [
    (re.compile(r"\b(expert|expertise|mastery|deep (knowledge|understanding|expertise)|advanced)\b", re.I), 4.0),
    (re.compile(r"\b(strong|proficien\w*|solid|excellent|in[\s-]depth|extensive|hands[\s-]on)\b", re.I), 3.5),
    (re.compile(r"\b(experience (with|in)|working knowledge|good (knowledge|understanding)|comfortable)\b", re.I), 3.0),
    (re.compile(r"\b(familiar\w*|basic|basics|exposure|understanding of|knowledge of|awareness|fundamentals)\b", re.I), 2.0),
]
OR_CUE = re.compile(r"\b(or|either|one of|any of|any one of|such as)\b|/", re.I)
YEARS = re.compile(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:-|to)?\s*(?:\d+\s*)?(?:years?|yrs?)", re.I)

RESUME_LEVEL_CUES: list[tuple[re.Pattern, float]] = [
    (re.compile(r"\b(expert|advanced|proficient)\b", re.I), 4.0),
    (re.compile(r"\b(intermediate|working knowledge|good)\b", re.I), 3.0),
    (re.compile(r"\b(beginner|basic|basics|familiar|learning|exposure)\b", re.I), 2.0),
]
# Verbs that show the skill was used to build something.
APPLIED = re.compile(r"\b(built|developed|implemented|designed|deployed|created|engineered|architected|automated|optimi[sz]ed|migrated|integrated|led|shipped|launched|trained|fine[\s-]tuned|wrote|maintained|scaled|reduced|improved)\b", re.I)


def _lines(text: str) -> list[str]:
    raw = re.split(r"[\r\n]+", text)
    out: list[str] = []
    for line in raw:
        line = _BULLET.sub("", line).strip()
        if not line:
            continue
        # Split long prose paragraphs into sentences, keep lists intact.
        if len(line) > 220:
            out.extend(s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", line) if s.strip())
        else:
            out.append(line)
    return out


def _is_header(line: str, patterns: dict[str, re.Pattern]) -> str | None:
    """A short line that names a section, e.g. 'Requirements:' or 'PROJECTS'."""
    stripped = line.rstrip(":").strip()
    if len(stripped) > 45 or stripped.count(" ") > 5 or "," in stripped:
        return None
    if re.search(r"[:\-–]\s*\S", stripped):  # "Skills: Python" is content, not a header
        return None
    for name, pat in patterns.items():
        if pat.search(stripped):
            return name
    return None


def _inline_header(line: str, patterns: dict[str, re.Pattern]) -> tuple[str | None, str]:
    """Handle 'Skills: Python, Java' or 'Nice to have - Docker'."""
    m = re.match(r"^([A-Za-z][A-Za-z '’/&-]{1,40})\s*[:\-–]\s+(.+)$", line)
    if m:
        for name, pat in patterns.items():
            if pat.search(m.group(1)):
                return name, m.group(2)
    return None, line


def _level_from(line: str, cues: list[tuple[re.Pattern, float]]) -> float | None:
    for pat, lvl in cues:
        if pat.search(line):
            return lvl
    return None


def _years(line: str) -> float | None:
    m = YEARS.search(line)
    return float(m.group(1)) if m else None


# ---------- job descriptions ----------

# Process and soft skills matter, but a missing "Agile" should never outrank
# a missing core technical skill in the plan or move readiness as much.
CATEGORY_WEIGHT = {"soft": 0.5, "process": 0.5, "tools": 0.7}

def extract_job(text: str, tax: Taxonomy, title: str | None = None, company: str | None = None) -> JobProfile:
    section = "must"  # postings that never label sections are treated as requirements
    found: dict[str, dict] = {}
    for line in _lines(text):
        header = _is_header(line, JOB_SECTIONS)
        if header:
            section = header
            continue
        inline, body = _inline_header(line, JOB_SECTIONS)
        line_section = inline or section
        matches = tax.find(body)
        if not matches:
            continue
        if line_section == "about":
            continue
        # Explicit signals (section label or wording) beat a passing mention in duties.
        if line_section == "nice" or (NICE_CUES.search(body) and not MUST_CUES.search(body)):
            importance, explicit = Importance.nice, True
        else:
            importance, explicit = Importance.must, line_section == "must" or bool(MUST_CUES.search(body))
        level = _level_from(body, LEVEL_CUES)
        years = _years(body)
        if level is None:
            level = 3.0 if importance is Importance.must else 2.0
        if years is not None:
            level = max(level, 3.0 if years < 3 else 4.0)
        if line_section == "duties" and importance is Importance.must:
            level = max(level, 3.0)
        alt_groups = _alternative_groups(body, matches, tax)
        for m in matches:
            rec = found.setdefault(m.skill_id, {"levels": {}, "years": None, "mentions": 0, "evidence": [], "alts": set()})
            rec["alts"] |= alt_groups.get(m.skill_id, set())
            rec["mentions"] += 1
            key = (importance.value, explicit)
            rec["levels"][key] = max(rec["levels"].get(key, 0.0), level)
            if years is not None:
                rec["years"] = max(rec["years"] or 0, years)
            if len(rec["evidence"]) < 3 and body not in [e.text for e in rec["evidence"]]:
                rec["evidence"].append(Evidence(text=body[:300], section=line_section))

    skills: list[JobSkill] = []
    for sid, rec in found.items():
        sk = tax.get(sid)
        # Precedence: explicit must > explicit nice > must implied by duties.
        for key in (("must", True), ("nice", True), ("must", False), ("nice", False)):
            if key in rec["levels"]:
                rec["importance"], rec["level"] = Importance(key[0]), rec["levels"][key]
                break
        base = (1.0 if rec["importance"] is Importance.must else 0.4) * CATEGORY_WEIGHT.get(sk.category, 1.0)
        alts = sorted(a for a in rec["alts"] if a in found)
        # "Java, Go, Python or C++" is one requirement, not four: split its weight.
        weight = round(base * min(1.3, 1 + 0.1 * (rec["mentions"] - 1)) / (1 + len(alts)), 3)
        skills.append(JobSkill(
            skill_id=sid, name=sk.name, category=sk.category, importance=rec["importance"],
            required_level=min(5.0, rec["level"]), weight=weight, years=rec["years"], alternatives=alts,
            evidence=rec["evidence"],
        ))
    skills.sort(key=lambda s: (s.importance != Importance.must, -s.weight, s.name))
    return JobProfile(title=title, company=company, skills=skills, extractor="rules")


def _alternative_groups(line: str, matches, tax: Taxonomy) -> dict[str, set[str]]:
    """Skills of the same category joined by 'or' / '/' / 'one of' are interchangeable.

    'SQL (MySQL or PostgreSQL)' -> MySQL and PostgreSQL are alternatives.
    'Docker, Kafka or AWS' -> different categories, so each is its own requirement.
    """
    if not OR_CUE.search(line):
        return {}
    by_cat: dict[str, set[str]] = defaultdict(set)
    for m in matches:
        by_cat[tax.get(m.skill_id).category].add(m.skill_id)
    out: dict[str, set[str]] = {}
    for ids in by_cat.values():
        # A parent skill named next to its own variants ("SQL (MySQL or PostgreSQL)")
        # is a separate requirement, not an alternative.
        ids = {i for i in ids if not any(i in tax.get(o).implies for o in ids if o != i)}
        if len(ids) > 1:
            for i in ids:
                out[i] = ids - {i}
    return out


# ---------- resumes ----------

SECTION_BASE = {
    "skills": 2.0,          # listed only: claimed, not yet shown
    "certifications": 2.0,
    "education": 1.5,
    "summary": 2.0,
    "projects": 3.0,        # used to build something
    "experience": 3.0,
    "achievements": 3.0,
}


def extract_resume(text: str, tax: Taxonomy) -> CandidateProfile:
    section = "summary"
    recs: dict[str, dict] = defaultdict(lambda: {"evidence": [], "claimed": None, "best": 0.0, "applied": 0, "sections": set()})
    for line in _lines(text):
        header = _is_header(line, RESUME_SECTIONS)
        if header:
            section = header
            continue
        inline, body = _inline_header(line, RESUME_SECTIONS)
        line_section = inline or section
        matches = tax.find(body)
        if not matches:
            continue
        base = SECTION_BASE.get(line_section, 2.0)
        applied = bool(APPLIED.search(body))
        if line_section in ("summary", "education") and applied:
            base = 2.5
        claimed = _level_from(body, RESUME_LEVEL_CUES) if line_section == "skills" else None
        for m in {m.skill_id: m for m in matches}.values():
            r = recs[m.skill_id]
            r["sections"].add(line_section)
            r["best"] = max(r["best"], base)
            if line_section in ("projects", "experience", "achievements"):
                r["applied"] += 1
            if claimed is not None:
                r["claimed"] = max(r["claimed"] or 0, claimed)
            if len(r["evidence"]) < 3 and body not in [e.text for e in r["evidence"]]:
                r["evidence"].append(Evidence(text=body[:300], section=line_section))

    skills: list[CandidateSkill] = []
    for sid, r in recs.items():
        sk = tax.get(sid)
        level = r["best"]
        # Each extra place the skill was actually used adds confidence, capped at 4.
        if r["applied"] > 1:
            level = min(4.0, level + 0.5 * (r["applied"] - 1))
        claimed = r["claimed"]
        if claimed is not None:
            # A self-rating can lift a level by at most one step above the evidence.
            level = max(level, min(claimed, level + 1.0))
        skills.append(CandidateSkill(
            skill_id=sid, name=sk.name, category=sk.category,
            level=round(level, 2), claimed_level=claimed, evidence=r["evidence"],
        ))
    skills = add_implied(skills, tax)
    skills.sort(key=lambda s: (-s.level, s.name))
    return CandidateProfile(skills=skills, extractor="rules")


def add_implied(skills: list[CandidateSkill], tax: Taxonomy) -> list[CandidateSkill]:
    """Building with Spring Boot shows Java; using MySQL shows SQL."""
    by_id = {s.skill_id: s for s in skills}
    changed = True
    while changed:  # follow chains: Next.js -> React -> JavaScript
        changed = False
        for s in list(by_id.values()):
            for imp in tax.get(s.skill_id).implies:
                cur = by_id.get(imp)
                if cur is None or cur.level < s.level:
                    sk = tax.get(imp)
                    ev = (cur.evidence if cur else []) + [Evidence(text=f"Implied by {s.name}", section="implied")]
                    by_id[imp] = CandidateSkill(skill_id=imp, name=sk.name, category=sk.category, level=s.level,
                                                claimed_level=cur.claimed_level if cur else None, evidence=ev[:3])
                    changed = True
    return list(by_id.values())
