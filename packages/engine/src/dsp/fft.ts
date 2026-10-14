/** In-place iterative radix-2 complex FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  if (n & (n - 1)) throw new Error(`fft length ${n} is not a power of two`);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

export function nextPow2(n: number) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/**
 * Doppler power spectrum (dB) of a complex series using a Hann window, zero-padded to `nfft`,
 * with the mean removed (static component suppression). Output is fft-shifted: index 0 is −fs/2.
 */
export function dopplerSpectrum(re: Float64Array, im: Float64Array, nfft: number): Float64Array {
  const n = re.length;
  const w = hann(n);
  let mr = 0;
  let mi = 0;
  for (let i = 0; i < n; i++) {
    mr += re[i];
    mi += im[i];
  }
  mr /= n || 1;
  mi /= n || 1;
  const xr = new Float64Array(nfft);
  const xi = new Float64Array(nfft);
  for (let i = 0; i < Math.min(n, nfft); i++) {
    xr[i] = (re[i] - mr) * w[i];
    xi[i] = (im[i] - mi) * w[i];
  }
  fft(xr, xi);
  const out = new Float64Array(nfft);
  for (let i = 0; i < nfft; i++) {
    const src = (i + nfft / 2) % nfft;
    out[i] = 10 * Math.log10(xr[src] * xr[src] + xi[src] * xi[src] + 1e-12);
  }
  return out;
}

export function dopplerFreqs(nfft: number, fs: number): Float64Array {
  const f = new Float64Array(nfft);
  for (let i = 0; i < nfft; i++) f[i] = ((i - nfft / 2) * fs) / nfft;
  return f;
}

/** Welch-free single-segment power spectral density of a real series, one-sided, dB. */
export function psd(x: Float64Array, fs: number): { f: Float64Array; p: Float64Array } {
  const nfft = nextPow2(Math.max(8, x.length));
  const w = hann(x.length);
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length || 1;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let wss = 0;
  for (let i = 0; i < x.length; i++) {
    re[i] = (x[i] - mean) * w[i];
    wss += w[i] * w[i];
  }
  fft(re, im);
  const half = nfft / 2 + 1;
  const f = new Float64Array(half);
  const p = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    f[i] = (i * fs) / nfft;
    const scaleFactor = (i === 0 || i === nfft / 2 ? 1 : 2) / (fs * (wss || 1));
    p[i] = 10 * Math.log10((re[i] * re[i] + im[i] * im[i]) * scaleFactor + 1e-15);
  }
  return { f, p };
}
