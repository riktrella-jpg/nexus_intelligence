import * as XLSX from "xlsx";
import contractsData from "@/lib/data/contracts.json";

export const ROLE_LABELS: Record<string, string> = {
  provider: "Proveedor",
  rfc: "RFC",
  amount: "Monto contratado/importe",
  amount_paid: "Monto pagado",
  date: "Fecha",
  quantity: "Cantidad solicitada/contratada",
  quantity_delivered: "Cantidad entregada",
  unit_price: "Precio unitario",
  unit_of_measure: "Unidad de medida",
  institution: "Institución",
  admin_unit: "Unidad administrativa",
  contract_id: "Número de contrato",
  procedure: "Tipo de procedimiento",
  status: "Estatus",
  category: "Categoría",
  description: "Descripción del bien/servicio",
};

export const DATA_KINDS: Record<string, string> = {
  movements: "Movimientos (flujo del periodo; se pueden sumar entre meses)",
  balances: "Saldos (no se suman entre periodos)",
  cumulative: "Corte acumulado (cada archivo incluye los anteriores)",
  snapshot: "Fotografía de situación (estado a la fecha de corte)",
};

const ROLE_RULES: Array<[string, RegExp, string | null]> = [
  ["rfc", /\brfc\b/i, null],
  ["date", /\bfecha\b/i, "date"],
  ["quantity_delivered", /(entregad|recibid|surtid|suministrad)/i, "number"],
  ["amount_paid", /(pagad|ejercid|devengad)/i, "number"],
  ["unit_price", /(precio|costo)\s*(unitario|unit)|\bp\s*u\b/i, "number"],
  ["quantity", /\b(cantidad|piezas|pzas|unidades)\b(?!.*(entregad|recibid|surtid|suministrad))/i, "number"],
  ["unit_of_measure", /(unidad de medida|presentacion|\bum\b)/i, null],
  ["amount", /\b(monto|importe|total|valor|subtotal)\b/i, "number"],
  ["contract_id", /(numero|num|no|n)?\s*(de )?contrato\b|\bcontrato\b|\bpedido\b|\bfolio\b/i, null],
  ["provider", /(proveedor|razon social|contratista|adjudicad|licitante|empresa)/i, null],
  ["institution", /(institucion|dependencia|entidad|unidad compradora|hospital|siglas)/i, null],
  ["admin_unit", /(unidad administrativa|area requirente|\barea\b|direccion|\bur\b|cve_ur)/i, null],
  ["procedure", /(procedimiento|modalidad|tipo de contratacion)/i, null],
  ["status", /(estatus|status|estado)/i, null],
  ["category", /(categoria|partida|tipo de (bien|gasto|compra)|capitulo|grupo|clave|cucop|cnis)/i, null],
  ["description", /(descripcion|bien|servicio|producto|articulo|medicamento|concepto|insumo)/i, null],
];

const ID_NAME_RE = /\b(rfc|curp|folio|clave|codigo|cve|contrato|expediente|licitacion|pedido|clabe|nss|identificador|id|oficio)\b/i;
const NUMERIC_NAME_RE = /\b(monto|importe|precio|cantidad|piezas|total|costo|unidades|entregad\w*|suministrad\w*|pagad\w*|ejercid\w*|subtotal|iva)\b/i;

