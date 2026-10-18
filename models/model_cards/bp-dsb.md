# Model card: `bp-dsb`: coherent delay-and-sum back-projection

| field | value |
| --- | --- |
| family | classical (no training) |
| version | 1.0.0 |
| status | experimental |
| preprocessing | pp-1.0.0 |
| implementation | `packages/engine/src/recon/backprojection.ts` (browser engine); native kernel in `engine/dsp/src/recon.cpp` |
| inference device | CPU (browser worker); optional native C++ library |

## What it does

For every link, the dynamic channel `D = H − B` (sanitized CSI minus the empty-room background
captured during calibration) is matched against the single-bounce hypothesis for every voxel:

    I(v) = Σ_l | Σ_m Σ_k D_lmk · exp(+j 2π f_k (|tx − v| + |v − rx_m| − L_l0) / c) |² / N_l

`L_l0` is the line-of-sight length to antenna 0 (the reference removed by phase sanitization) and
`N_l` normalises by the image energy of the link during calibration. The image is the mean of
these per-link ratios over active links.

## Output and confidence semantics

`image` is the mean per-link coherent energy relative to the calibration noise level
(dimensionless). `occupancy = 1 / (1 + exp(−(image − 6) / 1.5))`: a **fixed, uncalibrated
heuristic mapping**. The constants were chosen by inspection, not fitted, and the value must not be
read as a probability. `varianceRatio` reports rti-bayes link coverage, not an uncertainty of this
model.

## Training

None. There are no learned parameters.

## Evaluation

No quantitative evaluation is published. The model has not been compared against rti-bayes or
ridge-floor on held-out scenes, which is why it is marked experimental.

## Known limitations

- 40 MHz of bandwidth gives ~7.5 m range resolution; localization comes almost entirely from the
  angular diversity of the few receive antennas and from link geometry, so images are broad and
  contain grating lobes.
- Multipath that is not single-bounce through the voxel produces ghost energy by construction.
- Requires receive-antenna positions and unmodified phase across antennas; residual phase
  instability (scenario impairments) degrades it quickly.
- Static subjects disappear once the background is subtracted only at calibration; a slowly
  changing environment accumulates false energy.
- Only implemented in the TypeScript engine; the Python reference pipeline reports it as
  unsupported.
