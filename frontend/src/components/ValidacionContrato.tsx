"use client";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, RotateCcw, Save } from "lucide-react";
import { money, num } from "@/lib/format";
import {
  DECISIONES,
  Decision,
  TipoDecision,
  aporteFila,
  calcularMontoFinal,
  decisionDef,
  filasRepetidasGlobales,
  responsableGuardado,
} from "@/lib/decisiones";

type Props = {
  contrato: any;
  rows: any[];
  decision?: Decision;
  onGuardar: (d: Omit<Decision, "key" | "ajuste" | "fecha">) => void;
  onEliminar: () => void;
};

const toNum = (v: any) => {
  const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export default function ValidacionContrato({ contrato, rows, decision, onGuardar, onEliminar }: Props) {
  const montoMotor = toNum(contrato.monto_inferido);
  const [tipo, setTipo] = useState<TipoDecision>(decision?.decision || "CONFIRMAR_MOTOR");
  const [montoManual, setMontoManual] = useState<string>(
    decision?.decision === "MONTO_MANUAL" ? String(decision.monto_final) : montoMotor.toFixed(2)
  );
  const [excluidas, setExcluidas] = useState<number[]>(
    decision?.decision === "EXCLUIR_FILAS" ? decision.filas_excluidas : []
  );
  const [observacion, setObservacion] = useState(decision?.observacion || "");
  const [responsable, setResponsable] = useState(decision?.responsable || "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!responsable) setResponsable(responsableGuardado());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const repetidas = useMemo(() => filasRepetidasGlobales(rows), [rows]);
  const filasSeleccionables = useMemo(() => rows.filter((r) => aporteFila(r) > 0), [rows]);
  const def = decisionDef(tipo)!;

  const preview = useMemo(
    () =>
      calcularMontoFinal(tipo, montoMotor, rows, {
        filasExcluidas: excluidas,
        montoManual: toNum(montoManual),
      }),
    [tipo, montoMotor, rows, excluidas, montoManual]
  );
  const ajuste = Math.round((preview.monto_final - montoMotor) * 100) / 100;
  const desactualizada = decision && Math.abs(decision.monto_motor - montoMotor) > 0.005;

  const guardar = () => {
    setError("");
    if (tipo === "CONTAR_UNA_VEZ" && repetidas.length === 0) {
      return setError("Este contrato no tiene grupos de importe global repetido; elige otra decisión.");
    }
    if (tipo === "EXCLUIR_FILAS" && excluidas.length === 0) {
      return setError("Selecciona al menos una fila a excluir.");
    }
    if (tipo === "MONTO_MANUAL" && !(toNum(montoManual) >= 0 && montoManual.trim() !== "")) {
      return setError("Captura un monto válido sin IVA.");
    }
    if (def.requiereObservacion && observacion.trim().length < 5) {
      return setError("Esta decisión requiere una justificación (mínimo 5 caracteres).");
    }
    if (def.cierraPendiente && !responsable.trim()) {
      return setError("Indica el nombre del responsable de la validación.");
    }
    onGuardar({
      institucion: contrato.institucion,
      contrato: contrato.contrato,
      proveedor: contrato.proveedor || "",
      decision: tipo,
      monto_motor: montoMotor,
      monto_final: preview.monto_final,
      filas_excluidas: preview.filas_excluidas,
      observacion: observacion.trim(),
      responsable: responsable.trim(),
    });
  };

  const toggleFila = (f: number) =>
    setExcluidas((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  return (
    <div className="card card-pad" style={{ border: "1px solid rgba(37, 99, 235, 0.25)", background: "linear-gradient(135deg, #f8fafc, #eef2ff)" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h4 style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, color: "var(--navy)" }}>
          <ClipboardCheck size={18} /> Decisión de validación
        </h4>
        {decision ? (
          <span className="badge ok">
            <CheckCircle2 size={12} /> Validado por {decision.responsable || "—"} · {new Date(decision.fecha).toLocaleString("es-MX")}
          </span>
        ) : (
          <span className="badge warn">Pendiente de decisión</span>
        )}
      </div>

      {desactualizada && (
        <div className="alert warn" style={{ fontSize: 12, marginBottom: 10 }}>
          El monto del motor cambió desde la última decisión ({money(decision!.monto_motor)} → {money(montoMotor)}).
          Revisa y vuelve a guardar.
        </div>
      )}

      <div className="stack" style={{ gap: 6 }}>
        {DECISIONES.map((d) => {
          const deshabilitada = d.id === "CONTAR_UNA_VEZ" && repetidas.length === 0;
          const on = tipo === d.id;
          return (
            <label
              key={d.id}
              id={`decision-${d.id}`}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: "8px 10px",
                borderRadius: 8,
                cursor: deshabilitada ? "not-allowed" : "pointer",
                opacity: deshabilitada ? 0.5 : 1,
                background: on ? "#fff" : "transparent",
                border: `1px solid ${on ? d.color : "var(--line)"}`,
                boxShadow: on ? "0 1px 6px rgba(15,23,42,.08)" : "none",
                transition: "all .15s ease",
              }}
            >
              <input
                type="radio"
                name="decision"
                checked={on}
                disabled={deshabilitada}
                onChange={() => setTipo(d.id)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: d.color }}>{d.label}</div>
                <div className="muted small" style={{ fontSize: 11.5 }}>
                  {d.descripcion}
                  {d.id === "CONTAR_UNA_VEZ" &&
                    (repetidas.length > 0
                      ? ` (${repetidas.length} fila(s) a descontar: ${money(repetidas.reduce((s, r) => s + aporteFila(r), 0))})`
                      : " (sin grupos repetidos en este contrato)")}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {tipo === "MONTO_MANUAL" && (
        <label className="field" style={{ marginTop: 10 }}>
          Monto validado sin IVA
          <input
            id="decision-monto-manual"
            className="input"
            type="number"
            min={0}
            step="0.01"
            value={montoManual}
            onChange={(e) => setMontoManual(e.target.value)}
          />
        </label>
      )}

      {tipo === "EXCLUIR_FILAS" && (
        <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}>
          {filasSeleccionables.length === 0 ? (
            <div className="muted small" style={{ padding: 10 }}>No hay filas con importe contabilizado para excluir.</div>
          ) : (
            filasSeleccionables.map((r) => {
              const f = toNum(r.fila_excel);
              return (
                <label key={f} style={{ display: "flex", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--line)", fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={excluidas.includes(f)} onChange={() => toggleFila(f)} />
                  <span style={{ fontFamily: "monospace", fontWeight: 700 }}>#{f}</span>
                  <span style={{ flex: 1 }} className="muted">
                    {(r.clave || r.clave_medicamento || "SIN CLAVE") + " · " + String(r.descripcion_original || r.descripcion || "").slice(0, 70)}
                  </span>
                  <b>{money(aporteFila(r))}</b>
                </label>
              );
            })
          )}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
        <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px", border: "1px solid var(--line)" }}>
          <div className="muted small">Monto motor</div>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(montoMotor)}</b>
        </div>
        <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px", border: "1px solid var(--line)" }}>
          <div className="muted small">Ajuste</div>
          <b style={{ color: ajuste < 0 ? "var(--burgundy)" : ajuste > 0 ? "var(--ok)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            {ajuste > 0 ? "+" : ""}{money(ajuste)}
          </b>
        </div>
        <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px", border: `1px solid ${def.color}` }}>
          <div className="muted small">Monto final</div>
          <b style={{ color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>{money(preview.monto_final)}</b>
        </div>
      </div>

      {def.cierraPendiente && (
        <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 10 }}>
          <label className="field">
            Responsable
            <input id="decision-responsable" className="input" value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder="Nombre" />
          </label>
          <label className="field">
            Justificación {def.requiereObservacion ? "(obligatoria)" : "(opcional)"}
            <input
              id="decision-observacion"
              className="input"
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              placeholder="Ej. Calibres distintos verificados en el anexo técnico"
            />
          </label>
        </div>
      )}

      {error && (
        <div className="alert err" style={{ fontSize: 12, marginTop: 10 }}>
          {error}
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        {decision && (
          <button className="btn sm ghost" onClick={onEliminar} id="decision-eliminar" title="Eliminar la decisión y regresar al análisis del motor">
            <RotateCcw size={14} /> Revertir decisión
          </button>
        )}
        <button className="btn sm primary" onClick={guardar} id="decision-guardar">
          <Save size={14} /> {def.cierraPendiente ? "Guardar decisión" : "Mantener en revisión"}
        </button>
      </div>
      <div className="muted small" style={{ marginTop: 6, fontSize: 11 }}>
        {num(rows.length)} fila(s) en revisión cargadas para este contrato.
      </div>
    </div>
  );
}
