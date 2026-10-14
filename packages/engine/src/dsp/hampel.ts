/**
 * Hampel identifier: replaces samples further than nSigma scaled MADs from the local median
 * with that median. Returns the filtered series and the number of replaced samples.
 */
export function hampel(x: Float64Array, halfWindow: number, nSigma: number): { y: Float64Array; replaced: number } {
  const n = x.length;
  const y = Float64Array.from(x);
  let replaced = 0;
  const win: number[] = [];
  for (let i = 0; i < n; i++) {
    win.length = 0;
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    for (let j = lo; j <= hi; j++) if (Number.isFinite(x[j])) win.push(x[j]);
    if (win.length < 3) continue;
    const med = median(win);
    for (let j = 0; j < win.length; j++) win[j] = Math.abs(win[j] - med);
    const mad = 1.4826 * median(win);
    if (Number.isFinite(x[i]) && Math.abs(x[i] - med) > nSigma * mad && mad > 0) {
      y[i] = med;
      replaced++;
    }
  }
  return { y, replaced };
}

export function median(values: number[]): number {
  const a = values.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
