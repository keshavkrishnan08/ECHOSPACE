import type { CsiPacket } from "../sim/channel";

export interface AlignmentReport {
  packets: CsiPacket[];
  reconstructedTimestamps: number;
  reordered: number;
  gaps: number;
  /** Std-dev of timestamp residuals against the nominal clock, ms (NaN if < 3 valid timestamps). */
  jitterMs: number;
  clockOffsetS: number;
}

/**
 * Timestamp alignment for one link. Packets are ordered by sequence number; missing timestamps
 * are reconstructed from a least-squares fit ts ≈ offset + seq / rate over the valid ones (or the
 * nominal clock when too few are valid). Assumes the sequence counter is reliable.
 */
export function alignLink(packets: CsiPacket[], rate: number): AlignmentReport {
  let reordered = 0;
  for (let i = 1; i < packets.length; i++) if (packets[i].seq < packets[i - 1].seq) reordered++;
  const sorted = reordered ? [...packets].sort((a, b) => a.seq - b.seq) : packets;
  let n = 0;
  let sumOff = 0;
  for (const p of sorted) if (Number.isFinite(p.timestampS)) {
    sumOff += p.timestampS - p.seq / rate;
    n++;
  }
  const offset = n ? sumOff / n : 0;
  let ss = 0;
  for (const p of sorted) if (Number.isFinite(p.timestampS)) {
    const r = p.timestampS - p.seq / rate - offset;
    ss += r * r;
  }
  let recon = 0;
  let gaps = 0;
  const out: CsiPacket[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (i > 0 && p.seq - sorted[i - 1].seq > 1) gaps++;
    if (!Number.isFinite(p.timestampS)) {
      recon++;
      out.push({ ...p, timestampS: offset + p.seq / rate });
    } else out.push(p);
  }
  return { packets: out, reconstructedTimestamps: recon, reordered, gaps, jitterMs: n >= 3 ? Math.sqrt(ss / (n - 1)) * 1000 : Number.NaN, clockOffsetS: offset };
}
