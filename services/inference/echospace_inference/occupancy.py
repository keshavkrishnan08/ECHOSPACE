"""Occupancy post-processing (port of the ema / box filter / floor projection parts of recon/occupancy.ts).

Fields are float32 like the TypeScript ``Float32Array``s; arithmetic happens in float64 and is
rounded to float32 on store, as in JavaScript.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt
from scipy import ndimage

from echospace_sim.scene import VoxelGrid

Float32Array = npt.NDArray[np.float32]


def ema_in_place(state: Float32Array, x: npt.ArrayLike, a: float) -> None:
    """state = a·state + (1−a)·x. a ≤ 0 copies x (no smoothing)."""
    xa = np.asarray(x)
    if a <= 0:
        state[:] = xa
        return
    state[:] = a * state.astype(np.float64) + (1 - a) * xa.astype(np.float64)


def box_filter_3d(src: npt.ArrayLike, g: VoxelGrid) -> Float32Array:
    """3×3×3 box filter with edge renormalisation (mean over the in-grid neighbourhood)."""
    vol = np.asarray(src, dtype=np.float64).reshape(g.nz, g.ny, g.nx)
    ones = np.ones((3, 3, 3))
    total = ndimage.convolve(vol, ones, mode="constant", cval=0.0)
    count = ndimage.convolve(np.ones_like(vol), ones, mode="constant", cval=0.0)
    return (total / count).astype(np.float32).ravel()


def floor_projection(field: npt.ArrayLike, g: VoxelGrid) -> Float32Array:
    """Max-over-z floor projection (nx × ny, x fastest), floored at 0; NaN voxels are ignored."""
    vol = np.asarray(field, dtype=np.float32).reshape(g.nz, g.ny, g.nx)
    out = np.fmax.reduce(vol, axis=0)
    return np.fmax(out, np.float32(0)).ravel()
