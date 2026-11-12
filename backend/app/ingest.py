"""Pull postings from public job boards into the database.

    python -m app.ingest                      # every board in data/boards.json (+ Adzuna searches if keys are set)
    python -m app.ingest --source greenhouse --board <token> [--company "Name"]
    python -m app.ingest --adzuna "react developer" --where Pune --pages 2
    python -m app.ingest --reanalyze          # refresh stored profiles after a taxonomy/extractor change

Run it on a schedule (a cron job on the host, a Render/Railway cron, or a
Kubernetes CronJob). It is safe to run from several places at once: postings
are upserted by id, and each board's run is recorded in `ingest_runs`.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone

from .config import settings
from .db import SessionLocal
from .db.models import IngestRun, JobPostingRow
from .engine.taxonomy import DATA_DIR
from .jobs import sources
from .jobs.store import engine_version, get_store

log = logging.getLogger("mga.ingest")


def ingest_board(source: str, board: str, company: str | None = None, client=None) -> IngestRun:
    started = time.monotonic()
    run = IngestRun(source=source, board=board, fetched=0, created=0, updated=0, closed=0)
    try:
        if source == "greenhouse":
            jobs = sources.fetch_greenhouse(board, company=company, client=client)
        elif source == "lever":
            jobs = sources.fetch_lever(board, company=company, client=client)
        else:
            raise ValueError(f"Unknown source {source}")
        store = get_store()
        run.fetched = len(jobs)
        for j in jobs:
            status = store.add(j, board=board, external_id=j.id)
            run.created += status == "created"
            run.updated += status == "updated"
        run.closed = store.close_missing(source, board, {j.id for j in jobs})
    except Exception as e:  # one bad board must not stop the others
        run.error = f"{type(e).__name__}: {e}"[:2000]
        log.warning("ingest %s/%s failed: %s", source, board, run.error)
    return _record(run, started)


def ingest_adzuna(what: str, where: str | None = None, pages: int = 1, client=None) -> IngestRun:
    started = time.monotonic()
    board = f"{what} @ {where or 'India'}"[:120]
    run = IngestRun(source="adzuna", board=board, fetched=0, created=0, updated=0, closed=0)
    try:
        s = settings()
        jobs = sources.fetch_adzuna(what, where, pages, app_id=s.adzuna_app_id, app_key=s.adzuna_app_key, client=client)
        store = get_store()
        run.fetched = len(jobs)
        for j in jobs:
            status = store.add(j, board=board, external_id=j.id)
            run.created += status == "created"
            run.updated += status == "updated"
        # Search results come and go with ranking, so Adzuna postings are not closed by absence.
    except Exception as e:
        run.error = f"{type(e).__name__}: {e}"[:2000]
        log.warning("ingest adzuna %s failed: %s", board, run.error)
    return _record(run, started)


def _record(run: IngestRun, started: float) -> IngestRun:
    run.finished_at = datetime.now(timezone.utc)
    run.seconds = round(time.monotonic() - started, 2)
    with SessionLocal() as db:
        db.add(run)
        db.commit()
        db.refresh(run)
    return run


def reanalyze(batch: int = 200) -> int:
    """Re-extract every stored profile made by an older engine version."""
    from sqlalchemy import or_, select
    store, n = get_store(), 0
    while True:
        with SessionLocal() as db:
            ids = db.scalars(select(JobPostingRow.id).where(or_(JobPostingRow.profile_version.is_(None),
                                                                JobPostingRow.profile_version != engine_version()))
                             .limit(batch)).all()
        if not ids:
            return n
        store.profiles(list(ids))
        n += len(ids)


def run_all(client=None) -> list[IngestRun]:
    cfg = json.loads((DATA_DIR / "boards.json").read_text())
    runs = [ingest_board(b["source"], b["board"], b.get("company"), client=client) for b in cfg.get("boards", [])]
    if settings().adzuna_app_id and settings().adzuna_app_key:
        runs += [ingest_adzuna(a["what"], a.get("where"), a.get("pages", 1), client=client) for a in cfg.get("adzuna", [])]
    return runs


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["greenhouse", "lever"])
    ap.add_argument("--board")
    ap.add_argument("--company")
    ap.add_argument("--adzuna", metavar="WHAT")
    ap.add_argument("--where")
    ap.add_argument("--pages", type=int, default=1)
    ap.add_argument("--reanalyze", action="store_true")
    a = ap.parse_args(argv)
    if a.reanalyze:
        print(f"Re-analyzed {reanalyze()} postings")
        return 0
    if a.adzuna:
        runs = [ingest_adzuna(a.adzuna, a.where, a.pages)]
    elif a.source and a.board:
        runs = [ingest_board(a.source, a.board, a.company)]
    else:
        runs = run_all()
    for r in runs:
        print(f"{r.source}/{r.board}: fetched {r.fetched}, new {r.created}, updated {r.updated}, closed {r.closed}"
              f"{' ERROR ' + r.error if r.error else ''} ({r.seconds}s)")
    return 1 if any(r.error for r in runs) else 0


if __name__ == "__main__":
    sys.exit(main())