function norm(s: any): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normCell(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    if (!isFinite(v)) return null;
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 10000) / 10000);
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  const isPct = s.endsWith("%");
  if (isPct) s = s.slice(0, -1).trim();
  if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
  s = s.replace(/[$\s,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return isPct ? n / 100 : n;
}

function parseDateStr(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // Serial Excel
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  const slice = s.slice(0, 10);
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(slice);
  if (m) {
    const [, y, mo, da] = m;
    return `${y}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  }
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(slice);
  if (m) {
    let [, d1, d2, y] = m;
    if (y.length === 2) y = "20" + y;
    const n1 = parseInt(d1, 10);
    const n2 = parseInt(d2, 10);
    if (n2 <= 12 && n1 <= 31) {
      return `${y}-${String(n2).padStart(2, "0")}-${String(n1).padStart(2, "0")}`;
    }
    if (n1 <= 12 && n2 <= 31) {
      return `${y}-${String(n1).padStart(2, "0")}-${String(n2).padStart(2, "0")}`;
    }
  }
  return null;
}

function suggestRole(colName: string, colType: string): string | null {
  const n = norm(colName);
  for (const [role, rx, req] of ROLE_RULES) {
    if (rx.test(n)) {
      if (req === "number" && colType !== "number") continue;
      if (req === "date" && colType !== "date") continue;
      if (["quantity", "amount", "amount_paid", "quantity_delivered", "unit_price"].includes(role) && colType !== "number") {
        continue;
      }
      return role;
    }
  }
  return null;
}

// ---------------- IndexedDB + Memoria ----------------
interface StagedUpload {
  upload_id: string;
  filename: string;
  size: number;
  format: string;
  sheets: string[];
  suggested_header_row: number;
  wbSheets: Record<string, any[][]>;
}

interface StoredDataset {
  meta: any;
  rows: Record<string, any>[];
  rawRows: Record<string, any>[];
}

const memoryUploads = new Map<string, StagedUpload>();
const memoryDatasets = new Map<string, StoredDataset>();
const memoryViews = new Map<string, any[]>();
let initialized = false;

const DB_NAME = "nexus_intelligence_local_v1";
const DB_VERSION = 1;

function openIDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("datasets")) db.createObjectStore("datasets", { keyPath: "id" });
        if (!db.objectStoreNames.contains("uploads")) db.createObjectStore("uploads", { keyPath: "upload_id" });
        if (!db.objectStoreNames.contains("views")) db.createObjectStore("views", { keyPath: "dataset_id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(storeName: string, val: any): Promise<void> {
  const db = await openIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(val);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbGetAll(storeName: string): Promise<any[]> {
  const db = await openIDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function buildDefaultSeedDataset(): StoredDataset {
  const cols = [
    { name: "INSTITUCION", type: "category", role: "institution", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
    { name: "NUMERO_CONTRATO", type: "identifier", role: "contract_id", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
    { name: "PROVEEDOR", type: "category", role: "provider", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
    { name: "PARTIDAS_CONCILIADAS", type: "number", role: "quantity", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
    { name: "PARTIDAS_ENTREGADAS", type: "number", role: "quantity_delivered", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
    { name: "MONTO_CONTRATADO", type: "number", role: "amount", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
    { name: "ESTATUS_AUDITORIA", type: "category", role: "status", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
    { name: "OBSERVACIONES_MOTOR", type: "text", role: "description", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
    { name: "FECHA_CORTE", type: "date", role: "date", non_null: 0, nulls: 0, distinct: 0, invalid: 0, warnings: [], coverage: 1.0 },
  ];

  const list = Array.isArray(contractsData) ? (contractsData as any[]) : [];
  const rows: Record<string, any>[] = [];
  const rawRows: Record<string, any>[] = [];

  list.forEach((c, idx) => {
    const rid = idx + 1;
    const partidas = Math.max(1, parseInt(c.partidas || c.filas || "1", 10) || 1);
    const pendientes = Math.max(0, parseInt(c.pendientes || "0", 10) || 0);
    const entregadas = Math.max(0, partidas - Math.min(partidas, pendientes));
    const monto = parseFloat(c.monto_inferido || "0") || 0;
    const hasIssue = c.estado === "REQUIERE REVISION";

    const typedRow: Record<string, any> = {
      _row_id: rid,
      _import_id: "imp_base_2026",
      _period: "2026-09",
      _issues: hasIssue ? `Observación en contrato: ${c.razon || "Requiere revisión"}` : null,
      INSTITUCION: c.institucion || "SSA",
      NUMERO_CONTRATO: c.contrato || `CONT-${rid}`,
      PROVEEDOR: c.proveedor || "SIN PROVEEDOR",
      PARTIDAS_CONCILIADAS: partidas,
      PARTIDAS_ENTREGADAS: entregadas,
      MONTO_CONTRATADO: monto,
      ESTATUS_AUDITORIA: c.estado || "SIN ALERTAS AUTOMATICAS",
      OBSERVACIONES_MOTOR: c.razon || "Claves y firmas de partidas conciliadas aritméticamente",
      FECHA_CORTE: "2026-09-30",
    };
    rows.push(typedRow);
    rawRows.push({ ...typedRow, MONTO_CONTRATADO: monto.toFixed(2) });
  });

  cols.forEach((col) => {
    col.non_null = rows.length;
  });

  const mapping: Record<string, string> = {};
  cols.forEach((c) => {
    if (c.role) mapping[c.name] = c.role;
  });

  const meta = {
    id: "ds_hgmel_2026",
    name: "Contratos Consolidados Layout Suministro 2026",
    institution: "Sector Salud (Consolidado)",
    source: "Motor de Conciliación V3 / Layout Base",
    period: "2026-09",
    cutoff: "2026-09-30",
    data_kind: "movements",
    data_kind_label: DATA_KINDS.movements,
    key_cols: ["INSTITUCION", "NUMERO_CONTRATO"],
    mapping,
    columns: cols,
    updated_at: Math.floor(Date.now() / 1000),
    row_count: rows.length,
    role_labels: ROLE_LABELS,
    periods: ["2026-09"],
    date_range: { col: "FECHA_CORTE", min: "2026-09-01", max: "2026-09-30" },
    imports: [
      {
        id: "imp_base_2026",
        filename: "Layout_Suministro_Consolidado.xlsx",
        sheet: "BASE",
        period: "2026-09",
        mode: "new",
        rows_received: rows.length,
        rows_added: rows.length,
        rows_skipped: 0,
        rows_updated: 0,
        rows_invalid: rows.filter((r) => r._issues).length,
        created_at: Math.floor(Date.now() / 1000) - 3600,
      },
    ],
    procurement: { ready: true, missing: [], supply: true },
    warnings: [],
  };

  return { meta, rows, rawRows };
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const savedDs = await idbGetAll("datasets");
    for (const item of savedDs) {
      if (item && item.id && item.meta && Array.isArray(item.rows)) {
        memoryDatasets.set(item.id, { meta: item.meta, rows: item.rows, rawRows: item.rawRows || item.rows });
      }
    }
    const savedUploads = await idbGetAll("uploads");
    for (const up of savedUploads) {
      if (up && up.upload_id && up.wbSheets) {
        memoryUploads.set(up.upload_id, up);
      }
    }
    const savedViews = await idbGetAll("views");
    for (const v of savedViews) {
      if (v && v.dataset_id && Array.isArray(v.items)) {
        memoryViews.set(v.dataset_id, v.items);
      }
    }
  } catch {}

  if (memoryDatasets.size === 0) {
    const seed = buildDefaultSeedDataset();
    memoryDatasets.set(seed.meta.id, seed);
  }
}

function detectBestHeaderRow(rows2D: any[][]): number {
  if (!rows2D || rows2D.length <= 1) return 1;
  // Revisar las primeras 8 filas buscando la que tenga más encabezados reconocibles
  let bestRow = 1;
  let bestScore = -1;
  for (let r = 0; r < Math.min(8, rows2D.length); r++) {
    const row = rows2D[r] || [];
    const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== "");
    if (nonEmpty.length === 0) continue;
    const joined = nonEmpty.map((c) => norm(c)).join(" ");
    let kwHits = 0;
    if (/\b(contrato|pedido|folio)\b/.test(joined)) kwHits += 3;
    if (/\b(proveedor|razon social|empresa|licitante)\b/.test(joined)) kwHits += 3;
    if (/\b(monto|importe|total|precio|subtotal)\b/.test(joined)) kwHits += 3;
    if (/\b(clave|cucop|cnis|descripcion|articulo|medicamento|insumo)\b/.test(joined)) kwHits += 2;
    if (/\b(institucion|siglas|dependencia|ur|ramo)\b/.test(joined)) kwHits += 2;
    if (/\b(cantidad|piezas|unidades|suministrad|entregad)\b/.test(joined)) kwHits += 2;
    const score = kwHits * 10 + nonEmpty.length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r + 1;
    }
  }
  return bestRow;
}

function extractTable(rows2D: any[][], headerRow: number): { names: string[]; dataRows: (string | null)[][] } {
  const hrIdx = Math.max(0, headerRow - 1);
  if (!rows2D || hrIdx >= rows2D.length) {
    throw new Error("El archivo está vacío o la fila de encabezados seleccionada no existe.");
  }
  const rawHeader = rows2D[hrIdx] || [];
  let lastCol = -1;
  for (let i = 0; i < rawHeader.length; i++) {
    if (normCell(rawHeader[i]) !== null) lastCol = i;
  }
  // Si la fila de encabezados elegida está casi vacía, buscar hasta el ancho máximo de las primeras 30 filas
  if (lastCol < 0) {
    for (let r = hrIdx; r < Math.min(rows2D.length, hrIdx + 30); r++) {
      const row = rows2D[r] || [];
      for (let i = 0; i < row.length; i++) {
        if (normCell(row[i]) !== null && i > lastCol) lastCol = i;
      }
    }
  }
  if (lastCol < 0) {
    throw new Error("La hoja seleccionada no contiene encabezados ni datos.");
  }

  const width = lastCol + 1;
  const names: string[] = [];
  const seen: Record<string, number> = {};
  for (let i = 0; i < width; i++) {
    let n = (normCell(rawHeader[i]) || `columna_${i + 1}`).trim();
    if (n.startsWith("_")) n = "c" + n;
    if (seen[n]) {
      seen[n] += 1;
      n = `${n}_${seen[n]}`;
    } else {
      seen[n] = 1;
    }
    names.push(n);
  }

  const dataRows: (string | null)[][] = [];
  for (let r = hrIdx + 1; r < rows2D.length; r++) {
    const row = rows2D[r] || [];
    const normRow: (string | null)[] = new Array(width);
    let hasVal = false;
    for (let i = 0; i < width; i++) {
      const v = normCell(row[i]);
      normRow[i] = v;
      if (v !== null) hasVal = true;
    }
    if (hasVal) dataRows.push(normRow);
  }

  if (dataRows.length === 0) {
    throw new Error("El archivo no contiene registros bajo la fila de encabezados seleccionada.");
  }
  return { names, dataRows };
}

function profileColumns(names: string[], dataRows: (string | null)[][], priorColumns: Record<string, any> = {}): any[] {
  const nTotal = dataRows.length;
  return names.map((name, colIdx) => {
    const nonNullVals: string[] = [];
    const distinctSet = new Set<string>();
    const samples: string[] = [];
    for (let r = 0; r < nTotal; r++) {
      const v = dataRows[r][colIdx];
      if (v !== null) {
        nonNullVals.push(v);
        if (distinctSet.size < 5000) distinctSet.add(v);
        if (samples.length < 5 && !samples.includes(v)) samples.push(v);
      }
    }
    const nNN = nonNullVals.length;
    const info: any = {
      name,
      type: "text",
      non_null: nNN,
      nulls: nTotal - nNN,
      distinct: distinctSet.size,
      invalid: 0,
      warnings: [],
      date_format: null,
      ambiguous: false,
      sample: samples.slice(0, 5),
      coverage: nTotal > 0 ? nNN / nTotal : 0,
    };

    if (nNN === 0) {
      info.type = "empty";
      info.warnings.push("Columna totalmente vacía");
      info.suggested_role = null;
      return info;
    }

    const prior = priorColumns[name];
    const forced = prior && (prior.type === "number" || prior.type === "date") ? prior.type : null;
    const nNorm = norm(name);
    const idLike = ID_NAME_RE.test(nNorm) && !NUMERIC_NAME_RE.test(nNorm);
    const checkSample = nonNullVals.slice(0, 500);
    const hasLeadingZero = checkSample.some((v) => /^0\d+$/.test(v));
    const hasLongDigits = checkSample.some((v) => /^\d{16,}$/.test(v));

    if (!forced && (idLike || hasLeadingZero || hasLongDigits)) {
      info.type = "identifier";
      info.suggested_role = suggestRole(name, info.type);
      return info;
    }

    // Probar número
    let numOk = 0;
    for (const v of checkSample) {
      if (parseNum(v) !== null) numOk++;
    }
    if (forced === "number" || numOk / checkSample.length >= 0.9) {
      info.type = "number";
      info.invalid = Math.round((1 - numOk / checkSample.length) * nNN);
      info.suggested_role = suggestRole(name, info.type);
      return info;
    }

    // Probar fecha
    let dateOk = 0;
    for (const v of checkSample) {
      if (parseDateStr(v) !== null) dateOk++;
    }
    if (forced === "date" || (dateOk / checkSample.length >= 0.9 && (/\bfecha\b/i.test(nNorm) || !/^\d+$/.test(checkSample[0])))) {
      info.type = "date";
      info.date_format = "ymd";
      info.invalid = Math.round((1 - dateOk / checkSample.length) * nNN);
      info.suggested_role = suggestRole(name, info.type);
      return info;
    }

    const ratio = info.distinct / nNN;
    info.type = info.distinct <= 150 && ratio <= 0.5 ? "category" : "text";
    info.suggested_role = suggestRole(name, info.type);
    return info;
  });
}

// ---------------- Evaluación de Filtros y Consultas ----------------
function matchCond(row: Record<string, any>, c: any, colTypes: Record<string, string>): boolean {
  const name = c.col;
  const op = c.op;
  const val = row[name];
  if (op === "isnull") return val === null || val === undefined || val === "";
  if (op === "notnull") return val !== null && val !== undefined && val !== "";

  const t = colTypes[name] || "text";
  if (t === "number") {
    if (val === null || val === undefined || val === "") return false;
    const rv = typeof val === "number" ? val : parseNum(val);
    if (rv === null) return false;
    const v1 = parseNum(c.value);
    const v2 = parseNum(c.value2);
    if (v1 === null) return true;
    if (op === "eq") return rv === v1;
    if (op === "neq") return rv !== v1;
    if (op === "gt") return rv > v1;
    if (op === "gte") return rv >= v1;
    if (op === "lt") return rv < v1;
    if (op === "lte") return rv <= v1;
    if (op === "between") return v2 !== null ? rv >= v1 && rv <= v2 : rv >= v1;
    return true;
  }

  if (t === "date") {
    if (!val) return false;
    const rv = String(val).slice(0, 10);
    const v1 = String(c.value ?? "").slice(0, 10);
    const v2 = String(c.value2 ?? "").slice(0, 10);
    if (!v1) return true;
    if (op === "eq") return rv === v1;
    if (op === "neq") return rv !== v1;
    if (op === "gt") return rv > v1;
    if (op === "gte") return rv >= v1;
    if (op === "lt") return rv < v1;
    if (op === "lte") return rv <= v1;
    if (op === "between") return v2 ? rv >= v1 && rv <= v2 : rv >= v1;
    return true;
  }

  const sv = val === null || val === undefined ? "" : String(val).toLowerCase();
  const cv = String(c.value ?? "").toLowerCase();
  if (op === "eq") return val !== null && val !== undefined && sv === cv;
  if (op === "neq") return val === null || val === undefined || sv !== cv;
  if (op === "in") {
    const arr = Array.isArray(c.value) ? c.value.map((x: any) => String(x).toLowerCase()) : [];
    if (!arr.length) return false;
    return val !== null && val !== undefined && arr.includes(sv);
  }
  if (op === "not_in") {
    const arr = Array.isArray(c.value) ? c.value.map((x: any) => String(x).toLowerCase()) : [];
    if (!arr.length) return true;
    return val === null || val === undefined || !arr.includes(sv);
  }
  if (op === "contains") return val !== null && val !== undefined && sv.includes(cv);
  if (op === "not_contains") return val === null || val === undefined || !sv.includes(cv);
  if (op === "startswith") return val !== null && val !== undefined && sv.startsWith(cv);
  return true;
}

function matchFilterNode(row: Record<string, any>, node: any, colTypes: Record<string, string>): boolean {
  if (!node) return true;
  if (Array.isArray(node.items)) {
    if (node.items.length === 0) return true;
    const isOr = String(node.logic || "AND").toUpperCase() === "OR";
    const res = isOr
      ? node.items.some((it: any) => matchFilterNode(row, it, colTypes))
      : node.items.every((it: any) => matchFilterNode(row, it, colTypes));
    return node.negate ? !res : res;
  }
  if (node.col && node.op) {
    return matchCond(row, node, colTypes);
  }
  return true;
}

function filterRows(ds: StoredDataset, filt: any, search?: string | null): Record<string, any>[] {
  const colTypes: Record<string, string> = { _period: "category", _import_id: "category", _issues: "text", _row_id: "number" };
  for (const c of ds.meta.columns || []) colTypes[c.name] = c.type;
  const txtCols = (ds.meta.columns || [])
    .filter((c: any) => ["text", "category", "identifier"].includes(c.type))
    .map((c: any) => c.name);
  const q = search ? String(search).trim().toLowerCase() : "";

  return ds.rows.filter((r) => {
    if (filt && !matchFilterNode(r, filt, colTypes)) return false;
    if (q) {
      return txtCols.some((col: string) => {
        const v = r[col];
        return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
      });
    }
    return true;
  });
}

function evalMetric(rows: Record<string, any>[], m: any): any {
  if (!m || !m.op) return rows.length;
  const op = m.op;
  if (op === "count") return rows.length;
  if (op === "count_distinct") {
    const col = m.col;
    const s = new Set<any>();
    for (const r of rows) {
      const v = r[col];
      if (v !== null && v !== undefined && v !== "") s.add(v);
    }
    return s.size;
  }
  if (["sum", "avg", "median", "min", "max"].includes(op)) {
    const col = m.col;
    const vals: any[] = [];
    for (const r of rows) {
      const v = r[col];
      if (v !== null && v !== undefined && v !== "") vals.push(v);
    }
    if (vals.length === 0) return null;
    if (op === "min" || op === "max") {
      if (typeof vals[0] === "string" && /^\d{4}-\d{2}-\d{2}/.test(vals[0])) {
        vals.sort();
        return op === "min" ? vals[0] : vals[vals.length - 1];
      }
      const nums = vals.map((x) => (typeof x === "number" ? x : parseNum(x))).filter((x): x is number => x !== null);
      if (!nums.length) return null;
      let best = nums[0];
      for (const n of nums) {
        if (op === "min" ? n < best : n > best) best = n;
      }
      return best;
    }
    const nums = vals.map((x) => (typeof x === "number" ? x : parseNum(x))).filter((x): x is number => x !== null);
    if (!nums.length) return null;
    if (op === "sum") return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
    if (op === "avg") return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
    if (op === "median") {
      nums.sort((a, b) => a - b);
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 !== 0 ? nums[mid] : Math.round(((nums[mid - 1] + nums[mid]) / 2) * 100) / 100;
    }
  }
  if (["pending", "excess", "compliance", "delivered_valid"].includes(op)) {
    const qtyCol = m.qty;
    const dlvCol = m.delivered;
    let sumPending = 0;
    let sumExcess = 0;
    let sumValid = 0;
    let sumQty = 0;
    let hasValid = false;
    for (const r of rows) {
      const q = typeof r[qtyCol] === "number" ? r[qtyCol] : parseNum(r[qtyCol]);
      const d = typeof r[dlvCol] === "number" ? r[dlvCol] : parseNum(r[dlvCol]);
      if (q !== null && d !== null) {
        hasValid = true;
        sumPending += Math.max(q - d, 0);
        sumExcess += Math.max(d - q, 0);
        sumValid += Math.min(d, q);
        if (q > 0) sumQty += q;
      }
    }
    if (!hasValid) return null;
    if (op === "pending") return sumPending;
    if (op === "excess") return sumExcess;
    if (op === "delivered_valid") return sumValid;
    if (op === "compliance") return sumQty > 0 ? sumValid / sumQty : null;
  }
  if (op === "ratio") {
    const num = evalMetric(rows, m.num);
    const den = evalMetric(rows, m.den);
    if (num === null || den === null || den === 0) return null;
    return num / den;
  }
  return null;
}

function metricLabel(m: any): string {
  if (!m || !m.op) return "Conteo de registros";
  const op = m.op;
  const names: Record<string, string> = {
    count: "Conteo de registros",
    count_distinct: "Conteo único de",
    sum: "Suma de",
    avg: "Promedio de",
    median: "Mediana de",
    min: "Mínimo de",
    max: "Máximo de",
    pending: "Piezas pendientes",
    excess: "Entregas excedentes",
    compliance: "% de cumplimiento",
    ratio: "Razón",
  };
  const base = names[op] || op;
  if (["count_distinct", "sum", "avg", "median", "min", "max"].includes(op)) return `${base} ${m.col}`;
  if (op === "ratio") return `${metricLabel(m.num)} / ${metricLabel(m.den)}`;
  return base;
}

function isAdditive(m: any): boolean {
  return ["count", "sum", "pending", "excess", "delivered_valid"].includes(m?.op);
}

function dimValue(row: Record<string, any>, d: { col: string; grain?: string }, colTypes: Record<string, string>): string {
  const v = row[d.col];
  if (v === null || v === undefined || v === "") return "(vacío)";
  if (colTypes[d.col] === "date") {
    const s = String(v).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    const [, y, mo] = m;
    const grain = d.grain || "month";
    if (grain === "year") return y;
    if (grain === "quarter") return `${y}-T${Math.floor((parseInt(mo, 10) - 1) / 3) + 1}`;
    if (grain === "day") return s;
    return `${y}-${mo}`;
  }
  return String(v);
}

function getRolesMap(ds: StoredDataset): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const c of ds.meta.columns || []) {
    if (c.role) roles[c.role] = c.name;
  }
  return roles;
}

function buildSuggestedKpis(ds: StoredDataset): any[] {
  const r = getRolesMap(ds);
  const ks: any[] = [
    {
      id: "rows",
      name: "Registros",
      metric: { op: "count" },
      unit: "registros",
      format: "int",
      definition: "Número de filas del conjunto con los filtros activos. Una fila puede ser una partida, no un contrato.",
    },
  ];
  if (r.contract_id) {
    ks.push({
      id: "contracts",
      name: "Contratos únicos",
      metric: { op: "count_distinct", col: r.contract_id },
      unit: "contratos",
      format: "int",
      definition: `Conteo de valores distintos de '${r.contract_id}' (no cuenta partidas repetidas).`,
    });
  }
  if (r.provider) {
    ks.push({
      id: "providers",
      name: "Proveedores únicos",
      metric: { op: "count_distinct", col: r.provider },
      unit: "proveedores",
      format: "int",
      definition: `Valores distintos de '${r.provider}'.`,
    });
  }
  if (r.amount) {
    const a = r.amount;
    ks.push({
      id: "amount_sum",
      name: "Monto total",
      metric: { op: "sum", col: a },
      unit: "MXN",
      format: "money",
      definition: `Suma de '${a}'.`,
    });
    ks.push({
      id: "amount_avg",
      name: "Monto promedio por registro",
      metric: { op: "avg", col: a },
      unit: "MXN",
      format: "money",
      definition: `Promedio de '${a}' por fila.`,
    });
    ks.push({
      id: "amount_max",
      name: "Monto máximo",
      metric: { op: "max", col: a },
      unit: "MXN",
      format: "money",
      definition: `Valor máximo de '${a}'.`,
    });
  }
  if (r.quantity && r.quantity_delivered) {
    const q_ = r.quantity;
    const d_ = r.quantity_delivered;
    const base = { qty: q_, delivered: d_ };
    ks.push({ id: "qty", name: "Cantidad solicitada", metric: { op: "sum", col: q_ }, unit: "piezas", format: "int", definition: `Suma de '${q_}'.` });
    ks.push({ id: "delivered", name: "Cantidad entregada", metric: { op: "sum", col: d_ }, unit: "piezas", format: "int", definition: `Suma de '${d_}'.` });
    ks.push({ id: "pending", name: "Piezas pendientes", metric: { op: "pending", ...base }, unit: "piezas", format: "int", definition: `Σ máximo('${q_}' − '${d_}', 0).` });
    ks.push({ id: "excess", name: "Entregas excedentes", metric: { op: "excess", ...base }, unit: "piezas", format: "int", definition: `Σ máximo('${d_}' − '${q_}', 0).` });
    ks.push({ id: "compliance", name: "Cumplimiento de entrega", metric: { op: "compliance", ...base }, unit: "%", format: "pct", definition: "Σ mín(entregada, solicitada) / Σ solicitada." });
  } else if (r.quantity) {
    ks.push({ id: "qty", name: "Cantidad solicitada", metric: { op: "sum", col: r.quantity }, unit: "piezas", format: "int", definition: `Suma de '${r.quantity}'.` });
  }
  return ks;
}

function analyzeDatasetRisks(ds: StoredDataset, filt?: any, search?: string | null): any {
  const rows = filterRows(ds, filt, search);
  const roles = getRolesMap(ds);
  const findings: any[] = [];
  const provCol = roles.provider;
  const amtCol = roles.amount;
  const descCol = roles.description || roles.category;
  const priceCol = roles.unit_price;
  const qtyCol = roles.quantity;
  const delivCol = roles.quantity_delivered;
  const contractCol = roles.contract_id;

  let hhiScore = 0;
  let hhiLevel = "Bajo";
  let paretoShare = 0;
  const topProviders: any[] = [];

  if (provCol && amtCol) {
    let totalAmount = 0;
    const byProv = new Map<string, { amt: number; cnt: number; rids: number[] }>();
    for (const r of rows) {
      const amt = Number(r[amtCol] || 0);
      if (amt > 0) {
        totalAmount += amt;
        const p = String(r[provCol] || "Sin proveedor");
        const cur = byProv.get(p) || { amt: 0, cnt: 0, rids: [] };
        cur.amt += amt;
        cur.cnt += 1;
        if (cur.rids.length < 20) cur.rids.push(r._row_id);
        byProv.set(p, cur);
      }
    }
    if (totalAmount > 0) {
      const sorted = Array.from(byProv.entries()).sort((a, b) => b[1].amt - a[1].amt);
      const top20Count = Math.max(1, Math.ceil(sorted.length * 0.2));
      let cumAmt = 0;
      sorted.forEach(([provName, info], idx) => {
        const pct = (info.amt / totalAmount) * 100;
        hhiScore += pct * pct;
        cumAmt += info.amt;
        if (idx < 5) {
          topProviders.push({
            provider: provName,
            amount: Math.round(info.amt * 100) / 100,
            share_pct: Math.round(pct * 100) / 100,
            row_count: info.cnt,
            row_ids: info.rids,
          });
        }
        if (idx < top20Count) {
          paretoShare = (cumAmt / totalAmount) * 100;
        }
      });
      hhiScore = Math.round(hhiScore * 10) / 10;
      if (hhiScore >= 2500 && topProviders[0]) {
        hhiLevel = "Alta";
        findings.push({
          id: "risk_hhi_high",
          category: "concentracion",
          title: "Alta Concentración de Mercado (HHI Crítico)",
          severity: "Alta",
          metric_value: `HHI ${Math.round(hhiScore).toLocaleString("es-MX")} pts`,
          description: `El mercado presenta un índice HHI de ${Math.round(hhiScore).toLocaleString("es-MX")} puntos (umbral crítico: 2,500). El 20% de los proveedores concentra el ${paretoShare.toFixed(1)}% del monto adjudicado.`,
          evidence: `Proveedor dominante '${topProviders[0].provider}' con ${topProviders[0].share_pct}% del presupuesto ($${topProviders[0].amount.toLocaleString("es-MX")} MXN).`,
          row_ids: topProviders[0].row_ids,
          recommendation: "Diversificar fuentes de adjudicación y revisar si existen barreras técnicas en los términos de referencia.",
        });
      } else if (hhiScore >= 1500 && topProviders[0]) {
        hhiLevel = "Media";
        findings.push({
          id: "risk_hhi_med",
          category: "concentracion",
          title: "Concentración Moderada de Contrataciones",
          severity: "Media",
          metric_value: `HHI ${Math.round(hhiScore).toLocaleString("es-MX")} pts`,
          description: `El índice HHI de ${Math.round(hhiScore).toLocaleString("es-MX")} refleja una concentración moderada del presupuesto.`,
          evidence: `Los primeros ${Math.min(3, topProviders.length)} proveedores acumulan el ${topProviders.slice(0, 3).reduce((s, p) => s + p.share_pct, 0).toFixed(1)}% del importe total.`,
          row_ids: topProviders[0].row_ids,
          recommendation: "Fomentar mayor concurrencia en convocatorias públicas.",
        });
      }
    }
  }

  const priceOutliers: any[] = [];
  if (descCol && priceCol) {
    const byItem = new Map<string, { prices: number[]; rids: number[] }>();
    for (const r of rows) {
      const p = Number(r[priceCol] || 0);
      if (p > 0 && r[descCol]) {
        const k = String(r[descCol]);
        const cur = byItem.get(k) || { prices: [], rids: [] };
        cur.prices.push(p);
        if (cur.rids.length < 10) cur.rids.push(r._row_id);
        byItem.set(k, cur);
      }
    }
    for (const [item, info] of byItem.entries()) {
      if (info.prices.length >= 3) {
        const minP = Math.min(...info.prices);
        const maxP = Math.max(...info.prices);
        const avgP = info.prices.reduce((a, b) => a + b, 0) / info.prices.length;
        const ratio = minP > 0 ? maxP / minP : 1;
        if (ratio >= 1.8) {
          priceOutliers.push({
            item,
            avg_price: Math.round(avgP * 100) / 100,
            min_price: Math.round(minP * 100) / 100,
            max_price: Math.round(maxP * 100) / 100,
            ratio: Math.round(ratio * 100) / 100,
            dispersion_pct: Math.round(((maxP - minP) / avgP) * 50),
            row_ids: info.rids.slice(0, 5),
          });
        }
      }
    }
    priceOutliers.sort((a, b) => b.ratio - a.ratio);
    if (priceOutliers.length > 0) {
      const topOut = priceOutliers[0];
      findings.push({
        id: "risk_price_dispersion",
        category: "precios",
        title: "Dispersión Significativa en Precios de Adquisición",
        severity: topOut.ratio >= 2.5 ? "Alta" : "Media",
        metric_value: `Variación de ${topOut.ratio}x`,
        description: "Se detectaron diferencias sustanciales de precios unitarios para el mismo insumo en diferentes registros.",
        evidence: `'${topOut.item}': mínimo $${topOut.min_price.toLocaleString("es-MX")} vs máximo $${topOut.max_price.toLocaleString("es-MX")}.`,
        row_ids: topOut.row_ids,
        recommendation: "Homologar precios de referencia a través de compras consolidadas.",
      });
    }
  }

  const pendingItems: any[] = [];
  let totalPendingQty = 0;
  let totalPendingAmount = 0;
  if (qtyCol && delivCol) {
    for (const r of rows) {
      const q = Number(r[qtyCol] || 0);
      const d = Number(r[delivCol] || 0);
      if (q > d) {
        const pQty = q - d;
        const pAmt = pQty * Number(priceCol ? r[priceCol] || 0 : 1);
        totalPendingQty += pQty;
        totalPendingAmount += pAmt;
        if (pendingItems.length < 10) {
          pendingItems.push({
            row_id: r._row_id,
            item: String(r[descCol || contractCol || qtyCol] || `Registro #${r._row_id}`),
            requested: q,
            delivered: d,
            pending_qty: pQty,
            pending_amount: Math.round(pAmt * 100) / 100,
            provider: String(provCol ? r[provCol] || "" : ""),
          });
        }
      }
    }
    if (totalPendingQty > 0) {
      findings.push({
        id: "risk_pending_deliveries",
        category: "suministros",
        title: "Suministros Pendientes de Entrega",
        severity: totalPendingQty > 100 ? "Alta" : "Media",
        metric_value: `${totalPendingQty.toLocaleString("es-MX")} pendientes`,
        description: "Se identificaron registros con entregas inferiores a lo convenido contractualmente.",
        evidence: `Total de ${totalPendingQty.toLocaleString("es-MX")} unidades/partidas pendientes de recibir.`,
        row_ids: pendingItems.map((x) => x.row_id),
        recommendation: "Dar seguimiento puntual a órdenes de suministro pendientes y aplicar deductivas cuando proceda.",
      });
    }
  }

  const fragmentationAlerts: any[] = [];
  if (provCol && contractCol) {
    const byProv = new Map<string, { contracts: Set<string>; amt: number; rids: number[] }>();
    for (const r of rows) {
      const p = String(r[provCol] || "");
      const c = String(r[contractCol] || "");
      if (!p || !c) continue;
      const cur = byProv.get(p) || { contracts: new Set<string>(), amt: 0, rids: [] };
      cur.contracts.add(c);
      cur.amt += Number(amtCol ? r[amtCol] || 0 : 0);
      if (cur.rids.length < 15) cur.rids.push(r._row_id);
      byProv.set(p, cur);
    }
    for (const [p, info] of byProv.entries()) {
      if (info.contracts.size >= 3 && info.amt > 100000) {
        fragmentationAlerts.push({
          provider: p,
          contracts_count: info.contracts.size,
          total_amount: Math.round(info.amt * 100) / 100,
          avg_amount: Math.round((info.amt / info.contracts.size) * 100) / 100,
          row_ids: info.rids,
        });
      }
    }
    fragmentationAlerts.sort((a, b) => b.contracts_count - a.contracts_count);
  }

  const hasHigh = findings.some((f) => f.severity === "Alta");
  const hasMed = findings.some((f) => f.severity === "Media");
  const overallSeverity = hasHigh ? "Alta" : hasMed ? "Media" : "Baja";

  return {
    overall_severity: overallSeverity,
    total_rows_analyzed: rows.length,
    findings_count: findings.length,
    findings,
    concentration: {
      hhi_score: hhiScore,
      hhi_level: hhiLevel,
      pareto_top20_share: Math.round(paretoShare * 10) / 10,
      top_providers: topProviders,
    },
    price_outliers: priceOutliers.slice(0, 10),
    pending_deliveries: {
      total_pending_qty: totalPendingQty,
      total_pending_amount: Math.round(totalPendingAmount * 100) / 100,
      items: pendingItems,
    },
    fragmentation: fragmentationAlerts.slice(0, 5),
  };
}

