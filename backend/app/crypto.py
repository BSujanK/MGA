"""Encryption at rest for personal data (resume text, interview answers, saved reports).

MGA_DATA_KEY holds one or more Fernet keys, comma-separated, newest first, so
keys can be rotated: new data uses the first key, old data still decrypts.
Generate one with:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from .config import settings

log = logging.getLogger("mga.crypto")


@lru_cache(maxsize=1)
def _fernet() -> MultiFernet:
    keys = list(settings().data_keys)
    if not keys:
        if settings().production:
            raise RuntimeError("MGA_DATA_KEY is required in production")
        log.warning("MGA_DATA_KEY not set: using an insecure development key")
        keys = [base64.urlsafe_b64encode(hashlib.sha256(b"mga-dev-only-key").digest()).decode()]
    return MultiFernet([Fernet(k) for k in keys])


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def decrypt(token: str | None) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise RuntimeError("Could not decrypt stored data: wrong or rotated-out MGA_DATA_KEY") from e


def encrypt_json(obj) -> str:
    return encrypt(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def decrypt_json(token: str | None, default=None):
    return json.loads(decrypt(token)) if token else default


def token_hash(token: str) -> str:
    """Session tokens and login codes are stored only as hashes."""
    return hashlib.sha256(token.encode()).hexdigest()


def code_hash(email: str, code: str) -> str:
    """Login codes are short, so they are keyed with a server secret (HMAC) before storage."""
    import hmac

    secret = (settings().data_keys[0] if settings().data_keys else "mga-dev-only-key").encode()
    return hmac.new(secret, f"{email.lower()}:{code}".encode(), hashlib.sha256).hexdigest()
