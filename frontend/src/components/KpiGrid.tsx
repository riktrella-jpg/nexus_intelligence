"use client";
import { useEffect, useState } from "react";
import { Info, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, Dataset } from "@/lib/api";
import { useApp } from "@/lib/state";
import { fmt } from "@/lib/format";

type Kpi = { id: string; name: string; metric: any; unit: string; format: string; definition: string; value?: number | null; rows?: number; error?: string; custom?: string };

const OPS = [
  { id: "count", label: "Conteo de registros", needs: "none" },
  { id: "count_distinct", label: "Conteo único", needs: "any" },
  { id: "sum", label: "Suma", needs: "number" },
  { id: "avg", label: "Promedio", needs: "number" },
  { id: "median", label: "Mediana", needs: "number" },
  { id: "min", label: "Mínimo", needs: "numdate" },
  { id: "max", label: "Máximo", needs: "numdate" },
];

export function MetricPicker({ ds, value, onChange, label }: { ds: Dataset; value: any; onChange: (m: any) => void; label?: string }) {
  const op = OPS.find((o) => o.id === value.op) || OPS[0];
  const cols = ds.columns.filter((c) => op.needs === "number" ? c.type === "number" : op.needs === "numdate" ? ["number", "date"].includes(c.type) : op.needs === "any" ? c.type !== "empty" : false);
  return (
    <div className="row" style={{ gap: 6 }}>
      <select className="select" style={{ flex: 1 }} value={value.op} aria-label={(label || "") + " operación"} onChange={(e) => { const o = OPS.find((x) => x.id === e.target.value)!; const c = ds.columns.filter((c) => o.needs === "number" ? c.type === "number" : o.needs === "numdate" ? ["number", "date"].includes(c.type) : c.type !== "empty"); onChange(o.needs === "none" ? { op: o.id } : { op: o.id, col: c[0]?.name }); }}>
        {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {op.needs !== "none" && (
        <select className="select" style={{ flex: 1.4 }} value={value.col || ""} aria-label={(label || "") + " columna"} onChange={(e) => onChange({ op: value.op, col: e.target.value })}>
          {cols.length === 0 && <option value="">(sin columnas compatibles)</option>}
          {cols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      )}
    </div>
  );
}

function Builder({ ds, onClose, onSaved }: { ds: Dataset; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"simple" | "ratio">("simple");
  const [m, setM] = useState<any>({ op: "count" });
  const [num, setNum] = useState<any>({ op: "count" });
  const [den, setDen] = useState<any>({ op: "count" });
  const [fmtK, setFmtK] = useState("auto");
  const metric = mode === "simple" ? m : { op: "ratio", num, den };
  const valid = name.trim() && (mode === "simple" ? m.op === "count" || m.col : (num.op === "count" || num.col) && (den.op === "count" || den.col));
  const save = async () => {
    await api(`/api/datasets/${ds.id}/views`, { body: { name: name.trim(), kind: "kpi", payload: { metric, format: fmtK, unit: fmtK === "pct" ? "%" : "", definition: mode === "ratio" ? "Razón definida por el usuario: numerador / denominador (nulo si el denominador es cero)." : "Indicador definido por el usuario." } } });
    toast("Indicador guardado"); onSaved(); onClose();
  };
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-label="Constructor de indicadores">
        <div className="mh"><h2>Nuevo indicador</h2><button className="btn icon ghost" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="mb">
          <label className="field">Nombre<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Precio promedio por pieza" autoFocus /></label>
          <label className="field">Tipo<select className="select" value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="simple">Operación sobre un campo</option><option value="ratio">Razón / tasa (numerador ÷ denominador)</option></select></label>
          {mode === "simple" ? <MetricPicker ds={ds} value={m} onChange={setM} /> : (
            <>
              <label className="field">Numerador<MetricPicker ds={ds} value={num} onChange={setNum} label="numerador" /></label>
              <label className="field">Denominador<MetricPicker ds={ds} value={den} onChange={setDen} label="denominador" /></label>
            </>
          )}
          <label className="field">Formato<select className="select" value={fmtK} onChange={(e) => setFmtK(e.target.value)}><option value="auto">Número</option><option value="money">Moneda (MXN)</option><option value="pct">Porcentaje (razón × 100)</option><option value="int">Entero</option></select></label>
          <div className="alert info small">El indicador solo se calcula con campos compatibles; si faltan datos el resultado se muestra como «—» y no como cero.</div>
        </div>
        <div className="mf"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save} disabled={!valid}>Guardar indicador</button></div>
      </div>
    </>
  );
}

export default function KpiGrid() {
  const { active, apiFilter, track, applied } = useApp();
  const router = useRouter();
  const [suggested, setSuggested] = useState<Kpi[]>([]);
  const [custom, setCustom] = useState<Kpi[]>([]);
  const [vals, setVals] = useState<Kpi[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  const loadCustom = () => active && api(`/api/datasets/${active.id}/views?kind=kpi`).then((vs: any[]) => setCustom(vs.map((v) => ({ id: v.id, name: v.name, custom: v.id, ...v.payload })))).catch(() => {});
  useEffect(() => { if (!active) return; api(`/api/datasets/${active.id}/suggested-kpis`).then(setSuggested).catch((e) => setErr(e.message)); loadCustom(); }, [active?.id]); // eslint-disable-line
  useEffect(() => {
    if (!active || !suggested.length) return;
    let cancel = false;
    track(api(`/api/datasets/${active.id}/kpis`, { body: { filters: apiFilter, kpis: [...suggested, ...custom] } }))
      .then((r: any) => { if (!cancel) { setVals(r.kpis); setErr(null); } }).catch((e) => !cancel && setErr(e.message));
    return () => { cancel = true; };
  }, [active?.id, apiFilter, suggested, custom]); // eslint-disable-line

  if (!active) return null;
  const period = applied.conds.some((c) => c.col === "_period") ? "Periodo(s) filtrados" : active.periods?.length ? `Periodos: ${active.periods.join(", ")}` : "";
  const attn = new Set(["pending", "excess"]);
  return (
    <section aria-label="Indicadores principales" className="stack" style={{ gap: 10 }}>
      {err && <div className="alert err">{err}</div>}
      <div className="kpi-grid">
        {(vals || suggested.map((k) => ({ ...k, value: undefined }))).map((k) => (
          <div key={k.id} className={"card kpi" + (attn.has(k.id) ? " attn" : k.id === "amount_sum" ? " gold" : "")} role="button" tabIndex={0} id={"kpi-" + k.id}
            onClick={() => router.push("/explorer")} onKeyDown={(e) => e.key === "Enter" && router.push("/explorer")} title={`${k.definition}\n\nClic para ver los registros que componen esta cifra.`}>
            <div className="k-name"><span>{k.name}</span>
              {k.custom && <button className="btn icon ghost sm" style={{ padding: 2 }} aria-label="Eliminar indicador" onClick={async (e) => { e.stopPropagation(); await api(`/api/views/${k.custom}`, { method: "DELETE" }); loadCustom(); }}><X size={13} /></button>}
              {!k.custom && <Info size={13} />}</div>
            {k.value === undefined && !k.error ? <div className="skeleton" style={{ height: 32, marginTop: 8, width: "70%" }} /> :
              <div className="k-val">{k.error ? <span style={{ fontSize: 13, color: "var(--burgundy)" }}>No disponible</span> : fmt(k.value as number, k.format)}<span className="k-unit">{k.value != null && k.unit !== "%" ? k.unit : ""}</span></div>}
            <div className="k-foot">{k.error ? k.error : `${period}${period ? " · " : ""}${(k.rows ?? 0).toLocaleString("es-MX")} reg.`}</div>
          </div>
        ))}
        <button className="card kpi" onClick={() => setShowBuilder(true)} id="new-kpi" style={{ display: "grid", placeItems: "center", color: "var(--deep)", borderStyle: "dashed" }}>
          <span className="row"><Plus size={16} /> Nuevo indicador</span>
        </button>
      </div>
      {showBuilder && <Builder ds={active} onClose={() => setShowBuilder(false)} onSaved={loadCustom} />}
    </section>
  );
}
