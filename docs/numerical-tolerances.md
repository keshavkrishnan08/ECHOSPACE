# Numerical tolerances: TypeScript engine vs. Python reference

The Python reference (`services/simulator/echospace_sim`, `services/inference/echospace_inference`)
is checked against fixtures exported from the TypeScript engine by
`packages/engine/scripts/export-parity.ts` (`tests/fixtures/parity/*.json`). The checks live in
`services/inference/tests/test_parity.py`.

Fixtures: scenario B (default seed) and scenario F (default seed) with SNR 15 dB, 20 % packet loss,
burst dropouts, 15 % missing timestamps and one dead receive antenna. Both use `voxelSizeM` 0.5.
Each fixture covers the first 1.5 s (frames 1–15) after a 3 s empty-room calibration. Float32
arrays are stored as base64 of their bytes, so the reference values are exact.

| Quantity | Tolerance | Why |
| --- | --- | --- |
| Delivered packets per link, missing-timestamp packets | exact | Driven only by the xoshiro128** stream, which is bit-exact (integer arithmetic). |
| PRNG `next_u32` | exact | Pinned for seed 12345 in both test suites. |
| CSI `re`/`im` (float32) | rtol 1e-5, atol 1e-6 | The field is evaluated with a direct cos/sin per subcarrier instead of the TS rotation recurrence, and sums are vectorized. Double-precision differences are ~1e-13 relative; after rounding to float32 a sample occasionally differs by 1 ulp (≤ 1e-7 relative observed). |
| Timestamps | 1e-12 s | Same formula; `log`/`cos` in Box–Muller may differ by an ulp between V8 and libm. |
| Calibration baseline RSS, SNR estimate | 1e-6 dB | Sums of ~300 packets in a different order; observed ≤ 2e-10 dB. |
| Calibration motion energy | rtol 1e-6 | Ratio of sums; observed ≤ 1e-10. |
| Per-frame RSS and ΔRSS (float32) | 1e-4 dB | Observed: bit-identical. Hampel decisions and float32 rounding absorb the ~1e-11 dB upstream differences. |
| Motion energy (float32) | rtol 1e-4 | Observed: bit-identical. |
| RTI posterior-mean image (float32) | 1e-4 × max \|image\| | Prior covariance product is a `scipy.ndimage.convolve` rather than a scatter-add and the L×L inverse uses LAPACK Cholesky; observed ≤ 2e-10 relative. |
| Variance ratio, occupancy (float32) | 1e-4 absolute | Observed: bit-identical. Occupancy is Φ(z − z₀) with z ≈ O(10), so it is the quantity most sensitive to image error; Φ is the same Abramowitz–Stegun approximation as `linalg.ts` (not `scipy.special.ndtr`, which differs by up to 1.5e-7). |

Hard decisions are reproduced exactly rather than within a tolerance: ellipse support of each link
and the kernel truncation radius use V8's `Math.hypot` algorithm (`js_hypot`), and every
`Math.round` is reproduced with JavaScript half-up rounding (`js_round`). A mismatch there would
change which voxels a link constrains and show up as a large image error, not a small one.

Not compared: point clouds (sampled with a separate RNG stream; not ported), track identities (the
TS tracker seeds IDs from `Date.now()`), back-projection and the ridge model (not ported), and
stage timings.

Regenerate fixtures after an intentional engine change:

```sh
cd packages/engine && npx tsx scripts/export-parity.ts
```
