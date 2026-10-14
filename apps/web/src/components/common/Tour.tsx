"use client";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { X } from "lucide-react";
import { useUi } from "@/lib/store/ui";
import { useSession } from "@/lib/store/session";
import { useSettings } from "@/lib/store/settings";
import { scenarioByKey } from "@echospace/engine";
import { Button } from "@/components/ui/button";

/**
 * "From signal to space": a six-act guided demonstration. Each act navigates to a real page and
 * performs a real action on the shared session; the annotations sit in a corner card so the
 * underlying controls stay visible and usable.
 */
export interface TourStep {
  act: string;
  title: string;
  body: string;
  path: string;
  enter?: () => void;
}

export const TOUR: TourStep[] = [
  {
    act: "Act 1 · The room",
    title: "A room, two kinds of truth",
    body: "Eight transceivers line the walls. A synthetic subject walks a scripted path — drawn as dashed white ground truth. The badge in the top bar reads SYNTHETIC SIMULATION: nothing here is a physical measurement.",
    path: "/lab",
    enter: () => {
      const s = useSession.getState();
      if (s.config.scenario !== "B" || s.sourceMode !== "synthetic") s.launch(scenarioByKey("B")!.build(), { scenarioKey: "B" });
      else if (!s.playing) s.play();
      const st = useSettings.getState();
      st.setLayer("groundTruth", true);
      st.setLayer("occupancy", false);
      st.setLayer("pointsFiltered", false);
      st.setLayer("tracks", false);
      st.setLayer("propagation", true);
    },
  },
  {
    act: "Act 2 · The measurements",
    title: "Channel state changes with motion",
    body: "These plots are computed from the simulated CSI of the selected link right now. Watch the attenuation and Doppler spectrogram respond as the subject crosses the link. The vertical cursor is the same timestamp as the 3D scene.",
    path: "/studio",
  },
  {
    act: "Act 3 · The pipeline",
    title: "Twelve inspectable stages",
    body: "Each stage reports its input and output shapes and its measured execution time (performance.now in the engine worker). Channel estimation is marked not applicable: the source already provides CSI. Click any stage to inspect it.",
    path: "/studio?tab=pipeline",
  },
  {
    act: "Act 4 · The reconstruction",
    title: "Inferred occupancy versus ground truth",
    body: "Solid blue voxels and coloured points are the RTI model's output; violet spheres are tracks with 2σ ellipses. Ground truth stays dashed. Toggle 'Unobserved' to see where the links provide no information. No model infers a skeleton, so none is drawn as an output.",
    path: "/lab",
    enter: () => {
      const st = useSettings.getState();
      st.setLayer("occupancy", true);
      st.setLayer("pointsFiltered", true);
      st.setLayer("tracks", true);
      st.setLayer("uncertainty", true);
    },
  },
  {
    act: "Act 5 · The failure",
    title: "Degrade the signal",
    body: "We have lowered SNR to 3 dB and set 40 % packet loss. Input quality drops, confidence falls and position error rises — the model is not allowed to hold on to a good answer. Try the controls yourself.",
    path: "/lab",
    enter: () => {
      const s = useSession.getState();
      s.applyConfig({ ...s.config, signal: { ...s.config.signal, snrDb: 3 }, impairments: { ...s.config.impairments, packetLoss: 0.4 } });
    },
  },
  {
    act: "Act 6 · The experiment",
    title: "Save, replay, compare",
    body: "Save this run: the seed, launch configuration, the mid-run degradation, model and preprocessing versions and the measured metrics are stored with a replay digest. Replay reproduces it frame-for-frame; the Workbench compares it with a baseline.",
    path: "/lab",
    enter: () => useUi.getState().setSave(true),
  },
];

export function TourOverlay() {
  const step = useUi((s) => s.tourStep);
  const setTour = useUi((s) => s.setTour);
  const router = useRouter();
  const path = usePathname();
  const cur = step !== null ? TOUR[step] : null;
  useEffect(() => {
    if (!cur) return;
    const target = cur.path.split("?")[0];
    if (path !== target) router.push(cur.path);
    cur.enter?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  if (!cur || step === null) return null;
  return (
    <aside aria-label="Guided demo" className="fixed bottom-4 left-1/2 z-40 w-[min(560px,92vw)] -translate-x-1/2 rounded-lg border border-signal/40 bg-panel-2/95 p-4 shadow-2xl backdrop-blur" data-testid="tour">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-signal">{cur.act}</span>
        <button type="button" onClick={() => setTour(null)} aria-label="End demo" className="text-muted hover:text-fg">
          <X className="h-4 w-4" />
        </button>
      </div>
      <h3 className="text-sm font-semibold">{cur.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">{cur.body}</p>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-1">
          {TOUR.map((_, i) => (
            <span key={i} className={`h-1 w-5 rounded-full ${i <= step ? "bg-signal" : "bg-line"}`} />
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={step === 0} onClick={() => setTour(step - 1)}>Back</Button>
          {step < TOUR.length - 1 ? (
            <Button variant="primary" onClick={() => setTour(step + 1)} data-testid="tour-next">Next</Button>
          ) : (
            <Button variant="primary" onClick={() => setTour(null)}>Finish</Button>
          )}
        </div>
      </div>
    </aside>
  );
}
