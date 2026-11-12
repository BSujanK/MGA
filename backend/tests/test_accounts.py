import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text, update

from app import auth
from app.db import SessionLocal, engine
from app.db.models import AuditLog, CalendarEvent, LoginCode, Profile, User
from app.main import app

H = {"X-Requested-With": "mga"}
_n = iter(range(10_000))


def new_email() -> str:
    return f"student{next(_n)}@example.com"


def signed_in(email: str | None = None) -> tuple[TestClient, str]:
    c = TestClient(app, headers=H)
    email = email or new_email()
    code = c.post("/auth/code", json={"email": email}).json()["dev_code"]
    r = c.post("/auth/verify", json={"email": email, "code": code, "accept_terms": True})
    assert r.status_code == 200, r.text
    return c, email


# ---------- sign-in ----------

def test_email_code_signup_requires_consent_and_sets_cookie():
    c = TestClient(app, headers=H)
    email = new_email()
    sent = c.post("/auth/code", json={"email": email.upper()}).json()
    assert sent["sent"] and len(sent["dev_code"]) == 6
    assert c.post("/auth/verify", json={"email": email, "code": sent["dev_code"]}).json()["detail"] == "new_account_requires_consent"
    code = c.post("/auth/code", json={"email": email}).json()["dev_code"]
    r = c.post("/auth/verify", json={"email": email, "code": code, "accept_terms": True})
    assert r.status_code == 200 and r.json()["is_new"] and r.json()["email"] == email
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    me = c.get("/me").json()
    assert me["user"]["email"] == email and me["has_resume"] is False


def test_returning_user_needs_no_consent_and_code_is_single_use():
    c, email = signed_in()
    c2 = TestClient(app, headers=H)
    code = c2.post("/auth/code", json={"email": email}).json()["dev_code"]
    r = c2.post("/auth/verify", json={"email": email, "code": code})
    assert r.status_code == 200 and not r.json()["is_new"]
    assert c2.post("/auth/verify", json={"email": email, "code": code}).status_code == 400


def test_wrong_codes_lock_the_code():
    c = TestClient(app, headers=H)
    email = new_email()
    code = c.post("/auth/code", json={"email": email}).json()["dev_code"]
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    for _ in range(auth.MAX_ATTEMPTS):
        assert c.post("/auth/verify", json={"email": email, "code": wrong, "accept_terms": True}).status_code == 400
    r = c.post("/auth/verify", json={"email": email, "code": code, "accept_terms": True})
    assert r.status_code == 400 and "expired" in r.json()["detail"]


def test_expired_code_rejected():
    c = TestClient(app, headers=H)
    email = new_email()
    code = c.post("/auth/code", json={"email": email}).json()["dev_code"]
    with SessionLocal() as db:
        db.execute(update(LoginCode).where(LoginCode.email == email).values(expires_at=auth.utcnow() - timedelta(minutes=1)))
        db.commit()
    assert c.post("/auth/verify", json={"email": email, "code": code, "accept_terms": True}).status_code == 400


def test_code_requests_are_rate_limited():
    c = TestClient(app, headers=H)
    email = new_email()
    for _ in range(auth.CODES_PER_EMAIL_PER_HOUR):
        assert c.post("/auth/code", json={"email": email}).status_code == 200
    assert c.post("/auth/code", json={"email": email}).status_code == 429


def test_codes_are_stored_hashed():
    c = TestClient(app, headers=H)
    email = new_email()
    code = c.post("/auth/code", json={"email": email}).json()["dev_code"]
    with SessionLocal() as db:
        row = db.scalars(select(LoginCode).where(LoginCode.email == email)).first()
    assert code not in row.code_hash and len(row.code_hash) == 64


@pytest.mark.parametrize("email", ["not-an-email", "a@b", "x" * 300 + "@example.com"])
def test_invalid_email(email):
    assert TestClient(app, headers=H).post("/auth/code", json={"email": email}).status_code == 422


def test_csrf_header_required_for_unsafe_requests():
    c, _ = signed_in()
    bare = TestClient(app, cookies=c.cookies)
    assert bare.get("/me").status_code == 200  # reads are fine
    assert bare.put("/me/profile", json={"resume_text": "x"}).status_code == 403
    assert TestClient(app).post("/auth/code", json={"email": new_email()}).status_code == 403


