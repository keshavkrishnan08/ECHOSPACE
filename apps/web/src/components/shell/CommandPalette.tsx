"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { SCENARIOS } from "@echospace/engine";
import { useSession } from "@/lib/store/session";
import { useSettings, type LayerState } from "@/lib/store/settings";
import { useUi } from "@/lib/store/ui";
import { Dialog } from "@/components/ui/dialog";
import { NAV, SECONDARY } from "./nav";

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const router = useRouter();
  const session = useSession();
  const settings = useSettings();
  const ui = useUi();
  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  const layerCmds: Array<[keyof LayerState, string]> = [
    ["pointsFiltered", "filtered point cloud"], ["pointsRaw", "raw point cloud"], ["occupancy", "occupancy voxels"], ["unobserved", "unobserved region overlay"],
    ["groundTruth", "ground truth"], ["groundTruthSkeleton", "ground-truth skeleton"], ["tracks", "tracks"], ["propagation", "propagation paths"], ["links", "link lines"],
  ];
  const item = "flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-xs text-fg data-[selected=true]:bg-signal/15";
  const group = "px-1 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint";
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Command palette" description="Navigate, control the session, launch scenarios and toggle layers.">
      <Command label="Command palette" className="text-xs">
        <Command.Input autoFocus placeholder="Type a command…" className="mb-2 h-8 w-full rounded border border-line bg-panel px-2 text-xs text-fg outline-none placeholder:text-faint focus:border-signal/60" />
        <Command.List className="max-h-[50vh] overflow-y-auto">
          <Command.Empty className="p-3 text-muted">No matching command.</Command.Empty>
          <Command.Group heading="Session" className={group}>
            <Command.Item className={item} onSelect={run(session.togglePlay)}>{session.playing ? "Pause" : "Play"} stream</Command.Item>
            <Command.Item className={item} onSelect={run(() => session.step(1))}>Step one frame</Command.Item>
            <Command.Item className={item} onSelect={run(session.restart)}>Restart scenario (same seed)</Command.Item>
            <Command.Item className={item} onSelect={run(session.goLive)}>Return to live</Command.Item>
            <Command.Item className={item} onSelect={run(session.recalibrate)}>Recalibrate empty-room baseline</Command.Item>
            <Command.Item className={item} onSelect={run(() => ui.setSave(true))}>Save run as experiment…</Command.Item>
            <Command.Item className={item} onSelect={run(() => router.push("/demo"))}>Start guided demo “From signal to space”</Command.Item>
          </Command.Group>
          <Command.Group heading="Navigate" className={group}>
            {[...NAV, ...SECONDARY].map((n) => (
              <Command.Item key={n.href} className={item} onSelect={run(() => router.push(n.href))}>
                <n.icon className="h-3.5 w-3.5 text-muted" /> {n.label}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Launch scenario" className={group}>
            {SCENARIOS.map((sc) => (
              <Command.Item key={sc.key} value={`scenario ${sc.key} ${sc.title}`} className={item} onSelect={run(() => { session.launch(sc.build(), { scenarioKey: sc.key }); router.push(`/arena?s=${sc.key}`); })}>
                <span className="num w-4 text-signal">{sc.key}</span> {sc.title}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="View" className={group}>
            {(["iso", "top", "front", "side", "reset"] as const).map((p) => (
              <Command.Item key={p} className={item} onSelect={run(() => ui.view({ kind: "camera", preset: p }))}>Camera: {p}</Command.Item>
            ))}
            <Command.Item className={item} onSelect={run(() => settings.set("orthographic", !settings.orthographic))}>Toggle orthographic / perspective</Command.Item>
            <Command.Item className={item} onSelect={run(() => ui.view({ kind: "screenshot" }))}>Screenshot viewport (PNG)</Command.Item>
            {layerCmds.map(([k, label]) => (
              <Command.Item key={k} className={item} onSelect={run(() => settings.setLayer(k, !settings.layers[k]))}>
                {settings.layers[k] ? "Hide" : "Show"} {label}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Privacy" className={group}>
            <Command.Item className={item} onSelect={run(() => {
              const c = session.config;
              const coarse = c.privacy.mode !== "coarse";
              session.applyConfig({ ...c, privacy: { mode: coarse ? "coarse" : "standard", showSkeleton: !coarse, trackHistorySeconds: coarse ? 0 : 10 } });
            })}>
              {session.config.privacy.mode === "coarse" ? "Disable" : "Enable"} coarse privacy mode
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </Dialog>
  );
}
