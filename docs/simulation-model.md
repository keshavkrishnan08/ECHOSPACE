# Simulation model

The simulator produces per-packet CSI `H_m(f_k)` for every link, receive antenna `m` and
subcarrier `k`:

H_m(f_k) = Σ_p g_p(t) · a_{p,m} · exp(−j2π f_k L_{p,m} / c) + impairments + noise

## Paths

- **Line of sight** with amplitude 1/L (normalised: 1.0 at 1 m).
- **First-order reflections** from up to six room surfaces by the image method, with a single
  reflectivity per material; doors in a wall do not reflect, windows reflect as glass.
- **Body scatter** from six points per subject (torso, head, knees, wrists) following the
  synthetic skeleton, amplitude √(σ·share/4π)/(d1·d2).
- **Obstacles** apply a single penetration loss per material when a segment crosses them.
- **Body shadowing** attenuates any path segment near a subject's body axis by
  S·exp(−d²/2r²) with r² = r_body² + r_Fresnel².

## Impairments

Per packet: Bernoulli loss and burst dropouts, timestamp jitter and missing timestamps, random
carrier-frequency phase, sampling-time-offset phase slope, AGC gain error, per-antenna phase
instability, complex Gaussian noise at the configured SNR, and dead antennas (NaN).

## Units

Amplitudes and powers are normalised and uncalibrated. RSS is in dB relative to unit power,
never dBm.

## What it omits

Higher-order reflections, diffraction, frequency-dependent material properties, antenna
patterns, polarisation, hardware nonlinearity, interference from other transmitters, and any
exterior propagation. The `PacketSource` interface is where an electromagnetic solver or real
captures plug in instead.
