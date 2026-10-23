"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp, ArrowLeftRight, BarChart3, Bookmark, Download, Eye, Filter, Grid3x3, Layers, Lightbulb, Maximize2, Minimize2,
  Plus, Sparkles, Table2, Trash2, X,
} from "lucide-react";
import { api, Cond, Dataset, Dim, keyToCond, withExtra } from "@/lib/api";
import { useApp } from "@/lib/state";
import { fmt, uid } from "@/lib/format";
import { buildCrossOption, crossToCsv, CROSS_CHARTS_1D, CROSS_CHARTS_2D, matrix, XResult } from "@/lib/crosscharts";
import FilterBar from "@/components/FilterBar";
import EChart from "@/components/EChart";
import { MetricPicker } from "@/components/KpiGrid";
import { NoDataset } from "@/components/Notices";

type Cfg = {
  rows: Dim[]; col: Dim | null; metrics: any[]; topRows: number; topCols: number;
  sort: "desc" | "asc" | "label"; sortMetric: number; chart: string; mi: number; mode: "value" | "row" | "col" | "total";
};
type Preset = { id: string; name: string; desc: string; cfg: Partial<Cfg> };

const MAX_ROWS = 3, MAX_METRICS = 4;
const GRAINS = [{ v: "month", l: "Mes" }, { v: "quarter", l: "Trimestre" }, { v: "year", l: "Año" }, { v: "day", l: "Día" }];

const colType = (ds: Dataset, col: string) => (col === "_period" ? "category" : ds.columns.find((c) => c.name === col)?.type || "text");
const dimLabel = (d: Dim) => d.col === "_period" ? "Periodo de carga" : d.grain ? `${d.col} (${GRAINS.find((g) => g.v === d.grain)?.l.toLowerCase()})` : d.col;

function kindFor(ds: Dataset, m: any) {
  if (m.op === "count" || m.op === "count_distinct") return "int";
  if (m.op === "compliance") return "pct";
  const role = ds.columns.find((c) => c.name === m.col)?.role;
  return role === "amount" || role === "unit_price" ? "money" : "auto";
}
const mkDim = (ds: Dataset, col: string): Dim => (colType(ds, col) === "date" ? { col, grain: "month" } : { col });

function presets(ds: Dataset): Preset[] {
  const role = (r: string) => ds.columns.find((c) => c.role === r)?.name;
  const amount = role("amount"), date = role("date"), provider = role("provider"), inst = role("institution"), status = role("status");
  const proc = role("procedure"), cat = role("category"), desc = role("description"), unit = role("admin_unit"), price = role("unit_price");
  const main = amount ? { op: "sum", col: amount } : { op: "count" };
  const out: Preset[] = [];
  if (date) out.push({ id: "trend", name: "Evolución mensual", desc: "Tendencia en el tiempo con dos indicadores", cfg: { rows: [{ col: date, grain: "month" }], col: null, metrics: amount ? [main, { op: "count" }] : [main], chart: amount ? "combo" : "line" } });
  if (provider && date) out.push({ id: "prov-month", name: "Proveedores × mes", desc: "Quién concentra el gasto y cuándo", cfg: { rows: [{ col: provider }], col: { col: date, grain: "month" }, metrics: [main, { op: "count" }], chart: "stacked", topRows: 15 } });
  if (inst && status) out.push({ id: "inst-status", name: "Institución × estatus", desc: "Avance por unidad", cfg: { rows: [{ col: inst }], col: { col: status }, metrics: [{ op: "count" }, ...(amount ? [main] : [])], chart: "stacked100" } });
  if (proc && provider) out.push({ id: "proc-prov", name: "Procedimiento × proveedor", desc: "Tipo de contratación por proveedor", cfg: { rows: [{ col: provider }], col: { col: proc }, metrics: [main], chart: "heatmap", topRows: 20 } });
  if (unit && cat) out.push({ id: "unit-cat", name: "Unidad × categoría", desc: "Mezcla de compras por área", cfg: { rows: [{ col: unit }], col: { col: cat }, metrics: [main], chart: "heatmap" } });
  if (desc && price && provider) out.push({ id: "price", name: "Precio por producto y proveedor", desc: "Dispersión de precios unitarios", cfg: { rows: [{ col: desc }], col: { col: provider }, metrics: [{ op: "avg", col: price }, { op: "count" }], chart: "heatmap", sort: "desc", sortMetric: 1, topRows: 20 } });
  if (provider) out.push({ id: "pareto", name: "Pareto de proveedores", desc: "Regla 80/20 de concentración", cfg: { rows: [{ col: provider }], col: null, metrics: [main, { op: "count" }], chart: "pareto", topRows: 25 } });
  if (!out.length) {
    const cats = ds.columns.filter((c) => c.type === "category" || c.type === "text").map((c) => c.name);
    if (cats[0]) out.push({ id: "c1", name: `${cats[0]}${cats[1] ? " × " + cats[1] : ""}`, desc: "Cruce de las dos primeras categorías", cfg: { rows: [{ col: cats[0] }], col: cats[1] ? { col: cats[1] } : null, metrics: [{ op: "count" }], chart: cats[1] ? "stacked" : "bar" } });
  }
  return out;
}

