"use client";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud, X } from "lucide-react";
import { api, Dataset } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useApp } from "@/lib/state";

type Staged = { upload_id: string; filename: string; size: number; format: string; sheets: string[] };
const TYPE_LABEL: Record<string, string> = { number: "Número", date: "Fecha", identifier: "Identificador", category: "Categoría", text: "Texto", empty: "Vacía" };
const MODE_LABEL: Record<string, string> = {
  append: "Agregar (omite registros ya incorporados)", update: "Actualizar por llave (reemplaza registros con la misma llave)",
  replace_period: "Reemplazar un periodo completo (requiere autorización)",
};

export default function Importer() {
  const { datasets, refresh, toast, track } = useApp();
  const [queue, setQueue] = useState<File[]>([]);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [prev, setPrev] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const [target, setTarget] = useState("new");
  const [sheet, setSheet] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [f, setF] = useState({ name: "", institution: "", source: "", period: "", cutoff: "", data_kind: "movements", mode: "append" });
  const [keys, setKeys] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [ack, setAck] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const ds: Dataset | undefined = datasets.find((d) => d.id === target);

  const loadPreview = async (st: Staged, sh: string, hr: number, tgt: string) => {
    setErr(null);
    try {
      const p: any = await track(api(`/api/uploads/${st.upload_id}/preview?sheet=${encodeURIComponent(sh)}&header_row=${hr}${tgt !== "new" ? "&dataset_id=" + tgt : ""}`));
      setPrev(p); setMapping(p.proposed_mapping); setAck(false);
    } catch (e: any) { setPrev(null); setErr(e.message); }
  };

  const startFile = async (file: File) => {
    setErr(null); setResult(null); setPrev(null); setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const st: Staged = await track(api("/api/uploads", { form: fd }));
      setStaged(st); setSheet(st.sheets[0]); setHeaderRow(1);
      setF((x) => ({ ...x, name: x.name || file.name.replace(/\.[^.]+$/, "") }));
      await loadPreview(st, st.sheets[0], 1, target);
    } catch (e: any) { setErr(e.message); setStaged(null); } finally { setBusy(false); }
  };

  const take = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setQueue(arr);
    startFile(arr[0]);
  };

  const next = () => {
    const rest = queue.slice(1);
    setQueue(rest); setStaged(null); setPrev(null); setResult(null);
    if (rest.length) startFile(rest[0]);
  };

  const ambiguous = (prev?.columns || []).filter((c: any) => c.ambiguous);
  const canImport = staged && prev && !busy && (target === "new" ? f.name.trim() : true) && (!ambiguous.length || ack) && (f.mode !== "update" || keys.length > 0 || (ds?.key_cols?.length ?? 0) > 0) && (f.mode !== "replace_period" || (confirmReplace && f.period.trim()));

  const commit = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { upload_id: staged!.upload_id, sheet, header_row: headerRow, dataset_id: target === "new" ? undefined : target, dataset_name: f.name,
        institution: f.institution, source: f.source, period: f.period, cutoff: f.cutoff, data_kind: f.data_kind, mode: target === "new" ? "new" : f.mode,
        key_cols: keys, mapping, confirm_replace: confirmReplace };
      const r: any = await track(api("/api/imports", { body }));
      setResult(r); await refresh(r.dataset_id);
      toast("Importación completada");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const setRole = (col: string, role: string) => {
    const m = { ...mapping };
    if (role) Object.keys(m).forEach((k) => { if (m[k] === role) delete m[k]; });
    if (role) m[col] = role; else delete m[col];
    setMapping(m);
  };

  const step = result ? 3 : staged ? 2 : 1;
  return (
    <section className="card" aria-label="Importador de archivos" id="importer">
      <div className="card-head"><div><h2>Importar archivos</h2><div className="muted small">XLSX, XLSB y CSV · varias hojas · cargas múltiples · nunca se sobrescribe sin su autorización</div></div></div>
      <div className="card-pad stack">
        <div className="steps">
          {["Archivos", "Hoja, campos y metadatos", "Resultado"].map((s, i) => (
            <div key={s} className={"step" + (step === i + 1 ? " on" : step > i + 1 ? " done" : "")}><span className="n">{i + 1}</span>{s}</div>
          ))}
        </div>

        {err && <div className="alert err" role="alert" id="import-error"><AlertTriangle size={16} /><div>{err}</div></div>}

        {step === 1 && (
          <div className={"dropzone" + (over ? " over" : "")} id="dropzone"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }} onClick={() => input.current?.click()}
            role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}>
            <UploadCloud size={34} color="var(--gold)" />
            <p style={{ fontWeight: 600, color: "var(--navy)", marginTop: 8 }}>{busy ? "Leyendo archivo…" : "Arrastre sus archivos aquí o haga clic para seleccionarlos"}</p>
            <p className="muted small">Formatos admitidos: .xlsx · .xlsb · .csv — Puede seleccionar varios; se procesarán uno a uno.</p>
            <input ref={input} id="file-input" type="file" multiple hidden accept=".xlsx,.xlsm,.xlsb,.csv,.txt" onChange={(e) => e.target.files && take(e.target.files)} />
          </div>
        )}

        {step === 2 && staged && (
          <div className="stack" style={{ gap: 18 }}>
            <div className="row wrap" style={{ gap: 14 }}>
              <FileSpreadsheet size={22} color="var(--deep)" />
              <div><b>{staged.filename}</b><div className="muted small">{bytes(staged.size)} · formato {staged.format.toUpperCase()} · {staged.sheets.length} hoja(s){queue.length > 1 ? ` · archivo 1 de ${queue.length}` : ""}</div></div>
              <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => { setStaged(null); setPrev(null); setQueue([]); }}>Cancelar</button>
            </div>

            <div className="form-grid">
              <label className="field">Destino
                <select className="select" id="imp-target" value={target} onChange={(e) => { setTarget(e.target.value); loadPreview(staged, sheet, headerRow, e.target.value); if (e.target.value !== "new") setF((x) => ({ ...x, mode: "append" })); }}>
                  <option value="new">Crear nuevo conjunto de datos</option>
                  {datasets.map((d) => <option key={d.id} value={d.id}>Agregar a: {d.name}</option>)}
                </select></label>
              {staged.sheets.length > 1 && <label className="field">Hoja<select className="select" value={sheet} onChange={(e) => { setSheet(e.target.value); loadPreview(staged, e.target.value, headerRow, target); }}>{staged.sheets.map((s) => <option key={s}>{s}</option>)}</select></label>}
              <label className="field">Fila de encabezados<input className="input" type="number" min={1} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, +e.target.value))} onBlur={() => loadPreview(staged, sheet, headerRow, target)} /></label>
              {target === "new" ? (
                <label className="field">Nombre del conjunto<input className="input" id="imp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              ) : (
                <label className="field">Modo de carga<select className="select" id="imp-mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              )}
              <label className="field">Institución<input className="input" value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} placeholder={ds?.institution || ""} /></label>
              <label className="field">Origen / fuente<input className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder={ds?.source || ""} /></label>
              <label className="field">Periodo (p. ej. 2026-01)<input className="input" id="imp-period" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></label>
              <label className="field">Fecha de corte<input className="input" type="date" value={f.cutoff} onChange={(e) => setF({ ...f, cutoff: e.target.value })} /></label>
              {target === "new" && <label className="field">Naturaleza de los datos<select className="select" value={f.data_kind} onChange={(e) => setF({ ...f, data_kind: e.target.value })}>
                <option value="movements">Movimientos (se suman entre meses)</option><option value="balances">Saldos (no se suman)</option>
                <option value="cumulative">Corte acumulado (incluye meses anteriores)</option><option value="snapshot">Fotografía de situación</option></select></label>}
            </div>

            {target !== "new" && prev?.schema_diff && (
              <div className="alert info"><div><b>Comparación con la estructura existente.</b>
                <div className="small" style={{ marginTop: 4 }}>
                  {prev.schema_diff.new.length === 0 && prev.schema_diff.missing.length === 0 ? "La estructura coincide con las cargas anteriores." : <>
                    {prev.schema_diff.new.length > 0 && <div>Columnas nuevas: <b>{prev.schema_diff.new.join(", ")}</b> (se agregarán; los registros previos quedarán vacíos en ellas).</div>}
                    {prev.schema_diff.missing.length > 0 && <div>Columnas ausentes: <b>{prev.schema_diff.missing.join(", ")}</b> (los nuevos registros quedarán vacíos en ellas).</div>}
                    {prev.schema_diff.possibly_renamed.map((r: any) => <div key={r.from}>Posible renombre: «{r.from}» → «{r.to}». Si es la misma variable, asigne su rol a «{r.to}» abajo.</div>)}</>}
                </div></div></div>
            )}

            {(target === "new" || f.mode === "update" || f.mode === "append") && prev && (
              <label className="field">Columnas llave para identificar registros (opcional para agregar; obligatorio para actualizar)
                <div className="row wrap" style={{ textTransform: "none", fontWeight: 400, color: "var(--text)", letterSpacing: 0 }}>
                  {prev.columns.map((c: any) => <label key={c.name} className="row" style={{ gap: 4, background: keys.includes(c.name) ? "#eef3f9" : "#fff", border: "1px solid var(--line-strong)", borderRadius: 6, padding: "3px 8px" }}>
                    <input type="checkbox" checked={keys.includes(c.name)} onChange={() => setKeys(keys.includes(c.name) ? keys.filter((k) => k !== c.name) : [...keys, c.name])} />{c.name}</label>)}
                </div>
                <span className="small muted" style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>Sin llave, los duplicados se detectan comparando la fila completa. {ds?.key_cols?.length ? `Llave guardada del conjunto: ${ds.key_cols.join(" + ")}.` : ""}</span>
              </label>
            )}

            {f.mode === "replace_period" && target !== "new" && (
              <div className="alert warn"><div><b>Reemplazo de periodo.</b> Se eliminarán los registros del periodo «{f.period || "(indique periodo)"}» y se cargarán los de este archivo. Se conservará una versión anterior en disco.
                <label className="row" style={{ marginTop: 8 }}><input type="checkbox" id="imp-confirm-replace" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />Autorizo expresamente este reemplazo.</label></div></div>
            )}

            {prev && (
              <>
                <div className="row wrap"><span className="badge ok">{prev.rows.toLocaleString("es-MX")} filas</span><span className="badge">{prev.cols} columnas</span>
                  {prev.duplicates_exact > 0 && <span className="badge warn">{prev.duplicates_exact} filas duplicadas exactas en el archivo</span>}</div>
                {ambiguous.length > 0 && (
                  <div className="alert warn"><div><b>Formato ambiguo detectado — requiere su confirmación.</b>
                    {ambiguous.map((c: any) => <div key={c.name} className="small">• {c.name}: {c.warnings.join(" ")}</div>)}
                    <label className="row" style={{ marginTop: 8 }}><input type="checkbox" id="imp-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} />Confirmo que he revisado estas columnas; los valores no interpretados se conservarán como texto original.</label></div></div>
                )}
                <div>
                  <h3>Reconocimiento de columnas y diccionario de datos</h3>
                  <p className="muted small" style={{ margin: "4px 0 8px" }}>El sistema propone el rol analítico de cada columna; usted lo aprueba o cambia. Las columnas originales siempre se conservan. Montos contratados y pagados son roles distintos.</p>
                  <div className="table-wrap" style={{ maxHeight: 340, border: "1px solid var(--line)", borderRadius: 8 }}>
                    <table className="t"><thead><tr><th style={{ cursor: "default" }}>Columna</th><th style={{ cursor: "default" }}>Tipo detectado</th><th style={{ cursor: "default" }}>Vacíos</th><th style={{ cursor: "default" }}>Ejemplos</th><th style={{ cursor: "default" }}>Rol analítico</th></tr></thead>
                      <tbody>{prev.columns.map((c: any) => (
                        <tr key={c.name} style={{ cursor: "default" }}>
                          <td><b>{c.name}</b></td>
                          <td><span className={"badge" + (c.ambiguous ? " warn" : "")}>{TYPE_LABEL[c.type] || c.type}{c.date_format && c.date_format !== "serial" ? ` · ${c.date_format.toUpperCase()}` : ""}</span>{c.invalid > 0 && <span className="badge bad" style={{ marginLeft: 4 }}>{c.invalid} no interpretables</span>}</td>
                          <td className="num">{c.nulls}</td>
                          <td className="muted">{(c.sample || []).slice(0, 3).join(" · ")}</td>
                          <td><select className="select" style={{ width: 220 }} value={mapping[c.name] || ""} onChange={(e) => setRole(c.name, e.target.value)} aria-label={"Rol de " + c.name}>
                            <option value="">— sin asignar —</option>{prev.roles.map((r: any) => <option key={r.role} value={r.role}>{r.label}</option>)}</select></td>
                        </tr>))}</tbody></table>
                  </div>
                </div>
                <div>
                  <h3>Vista previa (primeras 15 filas)</h3>
                  <div className="table-wrap" style={{ maxHeight: 280, border: "1px solid var(--line)", borderRadius: 8, marginTop: 8 }}>
                    <table className="t"><thead><tr>{prev.columns.map((c: any) => <th key={c.name} style={{ cursor: "default" }}>{c.name}</th>)}</tr></thead>
                      <tbody>{prev.preview.map((r: any, i: number) => <tr key={i} style={{ cursor: "default" }}>{prev.columns.map((c: any) => <td key={c.name}>{r[c.name] ?? "—"}</td>)}</tr>)}</tbody></table>
                  </div>
                </div>
              </>
            )}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn accent" id="imp-confirm" disabled={!canImport} onClick={commit}>{busy ? "Importando…" : "Confirmar importación"}</button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="stack" id="import-result">
            <div className="alert info"><CheckCircle2 size={18} color="var(--ok)" /><div><b>Importación completada.</b></div></div>
            <div className="kpi-grid">
              {[["Filas recibidas", result.rows_received], ["Filas incorporadas", result.rows_added], ["Duplicados omitidos", result.rows_skipped_duplicates], ["Registros reemplazados", result.rows_replaced], ["Filas con observaciones", result.rows_with_issues], ["Total en el conjunto", result.total_rows]].map(([k, v]) => (
                <div className="card kpi" key={k as string} style={{ cursor: "default" }}><div className="k-name">{k}</div><div className="k-val">{(v as number).toLocaleString("es-MX")}</div></div>))}
            </div>
            {result.summary?.warnings?.map((w: string) => <div className="alert warn" key={w}>{w}</div>)}
            <div className="row">{queue.length > 1 ? <button className="btn primary" onClick={next}>Continuar con el siguiente archivo ({queue.length - 1} restante(s))</button> : <button className="btn primary" onClick={() => { setQueue([]); setStaged(null); setResult(null); setPrev(null); setTarget(result.dataset_id); }}>Importar otro archivo</button>}
              <a className="btn" href="/dashboard">Abrir dashboard</a></div>
          </div>
        )}
      </div>
    </section>
  );
}
