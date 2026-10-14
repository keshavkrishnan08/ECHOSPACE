/**
 * Linear phase sanitization (a widely used CSI preprocessing step).
 *
 * Carrier-frequency offset adds a phase common to all subcarriers; sampling-time offset adds a
 * phase linear in subcarrier frequency. Both are shared by all receive antennas of a packet.
 * We unwrap antenna 0's phase over subcarriers, fit φ(f) = a·f + b by least squares and remove
 * the same line from every antenna, which preserves inter-antenna phase differences.
 */
export function unwrap(phase: Float64Array): Float64Array {
  const out = new Float64Array(phase.length);
  if (!phase.length) return out;
  out[0] = phase[0];
  let offset = 0;
  for (let i = 1; i < phase.length; i++) {
    const d = phase[i] - phase[i - 1];
    if (d > Math.PI) offset -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    else if (d < -Math.PI) offset += 2 * Math.PI * Math.round(-d / (2 * Math.PI));
    out[i] = phase[i] + offset;
  }
  return out;
}

export function linearFit(x: Float64Array, y: Float64Array): { slope: number; intercept: number } {
  const n = x.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) * (x[i] - mx);
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx };
}

export interface SanitizedPacket {
  re: Float64Array;
  im: Float64Array;
  /** Raw wrapped phase and sanitized phase (unwrapped, detrended), [m*K+k]. */
  phaseRaw: Float64Array;
  phaseSan: Float64Array;
  mag: Float64Array;
  slope: number;
  intercept: number;
}

/**
 * Sanitizes one packet. `refAntenna` is the first antenna with finite data. Antennas with
 * non-finite samples are passed through as NaN.
 */
export function sanitizePacket(re: Float32Array | Float64Array, im: Float32Array | Float64Array, M: number, K: number, x: Float64Array, enabled: boolean): SanitizedPacket {
  const n = M * K;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  const phaseRaw = new Float64Array(n);
  const phaseSan = new Float64Array(n);
  const mag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    phaseRaw[i] = Math.atan2(im[i], re[i]);
    mag[i] = Math.hypot(re[i], im[i]);
  }
  let ref = -1;
  for (let m = 0; m < M && ref < 0; m++) if (Number.isFinite(re[m * K]) && Number.isFinite(im[m * K])) ref = m;
  let slope = 0;
  let intercept = 0;
  if (enabled && ref >= 0) {
    const ph = unwrap(phaseRaw.subarray(ref * K, ref * K + K));
    ({ slope, intercept } = linearFit(x, ph));
  }
  for (let m = 0; m < M; m++) {
    const unw = unwrap(phaseRaw.subarray(m * K, m * K + K));
    for (let k = 0; k < K; k++) {
      const i = m * K + k;
      const corr = slope * x[k] + intercept;
      const c = Math.cos(-corr);
      const s = Math.sin(-corr);
      outRe[i] = re[i] * c - im[i] * s;
      outIm[i] = re[i] * s + im[i] * c;
      phaseSan[i] = unw[k] - corr;
    }
  }
  return { re: outRe, im: outIm, phaseRaw, phaseSan, mag, slope, intercept };
}
