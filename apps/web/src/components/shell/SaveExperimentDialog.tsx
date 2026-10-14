"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { buildExperiment, saveExperiment } from "@/lib/store/experiments";
import { history } from "@/lib/engine/history";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function SaveExperimentDialog() {
  const open = useUi((s) => s.saveOpen);
  const setOpen = useUi((s) => s.setSave);
  const toast = useUi((s) => s.toast);
  const s = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const defaultName = `${s.config.name} · seed ${s.config.seed}`;
  const frames = history.summaries.length;

  const save = async () => {
    setBusy(true);
    try {
      const rec = await buildExperiment(name.trim() || defaultName, notes, [s.scenarioKey, ...(s.variantId ? [s.variantId] : [])]);
      const r = await saveExperiment(rec);
      await qc.invalidateQueries({ queryKey: ["experiments"] });
      toast(r.api ? `Saved ${rec.id} (browser + API)` : `Saved ${rec.id} to browser storage. API not reachable.`, r.api ? "ok" : "warn");
      setOpen(false);
      setName("");
      setNotes("");
      router.push(`/experiments?id=${rec.id}`);
    } catch (e) {
      toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} title="Save run as experiment" description="Stores the launch configuration, seed, mid-run changes, model and preprocessing versions, measured metric series and a replay digest.">
      <div className="space-y-3 text-xs">
        <label className="block space-y-1">
          <span className="text-muted">Name</span>
          <input data-testid="experiment-name" className="h-8 w-full rounded border border-line bg-panel px-2 text-fg" placeholder={defaultName} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-muted">Notes</span>
          <textarea className="h-20 w-full rounded border border-line bg-panel p-2 text-fg" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-line-soft bg-panel/50 p-2">
          <dt className="text-muted">Source</dt><dd className="num">{s.sourceMode}</dd>
          <dt className="text-muted">Scenario / seed</dt><dd className="num">{s.config.scenario} / {s.config.seed}</dd>
          <dt className="text-muted">Model</dt><dd className="num">{s.config.recon.modelId}</dd>
          <dt className="text-muted">Frames recorded</dt><dd className="num">{frames}</dd>
          <dt className="text-muted">Mid-run changes</dt><dd className="num">{s.configChanges.length}</dd>
        </dl>
        <p className="text-2xs text-faint">A deterministic digest of the first 40 frames is computed from the launch configuration and recorded changes (unpaced, no backpressure) so replays can be verified independently of machine load.</p>
        {s.replayDigestClean === false && <p className="text-warn">Real-time backpressure dropped packets or skipped frames early in this live run, so the live frames will not match a replay exactly. The stored digest still verifies the configuration.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || frames === 0} data-testid="confirm-save">{busy ? "Saving…" : "Save experiment"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
