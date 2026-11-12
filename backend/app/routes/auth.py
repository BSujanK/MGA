"""Sign-in routes: email code, Google, sign out."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DB

from .. import auth, mailer
from ..config import settings
from ..db import get_db
from ..db.models import Session, User

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(auth.require_csrf)])


class CodeRequest(BaseModel):
    email: str = Field(max_length=254)


class CodeSent(BaseModel):
    sent: bool
    dev_code: Optional[str] = Field(default=None, description="Only in development without an email provider")


class VerifyRequest(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    accept_terms: bool = False


class GoogleRequest(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)
    accept_terms: bool = False


class UserOut(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    created_at: str
    is_new: bool = False


def user_out(u, is_new: bool = False) -> UserOut:
    return UserOut(id=u.id, email=u.email, name=u.name, created_at=u.created_at.isoformat(), is_new=is_new)


@router.post("/code", response_model=CodeSent)
def send_code(body: CodeRequest, request: Request, db: DB = Depends(get_db)) -> CodeSent:
    """Email a 6-digit sign-in code. Same answer whether or not the account exists."""
    code = auth.request_code(db, body.email, request)
    text = (f"Your MGA sign-in code is {code}\n\nIt expires in 10 minutes. "
            "If you didn't ask for it, ignore this email.")
    try:
        mailer.send(auth.normalize_email(body.email), f"{code} is your MGA sign-in code", text)
    except mailer.MailError as e:
        raise HTTPException(503, "We couldn't send the email right now. Try again in a minute.") from e
    return CodeSent(sent=True, dev_code=code if auth.may_echo_code(request) else None)


@router.post("/verify", response_model=UserOut)
def verify(body: VerifyRequest, request: Request, response: Response, db: DB = Depends(get_db)) -> UserOut:
    email = auth.verify_code(db, body.email, body.code)
    is_new = db.scalars(select(User).where(User.email == email)).first() is None
    user = auth.upsert_user(db, email, body.accept_terms)
    auth.start_session(db, user, request, response)
    return user_out(user, is_new)


@router.post("/google", response_model=UserOut)
def google(body: GoogleRequest, request: Request, response: Response, db: DB = Depends(get_db)) -> UserOut:
    claims = auth.verify_google(body.credential)
    email = auth.normalize_email(claims["email"])
    is_new = db.scalars(select(User).where((User.google_sub == claims["sub"]) | (User.email == email))).first() is None
    user = auth.upsert_user(db, email, body.accept_terms, name=claims.get("name"), google_sub=claims["sub"])
    auth.start_session(db, user, request, response)
    return user_out(user, is_new)


@router.post("/logout")
def logout(request: Request, response: Response, db: DB = Depends(get_db)) -> dict:
    sess = auth.session_for(db, request)
    if sess:
        auth.audit(db, "logout", sess.user_id)
        db.delete(sess)
        db.commit()
    auth.clear_cookie(response)
    return {"ok": True}


@router.post("/logout-all")
def logout_all(response: Response, user=Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    """Sign out on every device."""
    n = db.execute(delete(Session).where(Session.user_id == user.id)).rowcount
    auth.audit(db, "logout_all", user.id, sessions=n)
    db.commit()
    auth.clear_cookie(response)
    return {"ok": True, "sessions_ended": n}


@router.get("/config")
def auth_config() -> dict:
    """What sign-in methods the frontend should offer."""
    return {"email": True, "google_client_id": settings().google_client_id, "terms_version": auth.TERMS_VERSION}

