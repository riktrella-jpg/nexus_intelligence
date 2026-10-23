"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Image as ImageIcon, Maximize2, Minimize2, Save, Table2, BarChart3, X } from "lucide-react";
import EChart, { EChartHandle } from "./EChart";
import { api } from "@/lib/api";
import { useApp } from "@/lib/state";
import { buildOption, CHART_TYPES, rowsToCsv, AggRow } from "@/lib/charts";
import { fmt } from "@/lib/format";

export type ChartSpec = {
  id: string; title: string; type: string; metric: any; dims: { col: string; grain?: string }[];
  topN: number; sort: "asc" | "desc"; others?: boolean; kind: string; note?: string;
};

export default function ChartCard({ spec, onSelect, onRemove, onSave, onChange }: {
  spec: ChartSpec; onSelect?: (col: string, key: string) => void; onRemove?: () => void; onSave?: () => void; onChange?: (s: ChartSpec) => void;
}) {
  const { active, apiFilter, track } = useApp();
  const [res, setRes] = useState<{ rows: AggRow[]; metric: string; additive: boolean; total: number | null; rows_considered: number; ms: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [asTable, setAsTable] = useState(spec.type === "table");
  const [full, setFull] = useState(false);
  const ref = useRef<EChartHandle>(null);

  useEffect(() => {
    if (!active) return;
    let cancel = false;
    setLoading(true); setErr(null);
    track(api(`/api/datasets/${active.id}/aggregate`, { body: {
      metric: spec.metric, group_by: spec.dims, filters: apiFilter, top_n: spec.topN, sort: spec.sort, include_others: !!spec.others,
      sort_by_label: false } }))
      .then((r: any) => { if (!cancel) setRes(r); })
      .catch((e) => { if (!cancel) { setErr(e.message); setRes(null); } })
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [active?.id, apiFilter, JSON.stringify(spec)]); // eslint-disable-line

  const type = asTable ? "table" : spec.type;
  const option = useMemo(() => res && type !== "table" ? buildOption(type, res.rows, { kind: spec.kind, metricLabel: res.metric, additive: res.additive }) : null, [res, type, spec.kind]);
  const dimNames = spec.dims.map((d) => d.col);

  const body = () => {
    if (err) return <div className="empty"><b style={{ color: "var(--burgundy)" }}>No se pudo calcular</b><span>{err}</span></div>;
    if (!res) return <div className="skeleton" style={{ height: 260, margin: 14 }} />;
    if (res.rows.length === 0) return <div className="empty"><b>Sin datos para esta selección</b><span>Los filtros activos no dejan registros con valores en esta variable. Modifique o limpie los filtros.</span></div>;
    if (type === "table") {
      return (
        <div className="table-wrap" style={{ maxHeight: full ? "75vh" : 300 }}>
          <table className="t"><thead><tr>{dimNames.map((d) => <th key={d}>{d}</th>)}<th className="right">{res.metric}</th>{res.additive && <th className="right">Participación</th>}<th className="right">Registros</th></tr></thead>
            <tbody>{res.rows.map((r, i) => (
              <tr key={i} onClick={() => onSelect?.(dimNames[0], r.keys[0])}>
                {r.keys.map((k, j) => <td key={j}>{k}</td>)}
                <td className="num">{fmt(r.value as number, spec.kind)}</td>
                {res.additive && <td className="num">{r.share != null ? (r.share * 100).toFixed(1) + "%" : "—"}</td>}
                <td className="num">{r.rows}</td></tr>))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <div style={{ height: full ? "100%" : 300, opacity: loading ? 0.55 : 1, transition: "opacity .15s" }}>
        <EChart ref={ref} option={option} onClick={(p) => {
          if (!onSelect) return;
          if (type === "heatmap") { const d = p.data as number[]; const xs = res.rows.map((r) => r.keys[0]); onSelect(dimNames[0], Array.from(new Set(xs))[d[0]]); return; }
          const row = res.rows.find((r) => r.label === p.name); if (row && row.keys[0] !== "Otros") onSelect(dimNames[0], row.keys[0]);
        }} />
      </div>
    );
  };

  const png = () => { const u = ref.current?.png(); if (!u) return; const a = document.createElement("a"); a.href = u; a.download = spec.title.replace(/\W+/g, "_") + ".png"; a.click(); };
  const csv = () => { if (!res) return; const b = new Blob([rowsToCsv(res.rows, dimNames, res.metric)], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = spec.title.replace(/\W+/g, "_") + ".csv"; a.click(); };

  return (
    <>
      {full && <div className="backdrop" onClick={() => setFull(false)} />}
      <section className={"card chart-card" + (full ? " full" : "")} aria-label={spec.title}>
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spec.title}</h2>
            <div className="muted small">{res ? `${res.metric} · ${res.rows_considered.toLocaleString("es-MX")} registros considerados · ${res.ms} ms` : "Calculando…"}</div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {onChange && (
              <select className="select" style={{ padding: "4px 6px", fontSize: 12 }} value={spec.type} aria-label="Tipo de gráfica"
                onChange={(e) => { setAsTable(e.target.value === "table"); onChange({ ...spec, type: e.target.value }); }}>
                {CHART_TYPES.filter((t) => !t.needs2 || spec.dims.length > 1).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
            <button className="btn icon ghost" title={asTable ? "Ver gráfica" : "Ver tabla"} onClick={() => setAsTable(!asTable)}>{asTable ? <BarChart3 size={16} /> : <Table2 size={16} />}</button>
            <button className="btn icon ghost" title="Descargar imagen" onClick={png} disabled={asTable || !option}><ImageIcon size={16} /></button>
            <button className="btn icon ghost" title="Exportar datos (CSV)" onClick={csv} disabled={!res}><Download size={16} /></button>
            {onSave && <button className="btn icon ghost" title="Guardar en vistas" onClick={onSave}><Save size={16} /></button>}
            <button className="btn icon ghost" title={full ? "Salir de vista completa" : "Vista completa"} onClick={() => setFull(!full)}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            {onRemove && <button className="btn icon ghost" title="Quitar" onClick={onRemove}><X size={16} /></button>}
          </div>
        </div>
        <div className="body">{body()}</div>
        {spec.note && <div className="muted small" style={{ padding: "0 18px 12px" }}>{spec.note}</div>}
      </section>
    </>
  );
}
