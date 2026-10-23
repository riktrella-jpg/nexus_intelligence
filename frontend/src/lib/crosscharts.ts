import { compact, fmt } from "./format";

export const SERIES_PALETTE = ["#1d3452", "#b0925b", "#54718c", "#651e32", "#2f6b57", "#8aa2b8", "#7d6a3f", "#a9576b", "#3a5878", "#c9b27f", "#4f7c6c", "#b9c6d4"];
const OTHERS_COLOR = "#cfd7e2";
const txt = { color: "#667588", fontFamily: "Inter, Segoe UI, sans-serif", fontSize: 11 };
const tooltipBase = { backgroundColor: "#101c2e", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12 }, confine: true };

export type XRow = { keys: string[]; label: string; values: (number | null)[]; rows: number; share?: (number | null)[] };
export type XCol = { key: string; values: (number | null)[]; rows: number };
export type XCell = { r: number; c: number; values: (number | null)[]; rows: number };
export type XResult = {
  metrics: { label: string; additive: boolean; op: string; col?: string }[];
  row_dims: string[]; col_dim: string | null; rows: XRow[]; row_groups: number; cols: XCol[]; col_groups: number;
  cells: XCell[]; others: { r: number; values: (number | null)[]; rows: number }[];
  grand: { values: (number | null)[]; rows: number }; rows_considered: number;
  concentration: Record<string, number> | null; truncated_rows: boolean; truncated_cols: boolean; ms?: number;
};

export const CROSS_CHARTS_1D = [
  { id: "bar", label: "Barras" }, { id: "hbar", label: "Barras horizontales" }, { id: "line", label: "Líneas" },
  { id: "pie", label: "Dona" }, { id: "treemap", label: "Treemap" }, { id: "pareto", label: "Pareto" }, { id: "combo", label: "Combinada (2 indicadores)" },
];
export const CROSS_CHARTS_2D = [
  { id: "stacked", label: "Barras apiladas" }, { id: "grouped", label: "Barras agrupadas" }, { id: "stacked100", label: "Apiladas 100 %" },
  { id: "hstacked", label: "Apiladas horizontales" }, { id: "heatmap", label: "Mapa de calor" }, { id: "lines", label: "Líneas por serie" },
];

const axisFmt = (kind: string) => (v: number) => (kind === "pct" ? (v * 100).toFixed(0) + "%" : kind === "money" ? "$" + compact(v) : compact(v));

/** Matriz [fila][columna] con el valor del indicador mi; agrega «Otros» como última columna si existe. */
export function matrix(res: XResult, mi: number) {
  const nC = res.cols.length + (res.others.length ? 1 : 0);
  const m: (number | null)[][] = res.rows.map(() => Array(nC).fill(null));
  for (const c of res.cells) m[c.r][c.c] = c.values[mi];
  if (res.others.length) for (const o of res.others) m[o.r][nC - 1] = o.values[mi];
  const colKeys = [...res.cols.map((c) => c.key), ...(res.others.length ? ["Otros"] : [])];
  return { m, colKeys };
}

