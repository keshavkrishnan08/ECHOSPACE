# Dataset manifests

One JSON file per dataset version, validated against zod `DatasetManifest`
(`packages/schemas/src/dataset.ts`) and served by `GET /api/datasets`. Manifests describe data;
they do not contain it. Arrays are either regenerated deterministically (synthetic sets) or live
in the object store (recordings uploaded through `POST /api/recordings`).

Required content:

- `source`: `synthetic`, `recorded-csi`, `recorded-iq` or `public`;
- `license` and `usageRestrictions`;
- `captureMethodology`: how the data was produced, precisely enough to reproduce it;
- `splits`: identifiers of the units that form each split. Splits are by scene or recording,
  never by frame, so adjacent frames cannot leak between train and test;
- `validation`: `status`, `checkedAt` and any `issues` found by the producing script;
- `consent`: `not-applicable` for synthetic data, otherwise `obtained` (with the consent record
  kept alongside the recording) or `unknown` (not usable for training);
- `checksum` of the canonical arrays where applicable.

## Files

| manifest | content |
| --- | --- |
| `synthetic-ridge-v1.json` | 48 synthetic scenes in the scenario-B geometry used to train and evaluate `ridge-floor`. Regenerate with `python models/baselines/ridge_floor/train.py --out var/datasets/synthetic-ridge-v1.npz` (the `var/` directory is git-ignored). Split values are scene seeds. |
