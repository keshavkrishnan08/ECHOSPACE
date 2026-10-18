"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/store/session";
import { useFrame } from "@/lib/engine/hooks";
import { history } from "@/lib/engine/history";
import { apiFetch, useApiHealth } from "@/lib/api/client";
import { useSettings } from "@/lib/store/settings";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DisconnectedState } from "@/components/ui/states";
import { SOFTWARE_VERSION, PREPROCESSING_VERSION } from "@echospace/schemas";

function useClientCaps() {
  const [caps, setCaps] = useState<Record<string, string>>({});
  useEffect(() => {
    const c: Record<string, string> = {};
    c["Hardware threads"] = String(navigator.hardwareConcurrency ?? "unknown");
    c["Device memory"] = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ? `${(navigator as Navigator & { deviceMemory?: number }).deviceMemory} GB (coarse)` : "not exposed";
    c["WebGPU"] = "gpu" in navigator ? "available (not used by the engine)" : "unavailable";
    c["Web Serial"] = "serial" in navigator ? "available" : "unavailable";
    c["Cross-origin isolated"] = String(globalThis.crossOriginIsolated ?? false);
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      c["WebGL2 renderer"] = gl ? (ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "available") : "unavailable";
    } catch {
      c["WebGL2 renderer"] = "unavailable";
    }
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    c["JS heap (UI thread)"] = mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)} / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MiB` : "not exposed (non-Chromium)";
    setCaps(c);
  }, []);
  return caps;
}

export function DiagnosticsPage() {
  const s = useSession();
  const frame = useFrame(4);
  const caps = useClientCaps();
  const api = useApiHealth();
  const base = useSettings((x) => x.apiBaseUrl);
  const diag = useQuery({ queryKey: ["diag", base], queryFn: () => apiFetch<Record<string, unknown>>("/api/diagnostics"), enabled: api.isSuccess, refetchInterval: 5000 });
  const errors = history.events.filter((e) => e.severity === "error").slice(-20);
  return (
    <div className="h-full overflow-y-auto p-4" data-testid="diagnostics-page">
      <h1 className="mb-3 text-base font-semibold">System diagnostics</h1>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Browser engine (worker)">
          <dl className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {([
              ["Software", SOFTWARE_VERSION],
              ["Preprocessing", PREPROCESSING_VERSION],
              ["Session", s.sessionId],
              ["State", s.status],
              ["Init (operator build)", s.info ? `${s.info.initMs.toFixed(0)} ms` : "-"],
              ["Frames received / buffered", `${history.summaries.length} / ${history.length}`],
              ["Update rate", `${s.frameRate.toFixed(1)} Hz`],
              ["Acquisition queue", frame ? `${frame.queues.acquisitionDepth} / ${frame.queues.acquisitionCapacity}` : "-"],
              ["Acquisition drops (total)", frame ? String(frame.queues.acquisitionDrops) : "-"],
              ["Engine skipped frames", frame ? String(frame.queues.framesDropped) : "-"],
              ["Display backpressure drops", String(s.displayDrops)],
              ["Max frames in flight", String(useSettings.getState().maxInFlightFrames)],
              ["Stage errors (cumulative)", frame ? String(frame.stages.reduce((a, x) => a + x.errors, 0)) : "-"],
            ] as Array<[string, string]>).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </Panel>
        <Panel title="Client capabilities">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {Object.entries(caps).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="num break-all">{v}</dd></div>)}
          </dl>
          <p className="mt-2 text-2xs text-faint">GPU utilisation is not observable from a web page; it is reported as N/A everywhere in the UI.</p>
        </Panel>
        <Panel title="Python control plane (optional)" actions={api.isSuccess ? <Badge tone="ok" dot>connected</Badge> : <Badge>offline</Badge>}>
          {!api.isSuccess ? (
            <DisconnectedState what="API">{base}/api/health is not reachable. The browser engine and local experiment storage keep working. Start it with <span className="num">uvicorn echospace_api.main:app --port 8000</span>.</DisconnectedState>
          ) : (
            <div className="space-y-2 text-xs">
              <dl className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className="text-muted">Version</dt><dd>{api.data.version}</dd>
                <dt className="text-muted">Database</dt><dd>{api.data.database}</dd>
                <dt className="text-muted">Object store</dt><dd>{api.data.objectStore}</dd>
                {Object.entries(api.data.capabilities).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{String(v)}</dd></div>)}
              </dl>
              {diag.data && <pre className="max-h-64 overflow-auto rounded border border-line bg-panel p-2 text-2xs">{JSON.stringify(diag.data, null, 2)}</pre>}
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Recent processing errors" className="mt-3">
        {errors.length === 0 ? <p className="text-xs text-faint">None in the buffered window.</p> : <ul className="space-y-0.5 text-xs text-err">{errors.map((e, i) => <li key={i}><span className="num text-faint">{e.t.toFixed(2)} s</span> {e.message}</li>)}</ul>}
        {s.error && <p className="mt-2 text-xs text-err">Last engine error: {s.error}</p>}
      </Panel>
    </div>
  );
}
