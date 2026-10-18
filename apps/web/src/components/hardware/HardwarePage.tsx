"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, CircleAlert, Cable, CircleStop, Disc } from "lucide-react";
import { SOFTWARE_VERSION } from "@echospace/schemas";
import { scenarioByKey } from "@echospace/engine";
import { Esp32SerialAdapter, serialSupported } from "@/lib/hardware/esp32Serial";
import { useSession } from "@/lib/store/session";
import { useSettings } from "@/lib/store/settings";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectField, Toggle } from "@/components/ui/controls";
import { downloadBlob, fmt } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";

type Check = { label: string; state: "pass" | "fail" | "pending" | "warn"; detail: string };

function CheckRow({ c }: { c: Check }) {
  const icon = c.state === "pass" ? <CheckCircle2 className="h-4 w-4 text-ok" /> : c.state === "fail" ? <CircleAlert className="h-4 w-4 text-err" /> : c.state === "warn" ? <CircleAlert className="h-4 w-4 text-warn" /> : <Circle className="h-4 w-4 text-faint" />;
  return (
    <li className="flex items-start gap-2 border-b border-line-soft py-1.5 text-xs">
      {icon}
      <div><div>{c.label}</div><div className="text-2xs text-muted">{c.detail}</div></div>
    </li>
  );
}

