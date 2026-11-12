# Deploying MGA

## Architecture

```
Browser ──► Frontend (Next.js)  ── /api/* rewrite (MGA_API_URL) ──►  API (FastAPI, Docker, N instances) ──► Postgres 16
                                                                          ▲
                                         cron: python -m app.ingest ──────┘   (job boards, Adzuna)
```

- **Frontend**: Next.js on Vercel, or the `frontend/Dockerfile` image on any host. It is the only origin the browser talks to. Next.js proxies `/api/*` to the API using the `MGA_API_URL` rewrite, so the session cookie is first-party and works without cross-site cookie tricks.
- **API**: a stateless container (`backend/Dockerfile`, gunicorn + uvicorn workers) on Render or Railway, or any container host (Cloud Run, ECS, Fly, a VM). Scale it horizontally.
- **Database**: managed Postgres 16 (Neon, Render, Railway, Supabase, RDS). Sessions, login codes, rate limits and job postings all live here, which is why the API holds no state.
- **Migrations**: `alembic upgrade head`, run **once per deploy** as a release / pre-deploy command. Not on every container start: with several instances starting at once they would race.
- **Ingestion**: a scheduled job running `python -m app.ingest` (for example every 6 hours).
- **Reminders**: a scheduled job running `python -m app.reminders` once a day (calendar reminder emails, India time).
- **Email** (login codes): Resend (`RESEND_API_KEY`) or any SMTP server (`MGA_SMTP_URL`).
- **Optional**: Google sign-in (`GOOGLE_CLIENT_ID`), Adzuna jobs (`ADZUNA_APP_ID`/`ADZUNA_APP_KEY`), Claude extraction (`ANTHROPIC_API_KEY`). Without AI the rules engine runs on its own.

The API image sets `MGA_ENV=production`. At import the app calls `settings().check()`, which refuses to start without `MGA_DATA_KEY`, `DATABASE_URL` (Postgres, not SQLite) and an email provider.

## 1. Generate secrets

```bash
# MGA_DATA_KEY: encrypts resumes, interview answers and saved reports
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# MGA_ADMIN_TOKEN: protects POST /jobs/import
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Store them in your platform's secret store. Keep `MGA_DATA_KEY` somewhere safe outside the platform too (a password manager): see Backups.

## 2. Recommended path: Vercel + Render/Railway + managed Postgres

### 2.1 Postgres
Create a Postgres 16 database. Copy its connection string; either `postgresql+psycopg://user:pass@host:5432/db` or the provider's `postgres://` / `postgresql://` form works (the app rewrites them to the psycopg driver). Use the provider's SSL options as needed (for example `?sslmode=require`).

### 2.2 API on Render or Railway
1. New web service from this repo, **root directory `backend`**, runtime Docker (uses `backend/Dockerfile`). The container listens on `$PORT` (default 8000).
2. Environment variables: see the table below.
3. **Release / pre-deploy command**: `alembic upgrade head`
   - Render: "Pre-Deploy Command". Railway: "Pre-deploy command" in the service's deploy settings.
   - The image's entrypoint runs any command you give it, so `alembic upgrade head` works as-is.
4. Health check path: `/health/ready` (liveness is `/health`, which does not touch the database).
5. Set `MGA_TRUST_PROXY=1` (the platform load balancer sets `X-Forwarded-For`).
6. Note the public URL, for example `https://mga-api.onrender.com`.

### 2.3 Reminder emails cron
Create a second cron job from the same image with command `python -m app.reminders` and schedule `30 2 * * *` (08:00 India time). Same environment as the API, including the email provider. It sends one email per user listing their due events, marks them only after the provider accepts the email, and exits 1 if any send failed (so the platform can alert). It is safe to run on two hosts at once on Postgres (`SELECT ... FOR UPDATE SKIP LOCKED`). Users switch reminders off with `PUT /me/settings {"reminder_emails": false}`. `python -m app.reminders --dry-run` counts what would be sent.

### 2.4 Housekeeping cron
A daily job running `python -m app.maintenance` deletes sign-in codes older than a day (they contain email addresses), expired sessions, and audit-log rows of deleted accounts older than `MGA_AUDIT_DAYS` (default 365).

### 2.5 Security settings to know
- `MGA_ENV` must be exactly `production`, `development` or `test`. A missing or mistyped value is treated as production (fail closed): the API refuses to start without `MGA_DATA_KEY`, Postgres and an email provider.
- Sign-in codes are returned in API responses only in development with no email provider, and only to localhost or when `MGA_DEV_ECHO_CODES=1`.
- Behind a load balancer set `MGA_TRUST_PROXY=1` and `MGA_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For` (usually 1), so per-IP rate limits use the address your proxy saw.
- Claude runs only for signed-in users unless `MGA_LLM_PUBLIC=1`.
- `MGA_ADMIN_TOKEN` must be at least 24 characters, or `POST /jobs/import` stays disabled.
- Request bodies are capped at 2.5 MB (6 MB for resume uploads); expensive endpoints allow 30 requests per minute per IP per instance.

