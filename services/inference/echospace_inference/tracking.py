"""Detection and multi-target tracking (port of tracking/{detect,tracker,hungarian}.ts).

Assignment uses ``scipy.optimize.linear_sum_assignment`` in place of the hand-written
Kuhn–Munkres solver. Both return a minimum-cost assignment; they can differ only when several
assignments have exactly equal cost.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import numpy.typing as npt
from scipy.optimize import linear_sum_assignment

from echospace_sim.config import TrackingConfig
from echospace_sim.geometry import Vec3, js_hypot, js_round
from echospace_sim.rng import Rng
from echospace_sim.scene import VoxelGrid, grid_spacing


def hungarian(cost: Sequence[Sequence[float]], max_cost: float = math.inf) -> list[int]:
    """Minimum-cost assignment on a rectangular cost matrix: result[row] = column or −1.

    The assignment is solved over all pairs first; pairs with cost ≥ `max_cost` are then left
    unassigned (the same gating order as the TypeScript solver).
    """
    rows = len(cost)
    cols = len(cost[0]) if rows else 0
    out = [-1] * rows
    if not rows or not cols:
        return out
    c = np.minimum(np.asarray(cost, dtype=np.float64), 1e9)
    for r, k in zip(*linear_sum_assignment(c), strict=True):
        if cost[r][k] < max_cost:
            out[int(r)] = int(k)
    return out


@dataclass
class Detection:
    position: Vec3
    score: float


def detect(
    field_: npt.ArrayLike, g: VoxelGrid, threshold: float, max_detections: int, nms_radius: float = 0.7
) -> list[Detection]:
    """Detections from an occupancy field.

    Local maxima of the max-over-z floor projection above `threshold`, refined by a value-weighted
    centroid over a 0.5 m neighbourhood, with greedy non-maximum suppression at `nms_radius`.
    Height is the value-weighted mean z of the column.
    """
    nx, ny, nz = g.nx, g.ny, g.nz
    dx, dy, _ = grid_spacing(g)
    vol = np.asarray(field_, dtype=np.float32).reshape(nz, ny, nx)
    floor = np.fmax(np.fmax.reduce(vol, axis=0), np.float32(0)).astype(np.float64)
    centers = g.centers
    cands: list[tuple[int, int, float]] = []
    for j in range(ny):
        for i in range(nx):
            v = floor[j, i]
            if v < threshold:
                continue
            is_max = True
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    if not di and not dj:
                        continue
                    ii = i + di
                    jj = j + dj
                    if ii < 0 or jj < 0 or ii >= nx or jj >= ny:
                        continue
                    w = floor[jj, ii]
                    if w > v or (w == v and (dj < 0 or (dj == 0 and di < 0))):
                        is_max = False
                        break
                if not is_max:
                    break
            if is_max:
                cands.append((i, j, float(v)))
    cands.sort(key=lambda c: -c[2])
    out: list[Detection] = []
    ri = max(1, js_round(0.5 / dx))
    rj = max(1, js_round(0.5 / dy))
    for ci, cj, cv in cands:
        sw = sx = sy = 0.0
        for dj in range(-rj, rj + 1):
            for di in range(-ri, ri + 1):
                ii = ci + di
                jj = cj + dj
                if ii < 0 or jj < 0 or ii >= nx or jj >= ny:
                    continue
                w = max(0.0, floor[jj, ii] - threshold * 0.5)
                cid = ii + nx * jj
                sw += w
                sx += w * centers[cid, 0]
                sy += w * centers[cid, 1]
        base = ci + nx * cj
        x = sx / sw if sw > 0 else float(centers[base, 0])
        y = sy / sw if sw > 0 else float(centers[base, 1])
        if any(js_hypot(d.position[0] - x, d.position[1] - y) < nms_radius for d in out):
            continue
        zw = zs = 0.0
        for k in range(nz):
            w = float(vol[k, cj, ci])
            zw += w
            zs += w * centers[ci + nx * (cj + ny * k), 2]
        out.append(Detection((x, y, zs / zw if zw > 0 else 1.0), cv))
        if len(out) >= max_detections:
            break
    return out


@dataclass
class Track:
    id: str
    position: Vec3
    velocity: Vec3
    covariance: tuple[float, float, float]
    """2×2 position covariance in the floor plane [xx, xy, yy], m²."""
    age_frames: int
    hits: int
    misses: int
    confirmed: bool
    confidence: float
    trail: list[tuple[float, float, float]]


@dataclass
class TrackEvent:
    kind: Literal["track-birth", "track-confirmed", "track-death"]
    timestamp_s: float
    message: str
    track_id: str
    severity: Literal["info", "warning", "error"] = "info"


@dataclass
class _InternalTrack:
    id: str
    x: npt.NDArray[np.float64]
    """State [x, y, vx, vy]."""
    P: npt.NDArray[np.float64]
    """4×4 state covariance."""
    z: float
    age: int = 0
    hits: int = 1
    misses: int = 0
    confirmed: bool = False
    last_score: float = 0.0
    trail: list[tuple[float, float, float]] = field(default_factory=list)


class Tracker:
    """Multi-target tracker over floor-plane detections.

    - ``kalman``: constant-velocity Kalman filter (state x, y, vx, vy; white-acceleration noise q)
    - ``ema``: exponential smoothing of position, velocity from smoothed differences
    - ``none``: track position equals the associated detection

    Association is a gated minimum-cost assignment on the Euclidean distance between predicted
    track position and detections. A track is confirmed after `birth_hits` hits and deleted after
    `max_misses` consecutive misses (tentative tracks after 2). Identities are ephemeral random
    labels; nothing forces a track to keep a subject's identity through ambiguity.
    """

    def __init__(self, cfg: TrackingConfig, seed: int, trail_frames: int) -> None:
        self.cfg = cfg
        self.trail_frames = trail_frames
        self._rng = Rng(seed)
        self._tracks: list[_InternalTrack] = []

    def configure(self, cfg: TrackingConfig, trail_frames: int) -> None:
        self.cfg = cfg
        self.trail_frames = trail_frames

    def reset(self) -> None:
        self._tracks = []

    def _new_id(self) -> str:
        return f"T-{self._rng.next_u32():08x}"[:6].upper()

    def step(self, dets: list[Detection], dt: float, t: float) -> tuple[list[Track], list[TrackEvent]]:
        events: list[TrackEvent] = []
        cfg = self.cfg
        q = cfg.process_noise
        r2 = cfg.measurement_std_m * cfg.measurement_std_m
        for tr in self._tracks:
            tr.age += 1
            if cfg.filter == "kalman":
                tr.x[0] += tr.x[2] * dt
                tr.x[1] += tr.x[3] * dt
                for p, v in ((0, 2), (1, 3)):
                    Ppp, Ppv, Pvv = tr.P[p, p], tr.P[p, v], tr.P[v, v]
                    tr.P[p, p] = Ppp + 2 * dt * Ppv + dt * dt * Pvv + (q * dt * dt * dt) / 3
                    tr.P[p, v] = tr.P[v, p] = Ppv + dt * Pvv + (q * dt * dt) / 2
                    tr.P[v, v] = Pvv + q * dt
            elif cfg.filter == "ema":
                tr.x[0] += tr.x[2] * dt * (1 - cfg.ema_alpha)
                tr.x[1] += tr.x[3] * dt * (1 - cfg.ema_alpha)

        cost = [[js_hypot(d.position[0] - tr.x[0], d.position[1] - tr.x[1]) for d in dets] for tr in self._tracks]
        assign = hungarian(cost, cfg.gate_m)
        used: set[int] = set()
        for tr, di in zip(self._tracks, assign, strict=True):
            if di < 0:
                tr.misses += 1
                continue
            used.add(di)
            d = dets[di]
            tr.misses = 0
            tr.hits += 1
            tr.last_score = d.score
            tr.z = 0.7 * tr.z + 0.3 * d.position[2]
            if cfg.filter == "kalman":
                for p, v, zi in ((0, 2, 0), (1, 3, 1)):
                    Ppp, Ppv, Pvv = tr.P[p, p], tr.P[p, v], tr.P[v, v]
                    S = Ppp + r2
                    kp = Ppp / S
                    kv = Ppv / S
                    innov = d.position[zi] - tr.x[p]
                    tr.x[p] += kp * innov
                    tr.x[v] += kv * innov
                    tr.P[p, p] = (1 - kp) * Ppp
                    tr.P[p, v] = tr.P[v, p] = (1 - kp) * Ppv
                    tr.P[v, v] = Pvv - kv * Ppv
            elif cfg.filter == "ema":
                a = cfg.ema_alpha
                nx = a * d.position[0] + (1 - a) * tr.x[0]
                ny = a * d.position[1] + (1 - a) * tr.x[1]
                tr.x[2] = a * ((nx - tr.x[0]) / dt) + (1 - a) * tr.x[2]
                tr.x[3] = a * ((ny - tr.x[1]) / dt) + (1 - a) * tr.x[3]
                tr.x[0] = nx
                tr.x[1] = ny
            else:
                tr.x[2] = (d.position[0] - tr.x[0]) / dt
                tr.x[3] = (d.position[1] - tr.x[1]) / dt
                tr.x[0] = d.position[0]
                tr.x[1] = d.position[1]
            if not tr.confirmed and tr.hits >= cfg.birth_hits:
                tr.confirmed = True
                events.append(TrackEvent("track-confirmed", t, f"{tr.id} confirmed after {tr.hits} hits", tr.id))

        for di, d in enumerate(dets):
            if di in used:
                continue
            P = np.zeros((4, 4))
            P[0, 0] = P[1, 1] = r2
            P[2, 2] = P[3, 3] = 1.0
            tr = _InternalTrack(
                id=self._new_id(),
                x=np.array([d.position[0], d.position[1], 0.0, 0.0]),
                P=P,
                z=d.position[2],
                confirmed=cfg.birth_hits <= 1,
                last_score=d.score,
            )
            self._tracks.append(tr)
            msg = f"{tr.id} tentative at ({d.position[0]:.2f}, {d.position[1]:.2f})"
            events.append(TrackEvent("track-birth", t, msg, tr.id))

        kept: list[_InternalTrack] = []
        for tr in self._tracks:
            limit = cfg.max_misses if tr.confirmed else 2
            if tr.misses > limit:
                if tr.confirmed:
                    msg = f"{tr.id} terminated after {tr.misses} missed frames"
                    events.append(TrackEvent("track-death", t, msg, tr.id))
            else:
                kept.append(tr)
        self._tracks = kept

        for tr in self._tracks:
            tr.trail.append((float(tr.x[0]), float(tr.x[1]), tr.z))
            if len(tr.trail) > self.trail_frames:
                del tr.trail[: len(tr.trail) - self.trail_frames]

        tracks = [
            Track(
                id=tr.id,
                position=(float(tr.x[0]), float(tr.x[1]), tr.z),
                velocity=(float(tr.x[2]), float(tr.x[3]), 0.0),
                covariance=(float(tr.P[0, 0]), float(tr.P[0, 1]), float(tr.P[1, 1]))
                if cfg.filter == "kalman"
                else (r2, 0.0, r2),
                age_frames=tr.age,
                hits=tr.hits,
                misses=tr.misses,
                confirmed=tr.confirmed,
                confidence=max(0.0, min(1.0, tr.last_score * math.exp(-tr.misses / 3))),
                trail=list(tr.trail),
            )
            for tr in self._tracks
        ]
        return tracks, events
