"""Live job sources that publish postings openly for job seekers.

Greenhouse and Lever expose each customer's public job board as JSON with no
login. We fetch one company board at a time, by its board token / slug.
Adzuna is a job search engine with an official API (needs a free app id and
key, and requires a visible "Jobs by Adzuna" attribution next to its results).
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


USER_AGENT = "MGA-job-ingest/0.2 (+public job boards only)"


def _client(client: httpx.Client | None) -> httpx.Client:
    return client or httpx.Client(timeout=20.0, headers={"User-Agent": USER_AGENT}, follow_redirects=True)


def fetch_greenhouse(board_token: str, company: str | None = None, client: httpx.Client | None = None) -> list[JobPosting]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs"
    r = _client(client).get(url, params={"content": "true"})
    r.raise_for_status()
    out = []
    for j in r.json().get("jobs", []):
        out.append(JobPosting(
            id=f"gh-{board_token}-{j['id']}", title=j.get("title", ""), company=company or board_token,
            location=(j.get("location") or {}).get("name", ""), apply_url=j.get("absolute_url"),
            posted_at=j.get("updated_at"), source="greenhouse", description=_clean(j.get("content", "")),
        ))
    return out


def fetch_lever(slug: str, company: str | None = None, client: httpx.Client | None = None) -> list[JobPosting]:
    url = f"https://api.lever.co/v0/postings/{slug}"
    r = _client(client).get(url, params={"mode": "json"})
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
            id=f"lever-{slug}-{j['id']}", title=j.get("text", ""), company=company or slug,
            location=cats.get("location", ""), employment_type=cats.get("commitment"),
            apply_url=j.get("hostedUrl"), source="lever", description="\n".join(p for p in parts if p),
        ))
    return out


def fetch_adzuna(what: str, where: str | None = None, pages: int = 1, country: str = "in",
                 app_id: str | None = None, app_key: str | None = None,
                 client: httpx.Client | None = None) -> list[JobPosting]:
    """Search Adzuna's official API. Descriptions are snippets, so extraction sees less text than ATS boards."""
    if not (app_id and app_key):
        raise ValueError("Set ADZUNA_APP_ID and ADZUNA_APP_KEY")
    c = _client(client)
    out: list[JobPosting] = []
    for page in range(1, pages + 1):
        params = {"app_id": app_id, "app_key": app_key, "what": what, "results_per_page": 50,
                  "content-type": "application/json"}
        if where:
            params["where"] = where
        r = c.get(f"https://api.adzuna.com/v1/api/jobs/{country}/search/{page}", params=params)
        r.raise_for_status()
        results = r.json().get("results", [])
        for j in results:
            out.append(JobPosting(
                id=f"adzuna-{j['id']}", title=_clean(j.get("title", "")),
                company=(j.get("company") or {}).get("display_name") or "Unknown company",
                location=(j.get("location") or {}).get("display_name", ""),
                employment_type=j.get("contract_time"), apply_url=j.get("redirect_url"),
                posted_at=j.get("created"), source="adzuna", description=_clean(j.get("description", "")),
            ))
        if len(results) < 50:
            break
    return out
