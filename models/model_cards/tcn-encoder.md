# Model card: `tcn-encoder` — Temporal convolutional encoder (interface slot)

| field | value |
| --- | --- |
| family | tcn |
| version | — |
| status | **unavailable** |
| preprocessing | pp-1.0.0 (intended) |

## Status

This is an **interface slot, with no trained weights**. Selecting it makes both engines return
`modelStatus: "unsupported"` with zero occupancy and the message that the slot has no weights in
this build. Nothing is substituted for it.

## Why it might be justified

A temporal convolutional network over a window of per-link features (or per-subcarrier CSI amplitude/phase) could exploit temporal structure that frame-wise ridge regression and per-frame RTI ignore: gait periodicity, the onset/offset pattern of a link being crossed, and the correlation of shadowing across neighbouring links over time. It is the natural next step in capacity above a linear model and is cheap enough to run in the browser worker.

## What data would be needed

- Recorded CSI from real deployments (not only the synthetic simulator, whose channel model is
  simplified and uncalibrated), with synchronized ground truth: subject floor positions at
  ≥ 10 Hz from a motion-capture or calibrated camera system, subject count, posture labels.
- Many rooms and node layouts, with splits by recording session and by room so that the test
  set contains rooms the model has never seen; leaving whole rooms out is the only meaningful
  test of the geometry transfer that would justify the extra capacity.
- Consent records for every captured person (`consent: "obtained"` in the dataset manifest)
  and documented retention.
- Empty-room and static-occupant segments, interference and packet-loss conditions, so that
  failure modes are represented.

Synthetic data from `echospace_sim` can be used for pre-training and for testing the plumbing,
but results on it are not evidence of real-world performance.

## Enabling criteria

The slot may only be switched to `experimental` or `available` when it ships weights, a model
card with evaluation on held-out scenes, and it **beats both the ridge-floor and the rti-bayes
baselines** on the same splits and metrics (floor IoU, precision, recall at the documented
operating point; tracking metrics where applicable), with the comparison recorded in
`models/registry.json`.
