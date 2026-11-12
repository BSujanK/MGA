"""Resume structure for the tuner: parse, reorder by job relevance, guard rewrites.

Everything here is deterministic. The tuner never adds a skill, tool or number
that is not already in the candidate's resume or their own interview answers:
`check_rewrite` re-extracts skills and numbers from every rewritten line and
rejects any line that brings in something its source does not have.
"""
from __future__ import annotations

import re

from ..models import JobProfile, ResumeEntry, ResumeLine, ResumeSection
from .extractor import APPLIED, RESUME_SECTIONS, _BULLET, _is_header
from .taxonomy import Taxonomy

# Sections whose entries can move: the most relevant project goes first.
REORDER_ENTRIES = {"projects", "achievements", "certifications", "answers"}
# Sections where each line stands alone (no bullets, no headings).
FLAT = {"skills", "summary"}


# ---------- parsing ----------

def parse_resume(text: str) -> tuple[list[str], list[ResumeSection]]:
    """Split resume text into header lines (name, contact) and sections of entries."""
    header: list[str] = []
    sections: list[ResumeSection] = []
    cur: ResumeSection | None = None
    for raw in text.splitlines():
        if not raw.strip():
            continue
        is_bullet = bool(_BULLET.match(raw))
        body = re.sub(r"\s+", " ", _BULLET.sub("", raw)).strip()
        if not body:
            continue
        key = None if is_bullet else _is_header(body, RESUME_SECTIONS)
        if key:
            cur = ResumeSection(key=key, title=body.rstrip(":").strip(), entries=[])
            sections.append(cur)
            continue
        if cur is None:
            header.append(body)
            continue
        si, ei = len(sections) - 1, len(cur.entries)
        if cur.key in FLAT:
            cur.entries.append(ResumeEntry(heading=[ResumeLine(id=f"s{si}e{ei}h0", text=body)]))
            continue
        last = cur.entries[-1] if cur.entries else None
        descriptive = is_bullet or len(body) >= 60 or bool(APPLIED.match(body))
        if descriptive:
            if last is not None and last.heading:
                last.bullets.append(ResumeLine(id=f"s{si}e{ei - 1}b{len(last.bullets)}", text=body))
            else:
                cur.entries.append(ResumeEntry(bullets=[ResumeLine(id=f"s{si}e{ei}b0", text=body)]))
        elif last is not None and last.heading and not last.bullets:
            # A short line right under a title is part of it: dates, company, stack.
            last.heading.append(ResumeLine(id=f"s{si}e{ei - 1}h{len(last.heading)}", text=body))
        else:
            cur.entries.append(ResumeEntry(heading=[ResumeLine(id=f"s{si}e{ei}h0", text=body)]))
    return header, sections


def all_lines(sections: list[ResumeSection]):
    for s in sections:
        for e in s.entries:
            yield from e.heading
            yield from e.bullets


# ---------- relevance ----------

def implied_closure(ids: set[str], tax: Taxonomy) -> set[str]:
    out = set(ids)
    stack = list(ids)
    while stack:
        for imp in tax.get(stack.pop()).implies:
            if imp not in out:
                out.add(imp)
                stack.append(imp)
    return out


def skill_ids(text: str, tax: Taxonomy) -> set[str]:
    return {m.skill_id for m in tax.find(text)}


def job_weights(job: JobProfile) -> dict[str, float]:
    return {s.skill_id: s.weight for s in job.skills}


def line_relevance(text: str, weights: dict[str, float], tax: Taxonomy) -> tuple[float, list[str]]:
    """Weight of the job skills a line shows. Implied skills (Spring Boot -> Java) count half."""
    direct = skill_ids(text, tax)
    implied = implied_closure(direct, tax) - direct
    score = sum(weights.get(i, 0.0) for i in direct) + 0.5 * sum(weights.get(i, 0.0) for i in implied)
    names = [tax.get(i).name for i in sorted(direct | implied) if i in weights]
    return round(score, 3), names


def _split_items(s: str) -> list[str]:
    """Split on commas that are not inside parentheses."""
    out, depth, buf = [], 0, ""
    for ch in s:
        depth += ch == "("
        depth -= ch == ")"
        if ch == "," and depth <= 0:
            out.append(buf.strip())
            buf = ""
        else:
            buf += ch
    out.append(buf.strip())
    return [x for x in out if x]


