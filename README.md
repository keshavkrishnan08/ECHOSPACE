# ECHOSPACE

Ambient RF-to-3D spatial imaging and passive Wi-Fi sensing, built as a research instrument.

ECHOSPACE simulates channel state information (CSI) between radio links in a room, runs it
through an inspectable signal-processing pipeline, reconstructs 3D occupancy with explicit
uncertainty, tracks people over time and evaluates everything against synthetic ground truth.
It runs entirely in the browser with no hardware. Recorded CSI can be imported, and a live
ESP32 adapter exists as an experimental extension.

Nothing simulated is presented as measured, unobserved regions are reported as unknown, and
models without trained weights refuse to run.

## Quick start

```bash
pnpm install
pnpm dev                       # http://localhost:3000  (browser engine, no services needed)
```

The app boots a synthetic session (scenario B) and starts streaming. Press `⌘/Ctrl K` for the
command palette, `?` for shortcuts, or open **Overview → Guided demo** for the two-minute walk
through. The **Showcase** page holds recorded walkthroughs, a gallery and the design rationale.

Optional services:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[api,dev]"
cd services/api && alembic upgrade head && uvicorn echospace_api.main:app --port 8000
```

Or the full stack (PostgreSQL, MinIO, API, web): `docker compose up --build`.

Native DSP library:

```bash
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release && cmake --build engine/build -j
ctest --test-dir engine/build
```

## Repository

```
apps/web/              Next.js app: Lab, Arena, Studio, Workbench, catalog, showcase
packages/schemas/      Zod schemas and the metric catalogue shared by every surface
packages/engine/       TypeScript engine: simulator, DSP, RTI, tracking, metrics, runtime
services/simulator/    Python reference simulator (bit-for-bit parity with the TS engine)
services/inference/    Python reference DSP, reconstruction, tracking and metrics
services/api/          FastAPI control plane, SQLAlchemy + Alembic, WebSocket stream
services/telemetry/    OpenTelemetry setup
engine/                C++20 DSP library, optional CUDA kernels, benchmarks, gRPC contract
models/                Registry, model cards, ridge baseline training and evaluation
datasets/manifests/    Dataset manifests with provenance and licensing
docs/                  Architecture, simulation model, API, tolerances, privacy, demo script
```

## Tests

| suite | command |
|---|---|
| TS engine (unit, pipeline, determinism, recordings, ridge) | `pnpm --filter @echospace/engine test` |
| Python reference, parity, API, migrations, WebSocket | `pytest -q` |
| C++ kernels and ring buffer, native vs NumPy | `ctest --test-dir engine/build && pytest -q engine/tests` |
| End to end (acceptance flow, every route, keyboard, failure states) | `pnpm e2e` |

## What is and is not claimed

- Simulation: a simplified analytic multipath model (see `docs/simulation-model.md`). It is not
  an electromagnetic solver.
- Reconstruction accuracy numbers are simulation metrics on synthetic scenes.
- Timings come from the running code on the machine that measured them.
- The ESP32 serial and CSV adapters follow the published format; they have not been validated
  against a physical capture in this repository.
- The CUDA kernels have not been compiled or run; the CPU path is the default.
- No model infers skeletons. Skeletons drawn in the app are synthetic ground truth.
