"use client";
/**
 * Validación manual de contratos marcados por el Motor V3 como "REQUIERE REVISION".
 *
 * El motor nunca se modifica: cada decisión registra el monto del motor (snapshot),
 * el monto final validado y el ajuste resultante. El monto contratado final es:
 *     monto_final_total = monto_motor_total + Σ ajustes de decisiones registradas
 *
 * Persistencia: localStorage del navegador (las rutas de Vercel son de solo lectura).
 * La bitácora se puede exportar/importar en JSON y descargar en CSV para auditoría.
 */
import { useCallback, useEffect, useState } from "react";

export type TipoDecision =
  | "CONFIRMAR_MOTOR"
  | "CONTAR_UNA_VEZ"
  | "EXCLUIR_FILAS"
  | "MONTO_MANUAL"
  | "EXCLUIR_CONTRATO"
  | "MANTENER_REVISION";

export type DecisionDef = {
  id: TipoDecision;
  label: string;
  descripcion: string;
  requiereObservacion: boolean;
  /** Si es false, la decisión no cierra el pendiente (el contrato sigue "por validar"). */
  cierraPendiente: boolean;
  color: string;
};

export const DECISIONES: DecisionDef[] = [
  {
    id: "CONFIRMAR_MOTOR",
    label: "Validar monto del motor",
    descripcion:
      "Las partidas señaladas son presentaciones distintas o la diferencia de IVA es aceptable. Se conserva el monto estimado por el motor.",
    requiereObservacion: false,
    cierraPendiente: true,
    color: "var(--ok)",
  },
  {
    id: "CONTAR_UNA_VEZ",
    label: "Importe global repetido: contar una sola vez",
    descripcion:
      "Las partidas con misma clave, cantidad, precio e importe corresponden a un solo importe global. Se conserva la primera fila de cada grupo y se descuentan las demás.",
    requiereObservacion: false,
    cierraPendiente: true,
    color: "var(--steel)",
  },
  {
    id: "EXCLUIR_FILAS",
    label: "Excluir filas específicas",
    descripcion: "Selecciona en la tabla de filas en revisión las partidas que no deben sumarse al monto contratado.",
    requiereObservacion: true,
    cierraPendiente: true,
    color: "var(--gold)",
  },
  {
    id: "MONTO_MANUAL",
    label: "Capturar monto validado (según contrato)",
    descripcion: "Registra el monto sin IVA verificado contra el contrato, fallo o convenio modificatorio.",
    requiereObservacion: true,
    cierraPendiente: true,
    color: "var(--navy)",
  },
  {
    id: "EXCLUIR_CONTRATO",
    label: "Excluir contrato del total",
    descripcion: "El contrato no corresponde al periodo, está cancelado o duplicado en otro registro. Su monto final es $0.00.",
    requiereObservacion: true,
    cierraPendiente: true,
    color: "var(--burgundy)",
  },
  {
    id: "MANTENER_REVISION",
    label: "Dejar como lo analizó el motor",
    descripcion: "No se toma decisión todavía. Se suma el monto del motor y el contrato sigue como pendiente de revisión.",
    requiereObservacion: false,
    cierraPendiente: false,
    color: "var(--muted)",
  },
];

export const decisionDef = (id?: string) => DECISIONES.find((d) => d.id === id);

export type Decision = {
  key: string;
  institucion: string;
  contrato: string;
  proveedor: string;
  decision: TipoDecision;
  monto_motor: number;
  monto_final: number;
  ajuste: number;
  filas_excluidas: number[];
  observacion: string;
  responsable: string;
  fecha: string;
};

const STORAGE_KEY = "nexus.decisiones.v1";
const RESP_KEY = "nexus.decisiones.responsable";
const EVENT = "nexus-decisiones-change";

export const contratoKey = (institucion: string, contrato: string) =>
  `${(institucion || "").trim()}|${(contrato || "").trim()}`;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNum = (v: any) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Monto con el que la fila contribuye al monto del motor. */
export const aporteFila = (r: any) => toNum(r.monto_depurado ?? r.monto_computable);

const esContabilizada = (r: any) =>
  (r.estado || "") === "PARTIDA CONTABILIZADA" || (r.estado || "") === "INFERIDO_PARTIDA";

const tieneAlertaGlobal = (r: any) => String(r.alertas || "").includes("POSIBLE IMPORTE GLOBAL REPETIDO");

/**
 * Filas que se descuentan con la decisión CONTAR_UNA_VEZ.
 * Replica la llave de agrupación del motor: (proveedor, clave, base, cantidad, precio).
 * Dentro de cada grupo se conserva la primera fila (menor fila_excel).
 */
export function filasRepetidasGlobales(rows: any[]): any[] {
  const grupos = new Map<string, any[]>();
  for (const r of rows) {
    if (!tieneAlertaGlobal(r) || !esContabilizada(r) || aporteFila(r) <= 0) continue;
    const k = [
      r.proveedor,
      r.clave ?? r.clave_medicamento,
      toNum(r.monto_base_sin_iva ?? r.subtotal_calculado).toFixed(2),
      toNum(r.cantidad_contratada ?? r.cantidad),
      toNum(r.precio_unitario),
    ].join("|");
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(r);
  }
  const out: any[] = [];
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => toNum(a.fila_excel) - toNum(b.fila_excel));
    out.push(...g.slice(1));
  }
  return out;
}