function baseCfg(ds: Dataset): Cfg {
  const first = ds.columns.find((c) => c.type === "category")?.name || ds.columns.find((c) => c.type !== "empty")?.name || "";
  const b: Cfg = { rows: first ? [mkDim(ds, first)] : [], col: null, metrics: [{ op: "count" }], topRows: 25, topCols: 10, sort: "desc", sortMetric: 0, chart: "bar", mi: 0, mode: "value" };
  const p = presets(ds)[0];
  return p ? { ...b, ...p.cfg } : b;
}

function DimSelect({ ds, value, onChange, exclude, allowNone, id }: { ds: Dataset; value: Dim | null; onChange: (d: Dim | null) => void; exclude: string[]; allowNone?: boolean; id: string }) {
  const cols = [...((ds.periods?.length || 0) > 1 ? ["_period"] : []), ...ds.columns.filter((c) => c.type !== "empty").map((c) => c.name)];
  const isDate = value && colType(ds, value.col) === "date";
  return (
    <div className="row" style={{ gap: 6, flex: 1, minWidth: 0 }}>
      <select className="select" style={{ flex: 1, minWidth: 0 }} id={id} value={value?.col || ""} onChange={(e) => onChange(e.target.value ? mkDim(ds, e.target.value) : null)}>
        {allowNone && <option value="">— sin columnas (solo filas) —</option>}
        {cols.filter((c) => c === value?.col || !exclude.includes(c)).map((c) => <option key={c} value={c}>{c === "_period" ? "Periodo de carga" : c}</option>)}
      </select>
      {isDate && (
        <select className="select" style={{ width: 104 }} value={value!.grain || "month"} onChange={(e) => onChange({ ...value!, grain: e.target.value })} aria-label="Granularidad">
          {GRAINS.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
        </select>
      )}
    </div>
  );
}

function heat(a: number) {
  const x = Math.max(0, Math.min(1, a));
  return { background: `rgba(29, 52, 82, ${0.04 + x * 0.66})`, color: x > 0.55 ? "#fff" : undefined };
}

export default function CrossPage() {
  const { active, apiFilter, applied, applyFilters, track, toast } = useApp();
  const router = useRouter();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [res, setRes] = useState<XResult | null>(null);
  const [resCfg, setResCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<any[]>([]);
  const [drill, setDrill] = useState<{ title: string; conds: Cond[] } | null>(null);
  const [full, setFull] = useState(false);
  const reqId = useRef(0);

  // configuración inicial: última usada para este conjunto o la primera sugerencia
  useEffect(() => {
    if (!active) return;
    let c: Cfg | null = null;
    try { const raw = localStorage.getItem("nexus.cross." + active.id); if (raw) c = { ...baseCfg(active), ...JSON.parse(raw) }; } catch { /* noop */ }
    const valid = (x: Cfg) => x.rows.every((d) => d.col === "_period" || active.columns.some((cc) => cc.name === d.col));
    setCfg(c && valid(c) ? c : baseCfg(active));
    setRes(null);
    api(`/api/datasets/${active.id}/views?kind=cross`).then(setSaved).catch(() => setSaved([]));
  }, [active?.id]); // eslint-disable-line

  const queryKey = cfg ? JSON.stringify([cfg.rows, cfg.col, cfg.metrics, cfg.topRows, cfg.topCols, cfg.sort, cfg.sortMetric]) : "";
  useEffect(() => {
    if (!active || !cfg || !cfg.rows.length) return;
    localStorage.setItem("nexus.cross." + active.id, JSON.stringify(cfg));
    const metricsOk = cfg.metrics.every((m) => m.op === "count" || m.col);
    if (!metricsOk) return;
    const my = ++reqId.current;
    const t = setTimeout(() => {
      setLoading(true);
      track(api<XResult>(`/api/datasets/${active.id}/crosstab`, {
        body: { metrics: cfg.metrics, rows: cfg.rows, col: cfg.col, filters: apiFilter, top_rows: cfg.topRows, top_cols: cfg.topCols,
          sort: cfg.sort === "label" ? "desc" : cfg.sort, sort_by_label: cfg.sort === "label", sort_metric: cfg.sortMetric },
      })).then((r) => { if (my === reqId.current) { setRes(r); setResCfg(cfg); setErr(null); } })
        .catch((e) => my === reqId.current && setErr(e.message))
        .finally(() => my === reqId.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [active?.id, queryKey, apiFilter]); // eslint-disable-line
  useEffect(() => { if (active && cfg) localStorage.setItem("nexus.cross." + active.id, JSON.stringify(cfg)); }, [cfg?.chart, cfg?.mi, cfg?.mode]); // eslint-disable-line

  const kinds = useMemo(() => (active && resCfg ? resCfg.metrics.map((m) => kindFor(active, m)) : []), [active, resCfg]);
  const has2D = !!res?.col_dim;
  const chartList = has2D ? CROSS_CHARTS_2D : CROSS_CHARTS_1D.filter((c) => c.id !== "combo" || (res?.metrics.length || 0) > 1);
  const chart = cfg && chartList.some((c) => c.id === cfg.chart) ? cfg.chart : chartList[0]?.id;
  const mi = cfg && res && cfg.mi < res.metrics.length ? cfg.mi : 0;
  const option = useMemo(() => (res && res.rows.length ? buildCrossOption(res, chart, mi, kinds) : null), [res, chart, mi, kinds]);

  if (!active) return <><div className="page-head"><div><h1>Análisis cruzado</h1></div></div><NoDataset /></>;
  if (!cfg) return null;

  const set = (p: Partial<Cfg>) => setCfg({ ...cfg, ...p });
  const usedDims = [...cfg.rows.map((d) => d.col), ...(cfg.col ? [cfg.col.col] : [])];
  const allPresets = presets(active);
  const additive = res ? res.metrics[mi]?.additive : false;
  const mode = additive ? cfg.mode : "value";

  // ---------- drill-down: de una fila/celda a sus registros
  const condsFor = (ri: number, colKey?: string): Cond[] => {
    if (!res || !resCfg) return [];
    const r = res.rows[ri];
    const cs = r.keys.map((k, i) => keyToCond(active, resCfg.rows[i], String(k))).filter(Boolean) as Cond[];
    if (colKey !== undefined && resCfg.col) { const c = keyToCond(active, resCfg.col, String(colKey)); if (c) cs.push(c); }
    return cs;
  };
  const openDrill = (ri: number, colKey?: string) => {
    if (!res || ri < 0 || !res.rows[ri]) return;
    if (colKey === "Otros") { toast("«Otros» agrupa varias columnas; seleccione una columna específica.", true); return; }
    setDrill({ title: res.rows[ri].label + (colKey !== undefined ? ` × ${colKey}` : ""), conds: condsFor(ri, colKey) });
  };
  const onChartClick = (p: any) => {
    if (!res) return;
    if (p.seriesType === "heatmap" && has2D) { const { colKeys } = matrix(res, mi); return openDrill(p.value[1], colKeys[p.value[0]]); }
    const ri = res.rows.findIndex((r) => r.label === p.name);
    if (has2D && p.seriesName && p.componentType === "series") return openDrill(ri, p.seriesName);
    openDrill(ri);
  };
  const applyDrill = (conds: Cond[], go?: boolean) => {
    const cols = new Set(conds.map((c) => c.col));
    applyFilters({ ...applied, conds: [...applied.conds.filter((c) => !(c.quick && cols.has(c.col))), ...conds] });
    setDrill(null);
    toast("Filtros aplicados a toda la plataforma");
    if (go) router.push("/explorer");
  };

  const exportCsv = () => {
    if (!res) return;
    const blob = new Blob([crossToCsv(res, mi)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${active.name}_cruce_${res.row_dims.join("_")}${res.col_dim ? "_x_" + res.col_dim : ""}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const saveAnalysis = async () => {
    const name = prompt("Nombre del análisis", `${cfg.rows.map(dimLabel).join(" × ")}${cfg.col ? " × " + dimLabel(cfg.col) : ""}`);
    if (!name?.trim()) return;
    const v = await api(`/api/datasets/${active.id}/views`, { body: { name: name.trim(), kind: "cross", payload: { cfg, filters: applied } } });
    setSaved([v, ...saved]); toast("Análisis guardado");
  };
  const loadSaved = (v: any) => { setCfg({ ...baseCfg(active), ...v.payload.cfg }); if (v.payload.filters) applyFilters(v.payload.filters); toast(`Análisis «${v.name}» cargado con sus filtros`); };

  return (
    <>
      <div className="page-head cross-hero">
        <div>
          <div className="eyebrow"><Sparkles size={13} /> Inteligencia multi-columna</div>
          <h1>Análisis cruzado</h1>
          <p className="sub">Combine varias columnas en filas y columnas, elija uno o más indicadores y obtenga gráficas, tabla cruzada y hallazgos al instante. Todo responde a los filtros.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={saveAnalysis} id="cross-save"><Bookmark size={15} />Guardar análisis</button>
          <button className="btn primary" onClick={exportCsv} disabled={!res} id="cross-export"><Download size={15} />Exportar CSV</button>
        </div>
      </div>

      <FilterBar />

      <div className="preset-bar" aria-label="Análisis sugeridos">
        <span className="small muted"><Lightbulb size={13} /> Sugeridos:</span>
        {allPresets.map((p) => (
          <button key={p.id} className="preset" title={p.desc} id={"preset-" + p.id} onClick={() => setCfg({ ...baseCfg(active), ...p.cfg, mi: 0, mode: "value" })}>
            <b>{p.name}</b><span>{p.desc}</span>
          </button>
        ))}
        {saved.map((v) => (
          <span key={v.id} className="preset saved" role="button" tabIndex={0} onClick={() => loadSaved(v)} onKeyDown={(e) => e.key === "Enter" && loadSaved(v)}>
            <Bookmark size={12} /><b>{v.name}</b>
            <button aria-label="Eliminar análisis" onClick={async (e) => { e.stopPropagation(); await api(`/api/views/${v.id}`, { method: "DELETE" }); setSaved(saved.filter((x) => x.id !== v.id)); }}><X size={11} /></button>
          </span>
        ))}
      </div>

      <div className="cross-layout">
        {/* ---------- Panel de configuración */}
        <aside className="card cfg" aria-label="Configuración del cruce">
          <section>
            <h3><Layers size={14} /> Filas · agrupar por</h3>
            <div className="stack" style={{ gap: 6 }}>
              {cfg.rows.map((d, i) => (
                <div className="row dim-row" key={i}>
                  <span className="lvl">{i + 1}</span>
                  <DimSelect ds={active} id={`cross-row-${i}`} value={d} exclude={usedDims} onChange={(nd) => nd && set({ rows: cfg.rows.map((x, j) => (j === i ? nd : x)) })} />
                  {cfg.rows.length > 1 && <button className="btn icon ghost sm" aria-label="Quitar nivel" onClick={() => set({ rows: cfg.rows.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>}
                </div>
              ))}
            </div>
            {cfg.rows.length < MAX_ROWS && (
              <button className="btn sm ghost add-btn" id="cross-add-row" onClick={() => { const c = active.columns.find((x) => x.type !== "empty" && !usedDims.includes(x.name)); if (c) set({ rows: [...cfg.rows, mkDim(active, c.name)] }); }}>
                <Plus size={13} />Agregar nivel (subgrupo)
              </button>
            )}
          </section>

          <section>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3><Grid3x3 size={14} /> Columnas · cruzar con</h3>
              {cfg.col && <button className="btn icon ghost sm" title="Intercambiar filas y columnas" id="cross-swap" onClick={() => set({ rows: [cfg.col!, ...cfg.rows.slice(1)], col: cfg.rows[0] })}><ArrowLeftRight size={14} /></button>}
            </div>
            <DimSelect ds={active} id="cross-col" value={cfg.col} allowNone exclude={usedDims} onChange={(d) => set({ col: d })} />
          </section>

          <section>
            <h3><BarChart3 size={14} /> Indicadores</h3>
            <div className="stack" style={{ gap: 6 }}>
              {cfg.metrics.map((m, i) => (
                <div className="row dim-row" key={i}>
                  <span className="lvl metric">{String.fromCharCode(65 + i)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><MetricPicker ds={active} value={m} onChange={(nm) => set({ metrics: cfg.metrics.map((x, j) => (j === i ? nm : x)) })} label={`Indicador ${i + 1}`} /></div>
                  {cfg.metrics.length > 1 && <button className="btn icon ghost sm" aria-label="Quitar indicador" onClick={() => set({ metrics: cfg.metrics.filter((_, j) => j !== i), mi: 0, sortMetric: 0 })}><Trash2 size={14} /></button>}
                </div>
              ))}
            </div>
            {cfg.metrics.length < MAX_METRICS && <button className="btn sm ghost add-btn" id="cross-add-metric" onClick={() => set({ metrics: [...cfg.metrics, { op: "count" }] })}><Plus size={13} />Agregar indicador</button>}
          </section>

          <section>
            <h3><ArrowDownUp size={14} /> Orden y alcance</h3>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label className="field">Ordenar por
                <select className="select" value={cfg.sort === "label" ? "label" : String(cfg.sortMetric)} onChange={(e) => e.target.value === "label" ? set({ sort: "label" }) : set({ sortMetric: +e.target.value, sort: cfg.sort === "label" ? "desc" : cfg.sort })}>
                  {cfg.metrics.map((m, i) => <option key={i} value={i}>Indicador {String.fromCharCode(65 + i)}</option>)}
                  <option value="label">Alfabético / cronológico</option>
                </select>
              </label>
              <label className="field">Dirección
                <select className="select" value={cfg.sort === "asc" ? "asc" : "desc"} disabled={cfg.sort === "label"} onChange={(e) => set({ sort: e.target.value as any })}>
                  <option value="desc">Mayor a menor</option><option value="asc">Menor a mayor</option>
                </select>
              </label>
              <label className="field">Filas a mostrar
                <select className="select" value={cfg.topRows} onChange={(e) => set({ topRows: +e.target.value })}>{[10, 15, 25, 50, 100, 250, 500].map((n) => <option key={n} value={n}>Top {n}</option>)}</select>
              </label>
              <label className="field">Columnas a mostrar
                <select className="select" value={cfg.topCols} disabled={!cfg.col} onChange={(e) => set({ topCols: +e.target.value })}>{[5, 8, 10, 15, 25, 40].map((n) => <option key={n} value={n}>Top {n}</option>)}</select>
              </label>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Las columnas que no entran en el Top se suman en «Otros» (solo para sumas y conteos), por lo que los totales siempre cuadran.</p>
          </section>
        </aside>

        {/* ---------- Resultados */}
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {err && <div className="alert err">{err}</div>}

          <div className="stat-strip">
            <div className="stat"><span>Registros analizados</span><b>{res ? res.rows_considered.toLocaleString("es-MX") : "—"}</b><em>de {active.row_count.toLocaleString("es-MX")}</em></div>
            <div className="stat"><span>Combinaciones</span><b>{res ? res.row_groups.toLocaleString("es-MX") : "—"}</b><em>{res?.col_dim ? `× ${res.col_groups} en columnas` : "grupos únicos"}</em></div>
            {res?.metrics.map((m, i) => (
              <div className={"stat" + (i === mi ? " on" : "")} key={i} role="button" tabIndex={0} onClick={() => set({ mi: i })} title="Clic para graficar este indicador">
                <span><i className="mtag">{String.fromCharCode(65 + i)}</i>{m.label}</span><b>{fmt(res.grand.values[i], kinds[i])}</b><em>{m.additive ? "total general" : "sobre todos los registros"}</em>
              </div>
            ))}
            {res?.concentration?.top5 != null && res.row_groups > 5 && (
              <div className={"stat" + (res.concentration.top5 > 0.8 ? " warn" : "")}><span>Concentración Top 5</span><b>{(res.concentration.top5 * 100).toFixed(1)}%</b><em>del indicador {String.fromCharCode(65 + (resCfg?.sortMetric || 0))}</em></div>
            )}
          </div>

          {res && res.rows.length > 0 && <Insights res={res} kinds={kinds} sortMetric={resCfg?.sortMetric || 0} timeRows={colType(active, res.row_dims[0]) === "date"} />}

          <section className={"card chart-card cross-chart" + (full ? " full" : "")} aria-label="Gráfica del cruce">
            <div className="card-head">
              <div style={{ minWidth: 0 }}>
                <h2>{res ? `${res.metrics[mi]?.label} por ${resCfg?.rows.map(dimLabel).join(" × ")}${resCfg?.col ? " y " + dimLabel(resCfg.col) : ""}` : "Gráfica"}</h2>
                <div className="muted small">Clic en una barra, punto o celda para ver los registros que la componen.{res?.ms != null ? ` · ${res.ms} ms` : ""}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {res && res.metrics.length > 1 && (
                  <select className="select" value={mi} onChange={(e) => set({ mi: +e.target.value })} aria-label="Indicador a graficar" id="cross-metric-sel">
                    {res.metrics.map((m, i) => <option key={i} value={i}>{String.fromCharCode(65 + i)} · {m.label}</option>)}
                  </select>
                )}
                <select className="select" value={chart} onChange={(e) => set({ chart: e.target.value })} aria-label="Tipo de gráfica" id="cross-chart-type">
                  {chartList.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button className="btn icon ghost" onClick={() => setFull(!full)} aria-label={full ? "Restaurar" : "Pantalla completa"}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
              </div>
            </div>
            <div className="body" style={{ height: full ? "calc(100% - 70px)" : Math.max(380, has2D && (chart === "heatmap" || chart === "hstacked") ? (res?.rows.length || 0) * 28 + 120 : 380) }}>
              {loading && <div className="chart-loading"><span className="spinner" /></div>}
              {option ? <EChart option={option} onClick={onChartClick} /> : !loading && <div className="empty">{res ? "No hay datos con los filtros actuales." : "Configure el cruce para comenzar."}</div>}
            </div>
          </section>
          {full && <div className="backdrop" onClick={() => setFull(false)} />}

          {res && res.rows.length > 0 && (
            <section className="card" aria-label="Tabla cruzada">
              <div className="card-head">
                <div>
                  <h2><Table2 size={15} style={{ verticalAlign: -2 }} /> Tabla cruzada</h2>
                  <div className="muted small">
                    {res.truncated_rows ? `Mostrando ${res.rows.length} de ${res.row_groups.toLocaleString("es-MX")} grupos. ` : ""}
                    {res.truncated_cols ? `${res.cols.length} de ${res.col_groups} columnas; el resto en «Otros». ` : ""}
                    Clic en una fila o celda para ver el detalle.
                  </div>
                </div>
                {has2D && (
                  <div className="seg" style={{ margin: 0 }} role="radiogroup" aria-label="Mostrar como">
                    {([["value", "Valor"], ["row", "% fila"], ["col", "% columna"], ["total", "% total"]] as const).map(([k, l]) => (
                      <button key={k} className={mode === k ? "on" : ""} disabled={k !== "value" && !additive} onClick={() => set({ mode: k })} title={k !== "value" && !additive ? "Solo disponible para sumas y conteos" : ""}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
              <CrossTable res={res} mi={mi} kinds={kinds} mode={mode} onRow={(ri) => openDrill(ri)} onCell={(ri, k) => openDrill(ri, k)} />
            </section>
          )}
        </div>
      </div>

      {drill && <DrillDrawer ds={active} title={drill.title} conds={drill.conds} apiFilter={apiFilter} onClose={() => setDrill(null)} onApply={(go) => applyDrill(drill.conds, go)} />}
    </>
  );
}

function Insights({ res, kinds, sortMetric, timeRows }: { res: XResult; kinds: string[]; sortMetric: number; timeRows: boolean }) {
  const k = sortMetric < res.metrics.length ? sortMetric : 0;
  const m = res.metrics[k];
  const items: React.ReactNode[] = [];
  items.push(<>Se analizaron <b>{res.rows_considered.toLocaleString("es-MX")}</b> registros en <b>{res.row_groups.toLocaleString("es-MX")}</b> combinaciones de <b>{res.row_dims.join(" × ")}</b>{res.col_dim ? <> cruzadas con <b>{res.col_groups}</b> valores de <b>{res.col_dim}</b></> : null}.</>);
  if (timeRows && res.rows.length >= 2 && res.row_dims.length === 1) {
    const last = res.rows[res.rows.length - 1], prev = res.rows[res.rows.length - 2];
    const lv = last.values[k], pv = prev.values[k];
    if (lv != null && pv) {
      const ch = (lv - pv) / Math.abs(pv);
      items.push(<>El último periodo (<b>{last.label}</b>) registra <b>{fmt(lv, kinds[k])}</b> en {m.label.toLowerCase()}, <b className={ch >= 0 ? "up" : "down"}>{ch >= 0 ? "▲" : "▼"} {(Math.abs(ch) * 100).toFixed(1)}%</b> frente a {prev.label}.</>);
    }
    const peak = res.rows.reduce((a, r) => ((r.values[k] ?? -Infinity) > (a.values[k] ?? -Infinity) ? r : a), res.rows[0]);
    items.push(<>El valor máximo de {m.label.toLowerCase()} se alcanzó en <b>{peak.label}</b> ({fmt(peak.values[k], kinds[k])}).</>);
  } else if (!timeRows) {
    const top = res.rows[0];
    const sh = top.share?.[k];
    items.push(<><b>«{top.label}»</b> encabeza {m.label.toLowerCase()} con <b>{fmt(top.values[k], kinds[k])}</b>{sh != null ? <> ({(sh * 100).toFixed(1)}% del total)</> : null}.</>);
    const c = res.concentration;
    if (c?.top5 != null && res.row_groups > 5) items.push(<>Los 5 principales concentran <b>{(c.top5 * 100).toFixed(1)}%</b> del total{c.top5 > 0.8 ? <> — <b className="down">alta concentración</b></> : c.top5 < 0.4 ? " — distribución dispersa" : ""}.</>);
  }
  if (res.col_dim && res.cells.length) {
    const best = res.cells.reduce((a, c) => ((c.values[k] ?? -Infinity) > (a.values[k] ?? -Infinity) ? c : a), res.cells[0]);
    items.push(<>La combinación con mayor {m.label.toLowerCase()} es <b>{res.rows[best.r].label}</b> × <b>{res.cols[best.c].key}</b> ({fmt(best.values[k], kinds[k])}).</>);
    if (m.additive) {
      const r0 = res.rows[0];
      const cs = res.cells.filter((c) => c.r === 0);
      const lead = cs.reduce((a, c) => ((c.values[k] ?? 0) > (a?.values[k] ?? 0) ? c : a), cs[0]);
      if (lead && r0.values[k]) items.push(<>En <b>{r0.label}</b>, el {((lead.values[k]! / r0.values[k]!) * 100).toFixed(1)}% corresponde a <b>{res.cols[lead.c].key}</b>.</>);
    }
  }
  return (
    <section className="card insights" aria-label="Hallazgos automáticos">
      <div className="ins-head"><Lightbulb size={15} /> Hallazgos del cruce</div>
      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </section>
  );
}

function CrossTable({ res, mi, kinds, mode, onRow, onCell }: { res: XResult; mi: number; kinds: string[]; mode: string; onRow: (ri: number) => void; onCell: (ri: number, key: string) => void }) {
  const kind = kinds[mi];
  if (!res.col_dim) {
    const max = Math.max(1e-9, ...res.rows.map((r) => Math.abs(r.values[mi] ?? 0)));
    return (
      <div className="table-wrap" style={{ maxHeight: 620 }}>
        <table className="t cross-t">
          <thead><tr>{res.row_dims.map((d) => <th key={d}>{d}</th>)}{res.metrics.map((m, i) => <th key={i} className="num">{String.fromCharCode(65 + i)} · {m.label}</th>)}<th className="num">Participación</th><th className="num">Registros</th></tr></thead>
          <tbody>
            {res.rows.map((r, ri) => (
              <tr key={ri} onClick={() => onRow(ri)}>
                {r.keys.map((k, i) => <td key={i} className={ri > 0 && res.rows[ri - 1].keys.slice(0, i + 1).join("\u0001") === r.keys.slice(0, i + 1).join("\u0001") && i < r.keys.length - 1 ? "rep" : ""}>{String(k)}</td>)}
                {r.values.map((v, i) => (
                  <td key={i} className="num">
                    {i === mi ? <div className="databar"><span style={{ width: `${(Math.abs(v ?? 0) / max) * 100}%` }} /><em>{fmt(v, kinds[i])}</em></div> : fmt(v, kinds[i])}
                  </td>
                ))}
                <td className="num">{r.share?.[mi] != null ? ((r.share[mi] as number) * 100).toFixed(1) + "%" : "—"}</td>
                <td className="num muted">{r.rows.toLocaleString("es-MX")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={res.row_dims.length}>Total general</td>{res.grand.values.map((v, i) => <td key={i} className="num">{fmt(v, kinds[i])}</td>)}<td className="num">100%</td><td className="num">{res.grand.rows.toLocaleString("es-MX")}</td></tr></tfoot>
        </table>
      </div>
    );
  }
  const { m, colKeys } = matrix(res, mi);
  const othersTot = res.others.reduce((a, o) => a + (o.values[mi] ?? 0), 0);
  const colTot = [...res.cols.map((c) => c.values[mi]), ...(res.others.length ? [othersTot] : [])];
  const grand = res.grand.values[mi] ?? 0;
  const disp = (v: number | null, ri: number, ci: number) => {
    if (v == null) return null;
    if (mode === "row") return res.rows[ri].values[mi] ? v / (res.rows[ri].values[mi] as number) : null;
    if (mode === "col") return colTot[ci] ? v / (colTot[ci] as number) : null;
    if (mode === "total") return grand ? v / grand : null;
    return v;
  };
  const shown = m.map((row, ri) => row.map((v, ci) => disp(v, ri, ci)));
  const max = Math.max(1e-9, ...shown.flatMap((row, ri) => row.filter((_, ci) => colKeys[ci] !== "Otros").map((v) => Math.abs(v ?? 0))));
  const f = (v: number | null) => (v == null ? "" : mode === "value" ? fmt(v, kind) : (v * 100).toFixed(1) + "%");
  return (
    <div className="table-wrap" style={{ maxHeight: 620 }}>
      <table className="t cross-t matrix">
        <thead>
          <tr>
            {res.row_dims.map((d, i) => <th key={d} className="sticky-col" style={{ left: i * 0 }}>{d}</th>)}
            {colKeys.map((k) => <th key={k} className={"num" + (k === "Otros" ? " oth" : "")} title={`${res.col_dim}: ${k}`}>{k}</th>)}
            <th className="num tot">Total</th>
          </tr>
        </thead>
        <tbody>
          {res.rows.map((r, ri) => (
            <tr key={ri}>
              {r.keys.map((k, i) => <td key={i} className={"rowhead" + (ri > 0 && i < r.keys.length - 1 && res.rows[ri - 1].keys.slice(0, i + 1).join("\u0001") === r.keys.slice(0, i + 1).join("\u0001") ? " rep" : "")} onClick={() => onRow(ri)}>{String(k)}</td>)}
              {shown[ri].map((v, ci) => (
                <td key={ci} className={"num cell" + (colKeys[ci] === "Otros" ? " oth" : "")} style={v != null && colKeys[ci] !== "Otros" ? heat(Math.abs(v) / max) : undefined}
                  onClick={() => v != null && onCell(ri, colKeys[ci])} title={v != null ? `${r.label} × ${colKeys[ci]}: ${fmt(m[ri][ci], kind)}` : ""}>{f(v)}</td>
              ))}
              <td className="num tot" onClick={() => onRow(ri)}>{mode === "value" ? fmt(r.values[mi], kind) : mode === "row" ? "100%" : mode === "total" && grand ? (((r.values[mi] ?? 0) / grand) * 100).toFixed(1) + "%" : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={res.row_dims.length}>Total general</td>
            {colTot.map((v, ci) => <td key={ci} className="num">{mode === "value" ? fmt(v, kind) : mode === "col" ? "100%" : mode === "total" && grand ? (((v ?? 0) / grand) * 100).toFixed(1) + "%" : "—"}</td>)}
            <td className="num tot">{mode === "value" ? fmt(grand, kind) : "100%"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DrillDrawer({ ds, title, conds, apiFilter, onClose, onApply }: { ds: Dataset; title: string; conds: Cond[]; apiFilter: any; onClose: () => void; onApply: (go?: boolean) => void }) {
  const [data, setData] = useState<{ total: number; rows: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cols = ds.columns.filter((c) => c.type !== "empty").slice(0, 8);
  useEffect(() => {
    api(`/api/datasets/${ds.id}/rows`, { body: { filters: withExtra(apiFilter, conds), offset: 0, limit: 50 } }).then(setData).catch((e) => setErr(e.message));
  }, [title]); // eslint-disable-line
  const desc = (c: Cond) => c.op === "between" ? `${c.col}: ${c.value} a ${c.value2}` : c.op === "isnull" ? `${c.col}: (vacío)` : `${c.col}: ${Array.isArray(c.value) ? c.value.join(", ") : c.value}`;
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Detalle del grupo" style={{ width: "min(860px, 96vw)" }}>
        <div className="dh">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow"><Eye size={12} /> Registros que componen la cifra</div>
            <h2 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h2>
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="db stack">
          <div className="row wrap" style={{ gap: 6 }}>{conds.map((c) => <span className="chip" key={c.id}>{desc(c)}</span>)}<span className="badge">+ filtros globales activos</span></div>
          {err && <div className="alert err">{err}</div>}
          {!data && !err && <div className="skeleton" style={{ height: 200 }} />}
          {data && (
            <>
              <div className="muted small"><b style={{ color: "var(--navy)", fontSize: 15 }}>{data.total.toLocaleString("es-MX")}</b> registros{data.total > 50 ? " · se muestran los primeros 50" : ""}</div>
              <div className="table-wrap" style={{ maxHeight: "56vh", border: "1px solid var(--line)", borderRadius: 8 }}>
                <table className="t">
                  <thead><tr>{cols.map((c) => <th key={c.name}>{c.name}</th>)}</tr></thead>
                  <tbody>{data.rows.map((r) => <tr key={r._row_id}>{cols.map((c) => <td key={c.name} className={c.type === "number" ? "num" : ""}>{fmt(r[c.name], c.role === "amount" ? "money" : "auto")}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="mf" style={{ padding: "14px 20px", borderTop: "1px solid var(--line)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => onApply(false)} id="drill-apply"><Filter size={14} />Aplicar como filtro global</button>
          <button className="btn primary" onClick={() => onApply(true)} id="drill-explorer"><Table2 size={14} />Ver todos en el Explorador</button>
        </div>
      </aside>
    </>
  );
}
