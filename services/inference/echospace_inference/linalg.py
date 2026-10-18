"""Numerical helpers shared by the reconstruction models (counterpart of recon/linalg.ts)."""

from __future__ import annotations

import math

import numpy as np
import numpy.typing as npt
from scipy import linalg


def spd_inverse(a: npt.ArrayLike) -> npt.NDArray[np.float64]:
    """Inverse of a symmetric positive-definite matrix via Cholesky (raises LinAlgError otherwise)."""
    m = np.asarray(a, dtype=np.float64)
    factor = linalg.cho_factor(m, lower=True)
    return np.asarray(linalg.cho_solve(factor, np.eye(m.shape[0])))


def norm_cdf(x: npt.ArrayLike) -> npt.NDArray[np.float64]:
    """Standard normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation (|err| < 1.5e-7).

    Deliberately not ``scipy.special.ndtr``: the TypeScript engine reports occupancy through this
    approximation, and the reference must reproduce it to well below the approximation error.
    """
    xa = np.asarray(x, dtype=np.float64)
    z = np.abs(xa) / math.sqrt(2)
    t = 1 / (1 + 0.3275911 * z)
    poly = (((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592
    y = 1 - poly * t * np.exp(-z * z)
    return np.where(xa >= 0, 0.5 * (1 + y), 0.5 * (1 - y))