/** Calcula el monto final de un contrato según la decisión elegida. */
export function calcularMontoFinal(
  decision: TipoDecision,
  montoMotor: number,
  rows: any[],
  opts: { filasExcluidas?: number[]; montoManual?: number } = {}
): { monto_final: number; filas_excluidas: number[] } {
  switch (decision) {
    case "CONTAR_UNA_VEZ": {
      const rep = filasRepetidasGlobales(rows);
      const desc = rep.reduce((s, r) => s + aporteFila(r), 0);
      return { monto_final: r2(Math.max(0, montoMotor - desc)), filas_excluidas: rep.map((r) => toNum(r.fila_excel)) };
    }
    case "EXCLUIR_FILAS": {
      const set = new Set(opts.filasExcluidas || []);
      const desc = rows.filter((r) => set.has(toNum(r.fila_excel))).reduce((s, r) => s + aporteFila(r), 0);
      return { monto_final: r2(Math.max(0, montoMotor - desc)), filas_excluidas: [...set] };
    }
    case "MONTO_MANUAL":
      return { monto_final: r2(Math.max(0, opts.montoManual ?? montoMotor)), filas_excluidas: [] };
    case "EXCLUIR_CONTRATO":
      return { monto_final: 0, filas_excluidas: [] };
    default:
      return { monto_final: r2(montoMotor), filas_excluidas: [] };
  }
}

// ---------------------------------------------------------------- persistencia

export function cargarDecisiones(): Record<string, Decision> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function guardarTodas(map: Record<string, Decision>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event(EVENT));
}

export const responsableGuardado = () => (typeof window === "undefined" ? "" : localStorage.getItem(RESP_KEY) || "");

/** Hook reactivo: se sincroniza entre componentes y pestañas del navegador. */
export function useDecisiones() {
  const [decisiones, setDecisiones] = useState<Record<string, Decision>>({});

  useEffect(() => {
    const sync = () => setDecisiones(cargarDecisiones());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const guardar = useCallback((d: Omit<Decision, "key" | "ajuste" | "fecha">) => {
    const map = cargarDecisiones();
    const key = contratoKey(d.institucion, d.contrato);
    if (d.decision === "MANTENER_REVISION") {
      delete map[key];
    } else {
      map[key] = { ...d, key, ajuste: r2(d.monto_final - d.monto_motor), fecha: new Date().toISOString() };
    }
    if (d.responsable) localStorage.setItem(RESP_KEY, d.responsable);
    guardarTodas(map);
  }, []);

  const eliminar = useCallback((key: string) => {
    const map = cargarDecisiones();
    delete map[key];
    guardarTodas(map);
  }, []);

  const importar = useCallback((lista: Decision[], reemplazar = false) => {
    const map = reemplazar ? {} : cargarDecisiones();
    let n = 0;
    for (const d of lista) {
      if (!d || !d.contrato || !decisionDef(d.decision)) continue;
      const key = contratoKey(d.institucion, d.contrato);
      map[key] = { ...d, key, ajuste: r2(toNum(d.monto_final) - toNum(d.monto_motor)) };
      n++;
    }
    guardarTodas(map);
    return n;
  }, []);

  return { decisiones, guardar, eliminar, importar };
}

// ---------------------------------------------------------------- agregados

export type FiltroAlcance = { institucion?: string; proveedor?: string; contrato?: string };

export function decisionesEnAlcance(decisiones: Record<string, Decision>, f: FiltroAlcance = {}) {
  return Object.values(decisiones).filter(
    (d) =>
      (!f.institucion || f.institucion === "Todos" || d.institucion === f.institucion) &&
      (!f.proveedor || f.proveedor === "Todos" || d.proveedor === f.proveedor) &&
      (!f.contrato || d.contrato.toLowerCase().includes(f.contrato.toLowerCase()))
  );
}

export function resumenValidacion(decisiones: Decision[]) {
  const validadas = decisiones.filter((d) => decisionDef(d.decision)?.cierraPendiente);
  return {
    validados: validadas.length,
    ajuste_total: r2(validadas.reduce((s, d) => s + d.ajuste, 0)),
    excluidos: validadas.filter((d) => d.decision === "EXCLUIR_CONTRATO").length,
  };
}

// ---------------------------------------------------------------- exportación

function descargar(nombre: string, contenido: string, tipo: string) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

export function exportarDecisionesJSON(decisiones: Record<string, Decision>) {
  const payload = { version: 1, generado: new Date().toISOString(), decisiones: Object.values(decisiones) };
  descargar(`bitacora_validacion_${stamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

export function exportarDecisionesCSV(decisiones: Record<string, Decision>) {
  const cols = [
    "institucion", "contrato", "proveedor", "decision", "monto_motor", "monto_final", "ajuste",
    "filas_excluidas", "observacion", "responsable", "fecha",
  ];
  const esc = (v: any) => {
    const s = Array.isArray(v) ? v.join(" ") : String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const d of Object.values(decisiones)) {
    lines.push(
      cols
        .map((c) => (c === "decision" ? esc(decisionDef(d.decision)?.label || d.decision) : esc((d as any)[c])))
        .join(",")
    );
  }
  descargar(`bitacora_validacion_${stamp()}.csv`, "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
}

export async function leerBitacoraJSON(file: File): Promise<Decision[]> {
  const data = JSON.parse(await file.text());
  const lista = Array.isArray(data) ? data : data?.decisiones;
  if (!Array.isArray(lista)) throw new Error("El archivo no contiene una bitácora de decisiones válida.");
  return lista;
}
