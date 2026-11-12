"""Settings from the environment. Development works with no configuration;
production refuses to start without the secrets it needs."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    env: str = field(default_factory=lambda: os.getenv("MGA_ENV", "development"))
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./mga-dev.db"))
    data_keys: tuple[str, ...] = field(default_factory=lambda: tuple(k.strip() for k in os.getenv("MGA_DATA_KEY", "").split(",") if k.strip()))
    session_days: int = field(default_factory=lambda: int(os.getenv("MGA_SESSION_DAYS", "30")))
    cookie_name: str = "mga_session"
    cookie_domain: str | None = field(default_factory=lambda: os.getenv("MGA_COOKIE_DOMAIN") or None)
    google_client_id: str | None = field(default_factory=lambda: os.getenv("GOOGLE_CLIENT_ID") or None)
    email_from: str = field(default_factory=lambda: os.getenv("MGA_EMAIL_FROM", "MGA <login@localhost>"))
    smtp_url: str | None = field(default_factory=lambda: os.getenv("MGA_SMTP_URL") or None)  # smtp(s)://user:pass@host:port
    resend_api_key: str | None = field(default_factory=lambda: os.getenv("RESEND_API_KEY") or None)
    seed_samples: bool = field(default_factory=lambda: _bool("MGA_SEED_SAMPLES", True))
    auto_create_tables: bool = field(default_factory=lambda: _bool("MGA_AUTO_CREATE", os.getenv("MGA_ENV", "development") != "production"))
    admin_token: str | None = field(default_factory=lambda: os.getenv("MGA_ADMIN_TOKEN") or None)
    trust_proxy: bool = field(default_factory=lambda: _bool("MGA_TRUST_PROXY", False))  # behind a load balancer
    adzuna_app_id: str | None = field(default_factory=lambda: os.getenv("ADZUNA_APP_ID") or None)
    adzuna_app_key: str | None = field(default_factory=lambda: os.getenv("ADZUNA_APP_KEY") or None)

    @property
    def production(self) -> bool:
        return self.env == "production"

    @property
    def cookie_secure(self) -> bool:
        return _bool("MGA_COOKIE_SECURE", self.production)

    def check(self) -> None:
        """Fail fast in production rather than run with dev defaults."""
        if not self.production:
            return
        missing = [n for n, ok in [("MGA_DATA_KEY", self.data_keys), ("DATABASE_URL", "DATABASE_URL" in os.environ),
                                   ("email (MGA_SMTP_URL or RESEND_API_KEY)", self.smtp_url or self.resend_api_key)] if not ok]
        if missing:
            raise RuntimeError(f"Production config missing: {', '.join(missing)}")
        if self.database_url.startswith("sqlite"):
            raise RuntimeError("Use Postgres in production (DATABASE_URL=postgresql+psycopg://...)")


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings()