// ---------------- Manejador Principal de Rutas Locales ----------------
export async function handleLocalApi(
  path: string,
  opts: { method?: string; body?: any; form?: FormData } = {}
): Promise<{ handled: boolean; data?: any }> {
  await ensureInitialized();
  const method = (opts.method || (opts.body || opts.form ? "POST" : "GET")).toUpperCase();
  const url = new URL(path, "http://localhost");
  const pathname = url.pathname;

  // 1. /api/data-kinds
  if (pathname === "/api/data-kinds" && method === "GET") {
    return { handled: true, data: DATA_KINDS };
  }

  // 2. POST /api/uploads
  if (pathname === "/api/uploads" && method === "POST" && opts.form) {
    const file = opts.form.get("file") as File | null;
    if (!file) throw new Error("No se proporcionó ningún archivo.");
    const filename = file.name || "archivo.xlsx";
    const ext = (filename.split(".").pop() || "xlsx").toLowerCase();
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array", cellDates: true });
    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      throw new Error("El archivo no contiene hojas de datos válidas.");
    }
    const wbSheets: Record<string, any[][]> = {};
    for (const sName of wb.SheetNames) {
      wbSheets[sName] = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sName], { header: 1, defval: null });
    }
    // Priorizar hoja BASE si existe
    const orderedSheets = [...wb.SheetNames].sort((a, b) => {
      const aBase = a.trim().toUpperCase().includes("BASE") ? 0 : 1;
      const bBase = b.trim().toUpperCase().includes("BASE") ? 0 : 1;
      return aBase - bBase;
    });
    const firstSheetRows = wbSheets[orderedSheets[0]] || [];
    const suggestedHeaderRow = detectBestHeaderRow(firstSheetRows);
    const upload_id = "up_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const staged: StagedUpload = {
      upload_id,
      filename,
      size: file.size || ab.byteLength,
      format: ext,
      sheets: orderedSheets,
      suggested_header_row: suggestedHeaderRow,
      wbSheets,
    };
    memoryUploads.set(upload_id, staged);
    await idbPut("uploads", staged);

    return {
      handled: true,
      data: {
        upload_id,
        filename,
        size: staged.size,
        format: ext,
        sheets: orderedSheets,
        suggested_header_row: suggestedHeaderRow,
      },
    };
  }

  // 3. GET /api/uploads/{upload_id}/preview
  const mPrev = /^\/api\/uploads\/([^/]+)\/preview$/.exec(pathname);
  if (mPrev && method === "GET") {
    const upload_id = mPrev[1];
    const staged = memoryUploads.get(upload_id);
    if (!staged) {
      throw new Error("La carga temporal expiró. Por favor vuelva a seleccionar su archivo.");
    }
    const sheet = url.searchParams.get("sheet") || staged.sheets[0];
    const requestedHr = parseInt(url.searchParams.get("header_row") || "0", 10);
    const datasetId = url.searchParams.get("dataset_id") || undefined;
    const rows2D = staged.wbSheets[sheet] || staged.wbSheets[staged.sheets[0]] || [];
    const headerRow = requestedHr > 0 ? requestedHr : detectBestHeaderRow(rows2D);

    const { names, dataRows } = extractTable(rows2D, headerRow);
    const existingDs = datasetId ? memoryDatasets.get(datasetId) : undefined;
    const priorCols: Record<string, any> = {};
    if (existingDs) {
      for (const c of existingDs.meta.columns || []) priorCols[c.name] = c;
    }
    const profile = profileColumns(names, dataRows, priorCols);
    const preview = dataRows.slice(0, 15).map((r) => {
      const obj: Record<string, any> = {};
      names.forEach((n, idx) => {
        obj[n] = r[idx];
      });
      return obj;
    });

    const existingMapping = existingDs?.meta?.mapping || {};
    const proposed_mapping: Record<string, string> = {};
    const usedRoles = new Set<string>();
    for (const p of profile) {
      const role = existingMapping[p.name] || p.suggested_role;
      if (role && !usedRoles.has(role)) {
        proposed_mapping[p.name] = role;
        usedRoles.add(role);
      }
    }

    // Contar duplicados exactos
    const rowFingerprints = new Set<string>();
    let duplicatesExact = 0;
    for (const r of dataRows) {
      const fp = r.join("\x1f");
      if (rowFingerprints.has(fp)) duplicatesExact++;
      else rowFingerprints.add(fp);
    }

    let schema_diff = undefined;
    if (existingDs) {
      const oldNames = new Set<string>((existingDs.meta.columns || []).map((c: any) => c.name));
      const newNames = new Set<string>(names);
      schema_diff = {
        missing: Array.from(oldNames).filter((x) => !newNames.has(x)),
        new: Array.from(newNames).filter((x) => !oldNames.has(x)),
        possibly_renamed: [],
      };
    }

    return {
      handled: true,
      data: {
        upload_id,
        sheet,
        header_row: headerRow,
        rows: dataRows.length,
        cols: names.length,
        columns: profile,
        preview,
        roles: Object.entries(ROLE_LABELS).map(([role, label]) => ({ role, label })),
        duplicates_exact: duplicatesExact,
        proposed_mapping,
        schema_diff,
      },
    };
  }

  // 4. POST /api/imports
  if (pathname === "/api/imports" && method === "POST") {
    const p = opts.body || {};
    const staged = memoryUploads.get(p.upload_id);
    if (!staged) {
      throw new Error("La carga temporal expiró. Por favor vuelva a seleccionar su archivo.");
    }
    const mode = p.mode || "new";
    const existingDs = p.dataset_id ? memoryDatasets.get(p.dataset_id) : undefined;
    if (mode === "new" && !String(p.dataset_name || "").trim()) {
      throw new Error("Indique un nombre para el conjunto de datos.");
    }

    const sheet = p.sheet || staged.sheets[0];
    const headerRow = parseInt(p.header_row || "1", 10) || 1;
    const rows2D = staged.wbSheets[sheet] || staged.wbSheets[staged.sheets[0]] || [];
    const { names, dataRows } = extractTable(rows2D, headerRow);

    const priorCols: Record<string, any> = {};
    if (existingDs) {
      for (const c of existingDs.meta.columns || []) priorCols[c.name] = c;
    }
    const profile = profileColumns(names, dataRows, priorCols);
    const mapping: Record<string, string> = {};
    for (const [col, role] of Object.entries(p.mapping || {})) {
      if (names.includes(col) && typeof role === "string" && role in ROLE_LABELS) {
        mapping[col] = role;
      }
    }
    for (const colInfo of profile) {
      colInfo.role = mapping[colInfo.name] || null;
    }

    const period = String(p.period || "").trim() || new Date().toISOString().slice(0, 7);
    const importId = "imp_" + Date.now().toString(36);
    const datasetId = existingDs ? existingDs.meta.id : "ds_" + Date.now().toString(36);

    const baseRows: Record<string, any>[] = existingDs && mode !== "new" ? [...existingDs.rows] : [];
    const baseRaw: Record<string, any>[] = existingDs && mode !== "new" ? [...existingDs.rawRows] : [];
    let nextRowId = baseRows.reduce((max, r) => Math.max(max, Number(r._row_id) || 0), 0) + 1;

    let rowsReplaced = 0;
    if (existingDs && mode === "replace_period") {
      const before = baseRows.length;
      const keepIdx = baseRows.map((r) => r._period !== period);
      const filteredBase = baseRows.filter((_, i) => keepIdx[i]);
      const filteredRaw = baseRaw.filter((_, i) => keepIdx[i]);
      rowsReplaced = before - filteredBase.length;
      baseRows.length = 0;
      baseRows.push(...filteredBase);
      baseRaw.length = 0;
      baseRaw.push(...filteredRaw);
    }

    const seenFingerprints = new Set<string>();
    const keyCols: string[] = Array.isArray(p.key_cols) && p.key_cols.length ? p.key_cols : existingDs?.meta?.key_cols || [];
    const existingByKey = new Map<string, number>();
    if (existingDs && (mode === "append" || mode === "update")) {
      baseRows.forEach((r, idx) => {
        const k = keyCols.length
          ? keyCols.map((c) => String(r[c] ?? "")).join("\x1f")
          : names.map((c) => String(r[c] ?? "")).join("\x1f");
        existingByKey.set(k, idx);
      });
    }

    let rowsAdded = 0;
    let rowsSkipped = 0;
    let rowsWithIssues = 0;

    for (const rawArr of dataRows) {
      const typedObj: Record<string, any> = {};
      const rawObj: Record<string, any> = {};
      const rowIssues: string[] = [];

      for (let i = 0; i < names.length; i++) {
        const colName = names[i];
        const colInfo = profile[i];
        const rawVal = rawArr[i];
        rawObj[colName] = rawVal;

        if (rawVal === null) {
          typedObj[colName] = null;
          if (colInfo.role && ["amount", "provider", "contract_id", "quantity"].includes(colInfo.role)) {
            rowIssues.push(`${colName}: campo crítico vacío`);
          }
        } else if (colInfo.type === "number") {
          const n = parseNum(rawVal);
          typedObj[colName] = n;
          if (n === null) rowIssues.push(`${colName}: valor numérico no interpretable`);
          else if (n < 0 && colInfo.role && ["amount", "quantity", "quantity_delivered", "unit_price"].includes(colInfo.role)) {
            rowIssues.push(`${colName}: valor negativo`);
          }
        } else if (colInfo.type === "date") {
          const d = parseDateStr(rawVal);
          typedObj[colName] = d;
          if (d === null) rowIssues.push(`${colName}: fecha no interpretable`);
        } else {
          typedObj[colName] = rawVal;
        }
      }

      const fp = rawArr.join("\x1f");
      if (seenFingerprints.has(fp)) {
        rowIssues.push("duplicado exacto en el archivo");
      } else {
        seenFingerprints.add(fp);
      }

      const lookupKey = keyCols.length
        ? keyCols.map((c) => String(typedObj[c] ?? "")).join("\x1f")
        : fp;

      if (mode === "append" && existingByKey.has(lookupKey)) {
        rowsSkipped++;
        continue;
      }

      const rid = nextRowId++;
      const issuesStr = rowIssues.length > 0 ? rowIssues.join("; ") : null;
      if (issuesStr) rowsWithIssues++;

      typedObj._row_id = rid;
      typedObj._import_id = importId;
      typedObj._period = period;
      typedObj._issues = issuesStr;
      rawObj._row_id = rid;

      if (mode === "update" && existingByKey.has(lookupKey)) {
        const idx = existingByKey.get(lookupKey)!;
        typedObj._row_id = baseRows[idx]._row_id;
        rawObj._row_id = baseRows[idx]._row_id;
        baseRows[idx] = typedObj;
        baseRaw[idx] = rawObj;
        rowsReplaced++;
      } else {
        baseRows.push(typedObj);
        baseRaw.push(rawObj);
        rowsAdded++;
      }
    }

    const periods = Array.from(new Set(baseRows.map((r) => String(r._period || period)))).sort();
    const dateCol = profile.find((c) => c.type === "date")?.name;
    let dateRange = null;
    if (dateCol) {
      const dVals = baseRows.map((r) => r[dateCol]).filter(Boolean).sort();
      if (dVals.length) {
        dateRange = { col: dateCol, min: dVals[0], max: dVals[dVals.length - 1] };
      }
    }

    const haveRoles = new Set(Object.values(mapping));
    const missingRoles = ["amount", "provider"].filter((r) => !haveRoles.has(r)).map((r) => ROLE_LABELS[r]);
    const importRecord = {
      id: importId,
      filename: staged.filename,
      sheet,
      period,
      mode,
      rows_received: dataRows.length,
      rows_added: rowsAdded,
      rows_skipped: rowsSkipped,
      rows_updated: rowsReplaced,
      rows_invalid: rowsWithIssues,
      created_at: Math.floor(Date.now() / 1000),
    };

    const meta = {
      id: datasetId,
      name: mode === "new" ? String(p.dataset_name).trim() : existingDs!.meta.name,
      institution: p.institution || existingDs?.meta?.institution || "Institución",
      source: p.source || existingDs?.meta?.source || staged.filename,
      period,
      cutoff: p.cutoff || existingDs?.meta?.cutoff || new Date().toISOString().slice(0, 10),
      data_kind: p.data_kind || existingDs?.meta?.data_kind || "movements",
      data_kind_label: DATA_KINDS[p.data_kind || existingDs?.meta?.data_kind || "movements"] || DATA_KINDS.movements,
      key_cols: keyCols,
      mapping,
      columns: profile,
      updated_at: Math.floor(Date.now() / 1000),
      row_count: baseRows.length,
      role_labels: ROLE_LABELS,
      periods,
      date_range: dateRange,
      imports: [...(existingDs?.meta?.imports || []), importRecord],
      procurement: {
        ready: missingRoles.length === 0,
        missing: missingRoles,
        supply: haveRoles.has("quantity") && haveRoles.has("quantity_delivered"),
      },
      warnings: [],
    };

    const stored: StoredDataset = { meta, rows: baseRows, rawRows: baseRaw };
    memoryDatasets.set(datasetId, stored);
    await idbPut("datasets", { id: datasetId, meta, rows: baseRows, rawRows: baseRaw });

    return {
      handled: true,
      data: {
        dataset_id: datasetId,
        rows_received: dataRows.length,
        rows_added: rowsAdded,
        rows_skipped_duplicates: rowsSkipped,
        rows_replaced: rowsReplaced,
        rows_with_issues: rowsWithIssues,
        total_rows: baseRows.length,
        summary: { warnings: [] },
      },
    };
  }

  // 5. POST /api/demo/seed
  if (pathname === "/api/demo/seed" && method === "POST") {
    const seed = buildDefaultSeedDataset();
    memoryDatasets.set(seed.meta.id, seed);
    await idbPut("datasets", { id: seed.meta.id, meta: seed.meta, rows: seed.rows, rawRows: seed.rawRows });
    return { handled: true, data: { dataset_id: seed.meta.id, total_rows: seed.rows.length } };
  }

  // 6. GET /api/datasets
  if (pathname === "/api/datasets" && method === "GET") {
    const list = Array.from(memoryDatasets.values())
      .map((d) => d.meta)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    return { handled: true, data: list };
  }

  // 7. DELETE /api/views/{view_id}
  const mDelView = /^\/api\/views\/([^/]+)$/.exec(pathname);
  if (mDelView && method === "DELETE") {
    const vid = mDelView[1];
    for (const [dsId, list] of memoryViews.entries()) {
      const next = list.filter((v) => v.id !== vid);
      if (next.length !== list.length) {
        memoryViews.set(dsId, next);
        await idbPut("views", { dataset_id: dsId, items: next });
      }
    }
    return { handled: true, data: { ok: true } };
  }

  // 8. Rutas bajo /api/datasets/{id}...
  const mDs = /^\/api\/datasets\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (mDs) {
    const datasetId = mDs[1];
    const sub = mDs[2] || "";
    const ds = memoryDatasets.get(datasetId) || Array.from(memoryDatasets.values())[0];

    if (!sub && method === "DELETE") {
      memoryDatasets.delete(datasetId);
      await idbDelete("datasets", datasetId);
      return { handled: true, data: { ok: true, deleted_id: datasetId } };
    }

    if (!ds) {
      throw new Error("Conjunto de datos no encontrado.");
    }

    if (!sub && method === "GET") {
      return { handled: true, data: ds.meta };
    }

    if (sub === "mapping" && method === "PUT") {
      const newMap = opts.body?.mapping || {};
      const cleanMap: Record<string, string> = {};
      for (const [col, role] of Object.entries(newMap)) {
        if (typeof role === "string" && role in ROLE_LABELS) cleanMap[col] = role;
      }
      ds.meta.mapping = cleanMap;
      for (const c of ds.meta.columns || []) {
        c.role = cleanMap[c.name] || null;
      }
      const haveRoles = new Set(Object.values(cleanMap));
      const missingRoles = ["amount", "provider"].filter((r) => !haveRoles.has(r)).map((r) => ROLE_LABELS[r]);
      ds.meta.procurement = {
        ready: missingRoles.length === 0,
        missing: missingRoles,
        supply: haveRoles.has("quantity") && haveRoles.has("quantity_delivered"),
      };
      await idbPut("datasets", { id: ds.meta.id, meta: ds.meta, rows: ds.rows, rawRows: ds.rawRows });
      return { handled: true, data: ds.meta };
    }

    if ((sub === "suggested-kpis" || sub === "suggest") && method === "GET") {
      return { handled: true, data: buildSuggestedKpis(ds) };
    }

    if (sub === "kpis" && method === "POST") {
      const t0 = performance.now();
      const filtered = filterRows(ds, opts.body?.filters, opts.body?.search);
      const items = opts.body?.kpis || buildSuggestedKpis(ds);
      const res = items.map((k: any) => {
        try {
          const val = evalMetric(filtered, k.metric);
          return { ...k, value: val, rows: filtered.length };
        } catch (e: any) {
          return { ...k, value: null, rows: filtered.length, error: e.message };
        }
      });
      return { handled: true, data: { kpis: res, ms: Math.round((performance.now() - t0) * 10) / 10 } };
    }

    if (sub === "aggregate" && method === "POST") {
      const t0 = performance.now();
      const body = opts.body || {};
      const metric = body.metric || { op: "count" };
      const groupBy: Array<{ col: string; grain?: string }> = body.group_by || [];
      const topN = body.top_n ?? 10;
      const sort = body.sort || "desc";
      const sortByLabel = !!body.sort_by_label;
      const includeOthers = !!body.include_others;

      const filtered = filterRows(ds, body.filters, body.search);
      const total = evalMetric(filtered, metric);
      const colTypes: Record<string, string> = { _period: "category" };
      for (const c of ds.meta.columns || []) colTypes[c.name] = c.type;

      if (!groupBy.length) {
        return {
          handled: true,
          data: {
            total,
            rows_considered: filtered.length,
            rows: [],
            metric: metricLabel(metric),
            additive: isAdditive(metric),
            groups: 0,
            ms: Math.round((performance.now() - t0) * 10) / 10,
          },
        };
      }

      const groups = new Map<string, { keys: string[]; rows: Record<string, any>[] }>();
      for (const r of filtered) {
        const keys = groupBy.map((d) => dimValue(r, d, colTypes));
        const gk = keys.join("\x1f");
        const g = groups.get(gk);
        if (g) g.rows.push(r);
        else groups.set(gk, { keys, rows: [r] });
      }

      let out = Array.from(groups.values()).map((g) => ({
        keys: g.keys,
        label: g.keys.join(" · "),
        value: evalMetric(g.rows, metric),
        rows: g.rows.length,
        share: null as number | null,
      }));

      const isTime = colTypes[groupBy[0].col] === "date";
      if (isTime || sortByLabel) {
        out.sort((a, b) => a.keys[0].localeCompare(b.keys[0]));
      } else {
        out.sort((a, b) => {
          const va = a.value ?? -Infinity;
          const vb = b.value ?? -Infinity;
          return sort === "asc" ? va - vb : vb - va;
        });
      }

      const totalGroups = out.length;
      if (topN && includeOthers && out.length > topN && isAdditive(metric)) {
        const head = out.slice(0, topN);
        const tail = out.slice(topN);
        const othersVal = Math.round(tail.reduce((s, x) => s + (Number(x.value) || 0), 0) * 100) / 100;
        const othersRows = tail.reduce((s, x) => s + x.rows, 0);
        out = [...head, { keys: ["Otros"], label: "Otros", value: othersVal, rows: othersRows, share: null }];
      } else if (topN) {
        out = out.slice(0, topN);
      }

      if (isAdditive(metric) && total) {
        for (const r of out) {
          r.share = (Number(r.value) || 0) / Number(total);
        }
      }

      return {
        handled: true,
        data: {
          total,
          rows_considered: filtered.length,
          rows: out,
          metric: metricLabel(metric),
          additive: isAdditive(metric),
          groups: totalGroups,
          ms: Math.round((performance.now() - t0) * 10) / 10,
        },
      };
    }

    if ((sub === "crosstab" || sub === "cross") && method === "POST") {
      const t0 = performance.now();
      const body = opts.body || {};
      const metrics: any[] = body.metrics?.length ? body.metrics : [{ op: "count" }];
      const rowDims: Array<{ col: string; grain?: string }> = body.rows || [];
      const rawCols = body.cols !== undefined ? body.cols : body.col ? [body.col] : [];
      const colDims: Array<{ col: string; grain?: string }> = (Array.isArray(rawCols) ? rawCols : [rawCols]).filter(
        (d: any) => d && d.col
      );
      const topRows = Math.max(1, Math.min(Number(body.top_rows || 50), 1000));
      const topCols = Math.max(1, Math.min(Number(body.top_cols || 12), 60));
      const sort = body.sort || "desc";
      const sortMetric = Math.max(0, Math.min(Number(body.sort_metric || 0), metrics.length - 1));
      const sortByLabel = !!body.sort_by_label;

      const filtered = filterRows(ds, body.filters, body.search);
      const colTypes: Record<string, string> = { _period: "category" };
      for (const c of ds.meta.columns || []) colTypes[c.name] = c.type;

      const grandValues = metrics.map((m) => evalMetric(filtered, m));
      const grand = { values: grandValues, rows: filtered.length };

      const rGroups = new Map<string, { keys: string[]; rows: Record<string, any>[] }>();
      for (const r of filtered) {
        const keys = rowDims.map((d) => dimValue(r, d, colTypes));
        const rk = keys.join("\x1f");
        const g = rGroups.get(rk);
        if (g) g.rows.push(r);
        else rGroups.set(rk, { keys, rows: [r] });
      }

      const allRows = Array.from(rGroups.values()).map((g) => ({
        keys: g.keys,
        label: g.keys.join(" · "),
        values: metrics.map((m) => evalMetric(g.rows, m)),
        rows: g.rows.length,
        share: [] as (number | null)[],
      }));

      const rIsTime = rowDims[0] && colTypes[rowDims[0].col] === "date";
      if (rIsTime || sortByLabel) {
        allRows.sort((a, b) => a.label.localeCompare(b.label));
      } else {
        allRows.sort((a, b) => {
          const va = Number(a.values[sortMetric] ?? -Infinity);
          const vb = Number(b.values[sortMetric] ?? -Infinity);
          return sort === "asc" ? va - vb : vb - va;
        });
      }

      const outRows = allRows.slice(0, topRows);
      const additive = metrics.map((m) => isAdditive(m));
      for (const r of outRows) {
        r.share = metrics.map((_, k) =>
          additive[k] && grand.values[k] ? (Number(r.values[k]) || 0) / Number(grand.values[k]) : null
        );
      }

      let outCols: any[] = [];
      let cells: any[] = [];
      let others: any[] = [];
      let colGroupsCount = 0;

      if (colDims.length > 0) {
        const cGroups = new Map<string, { keys: string[]; rows: Record<string, any>[] }>();
        for (const r of filtered) {
          const keys = colDims.map((d) => dimValue(r, d, colTypes));
          const ck = keys.join(" · ");
          const g = cGroups.get(ck);
          if (g) g.rows.push(r);
          else cGroups.set(ck, { keys, rows: [r] });
        }
        colGroupsCount = cGroups.size;
        const allCols = Array.from(cGroups.entries()).map(([key, g]) => ({
          key,
          keys: g.keys,
          values: metrics.map((m) => evalMetric(g.rows, m)),
          rows: g.rows.length,
        }));
        const cIsTime = colDims.length === 1 && colTypes[colDims[0].col] === "date";
        if (cIsTime) allCols.sort((a, b) => a.key.localeCompare(b.key));
        else allCols.sort((a, b) => Number(b.values[sortMetric] ?? -Infinity) - Number(a.values[sortMetric] ?? -Infinity));
        outCols = allCols.slice(0, topCols);

        const rIdxMap = new Map<string, number>();
        outRows.forEach((r, idx) => rIdxMap.set(r.keys.join("\x1f"), idx));
        const cIdxMap = new Map<string, number>();
        outCols.forEach((c, idx) => cIdxMap.set(c.key, idx));

        const cellBuckets = new Map<string, { r: number; c: number; rows: Record<string, any>[] }>();
        for (const r of filtered) {
          const rk = rowDims.map((d) => dimValue(r, d, colTypes)).join("\x1f");
          const ck = colDims.map((d) => dimValue(r, d, colTypes)).join(" · ");
          const ri = rIdxMap.get(rk);
          const ci = cIdxMap.get(ck);
          if (ri !== undefined && ci !== undefined) {
            const k = `${ri}:${ci}`;
            const b = cellBuckets.get(k);
            if (b) b.rows.push(r);
            else cellBuckets.set(k, { r: ri, c: ci, rows: [r] });
          }
        }
        cells = Array.from(cellBuckets.values()).map((b) => ({
          r: b.r,
          c: b.c,
          values: metrics.map((m) => evalMetric(b.rows, m)),
          rows: b.rows.length,
        }));

        if (colGroupsCount > outCols.length) {
          const acc = new Map<number, number[]>();
          const cnt = new Map<number, number>();
          for (const cell of cells) {
            const arr = acc.get(cell.r) || new Array(metrics.length).fill(0);
            cell.values.forEach((v: any, k: number) => {
              arr[k] += Number(v) || 0;
            });
            acc.set(cell.r, arr);
            cnt.set(cell.r, (cnt.get(cell.r) || 0) + cell.rows);
          }
          outRows.forEach((r, i) => {
            const a = acc.get(i) || new Array(metrics.length).fill(0);
            const orows = r.rows - (cnt.get(i) || 0);
            if (orows > 0) {
              others.push({
                r: i,
                values: metrics.map((_, k) => (additive[k] ? (Number(r.values[k]) || 0) - a[k] : null)),
                rows: orows,
              });
            }
          });
        }
      }

      let conc: Record<string, number> | null = null;
      if (additive[sortMetric] && grand.values[sortMetric] && !rIsTime && !sortByLabel && sort !== "asc") {
        let accV = 0;
        conc = {};
        outRows.forEach((r, idx) => {
          accV += Number(r.values[sortMetric]) || 0;
          const rank = idx + 1;
          if ([1, 3, 5, 10, 20].includes(rank)) {
            conc![`top${rank}`] = accV / Number(grand.values[sortMetric]);
          }
        });
      }

      return {
        handled: true,
        data: {
          metrics: metrics.map((m, i) => ({ label: metricLabel(m), additive: additive[i], op: m.op, col: m.col })),
          row_dims: rowDims.map((d) => d.col),
          col_dim: colDims.length ? colDims.map((d) => d.col).join(" × ") : null,
          col_dims: colDims.map((d) => d.col),
          rows: outRows,
          row_groups: allRows.length,
          cols: outCols,
          col_groups: colGroupsCount,
          cells,
          others,
          grand,
          rows_considered: grand.rows,
          concentration: conc,
          truncated_rows: allRows.length > outRows.length,
          truncated_cols: colGroupsCount > outCols.length,
          ms: Math.round((performance.now() - t0) * 10) / 10,
        },
      };
    }

    if (sub === "rows" && method === "POST") {
      const t0 = performance.now();
      const body = opts.body || {};
      const filtered = filterRows(ds, body.filters, body.search);
      const sortCol = body.sort;
      const desc = !!body.desc;

      if (sortCol) {
        filtered.sort((a, b) => {
          const va = a[sortCol];
          const vb = b[sortCol];
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          if (typeof va === "number" && typeof vb === "number") return desc ? vb - va : va - vb;
          return desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
        });
      } else {
        filtered.sort((a, b) => (a._row_id || 0) - (b._row_id || 0));
      }

      const offset = Math.max(0, parseInt(body.offset || "0", 10) || 0);
      const reqLim = parseInt(body.limit || "100", 10) || 100;
      const limit = reqLim <= 0 || reqLim >= 100000 ? 100000 : Math.min(reqLim, 100000);
      const slice = filtered.slice(offset, offset + limit);

      return {
        handled: true,
        data: {
          total: filtered.length,
          offset,
          limit,
          rows: slice,
          ms: Math.round((performance.now() - t0) * 10) / 10,
        },
      };
    }

    const mRec = /^records\/(\d+)$/.exec(sub);
    if (mRec && method === "GET") {
      const rowId = parseInt(mRec[1], 10);
      const typed = ds.rows.find((r) => r._row_id === rowId);
      if (!typed) throw new Error("Registro no encontrado.");
      const orig = ds.rawRows.find((r) => r._row_id === rowId) || typed;
      const imp = (ds.meta.imports || []).find((i: any) => i.id === typed._import_id) || ds.meta.imports?.[0] || {};
      return {
        handled: true,
        data: {
          typed,
          original: orig,
          source: {
            file: imp.filename || ds.meta.source || "Archivo cargado",
            sheet: imp.sheet || "BASE",
            period: typed._period || ds.meta.period,
            import_id: imp.id || "imp_1",
          },
        },
      };
    }

    if (sub === "distinct" && method === "POST") {
      const body = opts.body || {};
      const col = body.col;
      const q = body.search ? String(body.search).toLowerCase() : "";
      const limit = Math.min(500, parseInt(body.limit || "80", 10) || 80);
      const filtered = filterRows(ds, body.filters);
      const counts = new Map<string, number>();
      for (const r of filtered) {
        const v = r[col];
        if (v === null || v === undefined || v === "") continue;
        const sv = String(v);
        if (q && !sv.toLowerCase().includes(q)) continue;
        counts.set(sv, (counts.get(sv) || 0) + 1);
      }
      const out = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, limit);
      return { handled: true, data: out };
    }

    if (sub === "column-stats" && method === "GET") {
      const col = url.searchParams.get("col") || "";
      const colInfo = (ds.meta.columns || []).find((c: any) => c.name === col);
      const t = colInfo?.type || "text";
      const vals = ds.rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
      const distinct = new Set(vals).size;
      let min = null;
      let max = null;
      if (vals.length > 0 && (t === "number" || t === "date")) {
        const sorted = [...vals].sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))));
        min = sorted[0];
        max = sorted[sorted.length - 1];
      }
      return {
        handled: true,
        data: { column: col, type: t, total: ds.rows.length, non_null: vals.length, distinct, min, max },
      };
    }

    if (sub === "quality" && method === "GET") {
      const total = ds.rows.length;
      let withIssues = 0;
      let exactDups = 0;
      const issueCounts = new Map<string, number>();
      for (const r of ds.rows) {
        if (r._issues) {
          withIssues++;
          if (String(r._issues).includes("duplicado exacto")) exactDups++;
          for (const part of String(r._issues).split("; ")) {
            if (part) issueCounts.set(part, (issueCounts.get(part) || 0) + 1);
          }
        }
      }
      const cols = (ds.meta.columns || []).map((c: any) => {
        let nonNull = 0;
        for (const r of ds.rows) {
          if (r[c.name] !== null && r[c.name] !== undefined && r[c.name] !== "") nonNull++;
        }
        return {
          name: c.name,
          type: c.type,
          role: c.role || null,
          non_null: nonNull,
          nulls: total - nonNull,
          coverage: total > 0 ? nonNull / total : 1,
          warnings: c.warnings || [],
        };
      });
      return {
        handled: true,
        data: {
          total,
          valid: total - withIssues,
          with_issues: withIssues,
          exact_duplicates: exactDups,
          issues: Array.from(issueCounts.entries())
            .map(([issue, count]) => ({ issue, count }))
            .sort((a, b) => b.count - a.count),
          columns: cols,
          unmapped_columns: cols.filter((c: any) => !c.role).map((c: any) => c.name),
          imports: ds.meta.imports || [],
        },
      };
    }

    if (sub === "views") {
      const list = memoryViews.get(ds.meta.id) || [];
      if (method === "GET") {
        const kind = url.searchParams.get("kind");
        return { handled: true, data: kind ? list.filter((v) => v.kind === kind) : list };
      }
      if (method === "POST") {
        const v = {
          id: "vw_" + Date.now().toString(36),
          dataset_id: ds.meta.id,
          name: String(opts.body?.name || "Vista").slice(0, 120),
          kind: opts.body?.kind || "chart",
          payload: opts.body?.payload || {},
          created_at: Math.floor(Date.now() / 1000),
        };
        const next = [v, ...list];
        memoryViews.set(ds.meta.id, next);
        await idbPut("views", { dataset_id: ds.meta.id, items: next });
        return { handled: true, data: v };
      }
    }

    if (sub === "risks" && method === "POST") {
      return { handled: true, data: analyzeDatasetRisks(ds, opts.body?.filters, opts.body?.search) };
    }

    if (sub === "reports/generate" && method === "POST") {
      const body = opts.body || {};
      const filtered = filterRows(ds, body.filters);
      const roles = getRolesMap(ds);
      const amtCol = roles.amount;
      const provCol = roles.provider;
      const qtyCol = roles.quantity;
      const delivCol = roles.quantity_delivered;
      const contractCol = roles.contract_id;
      const procCol = roles.procedure || roles.status;

      const totRows = filtered.length;
      const totalAmount = amtCol ? Number(evalMetric(filtered, { op: "sum", col: amtCol }) || 0) : 0;
      const contractsCnt = contractCol ? Number(evalMetric(filtered, { op: "count_distinct", col: contractCol }) || 0) : totRows;
      const provCnt = provCol ? Number(evalMetric(filtered, { op: "count_distinct", col: provCol }) || 0) : 0;

      let delivRate = 100;
      let pendingUnits = 0;
      if (qtyCol && delivCol) {
        const comp = evalMetric(filtered, { op: "compliance", qty: qtyCol, delivered: delivCol });
        delivRate = comp !== null ? Math.round(comp * 1000) / 10 : 100;
        pendingUnits = Number(evalMetric(filtered, { op: "pending", qty: qtyCol, delivered: delivCol }) || 0);
      }

      const riskData = analyzeDatasetRisks(ds, body.filters);

      const providersSummary: any[] = [];
      if (provCol && amtCol && totalAmount > 0) {
        const byProv = new Map<string, { amt: number; cnt: number }>();
        for (const r of filtered) {
          const a = Number(r[amtCol] || 0);
          if (a > 0) {
            const p = String(r[provCol] || "Sin especificar");
            const cur = byProv.get(p) || { amt: 0, cnt: 0 };
            cur.amt += a;
            cur.cnt += 1;
            byProv.set(p, cur);
          }
        }
        Array.from(byProv.entries())
          .sort((a, b) => b[1].amt - a[1].amt)
          .slice(0, 10)
          .forEach(([provider, info]) => {
            providersSummary.push({
              provider,
              amount: Math.round(info.amt * 100) / 100,
              count: info.cnt,
              share: Math.round((info.amt / totalAmount) * 10000) / 100,
            });
          });
      }

      const proceduresSummary: any[] = [];
      if (procCol && amtCol && totalAmount > 0) {
        const byProc = new Map<string, { amt: number; cnt: number }>();
        for (const r of filtered) {
          const a = Number(r[amtCol] || 0);
          if (a > 0) {
            const p = String(r[procCol] || "Sin especificar");
            const cur = byProc.get(p) || { amt: 0, cnt: 0 };
            cur.amt += a;
            cur.cnt += 1;
            byProc.set(p, cur);
          }
        }
        Array.from(byProc.entries())
          .sort((a, b) => b[1].amt - a[1].amt)
          .forEach(([procedure, info]) => {
            proceduresSummary.push({
              procedure,
              amount: Math.round(info.amt * 100) / 100,
              count: info.cnt,
              share: Math.round((info.amt / totalAmount) * 10000) / 100,
            });
          });
      }

      const title = body.title || "INFORME EJECUTIVO DE INTELIGENCIA DE DATOS Y CONTRATACIONES";
      const institution = body.institution || ds.meta.institution || "DIRECCIÓN GENERAL DE ADMINISTRACIÓN";
      const author = body.author || "Unidad de Inteligencia y Control de Gestión";
      const period = body.period || ds.meta.periods?.[0] || "Ejercicio 2026";

      const narrative =
        `El presente informe consolida los resultados cuantitativos y el diagnóstico de control interno ` +
        `correspondiente al período ${period} para ${institution} (Conjunto: «${ds.meta.name}»). Durante este ciclo se analizaron ` +
        `${contractsCnt.toLocaleString("es-MX")} instrumentos/contratos y ${totRows.toLocaleString("es-MX")} registros con un importe total de ` +
        `$${totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN distribuido entre ${provCnt.toLocaleString("es-MX")} proveedores.\n\n` +
        `En materia de cumplimiento, la tasa global se sitúa en ${delivRate.toFixed(1)}%, con ${pendingUnits.toLocaleString("es-MX")} unidades/partidas en seguimiento. ` +
        `La evaluación integral de riesgos arrojó un nivel de severidad '${riskData.overall_severity}', con un índice HHI de ` +
        `${Math.round(riskData.concentration.hhi_score).toLocaleString("es-MX")} puntos y ${riskData.findings.length} hallazgos de control.`;

      return {
        handled: true,
        data: {
          metadata: {
            title,
            report_type: body.type || "executive",
            institution,
            author,
            period,
            generated_at: new Date().toLocaleString("es-MX"),
            dataset_name: ds.meta.name,
            dataset_id: ds.meta.id,
          },
          kpis: [
            { label: "Monto Total Contratado", value: `$${totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`, sub: "Importe total formalizado" },
            { label: "Contratos / Instrumentos", value: contractsCnt.toLocaleString("es-MX"), sub: `${totRows.toLocaleString("es-MX")} registros evaluados` },
            { label: "Cumplimiento de Entrega", value: `${delivRate.toFixed(1)}%`, sub: `${pendingUnits.toLocaleString("es-MX")} pendientes` },
            { label: "Proveedores Únicos", value: provCnt.toLocaleString("es-MX"), sub: "Padrón activo en el conjunto" },
            { label: "Índice de Concentración", value: `${Math.round(riskData.concentration.hhi_score).toLocaleString("es-MX")} pts`, sub: `Nivel ${riskData.concentration.hhi_level}` },
            { label: "Severidad de Riesgo", value: riskData.overall_severity, sub: `${riskData.findings.length} hallazgos prioritarios` },
          ],
          narrative,
          risks: riskData,
          providers: providersSummary,
          procedures: proceduresSummary,
          sections: body.sections || ["header", "kpis", "summary", "risks", "providers", "procedures", "signatures"],
        },
      };
    }

    if (sub === "ai/query" && method === "POST") {
      const qText = String(opts.body?.query || "");
      const filtered = filterRows(ds, opts.body?.filters);
      const roles = getRolesMap(ds);
      const amtCol = roles.amount;
      const provCol = roles.provider;
      const contractCol = roles.contract_id;
      const totalAmount = amtCol ? Number(evalMetric(filtered, { op: "sum", col: amtCol }) || 0) : 0;
      const contractsCnt = contractCol ? Number(evalMetric(filtered, { op: "count_distinct", col: contractCol }) || 0) : filtered.length;
      const provCnt = provCol ? Number(evalMetric(filtered, { op: "count_distinct", col: provCol }) || 0) : 0;
      const riskData = analyzeDatasetRisks(ds, opts.body?.filters);
      const topProvs = riskData.concentration.top_providers || [];

      const answer =
        `**Resumen Analítico («${ds.meta.name}»):**\n\n` +
        `- **Registros analizados:** ${filtered.length.toLocaleString("es-MX")}\n` +
        `- **Contratos únicos:** ${contractsCnt.toLocaleString("es-MX")}\n` +
        `- **Proveedores únicos:** ${provCnt.toLocaleString("es-MX")}\n` +
        `- **Monto total:** $${totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN\n` +
        (topProvs[0]
          ? `- **Proveedor principal:** ${topProvs[0].provider} ($${topProvs[0].amount.toLocaleString("es-MX")} MXN · ${topProvs[0].share_pct}%)\n`
          : "");

      return {
        handled: true,
        data: {
          query: qText,
          answer,
          cards: [
            { label: "Registros", value: filtered.length.toLocaleString("es-MX") },
            { label: "Contratos", value: contractsCnt.toLocaleString("es-MX") },
            { label: "Monto Total", value: `$${totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN` },
          ],
          explanation: `Cálculo directo sobre los ${filtered.length.toLocaleString("es-MX")} registros activos del conjunto «${ds.meta.name}».`,
          sql: "SELECT COUNT(*), SUM(monto) FROM dataset_activo",
          table: topProvs.length
            ? {
                headers: ["Proveedor", "Monto (MXN)", "Participación", "Registros"],
                rows: topProvs.map((p: any) => ({
                  Proveedor: p.provider,
                  "Monto (MXN)": `$${p.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`,
                  Participación: `${p.share_pct}%`,
                  Registros: p.row_count,
                })),
              }
            : null,
          suggested_actions: ["Generar informe en Report Studio", "Explorar cruces en Análisis Cruzado"],
        },
      };
    }
  }

  return { handled: false };
}

