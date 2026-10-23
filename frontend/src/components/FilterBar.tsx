"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ChevronDown, Filter, Link2, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import { api, Cond, Dataset, FilterState, toApiFilter } from "@/lib/api";
import { OPS, opsFor, uid } from "@/lib/format";
import { useApp } from "@/lib/state";

const QUICK_ORDER = ["date", "institution", "admin_unit", "provider", "rfc", "contract_id", "procedure", "status", "category", "description", "amount", "quantity", "quantity_delivered"];
const TYPE_LABEL: Record<string, string> = { number: "Número", date: "Fecha", category: "Categoría", text: "Texto", identifier: "Clave" };

function useOutside(cb: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") cb(); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  });
  return ref;
}

const typeOf = (ds: Dataset, col: string) => (col === "_period" ? "category" : ds.columns.find((c) => c.name === col)?.type || "text");

function summary(c: Cond) {
  const v = Array.isArray(c.value) ? (c.value.length > 2 ? `${c.value.slice(0, 2).join(", ")} +${c.value.length - 2}` : c.value.join(", ")) : c.value;
  if (c.op === "between") return `${c.col} entre ${c.value} y ${c.value2}`;
  if (c.op === "isnull" || c.op === "notnull") return `${c.col} ${OPS[c.op]}`;
  return `${c.col} ${OPS[c.op]} ${v}`;
}

