# ECHOSPACE API reference

The API (`services/api/echospace_api`) is a FastAPI service around the Python reference engine.
All JSON uses camelCase field names matching the zod schemas in `packages/schemas/src`. The
interactive OpenAPI description is served at `/docs` and `/openapi.json` by a running instance.

Conventions:

- Every response carries `X-Request-ID` (a well-formed incoming one is reused, otherwise one is
  generated). Logs and audit events record it.
- Validation errors return **422** with FastAPI's `detail` array (`loc`, `msg`, `type`).
- **404** unknown resource, **403** not permitted (missing authorization / consent / project
  membership), **409** state conflict, **413** upload too large.
- Authentication is local: every request acts as the seeded local user, who owns project
  `default`.

## System

### `GET /api/health`

```json
{
  "status": "ok",
  "version": "0.1.0",
  "capabilities": { "websocket": true, "pythonReferenceEngine": true, "gpu": false, "nativeDsp": true },
  "database": "sqlite",
  "objectStore": "local"
}
```

`gpu` is true only if PyTorch reports CUDA or NVML finds a device. `nativeDsp` is true when
`engine/python/echospace_native` imports and its shared library loads.

### `GET /api/diagnostics`

Process information, database and object-store round trips, and the queues of live sessions.

```json
{
  "process": { "pid": 4120, "python": "3.12.7", "platform": "Linux-6.8-x86_64", "cpuCount": 8, "threads": 6,
               "uptimeS": 81.4, "maxRssBytes": 213491712, "cpuUserS": 12.1, "cpuSystemS": 0.4 },
  "database": { "kind": "sqlite", "ok": true, "latencyMs": 0.4 },
  "objectStore": { "kind": "local", "ok": true, "latencyMs": 0.02 },
  "gpu": { "available": false, "via": null, "devices": [] },
  "nativeDsp": { "available": true, "library": "/app/engine/build/lib/libechospace_dsp.so", "abiVersion": 1 },
  "sessions": [
    { "sessionId": "ses_4706d66730e74e3a", "state": "streaming", "running": true, "framesProduced": 312,
      "lastProcessingMs": 61.2, "lastStepMs": 248.9,
      "subscribers": [ { "id": "a1b2c3d4e5f6", "queueDepth": 0, "queueCapacity": 32, "dropped": 0, "sent": 655, "ackedSeq": 650 } ] }
  ],
  "counters": { "framesProduced": 312, "wsMessagesSent": 655, "wsMessagesDropped": 0 }
}
```

### `GET /metrics`

Prometheus text format: `echospace_http_requests_total{method,status}`,
`echospace_ws_messages_sent_total`, `echospace_ws_messages_dropped_total`,
`echospace_frames_produced_total`.

## Projects

### `GET /api/projects`

```json
{ "items": [ { "id": "default", "name": "default", "description": "Default project",
               "createdAt": "2026-10-14T20:06:13.374773Z", "role": "owner" } ] }
```

## Sessions

A session binds a scenario configuration to one Python reference engine. Lifecycle (`status`):
`created → running → stopped` (or `failed` on an engine error). The live processing `state`
follows `StatusPayload.state`: `idle | initializing | calibrating | streaming | paused | degraded | error`.

### `POST /api/sessions`

```json
{
  "projectId": "default",
  "sourceMode": "synthetic",
  "config": { "...": "a complete ScenarioConfig (packages/schemas/src/scenario.ts)" },
  "authorized": false,
  "consentNote": "",
  "pace": "realtime"
}
```

- `config` is validated with the Python mirror of zod `ScenarioConfig` (same bounds and defaults);
  invalid input → 422.
- `sourceMode: "hardware"` requires `authorized: true` **and** a non-empty `consentNote`;
  otherwise 403 (the rejection is audited). The service has no hardware or recorded-replay
  backend, so such sessions are stored but `start` answers 409.
- `pace`: `realtime` emits one frame per frame period (or as fast as the engine can, if slower);
  `max` runs the engine back to back.

Response **201**:

