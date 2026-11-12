"""Database engine and sessions.

Postgres in production (DATABASE_URL=postgresql+psycopg://...); SQLite works for
local development and tests. Tables are created by Alembic migrations in
production (`alembic upgrade head`); in development they are created on first use.
"""
from __future__ import annotations

import threading
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import settings
from .models import Base

_init_lock = threading.Lock()
_initialized = False


def _url() -> str:
    url = settings().database_url
    if url.startswith("postgres://"):  # Heroku/Render style
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


@lru_cache(maxsize=1)
def engine() -> Engine:
    url = _url()
    if url.startswith("sqlite"):
        eng = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(eng, "connect")
        def _fk_on(conn, _rec):  # SQLite ignores foreign keys unless asked
            conn.execute("PRAGMA foreign_keys=ON")
        return eng
    # Pool sized per worker process; several API instances share the database.
    return create_engine(url, pool_size=5, max_overflow=10, pool_pre_ping=True, pool_recycle=1800)


@lru_cache(maxsize=1)
def _factory() -> sessionmaker[Session]:
    return sessionmaker(bind=engine(), expire_on_commit=False)


def init() -> None:
    """Create tables (dev/tests) and seed sample postings, once per process."""
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        if settings().auto_create_tables:
            Base.metadata.create_all(engine())
        _initialized = True
    from ..jobs.store import seed_samples
    if settings().seed_samples:
        seed_samples()


def SessionLocal() -> Session:
    init()
    return _factory()()


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def reset_for_tests() -> None:
    global _initialized
    Base.metadata.drop_all(engine())
    Base.metadata.create_all(engine())
    _initialized = False
