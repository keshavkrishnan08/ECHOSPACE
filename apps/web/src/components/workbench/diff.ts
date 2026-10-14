/** Leaf-level differences between two JSON-like values, as dotted paths. */
export function diffPaths(a: unknown, b: unknown, path = ""): Array<{ path: string; a: unknown; b: unknown }> {
  if (Object.is(a, b)) return [];
  const isObj = (x: unknown) => x !== null && typeof x === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [{ path: path || "(root)", a, b }];
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return [{ path: `${path}.length`, a: a.length, b: b.length }, ...diffPaths(a.slice(0, Math.min(a.length, b.length)), b.slice(0, Math.min(a.length, b.length)), path)];
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  const out: Array<{ path: string; a: unknown; b: unknown }> = [];
  for (const k of keys) out.push(...diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  return out;
}

export const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? "—" : s.length > 60 ? `${s.slice(0, 57)}…` : s;
};
