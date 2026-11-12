"""Request limits that protect a public API.

- BodySizeLimit: rejects oversized request bodies before they are parsed.
- llm_gate: Claude costs money, so by default only signed-in users get it
  (MGA_LLM_PUBLIC=1 opens it to everyone). Anonymous requests run rules-only.
- throttle: per-IP limit for the expensive anonymous endpoints. It is per
  API instance (in memory), a damper against scripted abuse, not a quota.
"""
from __future__ import annotations

import contextvars
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import settings

MAX_BODY = 2_500_000            # JSON bodies (saved reports are capped at 2 MB)
MAX_UPLOAD_BODY = 6_000_000     # resume files are capped at 5 MB, plus multipart overhead
UPLOAD_PATHS = ("/resume/parse", "/analyze/resume/file")

llm_allowed: contextvars.ContextVar[bool] = contextvars.ContextVar("llm_allowed", default=True)


class BodySizeLimit:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = MAX_UPLOAD_BODY if scope["path"].endswith(UPLOAD_PATHS) else MAX_BODY
        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > limit:
                return await _too_large(send)
        seen = 0

        async def limited() -> dict:
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > limit:
                    raise _BodyTooLarge
            return msg

        try:
            await self.app(scope, limited, send)
        except _BodyTooLarge:
            await _too_large(send)


class _BodyTooLarge(Exception):
    pass


async def _too_large(send: Send) -> None:
    body = b'{"detail":"Request body too large"}'
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


async def llm_gate(request: Request) -> None:
    """App-wide dependency. Async on purpose: the context variable it sets is copied into the
    worker thread that runs the (sync) endpoint, so service._use_llm sees it."""
    from . import llm
    if not llm.enabled() or settings().llm_public:
        llm_allowed.set(True)
        return

    def signed_in() -> bool:
        from .auth import session_for
        from .db import SessionLocal
        with SessionLocal() as db:
            return session_for(db, request) is not None

    has_token = bool(request.cookies.get(settings().cookie_name) or request.headers.get("authorization"))
    llm_allowed.set(has_token and await run_in_threadpool(signed_in))


class _Window:
    def __init__(self) -> None:
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str, limit: int, per: float) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > per:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            if len(self.hits) > 50_000:  # bound memory under a flood of distinct IPs
                self.hits.clear()
            return True


_window = _Window()
HEAVY_PER_MINUTE = 30


def throttle(request: Request) -> None:
    """Dependency for expensive endpoints: 30 requests a minute per client IP per instance."""
    from .auth import client_ip
    if settings().env == "test":
        return
    if not _window.allow(f"{request.url.path}:{client_ip(request)}", HEAVY_PER_MINUTE, 60.0):
        raise HTTPException(429, "Too many requests. Wait a minute and try again.")
