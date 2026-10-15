"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { ArchitectureDiagram } from "./Diagrams";
import { PURPOSE } from "./content";

const VIDEOS = [
  { id: "demo-1", title: "One person", blurb: "A simulated person walks, sits and moves behind a wall while the system follows them from Wi-Fi signals alone." },
  { id: "demo-2", title: "Harder situations", blurb: "Two and three people, a weak signal, an empty room and too few sensors, including where it fails." },
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
  const shots = useQuery({ queryKey: ["gallery"], queryFn: async () => { const r = await fetch("/showcase/gallery.json"); return r.ok ? ((await r.json()) as Array<{ file: string; title: string; caption: string; status?: string }>) : []; } });
  const [open, setOpen] = useState<number | null>(null);
  const list = shots.data ?? [];
  return (
    <div>
      {!list.length && <EmptyState title="No screenshots yet">Run scripts/showcase/capture.mjs against a running app.</EmptyState>}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((s, i) => (
          <figure key={s.file} className="overflow-hidden rounded-md border border-line bg-surface">
            <button type="button" onClick={() => setOpen(i)} className="block w-full" aria-label={`Enlarge ${s.title}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/showcase/${s.file}`} alt={s.title} className="aspect-[5/3] w-full object-cover" loading="lazy" />
            </button>
            <figcaption className="p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold">{s.title}</span>
                {s.status && <span className="text-2xs text-faint">{s.status}</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted">{s.caption}</p>
            </figcaption>
          </figure>
        ))}
      </div>
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
      {PURPOSE.body.map((p, i) => <p key={i} className="mt-3 text-sm leading-relaxed text-muted">{p}</p>)}
      <h2 className="mt-12 text-2xs font-semibold uppercase tracking-[0.12em] text-faint">How it was built</h2>
      <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface p-4"><ArchitectureDiagram /></div>
      {PURPOSE.technical.map((s) => (
        <section key={s.title} className="mt-6">
          <h3 className="text-sm font-semibold text-signal">{s.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
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
