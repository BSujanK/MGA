"""Check every URL in the learning-resource catalog. Run before releases:
    python scripts/check_links.py
Exits non-zero if any link is broken. Some sites block bots (403); those are
reported as 'blocked' and should be checked by hand in a browser."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

CATALOG = Path(__file__).resolve().parent.parent / "app" / "data" / "resources.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (link checker)"}


def check(url: str) -> tuple[str, str]:
    try:
        r = httpx.get(url, headers=HEADERS, follow_redirects=True, timeout=20)
        if r.status_code < 400:
            return url, "ok"
        return url, "blocked" if r.status_code in (401, 403, 429) else f"broken ({r.status_code})"
    except httpx.HTTPError as e:
        return url, f"error ({type(e).__name__})"


def main() -> int:
    data = json.loads(CATALOG.read_text())
    urls = sorted({r["url"] for items in data["resources"].values() for r in items})
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(check, urls))
    bad = [(u, s) for u, s in results if s != "ok"]
    for u, s in bad:
        print(f"{s:16} {u}")
    print(f"{len(urls) - len(bad)}/{len(urls)} ok")
    return 1 if any(s.startswith(("broken", "error")) for _, s in bad) else 0


if __name__ == "__main__":
    sys.exit(main())