def test_logout_and_logout_all():
    c, email = signed_in()
    other = TestClient(app, headers=H)
    code = other.post("/auth/code", json={"email": email}).json()["dev_code"]
    other.post("/auth/verify", json={"email": email, "code": code})
    assert c.get("/me").json()["counts"]["sessions"] == 2
    assert c.post("/auth/logout").status_code == 200
    assert TestClient(app, headers=H, cookies=c.cookies).get("/me").status_code in (200, 401)
    assert other.post("/auth/logout-all").json()["sessions_ended"] >= 1
    assert other.get("/me").status_code == 401


def test_unauthenticated_is_401():
    c = TestClient(app, headers=H)
    for method, path in [("get", "/me"), ("get", "/me/profile"), ("get", "/me/calendar"), ("delete", "/me")]:
        assert getattr(c, method)(path).status_code == 401


def test_google_sign_in_links_existing_email(monkeypatch):
    c, email = signed_in()
    monkeypatch.setattr(auth, "verify_google", lambda cred: {"email": email, "email_verified": True, "sub": "g-123", "name": "Test"})
    g = TestClient(app, headers=H)
    r = g.post("/auth/google", json={"credential": "x" * 40})
    assert r.status_code == 200 and not r.json()["is_new"]
    with SessionLocal() as db:
        u = db.scalars(select(User).where(User.email == email)).one()
        assert u.google_sub == "g-123"


def test_google_not_configured():
    r = TestClient(app, headers=H).post("/auth/google", json={"credential": "x" * 40})
    assert r.status_code == 501
    assert TestClient(app).get("/auth/config").json()["google_client_id"] is None


# ---------- data ----------

RESUME = "Projects\n- Built a Flask API with MySQL for 200 users (synthetic)"


def test_profile_round_trip_is_encrypted_at_rest():
    c, _ = signed_in()
    body = {"resume_text": RESUME, "file_name": "cv.pdf", "overrides": [{"skill_id": "python", "level": 3}]}
    assert c.put("/me/profile", json=body).status_code == 200
    got = c.get("/me/profile").json()
    assert got["resume_text"] == RESUME and got["overrides"] == [{"skill_id": "python", "level": 3}]
    with engine().connect() as conn:
        raw = [r[0] for r in conn.execute(text("select resume_enc from profiles"))]
    assert raw and all("Flask" not in (r or "") for r in raw)
    assert c.get("/me").json()["has_resume"]


def test_documents_and_calendar():
    c, _ = signed_in()
    turns = [{"question_id": "gap:docker", "question": "?", "answer": "Yes, in my hackathon"}]
    assert c.put("/me/documents/tuner/job:sde1-kestrel", json={"data": {"turns": turns}}).status_code == 200
    assert c.get("/me/documents/tuner").json()["job:sde1-kestrel"]["data"]["turns"] == turns
    assert c.put("/me/documents/secret/x", json={"data": 1}).status_code == 404
    ev = {"id": "ev-1", "kind": "oa", "title": "OA round", "date": "2026-12-01", "time": "10:00", "notes": "Revise DP", "remindDays": 2}
    assert c.put("/me/calendar/ev-1", json=ev).status_code == 200
    out = c.get("/me/calendar").json()
    assert out[0]["title"] == "OA round" and out[0]["notes"] == "Revise DP"
    assert c.put("/me/calendar/ev-2", json={**ev, "id": "ev-2", "url": "javascript:alert(1)"}).status_code == 422
    assert c.put("/me/calendar/ev-3", json=ev).status_code == 422  # id mismatch
    assert c.delete("/me/calendar/ev-1").status_code == 200 and c.get("/me/calendar").json() == []


