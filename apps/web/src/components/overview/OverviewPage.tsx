"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FlaskConical, Maximize2, Orbit, PlayCircle } from "lucide-react";
import { SCENARIOS } from "@echospace/engine";
import { useSession } from "@/lib/store/session";
import { useFrame, useHistoryVersion } from "@/lib/engine/hooks";
import { history } from "@/lib/engine/history";
import { useUi } from "@/lib/store/ui";
import { useExperiments } from "@/lib/api/experiments";
import { SceneViewport } from "@/components/viewport/SceneViewport";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SessionMetrics } from "@/components/common/SessionMetrics";
import { SourceBadge, StateBadge } from "@/components/shell/StatusIndicators";
import { Logo } from "@/components/shell/Sidebar";
import { MiniSeries } from "@/components/charts/MiniSeries";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { duration, fmt, timeAgo } from "@/lib/format";

export function OverviewPage() {
  const s = useSession();
  const frame = useFrame(20);
  const router = useRouter();
  const setTour = useUi((x) => x.setTour);
  useHistoryVersion(2);
  const exps = useExperiments();
  const recent = history.summaries.slice(-300);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] space-y-3 p-4">
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-line bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo size={30} />
            <div>
              <h1 className="text-lg font-semibold tracking-[0.2em]">
                ECH<span className="text-signal">O</span>
              </h1>
              <p className="text-xs text-muted">Ambient RF → 3D spatial sensing research instrument</p>
            </div>
            <div className="ml-4 hidden flex-wrap items-center gap-2 text-xs md:flex">
              <span className="text-muted">Project</span>
              <span>Default</span>
              <span className="num text-2xs text-muted">{s.sessionId}</span>
              <SourceBadge mode={s.sourceMode} />
              <StateBadge state={s.status} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setTour(0)} data-testid="start-demo">
              <PlayCircle className="h-4 w-4" /> Guided demo (2 min)
            </Button>
            <Button size="lg" onClick={() => router.push("/arena")}>
              <FlaskConical className="h-4 w-4" /> Run Simulation
            </Button>
            <Button size="lg" variant="primary" onClick={() => router.push("/lab")} data-testid="launch-lab">
              <Orbit className="h-4 w-4" /> Launch Spatial Lab
            </Button>
          </div>
        </section>

        <div className="grid gap-3 xl:grid-cols-3">
          <Panel
            title={`Live preview · ${s.config.name}`}
            className="h-[480px] xl:col-span-2"
            bodyClassName="p-0"
            actions={
              <Link href="/lab" className="flex items-center gap-1 text-2xs text-muted hover:text-signal">
                <Maximize2 className="h-3 w-3" /> Open in Lab
              </Link>
            }
          >
            <SceneViewport frame={frame} config={s.config} info={s.info} variant="preview" />
          </Panel>
          <Panel title="Session inspector" className="h-[480px]" bodyClassName="space-y-3 overflow-y-auto">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Source</dt>
              <dd className="truncate">{s.sourceLabel}</dd>
              <dt className="text-muted">Engine</dt>
              <dd>Browser worker (TypeScript reference)</dd>
              <dt className="text-muted">Model</dt>
              <dd className="num">{frame ? `${frame.provenance.modelId}@${frame.provenance.modelVersion}` : s.config.recon.modelId}</dd>
              <dt className="text-muted">Preprocessing</dt>
              <dd className="num">{frame?.provenance.preprocessingVersion ?? "-"}</dd>
              <dt className="text-muted">Links</dt>
              <dd className="num">{s.info ? `${s.info.links.length} (${s.config.sensors.length} nodes)` : "-"}</dd>
              <dt className="text-muted">Grid</dt>
              <dd className="num">{s.info ? `${s.info.grid.nx}×${s.info.grid.ny}×${s.info.grid.nz} @ ${s.info.grid.voxelSizeM} m` : "-"}</dd>
              <dt className="text-muted">Config hash</dt>
              <dd className="num">{frame?.provenance.configHash ?? "-"}</dd>
              <dt className="text-muted">Stream time</dt>
              <dd className="num">{duration(s.simTime)}</dd>
            </dl>
            {frame && frame.capability.modelStatus !== "ok" && (
              <div className="rounded border border-warn/30 bg-warn/5 p-2 text-xs text-warn">{frame.capability.modelMessage}</div>
            )}
            <div>
              <div className="mb-1 flex items-center justify-between text-2xs uppercase tracking-wider text-muted">
                <span>Recent motion</span>
                <span className="normal-case tracking-normal text-faint">last {recent.length ? (recent[recent.length - 1].t - recent[0].t).toFixed(0) : 0} s</span>
              </div>
              <MiniSeries rows={recent} keys={[{ k: "activeTracks", color: "#a78bfa", label: "tracks" }, { k: "positionErrorM", color: "#f2f2f2", label: "pos. error (m, sim)" }]} height={90} />
            </div>
            <div>
              <div className="mb-1 text-2xs uppercase tracking-wider text-muted">Input quality & confidence</div>
              <MiniSeries rows={recent} keys={[{ k: "inputQuality", color: "#2dd4e6", label: "input quality" }, { k: "meanConfidence", color: "#5fbf8f", label: "confidence" }]} height={70} />
            </div>
          </Panel>
        </div>

        <Panel title="Session metrics" actions={<span className="text-2xs text-faint">hover any metric for its definition and source</span>}>
          <SessionMetrics frame={frame} columns={8} />
          {s.sourceMode === "synthetic" && <p className="mt-2 text-2xs text-faint">All values are measured live from the running synthetic session in this browser; none are pre-recorded or example numbers.</p>}
        </Panel>

        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Recent experiments" className="lg:col-span-2" actions={<Link href="/experiments" className="text-2xs text-muted hover:text-signal">All experiments →</Link>}>
            {exps.isLoading ? (
              <LoadingState />
            ) : !exps.data?.items.length ? (
              <EmptyState title="No saved experiments yet">Run a scenario and press “Save run” (S) to store a reproducible experiment.</EmptyState>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left text-2xs uppercase tracking-wider text-faint">
                  <tr>
                    <th className="py-1 font-medium">Experiment</th>
                    <th className="font-medium">Source</th>
                    <th className="font-medium">Model</th>
                    <th className="font-medium">Duration</th>
                    <th className="font-medium">Status</th>
                    <th className="font-medium">Median pos. error</th>
                    <th className="font-medium">When</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {exps.data.items.slice(0, 6).map(({ record: r }) => {
                    const pe = r.summaries.find((x) => x.id === "positionErrorM");
                    return (
                      <tr key={r.id} className="border-t border-line-soft">
                        <td className="max-w-[220px] truncate py-1.5">{r.name}</td>
                        <td><Badge tone={r.sourceMode === "synthetic" ? "signal" : "geometry"}>{r.sourceMode}</Badge></td>
                        <td className="num">{r.modelId}@{r.modelVersion}</td>
                        <td className="num">{duration(r.simulatedDurationS)}</td>
                        <td>{r.status}</td>
                        <td className="num">{pe?.median !== null && pe?.median !== undefined ? `${fmt(pe.median, 2)} m (sim)` : "N/A"}</td>
                        <td className="text-muted">{timeAgo(r.startedAt)}</td>
                        <td className="text-right">
                          <Link href={`/experiments?id=${r.id}`} className="inline-flex items-center gap-1 text-signal hover:underline">
                            Open <ArrowRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Start an experiment">
            <ul className="space-y-1">
              {SCENARIOS.slice(0, 6).map((sc) => (
                <li key={sc.key}>
                  <button
                    type="button"
                    onClick={() => {
                      s.launch(sc.build(), { scenarioKey: sc.key });
                      router.push(`/arena?s=${sc.key}`);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-panel"
                  >
                    <span className="num w-4 text-signal">{sc.key}</span>
                    <span className="flex-1 truncate">{sc.title}</span>
                    <span className="text-2xs text-faint">{sc.difficulty}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
