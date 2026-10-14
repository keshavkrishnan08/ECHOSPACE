"use client";
import { useFrame } from "@/lib/engine/hooks";
import { useSession } from "@/lib/store/session";
import { useSettings } from "@/lib/store/settings";
import { SceneViewport } from "@/components/viewport/SceneViewport";
import { Workspace } from "@/components/common/Workspace";
import { Timeline } from "@/components/timeline/Timeline";
import { PipelineMini } from "@/components/pipeline/PipelineMini";
import { SessionMetrics } from "@/components/common/SessionMetrics";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { LoadingState } from "@/components/ui/states";
import { ScenePanel } from "./ScenePanel";
import { Inspector } from "./Inspector";

export function LabPage() {
  const hz = useSettings((s) => s.displayHz);
  const frame = useFrame(hz);
  const config = useSession((s) => s.config);
  const info = useSession((s) => s.info);
  const status = useSession((s) => s.status);
  const error = useSession((s) => s.error);
  return (
    <Workspace
      leftTitle="Scene & sensors"
      rightTitle="Inspector"
      left={<ScenePanel />}
      right={<Inspector frame={frame} />}
      center={
        <ErrorBoundary label="3D viewport">
          {status === "initializing" && !frame ? <LoadingState label="Building imaging operator and calibrating…" className="h-full" /> : <SceneViewport frame={frame} config={config} info={info} />}
          {error && <div role="alert" className="absolute left-1/2 top-3 -translate-x-1/2 rounded border border-err/40 bg-bg/90 px-3 py-1.5 text-xs text-err">{error}</div>}
        </ErrorBoundary>
      }
      bottom={
        <div className="grid h-full grid-cols-1 gap-3 overflow-y-auto p-3 xl:grid-cols-[1fr_520px]">
          <div className="space-y-3">
            <Timeline />
            <PipelineMini frame={frame} />
          </div>
          <SessionMetrics frame={frame} columns={4} />
        </div>
      }
    />
  );
}
