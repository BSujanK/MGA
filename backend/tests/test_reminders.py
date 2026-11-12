from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, select

from app import mailer, reminders
from app.db import SessionLocal
from app.db.models import CalendarEvent, LoginCode, User
from app.mailer import MailError

import test_accounts

# Far in the future so events left behind by other tests are never due.
NOW = datetime(2031, 3, 10, 6, 0, tzinfo=timezone.utc)  # 11:30 on 10 Mar in India


def signed_in():
    """Sign in through the real flow. The per-IP code limit is shared by the whole suite, so reset it first."""
    with SessionLocal() as db:
        db.execute(delete(LoginCode))
        db.commit()
    return test_accounts.signed_in()


class Outbox:
    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []
        self.fail_for: set[str] = set()

    def __call__(self, to, subject, text):
        if "sign-in code" in subject:  # login emails are not reminders
            return
        if to in self.fail_for:
            raise MailError("provider down")
        self.sent.append((to, subject, text))

    def to(self, email):
        return [m for m in self.sent if m[0] == email]


@pytest.fixture(autouse=True)
def _clean_calendar():
    """Exact counts need a calendar with only this test's events (earlier tests may leave due ones)."""
    with SessionLocal() as db:
        db.execute(delete(CalendarEvent))
        db.commit()


@pytest.fixture
def outbox(monkeypatch):
    box = Outbox()
    monkeypatch.setattr(mailer, "send", box)
    return box


def add_event(c, eid, date, **kw):
    body = {"id": eid, "kind": "interview", "title": f"Title {eid}", "date": date, "remindDays": 1, **kw}
    r = c.put(f"/me/calendar/{eid}", json=body)
    assert r.status_code == 200, r.text


def reminded(email, eid):
    with SessionLocal() as db:
        uid = db.scalar(select(User.id).where(User.email == email))
        return db.get(CalendarEvent, (uid, eid)).reminded_at


def test_due_event_sends_one_email_with_details_and_is_marked(outbox):
    c, email = signed_in()
    add_event(c, "e1", "2031-03-11", title="Round 2 with Acme", company="Acme", time="10:30",
              url="https://acme.example.com/join", notes="Bring laptop\nRevise graphs", kind="interview")
    stats = reminders.send_due(now=NOW)
    assert stats == {"users": 1, "events": 1, "sent": 1, "failed": 0}
    (to, subject, text), = outbox.sent
    assert to == email and subject == "Coming up: 1 date in your MGA calendar"
    for part in ("Interview: Round 2 with Acme (Acme)", "Tue 11 Mar", "10:30", "https://acme.example.com/join",
                 "Bring laptop", "Revise graphs", "Account page", "you added these dates in MGA"):
        assert part in text
    assert reminded(email, "e1") is not None
    assert reminders.send_due(now=NOW) == {"users": 0, "events": 0, "sent": 0, "failed": 0}
    assert len(outbox.sent) == 1


def test_not_due_cases_send_nothing(outbox):
    c, email = signed_in()
    add_event(c, "early", "2031-03-14", remindDays=2)      # window opens 12 Mar
    add_event(c, "past", "2031-03-09")                      # yesterday
    add_event(c, "done", "2031-03-11", done=True)
    add_event(c, "off", "2031-03-11", remindDays=0)
    c2, email2 = signed_in()
    add_event(c2, "optout", "2031-03-11")
    assert c2.put("/me/settings", json={"reminder_emails": False}).status_code == 200
    reminders.send_due(now=NOW)
    assert outbox.to(email) == [] and outbox.to(email2) == []
    # window edges: opens on date - remind_days, still open on the day itself
    add_event(c, "edge", "2031-03-10", remindDays=2)
    add_event(c, "today", "2031-03-10")
    reminders.send_due(now=NOW)
    (_, subject, text), = outbox.to(email)
    assert subject.startswith("Coming up: 2 dates") and "Title edge" in text and "Title today" in text
    assert "Title early" not in text and "Title past" not in text and "Title done" not in text


