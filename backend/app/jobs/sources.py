"""Live job sources that publish postings openly for job seekers.

Greenhouse and Lever expose each customer's public job board as JSON with no
login. We fetch one company board at a time, by its board token / slug.
Never scrape sites whose terms forbid it (e.g. LinkedIn, Naukri).
"""
from __future__ import annotations

import html
import re

import httpx

from ..models import JobPosting

_TAG = re.compile(r"<[^>]+>")


def _clean(s: str) -> str:
    s = html.unescape(s or "")
    s = re.sub(r"<\s*(br|/p|/li|/h\d)\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<\s*li[^>]*>", "\n- ", s, flags=re.I)
    s = _TAG.sub("", s)
    return re.sub(r"\n\s*\n+", "\n", s).strip()


def fetch_greenhouse(board_token: str, timeout: float = 20.0) -> list[JobPosting]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs"
    r = httpx.get(url, params={"content": "true"}, timeout=timeout)
    r.raise_for_status()
    out = []
    for j in r.json().get("jobs", []):
        out.append(JobPosting(
            id=f"gh-{board_token}-{j['id']}", title=j.get("title", ""), company=board_token,
            location=(j.get("location") or {}).get("name", ""), apply_url=j.get("absolute_url"),
            posted_at=j.get("updated_at"), source="greenhouse", description=_clean(j.get("content", "")),
        ))
    return out


def fetch_lever(company: str, timeout: float = 20.0) -> list[JobPosting]:
    url = f"https://api.lever.co/v0/postings/{company}"
    r = httpx.get(url, params={"mode": "json"}, timeout=timeout)
    r.raise_for_status()
    out = []
    for j in r.json():
        parts = [j.get("descriptionPlain") or _clean(j.get("description", ""))]
        for lst in j.get("lists", []):
            parts.append(lst.get("text", ""))
            parts.append(_clean(lst.get("content", "")))
        parts.append(j.get("additionalPlain") or "")
        cats = j.get("categories") or {}
        out.append(JobPosting(
            id=f"lever-{company}-{j['id']}", title=j.get("text", ""), company=company,
            location=cats.get("location", ""), employment_type=cats.get("commitment"),
            apply_url=j.get("hostedUrl"), source="lever", description="\n".join(p for p in parts if p),
        ))
    return out
