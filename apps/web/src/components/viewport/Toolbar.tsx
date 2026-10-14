"use client";
import { Box, Camera, Download, Lasso, MousePointer2, Move3d, Ruler, Scan } from "lucide-react";
import { useSettings } from "@/lib/store/settings";
import { useUi } from "@/lib/store/ui";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";

export type Tool = "orbit" | "select" | "box" | "lasso" | "measure";

export function ViewportToolbar({ tool, setTool, isolate, setIsolate, hasRegion, onExportPly }: { tool: Tool; setTool: (t: Tool) => void; isolate: boolean; setIsolate: (v: boolean) => void; hasRegion: boolean; onExportPly: () => void }) {
  const view = useUi((s) => s.view);
  const ortho = useSettings((s) => s.orthographic);
  const set = useSettings((s) => s.set);
  const tools: Array<{ t: Tool; icon: React.ReactNode; label: string }> = [
    { t: "orbit", icon: <Move3d className="h-3.5 w-3.5" />, label: "Orbit / pan / zoom" },
    { t: "select", icon: <MousePointer2 className="h-3.5 w-3.5" />, label: "Select point, voxel, track, sensor or object" },
    { t: "box", icon: <Box className="h-3.5 w-3.5" />, label: "Box-select a floor region" },
    { t: "lasso", icon: <Lasso className="h-3.5 w-3.5" />, label: "Lasso-select a floor region" },
    { t: "measure", icon: <Ruler className="h-3.5 w-3.5" />, label: "Measure distance (two clicks on the floor plane)" },
  ];
  return (
    <div className="absolute left-2 top-2 flex flex-col gap-1.5" role="toolbar" aria-label="Viewport tools">
      <div className="flex gap-0.5 rounded-md border border-line bg-bg/85 p-0.5">
        {tools.map((x) => (
          <Tip key={x.t} content={x.label} side="bottom">
            <Button size="iconSm" variant={tool === x.t ? "active" : "ghost"} onClick={() => setTool(x.t)} aria-label={x.label} aria-pressed={tool === x.t} data-testid={`tool-${x.t}`}>
              {x.icon}
            </Button>
          </Tip>
        ))}
      </div>
      <div className="flex gap-0.5 rounded-md border border-line bg-bg/85 p-0.5 text-2xs">
        {(["iso", "top", "front", "side"] as const).map((p) => (
          <Button key={p} size="sm" variant="ghost" onClick={() => view({ kind: "camera", preset: p })} className="h-5 px-1.5 capitalize">
            {p}
          </Button>
        ))}
        <Button size="sm" variant={ortho ? "active" : "ghost"} className="h-5 px-1.5" onClick={() => set("orthographic", !ortho)} aria-pressed={ortho}>
          {ortho ? "Ortho" : "Persp"}
        </Button>
        <Tip content="Reset view" side="bottom">
          <Button size="iconSm" variant="ghost" className="h-5 w-5" onClick={() => view({ kind: "camera", preset: "reset" })} aria-label="Reset view">
            <Scan className="h-3 w-3" />
          </Button>
        </Tip>
      </div>
      <div className="flex gap-0.5 rounded-md border border-line bg-bg/85 p-0.5">
        <Tip content="Screenshot (PNG)" side="bottom">
          <Button size="iconSm" variant="ghost" onClick={() => view({ kind: "screenshot" })} aria-label="Screenshot">
            <Camera className="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <Tip content="Export scene + current frame (JSON)" side="bottom">
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-2xs" onClick={() => view({ kind: "export-scene" })}>
            JSON
          </Button>
        </Tip>
        <Tip content="Export filtered point cloud (PLY with provenance header)" side="bottom">
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-2xs" onClick={onExportPly} data-testid="export-ply">
            <Download className="h-3 w-3" /> PLY
          </Button>
        </Tip>
        {hasRegion && (
          <Button size="sm" variant={isolate ? "active" : "ghost"} className="h-6 px-1.5 text-2xs" onClick={() => setIsolate(!isolate)} aria-pressed={isolate}>
            Isolate region
          </Button>
        )}
      </div>
    </div>
  );
}
