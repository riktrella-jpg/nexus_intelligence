"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Dataset } from "@/lib/api";
import { CHART_TYPES } from "@/lib/charts";
import { uid } from "@/lib/format";
import { MetricPicker } from "./KpiGrid";
import type { ChartSpec } from "./ChartCard";

export default function ChartBuilder({ ds, onAdd }: { ds: Dataset; onAdd: (s: ChartSpec) => void }) {
  const dims = ds.columns.filter((c) => c.type !== "empty");
  const amount = ds.columns.find((c) => c.role === "amount")?.name;
  const [metric, setMetric] = useState<any>(amount ? { op: "sum", col: amount } : { op: "count" });
  const [dim, setDim] = useState(dims.find((c) => c.type === "category")?.name || dims[0]?.name || "");
  const [grain, setGrain] = useState("month");
  const [dim2, setDim2] = useState("");
  const [type, setType] = useState("bar");
  const [topN, setTopN] = useState(10);
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [others, setOthers] = useState(false);
  const dimType = ds.columns.find((c) => c.name === dim)?.type;
  const fmtKind = metric.op === "count" || metric.op === "count_distinct" ? "int" : ds.columns.find((c) => c.name === metric.col)?.role === "amount" ? "money" : "auto";
  const effType = type === "heatmap" && !dim2 ? "bar" : type;

  const add = () => {
    const d = [{ col: dim, ...(dimType === "date" ? { grain } : {}) }, ...(dim2 ? [{ col: dim2 }] : [])];
    const title = `${metric.op === "count" ? "Registros" : metric.op === "count_distinct" ? `Únicos de ${metric.col}` : `${metric.op === "sum" ? "Suma" : metric.op === "avg" ? "Promedio" : metric.op === "median" ? "Mediana" : metric.op === "min" ? "Mínimo" : "Máximo"} de ${metric.col}`} por ${dim}${dim2 ? " y " + dim2 : ""}`;
    onAdd({ id: uid(), title, type: effType, metric, dims: d, topN: dim2 ? Math.max(topN, 40) : dimType === "date" ? 120 : topN, sort: dimType === "date" ? "asc" : sort, others: others && !dim2, kind: fmtKind });
  };

  return (
    <section className="card" aria-label="Constructor de visualizaciones">
      <div className="card-head"><div><h2>Constructor de visualizaciones</h2><div className="muted small">Elija indicador, variable, agrupación y tipo de gráfica. Responde a los mismos filtros.</div></div></div>
      <div className="card-pad">
        <div className="form-grid">
          <label className="field">1 · Indicador y variable a analizar<MetricPicker ds={ds} value={metric} onChange={setMetric} /></label>
          <label className="field">2 · Agrupar por<select className="select" value={dim} onChange={(e) => setDim(e.target.value)} id="cb-dim">{dims.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
          {dimType === "date" && <label className="field">Periodo (granularidad)<select className="select" value={grain} onChange={(e) => setGrain(e.target.value)}><option value="month">Mes</option><option value="quarter">Trimestre</option><option value="year">Año</option><option value="day">Día</option></select></label>}
          <label className="field">Segunda dimensión (opcional)<select className="select" value={dim2} onChange={(e) => setDim2(e.target.value)}><option value="">— ninguna —</option>{dims.filter((c) => c.name !== dim).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
          <label className="field">3 · Tipo de gráfica<select className="select" value={type} onChange={(e) => setType(e.target.value)} id="cb-type">{CHART_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}{t.needs2 ? " (requiere 2 dimensiones)" : ""}</option>)}</select></label>
          <label className="field">Mostrar<select className="select" value={topN} onChange={(e) => setTopN(+e.target.value)}><option value={5}>Top 5</option><option value={10}>Top 10</option><option value={15}>Top 15</option><option value={25}>Top 25</option><option value={50}>Top 50</option></select></label>
          <label className="field">Orden<select className="select" value={sort} onChange={(e) => setSort(e.target.value as any)}><option value="desc">Mayor a menor</option><option value="asc">Menor a mayor</option></select></label>
          <label className="field" style={{ justifyContent: "flex-end" }}><span className="row" style={{ textTransform: "none", fontWeight: 500, fontSize: 13, color: "var(--text)" }}><input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />Agrupar el resto en «Otros» (solo sumas/conteos)</span></label>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={add} id="cb-add" disabled={!dim || (metric.op !== "count" && !metric.col)}><Plus size={15} />Agregar al dashboard</button>
          {type === "heatmap" && !dim2 && <span className="small" style={{ color: "var(--warn)" }}>El mapa de calor necesita una segunda dimensión; se usará barras.</span>}
        </div>
      </div>
    </section>
  );
}
