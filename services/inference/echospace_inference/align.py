"""Timestamp alignment for one link (port of dsp/align.ts)."""

from __future__ import annotations

import dataclasses
import math
from dataclasses import dataclass
from itertools import pairwise

from echospace_sim.channel import CsiPacket


@dataclass
class AlignmentReport:
    packets: list[CsiPacket]
    reconstructed_timestamps: int
    reordered: int
    gaps: int
    jitter_ms: float
    """Std-dev of timestamp residuals against the nominal clock, ms (NaN with fewer than 3 valid timestamps)."""
    clock_offset_s: float


def align_link(packets: list[CsiPacket], rate: float) -> AlignmentReport:
    """Orders packets by sequence number and fills missing timestamps.

    Missing timestamps are reconstructed from a least-squares fit ts ≈ offset + seq / rate over the
    valid ones (or the nominal clock when none are valid). Assumes the sequence counter is reliable.
    """
    reordered = sum(1 for a, b in pairwise(packets) if b.seq < a.seq)
    ordered = sorted(packets, key=lambda p: p.seq) if reordered else packets
    valid = [p for p in ordered if math.isfinite(p.timestamp_s)]
    offset = 0.0
    for p in valid:
        offset += p.timestamp_s - p.seq / rate
    offset = offset / len(valid) if valid else 0.0
    ss = 0.0
    for p in valid:
        r = p.timestamp_s - p.seq / rate - offset
        ss += r * r
    recon = 0
    gaps = 0
    out: list[CsiPacket] = []
    for i, p in enumerate(ordered):
        if i > 0 and p.seq - ordered[i - 1].seq > 1:
            gaps += 1
        if math.isfinite(p.timestamp_s):
            out.append(p)
        else:
            recon += 1
            out.append(dataclasses.replace(p, timestamp_s=offset + p.seq / rate))
    n = len(valid)
    jitter = math.sqrt(ss / (n - 1)) * 1000 if n >= 3 else math.nan
    return AlignmentReport(out, recon, reordered, gaps, jitter, offset)
