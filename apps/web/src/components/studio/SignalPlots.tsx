"use client";
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { ReconstructionFrame } from "@echospace/schemas";
import { psd } from "@echospace/engine";
import { history } from "@/lib/engine/history";
import { useHistoryVersion } from "@/lib/engine/hooks";
import { useSession } from "@/lib/store/session";
import { EChart, axisStyle, tooltipStyle, zoomControls } from "@/components/charts/EChart";
import { Segmented } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/states";
import { PlotFrame } from "./PlotFrame";

const ANT_COLORS = ["#2dd4e6", "#5b8def", "#a78bfa", "#5fbf8f"];

export const SIGNAL_TABS = [
  { value: "amplitude", label: "Time-domain amplitude" },
  { value: "constellation", label: "Constellation" },
  { value: "magphase", label: "Magnitude & phase" },
  { value: "phasediff", label: "Antenna phase difference" },
  { value: "cfr", label: "Channel frequency response" },
  { value: "psd", label: "Power spectral density" },
  { value: "spectrogram", label: "Doppler spectrogram" },
  { value: "arrival", label: "Packet arrival" },
  { value: "snr", label: "SNR estimate" },
  { value: "coherence", label: "Channel coherence" },
  { value: "drops", label: "Drops & timestamps" },
] as const;
export type SignalTab = (typeof SIGNAL_TABS)[number]["value"];

function cursorLine(t: number | undefined) {
  return t === undefined ? undefined : { silent: true, symbol: "none", lineStyle: { color: "#f2f2f2", type: "dashed" as const, width: 1 }, data: [{ xAxis: t }], label: { show: false } };
}

const grid = { left: 52, right: 16, top: 24, bottom: 46 };

