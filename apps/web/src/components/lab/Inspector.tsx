"use client";
import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import { MATERIAL_PENETRATION_DB, MATERIAL_REFLECTIVITY } from "@echospace/schemas";
import { useSession } from "@/lib/store/session";
import { history } from "@/lib/engine/history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { fmt, pct } from "@/lib/format";
import { pointInPolygon } from "@/components/viewport/geometry";
import { useConfigEditor } from "@/lib/store/useConfigEditor";
import { SelectField, SliderField } from "@/components/ui/controls";

const KV = ({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) => (
  <>
    <dt className="text-muted">{k}</dt>
    <dd className={mono ? "num truncate" : "truncate"}>{v}</dd>
  </>
);

function Block({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-b border-line-soft px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between text-2xs font-semibold uppercase tracking-[0.08em] text-muted">
        {title}
        {right}
      </div>
      {children}
    </div>
  );
}

function voxelState(p: number, vr: number) {
  if (vr > 0.95) return { label: "Unobserved", tone: "warn" as const, note: "No link constrains this voxel. Its value is the prior, not evidence of emptiness." };
  if (p >= 0.6) return { label: "Occupied", tone: "signal" as const, note: "Detection confidence above the occupancy threshold." };
  if (p <= 0.1 && vr < 0.8) return { label: "Confidently empty", tone: "ok" as const, note: "Constrained by links and no attenuation evidence." };
  return { label: "Uncertain", tone: "neutral" as const, note: "Weakly constrained or ambiguous evidence." };
}

export function contributingLinks(cfg: ScenarioConfig, center: [number, number, number]) {
  const byId = new Map(cfg.sensors.map((s) => [s.id, s.position]));
  const out: Array<{ id: string; excess: number }> = [];
  for (const a of cfg.sensors) for (const b of cfg.sensors) {
    if (a.id >= b.id || !a.enabled || !b.enabled) continue;
    const pa = byId.get(a.id)!;
    const pb = byId.get(b.id)!;
    const L = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    const d = Math.hypot(center[0] - pa[0], center[1] - pa[1], center[2] - pa[2]) + Math.hypot(center[0] - pb[0], center[1] - pb[1], center[2] - pb[2]);
    if (d - L < cfg.recon.ellipseExcessM) out.push({ id: `${a.id}>${b.id}`, excess: d - L });
  }
  return out;
}

export function Inspector({ frame }: { frame: ReconstructionFrame | null }) {
  const sel = useSession((s) => s.selection);
  const select = useSession((s) => s.select);
  const cfg = useSession((s) => s.config);
  const info = useSession((s) => s.info);
  if (!frame) return <div className="p-3 text-xs text-muted">Waiting for the first frame…</div>;
  const g = frame.grid;
  const sx = cfg.room.width / g.nx;
  const sy = cfg.room.depth / g.ny;
  const sz = cfg.room.height / g.nz;
  const synthetic = frame.provenance.sourceMode === "synthetic";

  let detail: React.ReactNode = null;
  if (sel.kind === "point") {
    const f = sel.seq === frame.seq ? frame : history.bySeq(sel.seq) ?? frame;
    const arr = sel.set === "raw" ? f.pointsRaw : f.pointsFiltered;
    const i = sel.index;
    if (i * 5 + 4 < arr.length) {
      const [x, y, z, conf, occ] = [arr[i * 5], arr[i * 5 + 1], arr[i * 5 + 2], arr[i * 5 + 3], arr[i * 5 + 4]];
      const near = f.tracks.filter((t) => t.confirmed).find((t) => Math.hypot(t.position[0] - x, t.position[1] - y) < 0.6);
      detail = (
        <Block title={`Point #${i} (${sel.set})`} right={<Button size="sm" variant="ghost" onClick={() => select({ kind: "none" })}>Clear</Button>}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <KV k="x, y, z" v={`${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)} m`} />
            <KV k="Confidence" v={sel.set === "raw" ? "N/A (raw)" : conf.toFixed(3)} />
            <KV k={sel.set === "raw" ? "Normalized image" : "Occupancy"} v={occ.toFixed(3)} />
            <KV k="Timestamp" v={`${f.timestampS.toFixed(3)} s`} />
            <KV k="Source frame" v={f.seq} />
            <KV k="Model output" v={`${f.provenance.modelId}@${f.provenance.modelVersion}`} />
            <KV k="Velocity" v={near ? `${Math.hypot(near.velocity[0], near.velocity[1]).toFixed(2)} m/s (track ${near.id})` : "N/A — no confirmed track within 0.6 m"} />
            <KV k="Provenance" v={`derived · ${f.provenance.sourceMode}${synthetic ? " (simulated input)" : ""}`} mono={false} />
          </dl>
          <p className="mt-1.5 text-2xs text-faint">Points are sampled uniformly inside voxels whose value passes the thresholds; their exact position within a voxel carries no information.</p>
        </Block>
      );
    }
  } else if (sel.kind === "voxel") {
    const f = sel.seq === frame.seq ? frame : history.bySeq(sel.seq) ?? frame;
    const i = sel.index;
    const ix = i % g.nx;
    const iy = Math.floor(i / g.nx) % g.ny;
    const iz = Math.floor(i / (g.nx * g.ny));
    const center: [number, number, number] = [(ix + 0.5) * sx, (iy + 0.5) * sy, (iz + 0.5) * sz];
    const st = voxelState(f.occupancy[i], f.varianceRatio[i]);
    const contrib = contributingLinks(cfg, center);
    detail = (
      <Block title={`Voxel (${ix}, ${iy}, ${iz})`} right={<Button size="sm" variant="ghost" onClick={() => select({ kind: "none" })}>Clear</Button>}>
        <div className="mb-1.5"><Badge tone={st.tone}>{st.label}</Badge></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <KV k="Centre" v={center.map((v) => v.toFixed(2)).join(", ") + " m"} />
          <KV k="Occupancy score" v={f.occupancy[i].toFixed(4)} />
          <KV k="Variance ratio" v={f.varianceRatio[i].toFixed(4)} />
          <KV k="Confidence" v={(1 - f.varianceRatio[i]).toFixed(4)} />
          <KV k="Image value" v={f.image[i].toFixed(4)} />
          <KV k="Timestamp" v={`${f.timestampS.toFixed(3)} s (frame ${f.seq})`} />
          {f.groundTruthOccupancy && <KV k="Ground truth" v={f.groundTruthOccupancy[i] ? "occupied (synthetic)" : "empty (synthetic)"} />}
        </dl>
        <p className="mt-1.5 text-2xs text-muted">{st.note}</p>
        <div className="mt-2 text-2xs uppercase tracking-wider text-muted">Contributing observations ({contrib.length} links)</div>
        <ul className="num mt-1 max-h-32 space-y-0.5 overflow-y-auto text-2xs">
          {contrib.length === 0 && <li className="text-faint">none — outside every link ellipsoid (λ_e = {cfg.recon.ellipseExcessM} m)</li>}
          {contrib.map((c) => {
            const li = info?.links.find((l) => l.id === c.id || l.id === c.id.split(">").reverse().join(">"));
            const d = li ? f.features.deltaRssDb[li.index] : Number.NaN;
            return (
              <li key={c.id} className="flex justify-between">
                <span>{c.id}</span>
                <span className="text-muted">excess {c.excess.toFixed(2)} m · ΔRSS {Number.isFinite(d) ? d.toFixed(2) : "N/A"} dB</span>
              </li>
            );
          })}
        </ul>
      </Block>
    );
  } else if (sel.kind === "region") {
    const poly = sel.polygon;
    const statsFor = (arr: Float32Array) => {
      let n = 0;
      const bins = new Array(10).fill(0);
      let sc = 0;
      for (let i = 0; i < arr.length / 5; i++) {
        if (!pointInPolygon(arr[i * 5], arr[i * 5 + 1], poly)) continue;
        n++;
        sc += arr[i * 5 + 3];
        bins[Math.min(9, Math.floor(arr[i * 5 + 3] * 10))]++;
      }
      return { n, meanConf: n ? sc / n : null, bins };
    };
    let area = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    area = Math.abs(area / 2);
    const filt = statsFor(frame.pointsFiltered);
    const raw = statsFor(frame.pointsRaw);
    let vox = 0;
    let occ = 0;
    let unobs = 0;
    for (let i = 0; i < frame.occupancy.length; i++) {
      const cx = ((i % g.nx) + 0.5) * sx;
      const cy = ((Math.floor(i / g.nx) % g.ny) + 0.5) * sy;
      if (!pointInPolygon(cx, cy, poly)) continue;
      vox++;
      if (frame.occupancy[i] >= cfg.recon.occupancyThreshold) occ++;
      if (frame.varianceRatio[i] > 0.95) unobs++;
    }
    const maxBin = Math.max(1, ...filt.bins);
    detail = (
      <Block title={`Region (${sel.mode})`} right={<Button size="sm" variant="ghost" onClick={() => select({ kind: "none" })}>Clear</Button>}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <KV k="Area" v={`${area.toFixed(2)} m²`} />
          <KV k="Filtered points" v={`${filt.n} (${(filt.n / Math.max(area, 1e-6)).toFixed(1)} /m²)`} />
          <KV k="Raw points" v={`${raw.n} (${(raw.n / Math.max(area, 1e-6)).toFixed(1)} /m²)`} />
          <KV k="Mean confidence" v={fmt(filt.meanConf, 3)} />
          <KV k="Voxels in column" v={vox} />
          <KV k="Occupied voxels" v={occ} />
          <KV k="Unobserved voxels" v={`${unobs} (${pct(vox ? unobs / vox : null)})`} />
        </dl>
        <div className="mt-2 text-2xs uppercase tracking-wider text-muted">Confidence distribution (filtered)</div>
        <div className="mt-1 flex h-12 items-end gap-0.5" role="img" aria-label="Confidence histogram">
          {filt.bins.map((b, i) => (
            <div key={i} className="flex-1 rounded-t-sm bg-ok/70" style={{ height: `${(b / maxBin) * 100}%` }} title={`${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${b}`} />
          ))}
        </div>
        <div className="num flex justify-between text-[9px] text-faint"><span>0</span><span>1</span></div>
      </Block>
    );
  } else if (sel.kind === "track") {
    const t = frame.tracks.find((x) => x.id === sel.id);
    const gt = frame.groundTruth;
    const nearest = t && gt?.length ? gt.reduce((a, b) => (Math.hypot(a.position[0] - t.position[0], a.position[1] - t.position[1]) < Math.hypot(b.position[0] - t.position[0], b.position[1] - t.position[1]) ? a : b)) : null;
    const events = history.events.filter((e) => e.message.includes(sel.id)).slice(-6);
    detail = (
      <Block title={`Track ${sel.id}`} right={<Button size="sm" variant="ghost" onClick={() => select({ kind: "none" })}>Clear</Button>}>
        {!t ? (
          <p className="text-xs text-muted">Not present at this frame (terminated or not yet born).</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <KV k="Status" v={t.confirmed ? "confirmed" : "tentative"} />
            <KV k="Position" v={`${t.position[0].toFixed(2)}, ${t.position[1].toFixed(2)}, ${t.position[2].toFixed(2)} m`} />
            <KV k="Velocity" v={`${Math.hypot(t.velocity[0], t.velocity[1]).toFixed(2)} m/s`} />
            <KV k="σx, σy" v={`${Math.sqrt(t.covariance[0]).toFixed(2)}, ${Math.sqrt(t.covariance[2]).toFixed(2)} m`} />
            <KV k="Age / hits / misses" v={`${t.ageFrames} / ${t.hits} / ${t.misses}`} />
            <KV k="Confidence" v={t.confidence.toFixed(2)} />
            {nearest && <KV k="Nearest GT (sim)" v={`${nearest.label} at ${Math.hypot(nearest.position[0] - t.position[0], nearest.position[1] - t.position[1]).toFixed(2)} m`} />}
          </dl>
        )}
        <div className="mt-2 text-2xs uppercase tracking-wider text-muted">Lifecycle events</div>
        <ul className="mt-1 space-y-0.5 text-2xs">
          {events.length === 0 && <li className="text-faint">none in buffer</li>}
          {events.map((e, i) => (
            <li key={i}><span className="num text-faint">{e.t.toFixed(2)} s</span> {e.message}</li>
          ))}
        </ul>
        <p className="mt-1.5 text-2xs text-faint">Track identifiers are random, ephemeral and session-scoped. They do not identify people.</p>
      </Block>
    );
  } else if (sel.kind === "sensor" || sel.kind === "obstacle" || sel.kind === "wall") {
    detail = <EditableSelection />;
  }

  const ok = frame.capability.modelStatus === "ok";
  return (
    <div className="text-xs" data-testid="inspector">
      {detail}
      <Block title="Reconstruction" right={<Badge tone={ok ? "ok" : frame.capability.modelStatus === "degraded" ? "warn" : "err"}>{frame.capability.modelStatus}</Badge>}>
        {frame.capability.modelMessage && <p className={`mb-2 text-2xs ${ok ? "text-muted" : "text-warn"}`}>{frame.capability.modelMessage}</p>}
        <div className="grid grid-cols-2 gap-1.5">
          <Metric id="meanConfidence" value={frame.metrics.meanConfidence.toFixed(3)} />
          <Metric id="observedFraction" value={pct(frame.metrics.observedFraction)} />
          <Metric id="positionErrorM" value={fmt(frame.metrics.positionErrorM, 2, "m")} />
          <Metric id="floorIou" value={fmt(frame.metrics.floorIou, 2)} />
          <Metric id="recall" value={fmt(frame.metrics.recall, 2)} />
          <Metric id="precision" value={fmt(frame.metrics.precision, 2)} />
          <Metric id="chamferM" value={fmt(frame.metrics.chamferM, 2, "m")} />
          <Metric id="idSwitchesTotal" value={String(frame.metrics.idSwitchesTotal)} />
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs">
          <KV k="Points raw / filtered" v={`${frame.pointsRaw.length / 5} / ${frame.pointsFiltered.length / 5}`} />
          <KV k="Detections" v={frame.detections.length} />
          <KV k="Model" v={`${frame.provenance.modelId}@${frame.provenance.modelVersion}`} />
          <KV k="Preprocessing" v={frame.provenance.preprocessingVersion} />
        </dl>
        {!synthetic && <p className="mt-1 text-2xs text-faint">No ground truth for this source: simulation metrics show N/A.</p>}
      </Block>
      <Block title={`Tracks (${frame.tracks.length})`}>
        {frame.tracks.length === 0 ? (
          <p className="text-faint">No tracks.</p>
        ) : (
          <ul className="space-y-0.5">
            {frame.tracks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => select({ kind: "track", id: t.id })} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-panel">
                  <span className={`h-2 w-2 rounded-full ${t.confirmed ? "bg-track" : "bg-track/40"}`} />
                  <span className="num">{t.id}</span>
                  <span className="num ml-auto text-muted">{t.position[0].toFixed(1)}, {t.position[1].toFixed(1)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Skeleton keypoints">
        <Badge tone="warn">Unsupported by active model</Badge>
        <p className="mt-1.5 text-2xs text-muted">{frame.capability.reason}</p>
        <p className="mt-1 text-2xs text-faint">Schema when supported: COCO-17 joints (nose … right ankle), metres, with per-joint confidence.</p>
      </Block>
      {(frame.warnings.length > 0) && (
        <Block title="Warnings">
          <ul className="space-y-1 text-2xs text-warn">
            {frame.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Block>
      )}
    </div>
  );
}

function EditableSelection() {
  const sel = useSession((s) => s.selection);
  const select = useSession((s) => s.select);
  const { draft: c, patch } = useConfigEditor();
  if (sel.kind === "sensor") {
    const i = c.sensors.findIndex((s) => s.id === sel.id);
    const s = c.sensors[i];
    if (!s) return null;
    return (
      <Block title={`Sensor ${s.id}`} right={<Button size="sm" variant="ghost" onClick={() => select({ kind: "none" })}>Clear</Button>}>
        <div className="space-y-2">
          <SliderField label="x" unit="m" min={0} max={c.room.width} step={0.05} value={s.position[0]} onChange={(v) => patch((d) => void (d.sensors[i].position[0] = v))} />
          <SliderField label="y" unit="m" min={0} max={c.room.depth} step={0.05} value={s.position[1]} onChange={(v) => patch((d) => void (d.sensors[i].position[1] = v))} />
          <SliderField label="Height" unit="m" min={0.1} max={c.room.height} step={0.05} value={s.position[2]} onChange={(v) => patch((d) => void (d.sensors[i].position[2] = v))} />
          <SliderField label="Yaw" unit="°" min={-180} max={180} step={5} value={s.yawDeg} onChange={(v) => patch((d) => void (d.sensors[i].yawDeg = v))} />
          <p className="text-2xs text-faint">Moving a sensor rebuilds the imaging operator and recalibrates.</p>
        </div>
      </Block>
    );
  }
  if (sel.kind === "obstacle") {
    const i = c.obstacles.findIndex((o) => o.id === sel.id);
    const o = c.obstacles[i];
    if (!o) return null;
    return (
      <Block title={`Obstacle ${o.id}`} right={<Button size="sm" variant="ghost" onClick={() => select({ kind: "none" })}>Clear</Button>}>
        <div className="space-y-2">
          <SelectField label="Material" value={o.material} options={Object.keys(MATERIAL_PENETRATION_DB).map((m) => ({ value: m, label: `${m} (${MATERIAL_PENETRATION_DB[m as keyof typeof MATERIAL_PENETRATION_DB]} dB)` }))} onChange={(v) => patch((d) => void (d.obstacles[i].material = v as typeof o.material))} />
          <SliderField label="Attenuation override" unit="dB" min={0} max={40} step={1} value={o.attenuationDb ?? 0} format={(v) => (o.attenuationDb === null ? "material default" : `${v} dB`)} onChange={(v) => patch((d) => void (d.obstacles[i].attenuationDb = v > 0 ? v : null))} />
          <dl className="num grid grid-cols-[auto_1fr] gap-x-3 text-2xs">
            <KV k="Size" v={`${(o.max[0] - o.min[0]).toFixed(2)} × ${(o.max[1] - o.min[1]).toFixed(2)} × ${(o.max[2] - o.min[2]).toFixed(2)} m`} />
          </dl>
          <Button size="sm" variant="danger" onClick={() => { patch((d) => void d.obstacles.splice(i, 1)); select({ kind: "none" }); }}>Remove obstacle</Button>
        </div>
      </Block>
    );
  }
  if (sel.kind === "wall") {
    return (
      <Block title={`Wall · ${sel.name}`} right={<Button size="sm" variant="ghost" onClick={() => select({ kind: "none" })}>Clear</Button>}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <KV k="Material" v={c.room.wallMaterial} />
          <KV k="Thickness" v={`${c.room.wallThickness} m`} />
          <KV k="Reflectivity |Γ|" v={(c.room.wallReflectivity ?? MATERIAL_REFLECTIVITY[c.room.wallMaterial]).toFixed(2)} />
        </dl>
        <p className="mt-1.5 text-2xs text-faint">Walls bound the simulation; they reflect (first order, image method) but exterior propagation is not modelled. All four walls share one material in this model.</p>
      </Block>
    );
  }
  return null;
}
