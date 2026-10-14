"""Reference inference pipeline (counterpart of runtime/pipeline.ts and runtime/engine.ts).

Reproduces the TypeScript Pipeline for the default configuration: empty-room calibration
(baseline RSS, SNR estimate, calibration motion energy), per-frame link features (Hampel + EMA
filtered RSS, ΔRSS against the baseline, motion energy, delivery ratio), ``rti-bayes``
occupancy with EMA and 3×3×3 box smoothing, detections and tracks. It is written for clarity and
cross-checking, not throughput, and carries none of the stage instrumentation of the TypeScript
engine. Other reconstruction models are reported as unsupported.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Literal, Protocol

import numpy as np
import numpy.typing as npt

from echospace_sim.channel import CsiPacket
from echospace_sim.config import ScenarioConfig
from echospace_sim.geometry import js_round
from echospace_sim.rng import derive_seed
from echospace_sim.scene import LinkDescriptor, build_grid
from echospace_sim.source import GroundTruthSubject, SyntheticSource

from .align import align_link
from .fft import doppler_freqs, doppler_spectrum
from .hampel import hampel
from .occupancy import box_filter_3d, ema_in_place
from .rti import RtiModel
from .sanitize import SanitizedPacket, sanitize_packet
from .tracking import Detection, Track, Tracker, detect
from .validate import validate_packets

FloatArray = npt.NDArray[np.float64]
Float32Array = npt.NDArray[np.float32]
ModelStatus = Literal["ok", "degraded", "unsupported"]

DOPPLER_NFFT = 64


class SourceInfo(Protocol):
    """What the pipeline needs to know about a packet source."""

    @property
    def links(self) -> list[LinkDescriptor]: ...
    @property
    def antennas(self) -> list[int]: ...
    @property
    def subcarriers(self) -> int: ...
    @property
    def subcarrier_offsets_hz(self) -> FloatArray: ...
    @property
    def packet_rate_hz(self) -> float: ...


@dataclass
class Frame:
    seq: int
    timestamp_s: float
    state: Literal["calibrating", "degraded", "streaming"]
    model_status: ModelStatus
    model_message: str
    rss_db: Float32Array
    delta_rss_db: Float32Array
    motion_energy: Float32Array
    snr_est_db: Float32Array
    delivery_ratio: Float32Array
    image: Float32Array
    variance_ratio: Float32Array
    occupancy: Float32Array
    active_links: int
    input_quality: float
    mean_snr_db: float | None
    detections: list[Detection] = field(default_factory=list)
    tracks: list[Track] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    doppler_column: Float32Array | None = None
    doppler_freqs_hz: Float32Array | None = None


def rss_db(p: CsiPacket) -> float:
    """Mean power over the finite samples of a packet, dB (NaN when none are finite)."""
    re = p.re.astype(np.float64)
    im = p.im.astype(np.float64)
    ok = np.isfinite(re) & np.isfinite(im)
    n = int(np.count_nonzero(ok))
    if not n:
        return math.nan
    return 10 * math.log10(float(np.sum(re[ok] * re[ok] + im[ok] * im[ok])) / n + 1e-20)


def norm_diff(a: SanitizedPacket, b: SanitizedPacket) -> float:
    """‖b − a‖² / ‖b‖² over the samples where the difference is finite (0 when ‖b‖ = 0)."""
    dr = b.re - a.re
    di = b.im - a.im
    ok = ~(np.isnan(dr) | np.isnan(di))
    d = float(np.sum(dr[ok] ** 2 + di[ok] ** 2))
    e = float(np.sum(b.re[ok] ** 2 + b.im[ok] ** 2))
    return d / e if e > 0 else 0.0


class Pipeline:
    def __init__(self, cfg: ScenarioConfig, source: SourceInfo, *, tracker_seed: int | None = None) -> None:
        self.cfg = cfg
        self.source = source
        self.L = len(source.links)
        self.grid = build_grid(cfg.room, cfg.recon.voxel_size_m)
        rate = source.packet_rate_hz or 100
        buffer_packets = max(8, js_round(cfg.dsp.buffer_seconds * rate))
        self._san_hist: list[deque[SanitizedPacket]] = [deque(maxlen=buffer_packets) for _ in range(self.L)]
        self._rss_hist: list[deque[float]] = [deque(maxlen=buffer_packets) for _ in range(self.L)]
        self._rss_filt = np.full(self.L, np.nan)
        self.baseline_rss = np.full(self.L, np.nan)
        self.calib_motion = np.full(self.L, np.nan)
        self.snr_est = np.full(self.L, np.nan)
        self.background: list[tuple[FloatArray, FloatArray] | None] = [None] * self.L
        self._x_mhz = np.asarray(source.subcarrier_offsets_hz, dtype=np.float64) / 1e6
        self._occ_state: Float32Array | None = None
        self._cal_buffer: list[CsiPacket] = []
        self._seq = 0
        self._last_frame_t = 0.0
        self.calibrated = False
        self.self_calibrated = False
        self.selected_link = 0
        trail = js_round(cfg.privacy.track_history_seconds * cfg.dsp.frame_rate_hz)
        seed = tracker_seed if tracker_seed is not None else derive_seed(cfg.seed, 99, 0)
        self.tracker = Tracker(cfg.tracking, seed, trail)
        self.rti = RtiModel(self.grid, source.links, cfg.recon) if self.L > 0 else None

    def _sanitize(self, p: CsiPacket, enabled: bool) -> SanitizedPacket:
        return sanitize_packet(p.re, p.im, self.source.antennas[p.link], self.source.subcarriers, self._x_mhz, enabled)

    def calibrate(self, packets: list[CsiPacket], self_calibrated: bool = False) -> None:
        """Establishes per-link baselines from an empty-room capture."""
        by_link: list[list[CsiPacket]] = [[] for _ in range(self.L)]
        for p in packets:
            if 0 <= p.link < self.L:
                by_link[p.link].append(p)
        for li, lst in enumerate(by_link):
            if not lst:
                continue
            rss = [r for r in (rss_db(p) for p in lst) if math.isfinite(r)]
            sans = [self._sanitize(p, self.cfg.dsp.phase_sanitize) for p in lst]
            sre = np.stack([s.re for s in sans])
            sim = np.stack([s.im for s in sans])
            N = len(lst)
            mr = np.sum(sre, axis=0) / N
            mi = np.sum(sim, axis=0) / N
            sum2 = np.sum(sre * sre + sim * sim, axis=0)
            p2 = mr * mr + mi * mi
            ok = np.isfinite(p2)
            sig = float(np.sum(p2[ok]))
            res = float(np.sum(np.maximum(0.0, sum2[ok] / N - p2[ok])))
            motion = [norm_diff(a, b) for a, b in pairwise(sans)]
            self.background[li] = (mr, mi)
            self.baseline_rss[li] = sum(rss) / len(rss) if rss else math.nan
            self.calib_motion[li] = sum(motion) / len(motion) if motion else math.nan
            self.snr_est[li] = 10 * math.log10(sig / res) if res > 0 else math.nan
        self.calibrated = True
        self.self_calibrated = self_calibrated

    def process(self, packets: list[CsiPacket], frame_t: float) -> Frame:
        """Feeds the packets of one frame window and returns the frame."""
        cfg = self.cfg
        bypass = cfg.pipeline.bypass
        L = self.L
        K = self.source.subcarriers
        rate = self.source.packet_rate_hz or 100
        warnings: list[str] = []
        dt = max(1e-3, frame_t - self._last_frame_t) if self._last_frame_t else 1 / cfg.dsp.frame_rate_hz
        self._last_frame_t = frame_t

        v = validate_packets(packets, L, self.source.antennas, K)
        if v.missing_antennas:
            desc = ", ".join(
                f"{self.source.links[li].id} ant {'/'.join(map(str, sorted(s)))}"
                for li, s in v.missing_antennas.items()
            )
            warnings.append(f"Missing antenna channels (non-finite samples): {desc}")

        by_link: list[list[CsiPacket]] = [[] for _ in range(L)]
        for p in v.accepted:
            by_link[p.link].append(p)
        reconstructed = 0
        for li in range(L):
            a = align_link(by_link[li], rate)
            by_link[li] = a.packets
            reconstructed += a.reconstructed_timestamps
        if reconstructed > len(v.accepted) * 0.2:
            warnings.append(f"{reconstructed} packet timestamps were missing and reconstructed from sequence numbers.")

        if not self.calibrated:
            for lst in by_link:
                self._cal_buffer.extend(lst)
            need = cfg.dsp.calibration_seconds
            buf = self._cal_buffer
            span = buf[-1].true_time_s - buf[0].true_time_s if buf else 0.0
            if span >= need:
                self.calibrate(buf, True)
                self._cal_buffer = []

        sanitize_on = cfg.dsp.phase_sanitize and not bypass.get("preprocess", False)
        frame_san: list[list[SanitizedPacket]] = [[] for _ in range(L)]
        for li in range(L):
            for p in by_link[li]:
                san = self._sanitize(p, sanitize_on)
                self._san_hist[li].append(san)
                self._rss_hist[li].append(rss_db(p))
                frame_san[li].append(san)

        frame_rss = self._filter_rss(by_link)

        expected = rate / cfg.dsp.frame_rate_hz
        rss_feat = frame_rss.astype(np.float32)
        delta = (self.baseline_rss - frame_rss) if self.calibrated else np.full(L, np.nan)
        delta_rss = delta.astype(np.float32)
        delivery = np.array([min(1.0, len(by_link[li]) / expected) for li in range(L)], dtype=np.float32)
        motion = np.empty(L, dtype=np.float32)
        for li in range(L):
            fs = frame_san[li]
            diffs = [norm_diff(a, b) for a, b in pairwise(fs)]
            raw = sum(diffs) / len(diffs) if diffs else math.nan
            cm = self.calib_motion[li]
            motion[li] = raw / cm if math.isfinite(cm) and cm > 0 else raw
        snr = self.snr_est.astype(np.float32)

        V = self.grid.count
        image = np.zeros(V, dtype=np.float32)
        variance_ratio = np.ones(V, dtype=np.float32)
        occupancy = np.zeros(V, dtype=np.float32)
        status: ModelStatus = "ok"
        message = ""
        active = 0
        model_id = cfg.recon.model_id
        finite_links = int(np.count_nonzero(np.isfinite(delta_rss)))
        if not self.calibrated:
            status, message = "degraded", "Calibrating: collecting baseline before imaging."
        elif self.rti is None:
            status, message = "unsupported", "No links: no spatial reconstruction is possible."
        elif model_id in ("tcn-encoder", "transformer-encoder"):
            status = "unsupported"
            message = f"{model_id} is a registered interface slot without trained weights in this build."
        elif model_id != "rti-bayes":
            status = "unsupported"
            message = f"{model_id} is not implemented in the Python reference pipeline."
        elif finite_links < 3:
            status = "unsupported"
            message = (
                f"Insufficient observations: {finite_links} usable link(s); attenuation imaging needs at least "
                "3 links with crossing geometry to localise anything."
            )
            variance_ratio = self.rti.coverage().copy()
        else:
            y = np.clip(delta_rss, np.float32(-3), np.float32(25))
            r = self.rti.reconstruct(y)
            image, variance_ratio, occupancy, active = r.image, r.variance_ratio, r.occupancy, r.active_links
            if active < L:
                status = "degraded"
                message = (
                    f"{L - active} of {L} links had no data this frame; posterior variance raised where they "
                    "provided coverage."
                )

        smoothing_on = not bypass.get("reconstruct", False)
        if self._occ_state is None or self._occ_state.shape != occupancy.shape:
            self._occ_state = occupancy.copy()
        else:
            ema_in_place(self._occ_state, occupancy, cfg.recon.temporal_smoothing if smoothing_on else 0)
        smoothed = self._occ_state
        if cfg.recon.spatial_filter and smoothing_on:
            smoothed = box_filter_3d(smoothed, self.grid)
        occ_out = np.zeros(V, dtype=np.float32) if status == "unsupported" else smoothed.copy()

        detections: list[Detection] = []
        tracks: list[Track] = []
        tracking_on = cfg.tracking.enabled and not bypass.get("associate", False) and status != "unsupported"
        if cfg.tracking.filter == "learned":
            warnings.append("Learned temporal model is not implemented; tracking disabled rather than substituted.")
        elif tracking_on and self.calibrated:
            detections = detect(occ_out, self.grid, cfg.tracking.detection_threshold, cfg.tracking.max_detections)
            self.tracker.configure(cfg.tracking, js_round(cfg.privacy.track_history_seconds * cfg.dsp.frame_rate_hz))
            tracks, _ = self.tracker.step(detections, dt, frame_t)

        finite_snr = [float(s) for s in snr if math.isfinite(s)]
        mean_snr = sum(finite_snr) / len(finite_snr) if finite_snr else None
        delivery_mean = float(np.sum(delivery.astype(np.float64))) / L if L else 0.0
        snr_factor = 1.0 if mean_snr is None else 1 / (1 + math.exp(-(mean_snr - 10) / 3))
        input_quality = delivery_mean * snr_factor
        if input_quality < 0.5:
            snr_txt = "N/A" if mean_snr is None else f"{mean_snr:.1f}"
            warnings.append(
                f"Input quality {input_quality:.2f}: delivery {delivery_mean * 100:.0f} %, SNR {snr_txt} dB."
            )

        doppler, doppler_f = self._doppler(K, rate)
        if not self.calibrated:
            state: Literal["calibrating", "degraded", "streaming"] = "calibrating"
        elif status != "ok" or input_quality < 0.5:
            state = "degraded"
        else:
            state = "streaming"
        frame = Frame(
            seq=self._seq,
            timestamp_s=frame_t,
            state=state,
            model_status=status,
            model_message=message,
            rss_db=rss_feat,
            delta_rss_db=delta_rss,
            motion_energy=motion,
            snr_est_db=snr,
            delivery_ratio=delivery,
            image=image,
            variance_ratio=variance_ratio,
            occupancy=occ_out,
            active_links=active,
            input_quality=input_quality,
            mean_snr_db=mean_snr,
            detections=detections,
            tracks=tracks,
            warnings=warnings,
            doppler_column=doppler,
            doppler_freqs_hz=doppler_f,
        )
        self._seq += 1
        return frame

    def _filter_rss(self, by_link: list[list[CsiPacket]]) -> FloatArray:
        """Hampel over the new samples plus context, frame mean, then EMA across frames."""
        cfg = self.cfg
        bypass = cfg.pipeline.bypass.get("filter", False)
        hw = cfg.dsp.hampel.half_window
        hampel_on = cfg.dsp.hampel.enabled and not bypass
        alpha = cfg.dsp.lowpass.alpha if cfg.dsp.lowpass.enabled and not bypass else 1.0
        out = np.full(self.L, np.nan)
        for li in range(self.L):
            n_new = len(by_link[li])
            if not n_new:
                continue
            series = list(self._rss_hist[li])
            ctx = min(len(series), n_new + hw * 2)
            tail = np.array(series[len(series) - ctx :], dtype=np.float64)
            y = hampel(tail, hw, cfg.dsp.hampel.n_sigma)[0] if hampel_on else tail
            vals = [float(x) for x in y[len(y) - n_new :] if math.isfinite(x)]
            if not vals:
                continue
            mean = sum(vals) / len(vals)
            prev = self._rss_filt[li]
            self._rss_filt[li] = alpha * mean + (1 - alpha) * prev if math.isfinite(prev) else mean
            out[li] = self._rss_filt[li]
        return out

    def _doppler(self, K: int, rate: float) -> tuple[Float32Array | None, Float32Array | None]:
        """Doppler column of the selected link from the antenna-0 subcarrier mean of its history."""
        if not self.L:
            return None, None
        hist = self._san_hist[self.selected_link]
        n = min(len(hist), DOPPLER_NFFT)
        if n < 8:
            return None, None
        items = list(hist)[-n:]
        re = np.empty(n)
        im = np.empty(n)
        for i, it in enumerate(items):
            r0 = it.re[:K]
            ok = ~np.isnan(r0)
            re[i] = float(np.sum(r0[ok])) / K
            im[i] = float(np.sum(it.im[:K][ok])) / K
        spectrum = doppler_spectrum(re, im, DOPPLER_NFFT).astype(np.float32)
        return spectrum, doppler_freqs(DOPPLER_NFFT, rate).astype(np.float32)


class ReferenceEngine:
    """Offline driver: a synthetic source, empty-room calibration, and fixed-period frame windows.

    Frame k (k = 1, 2, …) is processed at t_k = t_{k−1} + 1/frame_rate (accumulated exactly as in
    EchoEngine) and receives every packet whose sequence time is ≤ t_k + 1e-9 not yet consumed.
    """

    def __init__(self, config: ScenarioConfig) -> None:
        self.config = config
        self.source = SyntheticSource(config)
        self.pipeline = Pipeline(config, self.source)
        self._next_frame_t = 1 / config.dsp.frame_rate_hz
        cal = self.source.calibration()
        if cal:
            self.pipeline.calibrate(cal)

    def step(self) -> tuple[Frame, list[GroundTruthSubject]]:
        t = self._next_frame_t
        packets = self.source.pull(t)
        frame = self.pipeline.process(packets, t)
        self._next_frame_t += 1 / self.config.dsp.frame_rate_hz
        return frame, self.source.ground_truth(t)

    def run(self, n_frames: int) -> list[Frame]:
        return [self.step()[0] for _ in range(n_frames)]
