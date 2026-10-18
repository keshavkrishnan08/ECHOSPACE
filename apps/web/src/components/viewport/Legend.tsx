"use client";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ReconstructionFrame } from "@echospace/schemas";
import type { ColorBy, LayerState } from "@/lib/store/settings";
import { GRADIENTS } from "./colors";

const Row = ({ swatch, label }: { swatch: React.ReactNode; label: string }) => (
  <li className="flex items-center gap-2">
    <span className="flex w-6 justify-center">{swatch}</span>
    <span>{label}</span>
  </li>
);

const Dot = ({ c }: { c: string }) => <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />;
const Bar = ({ g }: { g: string }) => <span className="inline-block h-1.5 w-6 rounded-sm" style={{ background: g }} />;
const Dash = ({ c }: { c: string }) => <span className="inline-block w-6 border-t border-dashed" style={{ borderColor: c }} />;
const Solid = ({ c }: { c: string }) => <span className="inline-block w-6 border-t-2" style={{ borderColor: c }} />;

export function Legend({ layers, colorBy, frame, compact }: { layers: LayerState; colorBy: ColorBy; frame: ReconstructionFrame | null; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  return (
    <div className="absolute right-2 top-2 w-56 rounded-md border border-line bg-bg/85 text-2xs text-muted backdrop-blur-sm" data-testid="legend">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-7 w-full items-center justify-between px-2 font-semibold uppercase tracking-wider" aria-expanded={open}>
        Legend
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <ul className="space-y-1 px-2 pb-2">
          {layers.sensors && <Row swatch={<Dot c="#7fe3f0" />} label="Sensing endpoint (tx/rx)" />}
          {layers.propagation && frame?.propagation && (
            <>
              <Row swatch={<Solid c="#2dd4e6" />} label="Modelled direct path (selected link)" />
              <Row swatch={<Dash c="#5b8def" />} label="Modelled reflection" />
              <Row swatch={<Solid c="#a78bfa" />} label="Modelled body scatter" />
            </>
          )}
          {layers.signalOverlay && <Row swatch={<Solid c="#e8b04b" />} label="Link attenuation ΔRSS (opacity ∝ dB)" />}
          {layers.occupancy && <Row swatch={<Bar g={GRADIENTS.occupancy} />} label="Inferred occupancy (threshold → 1)" />}
          {layers.unobserved && <Row swatch={<Dot c="#e8b04b" />} label="Unobserved (variance ratio ≥ 0.8)" />}
          {layers.pointsFiltered && <Row swatch={<Bar g={GRADIENTS[colorBy]} />} label={`Filtered points by ${colorBy}${colorBy === "confidence" ? " (low → high)" : colorBy === "height" ? " (0 → ceiling)" : " (0 → 1.5 m/s)"}`} />}
          {layers.pointsRaw && <Row swatch={<Dot c="#7a8ba3" />} label="Raw image points (unfiltered)" />}
          {layers.surface && <Row swatch={<Dot c="#5b8def" />} label="Iso-surface of occupancy" />}
          {layers.tracks && <Row swatch={<Dot c="#a78bfa" />} label="Inferred track (solid; ? = tentative)" />}
          {layers.uncertainty && <Row swatch={<Solid c="#a78bfa" />} label="2σ position uncertainty" />}
          {layers.groundTruth && frame?.groundTruth && <Row swatch={<Dash c="#f2f2f2" />} label="Synthetic ground truth (dashed)" />}
          <li className="pt-1 text-faint">
            Skeleton:{" "}
            {frame?.capability.skeleton === "available" ? "inferred joints available" : "no model infers joints, only synthetic ground truth is drawn"}
          </li>
        </ul>
      )}
    </div>
  );
}
