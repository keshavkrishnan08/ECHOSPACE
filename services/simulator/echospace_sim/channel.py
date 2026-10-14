"""Simplified multipath channel-state-information (CSI) generator (port of sim/channel.ts).

Model (see docs/simulation-model.md for assumptions and omissions):

    H_m(f_k) = Σ_p g_p(t) · a_{p,m} · exp(−j 2π f_k L_{p,m} / c)  +  impairments  +  noise

Paths p: line of sight, first-order specular reflections from the room surfaces (image method),
and single-bounce scattering from points on each synthetic subject. g_p(t) is a body-shadowing
gain derived from a Fresnel-zone-weighted distance between the path and each subject's body axis.
Amplitudes are normalized (1.0 = free-space LoS at 1 m); they are *not* calibrated received power.

Differences from the TypeScript implementation are confined to floating-point evaluation order:
the field is evaluated with a direct cos/sin per subcarrier instead of the rotation recurrence,
and per-path sums are vectorized. Random draws are scalar-identical and happen in the same order,
so drop patterns, missing timestamps and noise realisations match exactly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import numpy.typing as npt

from .config import MATERIAL_PENETRATION_DB, Obstacle, ScenarioConfig
from .geometry import C_LIGHT, Vec3, dist, segment_box_overlap, segment_segment_distance
from .rng import STREAM, Rng, derive_seed
from .scene import (
    LinkDescriptor,
    antenna_positions,
    build_links,
    mirror,
    opening_reflectivity,
    room_surfaces,
    sensor_by_id,
    wavelength,
)
from .trajectory import SubjectState

FloatArray = npt.NDArray[np.float64]
ComplexArray = npt.NDArray[np.complex128]


@dataclass
class CsiPacket:
    link: int
    seq: int
    timestamp_s: float
    """Reported timestamp in seconds; NaN when the source omitted it."""
    true_time_s: float
    """Simulation time the packet represents (ground truth; not visible to the DSP pipeline)."""
    antennas: int
    subcarriers: int
    re: npt.NDArray[np.float32]
    """Flattened [antenna * subcarriers + k]."""
    im: npt.NDArray[np.float32]


@dataclass(frozen=True)
class PathSegment:
    a: Vec3
    b: Vec3
    length: float


@dataclass
class StaticPath:
    kind: Literal["los", "reflection"]
    surface: str | None
    segments: list[PathSegment]
    field: ComplexArray
    """Unshadowed complex field, shape (M, K)."""
    length_m: float


@dataclass
class PropagationPath:
    link_index: int
    kind: Literal["los", "reflection", "scatter"]
    points: list[Vec3]
    amplitude: float
    """Mean amplitude (normalized) including obstacle and shadowing losses at time t."""
    length_m: float
    surface: str | None = None


@dataclass
class _LinkState:
    antennas: list[Vec3]
    paths: list[StaticPath]
    static_sum: ComplexArray
    missing: set[int] = field(default_factory=set)


def _segments_of(points: list[Vec3]) -> list[PathSegment]:
    return [PathSegment(points[i], points[i + 1], dist(points[i], points[i + 1])) for i in range(len(points) - 1)]


def _obstacle_loss_db(segs: list[PathSegment], obstacles: list[Obstacle]) -> float:
    loss = 0.0
    for s in segs:
        for o in obstacles:
            overlap = segment_box_overlap(s.a, s.b, o.min, o.max)
            if overlap > 0:
                db = o.attenuation_db if o.attenuation_db is not None else MATERIAL_PENETRATION_DB[o.material]
                loss += db * min(1.0, overlap / 0.05)
    return loss


class ChannelSimulator:
    def __init__(self, config: ScenarioConfig, rng_stream: int = STREAM.impairments) -> None:
        self.cfg = config
        self.links: list[LinkDescriptor] = build_links(config.sensors)
        sig = config.signal
        self.lam = wavelength(sig.center_freq_hz)
        self.K = sig.subcarriers
        df = sig.bandwidth_hz / self.K
        self.offsets_hz: FloatArray = (np.arange(self.K, dtype=np.float64) - (self.K - 1) / 2) * df
        self.freqs: FloatArray = sig.center_freq_hz + self.offsets_hz
        n_surfaces = sig.reflecting_surfaces if sig.max_reflection_order >= 1 else 0
        surfaces = room_surfaces(config.room)[:n_surfaces]
        room = config.room
        self.static_power = np.zeros(len(self.links))
        self.noise_var = np.zeros(len(self.links))
        self._state: list[_LinkState] = []
        for link in self.links:
            ants = antenna_positions(sensor_by_id(config, link.rx_id), self.lam)
            M = len(ants)
            tx = link.tx
            paths: list[StaticPath] = []

            segs = _segments_of([tx, ants[0]])
            g = 10 ** (-_obstacle_loss_db(segs, config.obstacles) / 20)
            lengths = np.array([dist(tx, r) for r in ants])
            paths.append(StaticPath("los", None, segs, self._field(g / lengths, lengths), dist(tx, ants[0])))

            for s in surfaces:
                img = mirror(tx, s)
                amps: list[float] = []
                lens: list[float] = []
                segs0: list[PathSegment] = []
                for m, r in enumerate(ants):
                    denom = r[s.axis] - img[s.axis]
                    if abs(denom) < 1e-9:
                        break
                    t = (s.value - img[s.axis]) / denom
                    if t <= 0 or t >= 1:
                        break
                    hit = (img[0] + (r[0] - img[0]) * t, img[1] + (r[1] - img[1]) * t, img[2] + (r[2] - img[2]) * t)
                    inside = (
                        -1e-9 <= hit[0] <= room.width + 1e-9
                        and -1e-9 <= hit[1] <= room.depth + 1e-9
                        and -1e-9 <= hit[2] <= room.height + 1e-9
                    )
                    if not inside:
                        break
                    gamma = opening_reflectivity(config.openings, s, hit, s.reflectivity)
                    segs = _segments_of([tx, hit, r])
                    loss_db = _obstacle_loss_db(segs, config.obstacles)
                    length = dist(img, r)
                    amps.append((gamma * 10 ** (-loss_db / 20)) / length)
                    lens.append(length)
                    if m == 0:
                        segs0 = segs
                else:
                    reflected = self._field(np.array(amps), np.array(lens))
                    paths.append(StaticPath("reflection", s.name, segs0, reflected, lens[0]))

            static_sum = np.zeros((M, self.K), dtype=np.complex128)
            for p in paths:
                static_sum += p.field
            power = float(np.sum(static_sum.real**2 + static_sum.imag**2)) / (M * self.K)
            self.static_power[link.index] = power
            self.noise_var[link.index] = power / 10 ** (sig.snr_db / 10)
            missing = {
                f.antenna for f in config.impairments.missing_antennas if f.sensor_id == link.rx_id and f.antenna < M
            }
            self._state.append(_LinkState(ants, paths, static_sum, missing))
        self._burst_remaining = [0] * len(self.links)
        self._rngs = [Rng(derive_seed(config.seed, rng_stream, link.index)) for link in self.links]

    def _field(self, amplitude: FloatArray, length: FloatArray) -> ComplexArray:
        """a·exp(−j2πf_k L/c) for every element; `amplitude` and `length` share a shape (..., M)."""
        phase = (-2 * math.pi * self.freqs * length[..., None]) / C_LIGHT
        return amplitude[..., None] * np.cos(phase) + 1j * (amplitude[..., None] * np.sin(phase))

    def antenna_positions(self, link_index: int) -> list[Vec3]:
        return self._state[link_index].antennas

    def _shadow_loss_db(self, segs: list[PathSegment], subjects: list[SubjectState], skip: int) -> float:
        sig = self.cfg.signal
        if not sig.subject_shadowing:
            return 0.0
        loss = 0.0
        for j, s in enumerate(subjects):
            if j == skip or not s.present:
                continue
            r = self.cfg.subjects[j].radius_m if j < len(self.cfg.subjects) else 0.22
            q0 = (s.position[0], s.position[1], s.axis_bottom)
            q1 = (s.position[0], s.position[1], s.axis_top)
            for seg in segs:
                d, u = segment_segment_distance(seg.a, seg.b, q0, q1)
                d1 = u * seg.length
                d2 = (1 - u) * seg.length
                rf2 = (self.lam * d1 * d2) / seg.length if seg.length > 0 else 0.0
                reff2 = r * r + rf2
                loss += sig.body_shadow_db * math.exp(-(d * d) / (2 * reff2))
        return loss

    def channel(self, link_index: int, subjects: list[SubjectState]) -> ComplexArray:
        """Noiseless channel of one link for the given subject states, shape (M, K)."""
        st = self._state[link_index]
        if not any(s.present for s in subjects):
            out = st.static_sum.copy()
        else:
            out = np.zeros_like(st.static_sum)
            for path in st.paths:
                g = 10 ** (-self._shadow_loss_db(path.segments, subjects, -1) / 20)
                out += g * path.field
        if not self.cfg.signal.subject_scatter:
            return out
        tx = self.links[link_index].tx
        ants = st.antennas
        amps: list[list[float]] = []
        lens: list[list[float]] = []
        for j, s in enumerate(subjects):
            if not s.present:
                continue
            rcs = self.cfg.subjects[j].rcs_m2 if j < len(self.cfg.subjects) else 1.0
            for sc in s.scatterers:
                p = (sc[0], sc[1], sc[2])
                d1 = dist(tx, p)
                segs = _segments_of([tx, p, ants[0]])
                loss_db = _obstacle_loss_db(segs, self.cfg.obstacles) + self._shadow_loss_db(segs, subjects, j)
                g = 10 ** (-loss_db / 20)
                amp0 = math.sqrt((rcs * sc[3]) / (4 * math.pi))
                d2s = [dist(p, a) for a in ants]
                amps.append([(g * amp0) / (d1 * d2) for d2 in d2s])
                lens.append([d1 + d2 for d2 in d2s])
        if amps:
            out += self._field(np.array(amps), np.array(lens)).sum(axis=0)
        return out

    def paths(self, link_index: int, subjects: list[SubjectState]) -> list[PropagationPath]:
        """Geometric propagation paths of a link at the current subject state, for visualization."""
        link = self.links[link_index]
        st = self._state[link_index]
        out: list[PropagationPath] = []
        for p in st.paths:
            g = 10 ** (-self._shadow_loss_db(p.segments, subjects, -1) / 20)
            a = float(np.sum(np.abs(p.field[0])))
            points = [p.segments[0].a, *(s.b for s in p.segments)]
            out.append(PropagationPath(link_index, p.kind, points, (g * a) / self.K, p.length_m, p.surface))
        if self.cfg.signal.subject_scatter:
            ant0 = st.antennas[0]
            for j, s in enumerate(subjects):
                if not s.present:
                    continue
                pt = (s.scatterers[0][0], s.scatterers[0][1], s.scatterers[0][2])
                d1 = dist(link.tx, pt)
                d2 = dist(pt, ant0)
                rcs = self.cfg.subjects[j].rcs_m2 if j < len(self.cfg.subjects) else 1.0
                amp = math.sqrt(rcs / (4 * math.pi)) / (d1 * d2)
                out.append(PropagationPath(link_index, "scatter", [link.tx, pt, ant0], amp, d1 + d2))
        return out

    def reset_impairments(self, rng_stream: int = STREAM.impairments) -> None:
        self._burst_remaining = [0] * len(self.links)
        self._rngs = [Rng(derive_seed(self.cfg.seed, rng_stream, link.index)) for link in self.links]

    def packets(self, seq: int, subjects: list[SubjectState]) -> list[CsiPacket | None]:
        """One packet per link for sequence number `seq` (None for dropped packets).

        Random draws happen in a fixed order whether or not the packet is dropped, so the stream
        stays aligned across configurations.
        """
        imp = self.cfg.impairments
        rate = self.cfg.signal.packet_rate_hz
        t = seq / rate
        K = self.K
        out: list[CsiPacket | None] = []
        for link in self.links:
            li = link.index
            rng = self._rngs[li]
            st = self._state[li]
            M = len(st.antennas)
            u_loss = rng.uniform()
            u_burst = rng.uniform()
            n_jit = rng.normal()
            u_miss_ts = rng.uniform()
            u_cfo = rng.uniform()
            u_sto = rng.uniform()
            n_agc = rng.normal()
            phase_jit = rng.normals(M)
            noise = rng.normals(2 * M * K)

            dropped = u_loss < imp.packet_loss
            if self._burst_remaining[li] > 0:
                self._burst_remaining[li] -= 1
                dropped = True
            elif u_burst < imp.burst_rate_hz / rate:
                self._burst_remaining[li] = imp.burst_length_packets - 1
                dropped = True
            if dropped:
                out.append(None)
                continue

            h = self.channel(li, subjects)
            gain = 10 ** ((n_agc * imp.agc_sigma_db) / 20)
            cfo = 2 * math.pi * u_cfo if imp.cfo else 0.0
            sto = (u_sto - 0.5) * 100e-9 if imp.sto else 0.0
            sigma = math.sqrt(self.noise_var[li] / 2)
            pj = np.array(phase_jit)[:, None] * imp.phase_instability_rad
            ph = (cfo + pj) - 2 * math.pi * self.offsets_hz[None, :] * sto
            c = np.cos(ph)
            s = np.sin(ph)
            nz = np.array(noise).reshape(M, K, 2)
            hr = gain * (h.real * c - h.imag * s) + sigma * nz[..., 0]
            hi = gain * (h.real * s + h.imag * c) + sigma * nz[..., 1]
            if st.missing:
                rows = sorted(st.missing)
                hr[rows] = np.nan
                hi[rows] = np.nan
            ts = math.nan if u_miss_ts < imp.missing_timestamp_prob else t + (n_jit * imp.timestamp_jitter_ms) / 1000
            out.append(
                CsiPacket(
                    link=li,
                    seq=seq,
                    timestamp_s=ts,
                    true_time_s=t,
                    antennas=M,
                    subcarriers=K,
                    re=hr.astype(np.float32).ravel(),
                    im=hi.astype(np.float32).ravel(),
                )
            )
        return out
