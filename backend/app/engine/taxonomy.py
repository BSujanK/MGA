"""Skill taxonomy: canonical skills, aliases, and the related-skill graph.

All skill text (from job descriptions, resumes, or the AI extractor) is
normalized to a canonical skill id here, so "ReactJS", "React.js" and
"React" all become the same skill.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Characters that may not touch a match, so "C" doesn't match inside "C++"
# and "Java" doesn't match inside "JavaScript". "/" and a trailing "-" are
# allowed so "HTML/CSS" and "Python-based" still match.
_BEFORE = r"(?<![A-Za-z0-9+#\-_.])"
_AFTER = r"(?![A-Za-z0-9+#_&])"
# Very short case-sensitive aliases ("Go", "C", "R") match only when they sit
# next to list punctuation, e.g. "Python, Go, Rust" or "(Go)".
_LIST_SEP = set(",/()|;:•·")
_PREV_WORDS = {"in", "with", "using", "strong", "proficient", "proficiency"}
_NEXT_WORDS = {"skills", "developer", "developers", "programming", "services", "service", "code", "language",
               "backend", "microservices", "engineer", "engineers", "programs", "programmer"}


@dataclass
class Skill:
    id: str
    name: str
    category: str
    aliases: list[str]
    exact: list[str]
    related: dict[str, float]
    hours: float
    implies: list[str] = field(default_factory=list)
    external_ids: dict[str, str] = field(default_factory=dict)


@dataclass
class Match:
    skill_id: str
    alias: str
    start: int
    end: int


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


class Taxonomy:
    def __init__(self, skills: list[Skill]):
        self.skills: dict[str, Skill] = {s.id: s for s in skills}
        self._lookup: dict[str, str] = {}
        for s in skills:
            for key in [s.id, s.name, *s.aliases, *s.exact]:
                self._lookup.setdefault(_norm(key), s.id)
        self._alias_owner: dict[str, str] = {}
        parts: list[tuple[int, str]] = []
        for s in skills:
            for a in s.aliases:
                parts.append((len(a), f"(?i:{re.escape(a)})"))
                self._alias_owner[a.lower()] = s.id
            for a in s.exact:
                parts.append((len(a), re.escape(a)))
                self._alias_owner["\0" + a] = s.id
        # Longest alias first so "react native" wins over "react".
        parts.sort(key=lambda p: -p[0])
        self._pattern = re.compile(_BEFORE + "(" + "|".join(p for _, p in parts) + ")" + _AFTER)

    def get(self, skill_id: str) -> Skill:
        return self.skills[skill_id]

    def resolve(self, phrase: str) -> str | None:
        """Map a free-text skill name (e.g. from the AI extractor) to a skill id."""
        key = _norm(phrase)
        if key in self._lookup:
            return self._lookup[key]
        # Try without trailing version numbers / qualifiers: "Python 3.11", "React 18".
        stripped = re.sub(r"[\s\-]*v?\d+(\.\d+)*\+?$", "", key).strip()
        if stripped and stripped in self._lookup:
            return self._lookup[stripped]
        # Try matching an alias inside the phrase ("experience with Docker containers").
        found = self.find(phrase)
        ids = {m.skill_id for m in found}
        return ids.pop() if len(ids) == 1 else None

    def _owner(self, text: str) -> str | None:
        return self._alias_owner.get("\0" + text) or self._alias_owner.get(text.lower())

    def find(self, text: str) -> list[Match]:
        out: list[Match] = []
        for m in self._pattern.finditer(text):
            alias = m.group(1)
            sid = self._owner(alias)
            if sid is None:
                continue
            if len(alias) <= 2 and alias in self.skills[sid].exact and not (
                    self._in_list(text, m.start(1), m.end(1)) or self._in_prose(text, m.start(1), m.end(1))):
                continue
            out.append(Match(sid, alias, m.start(1), m.end(1)))
        return out

    @staticmethod
    def _in_list(text: str, start: int, end: int) -> bool:
        before = text[max(0, start - 2):start].strip()
        after = text[end:end + 2].strip()
        return bool((before and before[-1] in _LIST_SEP) or (after and after[0] in _LIST_SEP | {"."}))

    @staticmethod
    def _in_prose(text: str, start: int, end: int) -> bool:
        """'written in Go', 'strong Go skills': clear programming context, never at the start of a sentence."""
        before = text[:start].rstrip()
        if not before or before[-1] in ".!?:":
            return False
        prev = re.findall(r"[A-Za-z]+", before[-20:])
        nxt = re.match(r"\s+([A-Za-z]+)", text[end:end + 24])
        return bool((prev and prev[-1].lower() in _PREV_WORDS) or (nxt and nxt.group(1).lower() in _NEXT_WORDS))

    def related_to(self, skill_id: str) -> dict[str, float]:
        return self.skills[skill_id].related


@lru_cache(maxsize=1)
def load_taxonomy(path: str | None = None) -> Taxonomy:
    p = Path(path) if path else DATA_DIR / "skills.json"
    raw = json.loads(p.read_text())
    skills = [
        Skill(
            id=s["id"], name=s["name"], category=s["category"],
            aliases=s.get("aliases", []), exact=s.get("exact", []),
            related=s.get("related", {}), hours=float(s.get("hours", 20)), implies=s.get("implies", []),
            external_ids=s.get("external_ids", {}),
        )
        for s in raw["skills"]
    ]
    return Taxonomy(skills)