def test_window_uses_india_date(outbox):
    c, email = signed_in()
    add_event(c, "late", "2031-03-11")
    # Due from 10 Mar India time. 18:15 UTC on 9 Mar is still 9 Mar in India; 18:45 UTC is already 10 Mar.
    reminders.send_due(now=datetime(2031, 3, 9, 18, 15, tzinfo=timezone.utc))  # 23:45 IST, 9 Mar
    assert outbox.to(email) == []
    reminders.send_due(now=datetime(2031, 3, 9, 18, 45, tzinfo=timezone.utc))   # 00:15 IST, 10 Mar
    assert len(outbox.to(email)) == 1


def test_one_email_per_user_with_only_their_own_events(outbox):
    a, ea = signed_in()
    b, eb = signed_in()
    add_event(a, "a1", "2031-03-11", title="Alpha one", notes="alpha secret")
    add_event(a, "a2", "2031-03-10", title="Alpha two")
    add_event(b, "b1", "2031-03-11", title="Bravo one", notes="bravo secret")
    stats = reminders.send_due(now=NOW)
    assert stats == {"users": 2, "events": 3, "sent": 2, "failed": 0}
    (_, sa, ta), = outbox.to(ea)
    (_, sb, tb), = outbox.to(eb)
    assert sa == "Coming up: 2 dates in your MGA calendar" and sb == "Coming up: 1 date in your MGA calendar"
    assert "Alpha one" in ta and "Alpha two" in ta and "alpha secret" in ta
    assert "Bravo" not in ta and "bravo" not in ta
    assert "Bravo one" in tb and "bravo secret" in tb and "Alpha" not in tb and "alpha" not in tb
    assert ta.index("Alpha two") < ta.index("Alpha one")  # soonest first


def test_dry_run_sends_and_marks_nothing(outbox):
    c, email = signed_in()
    add_event(c, "d1", "2031-03-11")
    assert reminders.send_due(now=NOW, dry_run=True) == {"users": 1, "events": 1, "sent": 0, "failed": 0}
    assert outbox.sent == [] and reminded(email, "d1") is None


def test_mail_failure_leaves_event_due_and_does_not_block_others(outbox):
    a, ea = signed_in()
    b, eb = signed_in()
    add_event(a, "f1", "2031-03-11")
    add_event(b, "g1", "2031-03-11")
    outbox.fail_for.add(ea)
    stats = reminders.send_due(now=NOW)
    assert stats == {"users": 2, "events": 2, "sent": 1, "failed": 1}
    assert reminded(ea, "f1") is None and reminded(eb, "g1") is not None
    assert len(outbox.to(eb)) == 1
    outbox.fail_for.clear()
    assert reminders.send_due(now=NOW) == {"users": 1, "events": 1, "sent": 1, "failed": 0}
    assert len(outbox.to(ea)) == 1 and reminded(ea, "f1") is not None


def test_editing_event_resets_reminder(outbox):
    c, email = signed_in()
    add_event(c, "r1", "2031-03-11", title="Original")
    reminders.send_due(now=NOW)
    assert reminded(email, "r1") is not None
    add_event(c, "r1", "2031-03-11", title="Renamed only")  # same schedule: stays reminded
    assert reminded(email, "r1") is not None
    add_event(c, "r1", "2031-03-10", title="Renamed only")  # new date
    assert reminded(email, "r1") is None
    reminders.send_due(now=NOW)
    assert reminded(email, "r1") is not None
    add_event(c, "r1", "2031-03-10", remindDays=2)           # new lead time
    assert reminded(email, "r1") is None
    reminders.send_due(now=NOW)
    add_event(c, "r1", "2031-03-10", remindDays=2, time="09:00")  # new time
    assert reminded(email, "r1") is None
    assert len(outbox.to(email)) == 3


def test_settings_round_trip_and_export():
    c, _ = signed_in()
    assert c.get("/me/settings").json() == {"reminder_emails": True}
    assert c.put("/me/settings", json={"reminder_emails": False}).json() == {"reminder_emails": False}
    assert c.get("/me/settings").json() == {"reminder_emails": False}
    assert c.get("/me/export").json()["account"]["reminder_emails"] is False
    assert c.put("/me/settings", json={"reminder_emails": True}).status_code == 200
    assert c.get("/me/settings").json() == {"reminder_emails": True}
    assert c.put("/me/settings", json={}).status_code == 422


def test_settings_require_sign_in():
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app, headers={"X-Requested-With": "mga"})
    assert c.get("/me/settings").status_code == 401
