/** Hand-drawn technical diagrams for the showcase (SVG, sized by viewBox). */

const C = { line: "#33425a", text: "#edf3fc", muted: "#8b9ab0", signal: "#2dd4e6", geometry: "#5b8def", track: "#a78bfa", ok: "#5fbf8f", warn: "#e8b04b", panel: "#141c2a", surface: "#0e1420" };

function Box({ x, y, w, h, title, sub, color = C.line }: { x: number; y: number; w: number; h: number; title: string; sub?: string; color?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={C.panel} stroke={color} strokeWidth={1.2} />
      <text x={x + 12} y={y + 22} fill={C.text} fontSize={13} fontWeight={600}>{title}</text>
      {sub && sub.split("\n").map((l, i) => <text key={i} x={x + 12} y={y + 40 + i * 15} fill={C.muted} fontSize={11}>{l}</text>)}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, label, color = C.muted }: { x1: number; y1: number; x2: number; y2: number; label?: string; color?: string }) {
  const id = `a${x1}${y1}${x2}${y2}`;
  return (
    <g>
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.3} markerEnd={`url(#${id})`} />
      {label && <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2 - 6} fill={C.muted} fontSize={10.5}>{label}</text>}
    </g>
  );
}

export function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 960 470" className="h-auto w-full" role="img" aria-label="System architecture">
      <rect x={10} y={10} width={600} height={300} rx={10} fill={C.surface} stroke={C.line} strokeDasharray="4 4" />
      <text x={26} y={34} fill={C.signal} fontSize={12} fontWeight={600} letterSpacing={1.5}>BROWSER</text>
      <Box x={30} y={50} w={250} h={100} title="Next.js UI" sub={"Lab, Arena, Studio, Workbench\nZustand session + frame history\nR3F viewport, ECharts, Recharts"} color={C.geometry} />
      <Box x={340} y={50} w={250} h={100} title="Engine worker" sub={"simulator → DSP → RTI → tracker\nbounded queues, stage timers\ntransferable frames + ack"} color={C.signal} />
      <Box x={340} y={190} w={250} h={100} title="Helper workers" sub={"comparison (lockstep)\noffline ablations, benchmark\ndeterministic replay digest"} color={C.track} />
      <Box x={30} y={190} w={250} h={100} title="Local storage" sub={"IndexedDB experiments\npersisted panels and layers\nno raw signal logging"} />
      <Arrow x1={280} y1={92} x2={338} y2={92} label="config" />
      <Arrow x1={338} y1={118} x2={282} y2={118} label="frames" color={C.signal} />
      <Arrow x1={155} y1={150} x2={155} y2={188} />
      <Arrow x1={465} y1={150} x2={465} y2={188} />
      <rect x={640} y={10} width={310} height={300} rx={10} fill={C.surface} stroke={C.line} strokeDasharray="4 4" />
      <text x={656} y={34} fill={C.ok} fontSize={12} fontWeight={600} letterSpacing={1.5}>OPTIONAL SERVICES</text>
      <Box x={660} y={50} w={270} h={100} title="FastAPI control plane" sub={"sessions, experiments, models\nrecordings with consent\nWebSocket stream, request ids"} color={C.ok} />
      <Box x={660} y={190} w={270} h={100} title="Python reference engine" sub={"NumPy / SciPy port\nbit-for-bit parity fixtures\nridge model training"} color={C.ok} />
      <Arrow x1={590} y1={80} x2={658} y2={80} label="REST / WS" />
      <Arrow x1={795} y1={150} x2={795} y2={188} />
      <Box x={30} y={350} w={260} h={100} title="C++20 DSP library" sub={"FFT, sanitization, RTI apply\nback-projection, SPSC ring\nctypes bindings, benchmarks"} color={C.warn} />
      <Box x={340} y={350} w={260} h={100} title="CUDA kernels" sub={"optional, off by default\nnot compiled or run here\nCPU path is the fallback"} />
      <Box x={660} y={350} w={270} h={100} title="Storage" sub={"PostgreSQL or SQLite metadata\nS3 / MinIO or local artifacts\nAlembic migrations"} />
      <Arrow x1={795} y1={290} x2={795} y2={348} />
      <Arrow x1={290} y1={400} x2={338} y2={400} />
    </svg>
  );
}

