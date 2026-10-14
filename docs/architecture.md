# Architecture

## One engine, every surface

The TypeScript engine (`packages/engine`) is the single source of frames. It runs in a dedicated
Web Worker and drives every page: the 3D Lab, the Arena, the Signal Studio and the Workbench all
read the same session, configuration and frame history.

```
SyntheticSource / RecordedSource / PushSource
        │ packets (complex CSI, link × antenna × subcarrier)
        ▼
 bounded acquisition queue  (drop-oldest | drop-newest, counted)
        ▼
 Pipeline: validate → align → buffer → estimate* → preprocess → filter → features
           → spatial → inference → reconstruct → associate → serialize
        ▼
 ReconstructionFrame (typed arrays, transferred)  ──►  UI (ack-based backpressure)
```

`*` channel estimation is not applicable to CSI sources and is marked as such.

## Backpressure

Nothing grows without bound. The acquisition queue has a fixed capacity per link; if frame
processing lags by more than 1.5 s the engine skips frame slots and counts them; the worker keeps
at most `maxInFlightFrames` unacknowledged messages and drops frames for display beyond that.
All three counters are visible in the Lab pipeline strip and System Diagnostics.

## Determinism and replay

All randomness comes from seeded xoshiro128** streams derived per purpose and per link.
Mid-run configuration changes apply at frame boundaries and resume the source right after the
last processed frame, so a run is described exactly by its launch configuration and the frame
index of each change. Saving an experiment computes a SHA-256 digest over the first 40 frames
from an unpaced run of that description; replay recomputes it. Whether the live run itself
matched (it may not, if backpressure dropped data under load) is recorded separately.

## Reconstruction

`rti-bayes` solves the radio tomographic imaging posterior in the dual (links × links) form. The
per-voxel posterior variance ratio is 1 where no link constrains a voxel; those voxels are
reported as unobserved, not empty. Occupancy is reported as Φ(z − z₀) where z is the null
hypothesis z-score of the posterior mean, a detection confidence rather than a calibrated
probability. `bp-dsb` is a coherent delay-and-sum back projection. `ridge-floor` is a shallow
learned model bound to one training geometry.

## Optional services

The FastAPI service (`services/api`) stores experiments, recordings (with consent) and artifacts
(PostgreSQL or SQLite plus S3/MinIO or local disk), serves the model registry and dataset
manifests, and can stream frames from the Python reference engine over WebSocket with its own
bounded queue. The browser keeps working when it is offline.

## Cross-checks

- Python reference engine: parity fixtures exported from TS match bit for bit in float32.
- C++ DSP library: every kernel is tested against NumPy/SciPy with documented tolerances.
