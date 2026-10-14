# Model interface contract

Every reconstruction model in ECHOSPACE, classical or learned, is described by a model card in
`models/registry.json` (zod `ModelCard`, `packages/schemas/src/model.ts`) and is selected by
`recon.modelId` in the scenario configuration. The engines (`packages/engine` in the browser
worker, `echospace_inference` in Python) call models through the same contract.

## Input

Models consume the output of the shared preprocessing chain, versioned as
`preprocessingVersion` (currently `pp-1.0.0`):

1. validation of packets (finite samples, expected shape), timestamp alignment;
2. linear phase sanitization (CFO/STO removal, antenna 0 reference);
3. Hampel filter + exponential low-pass on per-link RSS;
4. per-frame link features, one value per link `l = 0..L-1` in `buildLinks` order:
   - `rssDb[l]` mean received power (dB, normalized units);
   - `deltaRssDb[l]` = calibrated baseline RSS − current RSS (dB, positive = more loss);
   - `motionEnergy[l]` = mean normalized consecutive-packet CSI difference, divided by its
     empty-room calibration value (unitless, ≈1 when static);
   - `deliveryRatio[l]`, `snrEstDb[l]`;
5. the empty-room background (mean sanitized CSI per link) for coherent models.

A link with no packets in a frame has `NaN` features. Each model card's `inputSchema` states which
of these it reads. Changing any of steps 1–4 changes the feature distribution and requires a new
`preprocessingVersion`; learned weights record the version they were trained with and must be
retrained (or at least re-evaluated) when it changes.

## Output

- `occupancy` per voxel (x-fastest, grid from `recon.voxelSizeM`), in [0, 1];
- `varianceRatio` per voxel (1 = unconstrained by any link; 0 = fully determined);
- `image` per voxel in model-specific units (documented per card);
- `modelStatus` `ok | degraded | unsupported` and a human-readable `modelMessage`.

The engine then applies the same post-processing to every model (EMA temporal smoothing,
optional 3×3×3 box filter, point sampling, detection and tracking).

## Confidence semantics

`occupancy` is **not** a calibrated probability for any current model. Each card's
`confidenceSemantics` says exactly what it is:

- `rti-bayes`: Φ(z − z₀) of the null-hypothesis z-score of the posterior-mean attenuation, 0.5
  for unobserved voxels (variance ratio > 0.95);
- `bp-dsb`: a fixed logistic mapping of coherent energy relative to the calibration noise level;
- `ridge-floor`: a clipped linear score whose 0.5 level is the validation-chosen operating point.

Thresholds (`recon.occupancyThreshold`, `tracking.detectionThreshold`) therefore act on scores,
and metrics such as floor IoU depend on the threshold used; reports must state it.

## Failure behaviour

A model must return `unsupported` (and zero occupancy) instead of producing output outside its
domain: unknown sensor geometry, fewer than 3 usable links for attenuation imaging, a learned
model whose `geometryKey` does not match the scene, or a registered slot without weights. When the
input is in-domain but degraded (missing links, distribution shift detected), it returns
`degraded` and explains why.

## Learned models and versioning

Weights files carry the model id and version, the geometry they were trained for
(`geometryKey`, computed exactly like `geometryKey(room, sensors)` in
`packages/engine/src/recon/ridge.ts`), the feature names and normalization statistics, and an
out-of-distribution limit. The training script, its metrics and the dataset manifest live next to
them:

| file | content |
| --- | --- |
| `models/baselines/<model>/train.py` | reproducible training (fixed seeds, scene-level splits) |
| `models/baselines/<model>/weights.json` | exported weights, loaded by both engines |
| `models/baselines/<model>/metrics.json` | validation curve, test metrics, runtime, machine |
| `models/model_cards/<model>.md` | human-readable card |
| `datasets/manifests/<dataset>.json` | the training data, its splits and validation status |
| `models/evaluation/evaluate.py` | re-runs the test evaluation from the saved weights |

`node scripts/sync-models.mjs` copies the registry and weights into `apps/web/public/models`.

A new learned model (for example the `tcn-encoder` / `transformer-encoder` slots) is enabled only
when it ships weights, a card with evaluation on held-out scenes, and beats the `ridge-floor` and
`rti-bayes` baselines on the same splits.
