"""Bayesian radio tomographic imaging (RTI) baseline (port of recon/rti.ts).

Measurement model (Wilson & Patwari, 2010):  y = W x + n,
  y_l  calibrated attenuation of link l (dB), x  per-voxel attenuation density,
  W_lj = 1/√d_l if voxel j lies inside the ellipsoid d1 + d2 < d_l + λ_e, else 0.
Prior x ~ N(0, C), C_ij = σ_x² exp(−|v_i − v_j| / δ) truncated at |v_i − v_j| > c·δ;
noise n ~ N(0, σ_n² I).

Posterior mean  x̂ = Π y,  Π = C Wᵀ (W C Wᵀ + σ_n² I)⁻¹  (computed in the L×L dual form)
Posterior variance ratio  r_i = (C_ii − [Π W C]_ii) / σ_x²   (1 = unconstrained / unobserved)
Null z-score  z_i = x̂_i / (σ_n ‖Π_i‖)   — the std-dev of x̂_i when y is pure noise.

Reported occupancy = Φ(z_i − z₀) for constrained voxels and 0.5 ("unknown") where r_i > 0.95.
That is a detection confidence under the stated noise model, not a calibrated probability.

C Wᵀ is evaluated as a 3-D convolution of each link's weight volume with the truncated kernel
(``scipy.ndimage.convolve``, zero boundary), which equals the TypeScript scatter-add over integer
voxel offsets up to summation order. Support membership and kernel truncation use the V8
``Math.hypot`` algorithm so those hard decisions are bit-identical.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy import ndimage

from echospace_sim.config import ReconConfig
from echospace_sim.geometry import js_hypot
from echospace_sim.scene import LinkDescriptor, VoxelGrid, grid_spacing

from .linalg import norm_cdf, spd_inverse

FloatArray = npt.NDArray[np.float64]
Float32Array = npt.NDArray[np.float32]


def js_hypot3(dx: FloatArray, dy: FloatArray, dz: FloatArray) -> FloatArray:
    """Vectorized :func:`echospace_sim.geometry.js_hypot` for three finite components."""
    comps = [np.abs(dx), np.abs(dy), np.abs(dz)]
    mx = np.maximum(np.maximum(comps[0], comps[1]), comps[2])
    safe = np.where(mx == 0, 1.0, mx)
    total = np.zeros_like(mx)
    comp = np.zeros_like(mx)
    for c in comps:
        n = c / safe
        summand = n * n - comp
        prelim = total + summand
        comp = (prelim - total) - summand
        total = prelim
    return np.where(mx == 0, 0.0, np.sqrt(total) * mx)


@dataclass(frozen=True)
class _Operator:
    pi: FloatArray
    """Π restricted to the active links, shape (V, n)."""
    var_ratio: Float32Array
    null_std: FloatArray


@dataclass
class RtiResult:
    image: Float32Array
    z_score: Float32Array
    variance_ratio: Float32Array
    occupancy: Float32Array
    active_links: int


class RtiModel:
    def __init__(self, grid: VoxelGrid, links: list[LinkDescriptor], cfg: ReconConfig) -> None:
        self.grid = grid
        self.links = links
        self.cfg = cfg
        self.L = len(links)
        self.V = grid.count
        self.prior_var = cfg.prior_std * cfg.prior_std
        c = grid.centers
        W = np.zeros((self.L, self.V))
        for li, link in enumerate(links):
            inv = 1 / math.sqrt(max(link.length_m, 1e-3))
            tx = np.asarray(link.tx)
            rx = np.asarray(link.rx)
            d1 = js_hypot3(c[:, 0] - tx[0], c[:, 1] - tx[1], c[:, 2] - tx[2])
            d2 = js_hypot3(c[:, 0] - rx[0], c[:, 1] - rx[1], c[:, 2] - rx[2])
            W[li, d1 + d2 < link.length_m + cfg.ellipse_excess_m] = inv
        self.weights = W
        """Dense L×V weight matrix."""
        self.kernel = self._kernel()
        nx, ny, nz = grid.nx, grid.ny, grid.nz
        cw_t = np.empty((self.V, self.L))
        for li in range(self.L):
            vol = W[li].reshape(nz, ny, nx)
            cw_t[:, li] = ndimage.convolve(vol, self.kernel, mode="constant", cval=0.0).ravel()
        self._cw_t = cw_t
        """C Wᵀ, shape (V, L)."""
        self._cache: dict[tuple[int, ...], _Operator] = {}

    def _kernel(self) -> FloatArray:
        """Truncated exponential prior covariance on integer voxel offsets, indexed [dk, dj, di]."""
        sx, sy, sz = grid_spacing(self.grid)
        R = self.cfg.kernel_cutoff * self.cfg.prior_correlation_m
        ri = math.floor(R / sx)
        rj = math.floor(R / sy)
        rk = math.floor(R / sz)
        k = np.zeros((2 * rk + 1, 2 * rj + 1, 2 * ri + 1))
        for dk in range(-rk, rk + 1):
            for dj in range(-rj, rj + 1):
                for di in range(-ri, ri + 1):
                    d = js_hypot(di * sx, dj * sy, dk * sz)
                    if d <= R + 1e-9:
                        k[dk + rk, dj + rj, di + ri] = self.prior_var * math.exp(-d / self.cfg.prior_correlation_m)
        return k

    def support(self, link: int) -> npt.NDArray[np.intp]:
        return np.flatnonzero(self.weights[link])

    def _operator(self, active: tuple[int, ...]) -> _Operator:
        hit = self._cache.get(active)
        if hit is not None:
            return hit
        idx = list(active)
        cw = self._cw_t[:, idx]
        A = self.weights[idx] @ cw
        A = 0.5 * (A + A.T)
        A[np.diag_indices_from(A)] += self.cfg.noise_std_db * self.cfg.noise_std_db
        pi = cw @ spd_inverse(A)
        reduction = np.sum(pi * cw, axis=1)
        var_ratio = np.clip((self.prior_var - reduction) / self.prior_var, 0, 1).astype(np.float32)
        null_std = self.cfg.noise_std_db * np.sqrt(np.sum(pi * pi, axis=1))
        op = _Operator(pi, var_ratio, null_std)
        if len(self._cache) > 32:
            self._cache.clear()
        self._cache[active] = op
        return op

    def reconstruct(self, y: npt.ArrayLike) -> RtiResult:
        """Posterior image, null z-score, variance ratio and occupancy for per-link attenuations
        `y` (dB); non-finite entries mark links without data this frame."""
        ya = np.asarray(y, dtype=np.float64)
        active = tuple(int(i) for i in np.flatnonzero(np.isfinite(ya)))
        if not active:
            return RtiResult(
                image=np.zeros(self.V, dtype=np.float32),
                z_score=np.zeros(self.V, dtype=np.float32),
                variance_ratio=np.ones(self.V, dtype=np.float32),
                occupancy=np.full(self.V, 0.5, dtype=np.float32),
                active_links=0,
            )
        op = self._operator(active)
        s = op.pi @ ya[list(active)]
        with np.errstate(divide="ignore", invalid="ignore"):
            z = np.where(op.null_std > 1e-12, s / op.null_std, 0.0)
        occupancy = np.where(op.var_ratio.astype(np.float64) > 0.95, 0.5, norm_cdf(z - self.cfg.detection_z))
        return RtiResult(
            image=s.astype(np.float32),
            z_score=z.astype(np.float32),
            variance_ratio=op.var_ratio,
            occupancy=occupancy.astype(np.float32),
            active_links=len(active),
        )

    def coverage(self) -> Float32Array:
        """Posterior variance ratio with every link active (1 = unobserved)."""
        return self._operator(tuple(range(self.L))).var_ratio