### 2.6 Ingestion cron
Create a cron job from the same image with command `python -m app.ingest` and schedule `0 */6 * * *`. Give it the same `DATABASE_URL`, `MGA_DATA_KEY`, `MGA_ENV=production`, an email provider variable (the production check runs on import), and `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` if you use Adzuna. It is safe to run from several places at once: postings are upserted by id, and each board's run is recorded in `ingest_runs`. The board list is `backend/app/data/boards.json`. Other forms:

```bash
python -m app.ingest --source greenhouse --board <token> [--company "Name"]
python -m app.ingest --adzuna "react developer" --where Pune --pages 2
python -m app.ingest --reanalyze      # refresh stored profiles after a taxonomy/extractor change
```

### 2.4 Frontend on Vercel
1. Import the repo, **root directory `frontend`**, framework Next.js.
2. Environment variable `MGA_API_URL` = the API's public URL (no trailing slash). It is read at build and start time, so redeploy the frontend if it changes.
3. Deploy. Your site origin is the Vercel (or custom) domain, for example `https://mga.example.com`.
4. Set `MGA_CORS_ORIGINS` on the API to that origin and redeploy the API.

### 2.5 Smoke test
```bash
curl https://<api>/health          # {"status":"ok",...}
curl https://<api>/health/ready    # {"status":"ready"}  (503 if the database is down)
```
Then open the site and sign in with an emailed code.

## 3. Docker Compose (local full stack / self-hosting)

```bash
cp .env.example .env
docker compose up --build        # web http://localhost:3000, API docs http://localhost:8000/docs
```

Services: `db` (Postgres 16 with the `mga-db` volume), `migrate` (runs `alembic upgrade head`, then exits), `api` (starts after `migrate` succeeds), `web` (`MGA_API_URL=http://api:8000`). One-off ingestion:

```bash
docker compose --profile tools run --rm ingest
docker compose --profile tools run --rm ingest python -m app.ingest --adzuna "react developer" --where Pune
```

Compose defaults to `MGA_ENV=development`: no email provider is needed (the login endpoint returns the code), and tables are also created on first use. To run it like production, set in `.env`: `MGA_ENV=production`, `MGA_DATA_KEY`, `RESEND_API_KEY` or `MGA_SMTP_URL`, `MGA_CORS_ORIGINS` (the site origin), and `MGA_TRUST_PROXY=1` behind a reverse proxy. Production uses Secure cookies, so put HTTPS in front of `web` (`MGA_COOKIE_SECURE=0` is only for a quick test on `http://localhost`). Change `POSTGRES_PASSWORD` for any real install; the database port is not published by default.

## 4. Environment variables

**API service** (and the migrate/ingest jobs; same image)

| Variable | Required | Notes |
|---|---|---|
| `MGA_ENV` | prod | `production` (set by the image). Anything else is development. |
| `DATABASE_URL` | prod | Postgres only in production. |
| `MGA_DATA_KEY` | prod | Fernet key(s), comma-separated, newest first. |
| `RESEND_API_KEY` or `MGA_SMTP_URL` | prod (one of) | `smtp://user:pass@host:587` (STARTTLS) or `smtps://...:465`. |
| `MGA_EMAIL_FROM` | recommended | Default `MGA <login@localhost>`; use an address on your verified domain. |
| `MGA_CORS_ORIGINS` | yes | Site origin, comma-separated list. Default `http://localhost:3000`. |
| `MGA_TRUST_PROXY` | behind LB | `1` to take the client IP from `X-Forwarded-For` for rate limits. |
| `MGA_ADMIN_TOKEN` | optional | Enables `POST /jobs/import`. |
| `GOOGLE_CLIENT_ID` | optional | Enables Google sign-in. |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | optional | Adzuna ingestion. |
| `ANTHROPIC_API_KEY`, `MGA_MODEL`, `MGA_LLM_EFFORT`, `MGA_LLM` | optional | AI extraction. `MGA_LLM=0` forces it off. |
| `MGA_SESSION_DAYS` | optional | Default 30. |
| `MGA_COOKIE_DOMAIN`, `MGA_COOKIE_SECURE` | optional | Defaults: host-only cookie; Secure in production. |
| `MGA_AUTO_CREATE`, `MGA_SEED_SAMPLES` | optional | Auto-create tables (default off in production); load sample postings once (default on). |
| `PORT`, `WEB_CONCURRENCY` | optional | Listen port (default 8000); gunicorn workers (default 2). |

**Frontend**: `MGA_API_URL` only (build and runtime). In Docker pass it as `--build-arg MGA_API_URL=...` and as an env var.

Seeded sample postings: with `MGA_SEED_SAMPLES` on (the default), 14 synthetic sample postings are loaded once into an empty database. Set `MGA_SEED_SAMPLES=0` if you do not want them in production.

