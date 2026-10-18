# ECHOSPACE API (`echospace_api`)

FastAPI control plane around the Python reference engine (`echospace_sim` + `echospace_inference`).
It is optional: the web app runs entirely in the browser and uses this service, when reachable, to
store experiments, run Python reference sessions and stream them over WebSocket.

Full endpoint and protocol reference: [`docs/api.md`](../../docs/api.md).

## Run locally

```sh
# from the repository root
uv venv && . .venv/bin/activate
uv pip install -e ".[api,dev]"

cd services/api
alembic upgrade head          # optional locally: AUTO_MIGRATE=true (default) does this at startup
uvicorn echospace_api.main:app --reload --port 8000
```

Defaults: SQLite at `./var/echospace.db`, objects under `./var/objects` (relative to the working
directory), CORS for `http://localhost:3000`. The web app's API base URL setting should point at
`http://localhost:8000`.

## Configuration

Environment variables (or a `.env` file in the working directory):

| variable | default | meaning |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./var/echospace.db` | SQLAlchemy URL; Postgres: `postgresql+psycopg://user:pass@host:5432/echospace` |
| `OBJECT_STORE` | `local` | `local` or `s3` |
| `OBJECT_STORE_DIR` | `./var/objects` | root of the local object store |
| `S3_ENDPOINT` | unset | S3-compatible endpoint, e.g. MinIO `http://minio:9000` |
| `S3_BUCKET` / `S3_REGION` | `echospace` / `us-east-1` | bucket (must exist) and region |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | unset | read by boto3 |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated allowed origins |
| `RAW_RETENTION_DAYS` | `30` | uploaded raw recordings are purged after this many days |
| `MAX_UPLOAD_MB` | `512` | upload size limit |
| `LOG_LEVEL` | `INFO` | JSON logs on stderr |
| `WS_QUEUE_MAXSIZE` | `32` | per-connection outbound queue length |
| `TIMING_EVERY_FRAMES` | `10` | how often `timing` messages are sent |
| `AUTO_MIGRATE` | `true` | run `alembic upgrade head` at startup |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | enables OpenTelemetry trace export (needs extra `otlp`) |

## Endpoints

| method | path | purpose |
| --- | --- | --- |
| GET | `/api/health` | status, version, capabilities, database and object-store kind |
| GET | `/api/diagnostics` | process info, DB / object-store ping, live session queue stats |
| GET | `/metrics` | Prometheus counters |
| GET | `/api/projects` | projects of the current user |
| POST | `/api/sessions` | create a session (synthetic / recorded / hardware) |
| GET | `/api/sessions/{id}` | session state and counters |
| POST | `/api/sessions/{id}/start` | start the reference engine (synthetic sessions) |
| POST | `/api/sessions/{id}/stop` | stop, close WebSockets, flush counters, events and metric series |
| GET | `/api/sessions/{id}/metrics` | metric time series with their definitions |
| GET | `/api/scenarios` | presets A-J with objective, lesson, difficulty and config |
| POST | `/api/simulations` | create a synthetic session from a preset key or a config |
| POST | `/api/simulations/{id}/restart` | restart from t = 0, optionally with a new seed |
| GET | `/api/experiments` | experiment summaries; `?full=true` returns full records |
| POST | `/api/experiments` | store an `ExperimentRecord` (idempotent on `id`) |
| GET | `/api/experiments/{id}` | the full record |
| DELETE | `/api/experiments/{id}` | delete record and payload object |
| GET | `/api/models`, `/api/models/{id}` | model cards from `models/registry.json` |
| GET | `/api/datasets` | manifests from `datasets/manifests/*.json` |
| POST | `/api/recordings` | multipart upload of a raw recording (consent required) |
| GET | `/api/recordings` | recordings of a project |
| DELETE | `/api/recordings/{id}` | delete the object and the rows (audited) |
| WS | `/ws/sessions/{id}` | live stream of a session |

## Design notes

- **Storage.** Rows hold metadata and summaries only. Experiment series/events, session metric
  series and uploaded recordings are objects in the object store, referenced by `artifacts`
  rows (key, format, size, SHA-256, provenance, `retention_until`).
- **Retention.** Raw uploads get `retention_until = upload + RAW_RETENTION_DAYS`; an hourly job
  deletes expired objects and rows and writes `retention.purge` audit events.
- **Auth.** Local mode: one seeded user (`user_local`) who owns the seeded `default` project.
  Every route resolves the user through the `current_user` dependency and checks project
  membership with `require_member`, so a real identity provider replaces one function.
- **Sessions.** One engine per running session, stepped in a worker thread. Frames fan out to
  each WebSocket through a bounded queue that drops the oldest frame/metrics messages when a
  client falls behind and reports the count in `timing` messages. Disconnecting does not stop a
  session; reconnecting resumes the live stream.
- **Hardware.** Hardware sessions require `authorized: true` and a `consentNote` (403
  otherwise). The Python service has no acquisition backend, so starting a hardware or recorded
  session returns 409 rather than pretending to stream.
- **Observability.** JSON logs with `requestId` (from / returned in `X-Request-ID`) and
  `sessionId`; OpenTelemetry spans for requests and engine steps when an OTLP endpoint is
  configured. Signal arrays are never logged.

## Tests

```sh
pytest -q services/api/tests
```

They use a temporary SQLite database and local object store, run the Alembic migrations on a fresh
database, and stream real (reduced-size) reference-engine sessions over the WebSocket.

## Docker

```sh
docker build -f services/api/Dockerfile -t echospace-api .
docker run -p 8000:8000 -v echospace-data:/data echospace-api
```

The container runs `alembic upgrade head` and then uvicorn on port 8000.
