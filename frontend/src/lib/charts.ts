import { compact, fmt } from "./format";

export const PALETTE = ["#1d3452", "#54718c", "#b0925b", "#651e32", "#8aa2b8", "#7d6a3f", "#3a5878", "#a9576b", "#b9c6d4", "#2b4a6e"];
export const CHART_TYPES: { id: string; label: string; needs2?: boolean; time?: boolean }[] = [
  { id: "bar", label: "Barras" },
  { id: "hbar", label: "Barras horizontales" },
  { id: "line", label: "Líneas" },
  { id: "area", label: "Área" },
  { id: "pie", label: "Dona" },
  { id: "treemap", label: "Treemap" },
  { id: "pareto", label: "Pareto" },
  { id: "heatmap", label: "Mapa de calor", needs2: true },
  { id: "table", label: "Tabla" },
];

export type AggRow = { keys: string[]; label: string; value: number | null; rows: number; share?: number };
const txt = { color: "#667588", fontFamily: "Inter, Segoe UI, sans-serif", fontSize: 11 };

export function valueFormatter(kind: string) {
  return (v: number) => (v === null || v === undefined ? "—" : fmt(v, kind));
}

export function buildOption(type: string, rows: AggRow[], opts: { kind: string; metricLabel: string; additive: boolean }) {
  const f = valueFormatter(opts.kind);
  const axisFmt = (v: number) => (opts.kind === "pct" ? (v * 100).toFixed(0) + "%" : opts.kind === "money" ? "$" + compact(v) : compact(v));
  const tooltipBase = {
    backgroundColor: "#101c2e", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12 }, confine: true,
  };
  const labels = rows.map((r) => r.label);
  const vals = rows.map((r) => r.value ?? 0);
  const tipRow = (p: any) => {
    const r = rows[p.dataIndex];
    return `<b>${p.name}</b><br/>${opts.metricLabel}: <b>${f(r?.value as number)}</b>` + (r?.share != null ? `<br/>Participación: ${(r.share * 100).toFixed(1)}%` : "") + `<br/>Registros: ${r?.rows ?? "—"}`;
  };
  const grid = { left: 12, right: 24, top: 24, bottom: 8, containLabel: true };
  if (type === "pie") {
    return {
      color: PALETTE, tooltip: { ...tooltipBase, trigger: "item", formatter: (p: any) => tipRow(p) },
      legend: { type: "scroll", bottom: 0, textStyle: txt },
      series: [{ type: "pie", radius: ["46%", "72%"], center: ["50%", "46%"], avoidLabelOverlap: true, label: { show: false }, emphasis: { label: { show: true, fontWeight: 600 } },
        itemStyle: { borderColor: "#fff", borderWidth: 2 }, data: rows.map((r) => ({ name: r.label, value: r.value ?? 0 })) }],
    };
  }
  if (type === "treemap") {
    return {
      color: PALETTE, tooltip: { ...tooltipBase, formatter: (p: any) => `<b>${p.name}</b><br/>${f(p.value)}` },
      series: [{ type: "treemap", roam: false, breadcrumb: { show: false }, nodeClick: false, label: { fontSize: 11, overflow: "truncate" },
        itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2 }, data: rows.map((r, i) => ({ name: r.label, value: Math.abs(r.value ?? 0), itemStyle: { color: PALETTE[i % PALETTE.length] } })) }],
    };
  }
  if (type === "heatmap") {
    const xs = Array.from(new Set(rows.map((r) => r.keys[0])));
    const ys = Array.from(new Set(rows.map((r) => r.keys[1] ?? "")));
    const data = rows.map((r) => [xs.indexOf(r.keys[0]), ys.indexOf(r.keys[1] ?? ""), r.value ?? 0]);
    const max = Math.max(1, ...data.map((d) => d[2] as number));
    return {
      tooltip: { ...tooltipBase, formatter: (p: any) => `<b>${xs[p.value[0]]}</b> · ${ys[p.value[1]]}<br/>${opts.metricLabel}: <b>${f(p.value[2])}</b>` },
      grid: { left: 12, right: 24, top: 16, bottom: 56, containLabel: true },
      xAxis: { type: "category", data: xs, axisLabel: { ...txt, width: 90, overflow: "truncate", rotate: xs.length > 6 ? 30 : 0 } },
      yAxis: { type: "category", data: ys, axisLabel: { ...txt, width: 110, overflow: "truncate" } },
      visualMap: { min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#eef2f7", "#8aa2b8", "#1d3452"] }, textStyle: txt, formatter: (v: number) => axisFmt(v) },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: "#fff", borderWidth: 2 } }],
    };
  }
  if (type === "pareto") {
    const total = vals.reduce((a, b) => a + Math.abs(b), 0) || 1;
    let acc = 0;
    const cum = vals.map((v) => ((acc += Math.abs(v)), +(acc / total * 100).toFixed(1)));
    return {
      color: ["#1d3452", "#651e32"], tooltip: { ...tooltipBase, trigger: "axis", axisPointer: { type: "shadow" } }, grid: { ...grid, bottom: 40 },
      xAxis: { type: "category", data: labels, axisLabel: { ...txt, width: 80, overflow: "truncate", rotate: 30 } },
      yAxis: [{ type: "value", axisLabel: { ...txt, formatter: axisFmt }, splitLine: { lineStyle: { color: "#eef1f6" } } },
        { type: "value", max: 100, axisLabel: { ...txt, formatter: "{value}%" }, splitLine: { show: false } }],
      series: [{ name: opts.metricLabel, type: "bar", data: vals, barMaxWidth: 38, itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: "% acumulado", type: "line", yAxisIndex: 1, data: cum, symbolSize: 6, lineStyle: { width: 2 } }],
    };
  }
  if (type === "hbar") {
    const idx = [...rows.keys()].reverse();
    return {
      color: ["#1d3452"], tooltip: { ...tooltipBase, trigger: "item", formatter: (p: any) => tipRow({ ...p, dataIndex: idx[p.dataIndex] }) }, grid: { ...grid, left: 8 },
      xAxis: { type: "value", axisLabel: { ...txt, formatter: axisFmt }, splitLine: { lineStyle: { color: "#eef1f6" } } },
      yAxis: { type: "category", data: idx.map((i) => labels[i]), axisLabel: { ...txt, width: 150, overflow: "truncate" }, axisTick: { show: false } },
      series: [{ type: "bar", data: idx.map((i) => vals[i]), barMaxWidth: 22, itemStyle: { borderRadius: [0, 4, 4, 0] }, label: { show: rows.length <= 12, position: "right", ...txt, formatter: (p: any) => axisFmt(p.value) } }],
    };
  }
  const isLine = type === "line" || type === "area";
  return {
    color: ["#1d3452"], tooltip: { ...tooltipBase, trigger: "axis", axisPointer: { type: isLine ? "line" : "shadow" }, formatter: (ps: any) => tipRow(ps[0]) },
    grid: { ...grid, bottom: 12 },
    xAxis: { type: "category", data: labels, axisLabel: { ...txt, width: 80, overflow: "truncate", rotate: labels.length > 8 ? 30 : 0 }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: { ...txt, formatter: axisFmt }, splitLine: { lineStyle: { color: "#eef1f6" } } },
    series: [{
      type: isLine ? "line" : "bar", data: vals, smooth: isLine, symbolSize: 7, barMaxWidth: 42,
      areaStyle: type === "area" ? { color: "rgba(29,52,82,.14)" } : undefined,
      itemStyle: isLine ? undefined : { borderRadius: [4, 4, 0, 0] }, lineStyle: { width: 2.5 },
    }],
  };
}

export function rowsToCsv(rows: AggRow[], dimNames: string[], metricLabel: string) {
  const head = [...dimNames, metricLabel, "Participación", "Registros"].map((h) => `"${h.replace(/"/g, '""')}"`).join(",");
  const body = rows.map((r) => [...r.keys.map((k) => `"${String(k).replace(/"/g, '""')}"`), r.value ?? "", r.share != null ? (r.share * 100).toFixed(2) + "%" : "", r.rows].join(","));
  return "\ufeff" + [head, ...body].join("\n");
}