def reorder_skill_line(text: str, weights: dict[str, float], tax: Taxonomy) -> str:
    """'Languages: C, Python, Java' -> job-relevant items first, others keep their order."""
    m = re.match(r"^([^:]{1,40}:\s*)(.+)$", text)
    label, body = (m.group(1), m.group(2)) if m else ("", text)
    items = _split_items(body)
    if len(items) < 2:
        return text
    scored = [(-line_relevance(it, weights, tax)[0], i, it) for i, it in enumerate(items)]
    return label + ", ".join(it for _, _, it in sorted(scored))


def _entry_relevance(e: ResumeEntry) -> float:
    rels = sorted((ln.relevance for ln in [*e.heading, *e.bullets]), reverse=True)
    return round(rels[0] + 0.25 * sum(rels[1:]), 3) if rels else 0.0


def tailor_sections(sections: list[ResumeSection], job: JobProfile, tax: Taxonomy) -> list[ResumeSection]:
    """Score every line against the job and reorder where order is free to change.

    Section order is kept (it is the candidate's choice); roles in Experience
    keep their chronological order, only their bullets move.
    """
    w = job_weights(job)
    out: list[ResumeSection] = []
    for s in sections:
        s = s.model_copy(deep=True)
        for e in s.entries:
            for ln in [*e.heading, *e.bullets]:
                if s.key == "skills":
                    new = reorder_skill_line(ln.text, w, tax)
                    if new != ln.text:
                        ln.text = new
                ln.relevance, ln.skills = line_relevance(ln.text, w, tax)
            e.bullets.sort(key=lambda ln: -ln.relevance)  # stable: ties keep resume order
            e.relevance = _entry_relevance(e)
        movable = s.key in REORDER_ENTRIES or s.key == "skills" or (
            s.key == "experience" and not any(e.heading for e in s.entries))
        if movable:
            # Lines MGA added (keywords) stay last so the candidate's own lines lead.
            s.entries.sort(key=lambda e: (any(ln.source == "added" for ln in e.heading), -e.relevance))
        out.append(s)
    return out


# ---------- guardrail ----------

_NUMBER_WORDS = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve".split())}
_NUM = re.compile(r"\d+(?:[.,]\d+)*")


def numbers(text: str) -> set[str]:
    found = {n.replace(",", "") for n in _NUM.findall(text)}
    for word in re.findall(r"[a-z]+", text.lower()):
        if word in _NUMBER_WORDS:
            found.add(_NUMBER_WORDS[word])
    return found


def check_rewrite(source: str, new: str, tax: Taxonomy) -> str | None:
    """Return why a rewrite is not allowed, or None if it only rewords what the source says."""
    if not new.strip():
        return "the rewrite was empty"
    allowed = implied_closure(skill_ids(source, tax), tax)
    extra = skill_ids(new, tax) - allowed
    if extra:
        names = ", ".join(sorted(tax.get(i).name for i in extra))
        return f"it mentions {names}, which the original line does not"
    new_nums = {n for n in _NUM.findall(new)}
    extra_nums = {n.replace(",", "") for n in new_nums} - numbers(source)
    if extra_nums:
        return f"it adds the number(s) {', '.join(sorted(extra_nums))}, which the original line does not have"
    if len(new) > 2.5 * len(source) + 80:
        return "it is much longer than the original, so it likely adds claims"
    return None


# ---------- coverage and rendering ----------

def keyword_coverage(text: str, job: JobProfile, tax: Taxonomy) -> tuple[float, set[str]]:
    """Weighted share of job skills the text names (literally, as an ATS would see it)."""
    present = skill_ids(text, tax)
    num = den = 0.0
    matched: set[str] = set()
    for s in job.skills:
        den += s.weight
        if s.skill_id in present or any(a in present for a in s.alternatives):
            num += s.weight
            if s.skill_id in present:
                matched.add(s.skill_id)
    return (round(100 * num / den, 1) if den else 0.0), matched


def render_text(header: list[str], sections: list[ResumeSection]) -> str:
    out: list[str] = list(header)
    for s in sections:
        if not s.entries:
            continue
        out += ["", s.title.upper()]
        for e in s.entries:
            out += [ln.text for ln in e.heading]
            out += [f"- {ln.text}" for ln in e.bullets]
    return "\n".join(out).strip() + "\n"
