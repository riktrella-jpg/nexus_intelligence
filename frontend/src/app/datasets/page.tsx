"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Trash2 } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApp } from "@/lib/state";
import { fmtDate } from "@/lib/format";
import Importer from "@/components/Importer";

function Quality() {
  const { active, track, toast } = useApp();
  const [q, setQ] = useState<any>(null);
  useEffect(() => { if (active) track(api(`/api/datasets/${active.id}/quality`)).then(setQ).catch(() => setQ(null)); }, [active?.id, active?.row_count]); // eslint-disable-line
  if (!active || !q) return null;
  const pct = (n: number) => (q.total ? ((n / q.total) * 100).toFixed(1) + "%" : "—");
  return (
    <section className="card" aria-label="Calidad de datos" id="quality">
      <div className="card-head"><div><h2>Calidad de datos · {active.name}</h2><div className="muted small">No se corrige ningún dato automáticamente; las observaciones se señalan para su revisión.</div></div>
        <button className="btn" disabled={q.with_issues === 0} onClick={() => download(`/api/datasets/${active.id}/quality/review.csv`, null, "registros_para_revision.csv").catch((e) => toast(e.message, true))}><Download size={15} />Registros a revisar (CSV)</button></div>
      <div className="card-pad stack">
        <div className="kpi-grid">
          {[["Registros recibidos", q.total, ""], ["Registros sin observaciones", q.valid, pct(q.valid)], ["Con observaciones", q.with_issues, pct(q.with_issues)], ["Duplicados exactos", q.exact_duplicates, ""], ["Columnas sin homologar", q.unmapped_columns.length, `de ${q.columns.length}`]].map(([k, v, s]) => (
            <div key={k as string} className={"card kpi" + (k === "Con observaciones" && (v as number) > 0 ? " attn" : "")} style={{ cursor: "default" }}><div className="k-name">{k}</div><div className="k-val">{(v as number).toLocaleString("es-MX")}</div><div className="k-foot">{s}</div></div>))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
          <div>
            <h3>Bitácora de observaciones</h3>
            {q.issues.length === 0 ? <p className="muted small" style={{ marginTop: 8 }}>No se detectaron observaciones en los campos evaluados.</p> :
              <table className="t" style={{ marginTop: 8 }}><thead><tr><th style={{ cursor: "default" }}>Observación</th><th className="right" style={{ cursor: "default" }}>Registros</th></tr></thead>
                <tbody>{q.issues.map((i: any) => <tr key={i.issue} style={{ cursor: "default" }}><td>{i.issue}</td><td className="num">{i.count.toLocaleString("es-MX")}</td></tr>)}</tbody></table>}
          </div>
          <div>
            <h3>Cobertura por columna</h3>
            <div className="table-wrap" style={{ maxHeight: 320, marginTop: 8 }}>
              <table className="t"><thead><tr><th style={{ cursor: "default" }}>Columna</th><th style={{ cursor: "default" }}>Tipo</th><th style={{ cursor: "default" }}>Rol</th><th className="right" style={{ cursor: "default" }}>Cobertura</th></tr></thead>
                <tbody>{q.columns.map((c: any) => <tr key={c.name} style={{ cursor: "default" }}><td>{c.name}</td><td>{c.type}</td><td>{c.role ? active.role_labels[c.role] : <span className="badge warn">sin homologar</span>}</td><td className="num">{c.coverage != null ? (c.coverage * 100).toFixed(1) + "%" : "—"}</td></tr>)}</tbody></table>
            </div>
          </div>
        </div>
        <div>
          <h3>Historial de importaciones</h3>
          <div className="table-wrap" style={{ maxHeight: 280, marginTop: 8 }}>
            <table className="t"><thead><tr>{["Fecha", "Archivo", "Periodo", "Modo", "Recibidas", "Incorporadas", "Omitidas", "Reemplazadas", "Con observ."].map((h) => <th key={h} style={{ cursor: "default" }}>{h}</th>)}</tr></thead>
              <tbody>{[...q.imports].reverse().map((i: any) => <tr key={i.id} style={{ cursor: "default" }}><td>{fmtDate(i.created_at)}</td><td>{i.filename}</td><td>{i.period}</td><td>{i.mode}</td><td className="num">{i.rows_received}</td><td className="num">{i.rows_added}</td><td className="num">{i.rows_skipped}</td><td className="num">{i.rows_updated}</td><td className="num">{i.rows_invalid}</td></tr>)}</tbody></table>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DatasetsPage() {
  const { datasets, active, setActiveId, refresh, toast } = useApp();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (d: any) => {
    const ok = window.confirm(
      `¿Desea eliminar permanentemente el conjunto de datos «${d.name}» (${d.row_count.toLocaleString("es-MX")} registros)?\n\nEsta acción borrará sus archivos de datos y vistas asociadas.`
    );
    if (!ok) return;

    try {
      setDeletingId(d.id);
      await api(`/api/datasets/${d.id}`, { method: "DELETE" });
      toast(`Conjunto de datos «${d.name}» eliminado.`);
      await refresh();
    } catch (e: any) {
      toast(e.message || "Error al eliminar conjunto de datos", true);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="page-head"><div><h1>Bases de datos</h1><p className="sub">Administre los conjuntos de datos y cargue archivos mensuales sin modificar código.</p></div></div>
      <div className="stack" style={{ gap: 20 }}>
        <Importer />
        <section className="card" aria-label="Conjuntos de datos">
          <div className="card-head"><h2>Conjuntos de datos</h2></div>
          {datasets.length === 0 ? <div className="empty"><b>No hay conjuntos de datos</b><span>Importe su primer archivo con el panel superior.</span></div> :
            <div className="table-wrap"><table className="t" id="datasets-table"><thead><tr>{["Nombre", "Institución", "Naturaleza", "Registros", "Última actualización", ""].map((h) => <th key={h} style={{ cursor: "default" }}>{h}</th>)}</tr></thead>
              <tbody>{datasets.map((d) => (
                <tr key={d.id} style={{ cursor: "default" }}>
                  <td><b>{d.name}</b> {active?.id === d.id && <span className="badge ok">activo</span>}</td><td>{d.institution || "—"}</td><td>{d.data_kind_label?.split("(")[0]}</td>
                  <td className="num">{d.row_count.toLocaleString("es-MX")}</td><td>{fmtDate(d.updated_at)}</td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}>
                    <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                      <button className="btn sm" onClick={() => setActiveId(d.id)} disabled={active?.id === d.id}>Activar</button>
                      <Link className="btn sm primary" href="/dashboard" onClick={() => setActiveId(d.id)}>Dashboard</Link>
                      <button
                        className="btn sm icon ghost"
                        onClick={() => handleDelete(d)}
                        disabled={deletingId === d.id}
                        title={`Eliminar «${d.name}»`}
                        aria-label={`Eliminar conjunto ${d.name}`}
                        style={{ color: "var(--burgundy)", borderColor: "rgba(101, 30, 50, 0.25)" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>))}</tbody></table></div>}
        </section>
        <Quality />
      </div>
    </>
  );
}
