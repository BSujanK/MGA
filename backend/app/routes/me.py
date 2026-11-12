"""The signed-in user's data: profile, interview answers, prep progress, calendar,
saved reports, plus export and delete-my-data.

Resume text, answers, notes and saved reports are encrypted at rest.
"""
from __future__ import annotations

import json
from datetime import date as Date
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DB

from .. import auth, crypto
from ..db import get_db
from ..db.models import CalendarEvent, Consent, Document, Profile, SavedReport, Session, User
from ..models import SkillOverride
from .auth import UserOut, user_out

router = APIRouter(prefix="/me", tags=["me"])

DOC_KINDS = {"tuner", "prep"}
MAX_DOC_BYTES = 200_000
MAX_REPORT_BYTES = 2_000_000
MAX_EVENTS = 2000


# ---------- schemas ----------

class ProfileIn(BaseModel):
    resume_text: str = Field(default="", max_length=60_000)
    file_name: Optional[str] = Field(default=None, max_length=200)
    overrides: list[SkillOverride] = Field(default=[], max_length=300)


class ProfileOut(ProfileIn):
    updated_at: Optional[str] = None


class DocIn(BaseModel):
    data: Any


class EventIn(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["application", "oa", "interview", "deadline", "drive", "other"]
    title: str = Field(min_length=1, max_length=300)
    date: Date
    time: Optional[str] = Field(default=None, pattern=r"^(\d{2}:\d{2})?$")
    durationMins: Optional[int] = Field(default=None, ge=5, le=1440)
    company: Optional[str] = Field(default=None, max_length=200)
    jobId: Optional[str] = Field(default=None, max_length=200)
    url: Optional[str] = Field(default=None, max_length=1000)
    notes: Optional[str] = Field(default=None, max_length=5000)
    remindDays: int = Field(default=1, ge=0, le=30)
    done: bool = False

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: Optional[str]) -> Optional[str]:
        if v and not v.lower().startswith(("http://", "https://")):
            raise ValueError("Links must start with http:// or https://")
        return v or None


class ReportIn(BaseModel):
    kind: Literal["gap", "market", "tailored", "prep"]
    title: str = Field(min_length=1, max_length=300)
    job_id: Optional[str] = Field(default=None, max_length=200)
    summary: dict = Field(default={}, description="Small, non-personal headline numbers for the list view")
    data: Any


class ReportMeta(BaseModel):
    id: str
    kind: str
    title: str
    job_id: Optional[str] = None
    summary: dict = {}
    created_at: str


class ImportIn(BaseModel):
    """Data saved in the browser before the account existed. Fills only what the account doesn't have yet."""
    profile: Optional[ProfileIn] = None
    tuner: dict[str, Any] = {}
    prep: dict[str, Any] = {}
    calendar: list[EventIn] = Field(default=[], max_length=MAX_EVENTS)


class MeOut(BaseModel):
    user: UserOut
    has_resume: bool
    counts: dict[str, int]


# ---------- helpers ----------

def _event_out(e: CalendarEvent) -> dict:
    return {"id": e.id, "kind": e.kind, "title": e.title, "date": e.date.isoformat(), "time": e.time or "",
            "durationMins": e.duration_mins, "company": e.company, "jobId": e.job_id, "url": e.url,
            "notes": crypto.decrypt(e.notes_enc) if e.notes_enc else None, "remindDays": e.remind_days, "done": e.done}


def _put_event(db: DB, user_id: str, ev: EventIn) -> None:
    row = db.get(CalendarEvent, (user_id, ev.id)) or CalendarEvent(user_id=user_id, id=ev.id)
    row.kind, row.title, row.date, row.time = ev.kind, ev.title, ev.date, ev.time or None
    row.duration_mins, row.company, row.job_id, row.url = ev.durationMins, ev.company, ev.jobId, ev.url
    row.notes_enc = crypto.encrypt(ev.notes) if ev.notes else None
    row.remind_days, row.done = ev.remindDays, ev.done
    db.add(row)


def _put_doc(db: DB, user_id: str, kind: str, key: str, data: Any) -> None:
    raw = json.dumps(data, ensure_ascii=False)
    if len(raw.encode()) > MAX_DOC_BYTES:
        raise HTTPException(413, "This document is too large")
    row = db.get(Document, (user_id, kind, key)) or Document(user_id=user_id, kind=kind, key=key)
    row.data_enc = crypto.encrypt(raw)
    db.add(row)


