"""Calendar reminder emails. Run from cron, e.g. once a day:  python -m app.reminders [--dry-run]

An event is due when it has remind_days > 0, is not done, has not been reminded yet, the owner
has reminder emails on, and today (India time, the v1 market) falls between
`date - remind_days` and `date` inclusive. Each user gets ONE email per run listing all due events.

`reminded_at` is set only after the mail provider accepted the message, so a failure leaves the
events due for the next run. Two cron hosts can run at once on Postgres: event rows are claimed
with SELECT ... FOR UPDATE SKIP LOCKED and held until the email is sent and committed.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

from . import crypto, mailer
from .db import SessionLocal
from .db.models import CalendarEvent, User

log = logging.getLogger("mga.reminders")

TZ = ZoneInfo("Asia/Kolkata")
BATCH = 500           # users per page
MAX_REMIND_DAYS = 30  # matches the API limit; bounds the SQL prefilter

KIND_LABELS = {"application": "Application", "oa": "Online assessment", "interview": "Interview",
               "deadline": "Deadline", "drive": "Hiring drive", "other": "Event"}
_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_date(d: date) -> str:
    return f"{_DAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]}"


def _aware(now: datetime | None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now


def _is_due(e: CalendarEvent, today: date) -> bool:
    return e.date - timedelta(days=e.remind_days) <= today <= e.date


def _candidates(today: date) -> tuple:
    """Cheap SQL prefilter; the exact per-event window is checked in Python."""
    return (CalendarEvent.remind_days > 0, CalendarEvent.done.is_(False), CalendarEvent.reminded_at.is_(None),
            CalendarEvent.date >= today, CalendarEvent.date <= today + timedelta(days=MAX_REMIND_DAYS))


def compose(events: list[CalendarEvent]) -> tuple[str, str]:
    events = sorted(events, key=lambda e: (e.date, e.time or "", e.id))
    n = len(events)
    subject = f"Coming up: {n} date{'s' if n != 1 else ''} in your MGA calendar"
    lines = ["Hi,", "", "These dates from your MGA calendar are coming up:", ""]
    for e in events:
        head = f"{KIND_LABELS.get(e.kind, 'Event')}: {e.title}"
        if e.company:
            head += f" ({e.company})"
        lines.append(f"* {head}")
        lines.append(f"  When: {fmt_date(e.date)}" + (f", {e.time}" if e.time else ""))
        if e.url:
            lines.append(f"  Link: {e.url}")
        notes = crypto.decrypt(e.notes_enc) if e.notes_enc else ""
        if notes.strip():
            lines.append("  Notes: " + notes.strip().replace("\n", "\n         "))
        lines.append("")
    lines += ["--", "You are getting this email because you added these dates in MGA.",
              "To turn reminders off, open the Account page in MGA and switch off calendar reminder emails."]
    return subject, "\n".join(lines) + "\n"


def _user_ids(db: DB, today: date, after: str) -> list[str]:
    q = (select(CalendarEvent.user_id).join(User, User.id == CalendarEvent.user_id)
         .where(User.reminder_emails.is_(True), CalendarEvent.user_id > after, *_candidates(today))
         .distinct().order_by(CalendarEvent.user_id).limit(BATCH))
    return list(db.scalars(q))


def _process_user(uid: str, today: date, now: datetime, dry_run: bool, stats: dict) -> None:
    with SessionLocal() as db:
        user = db.get(User, uid)
        if user is None or not user.reminder_emails:
            return
        q = select(CalendarEvent).where(CalendarEvent.user_id == uid, *_candidates(today)).order_by(CalendarEvent.date)
        if not dry_run and db.get_bind().dialect.name == "postgresql":
            q = q.with_for_update(skip_locked=True)  # rows locked by another cron host are skipped
        events = [e for e in db.scalars(q) if _is_due(e, today)]
        if not events:
            return
        stats["users"] += 1
        stats["events"] += len(events)
        if dry_run:
            return
        try:
            subject, body = compose(events)
            mailer.send(user.email, subject, body)
            for e in events:
                e.reminded_at = now
            db.commit()
            stats["sent"] += 1
        except Exception as exc:  # one user's failure must not stop the others
            db.rollback()
            stats["failed"] += 1
            log.error("Reminder email failed for user %s: %s", uid, exc)  # no address or content in logs


def send_due(now: datetime | None = None, dry_run: bool = False) -> dict:
    """Send due reminders. Returns {users, events, sent, failed}: users and events that were due,
    emails sent, emails that failed. With dry_run nothing is sent or marked."""
    now = _aware(now)
    today = now.astimezone(TZ).date()
    stats = {"users": 0, "events": 0, "sent": 0, "failed": 0}
    after = ""
    while True:
        with SessionLocal() as db:
            ids = _user_ids(db, today, after)
        for uid in ids:
            _process_user(uid, today, now, dry_run, stats)
        if len(ids) < BATCH:
            break
        after = ids[-1]
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Send calendar reminder emails that are due.")
    ap.add_argument("--dry-run", action="store_true", help="count what would be sent, send nothing")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    result = send_due(dry_run=args.dry_run)
    print(json.dumps(result))
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
