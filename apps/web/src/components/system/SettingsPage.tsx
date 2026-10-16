"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/store/settings";
import { localExperiments } from "@/lib/store/experiments";
import { useUi } from "@/lib/store/ui";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { SliderField, Toggle } from "@/components/ui/controls";

export function SettingsPage() {
  const st = useSettings();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const [url, setUrl] = useState(st.apiBaseUrl);
  return (
    <div className="h-full overflow-y-auto p-4" data-testid="settings-page">
      <h1 className="mb-3 text-base font-semibold">Settings</h1>
      <div className="grid max-w-5xl gap-3 lg:grid-cols-2">
        <Panel title="Engine & streaming">
          <div className="space-y-3 text-xs">
            <SliderField label="Max frames in flight (display backpressure)" min={1} max={8} step={1} value={st.maxInFlightFrames} onChange={(v) => st.set("maxInFlightFrames", v)} help="Unacknowledged frame batches allowed between the engine worker and the UI before the worker drops frames. Applies on the next launch." />
            <SliderField label="Timeline history" unit="s" min={10} max={300} step={10} value={st.historySeconds} onChange={(v) => st.set("historySeconds", v)} help="Full frames kept in memory for scrubbing. Applies on the next launch." />
            <SliderField label="Viewport display rate" unit="Hz" min={2} max={60} step={1} value={st.displayHz} onChange={(v) => st.set("displayHz", v)} />
          </div>
        </Panel>
        <Panel title="Python API">
          <div className="space-y-2 text-xs">
            <label className="block space-y-1">
              <span className="text-muted">Base URL</span>
              <input className="num h-8 w-full rounded border border-line bg-panel px-2" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <Button onClick={() => { st.set("apiBaseUrl", url.replace(/\/$/, "")); void qc.invalidateQueries(); toast("API URL saved", "ok"); }}>Save</Button>
            <p className="text-2xs text-faint">The API is optional. Without it, sessions run in the browser and experiments are stored in IndexedDB.</p>
          </div>
        </Panel>
        <Panel title="Privacy & retention">
          <div className="space-y-2.5 text-xs">
            <Toggle label="Allow raw hardware recordings (opt-in)" checked={st.recordingsOptIn} onChange={(v) => st.set("recordingsOptIn", v)} />
            <p className="text-2xs text-muted">ECHO never performs identity recognition. Track identifiers are random per session. Raw signals are not logged; frames live in memory for the configured timeline window only.</p>
            <Button variant="danger" onClick={async () => { const all = await localExperiments.list(); await Promise.all(all.map((e) => localExperiments.remove(e.id))); await qc.invalidateQueries({ queryKey: ["experiments"] }); toast(`Deleted ${all.length} local experiments`, "ok"); }}>Delete all experiments stored in this browser</Button>
          </div>
        </Panel>
        <Panel title="Interface">
          <div className="space-y-2.5 text-xs">
            <Toggle label="Collapse navigation" checked={st.navCollapsed} onChange={(v) => st.set("navCollapsed", v)} />
            <Toggle label="Orthographic camera" checked={st.orthographic} onChange={(v) => st.set("orthographic", v)} />
            <Button onClick={() => { st.reset(); toast("Settings reset to defaults", "ok"); }}>Reset all settings</Button>
            <p className="text-2xs text-faint">Panel sizes, layers and display options persist in this browser (localStorage).</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
