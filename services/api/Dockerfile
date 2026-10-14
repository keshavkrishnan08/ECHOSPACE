# ECHOSPACE API (FastAPI + Python reference engine).
# Build from the repository root:
#   docker build -f services/api/Dockerfile -t echospace-api .
#   docker run -p 8000:8000 -e DATABASE_URL=postgresql+psycopg://echospace:echospace@db:5432/echospace echospace-api
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AUTO_MIGRATE=false \
    OBJECT_STORE_DIR=/data/objects \
    DATABASE_URL=sqlite:////data/echospace.db

WORKDIR /app

# Package metadata and sources. The install is editable so the service finds models/, datasets/
# and its Alembic migrations relative to the source tree.
COPY pyproject.toml README.md ./
COPY services ./services
COPY engine/python ./engine/python
COPY models ./models
COPY datasets ./datasets
RUN pip install -e ".[api]" \
    && useradd --create-home --uid 10001 echospace \
    && mkdir -p /data && chown echospace /data

USER echospace
EXPOSE 8000
CMD ["sh", "-c", "alembic -c services/api/alembic.ini upgrade head && exec uvicorn echospace_api.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
