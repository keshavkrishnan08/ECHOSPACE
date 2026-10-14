export function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function boxPolygon(a: [number, number], b: [number, number]): Array<[number, number]> {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** 2σ ellipse for a 2×2 covariance [xx, xy, yy]. */
export function covarianceEllipse(cov: [number, number, number], sigmas = 2, n = 48): Array<[number, number]> {
  const [a, b, c] = cov;
  const tr = a + c;
  const det = a * c - b * b;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = Math.max(1e-9, tr / 2 + disc);
  const l2 = Math.max(1e-9, tr / 2 - disc);
  const theta = Math.abs(b) < 1e-12 ? (a >= c ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
  const r1 = sigmas * Math.sqrt(l1);
  const r2 = sigmas * Math.sqrt(l2);
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const x = r1 * Math.cos(t);
    const y = r2 * Math.sin(t);
    out.push([x * Math.cos(theta) - y * Math.sin(theta), x * Math.sin(theta) + y * Math.cos(theta)]);
  }
  return out;
}
