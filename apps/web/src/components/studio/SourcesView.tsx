"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { scenarioByKey } from "@echospace/engine";
import { useSession } from "@/lib/store/session";
import { importRecordingFile, exportSyntheticSample } from "@/lib/recording/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlotFrame } from "./PlotFrame";

const ADAPTERS = [
  { id: "synthetic", name: "Synthetic RF generator", status: "available", formats: "complex CSI per link/antenna/subcarrier", note: "Deterministic analytic multipath model with ground truth." },
  { id: "recorded-native", name: "Recorded dataset (echospace-csi-v1)", status: "available", formats: "JSONL complex CSI, optional geometry", note: "Imaging requires declared room + endpoint positions." },
  { id: "recorded-esp32", name: "CSI recording: ESP32-CSI-Tool CSV", status: "experimental", formats: "int8 (imag, real) pairs, 1 antenna", note: "Parser follows the published format; not validated on a physical capture here. No geometry → signal diagnostics only." },
  { id: "esp32-serial", name: "ESP32 over Web Serial (live)", status: "experimental", formats: "same CSV lines over USB serial", note: "Untested with hardware in this build. See Hardware readiness." },
  { id: "sdr", name: "SDR I/Q adapter", status: "not implemented", formats: "complex baseband I/Q", note: "Interface defined (channel estimation stage); no driver integration exists. CSI and I/Q are not interchangeable." },
];

export function SourcesView() {
  const s = useSession();
  const info = s.info;
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const d = info?.descriptor;
  const rows: Array<[string, string]> = d
    ? [
        ["Mode", d.mode],
        ["Adapter", d.adapter],
        ["Source id", d.id],
        ["Sample format", d.sampleFormat],
        ["Links / antennas", `${info.links.length} links · antennas ${[...new Set(d.antennas)].join("/")}`],
        ["Subcarriers", String(d.subcarriers)],
        ["Centre frequency", d.centerFreqHz ? `${(d.centerFreqHz / 1e9).toFixed(3)} GHz` : "unknown"],
        ["Packet rate", d.packetRateHz ? `${d.packetRateHz.toFixed(1)} Hz` : "unknown"],
        ["Geometry known", d.geometryKnown ? "yes" : "no, imaging unavailable"],
        ["Ground truth", d.hasGroundTruth ? "synthetic ground truth available" : "none"],
        ["Timestamps", d.timestampSource],
      ]
    : [];
  return (
    <div className="grid gap-3 xl:grid-cols-2" data-testid="sources-view">
      <PlotFrame title="Active source" kind={s.sourceMode === "synthetic" ? "simulated" : "measured"} units="declared by the source adapter">
        {!d ? (
          <p className="text-xs text-muted">Initializing…</p>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="num break-all">{v}</dd>
                </div>
              ))}
            </dl>
            <ul className="mt-2 space-y-1 text-2xs text-faint">{d.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
            {s.error && <p className="mt-2 text-xs text-err">Connection/processing error: {s.error}</p>}
          </>
        )}
      </PlotFrame>
      <PlotFrame title="Import a recording" kind="measured" units="echospace-csi-v1 (.jsonl) or ESP32-CSI-Tool (.csv)">
        <div className="space-y-2 text-xs">
          <p className="text-muted">Recorded data replaces the synthetic source entirely: no ground truth, no synthetic substitution. If the file declares sensor geometry, the imaging pipeline runs; otherwise only signal diagnostics are available.</p>
          <input ref={fileRef} type="file" accept=".jsonl,.json,.csv,.txt" className="hidden" data-testid="recording-input" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const r = await importRecordingFile(f);
              setMsg({ tone: "ok", text: `Loaded ${r.packets.length} packets across ${r.descriptor.links.length} link(s).${r.warnings.length ? ` ${r.warnings.length} warning(s): ${r.warnings[0]}` : ""}` });
            } catch (err) {
              setMsg({ tone: "err", text: err instanceof Error ? err.message : String(err) });
            }
            e.target.value = "";
          }} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => fileRef.current?.click()}><FileUp className="h-3.5 w-3.5" /> Choose file…</Button>
            <Button onClick={() => exportSyntheticSample(3)} disabled={s.sourceMode !== "synthetic"}>Export 3 s synthetic sample (.jsonl)</Button>
            {s.sourceMode !== "synthetic" && <Button onClick={() => s.launch(scenarioByKey("B")!.build(), { scenarioKey: "B" })}>Back to synthetic demo</Button>}
          </div>
          {msg && <p className={msg.tone === "ok" ? "text-ok" : "text-err"} role="status">{msg.text}</p>}
          <p className="text-2xs text-faint">The exported sample is labelled "synthetic origin" in its header and will be shown as such after import.</p>
        </div>
      </PlotFrame>
      <PlotFrame title="Source adapters" kind="derived" units="capability matrix" note="Many consumer routers expose neither CSI nor I/Q. Specific chipsets, firmware or SDRs are required; compatibility must be verified per device.">
        <table className="w-full text-xs">
          <thead className="text-left text-2xs uppercase tracking-wider text-faint"><tr><th className="py-1 font-medium">Adapter</th><th className="font-medium">Status</th><th className="font-medium">Data</th></tr></thead>
          <tbody>
            {ADAPTERS.map((a) => (
              <tr key={a.id} className="border-t border-line-soft align-top">
                <td className="py-1.5 pr-2"><div>{a.name}</div><div className="text-2xs text-faint">{a.note}</div></td>
                <td className="pr-2"><Badge tone={a.status === "available" ? "ok" : a.status === "experimental" ? "warn" : "neutral"}>{a.status}</Badge>{info?.descriptor.adapter === a.id && <Badge tone="signal" className="ml-1">active</Badge>}</td>
                <td className="text-2xs text-muted">{a.formats}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link href="/hardware" className="mt-2 inline-block text-xs text-signal hover:underline">Hardware readiness & live connection →</Link>
      </PlotFrame>
    </div>
  );
}
