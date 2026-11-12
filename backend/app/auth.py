"""Accounts and sessions.

- Sign in with a 6-digit code sent by email, or with Google (ID token).
- Sessions are random 256-bit tokens in an httpOnly cookie; only their hash is
  stored, so a database leak can't be replayed, and sessions can be revoked.
- Login attempts are rate-limited in the database, so limits hold across
  every API instance.
- Unsafe requests that rely on the cookie must carry `X-Requested-With: mga`
  (cross-site forms can't set it; cross-origin fetches with it are blocked by CORS).
"""
from __future__ import annotations

import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session as DB

from . import crypto
from .config import settings
from .db import get_db
from .db.models import AuditLog, Consent, LoginCode, Session, User

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
CODES_PER_EMAIL_PER_HOUR = 5
CODES_PER_IP_PER_HOUR = 30
TERMS_VERSION = "2026-11"
CSRF_HEADER = "x-requested-with"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")
BAD_CODE = "That code isn't right or has expired. Check the latest email or request a new code."
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite returns naive datetimes


def normalize_email(email: str) -> str:
    e = email.strip().lower()
    if not EMAIL_RE.match(e) or len(e) > 254:
        raise HTTPException(422, "Enter a valid email address")
    return e


def client_ip(request: Request) -> str:
    if settings().trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            # The rightmost entries are added by our own proxies; anything to their left is client-controlled.
            hops = [p.strip() for p in fwd.split(",") if p.strip()]
            if hops:
                return hops[-settings().proxy_hops] if len(hops) >= settings().proxy_hops else hops[0]
    return request.client.host if request.client else "unknown"


def ip_key(request: Request) -> str:
    return crypto.token_hash(client_ip(request))[:32]  # stored hashed, not the raw address


def audit(db: DB, action: str, user_id: str | None = None, **detail) -> None:
    db.add(AuditLog(user_id=user_id, action=action, detail=detail))


def require_csrf(request: Request) -> None:
    if request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER, "").lower() != "mga":
        raise HTTPException(403, "Missing X-Requested-With: mga header")


# ---------- email codes ----------

def request_code(db: DB, email: str, request: Request) -> str:
    email = normalize_email(email)
    now = utcnow()
    hour_ago = now - timedelta(hours=1)
    ip = ip_key(request)
    by_email = db.scalar(select(func.count()).select_from(LoginCode).where(LoginCode.email == email, LoginCode.created_at > hour_ago))
    by_ip = db.scalar(select(func.count()).select_from(LoginCode).where(LoginCode.ip == ip, LoginCode.created_at > hour_ago))
    if by_email >= CODES_PER_EMAIL_PER_HOUR or by_ip >= CODES_PER_IP_PER_HOUR:
        raise HTTPException(429, "Too many codes requested. Try again in an hour.")
    db.execute(delete(LoginCode).where(LoginCode.created_at < now - timedelta(days=1)))  # housekeeping
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(LoginCode(email=email, code_hash=crypto.code_hash(email, code), ip=ip, created_at=now, expires_at=now + CODE_TTL))
    db.commit()
    return code


def verify_code(db: DB, email: str, code: str) -> str:
    """Returns the normalized email if the code is right.

    Each guess first reserves an attempt with one atomic UPDATE, so parallel
    guesses can't exceed MAX_ATTEMPTS, and the code is consumed atomically, so
    it can't be used twice. Every failure gives the same message.
    """
    email = normalize_email(email)
    now = utcnow()
    row = db.scalars(select(LoginCode).where(LoginCode.email == email, LoginCode.used_at.is_(None))
                     .order_by(LoginCode.created_at.desc()).limit(1)).first()
    if row is None or _aware(row.expires_at) < now:
        raise HTTPException(400, BAD_CODE)
    reserved = db.execute(update(LoginCode)
                          .where(LoginCode.id == row.id, LoginCode.used_at.is_(None), LoginCode.attempts < MAX_ATTEMPTS)
                          .values(attempts=LoginCode.attempts + 1)).rowcount
    db.commit()
    if reserved != 1 or not hmac.compare_digest(row.code_hash, crypto.code_hash(email, code.strip())):
        raise HTTPException(400, BAD_CODE)
    consumed = db.execute(update(LoginCode).where(LoginCode.id == row.id, LoginCode.used_at.is_(None))
                          .values(used_at=now)).rowcount
    if consumed != 1:
        db.rollback()
        raise HTTPException(400, BAD_CODE)
    return email