def _check_kind(kind: str) -> None:
    if kind not in DOC_KINDS:
        raise HTTPException(404, "Unknown document kind")


# ---------- account ----------

@router.get("", response_model=MeOut)
def me(user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> MeOut:
    prof = db.get(Profile, user.id)
    count = lambda model: db.scalar(select(func.count()).select_from(model).where(model.user_id == user.id)) or 0  # noqa: E731
    return MeOut(user=user_out(user), has_resume=bool(prof and prof.resume_enc),
                 counts={"reports": count(SavedReport), "calendar": count(CalendarEvent), "documents": count(Document),
                         "sessions": count(Session)})


@router.delete("")
def delete_me(response: Response, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    """Delete the account and everything in it. Cannot be undone."""
    uid = user.id
    for model in (Document, CalendarEvent, SavedReport, Profile, Consent, Session):
        db.execute(delete(model).where(model.user_id == uid))  # explicit, so it works without DB cascades too
    db.delete(user)
    auth.audit(db, "account_deleted", uid)  # random id only: no email or other personal data is kept
    db.commit()
    auth.clear_cookie(response)
    return {"deleted": True}


@router.get("/export")
def export(user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> Response:
    """Everything we store about you, decrypted, as one JSON file."""
    prof = db.get(Profile, user.id)
    docs = db.scalars(select(Document).where(Document.user_id == user.id)).all()
    out = {
        "account": {"email": user.email, "name": user.name, "created_at": user.created_at.isoformat()},
        "consents": [{"kind": c.kind, "version": c.version, "granted": c.granted, "at": c.at.isoformat()}
                     for c in db.scalars(select(Consent).where(Consent.user_id == user.id))],
        "profile": {"resume_text": crypto.decrypt(prof.resume_enc), "file_name": prof.file_name,
                    "overrides": prof.overrides} if prof else None,
        "documents": [{"kind": d.kind, "key": d.key, "data": crypto.decrypt_json(d.data_enc)} for d in docs],
        "calendar": [_event_out(e) for e in db.scalars(select(CalendarEvent).where(CalendarEvent.user_id == user.id))],
        "reports": [{"kind": r.kind, "title": r.title, "job_id": r.job_id, "created_at": r.created_at.isoformat(),
                     "data": crypto.decrypt_json(r.data_enc)}
                    for r in db.scalars(select(SavedReport).where(SavedReport.user_id == user.id))],
        "sessions": [{"created_at": s.created_at.isoformat(), "last_seen_at": s.last_seen_at.isoformat(), "user_agent": s.user_agent}
                     for s in db.scalars(select(Session).where(Session.user_id == user.id))],
    }
    auth.audit(db, "data_exported", user.id)
    db.commit()
    return Response(json.dumps(out, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="mga-my-data.json"'})


# ---------- profile ----------

@router.get("/profile", response_model=ProfileOut)
def get_profile(user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> ProfileOut:
    prof = db.get(Profile, user.id)
    if prof is None:
        return ProfileOut()
    return ProfileOut(resume_text=crypto.decrypt(prof.resume_enc), file_name=prof.file_name,
                      overrides=prof.overrides or [], updated_at=prof.updated_at.isoformat())


@router.put("/profile", response_model=ProfileOut)
def put_profile(body: ProfileIn, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> ProfileOut:
    prof = db.get(Profile, user.id) or Profile(user_id=user.id)
    prof.resume_enc = crypto.encrypt(body.resume_text) if body.resume_text else None
    prof.file_name = body.file_name
    prof.overrides = [o.model_dump() for o in body.overrides]
    db.add(prof)
    db.commit()
    return get_profile(user, db)


# ---------- documents (interview answers, prep progress) ----------

@router.get("/documents/{kind}")
def list_docs(kind: str, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    _check_kind(kind)
    rows = db.scalars(select(Document).where(Document.user_id == user.id, Document.kind == kind)).all()
    return {r.key: {"data": crypto.decrypt_json(r.data_enc), "updated_at": r.updated_at.isoformat()} for r in rows}


@router.put("/documents/{kind}/{key}")
def put_doc(kind: str, key: str, body: DocIn, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    _check_kind(kind)
    if not 0 < len(key) <= 120:
        raise HTTPException(422, "Invalid key")
    _put_doc(db, user.id, kind, key, body.data)
    db.commit()
    return {"ok": True}


@router.delete("/documents/{kind}/{key}")
def delete_doc(kind: str, key: str, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    _check_kind(kind)
    db.execute(delete(Document).where(Document.user_id == user.id, Document.kind == kind, Document.key == key))
    db.commit()
    return {"ok": True}


# ---------- calendar ----------

@router.get("/calendar")
def list_events(user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(CalendarEvent).where(CalendarEvent.user_id == user.id).order_by(CalendarEvent.date)).all()
    return [_event_out(e) for e in rows]


@router.put("/calendar/{event_id}")
def put_event(event_id: str, body: EventIn, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    if body.id != event_id:
        raise HTTPException(422, "Event id mismatch")
    exists = db.get(CalendarEvent, (user.id, event_id)) is not None
    if not exists and (db.scalar(select(func.count()).select_from(CalendarEvent).where(CalendarEvent.user_id == user.id)) or 0) >= MAX_EVENTS:
        raise HTTPException(413, "Calendar is full")
    _put_event(db, user.id, body)
    db.commit()
    return {"ok": True}


@router.delete("/calendar/{event_id}")
def delete_event(event_id: str, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    db.execute(delete(CalendarEvent).where(CalendarEvent.user_id == user.id, CalendarEvent.id == event_id))
    db.commit()
    return {"ok": True}


# ---------- saved reports ----------

@router.get("/reports", response_model=list[ReportMeta])
def list_reports(user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> list[ReportMeta]:
    rows = db.scalars(select(SavedReport).where(SavedReport.user_id == user.id).order_by(SavedReport.created_at.desc())).all()
    return [ReportMeta(id=r.id, kind=r.kind, title=r.title, job_id=r.job_id, summary=r.summary or {},
                       created_at=r.created_at.isoformat()) for r in rows]


@router.post("/reports", response_model=ReportMeta)
def save_report(body: ReportIn, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> ReportMeta:
    raw = json.dumps(body.data, ensure_ascii=False)
    if len(raw.encode()) > MAX_REPORT_BYTES:
        raise HTTPException(413, "This report is too large to save")
    summary = {k: v for k, v in body.summary.items() if isinstance(v, (int, float, str)) and len(str(v)) < 200}
    r = SavedReport(user_id=user.id, kind=body.kind, title=body.title, job_id=body.job_id, summary=summary,
                    data_enc=crypto.encrypt(raw))
    db.add(r)
    db.commit()
    return ReportMeta(id=r.id, kind=r.kind, title=r.title, job_id=r.job_id, summary=r.summary, created_at=r.created_at.isoformat())


@router.get("/reports/{report_id}")
def get_report(report_id: str, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    r = db.get(SavedReport, report_id)
    if r is None or r.user_id != user.id:
        raise HTTPException(404, "Report not found")
    return {"id": r.id, "kind": r.kind, "title": r.title, "job_id": r.job_id, "created_at": r.created_at.isoformat(),
            "data": crypto.decrypt_json(r.data_enc)}


@router.delete("/reports/{report_id}")
def delete_report(report_id: str, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    db.execute(delete(SavedReport).where(SavedReport.user_id == user.id, SavedReport.id == report_id))
    db.commit()
    return {"ok": True}


# ---------- first sign-in: bring browser data into the account ----------

@router.post("/import")
def import_local(body: ImportIn, user: User = Depends(auth.current_user), db: DB = Depends(get_db)) -> dict:
    """Merge data saved in this browser before sign-in. Anything the account already has wins."""
    added = {"profile": 0, "tuner": 0, "prep": 0, "calendar": 0}
    prof = db.get(Profile, user.id)
    if body.profile and body.profile.resume_text.strip() and not (prof and prof.resume_enc):
        put_profile(body.profile, user, db)
        added["profile"] = 1
    for kind in ("tuner", "prep"):
        for key, data in list(getattr(body, kind).items())[:500]:
            if 0 < len(key) <= 120 and db.get(Document, (user.id, kind, key)) is None:
                _put_doc(db, user.id, kind, key, data)
                added[kind] += 1
    for ev in body.calendar:
        if db.get(CalendarEvent, (user.id, ev.id)) is None:
            _put_event(db, user.id, ev)
            added["calendar"] += 1
    auth.audit(db, "browser_data_imported", user.id, **added)
    db.commit()
    return {"added": added}
