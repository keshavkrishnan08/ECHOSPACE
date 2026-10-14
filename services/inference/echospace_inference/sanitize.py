"""Linear phase sanitization, a widely used CSI preprocessing step (port of dsp/sanitize.ts).

Carrier-frequency offset adds a phase common to all subcarriers; sampling-time offset adds a phase
linear in subcarrier frequency. Both are shared by all receive antennas of a packet. Antenna 0's
phase is unwrapped over subcarriers, φ(f) = a·f + b is fitted by least squares and the same line
is removed from every antenna, which preserves inter-antenna phase differences.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

FloatArray = npt.NDArray[np.float64]


def unwrap(phase: npt.ArrayLike) -> FloatArray:
    """Unwraps along the last axis exactly like the TypeScript loop.

    Differs from ``numpy.unwrap`` only in rounding: the correction is 2π·round(d/2π) with
    JavaScript rounding, accumulated left to right, and NaN steps leave the offset unchanged.
    """
    p = np.asarray(phase, dtype=np.float64)
    if p.shape[-1] == 0:
        return p.copy()
    d = np.diff(p, axis=-1)
    two_pi = 2 * math.pi
    step = np.zeros_like(d)
    up = d > math.pi
    down = d < -math.pi
    step[up] = -(two_pi * np.floor(d[up] / two_pi + 0.5))
    step[down] = two_pi * np.floor(-d[down] / two_pi + 0.5)
    offset = np.concatenate([np.zeros((*p.shape[:-1], 1)), np.cumsum(step, axis=-1)], axis=-1)
    return p + offset


def linear_fit(x: npt.ArrayLike, y: npt.ArrayLike) -> tuple[float, float]:
    """Least-squares line y ≈ slope·x + intercept; slope is 0 for a degenerate x."""
    xa = np.asarray(x, dtype=np.float64)
    ya = np.asarray(y, dtype=np.float64)
    mx = float(np.sum(xa)) / xa.size
    my = float(np.sum(ya)) / ya.size
    sxx = float(np.sum((xa - mx) * (xa - mx)))
    sxy = float(np.sum((xa - mx) * (ya - my)))
    slope = sxy / sxx if sxx > 0 else 0.0
    return slope, my - slope * mx


@dataclass
class SanitizedPacket:
    re: FloatArray
    im: FloatArray
    phase_raw: FloatArray
    """Raw wrapped phase, flattened [m*K+k]."""
    phase_san: FloatArray
    """Sanitized phase (unwrapped, detrended), flattened [m*K+k]."""
    mag: FloatArray
    slope: float
    intercept: float


def sanitize_packet(
    re: npt.ArrayLike, im: npt.ArrayLike, M: int, K: int, x: npt.ArrayLike, enabled: bool
) -> SanitizedPacket:
    """Sanitizes one packet. The reference antenna is the first with finite data at subcarrier 0;
    antennas with non-finite samples pass through as NaN."""
    r = np.asarray(re, dtype=np.float64).reshape(M, K)
    i = np.asarray(im, dtype=np.float64).reshape(M, K)
    xa = np.asarray(x, dtype=np.float64)
    phase_raw = np.arctan2(i, r)
    mag = np.hypot(r, i)
    finite = np.isfinite(r[:, 0]) & np.isfinite(i[:, 0])
    ref = int(np.argmax(finite)) if finite.any() else -1
    slope = 0.0
    intercept = 0.0
    if enabled and ref >= 0:
        slope, intercept = linear_fit(xa, unwrap(phase_raw[ref]))
    corr = slope * xa + intercept
    c = np.cos(-corr)
    s = np.sin(-corr)
    return SanitizedPacket(
        re=(r * c - i * s).ravel(),
        im=(r * s + i * c).ravel(),
        phase_raw=phase_raw.ravel(),
        phase_san=(unwrap(phase_raw) - corr).ravel(),
        mag=mag.ravel(),
        slope=slope,
        intercept=intercept,
    )
