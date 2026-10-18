# Model card: `rti-bayes`: Bayesian radio tomographic imaging

| field | value |
| --- | --- |
| family | classical (no training) |
| version | 1.0.0 |
| status | available |
| preprocessing | pp-1.0.0 |
| implementation | `packages/engine/src/recon/rti.ts`, `services/inference/echospace_inference/rti.py` (cross-checked by parity tests), native kernel in `engine/dsp` |

## Model

Following Wilson & Patwari (2010), the calibrated attenuation of link l is modelled as

    y_l = Σ_j W_lj x_j + n_l,   W_lj = 1/√d_l if voxel j lies in the ellipsoid d1 + d2 < d_l + λ_e

with an exponentially correlated Gaussian prior x ~ N(0, C), C_ij = σ_x² exp(−|v_i − v_j| / δ)
(truncated), and white noise n ~ N(0, σ_n² I). The posterior mean x̂ = C Wᵀ(W C Wᵀ + σ_n² I)⁻¹ y
is computed in the L × L dual form; the posterior variance ratio r_i = (C_ii − [Π W C]_ii) / σ_x²
measures how much the links constrain voxel i.

## Output and confidence semantics

- `image`: posterior-mean attenuation density.
- `varianceRatio`: 1 = unconstrained, 0 = fully determined.
- `occupancy` = Φ(z_i − z₀), with z_i = x̂_i / (σ_n ‖Π_i‖) the z-score of x̂_i under pure noise and
  z₀ = `recon.detectionZ`; 0.5 ("unknown") where r_i > 0.95. A detection confidence under the
  stated noise model, **not a calibrated probability**.

Parameters (σ_x, δ, σ_n, λ_e, z₀) are set by hand in the scenario configuration, not fitted.

## Evaluation (synthetic test scenes; not validated on real data)

Same 8 held-out scenes as `ridge-floor` (1,240 frames, scenario-B geometry), floor projection to
0.5 m cells of the engine output (after EMA and box filter), max over observed voxels:

| threshold | IoU | precision | recall |
| --- | --- | --- | --- |
| 0.5 | 0.246 | 0.259 | 0.833 |
| 0.6 (engine default) | 0.271 | 0.303 | 0.720 |
| 0.8 (chosen on validation) | 0.290 | 0.404 | 0.507 |

It produces no occupied cells in the 318 empty-room test frames. Its recall is high and its
precision low: the attenuation blob is wider than the body footprint target. Details and the
comparison with ridge-floor: `models/baselines/ridge_floor/metrics.json` and
`models/model_cards/ridge-floor.md`.

## Known limitations

- Senses shadowing only: subjects away from link lines, and seated or low subjects, produce little
  attenuation.
- With perimeter nodes at 1.0 m and 1.6 m the bottom and top voxel layers are unobserved; there is
  little real vertical resolution.
- Relies on the empty-room baseline; furniture changes or drift bias ΔRSS.
- Needs at least 3 usable links with crossing geometry; otherwise the engine reports
  `unsupported` instead of an image.

## Reference

J. Wilson and N. Patwari, "Radio Tomographic Imaging with Wireless Networks," IEEE Transactions
on Mobile Computing, vol. 9, no. 5, pp. 621-632, 2010.
