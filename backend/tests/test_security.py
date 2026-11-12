"""Regression tests for the security review findings."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import auth, limits, llm
from app.config import Settings
from app.db import SessionLocal
from app.db.models import LoginCode
from app.main import app
from app.models import JobPosting

H = {"X-Requested-With": "mga"}


def _email(tag: str) -> str:
    return f"sec-{tag}@example.com"


def _code(c: TestClient, email: str) -> str:
    with SessionLocal() as db:  # keep these tests clear of the per-IP code limit shared by the suite
        for row in db.scalars(select(LoginCode)):
            db.delete(row)
        db.commit()
    return c.post("/auth/code", json={"email": email}).json()["dev_code"]


def test_dev_code_only_echoed_in_explicit_dev(monkeypatch):
    class Req:
        client = type("C", (), {"host": "203.0.113.9"})()
    from app import config
    monkeypatch.setattr(config, "settings", lambda: Settings())
    monkeypatch.setattr(auth, "settings", lambda: Settings())
    monkeypatch.setenv("MGA_ENV", "development")
    assert not auth.may_echo_code(Req())              # remote client, no explicit opt-in
    monkeypatch.setenv("MGA_DEV_ECHO_CODES", "1")
    assert auth.may_echo_code(Req())
    monkeypatch.setenv("MGA_ENV", "")                 # unset = production: never
    assert not auth.may_echo_code(Req())


def test_parallel_wrong_guesses_cannot_exceed_attempt_limit():
    c = TestClient(app, headers=H)
    email = _email("race")
    code = _code(c, email)
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: c.post("/auth/verify", json={"email": email, "code": wrong, "accept_terms": True}), range(20)))
    with SessionLocal() as db:
        row = db.scalars(select(LoginCode).where(LoginCode.email == email)).one()
    assert row.attempts <= auth.MAX_ATTEMPTS
    assert c.post("/auth/verify", json={"email": email, "code": code, "accept_terms": True}).status_code == 400


def test_same_message_for_every_code_failure():
    c = TestClient(app, headers=H)
    email = _email("msg")
    none = c.post("/auth/verify", json={"email": email, "code": "123456", "accept_terms": True}).json()["detail"]
    code = _code(c, email)
    wrong = c.post("/auth/verify", json={"email": email, "code": f"{(int(code) + 1) % 1_000_000:06d}"}).json()["detail"]
    assert none == wrong == auth.BAD_CODE


@pytest.mark.parametrize("email", ["x@a.com,b.com", "a<b>@example.com", '"q"@example.com', "a@b@example.com"])
def test_email_header_tricks_rejected(email):
    assert TestClient(app, headers=H).post("/auth/code", json={"email": email}).status_code == 422


def test_forwarded_for_uses_trusted_hop(monkeypatch):
    class Req:
        headers = {"x-forwarded-for": "6.6.6.6, 198.51.100.7"}  # client-supplied, then added by our proxy
        client = None
    monkeypatch.setattr(auth, "settings", lambda: Settings(trust_proxy=True, proxy_hops=1))
    assert auth.client_ip(Req()) == "198.51.100.7"


def test_google_account_mismatch_is_rejected(monkeypatch):
    c = TestClient(app, headers=H)
    email = _email("google")
    monkeypatch.setattr(auth, "verify_google", lambda cred: {"email": email, "email_verified": True, "sub": "sub-A"})
    assert c.post("/auth/google", json={"credential": "x" * 40, "accept_terms": True}).status_code == 200
    monkeypatch.setattr(auth, "verify_google", lambda cred: {"email": email, "email_verified": True, "sub": "sub-B"})
    assert TestClient(app, headers=H).post("/auth/google", json={"credential": "x" * 40}).status_code == 409


def test_oversized_bodies_rejected():
    c = TestClient(app, headers=H)
    assert c.post("/analyze/job", json={"text": "Python " * 400_000}).status_code == 413
    assert c.post("/analyze/job", json={"text": "x" * 60_000}).status_code == 422  # field cap


def test_unsafe_urls_are_dropped_or_rejected():
    j = JobPosting(id="x", title="t", company="c", location="l", description="d", apply_url="javascript:alert(1)")
    assert j.apply_url is None
    assert JobPosting(id="x", title="t", company="c", location="l", description="d",
                      apply_url="https://ok.example.com/a b").apply_url is None
    c = TestClient(app, headers=H)
    email = _email("url")
    c.post("/auth/verify", json={"email": email, "code": _code(c, email), "accept_terms": True})
    ev = {"id": "e1", "kind": "oa", "title": "OA\r\nBEGIN:VALARM", "date": "2026-12-01",
          "url": "https://example.com/\r\nX-INJECT:1"}
    assert c.put("/me/calendar/e1", json=ev).status_code == 422
    ev["url"] = "https://example.com/ok"
    assert c.put("/me/calendar/e1", json=ev).status_code == 200
    assert c.get("/me/calendar").json()[0]["title"] == "OA BEGIN:VALARM"  # newlines flattened


def test_llm_only_for_signed_in_users(monkeypatch):
    calls = []

    def fake_extract(text):
        calls.append(text)
        raise llm.LLMUnavailable("counted")
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(llm, "extract_job", fake_extract)
    anon = TestClient(app, headers=H)
    assert anon.post("/analyze/job", json={"text": "Requirements\n- Python", "use_llm": True}).status_code == 200
    assert calls == []  # anonymous: rules only
    c = TestClient(app, headers=H)
    email = _email("llm")
    c.post("/auth/verify", json={"email": email, "code": _code(c, email), "accept_terms": True})
    c.post("/analyze/job", json={"text": "Requirements\n- Python", "use_llm": True})
    assert len(calls) == 1


def test_like_wildcards_are_literal():
    c = TestClient(app)
    assert c.get("/jobs", params={"q": "%"}).json() == []
    assert c.get("/jobs", params={"q": "_"}).json() == []


def test_throttle_window():
    w = limits._Window()
    assert all(w.allow("k", 3, 60) for _ in range(3)) and not w.allow("k", 3, 60)


def test_admin_token_needs_length(monkeypatch):
    from app import main
    monkeypatch.setattr(main, "settings", lambda: Settings(admin_token="short"))
    r = TestClient(app).post("/jobs/import", params={"source": "greenhouse", "board": "x"}, headers={"X-Admin-Token": "short"})
    assert r.status_code == 403


def test_purge_removes_old_codes_and_expired_sessions():
    from datetime import timedelta
    from app.maintenance import purge
    out = purge(now=auth.utcnow() + timedelta(days=400))
    assert set(out) == {"login_codes", "sessions", "audit_log"}
    with SessionLocal() as db:
        assert not db.scalars(select(LoginCode)).all()
