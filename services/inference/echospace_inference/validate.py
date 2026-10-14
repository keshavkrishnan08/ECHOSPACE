"""Packet shape and finiteness checks (port of dsp/validate.ts)."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from echospace_sim.channel import CsiPacket


@dataclass
class ValidationResult:
    accepted: list[CsiPacket]
    rejected: int
    missing_antennas: dict[int, set[int]] = field(default_factory=dict)
    """Per-link antenna indices that contained non-finite samples in this batch."""
    errors: list[str] = field(default_factory=list)


def validate_packets(packets: list[CsiPacket], links: int, antennas: list[int], subcarriers: int) -> ValidationResult:
    """Checks shape and finiteness. Packets with every antenna non-finite are rejected."""
    accepted: list[CsiPacket] = []
    missing: dict[int, set[int]] = {}
    errors: list[str] = []
    rejected = 0
    for p in packets:
        if p.link < 0 or p.link >= links:
            rejected += 1
            errors.append(f"packet for unknown link {p.link}")
            continue
        M = antennas[p.link]
        if p.subcarriers != subcarriers or p.antennas != M or p.re.size != M * p.subcarriers or p.im.size != p.re.size:
            rejected += 1
            errors.append(
                f"shape mismatch on link {p.link}: got {p.antennas}x{p.subcarriers}, expected {M}x{subcarriers}"
            )
            continue
        finite = (np.isfinite(p.re) & np.isfinite(p.im)).reshape(M, p.subcarriers).all(axis=1)
        for m in np.flatnonzero(~finite):
            missing.setdefault(p.link, set()).add(int(m))
        if not finite.any():
            rejected += 1
            continue
        accepted.append(p)
    return ValidationResult(accepted, rejected, missing, errors[:5])
