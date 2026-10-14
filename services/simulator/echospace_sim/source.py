"""Deterministic synthetic CSI source driven by a scenario configuration (port of runtime/source.ts)."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from .channel import ChannelSimulator, CsiPacket, PropagationPath
from .config import ScenarioConfig
from .geometry import Vec3, js_round
from .rng import STREAM
from .scene import LinkDescriptor
from .trajectory import CompiledPath, Posture, SubjectState, compile_path, subject_state_at


@dataclass
class GroundTruthSubject:
    id: str
    label: str
    position: Vec3
    velocity: Vec3
    heading_rad: float
    posture: Posture
    joints: npt.NDArray[np.float32]
    """17 COCO-order joints, flattened xyz. Synthetic, never inferred."""
    height_m: float
    radius_m: float


class SyntheticSource:
    """Synthetic packet source.

    Calibration uses a separate random stream with the room empty, which mirrors how a physical
    deployment would capture an empty-room baseline.
    """

    def __init__(self, config: ScenarioConfig) -> None:
        self.config = config
        self.sim = ChannelSimulator(config)
        self._paths: list[CompiledPath] = [compile_path(s) for s in config.subjects]
        self._next_seq = 0

    @property
    def links(self) -> list[LinkDescriptor]:
        return self.sim.links

    @property
    def antennas(self) -> list[int]:
        return [link.antennas for link in self.sim.links]

    @property
    def subcarriers(self) -> int:
        return self.sim.K

    @property
    def subcarrier_offsets_hz(self) -> npt.NDArray[np.float64]:
        return self.sim.offsets_hz

    @property
    def packet_rate_hz(self) -> float:
        return self.config.signal.packet_rate_hz

    def subject_states(self, t: float) -> list[SubjectState]:
        return [subject_state_at(p, t) for p in self._paths]

    def calibration(self) -> list[CsiPacket]:
        cal = ChannelSimulator(self.config, STREAM.calibration)
        n = js_round(self.config.dsp.calibration_seconds * self.config.signal.packet_rate_hz)
        return [p for s in range(n) for p in cal.packets(s, []) if p is not None]

    def pull(self, until_s: float) -> list[CsiPacket]:
        """Packets whose sequence time is ≤ until_s, each returned once."""
        rate = self.config.signal.packet_rate_hz
        out: list[CsiPacket] = []
        while self._next_seq / rate <= until_s + 1e-9:
            t = self._next_seq / rate
            out.extend(p for p in self.sim.packets(self._next_seq, self.subject_states(t)) if p is not None)
            self._next_seq += 1
        return out

    def ground_truth(self, t: float) -> list[GroundTruthSubject]:
        out: list[GroundTruthSubject] = []
        for path, spec in zip(self._paths, self.config.subjects, strict=True):
            s = subject_state_at(path, t)
            if not s.present:
                continue
            out.append(
                GroundTruthSubject(
                    id=spec.id,
                    label=spec.label,
                    position=s.position,
                    velocity=s.velocity,
                    heading_rad=s.heading,
                    posture=s.posture,
                    joints=s.joints,
                    height_m=spec.height_m,
                    radius_m=spec.radius_m,
                )
            )
        return out

    def propagation_paths(self, t: float, link: int) -> list[PropagationPath]:
        return self.sim.paths(link, self.subject_states(t))

    def duration_s(self) -> float:
        return self.config.duration_s

    def seek(self, t: float) -> None:
        """Continue generation from stream time t (used when a scenario is reconfigured mid-run)."""
        self._next_seq = max(0, math.ceil(t * self.config.signal.packet_rate_hz - 1e-9))

    def reset(self) -> None:
        self._next_seq = 0
        self.sim.reset_impairments()
