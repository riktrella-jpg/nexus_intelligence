"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/state";
import { autoCharts } from "@/lib/autocharts";
import { uid } from "@/lib/format";
import FilterBar from "@/components/FilterBar";
import KpiGrid from "@/components/KpiGrid";
import ChartCard, { ChartSpec } from "@/components/ChartCard";
import ChartBuilder from "@/components/ChartBuilder";
import DataTable from "@/components/DataTable";
import { NoDataset } from "@/components/Notices";

export default function Dashboard() {
  const { active, applied, applyFilters, toast, setFilteredCount } = useApp();
  const [custom, setCustom] = useState<(ChartSpec & { viewId: string })[]>([]);
  const [autoOverride, setAutoOverride] = useState<Record<string, ChartSpec>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const auto = useMemo(() => (active ? autoCharts(active) : []), [active?.id, active?.columns.map((c) => c.role).join("|")]); // eslint-disable-line

  const loadCustom = () => active && api(`/api/datasets/${active.id}/views?kind=chart`).then((vs: any[]) => setCustom(vs.map((v) => ({ ...v.payload, id: v.id, viewId: v.id, title: v.name })))).catch(() => {});
  useEffect(() => { setRemoved(new Set()); setAutoOverride({}); setFilteredCount(null); loadCustom(); }, [active?.id]); // eslint-disable-line

  if (!active) return <><div className="page-head"><div><h1>Dashboard ejecutivo</h1></div></div><NoDataset /></>;

  const select = (col: string, key: string) => {
    const existing = applied.conds.find((c) => c.quick && c.col === col);
    const cur: string[] = existing?.op === "in" ? existing.value : [];
    const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
    const rest = applied.conds.filter((c) => !(c.quick && c.col === col));
    const isDate = active.columns.find((c) => c.name === col)?.type === "date";
    if (isDate) { // clic en un mes: filtrar rango de fechas
      const m = /^(\d{4})-(\d{2})$/.exec(key);
      if (m) { const last = new Date(+m[1], +m[2], 0).getDate(); applyFilters({ ...applied, conds: [...rest, { id: uid(), col, quick: true, op: "between", value: `${key}-01`, value2: `${key}-${String(last).padStart(2, "0")}` }] }); toast(`Filtro aplicado: ${col} = ${key}`); return; }
      return;
    }
    applyFilters({ ...applied, conds: next.length ? [...rest, { id: existing?.id || uid(), col, quick: true, op: "in", value: next }] : rest });
    toast(`Filtro ${next.includes(key) ? "aplicado" : "retirado"}: ${col} = ${key}`);
  };

  const addCustom = async (s: ChartSpec) => {
    const r: any = await api(`/api/datasets/${active.id}/views`, { body: { name: s.title, kind: "chart", payload: s } });
    setCustom((c) => [{ ...s, id: r.id, viewId: r.id }, ...c]);
    toast("Gráfica agregada al dashboard");
  };
  const latest = active.periods?.[active.periods.length - 1];
  const nonFlow = active.data_kind !== "movements";
  const hasPeriodFilter = applied.conds.some((c) => c.col === "_period");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{active.name}</h1>
          <p className="sub">{active.institution ? active.institution + " · " : ""}{active.row_count.toLocaleString("es-MX")} registros · Fecha de corte: {active.cutoff || "no indicada"} · {active.data_kind_label}</p>
        </div>
      </div>
      <FilterBar />
      <div className="stack" style={{ gap: 18 }}>
        {nonFlow && !hasPeriodFilter && (active.periods?.length || 0) > 1 && (
          <div className="alert warn" id="nonflow-warning"><div><b>Este conjunto es de tipo «{active.data_kind_label}».</b> Los periodos cargados no deben sumarse entre sí. Seleccione un periodo de carga para evitar duplicar importes.
            <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => applyFilters({ ...applied, conds: [...applied.conds, { id: uid(), col: "_period", quick: true, op: "in", value: [latest] }] })}>Usar solo el último periodo ({latest})</button></div></div></div>
        )}
        {active.warnings?.map((w) => <div className="alert warn" key={w}>{w}</div>)}
        {!active.procurement?.ready && <div className="alert info small">Perfil de contrataciones no activo: faltan los roles {active.procurement?.missing.join(" y ")}. Puede asignarlos en <a href="/settings"><u>Configuración → Diccionario de datos</u></a>. El dashboard genérico funciona igualmente con las columnas disponibles.</div>}
        <KpiGrid />
        <section className="charts" aria-label="Gráficas">
          {custom.map((s) => <ChartCard key={s.viewId} spec={s} onSelect={select} onChange={(n) => setCustom((c) => c.map((x) => (x.viewId === s.viewId ? { ...x, ...n } : x)))}
            onRemove={async () => { await api(`/api/views/${s.viewId}`, { method: "DELETE" }); setCustom((c) => c.filter((x) => x.viewId !== s.viewId)); }} />)}
          {auto.filter((s) => !removed.has(s.id)).map((s) => { const sp = autoOverride[s.id] || s; return <ChartCard key={s.id} spec={sp} onSelect={select} onChange={(n) => setAutoOverride({ ...autoOverride, [s.id]: n })} onRemove={() => setRemoved(new Set(removed).add(s.id))} />; })}
        </section>
        <ChartBuilder ds={active} onAdd={addCustom} />
        <DataTable />
      </div>
    </>
  );
}