## 5. Third-party setup

**Google sign-in.** In Google Cloud Console create an OAuth client of type *Web application*. Under *Authorized JavaScript origins* add the site origin (for example `https://mga.example.com`, and `http://localhost:3000` for local testing). Put the client ID in `GOOGLE_CLIENT_ID` on the API. The API verifies Google ID tokens; no client secret is used.

**Resend.** Add and verify your sending domain in Resend (DNS records: SPF and DKIM) before launch; until then Resend only sends to your own address. Set `MGA_EMAIL_FROM` to an address on that domain, for example `MGA <login@mga.example.com>`.

**Adzuna.** Register for an API key (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`). Attribution requirement: wherever Adzuna results are shown, display "Jobs by Adzuna" next to them. Check the UI meets this before enabling Adzuna in production.

**Admin token.** `POST /jobs/import?source=greenhouse|lever&board=<token>[&company=Name]` pulls one company's public board immediately. Send the token in the `X-Admin-Token` header. Without `MGA_ADMIN_TOKEN` set the endpoint always returns 403.

```bash
curl -X POST "https://<api>/jobs/import?source=greenhouse&board=<token>" -H "X-Admin-Token: $MGA_ADMIN_TOKEN"
```

## 6. Migrations

Run `alembic upgrade head` from the backend directory (or via the image: `docker run --rm --env-file ... mga-api alembic upgrade head`) once per deploy, before the new API instances take traffic. It uses the same `DATABASE_URL`.

To create a migration after changing `backend/app/db/models.py`:

```bash
cd backend
alembic revision --autogenerate -m "describe the change"
# review the generated file in migrations/versions/ before committing it
alembic upgrade head
```

Production does not auto-create tables (`MGA_AUTO_CREATE` defaults to off there), so a missing migration shows up as errors. Keep migrations backward compatible with the previous release while a rolling deploy is in progress.

## 7. Key rotation

`MGA_DATA_KEY` accepts several keys separated by commas, newest first. New data is encrypted with the first key; older data still decrypts with the others.

1. Generate a new key.
2. Set `MGA_DATA_KEY=<new>,<old>` on every service that uses it (API, ingest) and redeploy.
3. Keep the old key in the list for as long as data encrypted with it exists. Removing it makes that data unreadable (the app raises "wrong or rotated-out MGA_DATA_KEY"). There is no built-in re-encryption command: do not drop an old key until you have confirmed nothing depends on it.

## 8. Backups

Use the managed Postgres provider's backups and point-in-time restore. Test a restore before launch. Personal data in the database (resumes, answers, saved reports) is encrypted with `MGA_DATA_KEY`, so a restored backup is unreadable without the matching key. Store the key (all keys still in use) separately and securely.

## 9. Scaling

- The API is stateless: add instances behind the platform's load balancer. Sessions, login codes and rate limits are stored in Postgres, so they hold across instances.
- Each worker process has its own connection pool: `pool_size` 5 plus `max_overflow` 10, up to 15 connections. Keep **instances x `WEB_CONCURRENCY` x 15** below the Postgres connection limit (the migrate and ingest jobs need a few too). Beyond that use PgBouncer or the provider's pooler (Neon pooler, Supabase pooler), and point `DATABASE_URL` at it.
- Job caches check a cheap version marker in the database at most every 60 seconds, so a new ingestion appears on every instance within about a minute.
- Gunicorn runs with `--timeout 60`. Resume parsing and AI calls must finish within that.

## 10. Production checklist

- [ ] `MGA_ENV=production`, `DATABASE_URL` is Postgres, `MGA_DATA_KEY` generated and backed up separately
- [ ] Email provider set and sending domain verified; a real login code arrives
- [ ] `MGA_CORS_ORIGINS` = the exact site origin; HTTPS on the site and the API
- [ ] `MGA_TRUST_PROXY=1` behind a load balancer
- [ ] `alembic upgrade head` is the release command; the API health check uses `/health/ready`
- [ ] Ingestion cron scheduled and a run visible in `ingest_runs`
- [ ] Reminder cron scheduled (`python -m app.reminders --dry-run` first)
- [ ] Housekeeping cron scheduled (`python -m app.maintenance`)
- [ ] `MGA_ENV=production` set exactly; `MGA_ADMIN_TOKEN` ≥ 24 characters
- [ ] `MGA_ADMIN_TOKEN` set only if you need `/jobs/import`; kept secret
- [ ] Google origin added if Google sign-in is enabled; "Jobs by Adzuna" shown if Adzuna is enabled
- [ ] Database backups on and a restore tested
- [ ] Connection budget checked: instances x workers x 15 < Postgres limit
- [ ] No real secrets committed; `.env` is gitignored
- [ ] Sample postings (`MGA_SEED_SAMPLES`) kept or disabled on purpose
