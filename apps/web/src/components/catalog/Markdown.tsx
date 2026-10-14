"use client";
import { marked } from "marked";
import { useMemo } from "react";

/** Renders trusted repository markdown (docs, model cards). Raw HTML in the source is escaped. */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const escaped = source.replace(/<(?!\/?(br)\b)/g, "&lt;");
    return marked.parse(escaped, { async: false, gfm: true }) as string;
  }, [source]);
  return (
    <div
      className="prose-echo max-w-none text-sm leading-relaxed text-fg [&_a]:text-signal [&_code]:rounded [&_code]:bg-panel [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-line [&_pre]:bg-panel [&_pre]:p-3 [&_table]:my-3 [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:bg-panel [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-warn [&_blockquote]:pl-3 [&_blockquote]:text-muted"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