```json
{
  "id": "ses_4706d66730e74e3a", "projectId": "default", "sourceMode": "synthetic",
  "engine": "python-reference", "status": "created", "state": "idle", "scenario": "B", "seed": 7,
  "modelId": "rti-bayes", "configHash": "e14e5a95", "pace": "realtime", "authorized": false,
  "createdAt": "2026-10-14T20:06:45.318665Z", "startedAt": null, "stoppedAt": null,
  "framesProduced": 0, "framesDropped": 0, "subscribers": 0, "wsPath": "/ws/sessions/ses_4706d66730e74e3a"
}
```

`configHash` is the same FNV-1a hash of the canonical JSON that the browser engine computes
(`stableHash` in `packages/engine/src/sim/scene.ts`).

### `GET /api/sessions/{id}`

The session object above with live counters (`framesProduced`, `framesDropped` = messages
dropped by full WebSocket queues, `subscribers`).

### `POST /api/sessions/{id}/start`

Starts the engine (building it includes an empty-room calibration capture). Idempotent while
running. 409 for stopped/failed sessions and for non-synthetic sessions.

### `POST /api/sessions/{id}/stop`

Cancels the engine, sends a final `status` (`idle`, "session stopped") to every WebSocket and
closes them with code 1000, then flushes: frame counters and buffered session events go to the
database and the metric series to the object store (`artifacts` row of kind
`session-metrics`). Returns the session with `status: "stopped"`.

### `GET /api/sessions/{id}/metrics`

Time series of the metrics computed per frame (live from memory while the session exists in
this process, from the flushed artifact afterwards), each with its definition from the metric
catalogue (a port of `packages/schemas/src/metrics.ts`). Simulation metrics (`floorIou`,
`positionErrorM`, …) are computed against synthetic ground truth and are `null` while
calibrating or when the model is unsupported.

```json
{
  "sessionId": "ses_4706d66730e74e3a",
  "definitions": [
    { "id": "processingMs", "label": "Processing time", "unit": "ms", "kind": "system", "better": "lower",
      "definition": "Sum of measured stage durations (performance.now) for one frame inside the engine. Excludes queueing and transfer.",
      "source": "packages/engine pipeline stage timers" }
  ],
  "series": [ { "id": "processingMs", "t": [0.1, 0.2, 0.3], "v": [61.0, 58.7, 60.2] } ]
}
```

In the Python service `processingMs` is the wall time of `Pipeline.process` for the frame;
packet synthesis is excluded (it is reported as `stepMs` in `timing` messages).

## Scenarios and simulations

### `GET /api/scenarios`

```json
{ "items": [ { "key": "B", "title": "Human motion across a room",
               "objective": "Observe how one synthetic subject walking, stopping, turning and sitting changes the CSI and the reconstruction.",
               "lesson": "Motion produces large, structured changes ...", "difficulty": "moderate",
               "config": { "...": "ScenarioConfig" } } ] }
```

### `POST /api/simulations`

Creates a synthetic session for the Python reference engine. Give exactly one of `scenario`
(preset key `A`-`J`) or `config`; `seed` overrides the configuration's seed.

```json
{ "scenario": "B", "seed": 42, "pace": "realtime", "projectId": "default" }
```

Response **201**: a session object (`status: "created"`). Connect to `wsPath` or call
`/start` to run it.

### `POST /api/simulations/{id}/restart`

Body (optional): `{ "seed": 43 }`. Cancels the engine, rebuilds it from t = 0 and starts it.
Connected WebSockets stay connected and keep receiving envelopes; the envelope `seq` keeps
increasing while frame `seq` restarts at 0.

## Experiments

`ExperimentRecord` (`packages/schemas/src/experiment.ts`) is mirrored as a Pydantic model with
the same fields, defaults and bounds. On `POST` the configuration, scalar fields and metric
summaries are stored in the database; `series`, `events` and `configChanges` are written as one
JSON object to the object store (`artifacts` row of kind `experiment-payload`). Reads reassemble
the original record.

### `POST /api/experiments`

Body: the record exactly as the web app's `saveExperiment()` sends it (canonical JSON).

