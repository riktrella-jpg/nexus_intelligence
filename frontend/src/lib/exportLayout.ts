import * as XLSX from "xlsx";
import { Decision, decisionDef, contratoKey } from "@/lib/decisiones";

function normalizar(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\u00a0/g, " ").toUpperCase();
  return s.trim().split(/\s+/).join(" ");
}

function findColIndex(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").normalize("NFKC").trim();
    if (!h) continue;
    for (const pat of patterns) {
      if (pat.test(h)) return i;
    }
  }
  return -1;
}

export interface ExportLayoutOptions {
  rawMatrix?: any[][];
  rawSheetName?: string;
  fileName?: string;
  decisiones: Record<string, Decision>;
  contracts?: any[];
  format?: "xlsx" | "csv";
}

/**
 * Exporta el layout en el formato original exacto en que fue subido,
 * agregando al final la columna «Validado» (SÍ / NO) y campos de auditoría.
 */
export async function exportarLayoutValidado({
  rawMatrix,
  rawSheetName = "BASE",
  fileName = "Layout_Suministro",
  decisiones = {},
  contracts = [],
  format = "xlsx",
}: ExportLayoutOptions): Promise<void> {
  let matrix: any[][] = [];

  // 1. Si no hay matriz en memoria (usuario aún no sube archivo nuevo), cargar el layout base precargado
  if (!rawMatrix || rawMatrix.length === 0) {
    try {
      const resp = await fetch("/data/layout_base.xlsx");
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} al cargar layout base.`);
      }
      const arrayBuffer = await resp.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      matrix = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
    } catch (e: any) {
      console.warn("No se pudo cargar /data/layout_base.xlsx, intentando fallback:", e);
      throw new Error(
        "No se encontró el layout original en memoria ni en el servidor para exportar. Por favor sube tu archivo Excel o recarga la página."
      );
    }
  } else {
    // Clonar matriz para no mutar el estado en memoria
    matrix = rawMatrix.map((row) => (Array.isArray(row) ? [...row] : []));
  }

  if (matrix.length === 0) {
    throw new Error("La hoja de datos a exportar está vacía.");
  }

  // 2. Detectar fila de encabezados
  let headerRowIdx = -1;
  let colContrato = -1;
  let colInst = -1;

  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const row = (matrix[r] || []).map((v) => String(v || "").toLowerCase());
    const hasContrato = row.some((c) => /contrato|pedido|folio/i.test(c));
    const hasProv = row.some((c) => /proveedor|raz[oó]n\s*social|empresa/i.test(c));
    const hasMonto = row.some((c) => /monto|importe|total|precio/i.test(c));

    if ((hasContrato && hasProv) || (hasContrato && hasMonto) || (hasProv && hasMonto)) {
      headerRowIdx = r;
      const rawHeaders = matrix[r].map((v) => String(v || ""));
      colContrato = findColIndex(rawHeaders, [/n[uú]m.*contrato/i, /no\..*contrato/i, /contrato/i, /pedido/i, /folio/i]);
      colInst = findColIndex(rawHeaders, [/instituci[oó]n/i, /dependencia/i, /siglas/i, /ente/i, /cliente/i]);
      break;
    }
  }

  // Fallback si no se detectó por nombres
  if (headerRowIdx === -1) {
    headerRowIdx = matrix.length > 1 ? 1 : 0;
    colInst = 3; // Columna D
    colContrato = 7; // Columna H
  }
  if (colInst === -1) colInst = 3;
  if (colContrato === -1) colContrato = 7;

  // 3. Crear mapa rápido de contratos reconocidos por el motor
  const contractsMap = new Map<string, any>();
  for (const c of contracts) {
    const k = contratoKey(c.institucion, c.contrato);
    contractsMap.set(k, c);
  }

  // 4. Agregar encabezados de validación a la fila de encabezados original
  const validationHeaders = [
    "Validado",
    "Estado_Validacion",
    "Decision_Tomada",
    "Monto_Validado_Contrato",
    "Ajuste_Validacion",
    "Estatus_Fila",
    "Responsable_Validacion",
    "Fecha_Validacion",
    "Observaciones_Validacion",
  ];

  matrix[headerRowIdx] = [...(matrix[headerRowIdx] || []), ...validationHeaders];

  // Si había filas previas (ej. fila de superencabezados agrupados), rellenar con celdas vacías
  for (let r = 0; r < headerRowIdx; r++) {
    if (matrix[r]) {
      const pad = new Array(validationHeaders.length).fill("");
      matrix[r] = [...matrix[r], ...pad];
    }
  }

  // 5. Enriquecer cada fila de datos conservando sus columnas originales
  const startRow = headerRowIdx + 1;
  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.length === 0) continue;

    const filaExcel = r + 1;
    const inst = normalizar(colInst >= 0 && colInst < row.length ? row[colInst] : row[3]);
    const contrato = normalizar(colContrato >= 0 && colContrato < row.length ? row[colContrato] : row[7]);
    const key = contratoKey(inst, contrato);

    const decision = decisiones[key];
    const contract = contractsMap.get(key);

    let validado = "NO";
    let estadoValidacion = "PENDIENTE DE REVISIÓN";
    let decisionTomada = "PENDIENTE DE VALIDAR";
    let montoValidado = contract ? (parseFloat(contract.monto_inferido) || 0) : 0;
    let ajuste = 0;
    let estatusFila = "CONTABILIZADA";
    let responsable = "";
    let fecha = "";
    let observaciones = "";

    if (decision) {
      const def = decisionDef(decision.decision);
      const cierra = !!def?.cierraPendiente;
      validado = cierra ? "SÍ" : "NO";
      estadoValidacion = cierra ? "VALIDADO" : "PENDIENTE DE REVISIÓN";
      decisionTomada = decision.decision || "SIN DECISIÓN";
      montoValidado = decision.monto_final ?? montoValidado;
      ajuste = decision.ajuste ?? 0;
      responsable = decision.responsable || "";
      fecha = decision.fecha || "";
      observaciones = decision.observacion || "";

      if (decision.decision === "EXCLUIR_FILAS" && Array.isArray(decision.filas_excluidas)) {
        if (decision.filas_excluidas.includes(filaExcel)) {
          estatusFila = "EXCLUIDA POR VALIDACIÓN";
        }
      } else if (decision.decision === "EXCLUIR_CONTRATO") {
        estatusFila = "CONTRATO EXCLUIDO ($0.00)";
      }
    } else if (contract && (contract.estado === "SIN ALERTAS AUTOMATICAS" || contract.pendientes === 0 || contract.pendientes === "0")) {
      // Si el contrato no tuvo alertas automáticas del motor V3, se encuentra verificado
      validado = "SÍ";
      estadoValidacion = "VALIDADO (MOTOR SIN ALERTAS)";
      decisionTomada = "CONFIRMADO MOTOR";
      montoValidado = parseFloat(contract.monto_inferido) || 0;
      ajuste = 0;
      responsable = "MOTOR V3";
      fecha = "AUTOMÁTICO";
      observaciones = "Aritmética base verificada sin alertas";
    } else if (contract) {
      // Contrato con alertas aún sin validar
      validado = "NO";
      estadoValidacion = "PENDIENTE DE REVISIÓN";
      decisionTomada = "REQUIERE VALIDACIÓN";
      montoValidado = parseFloat(contract.monto_inferido) || 0;
      ajuste = 0;
      responsable = "";
      fecha = "";
      observaciones = contract.razon || "Alerta de posible duplicidad global pendiente de decisión";
    }

    const rowAudit = [
      validado,
      estadoValidacion,
      decisionTomada,
      montoValidado.toFixed(2),
      ajuste.toFixed(2),
      estatusFila,
      responsable,
      fecha,
      observaciones,
    ];

    matrix[r] = [...row, ...rowAudit];
  }

  // 6. Generar archivo de descarga
  const baseCleanName = fileName.replace(/\.[^/.]+$/, "").replace(/\s+/g, "_");
  const finalFileName = `${baseCleanName}_VALIDADO.${format}`;

  if (format === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, rawSheetName || "BASE_VALIDADA");
    XLSX.writeFile(wb, finalFileName);
  } else {
    // Formato CSV con BOM UTF-8
    let csvContent = "\uFEFF";
    for (const row of matrix) {
      const line = (row || [])
        .map((val: any) => {
          const s = String(val ?? "").replace(/"/g, '""');
          return `"${s}"`;
        })
        .join(",");
      csvContent += line + "\n";
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = finalFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