const STAGES = ["Validate", "Align", "Buffer", "Estimate", "Preprocess", "Filter", "Features", "Spatial", "Inference", "Reconstruct", "Associate", "Serialize"];

export function PipelineDiagram() {
  return (
    <svg viewBox="0 0 960 200" className="h-auto w-full" role="img" aria-label="Twelve stage processing pipeline">
      {STAGES.map((s, i) => {
        const x = 10 + i * 79;
        const na = s === "Estimate";
        const color = i < 7 ? C.signal : i < 9 ? C.geometry : C.track;
        return (
          <g key={s}>
            <rect x={x} y={60} width={70} height={56} rx={5} fill={C.panel} stroke={na ? C.line : color} strokeDasharray={na ? "3 3" : undefined} />
            <text x={x + 35} y={84} textAnchor="middle" fill={na ? C.muted : C.text} fontSize={10.5} fontWeight={600}>{s}</text>
            <text x={x + 35} y={102} textAnchor="middle" fill={C.muted} fontSize={9.5}>{String(i + 1).padStart(2, "0")}</text>
            {i < STAGES.length - 1 && <line x1={x + 70} y1={88} x2={x + 79} y2={88} stroke={C.muted} />}
          </g>
        );
      })}
      <text x={10} y={40} fill={C.signal} fontSize={11} letterSpacing={1}>SIGNAL CONDITIONING (CSI → link features)</text>
      <text x={563} y={40} fill={C.geometry} fontSize={11} letterSpacing={1}>IMAGING</text>
      <text x={721} y={40} fill={C.track} fontSize={11} letterSpacing={1}>RECONSTRUCTION + TRACKING</text>
      <text x={10} y={150} fill={C.muted} fontSize={11}>Each stage reports input and output shape, dtype, measured duration, queue delay, drops and errors.</text>
      <text x={10} y={170} fill={C.muted} fontSize={11}>Estimate is dashed: CSI sources already provide channel estimates, so the stage is marked not applicable.</text>
    </svg>
  );
}

export function ReproDiagram() {
  return (
    <svg viewBox="0 0 960 230" className="h-auto w-full" role="img" aria-label="Reproducibility flow">
      <Box x={10} y={20} w={190} h={80} title="Launch config" sub={"scenario, seed, sensors\nmodel + preprocessing ver."} color={C.signal} />
      <Box x={10} y={130} w={190} h={80} title="Mid-run changes" sub={"recorded at the frame\nindex where they applied"} color={C.signal} />
      <Box x={270} y={70} w={200} h={90} title="Engine" sub={"same seed, same inputs\nchanges at frame boundaries\nno UI timing dependence"} color={C.geometry} />
      <Box x={540} y={20} w={190} h={80} title="Live run" sub={"may drop under load\n(bounded queues)"} color={C.warn} />
      <Box x={540} y={130} w={190} h={80} title="Unpaced replay" sub={"first 40 frames\nSHA-256 digest"} color={C.ok} />
      <Box x={790} y={70} w={160} h={90} title="Experiment" sub={"digest + metrics\nreplay verifies\nmatch or mismatch"} color={C.track} />
      <Arrow x1={200} y1={60} x2={268} y2={100} />
      <Arrow x1={200} y1={170} x2={268} y2={130} />
      <Arrow x1={470} y1={100} x2={538} y2={60} />
      <Arrow x1={470} y1={130} x2={538} y2={170} />
      <Arrow x1={730} y1={60} x2={788} y2={100} label="metrics" />
      <Arrow x1={730} y1={170} x2={788} y2={130} label="digest" />
    </svg>
  );
}
