import type { ScenarioConfig, ScenarioKey } from "@echospace/schemas";
import { perimeterSensors } from "@echospace/engine";

export interface InstructorStep {
  text: string;
  /** Optional real configuration change applied when the step is shown. */
  apply?: (c: ScenarioConfig) => ScenarioConfig;
}

const set = (f: (d: ScenarioConfig) => void) => (c: ScenarioConfig) => {
  const d = structuredClone(c);
  f(d);
  return d;
};

export const INSTRUCTOR: Partial<Record<ScenarioKey, InstructorStep[]>> = {
  A: [
    { text: "Nothing moves. Watch the confidence and observed-volume metrics: even an empty room only constrains the volume around link lines." },
    { text: "Turn on the 'Unobserved' layer (Lab → Layers). Amber points mark voxels no link constrains — they are unknown, not empty." },
    { text: "We lower SNR to 5 dB. Noise produces spurious occupancy blips; the tracker should mostly reject them (hits-to-confirm).", apply: set((d) => void (d.signal.snrDb = 5)) },
  ],
  B: [
    { text: "S1 walks along the south wall, turns, sits for 6 s, and returns. Compare the dashed ground truth with the violet track." },
    { text: "Open the Doppler spectrogram in the Studio while S1 walks: motion produces a spread of Doppler energy; it collapses when S1 sits." },
    { text: "While seated, the subject is low and still. Shadowing contrast drops and the track may be lost — that is expected behaviour." },
  ],
  C: [
    { text: "A brick partition splits the room. S1 walks behind it on the east side." },
    { text: "We raise the partition loss to 30 dB. Links crossing it lose almost all body-shadowing contrast.", apply: set((d) => d.obstacles.forEach((o) => { if (o.id === "partition") o.attenuationDb = 30; })) },
    { text: "Note the baseline-stale warning: the empty-room calibration no longer matches the scene. Recalibrate and compare." },
  ],
  D: [
    { text: "Concrete walls with |Γ| = 0.6 and a coherent back-projection model. Look for ghost energy away from the subject." },
    { text: "We remove reflections (0 surfaces). Ghosts caused by multipath should fade.", apply: set((d) => void (d.signal.reflectingSurfaces = 0)) },
    { text: "Restore 6 surfaces and switch to the RTI model, which relies on attenuation rather than phase coherence.", apply: set((d) => { d.signal.reflectingSurfaces = 6; d.recon.modelId = "rti-bayes"; }) },
  ],
  E: [
    { text: "Three subjects cross paths. Watch the identity-switch counter and event markers on the timeline." },
    { text: "We widen the association gate to 2.5 m. Fewer fragmentations, more wrong associations — check the counters.", apply: set((d) => void (d.tracking.gateM = 2.5)) },
  ],
  F: [
    { text: "Start from the baseline. Enable 'Compare with baseline' to run the unmodified scenario side by side." },
    { text: "We set 40 % packet loss.", apply: set((d) => void (d.impairments.packetLoss = 0.4)) },
    { text: "Now SNR 2 dB on top. Input quality, confidence and position error should all degrade.", apply: set((d) => void (d.signal.snrDb = 2)) },
  ],
  G: [
    { text: "Four nodes. Read the link-coverage metric and look at the unobserved overlay." },
    { text: "We move to eight nodes: coverage and error should improve.", apply: set((d) => void (d.sensors = perimeterSensors(8, d.room.width, d.room.depth))) },
  ],
  H: [
    { text: "Kalman filter on. Read jitter and lag." },
    { text: "Switch to no filter: lower lag, more jitter.", apply: set((d) => void (d.tracking.filter = "none")) },
    { text: "Exponential smoothing with α = 0.15: smooth but lagging at turns.", apply: set((d) => { d.tracking.filter = "ema"; d.tracking.emaAlpha = 0.15; }) },
  ],
  I: [{ text: "Pick a failure variant on the right. Each one must produce an explained failure state, never a fabricated reconstruction." }],
  J: [
    { text: "Coarse mode: 0.5 m voxels, no skeletons, no trails, zero track history." },
    { text: "Toggle coarse mode off to see what extra detail standard mode would reveal — and decide whether the application needs it." },
  ],
};
