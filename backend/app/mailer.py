"""Outgoing email (login codes). Resend's HTTP API or any SMTP server.

With neither configured outside production, emails are logged instead, and the
login endpoint returns the code to the caller so local development works offline.
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import unquote, urlparse

import httpx

from .config import settings

log = logging.getLogger("mga.mail")


class MailError(RuntimeError):
    pass


def configured() -> bool:
    s = settings()
    return bool(s.resend_api_key or s.smtp_url)


def send(to: str, subject: str, text: str) -> None:
    s = settings()
    if s.resend_api_key:
        try:
            r = httpx.post("https://api.resend.com/emails", timeout=15,
                           headers={"Authorization": f"Bearer {s.resend_api_key}"},
                           json={"from": s.email_from, "to": [to], "subject": subject, "text": text})
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise MailError(f"Email provider error: {e}") from e
        return
    if s.smtp_url:
        u = urlparse(s.smtp_url)
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = s.email_from, to, subject
        msg.set_content(text)
        try:
            if u.scheme == "smtps":
                server = smtplib.SMTP_SSL(u.hostname, u.port or 465, timeout=15, context=ssl.create_default_context())
            else:
                server = smtplib.SMTP(u.hostname, u.port or 587, timeout=15)
                server.starttls(context=ssl.create_default_context())
            with server:
                if u.username:
                    server.login(unquote(u.username), unquote(u.password or ""))
                server.send_message(msg)
        except (OSError, smtplib.SMTPException) as e:
            raise MailError(f"SMTP error: {e}") from e
        return
    if s.production:
        raise MailError("No email provider configured")
    log.warning("DEV EMAIL to %s: %s\n%s", to, subject, text)