export function SignalPlots({ tab, frame }: { tab: SignalTab; frame: ReconstructionFrame | null }) {
  const v = useHistoryVersion(5);
  const info = useSession((s) => s.info);
  const selectedLink = useSession((s) => s.selectedLink);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const [view, setView] = useState<"raw" | "sanitized">("sanitized");
  const linkId = info?.links[selectedLink]?.id ?? `link ${selectedLink}`;
  const frames = useMemo(() => history.ordered().slice(-400), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const tNow = frame?.timestampS;

  if (!frame) return <EmptyState title="No frames yet">Start the session to see signals.</EmptyState>;
  const csi = frame.csi;
  const brushLabel = brush ? `${brush[0].toFixed(2)}-${brush[1].toFixed(2)} s` : null;
  const brushOpt = { toolbox: { show: true, right: 8, top: 0, itemSize: 12, iconStyle: { borderColor: "#5c6b81" }, feature: { brush: { type: ["lineX", "clear"] as Array<"lineX" | "clear"> } } }, brush: { xAxisIndex: 0, brushStyle: { color: "rgba(45,212,230,0.12)", borderColor: "#2dd4e6" } } };

  switch (tab) {
    case "amplitude": {
      const t = frames.map((f) => f.timestampS);
      const rss = frames.map((f) => f.features.rssDb[selectedLink]);
      const d = frames.map((f) => f.features.deltaRssDb[selectedLink]);
      const opt: EChartsOption = {
        grid,
        tooltip: { trigger: "axis", ...tooltipStyle },
        legend: { top: 0, left: 50, textStyle: { color: "#8b9ab0", fontSize: 10 } },
        xAxis: { type: "value", name: "stream time (s)", nameLocation: "middle", nameGap: 24, min: "dataMin", max: "dataMax", ...axisStyle },
        yAxis: [{ type: "value", name: "RSS (dB re. unit)", scale: true, ...axisStyle }, { type: "value", name: "ΔRSS (dB)", scale: true, ...axisStyle, splitLine: { show: false } }],
        dataZoom: zoomControls(0),
        ...brushOpt,
        series: [
          { name: "RSS (filtered)", type: "line", showSymbol: false, data: t.map((x, i) => [x, Number.isFinite(rss[i]) ? rss[i] : null]), lineStyle: { color: "#2dd4e6", width: 1.2 }, markLine: cursorLine(tNow) },
          { name: "ΔRSS attenuation", type: "line", yAxisIndex: 1, showSymbol: false, data: t.map((x, i) => [x, Number.isFinite(d[i]) ? d[i] : null]), lineStyle: { color: "#e8b04b", width: 1.2 } },
        ],
      };
      return (
        <PlotFrame title={`Received amplitude · ${linkId}`} kind="derived" units="dB relative to normalized unit power (not dBm)" selection={brushLabel} csv={() => frames.map((f) => ({ t_s: f.timestampS, link: linkId, rss_db: f.features.rssDb[selectedLink], delta_rss_db: f.features.deltaRssDb[selectedLink] }))} note="Per-frame mean |H|² over antennas and subcarriers after Hampel + EMA filtering. ΔRSS = calibrated baseline − current (positive = extra loss). Drag with the brush tool to select a time range.">
          <EChart option={opt} height={300} onBrush={setBrush} testId="plot-amplitude" />
        </PlotFrame>
      );
    }
    case "constellation": {
      if (!csi) return <EmptyState title="No CSI for the selected link in this frame" />;
      const M = csi.antennas;
      const K = csi.subcarriers;
      const series = Array.from({ length: M }, (_, m) => ({
        name: `ant ${m}`,
        type: "scatter" as const,
        symbolSize: 5,
        itemStyle: { color: ANT_COLORS[m] },
        data: Array.from({ length: K }, (_, k) => {
          const i = m * K + k;
          const ph = view === "raw" ? csi.phaseRaw[i] : csi.phaseSanitized[i];
          return [csi.magnitude[i] * Math.cos(ph), csi.magnitude[i] * Math.sin(ph)];
        }),
      }));
      return (
        <PlotFrame title={`CSI constellation · ${linkId}`} kind="measured" units="complex channel coefficients, normalized units" csv={() => series.flatMap((s, m) => s.data.map(([re, im], k) => ({ antenna: m, subcarrier: k, re, im, phase: view })))} note="Per-subcarrier complex channel estimates of one packet, not raw I/Q samples. A CSI source does not expose time-domain I/Q; that view requires an SDR adapter.">
          <div className="mb-1 flex justify-end"><Segmented value={view} onChange={setView} options={[{ value: "raw", label: "Raw phase" }, { value: "sanitized", label: "Sanitized" }]} /></div>
          <EChart option={{ grid: { ...grid, bottom: 36 }, tooltip: { trigger: "item", ...tooltipStyle }, legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } }, xAxis: { type: "value", name: "In-phase (Re)", nameLocation: "middle", nameGap: 22, ...axisStyle }, yAxis: { type: "value", name: "Quadrature (Im)", ...axisStyle }, dataZoom: [{ type: "inside", xAxisIndex: 0 }, { type: "inside", yAxisIndex: 0 }], series }} height={320} testId="plot-constellation" />
        </PlotFrame>
      );
    }
    case "magphase":
    case "cfr":
    case "phasediff": {
      if (!csi) return <EmptyState title="No CSI for the selected link in this frame" />;
      const M = csi.antennas;
      const K = csi.subcarriers;
      const fMHz = Array.from(csi.subcarrierOffsetsHz, (x) => x / 1e6);
      if (tab === "phasediff") {
        const series = Array.from({ length: Math.max(0, M - 1) }, (_, j) => {
          const m = j + 1;
          return {
            name: `ant ${m} − ant 0`,
            type: "line" as const,
            showSymbol: false,
            lineStyle: { color: ANT_COLORS[m], width: 1.3 },
            data: fMHz.map((f, k) => {
              const d = csi.phaseSanitized[m * K + k] - csi.phaseSanitized[k];
              return [f, Math.atan2(Math.sin(d), Math.cos(d))];
            }),
          };
        });
        return (
          <PlotFrame title={`Inter-antenna phase difference · ${linkId}`} kind="derived" units="radians, wrapped to (−π, π]" csv={() => series.flatMap((s) => s.data.map(([f, p]) => ({ pair: s.name, offset_mhz: f, phase_rad: p })))} note="Common CFO/STO phase cancels in the difference; what remains encodes angle of arrival plus per-antenna phase instability.">
            {M < 2 ? <EmptyState title="Single receive antenna: no phase difference available" /> : <EChart option={{ grid, tooltip: { trigger: "axis", ...tooltipStyle }, legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } }, xAxis: { type: "value", name: "subcarrier offset (MHz)", nameLocation: "middle", nameGap: 24, min: "dataMin", max: "dataMax", ...axisStyle }, yAxis: { type: "value", min: -Math.PI, max: Math.PI, name: "Δφ (rad)", ...axisStyle }, dataZoom: zoomControls(0), series }} height={300} testId="plot-phasediff" />}
          </PlotFrame>
        );
      }
      const db = tab === "cfr";
      const magSeries = Array.from({ length: M }, (_, m) => ({
        name: `|H| ant ${m}`,
        type: "line" as const,
        showSymbol: false,
        lineStyle: { color: ANT_COLORS[m], width: 1.3 },
        data: fMHz.map((f, k) => [f, db ? 20 * Math.log10(csi.magnitude[m * K + k] + 1e-12) : csi.magnitude[m * K + k]]),
      }));
      const phSeries = tab === "magphase" ? Array.from({ length: M }, (_, m) => ({
        name: `φ ant ${m} (${view})`,
        type: "line" as const,
        xAxisIndex: 1,
        yAxisIndex: 1,
        showSymbol: false,
        lineStyle: { color: ANT_COLORS[m], width: 1, type: "dashed" as const },
        data: fMHz.map((f, k) => [f, view === "raw" ? csi.phaseRaw[m * K + k] : csi.phaseSanitized[m * K + k]]),
      })) : [];
      const opt: EChartsOption = tab === "magphase"
        ? {
            grid: [{ left: 52, right: 16, top: 24, height: "36%" }, { left: 52, right: 16, top: "58%", bottom: 40 }],
            tooltip: { trigger: "axis", ...tooltipStyle },
            legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } },
            xAxis: [{ type: "value", gridIndex: 0, min: "dataMin", max: "dataMax", ...axisStyle }, { type: "value", gridIndex: 1, name: "subcarrier offset (MHz)", nameLocation: "middle", nameGap: 24, min: "dataMin", max: "dataMax", ...axisStyle }],
            yAxis: [{ type: "value", gridIndex: 0, name: "|H| (norm.)", scale: true, ...axisStyle }, { type: "value", gridIndex: 1, name: "phase (rad)", scale: true, ...axisStyle }],
            dataZoom: [{ type: "inside", xAxisIndex: [0, 1] }],
            axisPointer: { link: [{ xAxisIndex: "all" }] },
            series: [...magSeries, ...phSeries],
          }
        : { grid, tooltip: { trigger: "axis", ...tooltipStyle }, legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } }, xAxis: { type: "value", name: "subcarrier offset (MHz)", nameLocation: "middle", nameGap: 24, min: "dataMin", max: "dataMax", ...axisStyle }, yAxis: { type: "value", name: "|H| (dB re. unit)", scale: true, ...axisStyle }, dataZoom: zoomControls(0), series: magSeries };
      return (
        <PlotFrame title={`${tab === "cfr" ? "Channel frequency response" : "Magnitude & phase"} · ${linkId}`} kind="measured" units={tab === "cfr" ? "dB re. normalized unit (uncalibrated)" : "normalized magnitude; radians"} csv={() => fMHz.flatMap((f, k) => Array.from({ length: M }, (_, m) => ({ offset_mhz: f, antenna: m, magnitude: csi.magnitude[m * K + k], phase_raw: csi.phaseRaw[m * K + k], phase_sanitized: csi.phaseSanitized[m * K + k] })))} note={tab === "magphase" ? "Raw phase is dominated by random per-packet CFO and timing offset; the sanitized phase removes a least-squares linear fit (reference antenna) from every antenna." : "Frequency-selective fading from multipath shows as ripples across subcarriers."}>
          {tab === "magphase" && <div className="mb-1 flex justify-end"><Segmented value={view} onChange={setView} options={[{ value: "raw", label: "Raw phase" }, { value: "sanitized", label: "Sanitized" }]} /></div>}
          <EChart option={opt} height={tab === "magphase" ? 360 : 300} testId={`plot-${tab}`} />
        </PlotFrame>
      );
    }
    case "psd": {
      const sel = brush ? frames.filter((f) => f.timestampS >= brush[0] && f.timestampS <= brush[1]) : frames;
      const series = Float64Array.from(sel.map((f) => f.features.rssDb[selectedLink]).filter(Number.isFinite));
      const fs = sel.length > 1 ? (sel.length - 1) / Math.max(1e-6, sel[sel.length - 1].timestampS - sel[0].timestampS) : 1;
      const r = series.length >= 8 ? psd(series, fs) : null;
      return (
        <PlotFrame title={`Power spectral density of RSS · ${linkId}`} kind="derived" units={`dB/Hz (relative); fs = ${fs.toFixed(1)} Hz frame rate`} selection={brushLabel} csv={() => (r ? Array.from(r.f, (f, i) => ({ freq_hz: f, psd_db: r.p[i] })) : [])} note="Single-segment Hann-windowed periodogram of the per-frame RSS series (mean removed). Use the brush on the amplitude tab to restrict the window.">
          {!r ? <EmptyState title="Need at least 8 frames" /> : <EChart option={{ grid, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "value", name: "frequency (Hz)", nameLocation: "middle", nameGap: 24, min: 0, max: "dataMax", ...axisStyle }, yAxis: { type: "value", name: "dB/Hz", scale: true, ...axisStyle }, dataZoom: zoomControls(0), series: [{ type: "line", showSymbol: false, data: Array.from(r.f, (f, i) => [f, r.p[i]]), lineStyle: { color: "#2dd4e6", width: 1.2 }, areaStyle: { color: "rgba(45,212,230,0.08)" } }] }} height={300} testId="plot-psd" />}
        </PlotFrame>
      );
    }
    case "spectrogram": {
      const cols = frames.filter((f) => f.dopplerColumn && f.dopplerFreqsHz);
      if (!cols.length) return <EmptyState title="Collecting packets for the Doppler window…" />;
      const freqs = cols[cols.length - 1].dopplerFreqsHz!;
      const data: Array<[number, number, number]> = [];
      let lo = Infinity;
      let hi = -Infinity;
      cols.forEach((f, i) => {
        f.dopplerColumn!.forEach((p, j) => {
          data.push([i, j, p]);
          if (p < lo) lo = p;
          if (p > hi) hi = p;
        });
      });
      const curIdx = cols.findIndex((f) => f.seq === frame.seq);
      return (
        <PlotFrame title={`Doppler spectrogram · ${linkId}`} kind="derived" units="dB (relative), Doppler frequency in Hz" csv={() => data.map(([i, j, p]) => ({ t_s: cols[i].timestampS, doppler_hz: freqs[j], power_db: p }))} note="64-point FFT of the subcarrier-averaged sanitized CSI over the most recent 64 packets of the link, mean removed (static paths suppressed), Hann window. Each column is one frame.">
          <EChart
            option={{
              grid: { left: 52, right: 60, top: 12, bottom: 46 },
              tooltip: { position: "top", ...tooltipStyle, formatter: (p: unknown) => { const d = (p as { data: [number, number, number] }).data; return `t ${cols[d[0]]?.timestampS.toFixed(2)} s<br/>f ${freqs[d[1]].toFixed(1)} Hz<br/>${d[2].toFixed(1)} dB`; } },
              xAxis: { type: "category", data: cols.map((f) => f.timestampS.toFixed(1)), name: "stream time (s)", nameLocation: "middle", nameGap: 26, ...axisStyle, splitLine: { show: false } },
              yAxis: { type: "category", data: Array.from(freqs, (f) => f.toFixed(0)), name: "Doppler (Hz)", ...axisStyle, splitLine: { show: false } },
              visualMap: { min: lo, max: hi, calculable: true, orient: "vertical", right: 0, top: 12, itemHeight: 140, textStyle: { color: "#8b9ab0", fontSize: 9 }, inRange: { color: ["#080b12", "#1f3c88", "#2dd4e6", "#f2f2f2"] } },
              dataZoom: [{ type: "inside", xAxisIndex: 0 }],
              series: [{ type: "heatmap", data, progressive: 0, markLine: curIdx >= 0 ? { silent: true, symbol: "none", lineStyle: { color: "#f2f2f2", type: "dashed" }, data: [{ xAxis: curIdx }] } : undefined }],
            }}
            height={320}
            testId="plot-spectrogram"
          />
        </PlotFrame>
      );
    }
    case "arrival": {
      const ints = frames.flatMap((f) => (f.linkDiagnostics ? Array.from(f.linkDiagnostics.intervalsMs) : []));
      const nominal = 1000 / (useSession.getState().config.signal.packetRateHz || 100);
      const bins = 40;
      const maxV = Math.max(nominal * 4, ...ints.slice(-2000));
      const hist = new Array(bins).fill(0);
      for (const x of ints) hist[Math.min(bins - 1, Math.max(0, Math.floor((x / maxV) * bins)))]++;
      return (
        <PlotFrame title={`Packet inter-arrival intervals · ${linkId}`} kind="measured" units={`ms; nominal ${nominal.toFixed(1)} ms`} csv={() => ints.map((x) => ({ interval_ms: x }))} note="Differences of aligned timestamps (missing ones reconstructed from sequence numbers). Multiples of the nominal interval indicate lost packets; spread indicates timestamp jitter.">
          {ints.length < 2 ? <EmptyState title="No intervals yet" /> : <EChart option={{ grid, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "category", data: hist.map((_, i) => ((i + 0.5) * maxV / bins).toFixed(1)), name: "interval (ms)", nameLocation: "middle", nameGap: 24, ...axisStyle }, yAxis: { type: "value", name: "count", ...axisStyle }, series: [{ type: "bar", data: hist, itemStyle: { color: "#5b8def" } }] }} height={300} testId="plot-arrival" />}
        </PlotFrame>
      );
    }
    case "snr": {
      const L = frame.features.snrEstDb.length;
      const names = Array.from({ length: L }, (_, i) => info?.links[i]?.id ?? String(i));
      return (
        <PlotFrame title="Estimated SNR per link" kind="derived" units="dB (from calibration residual variance)" csv={() => names.map((n, i) => ({ link: n, snr_db: frame.features.snrEstDb[i] }))} note="10·log10(mean |E[H]|² / mean Var[H]) over the empty-room calibration window, per antenna-subcarrier, averaged. N/A when no calibration capture exists.">
          <EChart option={{ grid: { ...grid, bottom: 70 }, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "category", data: names, axisLabel: { ...axisStyle.axisLabel, rotate: 60 }, axisLine: axisStyle.axisLine }, yAxis: { type: "value", name: "dB", ...axisStyle }, series: [{ type: "bar", data: Array.from(frame.features.snrEstDb, (x, i) => ({ value: Number.isFinite(x) ? x : null, itemStyle: { color: i === selectedLink ? "#2dd4e6" : "#5b8def" } })) }] }} height={300} testId="plot-snr" />
        </PlotFrame>
      );
    }
    case "coherence": {
      const pts = frames.filter((f) => f.linkDiagnostics?.coherence !== null && f.linkDiagnostics?.coherence !== undefined);
      return (
        <PlotFrame title={`Channel coherence · ${linkId}`} kind="derived" units="0-1 normalized correlation of consecutive packets" csv={() => pts.map((f) => ({ t_s: f.timestampS, coherence: f.linkDiagnostics!.coherence }))} note="1 means consecutive channel snapshots are identical (static scene); motion, noise and phase instability lower it.">
          <EChart option={{ grid, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "value", name: "stream time (s)", nameLocation: "middle", nameGap: 24, min: "dataMin", max: "dataMax", ...axisStyle }, yAxis: { type: "value", min: (x: { min: number }) => Math.max(0, Math.floor(x.min * 20) / 20), max: 1, ...axisStyle }, dataZoom: zoomControls(0), series: [{ type: "line", showSymbol: false, data: pts.map((f) => [f.timestampS, f.linkDiagnostics!.coherence]), lineStyle: { color: "#5fbf8f", width: 1.2 }, markLine: cursorLine(tNow) }] }} height={300} testId="plot-coherence" />
        </PlotFrame>
      );
    }
    case "drops": {
      const t = frames.map((f) => f.timestampS);
      return (
        <PlotFrame title="Delivery, drops and timestamp diagnostics" kind="derived" units="ratio; counts per frame" csv={() => frames.map((f) => ({ t_s: f.timestampS, mean_delivery: f.metrics.packetDeliveryRatio, sel_link_reconstructed_ts: f.linkDiagnostics?.reconstructedTimestamps ?? null, sel_link_gaps: f.linkDiagnostics?.sequenceGaps ?? null, sel_link_jitter_ms: f.linkDiagnostics?.jitterMs ?? null, acquisition_drops_total: f.queues.acquisitionDrops }))} note="Delivery = received / expected packets per frame window. Reconstructed timestamps and sequence gaps refer to the selected link. Acquisition drops are packets discarded by the bounded queue (backpressure).">
          <EChart
            option={{
              grid,
              tooltip: { trigger: "axis", ...tooltipStyle },
              legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } },
              xAxis: { type: "value", name: "stream time (s)", nameLocation: "middle", nameGap: 24, min: "dataMin", max: "dataMax", ...axisStyle },
              yAxis: [{ type: "value", name: "delivery", min: 0, max: 1, ...axisStyle }, { type: "value", name: "count", ...axisStyle, splitLine: { show: false } }],
              dataZoom: zoomControls(0),
              series: [
                { name: "mean delivery (all links)", type: "line", showSymbol: false, data: t.map((x, i) => [x, frames[i].metrics.packetDeliveryRatio]), lineStyle: { color: "#5fbf8f" }, markLine: cursorLine(tNow) },
                { name: "missing timestamps (sel.)", type: "bar", yAxisIndex: 1, data: t.map((x, i) => [x, frames[i].linkDiagnostics?.reconstructedTimestamps ?? 0]), itemStyle: { color: "#e8b04b" } },
                { name: "sequence gaps (sel.)", type: "bar", yAxisIndex: 1, data: t.map((x, i) => [x, frames[i].linkDiagnostics?.sequenceGaps ?? 0]), itemStyle: { color: "#e5636a" } },
              ],
            }}
            height={300}
            testId="plot-drops"
          />
        </PlotFrame>
      );
    }
  }
}
