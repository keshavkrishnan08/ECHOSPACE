/** Copy and code excerpts for the showcase. Excerpts are trimmed from the real source files named. */

export const PURPOSE = {
  lead: "ECHOSPACE asks a simple question. How much can the radio waves already filling a room tell us about where people are, without a single camera?",
  sections: [
    {
      title: "Why it exists",
      body: [
        "Wi-Fi signals bounce off walls, furniture and people. When someone walks across a room, the signal between two radios changes in ways that can be measured. Research has shown this can reveal presence and position, but most demos hide how fragile the result is.",
        "ECHOSPACE is a workstation for studying that problem honestly. It shows every step from raw channel measurements to a 3D estimate, and it shows where the estimate is unsure or simply wrong.",
      ],
    },
    {
      title: "How it is designed",
      body: [
        "One engine sits at the centre. A simulator creates repeatable channel measurements, a signal pipeline cleans them, a reconstruction model turns them into a picture of the room, and a tracker follows people over time. The same engine powers every screen, so what you see in the 3D lab, the signal studio and the experiment reports always agrees.",
        "The engine runs inside the browser so the demo needs no special hardware. A matching Python version and a native C++ library check its numbers, and a server can store experiments when one is available.",
      ],
    },
    {
      title: "What it refuses to do",
      body: [
        "It never presents simulated data as a real measurement. Every screen shows whether the source is synthetic, recorded or live hardware.",
        "It never fills in what it cannot see. Regions that no radio link observes are marked unknown, models without trained weights refuse to run, and a person skeleton is only drawn when it comes from the simulator's ground truth.",
        "It never claims a speed or accuracy it has not measured. Timings come from the running code, and accuracy numbers are labelled as simulation results.",
      ],
    },
    {
      title: "Who it is for",
      body: [
        "Researchers who want to compare methods on the same input. Engineers who need to trace an output back to its configuration and timestamp. Anyone curious about radio sensing who wants to see both what works and where it breaks.",
      ],
    },
    {
      title: "Privacy by default",
      body: [
        "Track labels are random and short lived. Nothing identifies a person. Raw recording is off until an operator turns it on, live capture needs stated authorisation and consent, and a coarse mode shows only where a room is occupied.",
      ],
    },
  ],
};

export const CODE: Array<{ title: string; file: string; note: string; code: string }> = [
  {
    title: "Deterministic random streams",
    file: "packages/engine/src/sim/rng.ts",
    note: "Every random draw comes from a seeded 32-bit generator. The Python reference uses the same integer arithmetic, so both engines produce identical noise for a seed.",
    code: `nextU32(): number {
  const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (this.s1 << 9) >>> 0;
  this.s2 = (this.s2 ^ this.s0) >>> 0;
  this.s3 = (this.s3 ^ this.s1) >>> 0;
  this.s1 = (this.s1 ^ this.s2) >>> 0;
  this.s0 = (this.s0 ^ this.s3) >>> 0;
  this.s2 = (this.s2 ^ t) >>> 0;
  this.s3 = rotl(this.s3, 11);
  return result;
}`,
  },
  {
    title: "Posterior in the dual form",
    file: "packages/engine/src/recon/rti.ts",
    note: "The imaging operator is solved with an L by L system (one row per link) instead of a voxel by voxel one, which also yields the variance used to mark regions as unobserved.",
    code: `// Π = C Wᵀ (W C Wᵀ + σn² I)⁻¹ solved as an L×L system, not V×V
const Ainv = spdInverse(A, n);
for (let i = 0; i < this.V; i++) {
  let reduction = 0;
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (let a = 0; a < n; a++) s += this.cwT[i * this.L + active[a]] * Ainv[a * n + b];
    pi[i * n + b] = s;
    reduction += s * this.cwT[i * this.L + active[b]];
  }
  varRatio[i] = (this.priorVar - reduction) / this.priorVar; // 1 = unobserved
}`,
  },
  {
    title: "Bounded queues everywhere",
    file: "packages/engine/src/dsp/queue.ts",
    note: "Queues between stages never grow. When full they drop by policy and count the drop, so overload shows up as a number instead of a frozen tab.",
    code: `push(item: T): boolean {
  this.pushed++;
  if (this.size === this.capacity) {
    this.drops++;
    if (this.policy === "drop-newest") return false;
    this.head = (this.head + 1) % this.capacity;
    this.size--;
  }
  this.buf[(this.head + this.size) % this.capacity] = item;
  this.size++;
  return true;
}`,
  },
  {
    title: "Changes that replay exactly",
    file: "packages/engine/src/runtime/engine.ts",
    note: "A mid-run change takes effect at a frame boundary and the source resumes after the last processed frame, so a run is fully described by its launch settings and the frame of each change.",
    code: `reconfigure(next: ScenarioConfig): number {
  const frameSeq = this.framesProduced;
  const resumeT = this.nextFrameT - 1 / prev.dsp.frameRateHz;
  if (channelKey(prev) !== channelKey(next)) {
    const src = new SyntheticSource(next);
    src.seek(resumeT + 1e-9);
    this.source = src;
    this.queue.clear();
    this.simTime = Math.max(0, resumeT);
  }
  ...
  return frameSeq;
}`,
  },
  {
    title: "Failing out loud",
    file: "packages/engine/src/runtime/pipeline.ts",
    note: "Before a model runs, the pipeline checks that the observations can support it. If not, it produces an explained failure and no output.",
    code: `} else if (finiteLinks < 3 && modelId !== "bp-dsb") {
  modelStatus = "unsupported";
  modelMessage = \`Insufficient observations: \${finiteLinks} usable link(s); \` +
    "attenuation imaging needs at least 3 links with crossing geometry.";
} else if (modelId === "transformer-encoder") {
  modelStatus = "unsupported";
  modelMessage = "registered interface slot without trained weights";
}`,
  },
];