export function buildCrossOption(res: XResult, chart: string, mi: number, kinds: string[]) {
  const kind = kinds[mi] || "auto";
  const f = (v: number) => (v === null || v === undefined ? "—" : fmt(v, kind));
  const af = axisFmt(kind);
  const labels = res.rows.map((r) => r.label);
  const grid = { left: 12, right: 24, top: 36, bottom: 12, containLabel: true };
  const catAxis = (data: string[]) => ({ type: "category", data, axisLabel: { ...txt, width: 96, overflow: "truncate", rotate: data.length > 8 ? 30 : 0 }, axisTick: { show: false } });
  const valAxis = (fmtr = af) => ({ type: "value", axisLabel: { ...txt, formatter: fmtr }, splitLine: { lineStyle: { color: "#eef1f6" } } });
  const mLabel = res.metrics[mi]?.label || "";

  if (res.col_dim) {
    const { m, colKeys } = matrix(res, mi);
    if (chart === "heatmap") {
      const data: any[] = [];
      m.forEach((row, ri) => row.forEach((v, ci) => { if (v !== null) data.push([ci, ri, v]); }));
      const max = Math.max(1, ...data.map((d) => Math.abs(d[2])));
      return {
        tooltip: { ...tooltipBase, formatter: (p: any) => `<b>${labels[p.value[1]]}</b><br/>${res.col_dim}: ${colKeys[p.value[0]]}<br/>${mLabel}: <b>${f(p.value[2])}</b>` },
        grid: { left: 12, right: 24, top: 12, bottom: 60, containLabel: true },
        xAxis: { ...catAxis(colKeys), position: "top", axisLabel: { ...txt, width: 90, overflow: "truncate", rotate: colKeys.length > 6 ? 30 : 0 } },
        yAxis: { type: "category", data: labels, inverse: true, axisLabel: { ...txt, width: 160, overflow: "truncate" } },
        visualMap: { min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 4, itemHeight: 140, inRange: { color: ["#f3f6fa", "#b9c6d4", "#54718c", "#1d3452"] }, textStyle: txt, formatter: (v: number) => af(v) },
        series: [{ type: "heatmap", data, label: { show: labels.length * colKeys.length <= 120, fontSize: 10, color: "#101c2e", formatter: (p: any) => af(p.value[2]) }, itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: "#b0925b", borderWidth: 2 } } }],
      };
    }
    const horizontal = chart === "hstacked";
    const pct = chart === "stacked100";
    const rowTot = m.map((row) => row.reduce<number>((a, v) => a + Math.abs(v || 0), 0) || 1);
    const series = colKeys.map((k, ci) => ({
      name: k, type: chart === "lines" ? "line" : "bar", stack: chart === "grouped" || chart === "lines" ? undefined : "s",
      smooth: chart === "lines", symbolSize: 6, barMaxWidth: chart === "grouped" ? 18 : 44, emphasis: { focus: "series" },
      itemStyle: { color: k === "Otros" ? OTHERS_COLOR : SERIES_PALETTE[ci % SERIES_PALETTE.length], borderRadius: chart === "grouped" ? [3, 3, 0, 0] : 0 },
      data: m.map((row, ri) => (pct ? (row[ci] == null ? null : (row[ci] as number) / rowTot[ri]) : row[ci])),
    }));
    const vfmt = pct ? (v: number) => (v * 100).toFixed(0) + "%" : af;
    const tip = (ps: any[]) => {
      const ri = ps[0]?.dataIndex;
      const lines = ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}: <b>${pct ? (p.value * 100).toFixed(1) + "%" : f(p.value)}</b>`);
      return `<b>${labels[ri]}</b><br/>${lines.join("<br/>")}<br/><span style="opacity:.7">Total fila: ${f(res.rows[ri]?.values[mi] as number)}</span>`;
    };
    return {
      tooltip: { ...tooltipBase, trigger: "axis", axisPointer: { type: chart === "lines" ? "line" : "shadow" }, formatter: tip },
      legend: { type: "scroll", top: 0, textStyle: txt, itemWidth: 12, itemHeight: 10 },
      grid: { ...grid, left: horizontal ? 8 : 12 },
      xAxis: horizontal ? valAxis(vfmt) : catAxis(labels),
      yAxis: horizontal ? { type: "category", data: labels, inverse: true, axisLabel: { ...txt, width: 160, overflow: "truncate" }, axisTick: { show: false } } : { ...valAxis(vfmt), max: pct ? 1 : undefined },
      dataZoom: !horizontal && labels.length > 18 ? [{ type: "slider", height: 14, bottom: 0, start: 0, end: Math.min(100, (18 / labels.length) * 100) }] : undefined,
      series,
    };
  }

  // ---------- una sola agrupación (sin dimensión en columnas)
  const vals = res.rows.map((r) => r.values[mi] ?? 0);
  const tipRow = (i: number) => {
    const r = res.rows[i];
    if (!r) return "";
    const extra = res.metrics.map((mm, k) => `${mm.label}: <b>${fmt(r.values[k], kinds[k])}</b>`).join("<br/>");
    const sh = r.share?.[mi];
    return `<b>${r.label}</b><br/>${extra}${sh != null ? `<br/>Participación: ${(sh * 100).toFixed(1)}%` : ""}<br/>Registros: ${r.rows.toLocaleString("es-MX")}`;
  };
  if (chart === "pie") {
    return {
      color: SERIES_PALETTE, tooltip: { ...tooltipBase, trigger: "item", formatter: (p: any) => tipRow(p.dataIndex) },
      legend: { type: "scroll", orient: "vertical", right: 0, top: "middle", textStyle: txt, formatter: (n: string) => (n.length > 28 ? n.slice(0, 27) + "…" : n) },
      series: [{ type: "pie", radius: ["48%", "74%"], center: ["36%", "50%"], label: { show: false }, emphasis: { label: { show: true, fontWeight: 600, formatter: "{d}%" } },
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 }, data: res.rows.map((r) => ({ name: r.label, value: Math.abs(r.values[mi] ?? 0) })) }],
    };
  }
  if (chart === "treemap") {
    return {
      tooltip: { ...tooltipBase, formatter: (p: any) => tipRow(p.dataIndex - 1) },
      series: [{ type: "treemap", roam: false, breadcrumb: { show: false }, nodeClick: false, label: { fontSize: 11, overflow: "truncate", formatter: (p: any) => `${p.name}\n${af(p.value)}` },
        itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2 }, data: res.rows.map((r, i) => ({ name: r.label, value: Math.abs(r.values[mi] ?? 0), itemStyle: { color: SERIES_PALETTE[i % SERIES_PALETTE.length] } })) }],
    };
  }
  if (chart === "pareto") {
    const total = vals.reduce((a, b) => a + Math.abs(b), 0) || 1;
    let acc = 0;
    const cum = vals.map((v) => ((acc += Math.abs(v)), +((acc / total) * 100).toFixed(1)));
    return {
      color: ["#1d3452", "#b0925b"], tooltip: { ...tooltipBase, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: any) => tipRow(ps[0].dataIndex) + `<br/>% acumulado: ${cum[ps[0].dataIndex]}%` },
      legend: { top: 0, textStyle: txt }, grid, xAxis: catAxis(labels),
      yAxis: [valAxis(), { type: "value", max: 100, axisLabel: { ...txt, formatter: "{value}%" }, splitLine: { show: false } }],
      series: [{ name: mLabel, type: "bar", data: vals, barMaxWidth: 38, itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: "% acumulado", type: "line", yAxisIndex: 1, data: cum, symbolSize: 6, lineStyle: { width: 2 }, markLine: { silent: true, symbol: "none", data: [{ yAxis: 80 }], lineStyle: { type: "dashed", color: "#651e32" }, label: { formatter: "80 %", color: "#651e32" } } }],
    };
  }
  if (chart === "combo" && res.metrics.length > 1) {
    const mj = mi === 0 ? 1 : 0;
    return {
      color: ["#1d3452", "#b0925b"], tooltip: { ...tooltipBase, trigger: "axis", formatter: (ps: any) => tipRow(ps[0].dataIndex) },
      legend: { top: 0, textStyle: txt }, grid, xAxis: catAxis(labels),
      yAxis: [valAxis(), valAxis(axisFmt(kinds[mj] || "auto"))].map((a, i) => (i === 1 ? { ...a, splitLine: { show: false } } : a)),
      series: [{ name: res.metrics[mi].label, type: "bar", data: vals, barMaxWidth: 38, itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: res.metrics[mj].label, type: "line", yAxisIndex: 1, data: res.rows.map((r) => r.values[mj]), symbolSize: 7, lineStyle: { width: 2.5 } }],
    };
  }
  if (chart === "hbar") {
    return {
      color: ["#1d3452"], tooltip: { ...tooltipBase, trigger: "item", formatter: (p: any) => tipRow(p.dataIndex) }, grid: { ...grid, top: 12, left: 8 },
      xAxis: valAxis(), yAxis: { type: "category", data: labels, inverse: true, axisLabel: { ...txt, width: 170, overflow: "truncate" }, axisTick: { show: false } },
      series: [{ type: "bar", data: vals, barMaxWidth: 20, itemStyle: { borderRadius: [0, 4, 4, 0], color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "#54718c" }, { offset: 1, color: "#1d3452" }] } },
        label: { show: labels.length <= 15, position: "right", ...txt, formatter: (p: any) => af(p.value) } }],
    };
  }
  const isLine = chart === "line";
  return {
    color: ["#1d3452"], tooltip: { ...tooltipBase, trigger: "axis", axisPointer: { type: isLine ? "line" : "shadow" }, formatter: (ps: any) => tipRow(ps[0].dataIndex) },
    grid: { ...grid, top: 16 }, xAxis: catAxis(labels), yAxis: valAxis(),
    dataZoom: labels.length > 24 ? [{ type: "slider", height: 14, bottom: 0, start: 0, end: Math.min(100, (24 / labels.length) * 100) }] : undefined,
    series: [{ type: isLine ? "line" : "bar", data: vals, smooth: isLine, symbolSize: 7, barMaxWidth: 42, lineStyle: { width: 2.5 },
      areaStyle: isLine ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(29,52,82,.22)" }, { offset: 1, color: "rgba(29,52,82,0)" }] } } : undefined,
      itemStyle: isLine ? undefined : { borderRadius: [4, 4, 0, 0], color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "#1d3452" }, { offset: 1, color: "#54718c" }] } } }],
  };
}

const q = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;

/** CSV de la tabla cruzada tal como se muestra (formato largo si no hay columnas; matriz si las hay). */
export function crossToCsv(res: XResult, mi: number) {
  if (!res.col_dim) {
    const head = [...res.row_dims, ...res.metrics.map((m) => m.label), "Participación", "Registros"].map(q).join(",");
    const body = res.rows.map((r) => [...r.keys.map(q), ...r.values.map((v) => v ?? ""), r.share?.[0] != null ? ((r.share[0] as number) * 100).toFixed(2) + "%" : "", r.rows].join(","));
    const tot = [q("Total"), ...res.row_dims.slice(1).map(() => ""), ...res.grand.values.map((v) => v ?? ""), "", res.grand.rows].join(",");
    return "\ufeff" + [head, ...body, tot].join("\n");
  }
  const { m, colKeys } = matrix(res, mi);
  const head = [...res.row_dims, ...colKeys.map((k) => `${res.col_dim}: ${k}`), "Total"].map(q).join(",");
  const body = res.rows.map((r, ri) => [...r.keys.map(q), ...m[ri].map((v) => v ?? ""), r.values[mi] ?? ""].join(","));
  return "\ufeff" + [`${q("Indicador: " + res.metrics[mi].label)}`, head, ...body].join("\n");
}
