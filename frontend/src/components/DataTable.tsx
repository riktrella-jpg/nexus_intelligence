"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search, X, ArrowUp, ArrowDown } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApp } from "@/lib/state";
import { fmt, fmtDate } from "@/lib/format";

export function RecordDrawer({ rowId, onClose }: { rowId: number; onClose: () => void }) {
  const { active } = useApp();
  const [rec, setRec] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api(`/api/datasets/${active!.id}/records/${rowId}`).then(setRec).catch((e) => setErr(e.message)); }, [rowId, active]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Detalle del registro">
        <div className="dh"><div><h2>Registro #{rowId}</h2><div className="muted small">Trazabilidad al archivo de origen</div></div><button className="btn icon ghost" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="db">
          {err && <div className="alert err">{err}</div>}
          {!rec && !err && <div className="skeleton" style={{ height: 200 }} />}
          {rec && (
            <div className="stack">
              <div className="alert info">
                <div><b>Origen:</b> {rec.source.file || "—"} {rec.source.sheet && rec.source.sheet !== "(CSV)" ? `· hoja «${rec.source.sheet}»` : ""} · periodo {rec.source.period || "—"}
                  {rec.typed._issues && <div style={{ marginTop: 6, color: "var(--burgundy)" }}><b>Observaciones de calidad:</b> {rec.typed._issues}</div>}</div>
              </div>
              <table className="t"><thead><tr><th style={{ cursor: "default" }}>Campo</th><th style={{ cursor: "default" }}>Valor en el análisis</th><th style={{ cursor: "default" }}>Valor original</th></tr></thead>
                <tbody>{active!.columns.map((c) => {
                  const t = rec.typed[c.name], o = rec.original[c.name];
                  const changed = o != null && String(t ?? "") !== String(o);
                  return <tr key={c.name} style={{ cursor: "default" }}><td><b>{c.name}</b></td><td className={c.type === "number" ? "num" : ""}>{c.type === "number" ? fmt(t) : String(t ?? "—")}</td><td style={{ color: changed ? "var(--warn)" : "var(--muted)" }}>{o ?? "—"}</td></tr>;
                })}</tbody></table>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export default function DataTable({ title = "Detalle de registros", pageSize = 50, maxHeight = 520 }: { title?: string; pageSize?: number; maxHeight?: number }) {
  const { active, apiFilter, track, setFilteredCount, toast } = useApp();
  const [limit, setLimit] = useState(pageSize);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<string | null>(null);
  const [desc, setDesc] = useState(false);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ total: number; rows: any[]; ms: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(0); }, [apiFilter, active?.id]);
  useEffect(() => {
    if (!active) return;
    let cancel = false;
    track(api(`/api/datasets/${active.id}/rows`, { body: { filters: apiFilter, search: q || null, sort, desc, offset: page * limit, limit } }))
      .then((r: any) => { if (!cancel) { setData(r); setErr(null); setFilteredCount(r.total); } })
      .catch((e) => !cancel && setErr(e.message));
    return () => { cancel = true; };
  }, [active, apiFilter, q, sort, desc, page, limit]); // eslint-disable-line

  if (!active) return null;
  const cols = active.columns;
  const isAll = limit >= 100000;
  const effectiveLimit = isAll ? Math.max(1, data?.total || 1) : limit;
  const pages = isAll ? 1 : (data ? Math.max(1, Math.ceil(data.total / effectiveLimit)) : 1);
  const th = (name: string) => { if (sort === name) { if (!desc) setDesc(true); else { setSort(null); setDesc(false); } } else { setSort(name); setDesc(false); } };

  return (
    <section className="card" aria-label={title}>
      <div className="card-head">
        <div><h2>{title}</h2><div className="muted small">{data ? `${data.total.toLocaleString("es-MX")} registros · ${data.ms} ms` : "Cargando…"}</div></div>
        <div className="row">
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--muted)" }} />
            <input className="input" style={{ paddingLeft: 30, width: 240 }} placeholder="Buscar en texto…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar en registros" />
          </div>
          <button className="btn" onClick={() => download(`/api/datasets/${active.id}/export.csv`, { filters: apiFilter, search: q || null }, "seleccion.csv").then(() => toast("Descarga generada con TODOS los registros de la selección")).catch((e) => toast(e.message, true))}><Download size={15} />Exportar CSV</button>
        </div>
      </div>
      {err && <div className="alert err" style={{ margin: 14 }}>{err}</div>}
      <div className="table-wrap" style={{ maxHeight }}>
        <table className="t">
          <thead><tr>
            <th style={{ cursor: "default" }}>#</th>
            {cols.map((c) => (
              <th key={c.name} onClick={() => th(c.name)} className={c.type === "number" ? "right" : ""} title={`Tipo: ${c.type}${c.role ? " · Rol: " + active.role_labels[c.role] : ""}`} aria-sort={sort === c.name ? (desc ? "descending" : "ascending") : "none"}>
                {c.name} {sort === c.name && (desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
              </th>))}
          </tr></thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r._row_id} className={r._issues ? "issue" : ""} onClick={() => setOpen(r._row_id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(r._row_id)} title={r._issues || "Clic para ver el detalle y el valor original"}>
                <td className="muted">{r._row_id}</td>
                {cols.map((c) => <td key={c.name} className={c.type === "number" ? "num" : ""}>{c.type === "number" ? fmt(r[c.name]) : c.type === "date" ? (r[c.name] ?? "—") : (r[c.name] ?? "—")}</td>)}
              </tr>))}
            {data && data.rows.length === 0 && <tr><td colSpan={cols.length + 1}><div className="empty"><b>No hay registros con los filtros actuales</b><span>Limpie o ajuste los filtros para ver resultados.</span></div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="btn sm icon" disabled={isAll || page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft size={15} /></button>
        <span>
          {isAll ? (
            <b>Mostrando todos los movimientos ({(data?.total || 0).toLocaleString("es-MX")})</b>
          ) : (
            `Página ${page + 1} de ${pages.toLocaleString("es-MX")} · ${data?.rows.length || 0} de ${(data?.total || 0).toLocaleString("es-MX")}`
          )}
        </span>
        <button className="btn sm icon" disabled={isAll || page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Página siguiente"><ChevronRight size={15} /></button>
        <select
          className="select"
          value={limit >= 100000 ? 100000 : limit}
          onChange={(e) => {
            const nl = parseInt(e.target.value);
            setLimit(nl);
            setPage(0);
          }}
          style={{ padding: "0.2rem 0.5rem", fontSize: "0.8rem", marginLeft: "auto" }}
          aria-label="Registros por página"
        >
          <option value={25}>25 filas</option>
          <option value={50}>50 filas</option>
          <option value={100}>100 filas</option>
          <option value={250}>250 filas</option>
          <option value={500}>500 filas</option>
          <option value={1000}>1,000 filas</option>
          <option value={100000}>Todos los movimientos ({data?.total?.toLocaleString("es-MX") || 0})</option>
        </select>
        <span className="hide-sm" style={{ fontSize: 11, color: "var(--muted)" }}>Borde vino = observaciones</span>
      </div>
      {open !== null && <RecordDrawer rowId={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