- **201** `{ "id": "exp_m2x9k1ab3f", "created": true, "payloadArtifact": { "id": "art_…", "key": "projects/default/experiments/exp_m2x9k1ab3f/payload.json", "kind": "experiment-payload", "format": "echospace-experiment-payload+json", "contentType": "application/json", "sizeBytes": 2210, "sha256": "…", "provenance": { … }, "retentionUntil": null, "createdAt": "…" } }`
- **200** with `created: false` if a record with this `id` and identical content already exists
  (idempotent re-submission).
- **409** if a record with this `id` exists with different content (records are immutable).

### `GET /api/experiments`

`{ "items": [ExperimentSummary] }` ordered by `startedAt` descending. A summary has `id`, `name`,
`projectId`, `sourceMode`, `engine`, `modelId`, `modelVersion`, `status`, `startedAt`, `endedAt`,
`simulatedDurationS`, `frames`, `configHash`, `scenario`, `tags` and `summaries`.

- `?full=true` returns full `ExperimentRecord`s (what `useExperiments()` requests).
- `?projectId=…` restricts to one project.

### `GET /api/experiments/{id}` / `DELETE /api/experiments/{id}`

The full record, or **204** after deleting the rows and the payload object.

## Models and datasets

### `GET /api/models`, `GET /api/models/{id}`

Model cards from `models/registry.json`, validated against zod `ModelCard`:

```json
{ "items": [ { "id": "ridge-floor", "name": "Ridge floor occupancy", "family": "shallow-learned",
               "version": "1.0.0", "status": "available", "preprocessingVersion": "pp-1.0.0",
               "supportedTasks": ["occupancy-floor"], "providesJoints": false,
               "trainingDataset": "synthetic-ridge-v1", "evaluation": [ { "dataset": "synthetic-ridge-v1", "split": "test", "metric": "floor-iou@0.5", "value": 0.41, "note": "synthetic test scenes; not validated on real data" } ],
               "...": "…" } ] }
```

### `GET /api/datasets`

Manifests from `datasets/manifests/*.json`, validated against zod `DatasetManifest`
(invalid files are skipped and logged).

## Recordings

### `POST /api/recordings` (multipart/form-data)

Parts:

- `metadata`: JSON

  ```json
  { "projectId": "default", "name": "bench capture 3", "sourceMode": "recorded", "format": "csi-npz",
    "consent": true, "consentNote": "single operator, written consent on file",
    "sessionId": null, "sampleRateHz": 100, "durationS": 60, "retentionDays": 14, "metadata": { "rig": "A" } }
  ```

- `file`: the raw bytes.

`consent` must be `true` (403 otherwise, before anything is stored); hardware recordings also
need a `consentNote`. The file is streamed to the object store while its SHA-256 is computed;
`retentionUntil` is set from `retentionDays` or `RAW_RETENTION_DAYS`. Response **201**:

```json
{ "id": "rec_8c1f0a7e2b3d4c5e", "projectId": "default", "sessionId": null, "name": "bench capture 3",
  "sourceMode": "recorded", "format": "csi-npz", "sampleRateHz": 100.0, "durationS": 60.0, "consent": true,
  "consentNote": "single operator, written consent on file", "metadata": { "rig": "A" },
  "retentionUntil": "2026-10-28T20:10:00Z", "createdAt": "2026-10-14T20:10:00Z",
  "artifact": { "id": "art_…", "key": "projects/default/recordings/rec_8c1f0a7e2b3d4c5e/raw.csi-npz", "kind": "recording-raw",
                "sizeBytes": 1048576, "sha256": "…", "…": "…" } }
```

### `GET /api/recordings?projectId=default`

`{ "items": [Recording] }`.

### `DELETE /api/recordings/{id}`

Deletes the stored object, the recording row and its artifact row, and writes a
`recording.delete` audit event. **204**; **404** if unknown.

## WebSocket `/ws/sessions/{id}`

Connecting to a `created` synthetic session starts it. Connecting to a running session joins the
live stream at the engine's current state (frames produced while disconnected are not replayed).
Connecting to a stopped session yields one `status` message (`idle`) and a close with code 1000;
an unknown session closes with code 4404.

### Server → client envelopes (`StreamEnvelope`)