export function HardwarePage() {
  const [, force] = useState(0);
  const adapter = useRef<Esp32SerialAdapter | null>(null);
  const [baud, setBaud] = useState("921600");
  const [authorized, setAuthorized] = useState(false);
  const [consent, setConsent] = useState(false);
  const [notes, setNotes] = useState("");
  const [recStart, setRecStart] = useState<number | null>(null);
  const [storage, setStorage] = useState<{ quota: number; usage: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const optIn = useSettings((s) => s.recordingsOptIn);
  const setSetting = useSettings((s) => s.set);
  const session = useSession();
  const st = adapter.current?.stats;
  const hydrated = useHydrated();
  const serialOk = hydrated && serialSupported();
  const secure = hydrated && window.isSecureContext;

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setStorage({ quota: e.quota ?? 0, usage: e.usage ?? 0 }));
    return () => {
      void adapter.current?.disconnect();
    };
  }, []);

  const connect = async () => {
    setError(null);
    try {
      adapter.current = new Esp32SerialAdapter(() => force((x) => x + 1));
      await adapter.current.connect(Number(baud));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const fresh = st?.lastRowAtMs ? Date.now() - st.lastRowAtMs < 2000 : false;
  const checks: Check[] = [
    { label: "Browser supports Web Serial", state: !hydrated ? "pending" : serialOk ? "pass" : "fail", detail: serialOk ? "navigator.serial is available." : "Use a Chromium-based desktop browser; Firefox and Safari do not implement Web Serial." },
    { label: "Secure context", state: !hydrated ? "pending" : secure ? "pass" : "fail", detail: "Web Serial requires https:// or localhost." },
    { label: "Operator authorisation and consent recorded", state: authorized && consent ? "pass" : "pending", detail: "Required before connecting. Covert deployment is not supported." },
    { label: "Device connected", state: st?.connected ? "pass" : "pending", detail: st?.connected ? `USB ${JSON.stringify(adapter.current?.deviceInfo ?? {})}` : "Not connected." },
    { label: "Firmware emits CSI_DATA rows", state: !st?.connected ? "pending" : st.csiRows > 0 ? "pass" : st.lines > 50 ? "fail" : "pending", detail: st ? `${st.csiRows} CSI rows of ${st.lines} lines; ${st.malformed} malformed` : "-" },
    { label: "Stable subcarrier count", state: st?.subcarriers ? "pass" : "pending", detail: st?.subcarriers ? `${st.subcarriers} subcarriers; rows with other counts are rejected` : "-" },
    { label: "Monotonic device timestamps", state: !st?.csiRows ? "pending" : st.nonMonotonic === 0 ? "pass" : "warn", detail: st ? `${st.nonMonotonic} non-monotonic timestamps` : "-" },
    { label: "Packet rate ≥ 20 Hz", state: st?.ratesHz === null || st?.ratesHz === undefined ? "pending" : st.ratesHz >= 20 ? "pass" : "warn", detail: st?.ratesHz ? `${st.ratesHz.toFixed(1)} rows/s over the last 2 s` : "-" },
    { label: "Single transmitter link", state: !st?.csiRows ? "pending" : st.ignoredMacs ? "warn" : "pass", detail: st?.mac ? `using ${st.mac}; ${st.ignoredMacs} rows from other MACs ignored` : "-" },
    { label: "Sensor geometry declared", state: "warn", detail: "This adapter has no geometry: spatial imaging is unavailable. Signal Studio diagnostics work." },
    { label: "Multi-antenna phase coherence", state: "warn", detail: "ESP32 reports one antenna: inter-antenna phase features are unavailable." },
  ];

  const est = st?.csiRows ? (st.bytes / Math.max(1, st.lines)) * (st.ratesHz ?? 0) : null;
  const recDur = recStart ? (Date.now() - recStart) / 1000 : 0;
  const manifest = () => ({
    kind: "echospace.recording-manifest",
    version: 1,
    software: SOFTWARE_VERSION,
    createdAt: new Date().toISOString(),
    source: { adapter: "esp32-serial (experimental)", mac: st?.mac, channel: st?.channel, subcarriers: st?.subcarriers, baudRate: Number(baud), device: adapter.current?.deviceInfo },
    durationS: recDur,
    rows: adapter.current?.recording?.length ?? 0,
    consent: consent ? "obtained" : "unknown",
    authorizedOperator: authorized,
    notes,
    quality: { malformed: st?.malformed, nonMonotonicTimestamps: st?.nonMonotonic, ignoredMacs: st?.ignoredMacs, meanRateHz: st?.ratesHz },
    retention: "raw lines are held in browser memory only until exported or discarded",
    format: "ESP32-CSI-Tool CSV rows (CSI_DATA,…); import via Signal Studio → Sources",
  });

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="hardware-page">
      <div className="mb-3">
        <h1 className="text-base font-semibold">Hardware readiness</h1>
        <p className="max-w-3xl text-xs text-muted">The platform runs fully without hardware. This page tests a physical CSI source and is kept separate from the synthetic simulation. No router or SDR is assumed compatible until the checklist passes on that device.</p>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Connection · ESP32-CSI-Tool over Web Serial" actions={<Badge tone="warn">experimental · unverified on hardware</Badge>}>
          <div className="space-y-2.5 text-xs">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-muted">Adapter</dt><dd>esp32-serial</dd>
              <dt className="text-muted">Status</dt><dd>{st?.connected ? <Badge tone="ok" dot>connected</Badge> : <Badge>disconnected</Badge>}</dd>
              <dt className="text-muted">Supported format</dt><dd>CSI_DATA rows, int8 (imag, real) pairs, 1 antenna</dd>
              <dt className="text-muted">Device</dt><dd className="num">{st?.connected ? JSON.stringify(adapter.current?.deviceInfo) : "-"}</dd>
              <dt className="text-muted">Channel</dt><dd className="num">{st?.channel ?? "-"}</dd>
              <dt className="text-muted">Data health</dt><dd className="num">{st ? `${st.csiRows} rows · ${st.malformed} malformed · ${fmt(st.ratesHz, 1, "Hz")}` : "-"}</dd>
              <dt className="text-muted">Last sample</dt><dd className="num">{st?.lastRowAtMs ? `${((Date.now() - st.lastRowAtMs) / 1000).toFixed(1)} s ago${fresh ? "" : " (stale)"}` : "never"}</dd>
              <dt className="text-muted">Timestamp quality</dt><dd className="num">{st?.csiRows ? (st.nonMonotonic ? `${st.nonMonotonic} non-monotonic` : "monotonic") : "-"}</dd>
            </dl>
            <SelectField label="Baud rate" value={baud} options={["115200", "230400", "460800", "921600", "1152000"].map((b) => ({ value: b, label: b }))} onChange={setBaud} disabled={st?.connected} />
            <Toggle label="I am authorised to operate this sensor here" checked={authorized} onChange={setAuthorized} />
            <Toggle label="People in the sensing area have been informed and consented" checked={consent} onChange={setConsent} />
            <div className="flex gap-2">
              {!st?.connected ? (
                <Button variant="primary" disabled={!serialOk || !authorized || !consent} onClick={connect} data-testid="serial-connect"><Cable className="h-3.5 w-3.5" /> Select device & connect</Button>
              ) : (
                <Button variant="danger" onClick={() => adapter.current?.disconnect()}>Disconnect</Button>
              )}
              {session.sourceMode === "hardware" && <Button onClick={() => { void adapter.current?.disconnect(); session.launch(scenarioByKey("B")!.build(), { scenarioKey: "B" }); }}>Return to synthetic</Button>}
            </div>
            {(error || st?.error) && <p className="text-err" role="alert">Connection error: {error ?? st?.error}</p>}
            <p className="text-2xs text-faint">While connected, the top bar shows PHYSICAL HARDWARE. Track identifiers stay ephemeral and nothing is stored unless you start a recording below.</p>
          </div>
        </Panel>
        <Panel title="Compatibility checklist">
          <ul data-testid="hardware-checklist">{checks.map((c) => <CheckRow key={c.label} c={c} />)}</ul>
        </Panel>
        <Panel title="Recording session">
          <div className="space-y-2.5 text-xs">
            <Toggle label="Allow raw-data recording (opt-in, off by default)" checked={optIn} onChange={(v) => setSetting("recordingsOptIn", v)} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-muted">Source status</dt><dd>{st?.connected ? "connected" : "no live source"}</dd>
              <dt className="text-muted">Duration</dt><dd className="num">{recStart ? `${recDur.toFixed(0)} s` : "-"}</dd>
              <dt className="text-muted">Data volume (est.)</dt><dd className="num">{est ? `${(est / 1024).toFixed(1)} KiB/s ≈ ${((est * 3600) / 1048576).toFixed(0)} MiB/h` : "unknown until data arrives"}</dd>
              <dt className="text-muted">Recorded</dt><dd className="num">{adapter.current?.recording ? `${adapter.current.recording.length} rows, ${(adapter.current.recordingBytes / 1048576).toFixed(2)} MiB (cap 50 MiB)` : "not recording"}</dd>
              <dt className="text-muted">Browser storage</dt><dd className="num">{storage ? `${(storage.usage / 1048576).toFixed(1)} MiB used of ${(storage.quota / 1073741824).toFixed(1)} GiB quota` : "unavailable"}</dd>
              <dt className="text-muted">Consent</dt><dd>{consent ? "obtained (operator-attested)" : "not recorded"}</dd>
            </dl>
            <textarea className="h-16 w-full rounded border border-line bg-panel p-2 text-xs" placeholder="Session notes (room, placement, purpose)…" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Session notes" />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!st?.connected || !optIn || !consent || !!adapter.current?.recording} onClick={() => { if (adapter.current) { adapter.current.recording = []; adapter.current.recordingBytes = 0; setRecStart(Date.now()); } }}><Disc className="h-3.5 w-3.5 text-err" /> Start recording</Button>
              <Button disabled={!adapter.current?.recording} onClick={() => {
                const a = adapter.current!;
                const rows = a.recording ?? [];
                const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                downloadBlob(`esp32_recording_${stamp}.csv`, rows.join("\n") + "\n", "text/csv");
                downloadBlob(`esp32_recording_${stamp}.manifest.json`, JSON.stringify(manifest(), null, 2), "application/json");
                a.recording = null;
                a.recordingBytes = 0;
                setRecStart(null);
              }}><CircleStop className="h-3.5 w-3.5" /> Stop & export</Button>
              <Button variant="danger" disabled={!adapter.current?.recording} onClick={() => { if (adapter.current) { adapter.current.recording = null; adapter.current.recordingBytes = 0; setRecStart(null); } }}>Discard</Button>
            </div>
            <p className="text-2xs text-faint">Quality checks recorded in the manifest: malformed rows, non-monotonic timestamps, ignored transmitters, mean rate. Uploading to the API (POST /api/recordings) requires the consent flag; deleting there removes the stored object.</p>
          </div>
        </Panel>
      </div>
      <Panel title="SDR (I/Q) adapter" className="mt-3">
        <p className="text-xs text-muted">Not implemented. An SDR produces complex baseband I/Q samples, which need synchronisation and least-squares channel estimation (pipeline stage 4) before they are comparable to CSI. The adapter interface (<span className="num">PacketSource</span> in packages/engine/src/runtime/source.ts) is in place; no driver integration exists and no SDR is claimed compatible.</p>
      </Panel>
    </div>
  );
}
