import * as XLSX from "xlsx";
import { Decision, decisionDef, contratoKey } from "@/lib/decisiones";
import { parseAndReconcileExcel } from "@/lib/reconciliationEngine";

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
  details?: any[];
  format?: "xlsx" | "csv";
}

export interface ExportContratosConsideradosOptions {
  details?: any[];
  contracts?: any[];
  decisiones?: Record<string, Decision>;
  fileName?: string;
  filters?: {
    institucion?: string;
    proveedor?: string;
    contrato?: string;
    clave_medicamento?: string;
    estado?: string;
    search?: string;
  };
}

/**
 * Exporta el ejercicio de los contratos considerados para el cálculo del monto contratado:
 * - Incluye todas las filas evaluadas (PARTIDA CONTABILIZADA, REPETIDO MISMA PARTIDA, NO CUANTIFICABLE / REVISAR)
 * - Respeta los filtros activos de la interfaz
 * - Muestra monto_contratado_contrato ÚNICAMENTE en la primera fila de cada contrato (vacío en filas subsecuentes)
 *   para que al sumar la columna en Excel dé exactamente el total del monto contratado sin duplicar.
 */
export async function exportarContratosConsideradosCSV({
  details,
  contracts = [],
  decisiones = {},
  fileName = "contratos_considerados_para_monto_contratado",
  filters = {},
}: ExportContratosConsideradosOptions): Promise<void> {
  let allDetails = details || [];
  let allContracts = contracts || [];

  if (!allDetails.length) {
    const resp = await fetch("/data/layout_base.xlsx");
    if (!resp.ok) {
      throw new Error(`No se pudo cargar el archivo base (HTTP ${resp.status}).`);
    }
    const ab = await resp.arrayBuffer();
    const parsed = parseAndReconcileExcel(ab, "layout_base.xlsx");
    allDetails = parsed.details || [];
    if (!allContracts.length) {
      allContracts = parsed.contracts || [];
    }
  }

  const contractMap = new Map<string, any>();
  for (const c of allContracts) {
    const k = `${normalizar(c.institucion)}|${normalizar(c.contrato)}`;
    contractMap.set(k, c);
  }

  const instFilter = filters.institucion && filters.institucion !== "Todos" ? normalizar(filters.institucion) : "";
  const provFilter = filters.proveedor && filters.proveedor !== "Todos" ? normalizar(filters.proveedor) : "";
  const contFilter = filters.contrato ? normalizar(filters.contrato) : "";
  const claveFilter = filters.clave_medicamento ? normalizar(filters.clave_medicamento) : "";
  const estFilter = filters.estado && filters.estado !== "Todos" ? filters.estado : "";
  const searchFilter = filters.search ? filters.search.trim().toLowerCase() : "";

  const filtered = allDetails.filter((r) => {
    const inst = normalizar(r.institucion);
    const prov = normalizar(r.proveedor);
    const cont = normalizar(r.contrato);
    const clave = normalizar(r.clave);
    const cInfo = contractMap.get(`${inst}|${cont}`);

    if (instFilter && inst !== instFilter) return false;
    if (provFilter && prov !== provFilter) return false;
    if (contFilter && !cont.includes(contFilter)) return false;
    if (claveFilter && !clave.includes(claveFilter)) return false;
    if (estFilter) {
      const rowEstado = r.estado || "";
      const contEstado = cInfo?.estado || "";
      if (rowEstado !== estFilter && contEstado !== estFilter) return false;
    }
    if (searchFilter) {
      const haystack = [
        r.contrato,
        r.proveedor,
        r.institucion,
        r.clave,
        r.descripcion_original,
        r.estado,
        r.alertas,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      if (!haystack.includes(searchFilter)) return false;
    }
    return true;
  });

  // Ordenar por institución, número de contrato y fila_excel ascendente
  filtered.sort((a, b) => {
    const ic = String(a.institucion || "").localeCompare(String(b.institucion || ""));
    if (ic !== 0) return ic;
    const cc = String(a.contrato || "").localeCompare(String(b.contrato || ""));
    if (cc !== 0) return cc;
    return (Number(a.fila_excel) || 0) - (Number(b.fila_excel) || 0);
  });

  const headers = [
    "fila_excel",
    "institucion",
    "numero_contrato",
    "proveedor",
    "clave",
    "tipo_clave",
    "descripcion_original",
    "cantidad_contratada",
    "precio_unitario",
    "monto_reportado_fila",
    "monto_base_sin_iva",
    "iva",
    "estado_partida",
    "es_repetido",
    "duplicado_de_fila",
    "se_suma_al_contrato",
    "monto_aportado_partida",
    "es_primera_ocurrencia",
    "monto_contratado_contrato",
    "partidas_contabilizadas_contrato",
    "filas_totales_contrato",
    "estado_conciliacion_contrato",
    "alertas_partida",
    "criterio_conciliacion",
  ];

  const contratosVistos = new Set<string>();
  let csvContent = "\uFEFF" + headers.join(",") + "\n";

  for (const r of filtered) {
    const inst = normalizar(r.institucion);
    const cont = normalizar(r.contrato);
    const ck = `${inst}|${cont}`;
    const cInfo = contractMap.get(ck);
    const dec = decisiones[contratoKey(inst, cont)];

    const esPrimera = !contratosVistos.has(ck);
    contratosVistos.add(ck);

    const estadoPartida = r.estado || "";
    const esRepetido = estadoPartida === "REPETIDO MISMA PARTIDA" ? "SI" : "NO";
    const seSuma = estadoPartida === "PARTIDA CONTABILIZADA" ? "SI" : "NO";
    const montoAportado = seSuma === "SI" ? (r.monto_depurado ?? r.monto_base_sin_iva ?? "0.00") : "0.00";

    // Monto contratado elegido del contrato: solo en la primera fila del contrato
    let montoContratoNum = cInfo ? parseFloat(cInfo.monto_inferido || "0") || 0 : 0;
    if (dec && dec.monto_final !== undefined && dec.monto_final !== null) {
      montoContratoNum = Number(dec.monto_final) || 0;
    }
    const montoContratadoCol = esPrimera ? montoContratoNum.toFixed(2) : "";

    let criterio = "FILA NO CUANTIFICABLE (REVISAR)";
    if (seSuma === "SI") {
      criterio = "CONSIDERADO EN MONTO CONTRATADO (PARTIDA UNICA)";
    } else if (esRepetido === "SI") {
      criterio = `EXCLUIDO POR REPETICION DE PARTIDA (DUPLICADO DE FILA ${r.duplicado_de_fila || ""})`.trim();
    }

    const rowValues = [
      r.fila_excel ?? "",
      r.institucion ?? "",
      r.contrato ?? "",
      r.proveedor ?? "",
      r.clave ?? "",
      r.tipo_clave ?? "",
      r.descripcion_original ?? "",
      r.cantidad_contratada ?? "",
      r.precio_unitario ?? "",
      r.monto_reportado ?? "",
      r.monto_base_sin_iva ?? "",
      r.iva ?? "",
      estadoPartida,
      esRepetido,
      r.duplicado_de_fila ?? "",
      seSuma,
      montoAportado,
      esPrimera ? "SI" : "NO",
      montoContratadoCol,
      cInfo?.partidas ?? "",
      cInfo?.filas ?? "",
      cInfo?.estado ?? "",
      r.alertas ?? "",
      criterio,
    ];

    const line = rowValues
      .map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`)
      .join(",");
    csvContent += line + "\n";
  }

  const cleanBase = fileName.replace(/\.[^/.]+$/, "").replace(/\s+/g, "_");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cleanBase}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exporta el layout en el formato original exacto en que fue subido,
 * agregando al final la columna «Validado» (SÍ / NO), identificando las filas repetidas
 * («REPETIDO MISMA PARTIDA») y dejando el monto contratado elegido únicamente en la primera
 * fila de cada contrato vinculada al número de contrato.
 */
export async function exportarLayoutValidado({
  rawMatrix,
  rawSheetName = "BASE",
  fileName = "Layout_Suministro",
  decisiones = {},
  contracts = [],
  details = [],
  format = "xlsx",
}: ExportLayoutOptions): Promise<void> {
  let matrix: any[][] = [];
  let parsedDetails = details || [];
  let parsedContracts = contracts || [];

  // 1. Si no hay matriz en memoria (usuario aún no sube archivo nuevo), cargar el layout base precargado
  if (!rawMatrix || rawMatrix.length === 0) {
    try {
      const resp = await fetch("/data/layout_base.xlsx");
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} al cargar layout base.`);
      }
      const arrayBuffer = await resp.arrayBuffer();
      const reconciled = parseAndReconcileExcel(arrayBuffer, "layout_base.xlsx");
      matrix = reconciled.rawMatrix.map((row: any[]) => (Array.isArray(row) ? [...row] : []));
      if (!parsedDetails.length) parsedDetails = reconciled.details || [];
      if (!parsedContracts.length) parsedContracts = reconciled.contracts || [];
    } catch (e: any) {
      console.warn("No se pudo cargar /data/layout_base.xlsx:", e);
      throw new Error(
        "No se encontró el layout original en memoria ni en el servidor para exportar. Por favor sube tu archivo Excel o recarga la página."
      );
    }
  } else {
    matrix = rawMatrix.map((row) => (Array.isArray(row) ? [...row] : []));
  }

  if (matrix.length === 0) {
    throw new Error("La hoja de datos a exportar está vacía.");
  }

  // Mapa por fila_excel para identificar REPETIDO MISMA PARTIDA y monto aportado
  const detailByRow = new Map<number, any>();
  for (const d of parsedDetails) {
    if (d && d.fila_excel) {
      detailByRow.set(Number(d.fila_excel), d);
    }
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

  if (headerRowIdx === -1) {
    headerRowIdx = matrix.length > 1 ? 1 : 0;
    colInst = 3;
    colContrato = 7;
  }
  if (colInst === -1) colInst = 3;
  if (colContrato === -1) colContrato = 7;

  // 3. Crear mapa rápido de contratos reconocidos por el motor
  const contractsMap = new Map<string, any>();
  for (const c of parsedContracts) {
    const k = contratoKey(c.institucion, c.contrato);
    contractsMap.set(k, c);
  }

  // 4. Agregar encabezados de validación a la fila de encabezados original
  const validationHeaders = [
    "Validado",
    "Estado_Validacion",
    "Decision_Tomada",
    "Numero_Contrato_Relacionado",
    "Estatus_Fila",
    "Duplicado_De_Fila",
    "Monto_Aportado_Partida",
    "Es_Primera_Fila_Contrato",
    "Monto_Validado_Contrato",
    "Ajuste_Validacion",
    "Responsable_Validacion",
    "Fecha_Validacion",
    "Observaciones_Validacion",
  ];

  matrix[headerRowIdx] = [...(matrix[headerRowIdx] || []), ...validationHeaders];

  for (let r = 0; r < headerRowIdx; r++) {
    if (matrix[r]) {
      const pad = new Array(validationHeaders.length).fill("");
      matrix[r] = [...matrix[r], ...pad];
    }
  }

  // 5. Enriquecer cada fila de datos conservando sus columnas originales
  const startRow = headerRowIdx + 1;
  const contratosVistos = new Set<string>();

  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.length === 0) continue;

    const filaExcel = r + 1;
    const inst = normalizar(colInst >= 0 && colInst < row.length ? row[colInst] : row[3]);
    const contrato = normalizar(colContrato >= 0 && colContrato < row.length ? row[colContrato] : row[7]);
    const key = contratoKey(inst, contrato);

    const esPrimeraOcurrencia = !contratosVistos.has(key);
    contratosVistos.add(key);

    const decision = decisiones[key];
    const contract = contractsMap.get(key);
    const det = detailByRow.get(filaExcel);

    let validado = "NO";
    let estadoValidacion = "PENDIENTE DE REVISIÓN";
    let decisionTomada = "PENDIENTE DE VALIDAR";
    let montoValidado = contract ? parseFloat(contract.monto_inferido) || 0 : 0;
    let ajuste = 0;
    let estatusFila = det?.estado || "PARTIDA CONTABILIZADA";
    const duplicadoDeFila = det?.duplicado_de_fila ?? "";
    let montoAportado = det ? parseFloat(det.monto_depurado || "0") || 0 : 0;
    let responsable = "";
    let fecha = "";
    let observaciones = det?.alertas || "";

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
      observaciones = decision.observacion || observaciones;

      if (decision.decision === "EXCLUIR_FILAS" && Array.isArray(decision.filas_excluidas)) {
        if (decision.filas_excluidas.includes(filaExcel)) {
          estatusFila = "EXCLUIDA POR VALIDACIÓN";
          montoAportado = 0;
        }
      } else if (decision.decision === "EXCLUIR_CONTRATO") {
        estatusFila = "CONTRATO EXCLUIDO ($0.00)";
        montoAportado = 0;
      }
    } else if (contract && (contract.estado === "SIN ALERTAS AUTOMATICAS" || contract.pendientes === 0 || contract.pendientes === "0")) {
      validado = "SÍ";
      estadoValidacion = "VALIDADO (MOTOR SIN ALERTAS)";
      decisionTomada = "CONFIRMADO MOTOR";
      montoValidado = parseFloat(contract.monto_inferido) || 0;
      ajuste = 0;
      responsable = "MOTOR V3";
      fecha = "AUTOMÁTICO";
      observaciones = observaciones || "Aritmética base verificada sin alertas";
    } else if (contract) {
      validado = "NO";
      estadoValidacion = "PENDIENTE DE REVISIÓN";
      decisionTomada = "REQUIERE VALIDACIÓN";
      montoValidado = parseFloat(contract.monto_inferido) || 0;
      ajuste = 0;
      responsable = "";
      fecha = "";
      observaciones = observaciones || contract.razon || "Alerta de posible duplicidad global pendiente de decisión";
    }

    // Solo dejar el monto contratado elegido del contrato en la primera fila de cada contrato
    const montoValidadoCelda = esPrimeraOcurrencia ? montoValidado.toFixed(2) : "";
    const ajusteCelda = esPrimeraOcurrencia ? ajuste.toFixed(2) : "";

    const rowAudit = [
      validado,
      estadoValidacion,
      decisionTomada,
      contrato,
      estatusFila,
      duplicadoDeFila,
      montoAportado.toFixed(2),
      esPrimeraOcurrencia ? "SI" : "NO",
      montoValidadoCelda,
      ajusteCelda,
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
