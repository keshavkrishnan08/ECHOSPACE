/** Cholesky factorisation of a symmetric positive-definite n×n matrix (row-major). Returns L. */
export function cholesky(a: Float64Array, n: number): Float64Array {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (s <= 0) throw new Error("matrix is not positive definite");
        l[i * n + i] = Math.sqrt(s);
      } else l[i * n + j] = s / l[j * n + j];
    }
  }
  return l;
}

/** Inverse of an SPD matrix via Cholesky. */
export function spdInverse(a: Float64Array, n: number): Float64Array {
  const l = cholesky(a, n);
  const inv = new Float64Array(n * n);
  const col = new Float64Array(n);
  const y = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    col.fill(0);
    col[c] = 1;
    for (let i = 0; i < n; i++) {
      let s = col[i];
      for (let k = 0; k < i; k++) s -= l[i * n + k] * y[k];
      y[i] = s / l[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= l[k * n + i] * inv[k * n + c];
      inv[i * n + c] = s / l[i * n + i];
    }
  }
  return inv;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