export async function handleLocalDownload(path: string, body: any, fallbackName: string): Promise<boolean> {
  await ensureInitialized();
  const url = new URL(path, "http://localhost");
  const mDs = /^\/api\/datasets\/([^/]+)\/(export\.csv|quality\/review\.csv)$/.exec(url.pathname);
  if (!mDs) return false;

  const datasetId = mDs[1];
  const kind = mDs[2];
  const ds = memoryDatasets.get(datasetId) || Array.from(memoryDatasets.values())[0];
  if (!ds) return false;

  const cols = (ds.meta.columns || []).map((c: any) => c.name);
  let rowsToExport: Record<string, any>[] = [];
  let headers: string[] = [];

  if (kind === "quality/review.csv") {
    rowsToExport = ds.rows.filter((r) => r._issues);
    headers = ["_row_id", "_period", "_issues", ...cols];
  } else {
    rowsToExport = filterRows(ds, body?.filters, body?.search);
    headers = [...cols, "_row_id", "_period", "_issues"];
  }

  let csv = "\uFEFF" + headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(",") + "\n";
  for (const r of rowsToExport) {
    const line = headers
      .map((h) => {
        const v = r[h];
        return `"${String(v ?? "").replace(/"/g, '""')}"`;
      })
      .join(",");
    csv += line + "\n";
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fallbackName || `${ds.meta.name}_export.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  return true;
}

