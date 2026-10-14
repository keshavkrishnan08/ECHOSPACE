"use client";
import { useEffect, useRef } from "react";
import type { EChartsOption, ECharts } from "echarts";

const base = {
  backgroundColor: "transparent",
  textStyle: { color: "#8b9ab0", fontFamily: "Inter Variable, sans-serif", fontSize: 11 },
  animation: false,
};

export const axisStyle = {
  axisLine: { lineStyle: { color: "#273244" } },
  axisTick: { lineStyle: { color: "#273244" } },
  splitLine: { lineStyle: { color: "#1a2332" } },
  axisLabel: { color: "#8b9ab0", fontFamily: "JetBrains Mono Variable, monospace", fontSize: 10, hideOverlap: true, formatter: (v: number | string) => (typeof v === "number" ? String(Number(v.toPrecision(4))) : v) },
  nameTextStyle: { color: "#8b9ab0", fontSize: 10 },
};

export const tooltipStyle = {
  backgroundColor: "#1a2333",
  borderColor: "#273244",
  textStyle: { color: "#edf3fc", fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" },
};

/**
 * Thin ECharts host: initialises once, applies options on change, resizes with its container.
 * Interactions (dataZoom for zoom/pan, axis tooltip for cursor inspection, brush for region
 * selection) are configured by callers through the option object.
 */
export function EChart({ option, height = 220, onBrush, testId }: { option: EChartsOption; height?: number | string; onBrush?: (range: [number, number] | null) => void; testId?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const brushRef = useRef(onBrush);
  brushRef.current = onBrush;

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    void import("echarts").then((ec) => {
      if (disposed || !el.current) return;
      chart.current = ec.init(el.current, undefined, { renderer: "canvas" });
      chart.current.on("brushSelected", (p: unknown) => {
        const params = p as { batch?: Array<{ areas?: Array<{ coordRange?: [number, number] | [[number, number], [number, number]] }> }> };
        const area = params.batch?.[0]?.areas?.[0];
        const r = area?.coordRange;
        if (!r) brushRef.current?.(null);
        else brushRef.current?.(Array.isArray(r[0]) ? (r[0] as [number, number]) : (r as [number, number]));
      });
      chart.current.setOption({ ...base, ...option } as EChartsOption);
      ro = new ResizeObserver(() => chart.current?.resize());
      ro.observe(el.current);
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chart.current?.setOption({ ...base, ...option } as EChartsOption, { notMerge: false, lazyUpdate: true, replaceMerge: ["series"] });
  }, [option]);

  return <div ref={el} style={{ height, width: "100%" }} data-testid={testId} />;
}

export function zoomControls(xAxisIndex: number | number[] = 0) {
  return [
    { type: "inside" as const, xAxisIndex, filterMode: "none" as const },
    { type: "slider" as const, xAxisIndex, height: 14, bottom: 4, borderColor: "#273244", fillerColor: "rgba(45,212,230,0.12)", handleStyle: { color: "#2dd4e6" }, textStyle: { color: "#5c6b81", fontSize: 9 }, dataBackground: { lineStyle: { color: "#273244" }, areaStyle: { color: "#141c2a" } } },
  ];
}
