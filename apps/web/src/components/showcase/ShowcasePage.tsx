"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { ArchitectureDiagram, PipelineDiagram, ReproDiagram } from "./Diagrams";
import { CODE, PURPOSE } from "./content";

const VIDEOS = [
  { id: "demo-1", title: "From signal to space", blurb: "The guided demo end to end: the room, the measurements, the pipeline, the reconstruction, a deliberate failure and a verified replay." },
  { id: "demo-2", title: "Arena and workbench", blurb: "Occlusion, multipath, crossing people, the failure lab, baseline comparison, ablations, model cards and hardware readiness." },
];

interface Cue {
  start: number;
  text: string;
}

function parseVtt(src: string): Cue[] {
  const toS = (t: string) => {
    const [h, m, s] = t.split(":");
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  };
  const out: Cue[] = [];
  const blocks = src.split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    out.push({ start: toS(lines[i].split("-->")[0].trim()), text: lines.slice(i + 1).join(" ") });
  }
  return out;
}

function VideoCard({ id, title, blurb }: { id: string; title: string; blurb: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const cues = useQuery({ queryKey: ["vtt", id], queryFn: async () => { const r = await fetch(`/showcase/${id}.vtt`); return r.ok ? parseVtt(await r.text()) : []; } });
  const active = (cues.data ?? []).filter((c) => c.start <= now).at(-1);
  return (
    <section className="grid gap-4 rounded-md border border-line bg-surface p-4 xl:grid-cols-[1fr_340px]" data-testid={`video-${id}`}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mb-3 mt-0.5 max-w-3xl text-xs text-muted">{blurb}</p>
        <video ref={ref} controls preload="metadata" className="aspect-[16/10] w-full rounded border border-line bg-bg" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}>
          <source src={`/showcase/${id}.mp4`} type="video/mp4" />
          <track kind="subtitles" src={`/showcase/${id}.vtt`} srcLang="en" label="English" default />
        </video>
      </div>
      <div className="min-w-0">
        <div className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted">Subtitles · click to jump</div>
        <ol className="max-h-[440px] space-y-1 overflow-y-auto pr-1">
          {(cues.data ?? []).map((c, i) => (
            <li key={i}>
              <button type="button" onClick={() => { if (ref.current) { ref.current.currentTime = c.start + 0.05; void ref.current.play(); } }} className={`grid w-full grid-cols-[44px_1fr] gap-2 rounded px-2 py-1.5 text-left text-xs ${active === c ? "bg-signal/10 text-fg" : "text-muted hover:bg-panel"}`}>
                <span className="num text-faint">{Math.floor(c.start / 60)}:{String(Math.floor(c.start % 60)).padStart(2, "0")}</span>
                <span>{c.text}</span>
              </button>
            </li>
          ))}
          {cues.data && !cues.data.length && <li className="text-xs text-faint">No subtitle file found. Run scripts/showcase/record.mjs.</li>}
        </ol>
      </div>
    </section>
  );
}

function Gallery() {
  const shots = useQuery({ queryKey: ["gallery"], queryFn: async () => { const r = await fetch("/showcase/gallery.json"); return r.ok ? ((await r.json()) as Array<{ file: string; title: string; caption: string; group: string }>) : []; } });
  const [open, setOpen] = useState<number | null>(null);
  const list = shots.data ?? [];
  const groups = [...new Set(list.map((s) => s.group))];
  return (
    <div className="space-y-6">
      {!list.length && <EmptyState title="No screenshots yet">Run scripts/showcase/capture.mjs against a running app.</EmptyState>}
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-2xs font-semibold uppercase tracking-[0.1em] text-muted">{g}</h2>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {list.map((s, i) => s.group !== g ? null : (
              <figure key={s.file} className="overflow-hidden rounded-md border border-line bg-surface">
                <button type="button" onClick={() => setOpen(i)} className="block w-full" aria-label={`Enlarge ${s.title}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/showcase/${s.file}`} alt={s.title} className="aspect-[5/3] w-full object-cover object-top" loading="lazy" />
                </button>
                <figcaption className="p-3">
                  <div className="text-xs font-semibold">{s.title}</div>
                  <p className="mt-0.5 text-xs text-muted">{s.caption}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h2 className="mb-2 text-2xs font-semibold uppercase tracking-[0.1em] text-muted">Technical design</h2>
        <div className="space-y-3">
          {[{ t: "System architecture", d: <ArchitectureDiagram /> }, { t: "Processing pipeline", d: <PipelineDiagram /> }, { t: "How a run is reproduced", d: <ReproDiagram /> }].map((x) => (
            <figure key={x.t} className="rounded-md border border-line bg-surface p-4">
              <figcaption className="mb-2 text-xs font-semibold">{x.t}</figcaption>
              <div className="overflow-x-auto">{x.d}</div>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-2xs font-semibold uppercase tracking-[0.1em] text-muted">Code components</h2>
        <div className="grid gap-3 xl:grid-cols-2">
          {CODE.map((c) => (
            <figure key={c.title} className="min-w-0 rounded-md border border-line bg-surface p-4">
              <figcaption>
                <div className="text-xs font-semibold">{c.title}</div>
                <div className="num text-2xs text-signal">{c.file}</div>
                <p className="mt-1 text-xs text-muted">{c.note}</p>
              </figcaption>
              <pre className="num mt-3 overflow-x-auto rounded border border-line-soft bg-bg p-3 text-[11.5px] leading-relaxed text-fg">{c.code}</pre>
            </figure>
          ))}
        </div>
      </section>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title={open !== null ? list[open]?.title ?? "" : ""} description={open !== null ? list[open]?.caption : undefined} wide>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {open !== null && <img src={`/showcase/${list[open].file}`} alt={list[open].title} className="w-full rounded border border-line" />}
      </Dialog>
    </div>
  );
}

function Purpose() {
  return (
    <article className="mx-auto max-w-2xl py-4" data-testid="purpose">
      <p className="text-lg leading-relaxed text-fg">{PURPOSE.lead}</p>
      {PURPOSE.sections.map((s) => (
        <section key={s.title} className="mt-8">
          <h2 className="text-sm font-semibold text-signal">{s.title}</h2>
          {s.body.map((p, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-muted">{p}</p>)}
        </section>
      ))}
    </article>
  );
}

const TABS = [
  { value: "demo", label: "Demo" },
  { value: "gallery", label: "Gallery" },
  { value: "purpose", label: "Purpose" },
];

export function ShowcasePage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") ?? "demo";
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <h1 className="text-sm font-semibold">Showcase</h1>
        <Tabs.Root value={tab} onValueChange={(t) => router.replace(`/showcase?tab=${t}`, { scroll: false })}>
          <Tabs.List className="flex gap-0.5 rounded-md border border-line bg-panel p-0.5" aria-label="Showcase sections">
            {TABS.map((t) => <Tabs.Trigger key={t.value} value={t.value} className="rounded px-3 py-1 text-xs text-muted data-[state=active]:bg-signal/15 data-[state=active]:text-signal" data-testid={`showcase-tab-${t.value}`}>{t.label}</Tabs.Trigger>)}
          </Tabs.List>
        </Tabs.Root>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "demo" && <div className="space-y-4">{VIDEOS.map((v) => <VideoCard key={v.id} {...v} />)}</div>}
        {tab === "gallery" && <Gallery />}
        {tab === "purpose" && <Purpose />}
      </div>
    </div>
  );
}
