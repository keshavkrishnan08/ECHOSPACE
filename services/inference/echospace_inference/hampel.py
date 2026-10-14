"""Hampel identifier (port of dsp/hampel.ts)."""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
import numpy.typing as npt


def median(values: Sequence[float]) -> float:
    a = sorted(values)
    m = len(a) >> 1
    return a[m] if len(a) % 2 else (a[m - 1] + a[m]) / 2


def hampel(x: npt.ArrayLike, half_window: int, n_sigma: float) -> tuple[npt.NDArray[np.float64], int]:
    """Replaces samples further than `n_sigma` scaled MADs from the local median with that median.

    Windows are truncated at the series ends and ignore non-finite samples; a window with fewer
    than three finite samples leaves its centre untouched. Returns the filtered series and the
    number of replaced samples.
    """
    xs = [float(v) for v in np.asarray(x, dtype=np.float64)]
    n = len(xs)
    y = np.array(xs, dtype=np.float64)
    replaced = 0
    for i in range(n):
        lo = max(0, i - half_window)
        hi = min(n - 1, i + half_window)
        win = [v for v in xs[lo : hi + 1] if math.isfinite(v)]
        if len(win) < 3:
            continue
        med = median(win)
        mad = 1.4826 * median([abs(v - med) for v in win])
        if math.isfinite(xs[i]) and abs(xs[i] - med) > n_sigma * mad and mad > 0:
            y[i] = med
            replaced += 1
    return y, replaced