def may_echo_code(request: Request) -> bool:
    """Return the code in the API response only for explicit local development with no email provider."""
    from . import mailer
    s = settings()
    if s.production or mailer.configured():
        return False
    return s.dev_echo_codes or (request.client is not None and request.client.host in LOOPBACK)


# ---------- users and sessions ----------

def upsert_user(db: DB, email: str, accept_terms: bool, name: str | None = None, google_sub: str | None = None) -> User:
    user = None
    if google_sub:
        user = db.scalars(select(User).where(User.google_sub == google_sub)).first()
    user = user or db.scalars(select(User).where(User.email == email)).first()
    if user is None:
        if not accept_terms:
            raise HTTPException(422, "new_account_requires_consent")
        user = User(email=email, name=name, google_sub=google_sub)
        db.add(user)
        db.flush()
        for kind in ("terms", "store_resume"):
            db.add(Consent(user_id=user.id, kind=kind, version=TERMS_VERSION))
        audit(db, "account_created", user.id, method="google" if google_sub else "email")
    else:
        if google_sub and user.google_sub and user.google_sub != google_sub:
            # Same email, different Google account (e.g. a recycled Workspace address): don't merge them.
            raise HTTPException(409, "This email is linked to a different Google account. Sign in with an email code instead.")
        if google_sub and not user.google_sub:
            user.google_sub = google_sub
        if name and not user.name:
            user.name = name
    user.last_login_at = utcnow()
    return user


def start_session(db: DB, user: User, request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    expires = now + timedelta(days=settings().session_days)
    db.add(Session(id=crypto.token_hash(token), user_id=user.id, created_at=now, expires_at=expires,
                   last_seen_at=now, user_agent=(request.headers.get("user-agent") or "")[:200]))
    audit(db, "login", user.id)
    db.commit()
    set_cookie(response, token, expires)


def set_cookie(response: Response, token: str, expires: datetime) -> None:
    s = settings()
    response.set_cookie(s.cookie_name, token, max_age=int((expires - utcnow()).total_seconds()), httponly=True,
                        secure=s.cookie_secure, samesite="lax", domain=s.cookie_domain, path="/")


def clear_cookie(response: Response) -> None:
    s = settings()
    response.delete_cookie(s.cookie_name, domain=s.cookie_domain, path="/")


def _token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get(settings().cookie_name)


def session_for(db: DB, request: Request) -> Session | None:
    token = _token(request)
    if not token:
        return None
    sess = db.get(Session, crypto.token_hash(token))
    now = utcnow()
    if sess is None or _aware(sess.expires_at) < now:
        return None
    if now - _aware(sess.last_seen_at) > timedelta(hours=1):  # write at most hourly
        sess.last_seen_at = now
        db.commit()
    return sess


def current_user(request: Request, db: DB = Depends(get_db)) -> User:
    sess = session_for(db, request)
    if sess is None:
        raise HTTPException(401, "Sign in to continue")
    if request.cookies.get(settings().cookie_name):
        require_csrf(request)
    return sess.user


def optional_user(request: Request, db: DB = Depends(get_db)) -> User | None:
    sess = session_for(db, request)
    return sess.user if sess else None


def verify_google(credential: str) -> dict:
    """Check a Google Sign-In ID token. Needs GOOGLE_CLIENT_ID."""
    client_id = settings().google_client_id
    if not client_id:
        raise HTTPException(501, "Google sign-in is not configured")
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token
    try:
        claims = id_token.verify_oauth2_token(credential, g_requests.Request(), client_id)
    except ValueError as e:
        raise HTTPException(400, "Google sign-in failed. Try again.") from e
    if not claims.get("email") or not claims.get("email_verified"):
        raise HTTPException(400, "Your Google account email isn't verified")
    return claims