def test_reports_are_private_to_their_owner():
    a, _ = signed_in()
    b, _ = signed_in()
    rep = a.post("/me/reports", json={"kind": "gap", "title": "SDE I", "job_id": "sde1-kestrel",
                                      "summary": {"readiness": 69, "resume": {"nested": "dropped"}}, "data": {"x": 1}}).json()
    assert rep["summary"] == {"readiness": 69}
    assert [r["id"] for r in a.get("/me/reports").json()] == [rep["id"]]
    assert a.get(f"/me/reports/{rep['id']}").json()["data"] == {"x": 1}
    assert b.get(f"/me/reports/{rep['id']}").status_code == 404
    b.delete(f"/me/reports/{rep['id']}")
    assert a.get(f"/me/reports/{rep['id']}").status_code == 200  # b can't delete a's report
    assert a.delete(f"/me/reports/{rep['id']}").status_code == 200 and a.get("/me/reports").json() == []


def test_import_fills_only_missing_data():
    c, _ = signed_in()
    c.put("/me/profile", json={"resume_text": "Account resume"})
    c.put("/me/documents/prep/job:a", json={"data": {"done": ["dsa:graphs"]}})
    ev = {"id": "ev-local", "kind": "interview", "title": "Round 1", "date": "2026-12-05"}
    r = c.post("/me/import", json={"profile": {"resume_text": "Browser resume"},
                                   "prep": {"job:a": {"done": []}, "job:b": {"done": ["core:os"]}},
                                   "tuner": {"job:a": {"turns": []}}, "calendar": [ev]}).json()
    assert r["added"] == {"profile": 0, "tuner": 1, "prep": 1, "calendar": 1}
    assert c.get("/me/profile").json()["resume_text"] == "Account resume"
    assert c.get("/me/documents/prep").json()["job:a"]["data"] == {"done": ["dsa:graphs"]}


def test_export_and_delete_my_data():
    c, email = signed_in()
    c.put("/me/profile", json={"resume_text": RESUME})
    c.put("/me/calendar/e1", json={"id": "e1", "kind": "deadline", "title": "Apply", "date": "2026-12-10"})
    c.post("/me/reports", json={"kind": "gap", "title": "t", "data": {"a": 1}})
    exp = c.get("/me/export")
    assert exp.headers["content-disposition"].startswith("attachment")
    data = json.loads(exp.content)
    assert data["account"]["email"] == email and data["profile"]["resume_text"] == RESUME
    assert data["calendar"][0]["title"] == "Apply" and data["reports"][0]["data"] == {"a": 1}
    assert {c_["kind"] for c_ in data["consents"]} == {"terms", "store_resume"}

    with SessionLocal() as db:
        uid = db.scalars(select(User.id).where(User.email == email)).one()
    r = c.delete("/me")
    assert r.status_code == 200 and "mga_session=" in r.headers["set-cookie"]
    with SessionLocal() as db:
        assert db.get(User, uid) is None and db.get(Profile, uid) is None
        assert not db.scalars(select(CalendarEvent).where(CalendarEvent.user_id == uid)).all()
        logs = db.scalars(select(AuditLog).where(AuditLog.user_id == uid, AuditLog.action == "account_deleted")).all()
        assert logs and email not in json.dumps([l.detail for l in logs])
    assert TestClient(app, headers=H, cookies=c.cookies).get("/me").status_code == 401


# ---------- config and schema ----------

def test_production_requires_secrets(monkeypatch):
    from app.config import Settings
    monkeypatch.setenv("MGA_ENV", "production")
    monkeypatch.delenv("MGA_DATA_KEY", raising=False)
    with pytest.raises(RuntimeError, match="MGA_DATA_KEY"):
        Settings().check()
    monkeypatch.setenv("MGA_DATA_KEY", "k")
    monkeypatch.setenv("RESEND_API_KEY", "r")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///x.db")
    with pytest.raises(RuntimeError, match="Postgres"):
        Settings().check()
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    Settings().check()
    assert Settings().cookie_secure


def test_migrations_match_models(tmp_path, monkeypatch):
    """`alembic upgrade head` builds exactly the schema the models describe."""
    from alembic import command
    from alembic.config import Config
    from pathlib import Path
    import app.db as appdb
    from app.config import settings

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/mig.db")
    settings.cache_clear()
    appdb.engine.cache_clear()
    try:
        cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
        command.upgrade(cfg, "head")
        command.check(cfg)  # raises if models and migrations differ
    finally:
        monkeypatch.undo()
        settings.cache_clear()
        appdb.engine.cache_clear()