/** Selector múltiple con opciones en cascada: solo muestra valores compatibles con los demás filtros. */
export function MultiSelect({ ds, col, label, cond, onChange, ctxFilter, onUnpin, hideMode, compact }: {
  ds: Dataset; col: string; label: string; cond?: Cond; onChange: (v: string[], op: "in" | "not_in") => void;
  ctxFilter?: any; onUnpin?: () => void; hideMode?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cascade, setCascade] = useState(true);
  const [opts, setOpts] = useState<{ value: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useOutside(() => setOpen(false));
  const sel: string[] = Array.isArray(cond?.value) ? cond!.value : [];
  const mode: "in" | "not_in" = cond?.op === "not_in" ? "not_in" : "in";
  const ctxKey = JSON.stringify(cascade ? ctxFilter ?? null : null);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(() => api(`/api/datasets/${ds.id}/distinct`, { body: { col, search: q, limit: 80, filters: cascade ? ctxFilter ?? null : null } })
      .then(setOpts).catch(() => setOpts([])).finally(() => setLoading(false)), q ? 200 : 0);
    return () => clearTimeout(t);
  }, [open, q, col, ds.id, ctxKey]); // eslint-disable-line
  const toggle = (v: string) => onChange(sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v], mode);
  const missing = sel.filter((s) => !opts.some((o) => o.value === s));
  return (
    <div className="fchip-ctl" ref={ref}>
      <button className={"fbtn" + (sel.length ? " set" : "") + (mode === "not_in" && sel.length ? " excl" : "")} onClick={() => setOpen(!open)} aria-expanded={open}
        id={"filter-" + col.replace(/\W+/g, "_")} style={compact ? { maxWidth: "100%", width: "100%" } : undefined}>
        {onUnpin && <Pin size={12} className="pin-ic" />}
        <span className="lab">{label}</span>
        {sel.length > 0 && <span className="val">{mode === "not_in" ? "≠ " : ""}{sel.length === 1 ? sel[0] : `${sel.length} seleccionados`}</span>}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="popover" style={{ minWidth: 340 }}>
          {!hideMode && (
            <div className="seg" role="radiogroup" aria-label="Modo de filtro">
              <button className={mode === "in" ? "on" : ""} onClick={() => onChange(sel, "in")} role="radio" aria-checked={mode === "in"}>Incluir</button>
              <button className={mode === "not_in" ? "on" : ""} onClick={() => onChange(sel, "not_in")} role="radio" aria-checked={mode === "not_in"}>Excluir</button>
            </div>
          )}
          <div className="row" style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, color: "var(--muted)" }} />
            <input className="input" style={{ width: "100%", paddingLeft: 30 }} autoFocus placeholder={`Buscar en ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="cascade-toggle" title="Las opciones y sus conteos consideran los demás filtros que haya seleccionado">
            <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
            <Link2 size={12} /> Solo valores compatibles con los demás filtros
          </label>
          <div className={"opt-list" + (loading ? " loading" : "")}>
            {missing.map((v) => (
              <label className="opt" key={"m-" + v}>
                <input type="checkbox" checked onChange={() => toggle(v)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span><span className="n">0</span>
              </label>
            ))}
            {opts.length === 0 && !loading && <div className="muted small" style={{ padding: 10 }}>Sin coincidencias{cascade ? " con los filtros actuales" : ""}.</div>}
            {opts.map((o) => (
              <label className="opt" key={o.value}>
                <input type="checkbox" checked={sel.includes(o.value)} onChange={() => toggle(o.value)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.value}</span><span className="n">{o.count.toLocaleString("es-MX")}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 8, flexWrap: "wrap" }}>
            <span className="muted small">{opts.length >= 80 ? "Top 80 por frecuencia; use la búsqueda." : `${opts.length} opciones`}</span>
            <div className="row" style={{ gap: 4 }}>
              {opts.length > 0 && <button className="btn sm ghost" onClick={() => onChange(Array.from(new Set([...sel, ...opts.map((o) => o.value)])), mode)}>Todos visibles</button>}
              <button className="btn sm ghost" onClick={() => onChange([], mode)}>Limpiar</button>
              {onUnpin && <button className="btn sm ghost" onClick={() => { onUnpin(); setOpen(false); }} title="Quitar de la barra de filtros"><PinOff size={13} /></button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RangeControl({ label, type, cond, onChange, onUnpin, ds, col }: { label: string; type: "date" | "number"; cond?: Cond; onChange: (a: string, b: string) => void; onUnpin?: () => void; ds: Dataset; col: string }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<{ min?: any; max?: any } | null>(null);
  const ref = useOutside(() => setOpen(false));
  let a = "", b = "";
  if (cond) {
    if (cond.op === "between") { a = cond.value; b = cond.value2; }
    else if (cond.op === "gte") a = cond.value; else if (cond.op === "lte") b = cond.value;
  }
  useEffect(() => { if (open && !stats) api(`/api/datasets/${ds.id}/column-stats?col=${encodeURIComponent(col)}`).then(setStats).catch(() => setStats({})); }, [open]); // eslint-disable-line
  const set = !!(a || b);
  const presets: { l: string; a: string; b: string }[] = [];
  if (type === "date" && stats?.max) {
    const max = new Date(String(stats.max).slice(0, 10) + "T00:00:00");
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const y = max.getFullYear();
    const back = (days: number) => { const d = new Date(max); d.setDate(d.getDate() - days); return iso(d); };
    presets.push({ l: `Año ${y}`, a: `${y}-01-01`, b: `${y}-12-31` });
    const qn = Math.floor(max.getMonth() / 3);
    presets.push({ l: `T${qn + 1} ${y}`, a: iso(new Date(y, qn * 3, 1)), b: iso(new Date(y, qn * 3 + 3, 0)) });
    presets.push({ l: "Últimos 30 días", a: back(30), b: iso(max) });
    presets.push({ l: "Últimos 90 días", a: back(90), b: iso(max) });
  }
  return (
    <div className="fchip-ctl" ref={ref}>
      <button className={"fbtn" + (set ? " set" : "")} onClick={() => setOpen(!open)} aria-expanded={open} id={"filter-" + label.replace(/\W+/g, "_")}>
        {onUnpin && <Pin size={12} className="pin-ic" />}
        <span className="lab">{label}</span>{set && <span className="val">{a || "…"} – {b || "…"}</span>}<ChevronDown size={14} />
      </button>
      {open && (
        <div className="popover" style={{ minWidth: 320 }}>
          {presets.length > 0 && <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>{presets.map((p) => <button key={p.l} className="btn sm" onClick={() => onChange(p.a, p.b)}>{p.l}</button>)}</div>}
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label className="field">{type === "date" ? "Desde" : "Mínimo"}<input className="input" type={type === "date" ? "date" : "number"} value={a} onChange={(e) => onChange(e.target.value, b)} /></label>
            <label className="field">{type === "date" ? "Hasta" : "Máximo"}<input className="input" type={type === "date" ? "date" : "number"} value={b} onChange={(e) => onChange(a, e.target.value)} /></label>
          </div>
          {stats?.min != null && <div className="muted small" style={{ marginTop: 8 }}>Rango en los datos: {String(stats.min).slice(0, 10)} – {String(stats.max).slice(0, 10)}</div>}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 8, gap: 4 }}>
            <button className="btn sm ghost" onClick={() => onChange("", "")}>Limpiar</button>
            {onUnpin && <button className="btn sm ghost" onClick={() => { onUnpin(); setOpen(false); }} title="Quitar de la barra de filtros"><PinOff size={13} /></button>}
          </div>
        </div>
      )}
    </div>
  );
}

function AddFilter({ ds, exclude, onPin }: { ds: Dataset; exclude: Set<string>; onPin: (col: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useOutside(() => setOpen(false));
  const cols = ds.columns.filter((c) => c.type !== "empty" && !exclude.has(c.name) && c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fchip-ctl" ref={ref}>
      <button className="fbtn add" onClick={() => setOpen(!open)} id="filter-add-column" title="Agregar cualquier columna como filtro rápido"><Plus size={14} /><span className="lab">Columna</span></button>
      {open && (
        <div className="popover" style={{ minWidth: 320 }}>
          <div className="small muted" style={{ marginBottom: 8 }}>Fije cualquier columna en la barra para cruzarla con los demás filtros.</div>
          <input className="input" style={{ width: "100%" }} autoFocus placeholder="Buscar columna…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="opt-list">
            {cols.length === 0 && <div className="muted small" style={{ padding: 10 }}>No hay más columnas disponibles.</div>}
            {cols.map((c) => (
              <div className="opt" key={c.name} onClick={() => { onPin(c.name); setOpen(false); setQ(""); }} role="button">
                <Pin size={13} style={{ color: "var(--steel)" }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                <span className="n">{TYPE_LABEL[c.type] || c.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Advanced({ ds, draft, setDraft }: { ds: Dataset; draft: FilterState; setDraft: (f: FilterState) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  const adv = draft.conds.filter((c) => !c.quick);
  const cols = [...ds.columns.filter((c) => c.type !== "empty").map((c) => c.name), "_period"];
  const upd = (id: string, patch: Partial<Cond>) => setDraft({ ...draft, conds: draft.conds.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const add = () => setDraft({ ...draft, conds: [...draft.conds, { id: uid(), col: cols[0], op: opsFor(typeOf(ds, cols[0]))[0], value: "" }] });
  return (
    <div className="fchip-ctl" ref={ref}>
      <button className={"fbtn" + (adv.length ? " set" : "")} onClick={() => setOpen(!open)} id="filter-advanced"><Filter size={14} /><span className="lab">Filtro avanzado</span>{adv.length > 0 && <span className="val">{adv.length}</span>}</button>
      {open && (
        <div className="popover" style={{ width: 720, maxWidth: "92vw" }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <b className="small">Combinar condiciones con</b>
            <div className="seg" style={{ margin: 0 }}>
              <button className={draft.logic === "AND" ? "on" : ""} onClick={() => setDraft({ ...draft, logic: "AND" })}>Y · todas</button>
              <button className={draft.logic === "OR" ? "on" : ""} onClick={() => setDraft({ ...draft, logic: "OR" })}>O · alguna</button>
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {adv.length === 0 && <div className="muted small">Sin condiciones avanzadas. Agregue una para filtrar por cualquier columna del archivo (p. ej. importe mayor a X <i>o</i> proveedor contiene Y).</div>}
            {adv.map((c, i) => {
              const t = typeOf(ds, c.col);
              const ops = opsFor(t);
              const noVal = c.op === "isnull" || c.op === "notnull";
              const inType = t === "number" ? "number" : t === "date" ? "date" : "text";
              const isList = c.op === "in" || c.op === "not_in";
              return (
                <div className="row adv-row" key={c.id} style={{ gap: 6 }}>
                  <span className="logic-pill">{i === 0 ? "Si" : draft.logic === "AND" ? "Y" : "O"}</span>
                  <select className="select" style={{ flex: 1.2 }} value={c.col} aria-label="Columna" onChange={(e) => upd(c.id, { col: e.target.value, op: opsFor(typeOf(ds, e.target.value))[0], value: "", value2: "" })}>{cols.map((n) => <option key={n}>{n}</option>)}</select>
                  <select className="select" style={{ flex: 1 }} value={c.op} aria-label="Operador" onChange={(e) => upd(c.id, { op: e.target.value, value: e.target.value === "in" || e.target.value === "not_in" ? [] : "" })}>{ops.map((o) => <option key={o} value={o}>{OPS[o]}</option>)}</select>
                  {!noVal && (isList
                    ? <div style={{ flex: 1.4, minWidth: 0 }}><MultiSelect ds={ds} col={c.col} label="Valores" cond={{ ...c, op: "in" }} hideMode compact onChange={(v) => upd(c.id, { value: v })} /></div>
                    : <input className="input" style={{ flex: 1.2 }} type={inType} value={c.value ?? ""} onChange={(e) => upd(c.id, { value: e.target.value })} />)}
                  {c.op === "between" && <input className="input" style={{ flex: 1 }} type={inType} value={c.value2 ?? ""} onChange={(e) => upd(c.id, { value2: e.target.value })} />}
                  <button className="btn icon ghost" aria-label="Quitar condición" onClick={() => setDraft({ ...draft, conds: draft.conds.filter((x) => x.id !== c.id) })}><Trash2 size={15} /></button>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
            <button className="btn sm" onClick={add}><Plus size={14} />Agregar condición</button>
            <span className="muted small">Los filtros rápidos de la barra siempre se combinan con «Y».</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Saved({ ds }: { ds: Dataset }) {
  const { draft, applyFilters, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<any[]>([]);
  const [name, setName] = useState("");
  const ref = useOutside(() => setOpen(false));
  const load = () => api(`/api/datasets/${ds.id}/views?kind=filters`).then(setViews).catch(() => {});
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line
  const save = async () => {
    if (!name.trim()) return;
    await api(`/api/datasets/${ds.id}/views`, { body: { name: name.trim(), kind: "filters", payload: { filters: draft } } });
    setName(""); toast("Consulta guardada"); load();
  };
  return (
    <div className="fchip-ctl" ref={ref}>
      <button className="fbtn" onClick={() => setOpen(!open)} id="saved-queries"><Bookmark size={14} /><span className="lab">Consultas</span></button>
      {open && (
        <div className="popover" style={{ right: 0, left: "auto", minWidth: 320 }}>
          <div className="row"><input className="input" style={{ flex: 1 }} placeholder="Nombre para los filtros actuales" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} /><button className="btn sm primary" onClick={save} disabled={!name.trim()}>Guardar</button></div>
          <div className="opt-list">
            {views.length === 0 && <div className="muted small" style={{ padding: 10 }}>No hay consultas guardadas.</div>}
            {views.map((v) => (
              <div className="opt" key={v.id}>
                <span style={{ flex: 1 }} onClick={() => { applyFilters(v.payload.filters); setOpen(false); toast(`Consulta «${v.name}» aplicada`); }}>{v.name}</span>
                <button className="btn icon ghost sm" aria-label="Eliminar" onClick={async () => { await api(`/api/views/${v.id}`, { method: "DELETE" }); load(); }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FilterBar({ total }: { total?: number }) {
  const { active: ds, draft, setDraft, applied, apply, clear, applyFilters, filteredCount } = useApp();
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    if (!ds) return;
    try { setPinned(JSON.parse(localStorage.getItem("nexus.pinned." + ds.id) || "[]")); } catch { setPinned([]); }
  }, [ds?.id]); // eslint-disable-line
  const savePinned = (p: string[]) => { setPinned(p); if (ds) localStorage.setItem("nexus.pinned." + ds.id, JSON.stringify(p)); };

  const quick = useMemo(() => {
    if (!ds) return [] as { col: string; label: string; type: string; pinned?: boolean }[];
    const roleCols = QUICK_ORDER.map((r) => ds.columns.find((c) => c.role === r)).filter(Boolean) as Dataset["columns"];
    const out: { col: string; label: string; type: string; pinned?: boolean }[] = roleCols.map((c) => ({ col: c.name, label: c.name, type: c.type }));
    if ((ds.periods?.length || 0) > 1) out.unshift({ col: "_period", label: "Periodo de carga", type: "category" });
    for (const p of pinned) {
      const c = ds.columns.find((x) => x.name === p);
      if (c && !out.some((o) => o.col === p)) out.push({ col: c.name, label: c.name, type: c.type, pinned: true });
    }
    return out;
  }, [ds, pinned]);

  if (!ds) return null;
  const find = (col: string) => draft.conds.find((c) => c.quick && c.col === col);
  const setQuick = (col: string, next: Partial<Cond> | null) => {
    const rest = draft.conds.filter((c) => !(c.quick && c.col === col));
    setDraft({ ...draft, conds: next ? [...rest, { id: find(col)?.id || uid(), col, quick: true, op: "eq", ...next }] : rest });
  };
  const rangeSet = (col: string, a: string, b: string) => {
    if (!a && !b) return setQuick(col, null);
    if (a && b) return setQuick(col, { op: "between", value: a, value2: b });
    return setQuick(col, a ? { op: "gte", value: a } : { op: "lte", value: b });
  };
  // filtro de contexto para la cascada: todos los filtros del borrador excepto los de la propia columna
  const ctxFor = (col: string) => toApiFilter({ ...draft, conds: draft.conds.filter((c) => c.col !== col) });
  const unpin = (col: string) => { savePinned(pinned.filter((p) => p !== col)); setQuick(col, null); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const chips = applied.conds.filter((c) => c.col && (["isnull", "notnull"].includes(c.op) || (Array.isArray(c.value) ? c.value.length : c.value !== "" && c.value !== undefined)));

  return (
    <div className="filterbar" role="search" aria-label="Filtros globales">
      <div className="controls">
        {quick.map((q) => q.type === "date" || q.type === "number"
          ? <RangeControl key={q.col} ds={ds} col={q.col} label={q.label} type={q.type as any} cond={find(q.col)} onChange={(a, b) => rangeSet(q.col, a, b)} onUnpin={q.pinned ? () => unpin(q.col) : undefined} />
          : <MultiSelect key={q.col} ds={ds} col={q.col} label={q.label} cond={find(q.col)} ctxFilter={ctxFor(q.col)} onUnpin={q.pinned ? () => unpin(q.col) : undefined}
              onChange={(v, op) => setQuick(q.col, v.length ? { op, value: v } : null)} />)}
        <AddFilter ds={ds} exclude={new Set(quick.map((q) => q.col))} onPin={(c) => savePinned([...pinned, c])} />
        <Advanced ds={ds} draft={draft} setDraft={setDraft} />
        <button className={"btn " + (dirty ? "accent" : "primary")} onClick={apply} id="apply-filters">Aplicar filtros{dirty ? " •" : ""}</button>
        <button className="btn" onClick={clear} id="clear-filters" disabled={!draft.conds.length && !applied.conds.length}>Limpiar filtros</button>
        <Saved ds={ds} />
        <div className="result-count" aria-live="polite" id="result-count">
          <b>{(filteredCount ?? ds.row_count).toLocaleString("es-MX")}</b> de {(total ?? ds.row_count).toLocaleString("es-MX")} registros
        </div>
      </div>
      {chips.length > 0 && (
        <div className="active-chips" aria-label="Filtros activos">
          <span className="muted small">Filtros activos:</span>
          {chips.map((c) => (
            <span className={"chip" + (c.op === "not_in" || c.op === "neq" || c.op === "not_contains" ? " neg" : "")} key={c.id}>{summary(c)}
              <button aria-label={"Quitar " + c.col} onClick={() => applyFilters({ ...applied, conds: applied.conds.filter((x) => x.id !== c.id) })}><X size={11} /></button>
            </span>
          ))}
          {applied.conds.some((c) => !c.quick) && <span className="badge">Lógica avanzada: {applied.logic === "AND" ? "Y" : "O"}</span>}
        </div>
      )}
    </div>
  );
}