```json
{ "v": 1, "seq": 57, "sessionId": "ses_4706d66730e74e3a", "sentAtMs": 1792008405751.33, "type": "frame", "payload": { } }
```

`seq` is assigned per session when a message is created and strictly increases on every
connection; gaps mean messages were dropped by backpressure or addressed to another connection.
`sentAtMs` is the wall-clock time the message was written to this socket.

| type | payload |
| --- | --- |
| `status` | `{ "state": "streaming", "message": "" }`: sent on connect and on every state change |
| `frame` | `FramePayload`, below |
| `metrics` | `{ "seq": 41, "timestampS": 4.2, "values": { "processingMs": 60.1, "inputQuality": 0.99, "floorIou": 0.33, "positionErrorM": 0.21, "...": null } }` |
| `timing` | per connection: `{ "framesProduced": 120, "messagesSent": 240, "queueDepth": 0, "queueCapacity": 32, "dropped": 0, "superseded": 0, "ackedSeq": 236, "lastSeq": 241, "processingMs": 60.1, "stepMs": 251.0, "paused": false }` |
| `track-event` | `{ "kind": "track-confirmed", "timestampS": 4.2, "trackId": "T3", "severity": "info", "message": "track T3 confirmed at (2.41, 1.18) m" }` (also `track-death`) |
| `warning` | `{ "timestampS": 4.2, "message": "Input quality 0.42: delivery 60 %, SNR 8.1 dB." }` (when a new warning appears) |
| `error` | `{ "code": "invalid-command", "message": "invalid client command", "errors": [ { "loc": ["cmd"], "msg": "…" } ] }`; codes: `invalid-command`, `message-too-large`, `not-startable`, `engine-error` |
| `pong` | `{ "t": 123.5, "serverTimeMs": 1792008405751.29 }` |

`FramePayload`:

```json
{
  "seq": 41,
  "timestampS": 4.2,
  "grid": { "nx": 24, "ny": 20, "nz": 11, "voxelSizeM": 0.25, "origin": [0.0, 0.0, 0.0] },
  "occupancy":     { "dtype": "float32", "length": 5280, "data": "AAAAAAAAAAAAAAAA…" },
  "varianceRatio": { "dtype": "float32", "length": 5280, "data": "AACAPwAAgD8AAIA/…" },
  "tracks": [ { "id": "T3", "position": [2.41, 1.18, 1.0], "velocity": [0.92, 0.03, 0.0],
                "covariance": [0.031, 0.001, 0.029], "confirmed": true } ],
  "groundTruth": [ { "id": "s1", "position": [2.45, 1.2, 1.12] } ],
  "deltaRssDb":    { "dtype": "float32", "length": 28, "data": "…" },
  "processingMs": 60.1,
  "provenance": { "engine": "python-reference", "modelId": "rti-bayes", "configHash": "e14e5a95", "seed": 7 }
}
```

Float arrays are base64 of little-endian IEEE-754 float32 bytes; decoded byte length is
`4 × length`. Voxel order is x fastest, then y, then z. `deltaRssDb` has one value per link and
may contain NaN for links without packets in that frame. `groundTruth` is synthetic and present
only for synthetic sessions.

### Client → server commands (`ClientCommand`)

```json
{ "cmd": "ping", "t": 123.5 }
{ "cmd": "pause" }
{ "cmd": "resume" }
{ "cmd": "ack", "seq": 236 }
```

Every message is validated (unknown commands, missing or extra fields, non-JSON, > 4 KiB) and
answered with an `error` envelope on failure; the connection stays open. `pause`/`resume` act on
the session (all connected clients), `ack` records the highest acknowledged `seq` for this
connection (reported in `timing`).

### Backpressure

The engine runs in a worker thread; each connection has a bounded outbound queue
(`WS_QUEUE_MAXSIZE`). `put` never blocks the producer. When a queue is full, the oldest `frame`
or `metrics` message is dropped and counted (`timing.dropped`, session `framesDropped`).
Control messages (`status`, `pong`, `error`, `warning`, `track-event`, `timing`) are not dropped
that way; a newer `status` or `timing` replaces an unsent older one (`timing.superseded`), and a
hard cap of twice the queue size bounds memory if a client floods commands without reading.
