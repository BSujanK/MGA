# MGA API. Build context: backend/   (docker build -t mga-api backend)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first so this layer is cached until requirements.txt changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App, migrations and the evaluation harness. Tests are not shipped.
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
COPY eval ./eval
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && useradd --system --uid 10001 --no-create-home mga \
    && chown -R mga:mga /app
USER mga

# The app calls settings().check() at import: production needs MGA_DATA_KEY,
# DATABASE_URL (Postgres) and an email provider (RESEND_API_KEY or MGA_SMTP_URL).
ENV MGA_ENV=production \
    PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8000'), timeout=4)" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
# Default: serve. Override for one-off jobs, e.g.
#   alembic upgrade head      (release / pre-deploy command)
#   python -m app.ingest      (scheduled ingestion)
CMD ["serve"]
