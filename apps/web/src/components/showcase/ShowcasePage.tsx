"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { ArchitectureDiagram } from "./Diagrams";
import { PURPOSE } from "./content";

const VIDEOS = [
  { id: "demo-1", title: "One person", blurb: "A simulated person walks, sits and moves behind a wall while the system follows them from Wi-Fi signals alone." },
  { id: "demo-2", title: "Harder situations", blurb: "Two and three people, a weak signal, an empty room and too few sensors, including where it fails." },
];

function VideoCard({ id, title, blurb }: { id: string; title: string; blurb: string }) {
  return (
    <section className="rounded-md border border-line bg-surface p-4" data-testid={`video-${id}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mb-3 mt-0.5 max-w-3xl text-xs text-muted">{blurb}</p>
      <video controls preload="metadata" className="aspect-[16/10] w-full rounded border border-line bg-bg">
        <source src={`/showcase/${id}.mp4`} type="video/mp4" />
        <track kind="subtitles" src={`/showcase/${id}.vtt`} srcLang="en" label="English" default />
      </video>
    </section>
  );
}

function Situations() {
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
  { value: "situations", label: "Situations" },
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
        {tab === "demo" && <div className="mx-auto max-w-5xl space-y-4">{VIDEOS.map((v) => <VideoCard key={v.id} {...v} />)}</div>}
        {tab === "situations" && <Situations />}
        {tab === "purpose" && <Purpose />}
      </div>
    </div>
  );
}
