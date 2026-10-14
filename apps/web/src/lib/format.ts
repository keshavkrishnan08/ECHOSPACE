export const fmt = (v: number | null | undefined, digits = 2, unit = ""): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
};

export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(digits)} %`);

export function duration(s: number): string {
  if (!Number.isFinite(s)) return "N/A";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m}m ${r.toFixed(0).padStart(2, "0")}s` : `${r.toFixed(1)} s`;
}

export function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Array<Record<string, unknown>>, meta: Record<string, string> = {}): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`);
  return [...header, cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
