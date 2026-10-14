import type { CsiPacket } from "../sim/channel";

export interface ValidationResult {
  accepted: CsiPacket[];
  rejected: number;
  /** Per-link set of antenna indices that contained non-finite samples in this batch. */
  missingAntennas: Map<number, Set<number>>;
  errors: string[];
}

/** Checks shape and finiteness. Packets with every antenna non-finite are rejected. */
export function validatePackets(packets: CsiPacket[], expected: { links: number; antennas: number[]; subcarriers: number }): ValidationResult {
  const accepted: CsiPacket[] = [];
  const missing = new Map<number, Set<number>>();
  const errors: string[] = [];
  let rejected = 0;
  for (const p of packets) {
    if (p.link < 0 || p.link >= expected.links) {
      rejected++;
      errors.push(`packet for unknown link ${p.link}`);
      continue;
    }
    const M = expected.antennas[p.link];
    if (p.subcarriers !== expected.subcarriers || p.antennas !== M || p.re.length !== M * p.subcarriers || p.im.length !== p.re.length) {
      rejected++;
      errors.push(`shape mismatch on link ${p.link}: got ${p.antennas}x${p.subcarriers}, expected ${M}x${expected.subcarriers}`);
      continue;
    }
    let good = 0;
    for (let m = 0; m < M; m++) {
      let finite = true;
      for (let k = 0; k < p.subcarriers; k++) {
        const i = m * p.subcarriers + k;
        if (!Number.isFinite(p.re[i]) || !Number.isFinite(p.im[i])) {
          finite = false;
          break;
        }
      }
      if (finite) good++;
      else {
        if (!missing.has(p.link)) missing.set(p.link, new Set());
        missing.get(p.link)!.add(m);
      }
    }
    if (good === 0) {
      rejected++;
      continue;
    }
    accepted.push(p);
  }
  return { accepted, rejected, missingAntennas: missing, errors: errors.slice(0, 5) };
}
