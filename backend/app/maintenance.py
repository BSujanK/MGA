"""Housekeeping, run daily from cron:  python -m app.maintenance

- deletes login codes older than a day (they hold email addresses);
- deletes expired sessions;
- deletes audit-log rows older than MGA_AUDIT_DAYS (default 365) that no longer belong to an account.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete

from .db import SessionLocal
from .db.models import AuditLog, LoginCode, Session


def purge(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    audit_days = int(os.getenv("MGA_AUDIT_DAYS", "365"))
    with SessionLocal() as db:
        out = {
            "login_codes": db.execute(delete(LoginCode).where(LoginCode.created_at < now - timedelta(days=1))).rowcount,
            "sessions": db.execute(delete(Session).where(Session.expires_at < now)).rowcount,
            "audit_log": db.execute(delete(AuditLog).where(AuditLog.user_id.is_(None),
                                                           AuditLog.at < now - timedelta(days=audit_days))).rowcount,
        }
        db.commit()
    return out


if __name__ == "__main__":
    print(json.dumps(purge()))
    sys.exit(0)
