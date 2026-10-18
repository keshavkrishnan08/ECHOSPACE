# Model card: `transformer-encoder`: Transformer encoder (interface slot)

| field | value |
| --- | --- |
| family | transformer |
| version | - |
| status | **unavailable** |
| preprocessing | pp-1.0.0 (intended) |

## Status

This is an **interface slot, with no trained weights**. Selecting it makes both engines return
`modelStatus: "unsupported"` with zero occupancy and the message that the slot has no weights in
this build. Nothing is substituted for it.

## Why it might be justified

A transformer over (link, time) tokens could learn link-geometry-aware attention and handle a variable set of links, which in principle would allow transfer across rooms and node layouts, the main limitation of ridge-floor, which is tied to one geometry. That is the only reason to consider a model of this size here.

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
