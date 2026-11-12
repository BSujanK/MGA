#!/bin/sh
# "serve" (the default) starts gunicorn; anything else runs as given
# (alembic upgrade head, python -m app.ingest, ...).
set -e
if [ "$1" = "serve" ]; then
  exec gunicorn app.main:app \
    -k uvicorn.workers.UvicornWorker \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --timeout 60 \
    --access-logfile -
fi
exec "$@"
