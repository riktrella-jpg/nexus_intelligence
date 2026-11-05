import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { readZipBuffer, writeZipBuffer, type ZipEntry } from "./oicEngineServer";

export const REGLAS: Record<string, [string, string, string]> = {
  AE: ["CNIS / Compendio", "Q", "Revisar clave, vigencia y soporte documental."],
  AF: ["Firma frente a suministro", "I,J,AB,AC", "Aclarar formalización del contrato."],
  AG: ["Fechas contractuales", "N,O", "Corregir/soportar vigencia contractual."],
  AH: ["Evento antes del inicio", "N,Y,AB", "Revisar fecha y documento habilitante."],
  AI: ["Evento después de la conclusión", "O,Y,AB", "Revisar convenios y prórrogas."],
  AJ: ["Órdenes frente a fechas", "X,Y", "Aclarar órdenes/fechas y homologar estructura."],
  AK: ["Campos cuantitativos", "P,S,T,U,Z,AC", "Corregir los valores numéricos no válidos."],
  AL: ["Monto contratado", "P,S,T", "Verificar importe a nivel de renglón, clave o contrato; IVA."],
  AM: ["Precio por clave y contrato", "H,Q,T", "Confirmar precio y posibles modificaciones."],
  AN: ["Monto ejercido", "U,AC,T", "Confirmar nivel de captura y base de cálculo."],
  AO: ["Monto cero con suministro", "U,AC", "Confirmar recepción y estatus de pago."],
  AP: ["Campos esenciales", "W,X,Y,Z,AA,AB,AC", "Completar campos faltantes y documentar."],
  AQ: ["Solicitud pendiente", "Y,AB,AC", "Verificar plazo de entrega pactado."],
  AR: ["Solicitado frente a suministrado", "Z,AC", "Conciliar cantidades y soporte de recepción."],
  AS: ["Posible duplicado", "D,H,Q,X,Y,AA,AB,AC", "Verificar si es evento distinto; no borrar automáticamente."],
  AT: ["Fechas no estructuradas", "N,O,Y,AB", "Homologar fechas sin inferir eventos múltiples."],
  AU: ["Evento posterior al corte", "Y,AB", "Documentar el evento fuera del periodo."],
};

export const RULE_CODES = Object.keys(REGLAS);

export const RUBRO_MEDICAMENTOS = "MEDICAMENTOS";
export const RUBRO_CURACION = "MATERIAL DE CURACIÓN";

const COLS_SET = new Set<string>(
  Array.from({ length: 30 }, (_, i) => (i < 26 ? String.fromCharCode(65 + i) : "A" + String.fromCharCode(65 + i - 26)))
);

export function colnum(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n;
}

export function colletter(n: number): string {
  let out = "";
  let cur = n;
  while (cur > 0) {
    const r = (cur - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    cur = Math.floor((cur - 1) / 26);
  }
  return out;
}

export function norm(s: unknown): string {
  const raw = s === null || s === undefined ? "" : String(s);
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function empty(x: unknown): boolean {
  return x === null || x === undefined || String(x).trim() === "";
}

// Represent numeric cells discovered from XML (<v> without string type)
export class ExcelNumeric {
  readonly raw: string;
  readonly num: number;
  constructor(raw: string, num: number) {
    this.raw = raw;
    this.num = num;
  }
  toString(): string {
    if (this.raw.toLowerCase().includes("e")) {
      const s = this.num.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
      return s || "0";
    }
    if (this.raw.includes(".")) {
      return this.raw.replace(/0+$/, "").replace(/\.$/, "") || "0";
    }
    return this.raw;
  }
}

export function numeric(v: unknown): number | null {
  if (v instanceof ExcelNumeric) {
    return Number.isFinite(v.num) ? v.num : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  return null;
}

export function dateExcel(v: unknown, is1904 = false): string | null {
  const n = numeric(v);
  if (n === null || n < 1 || n > 2958465) return null;
  const days = Math.floor(n);
  const baseMs = is1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const dt = new Date(baseMs + days * 86400000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetweenIso(isoA: string, isoB: string): number {
  const [ya, ma, da] = isoA.split("-").map(Number);
  const [yb, mb, db] = isoB.split("-").map(Number);
  return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86400000);
}

export function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof ExcelNumeric) return v.toString();
  return String(v).trim();
}

export function rubro(v: unknown): string {
  const n = norm(v);
  if (n === "medicamento" || n === "medicamentos") return RUBRO_MEDICAMENTOS;
  if (
    n === "material de curacion" ||
    n === "materiales de curacion" ||
    n === "material curacion" ||
    n === "material de curaciones"
  ) {
    return RUBRO_CURACION;
  }
  return "NO CLASIFICADO";
}

function claveNoInformada(q: unknown): boolean {
  const x = norm(q);
  return (
    !x ||
    x === "na" ||
    x === "n a" ||
    x === "no aplica" ||
    x === "sin clave" ||
    x === "sin clave del cnis" ||
    x === "sin clave cnis" ||
    x === "pendiente" ||
    x === "s c" ||
    x === "s cnis"
  );
}

function claveAnalitica(d: Record<string, unknown>): string {
  const q = fmt(d["Q"]).toUpperCase();
  if (claveNoInformada(q)) {
    return "SIN CLAVE: " + norm(d["R"]);
  }
  return q;
}

function sinOrden(v: unknown): boolean {
  const x = norm(v);
  return (
    !x ||
    x === "na" ||
    x === "n a" ||
    x === "no aplica" ||
    x === "sin orden" ||
    x === "sin orden de suministro" ||
    x === "sin ordenes de suministro"
  );
}

export interface SuministroFinding {
  fila: number;
  codigo: string;
  gravedad: string;
  descripcion: string;
  columnas: string[];
  accion: string;
  evidencia: string;
}

export interface SuministroRowReport {
  fila: number;
  datos: Record<string, unknown>;
  reglas: Record<string, string>;
  hallazgos: SuministroFinding[];
  estado: string;
}

export interface SuministroOptions {
  fecha_corte: string;
  dias_pendiente: number;
  tolerancia_contratado: number;
  tolerancia_ejercido: number;
  extras: boolean;
  year1904: boolean;
}

let cachedCatalog: Record<string, boolean> | null = null;

export function loadCatalog(): Record<string, boolean> {
  if (cachedCatalog) return cachedCatalog;
  const candidates = [
    path.join(process.cwd(), "public", "data", "catalogo_cnis.json.gz"),
    path.join(process.cwd(), "..", "backend", "app", "oic", "catalogo_cnis.json.gz"),
    path.join(process.cwd(), "backend", "app", "oic", "catalogo_cnis.json.gz"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
      const gz = fs.readFileSync(/*turbopackIgnore: true*/ p);
      const raw = zlib.gunzipSync(gz).toString("utf8");
      const parsed = JSON.parse(raw);
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed.claves || {})) {
        out[String(k).trim().toUpperCase()] = Boolean(v);
      }
      cachedCatalog = out;
      return out;
    }
  }
  throw new Error("Falta catálogo CNIS (catalogo_cnis.json.gz).");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function encodeXmlEntities(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getSst(zipMap: Map<string, Buffer>): string[] {
  const buf = zipMap.get("xl/sharedStrings.xml");
  if (!buf) return [];
  const xml = buf.toString("utf8");
  const out: string[] = [];
  const siRe = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  const tRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const body = m[1];
    let text = "";
    let tm: RegExpExecArray | null;
    tRe.lastIndex = 0;
    while ((tm = tRe.exec(body)) !== null) {
      text += decodeXmlEntities(tm[1]);
    }
    out.push(text);
  }
  return out;
}

function getSheets(zipMap: Map<string, Buffer>): [string, string][] {
  const wbXml = zipMap.get("xl/workbook.xml")?.toString("utf8") || "";
  const relXml = zipMap.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const links: Record<string, string> = {};
  const relRe = /<(?:\w+:)?Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(relXml)) !== null) {
    const id = m[1].match(/\bId="([^"]+)"/)?.[1];
    const target = m[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) links[id] = target;
  }
  const out: [string, string][] = [];
  const shRe = /<(?:\w+:)?sheet\b([^>]*)\/?>/g;
  while ((m = shRe.exec(wbXml)) !== null) {
    const name = decodeXmlEntities(m[1].match(/\bname="([^"]+)"/)?.[1] || "");
    const rid = m[1].match(/\br:id="([^"]+)"/)?.[1] || m[1].match(/\bid="([^"]+)"/)?.[1] || "";
    const targetRaw = (links[rid] || "").replace(/^\/+/, "");
    const target = targetRaw.startsWith("xl/") ? targetRaw : `xl/${targetRaw}`;
    if (name && links[rid]) out.push([name, target]);
  }
  return out;
}

function getDateSystem(zipMap: Map<string, Buffer>): boolean {
  const wbXml = zipMap.get("xl/workbook.xml")?.toString("utf8") || "";
  const m = wbXml.match(/<(?:\w+:)?workbookPr\b([^>]*)\/?>/);
  if (!m) return false;
  const d1904 = m[1].match(/\bdate1904="([^"]+)"/)?.[1];
  return d1904 === "1" || d1904 === "true";
}

function findSheets(zipMap: Map<string, Buffer>, sheet?: string | null): [string, string][] {
  const sheets = getSheets(zipMap);
  if (sheet && sheet.trim()) {
    const chosen = sheets.filter((p) => norm(p[0]) === norm(sheet));
    if (chosen.length === 0) {
      throw new Error("No existe la hoja solicitada. Disponibles: " + sheets.map((x) => x[0]).join(", "));
    }
    return chosen;
  }
  for (const target of ["BASE_REVISION", "BASE", "MEDICAMENTOS", "SUMINISTRO MEDICAMENTOS"]) {
    const chosen = sheets.filter((p) => norm(p[0]) === norm(target));
    if (chosen.length > 0) return chosen;
  }
  throw new Error("No identifiqué una hoja BASE_REVISION, BASE o MEDICAMENTOS; especificar --hoja.");
}

function parseCellValue(cAttrs: string, cBody: string, sst: string[]): unknown {
  const t = cAttrs.match(/\bt="([^"]+)"/)?.[1] || "";
  if (t === "inlineStr" || t === "inline") {
    let txt = "";
    const tRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(cBody)) !== null) {
      txt += decodeXmlEntities(tm[1]);
    }
    return txt;
  }
  const vMatch = cBody.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
  if (!vMatch) return null;
  const vRaw = decodeXmlEntities(vMatch[1]);
  if (t === "s") {
    const idx = parseInt(vRaw, 10);
    return Number.isNaN(idx) || idx < 0 || idx >= sst.length ? null : sst[idx];
  }
  if (t === "str" || t === "e") return vRaw;
  if (t === "b") return vRaw === "1";
  const num = Number(vRaw);
  if (!Number.isNaN(num) && vRaw.trim() !== "") {
    return new ExcelNumeric(vRaw.trim(), num);
  }
  return vRaw;
}

function analyzeSource(
  zipMap: Map<string, Buffer>,
  xmlPath: string,
  sst: string[]
): {
  headerRow: number;
  active: Map<number, Record<string, unknown>>;
  headings: Record<string, string>;
  lastHeader: number;
} {
  const xml = zipMap.get(xmlPath)?.toString("utf8") || "";
  let headerRow: number | null = null;
  let headings: Record<string, string> = {};
  let lastHeader = 30;
  const active = new Map<number, Record<string, unknown>>();

  const rowRe = /<(?:\w+:)?row\b([^/>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  const cellRe = /<(?:\w+:)?c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml)) !== null) {
    const rAttrs = rm[1];
    const rBody = rm[2] || "";
    const n = parseInt(rAttrs.match(/\br="(\d+)"/)?.[1] || "0", 10);
    if (!n || !rBody) continue;

    const d: Record<string, unknown> = {};
    cellRe.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rBody)) !== null) {
      const cAttrs = cm[1];
      const cBody = cm[2] || "";
      const ref = cAttrs.match(/\br="([A-Z]+)/)?.[1];
      if (!ref) continue;
      if (n <= 15 || colnum(ref) <= 30) {
        const v = parseCellValue(cAttrs, cBody, sst);
        if (v !== null) d[ref] = v;
      }
    }

    if (headerRow === null && n <= 15) {
      const checks: [string, string][] = [
        ["H", "contrato"],
        ["K", "proveedor"],
        ["Q", "clave"],
        ["P", "monto"],
        ["T", "precio"],
        ["AC", "piezas"],
        ["Y", "fecha"],
      ];
      let matches = 0;
      for (const [col, kw] of checks) {
        if (norm(d[col] ?? "").includes(kw)) matches++;
      }
      if (matches >= 4) {
        headerRow = n;
        headings = {};
        for (const [k, v] of Object.entries(d)) {
          headings[k] = fmt(v);
        }
        lastHeader = Math.max(30, ...Object.keys(headings).map(colnum));
        continue;
      }
    }

    if (headerRow !== null && n > headerRow) {
      const rowData: Record<string, unknown> = {};
      let hasAny = false;
      for (const [k, v] of Object.entries(d)) {
        if (COLS_SET.has(k) && !empty(v)) {
          rowData[k] = v;
          hasAny = true;
        }
      }
      if (hasAny) active.set(n, rowData);
    }
  }

  if (headerRow === null) {
    throw new Error("Encabezados del layout incompatibles. Se requiere estructura A:AD y columnas H/K/P/Q/T/Y/AC.");
  }

  return { headerRow, active, headings, lastHeader };
}

function getStatus(findings: SuministroFinding[]): string {
  for (const level of ["ERROR", "REVISAR", "INFORMATIVO"]) {
    if (findings.some((h) => h.gravedad === level)) return level;
  }
  return "OK";
}

function evaluateSubset(
  records: Map<number, Record<string, unknown>>,
  cat: Record<string, boolean>,
  options: SuministroOptions
): Map<number, SuministroRowReport> {
  const allPrices = new Map<string, Set<string>>();
  const duplicates = new Map<string, number>();
  const contractProviders = new Map<string, Set<string>>();
  const amountKey = new Map<string, Set<string>>();

  for (const [, d] of records.entries()) {
    const hUpper = fmt(d["H"]).toUpperCase();
    const ca = claveAnalitica(d);
    const pr = numeric(d["T"]);
    if (hUpper && ca && !claveNoInformada(d["Q"]) && pr !== null) {
      const pk = `${hUpper}||${ca}`;
      if (!allPrices.has(pk)) allPrices.set(pk, new Set());
      allPrices.get(pk)!.add(fmt(d["T"]));
    }
    if (!empty(d["H"])) {
      const dupKey = ["D", "H", "X", "Y", "AA", "AB", "AC"].map((k) => fmt(d[k]).toUpperCase()).join("||") + "||" + ca;
      duplicates.set(dupKey, (duplicates.get(dupKey) || 0) + 1);
    }
    if (!empty(d["H"]) && !empty(d["K"])) {
      if (!contractProviders.has(hUpper)) contractProviders.set(hUpper, new Set());
      contractProviders.get(hUpper)!.add(norm(d["K"]));
    }
    const amount = numeric(d["P"]);
    if (!empty(d["H"]) && amount !== null && !empty(d["Q"])) {
      const ak = `${hUpper}||${fmt(d["P"])}`;
      if (!amountKey.has(ak)) amountKey.set(ak, new Set());
      amountKey.get(ak)!.add(fmt(d["Q"]).toUpperCase());
    }
  }

  const out = new Map<number, SuministroRowReport>();

  for (const [n, d] of records.entries()) {
    const report: SuministroRowReport = {
      fila: n,
      datos: d,
      reglas: {},
      hallazgos: [],
      estado: "OK",
    };
    out.set(n, report);

    const add = (
      code: string,
      severity: string,
      message: string,
      fields?: string | string[] | null,
      evidence = "",
      action?: string | null
    ) => {
      const rawCols =
        typeof fields === "string"
          ? fields.split(",")
          : fields || (REGLAS[code] ? REGLAS[code][1].split(",") : []);
      const cols = Array.from(new Set(rawCols.filter(Boolean)));
      const act = action || (REGLAS[code] ? REGLAS[code][2] : "Solicitar aclaración o soporte documental.");
      report.hallazgos.push({
        fila: n,
        codigo: code,
        gravedad: severity,
        descripcion: message,
        columnas: cols,
        accion: act,
        evidencia: evidence,
      });
      if (code in REGLAS) {
        report.reglas[code] = `${severity}: ${message}`;
      }
    };

    const ok = (code: string) => {
      if (!(code in report.reglas)) report.reglas[code] = "OK";
    };
    const v = (c: string) => d[c];
    const num = (c: string) => numeric(v(c));
    const fecha = (c: string) => dateExcel(v(c), options.year1904);
    const ev = (fields: string[]) => fields.map((c) => `${c}=${fmt(v(c))}`).join("; ");

    const h = fmt(v("H"));
    const q = fmt(v("Q")).toUpperCase();
    const a = fecha("N");
    const b = fecha("O");
    const req = fecha("Y");
    const ent = fecha("AB");

    // AE
    if (claveNoInformada(v("Q"))) {
      add("AE", "REVISAR", "CLAVE CNIS NO INFORMADA O MARCADA COMO SIN CLAVE", "Q", ev(["Q"]));
    } else if (!(q in cat)) {
      add("AE", "REVISAR", "CLAVE NO LOCALIZADA EN CNIS", "Q", ev(["Q"]));
    } else if (!cat[q]) {
      add("AE", "REVISAR", "CLAVE NO VIGENTE EN CNIS", "Q", ev(["Q"]));
    } else {
      ok("AE");
    }

    // AF
    const signed = norm(v("I"));
    if (signed === "si" || signed === "s") {
      ok("AF");
    } else if ((num("AC") || 0) > 0 || !empty(v("AB"))) {
      add("AF", "REVISAR", "SUMINISTRO REPORTADO CON CONTRATO NO FIRMADO", "I,AB,AC");
    } else if (signed === "no") {
      add("AF", "INFORMATIVO", "CONTRATO NO FIRMADO SIN SUMINISTRO", "I,J");
    } else {
      add("AF", "REVISAR", "ESTATUS DE FIRMA NO VÁLIDO", "I");
    }

    // AG
    if (empty(v("N")) || empty(v("O"))) {
      add("AG", "ERROR", "FECHA CONTRACTUAL AUSENTE", ["N", "O"].filter((c) => empty(v(c))).join(","));
    } else if (a === null || b === null) {
      add("AG", "ERROR", "FECHA CONTRACTUAL NO VÁLIDA", ["N", "O"].filter((c) => fecha(c) === null).join(","));
    } else if (a > b) {
      add("AG", "ERROR", "INICIO POSTERIOR A CONCLUSIÓN", "N,O", ev(["N", "O"]));
    } else {
      ok("AG");
    }

    // AH / AI
    const before = (
      [
        ["Y", req],
        ["AB", ent],
      ] as [string, string | null][]
    )
      .filter(([, dt]) => dt && a && dt < a)
      .map(([c]) => c);
    const after = (
      [
        ["Y", req],
        ["AB", ent],
      ] as [string, string | null][]
    )
      .filter(([, dt]) => dt && b && dt > b)
      .map(([c]) => c);

    if (before.length > 0) {
      add("AH", "REVISAR", "EVENTO ANTERIOR AL INICIO CONTRACTUAL", ["N", ...before], ev(["N", ...before]));
    } else {
      ok("AH");
    }
    if (after.length > 0) {
      add("AI", "REVISAR", "EVENTO POSTERIOR A LA CONCLUSIÓN CONTRACTUAL", ["O", ...after], ev(["O", ...after]));
    } else {
      ok("AI");
    }

    // AJ
    if (sinOrden(v("X")) && empty(v("Y")) && (num("Z") || 0) === 0) {
      ok("AJ");
    } else if (sinOrden(v("X")) || empty(v("Y"))) {
      add("AJ", "REVISAR", "ORDEN O FECHA INCOMPLETA", "X,Y");
    } else {
      const countItems = (x: unknown) =>
        fmt(x)
          .split(/[,;\n]+/)
          .filter((p) => p.trim().length > 0).length;
      if (countItems(v("X")) !== countItems(v("Y"))) {
        add("AJ", "REVISAR", "NO COINCIDE NÚMERO DE ÓRDENES Y FECHAS", "X,Y", ev(["X", "Y"]));
      } else {
        ok("AJ");
      }
    }

    // AK
    const invalid = ["P", "S", "T", "U", "Z", "AC"].filter((c) => !empty(v(c)) && num(c) === null);
    if (invalid.length > 0) {
      add("AK", "ERROR", "CAMPO CUANTITATIVO NO NUMÉRICO", invalid, ev(invalid));
    } else {
      ok("AK");
    }

    // AL
    if (["P", "S", "T"].some((c) => empty(v(c)) || num(c) === null)) {
      add("AL", "REVISAR", "SIN DESGLOSE NUMÉRICO PARA VALIDAR MONTO CONTRATADO", "P,S,T");
    } else {
      const np = num("P")!;
      const ns = num("S")!;
      const nt = num("T")!;
      const base = Number((ns * nt).toFixed(6));
      const delta = Number(Math.abs(np - base).toFixed(6));
      if (delta > options.tolerancia_contratado) {
        if (base > 0 && Math.abs(np - base * 1.16) <= options.tolerancia_contratado) {
          add(
            "AL",
            "INFORMATIVO",
            "EL MONTO COINCIDE MATEMÁTICAMENTE CON BASE MÁS 16 %; CONFIRMAR TRATAMIENTO DE IVA",
            "P,S,T",
            `Base=${base}; importe=${fmt(v("P"))}; factor observado=1.16 (no acredita régimen fiscal)`
          );
        } else {
          add(
            "AL",
            "REVISAR",
            "MONTO CONTRATADO NO COINCIDE CON CANTIDAD × PRECIO; VALIDAR NIVEL DE CAPTURA E IVA",
            "P,S,T",
            `Diferencia absoluta=${delta}; se debe identificar si P es importe por clave, partida o contrato`
          );
        }
      } else {
        ok("AL");
      }
    }

    // AM
    const pk = `${h.toUpperCase()}||${claveAnalitica(d)}`;
    if (h && !claveNoInformada(q) && num("T") !== null && (allPrices.get(pk)?.size || 0) > 1) {
      add("AM", "REVISAR", "PRECIO DIFERENTE PARA MISMO CONTRATO Y CLAVE", "H,Q,T", `Precios distintos=${allPrices.get(pk)!.size}`);
    } else {
      ok("AM");
    }

    // AN
    if (["U", "AC", "T"].some((c) => empty(v(c)) || num(c) === null)) {
      add("AN", "REVISAR", "MONTO EJERCIDO NO VALIDABLE POR DESGLOSE", "U,AC,T");
    } else {
      const nu = num("U")!;
      const nac = num("AC")!;
      const nt = num("T")!;
      const base = Number((nac * nt).toFixed(6));
      const delta = Number(Math.abs(nu - base).toFixed(6));
      if (delta > options.tolerancia_ejercido) {
        if (base > 0 && Math.abs(nu - base * 1.16) <= options.tolerancia_ejercido) {
          add(
            "AN",
            "INFORMATIVO",
            "MONTO EJERCIDO COINCIDE CON BASE MÁS 16 %; CONFIRMAR IVA",
            "U,AC,T",
            `Base=${base}; ejercido=${fmt(v("U"))}; factor observado=1.16`
          );
        } else {
          add("AN", "REVISAR", "MONTO EJERCIDO NO COINCIDE CON PIEZAS × PRECIO; VALIDAR NIVEL DE CAPTURA", "U,AC,T", `Diferencia absoluta=${delta}`);
        }
      } else {
        ok("AN");
      }
    }

    // AO
    if ((num("AC") || 0) > 0 && (empty(v("U")) || num("U") === 0)) {
      add("AO", "REVISAR", "PIEZAS SUMINISTRADAS CON MONTO EJERCIDO EN CERO", "AC,U");
    } else {
      ok("AO");
    }

    // AP
    const miss: string[] = [];
    if (!empty(v("Y")) || (num("Z") || 0) > 0) {
      for (const c of ["W", "X", "Y", "Z", "AA"]) {
        if (c === "X" ? sinOrden(v(c)) : empty(v(c))) miss.push(c);
      }
    }
    if (!empty(v("AB")) || (num("AC") || 0) > 0) {
      for (const c of ["AB", "AC", "AA"]) {
        if (empty(v(c))) miss.push(c);
      }
    }
    if (miss.length > 0) {
      add("AP", "ERROR", "CAMPO ESENCIAL U OPERATIVO AUSENTE", Array.from(new Set(miss)));
    } else {
      ok("AP");
    }

    // AQ
    if (
      req &&
      req <= options.fecha_corte &&
      (ent === null || ent > options.fecha_corte || num("AC") === 0) &&
      daysBetweenIso(options.fecha_corte, req) > options.dias_pendiente
    ) {
      add(
        "AQ",
        "REVISAR",
        "SOLICITUD PENDIENTE POR MÁS DEL PLAZO DEFINIDO",
        "Y,AB,AC",
        `Días al corte=${daysBetweenIso(options.fecha_corte, req)}`
      );
    } else {
      ok("AQ");
    }

    // AR
    if (num("Z") === null || num("AC") === null) {
      ok("AR");
    } else if (num("AC")! > num("Z")!) {
      add("AR", "ERROR", "SUMINISTRO MAYOR A SOLICITADO", "Z,AC", ev(["Z", "AC"]));
    } else if (num("AC")! < num("Z")!) {
      add("AR", "INFORMATIVO", "ENTREGA PARCIAL", "Z,AC", ev(["Z", "AC"]));
    } else {
      ok("AR");
    }

    // AS
    const dupKey = ["D", "H", "X", "Y", "AA", "AB", "AC"].map((k) => fmt(v(k)).toUpperCase()).join("||") + "||" + claveAnalitica(d);
    if (h && (duplicates.get(dupKey) || 0) > 1) {
      add("AS", "REVISAR", "POSIBLE REGISTRO DUPLICADO", "D,H,Q,R,X,Y,AA,AB,AC", `Coincidencias=${duplicates.get(dupKey)}`);
    } else {
      ok("AS");
    }

    // AT
    const unstructured = ["N", "O", "Y", "AB"].filter((c) => !empty(v(c)) && fecha(c) === null);
    if (unstructured.length > 0) {
      add("AT", "REVISAR", "FECHA NO ESTRUCTURADA O MÚLTIPLES FECHAS EN UNA CELDA", unstructured, ev(unstructured));
    } else {
      ok("AT");
    }

    // AU
    const future = (
      [
        ["Y", req],
        ["AB", ent],
      ] as [string, string | null][]
    )
      .filter(([, dt]) => dt && dt > options.fecha_corte)
      .map(([c]) => c);
    if (future.length > 0) {
      add("AU", "INFORMATIVO", "EVENTO POSTERIOR AL CORTE", future, ev(future));
    } else {
      ok("AU");
    }

    // Extras MX01..MX11
    if (options.extras) {
      if (!h) add("MX01", "ERROR", "REGISTRO OPERATIVO SIN NÚMERO DE CONTRATO", "H");
      const neg = ["P", "S", "T", "U", "Z", "AC"].filter((c) => num(c) !== null && num(c)! < 0);
      if (neg.length > 0) add("MX02", "ERROR", "VALOR CUANTITATIVO NEGATIVO", neg, ev(neg));
      if (req && ent && ent < req) {
        add("MX03", "REVISAR", "FECHA DE SUMINISTRO ANTERIOR A LA SOLICITUD", "Y,AB", ev(["Y", "AB"]));
      }
      if (h && (contractProviders.get(h.toUpperCase())?.size || 0) > 1) {
        add(
          "MX04",
          "REVISAR",
          "DIFERENTES PROVEEDORES PARA EL MISMO NÚMERO DE CONTRATO",
          "H,K",
          `Proveedores distintos=${contractProviders.get(h.toUpperCase())!.size}`
        );
      }
      const fract = ["S", "Z", "AC"].filter((c) => num(c) !== null && num(c)! % 1 !== 0);
      if (fract.length > 0) add("MX05", "REVISAR", "PIEZAS REPORTADAS CON DECIMALES", fract, ev(fract));
      if (signed === "no" && empty(v("J"))) {
        add("MX06", "REVISAR", "NO SE INDICA MOTIVO DE CONTRATO SIN FIRMA", "I,J");
      }
      const amt = num("P");
      const ak = `${h.toUpperCase()}||${fmt(v("P"))}`;
      if (h && amt !== null && (amountKey.get(ak)?.size || 0) > 1) {
        add(
          "MX07",
          "INFORMATIVO",
          "MISMO MONTO CONTRATADO EN VARIAS CLAVES; EVITAR SUMARLO MÁS DE UNA VEZ",
          "H,P,Q",
          `Claves=${amountKey.get(ak)!.size}`
        );
      }
      if (h && empty(v("K"))) add("MX08", "ERROR", "PROVEEDOR AUSENTE", "H,K");
      if (num("AC") !== null && num("S") !== null && num("AC")! > num("S")!) {
        add("MX09", "REVISAR", "SUMINISTRO DE LA FILA SUPERA CANTIDAD CONTRATADA; CONFIRMAR NIVEL DE CAPTURA", "S,AC");
      }
      if ((num("U") || 0) > 0 && (empty(v("AC")) || num("AC") === 0)) {
        add("MX10", "REVISAR", "MONTO EJERCIDO POSITIVO SIN PIEZAS SUMINISTRADAS", "U,AC");
      }
      const maxYr = Number(options.fecha_corte.slice(0, 4)) + 10;
      const implausible = ["N", "O", "Y", "AB"].filter((c) => {
        const dt = fecha(c);
        if (!dt) return false;
        const yr = Number(dt.slice(0, 4));
        return yr < 1990 || yr > maxYr;
      });
      if (implausible.length > 0) add("MX11", "REVISAR", "FECHA FUERA DE RANGO PLAUSIBLE", implausible, ev(implausible));
    }

    const tipo = rubro(v("A"));
    if (tipo === RUBRO_MEDICAMENTOS) {
      const bandera = norm(v("V"));
      if (!empty(v("V")) && bandera !== "0" && bandera !== "1") {
        add("MD01", "REVISAR", "MARCADOR DE MEDICAMENTO ONCOLÓGICO DEBE SER 0 O 1", "A,V", ev(["A", "V"]));
      }
    } else if (tipo === RUBRO_CURACION) {
      if (norm(v("V")) === "1") {
        add("MC01", "REVISAR", "MATERIAL DE CURACIÓN REPORTADO COMO MEDICAMENTO ONCOLÓGICO", "A,V", ev(["A", "V"]));
      }
    } else {
      add("SX01", "ERROR", "TIPO DE SUMINISTRO NO CLASIFICADO EN MEDICAMENTOS O MATERIAL DE CURACIÓN", "A", ev(["A"]));
    }

    report.estado = getStatus(report.hallazgos);
  }

  return out;
}

export interface SuministroSummary {
  motor: string;
  version: string;
  modo: string;
  hojas_origen: string[];
  fecha_corte: string;
  dias_pendiente: number;
  tolerancia_monto_contratado: string;
  tolerancia_monto_ejercido: string;
  catalogo_cnis_claves: number;
  registros: number;
  filas_con_inconsistencias: number;
  hallazgos: number;
  errores: number;
  revisar: number;
  informativos: number;
  ok: number;
  reglas: Record<string, number>;
  por_tipo: Record<
    string,
    {
      registros: number;
      errores: number;
      revisar: number;
      informativos: number;
      ok: number;
      hallazgos: number;
    }
  >;
  por_institucion_tipo: {
    institucion: string;
    tipo: string;
    registros: number;
    con_inconsistencia: number;
  }[];
  advertencia: string;
}

function summarize(
  reports: Map<number, SuministroRowReport>,
  sheets: string[],
  options: SuministroOptions,
  catalogSize: number,
  modo: string
): SuministroSummary {
  const niveles: Record<string, number> = { ERROR: 0, REVISAR: 0, INFORMATIVO: 0, OK: 0 };
  const codigos = new Map<string, number>();
  const allRep = Array.from(reports.values());

  for (const r of allRep) {
    niveles[r.estado] = (niveles[r.estado] || 0) + 1;
    for (const h of r.hallazgos) {
      codigos.set(h.codigo, (codigos.get(h.codigo) || 0) + 1);
    }
  }

  const tipos: SuministroSummary["por_tipo"] = {};
  for (const tipo of [RUBRO_MEDICAMENTOS, RUBRO_CURACION, "NO CLASIFICADO"]) {
    const rr = allRep.filter((r) => rubro(r.datos["A"]) === tipo);
    if (rr.length === 0) continue;
    const conteo: Record<string, number> = { ERROR: 0, REVISAR: 0, INFORMATIVO: 0, OK: 0 };
    let th = 0;
    for (const r of rr) {
      conteo[r.estado] = (conteo[r.estado] || 0) + 1;
      th += r.hallazgos.length;
    }
    tipos[tipo] = {
      registros: rr.length,
      errores: conteo.ERROR,
      revisar: conteo.REVISAR,
      informativos: conteo.INFORMATIVO,
      ok: conteo.OK,
      hallazgos: th,
    };
  }

  const instMap = new Map<string, { institucion: string; tipo: string; registros: number; con_inconsistencia: number }>();
  for (const r of allRep) {
    const instName = fmt(r.datos["D"]) || fmt(r.datos["F"]);
    const tName = rubro(r.datos["A"]);
    const k = `${instName}|${tName}`;
    if (!instMap.has(k)) {
      instMap.set(k, { institucion: instName, tipo: tName, registros: 0, con_inconsistencia: 0 });
    }
    const item = instMap.get(k)!;
    item.registros++;
    if (r.estado === "ERROR" || r.estado === "REVISAR") item.con_inconsistencia++;
  }

  const sortedRules: Record<string, number> = {};
  for (const [k, v] of Array.from(codigos.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    sortedRules[k] = v;
  }

  return {
    motor: "suministro_dual",
    version: "2.0.0",
    modo,
    hojas_origen: sheets,
    fecha_corte: options.fecha_corte,
    dias_pendiente: options.dias_pendiente,
    tolerancia_monto_contratado: String(options.tolerancia_contratado),
    tolerancia_monto_ejercido: String(options.tolerancia_ejercido),
    catalogo_cnis_claves: catalogSize,
    registros: allRep.length,
    filas_con_inconsistencias: niveles.ERROR + niveles.REVISAR,
    hallazgos: allRep.reduce((s, r) => s + r.hallazgos.length, 0),
    errores: niveles.ERROR,
    revisar: niveles.REVISAR,
    informativos: niveles.INFORMATIVO,
    ok: niveles.OK,
    reglas: sortedRules,
    por_tipo: tipos,
    por_institucion_tipo: Array.from(instMap.values()),
    advertencia:
      "Las coincidencias aritméticas con IVA 16 % son indicios, no validación fiscal. El CNIS proviene de la plantilla; verificar su vigencia oficialmente. No sumar importes repetidos.",
  };
}

function sanitizeOoxmlXml(xmlStr: string, isStyles = false): string {
  let out = xmlStr.replace(/<[A-Za-z0-9_:]+[^>]*\bmc:Ignorable="[^"]+"[^>]*>/g, (tag) => {
    const ign = tag.match(/\bmc:Ignorable="([^"]+)"/);
    if (!ign) return tag;
    const valid = ign[1].split(/\s+/).filter((p) => p && tag.includes(`xmlns:${p}=`));
    if (valid.length > 0) {
      return tag.replace(/\bmc:Ignorable="[^"]+"/, `mc:Ignorable="${valid.join(" ")}"`);
    }
    return tag.replace(/\s*\bmc:Ignorable="[^"]+"/, "");
  });
  if (isStyles) {
    out = out.replace(/<((?:\w+:)?font)>[\s\S]*?<\/\1>/g, (f) => {
      const col = f.match(/<(?:\w+:)?color\b[^/>]*\/>/);
      const nameIdx = f.search(/<(?:\w+:)?name\b/);
      if (col && nameIdx !== -1 && f.indexOf(col[0]) > nameIdx) {
        const withoutCol = f.replace(col[0], "");
        return withoutCol.replace(/<((?:\w+:)?name)\b/, `${col[0]}<$1`);
      }
      return f;
    });
  }
  return out;
}

function buildFreshStyles(originalStylesXml: string): {
  stylesXml: string;
  yellow: Map<number, number>;
  headerStyleId: number;
} {
  let stylesXml = sanitizeOoxmlXml(originalStylesXml, true);
  const p = stylesXml.match(/<(\w+:)?styleSheet\b/)?.[1] || "";
  const fontsBlock = stylesXml.match(/<(?:\w+:)?fonts\b[^>]*>([\s\S]*?)<\/(?:\w+:)?fonts>/)?.[1] || "";
  const fillsBlock = stylesXml.match(/<(?:\w+:)?fills\b[^>]*>([\s\S]*?)<\/(?:\w+:)?fills>/)?.[1] || "";
  const xfsBlock = stylesXml.match(/<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/)?.[1] || "";

  const fontItems = Array.from(fontsBlock.matchAll(/<(?:\w+:)?font\b[^>]*>[\s\S]*?<\/(?:\w+:)?font>|<(?:\w+:)?font\b[^/>]*\/>/g)).map((m) => m[0]);
  const fillItems = Array.from(fillsBlock.matchAll(/<(?:\w+:)?fill\b[^>]*>[\s\S]*?<\/(?:\w+:)?fill>|<(?:\w+:)?fill\b[^/>]*\/>/g)).map((m) => m[0]);
  const xfItems = Array.from(xfsBlock.matchAll(/<(?:\w+:)?xf\b[^>]*>[\s\S]*?<\/(?:\w+:)?xf>|<(?:\w+:)?xf\b[^/>]*\/>/g)).map((m) => m[0]);

  const setXfAttr = (xfXml: string, attr: string, val: string): string => {
    const re = new RegExp(`\\b${attr}="[^"]*"`);
    if (re.test(xfXml)) return xfXml.replace(re, `${attr}="${val}"`);
    return xfXml.replace(/^<((?:\w+:)?xf)\b/, `<$1 ${attr}="${val}"`);
  };

  const baseLen = xfItems.length;
  const fillYellowId = fillItems.length;
  fillItems.push(`<${p}fill><${p}patternFill patternType="solid"><${p}fgColor rgb="FFFFFF00"/><${p}bgColor indexed="64"/></${p}patternFill></${p}fill>`);

  const yellow = new Map<number, number>();
  for (let old = 0; old < baseLen; old++) {
    let dup = xfItems[old];
    dup = setXfAttr(dup, "fillId", String(fillYellowId));
    dup = setXfAttr(dup, "applyFill", "1");
    yellow.set(old, xfItems.length);
    xfItems.push(dup);
  }

  const headerFontId = fontItems.length;
  fontItems.push(`<${p}font><${p}b/><${p}sz val="11"/><${p}color rgb="FFFFFFFF"/><${p}name val="Calibri"/></${p}font>`);

  const headerFillId = fillItems.length;
  fillItems.push(`<${p}fill><${p}patternFill patternType="solid"><${p}fgColor rgb="FF5F233D"/><${p}bgColor indexed="64"/></${p}patternFill></${p}fill>`);

  let headerXf = xfItems[0] || `<${p}xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`;
  headerXf = setXfAttr(headerXf, "fontId", String(headerFontId));
  headerXf = setXfAttr(headerXf, "fillId", String(headerFillId));
  headerXf = setXfAttr(headerXf, "applyFill", "1");
  headerXf = setXfAttr(headerXf, "applyFont", "1");
  headerXf = setXfAttr(headerXf, "applyAlignment", "1");
  if (/<(?:\w+:)?alignment\b[^>]*\/>/.test(headerXf)) {
    headerXf = headerXf.replace(/<(?:\w+:)?alignment\b[^>]*\/>/, `<${p}alignment wrapText="1" vertical="center"/>`);
  } else if (headerXf.endsWith("/>")) {
    headerXf = headerXf.replace(/\/>$/, `><${p}alignment wrapText="1" vertical="center"/></${p}xf>`);
  } else {
    headerXf = headerXf.replace(/<\/(?:\w+:)?xf>$/, `<${p}alignment wrapText="1" vertical="center"/></${p}xf>`);
  }
  const headerStyleId = xfItems.length;
  xfItems.push(headerXf);

  stylesXml = stylesXml
    .replace(/<(?:\w+:)?fonts\b[^>]*>[\s\S]*?<\/(?:\w+:)?fonts>/, `<${p}fonts count="${fontItems.length}">${fontItems.join("")}</${p}fonts>`)
    .replace(/<(?:\w+:)?fills\b[^>]*>[\s\S]*?<\/(?:\w+:)?fills>/, `<${p}fills count="${fillItems.length}">${fillItems.join("")}</${p}fills>`)
    .replace(/<(?:\w+:)?cellXfs\b[^>]*>[\s\S]*?<\/(?:\w+:)?cellXfs>/, `<${p}cellXfs count="${xfItems.length}">${xfItems.join("")}</${p}cellXfs>`);

  return { stylesXml, yellow, headerStyleId };
}

function makeSheetXml(rows: (string | number)[][], headerStyleId: number, colsCount?: number): Buffer {
  const maxC = colsCount || Math.max(1, ...rows.map((r) => r.length));
  const end = colletter(maxC);
  const widths = maxC > 2 ? [20, 9, 25, 21, 25, 19, 35, 13, 13, 40, 60, 48, 62, 23, 50] : [46, 96];
  const colsXml = widths
    .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const rowXmls: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rnum = i + 1;
    const rvals = rows[i];
    const rAttr = rnum === 1 ? `r="1" ht="31" customHeight="1"` : `r="${rnum}"`;
    const cXmls: string[] = [];
    for (let ci = 0; ci < rvals.length; ci++) {
      const v = rvals[ci];
      if (v === null || v === undefined || v === "") continue;
      const ref = `${colletter(ci + 1)}${rnum}`;
      const sAttr = rnum === 1 ? ` s="${headerStyleId}"` : "";
      if (typeof v === "number" && Number.isInteger(v)) {
        cXmls.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`);
      } else {
        const s = String(v).slice(0, 32767);
        const space = s.startsWith(" ") || s.endsWith(" ") ? ` xml:space="preserve"` : "";
        cXmls.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t${space}>${encodeXmlEntities(s)}</t></is></c>`);
      }
    }
    rowXmls.push(`<row ${rAttr}>${cXmls.join("")}</row>`);
  }

  const xml = `<?xml version='1.0' encoding='utf-8'?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${end}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${colsXml}</cols><sheetData>${rowXmls.join("")}</sheetData><autoFilter ref="A1:${end}${rows.length}"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  return Buffer.from(xml, "utf8");
}

function buildMirrorSheetXml(
  sourceXml: string,
  header: number,
  reports: Map<number, SuministroRowReport>,
  heads: Record<string, string>,
  lastCol: number,
  yellow: Map<number, number>,
  headerStyleId: number
): Buffer {
  const isTemplate = heads["AE"] === "CNIS_Compendio" && heads["AU"] === "Evento_posterior_al_corte";
  const start = isTemplate || lastCol <= 30 ? 31 : lastCol + 1;
  const ruleCols: Record<string, string> = {};
  RULE_CODES.forEach((code, i) => {
    ruleCols[code] = colletter(start + i);
  });
  const resultCol = colletter(start + 17);
  const obsCol = colletter(start + 18);
  const actCol = colletter(start + 19);
  const extrasStart = Math.max(start + 20, lastCol + 1);
  const extCol = colletter(extrasStart);
  const countCol = colletter(extrasStart + 1);
  const maxCol = colletter(Math.max(extrasStart + 1, lastCol));

  let maxReportRow = header;
  for (const k of reports.keys()) {
    if (k > maxReportRow) maxReportRow = k;
  }

  const p = sourceXml.match(/<(\w+:)?worksheet\b/)?.[1] || "";
  const sdMatch = sourceXml.match(/<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/);
  if (!sdMatch || sdMatch.index === undefined) {
    return Buffer.from(sourceXml, "utf8");
  }

  let prefix = sourceXml.slice(0, sdMatch.index);
  const sdBody = sdMatch[1];
  let tail = sourceXml.slice(sdMatch.index + sdMatch[0].length);

  prefix = prefix
    .replace(/\s+tabSelected="[^"]*"/g, "")
    .replace(/(<(?:\w+:)?worksheet\b[^>]*?)\s+\w*:?uid="[^"]*"/g, "$1")
    .replace(/(<(?:\w+:)?dimension\s+ref=")([^"]+)(")/, (_, p1, oldRef, p3) => {
      const nums = oldRef.match(/\d+/g);
      const oldRow = nums ? parseInt(nums[nums.length - 1], 10) : 1;
      return `${p1}A1:${maxCol}${Math.max(maxReportRow, oldRow)}${p3}`;
    });

  if (!/<(?:\w+:)?cols\b/.test(prefix)) {
    const colsXml = `<${p}cols><${p}col min="${start}" max="${start + 16}" width="33" customWidth="1"/><${p}col min="${start + 17}" max="${start + 19}" width="43" customWidth="1"/><${p}col min="${extrasStart}" max="${extrasStart + 1}" width="24" customWidth="1"/></${p}cols>`;
    prefix += colsXml;
  }

  tail = tail
    .replace(/<(?:\w+:)?tableParts\b[^>]*>[\s\S]*?<\/(?:\w+:)?tableParts>/g, "")
    .replace(/<(?:\w+:)?drawing\b[^>]*\/>/g, "")
    .replace(/<(?:\w+:)?legacyDrawing\b[^>]*\/>/g, "")
    .replace(/<(?:\w+:)?hyperlinks\b[^>]*>[\s\S]*?<\/(?:\w+:)?hyperlinks>/g, "");

  const patchedSdBody = sdBody.replace(
    /<(?:\w+:)?row\b([^/>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g,
    (fullRow, rAttrs: string, rInner?: string) => {
      const n = parseInt(rAttrs.match(/\br="(\d+)"/)?.[1] || "0", 10);
      if (n !== header && !reports.has(n)) return fullRow;

      const cells = new Map<string, string>();
      const cellRe = /<(?:\w+:)?c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
      let cm: RegExpExecArray | null;
      const bodyStr = rInner || "";
      while ((cm = cellRe.exec(bodyStr)) !== null) {
        const cFull = cm[0];
        const col = cm[1].match(/\br="([A-Z]+)/)?.[1];
        if (col) cells.set(col, cFull);
      }

      const assign = (col: string, value?: string | null, style?: number | null) => {
        const ref = `${col}${n}`;
        let cur = cells.get(col) || `<${p}c r="${ref}"/>`;
        if (style !== undefined && style !== null) {
          if (/\bs="\d+"/.test(cur)) {
            cur = cur.replace(/\bs="\d+"/, `s="${style}"`);
          } else {
            cur = cur.replace(/^<((?:\w+:)?c)\b/, `<$1 s="${style}"`);
          }
        }
        if (value !== undefined && value !== null) {
          const s = String(value).slice(0, 32767);
          const space = s.startsWith(" ") || s.endsWith(" ") ? ` xml:space="preserve"` : "";
          const sMatch = cur.match(/\bs="(\d+)"/)?.[1];
          const sAttr = sMatch ? ` s="${sMatch}"` : "";
          cur = `<${p}c r="${ref}"${sAttr} t="inlineStr"><${p}is><${p}t${space}>${encodeXmlEntities(s)}</${p}t></${p}is></${p}c>`;
        }
        cells.set(col, cur);
      };

      if (n === header) {
        for (const [code, c] of Object.entries(ruleCols)) {
          if (isTemplate && c in heads) continue;
          assign(c, `${code} · ${REGLAS[code][0]}`, headerStyleId);
        }
        const extraHeaders: [string, string][] = [
          [resultCol, "Resultado_general"],
          [obsCol, "Observacion_automatica"],
          [actCol, "Accion_sugerida"],
          [extCol, "Codigos_hallazgos_adicionales"],
          [countCol, "Total_hallazgos"],
        ];
        for (const [c, label] of extraHeaders) {
          if (isTemplate && c in heads) continue;
          assign(c, label, headerStyleId);
        }
      } else if (reports.has(n)) {
        const r = reports.get(n)!;
        for (const [code, c] of Object.entries(ruleCols)) {
          assign(c, r.reglas[code] || "OK");
        }
        const message = r.hallazgos.map((h) => `${h.codigo}: ${h.descripcion}`).join(" | ");
        const acciones = Array.from(new Set(r.hallazgos.map((h) => h.accion))).join(" | ");
        assign(resultCol, r.estado);
        assign(obsCol, message || "SIN ALERTAS");
        assign(actCol, acciones);
        assign(
          extCol,
          r.hallazgos
            .filter((h) => /^(MX|MD|MC|SX)/.test(h.codigo))
            .map((h) => h.codigo)
            .join(", ")
        );
        assign(countCol, String(r.hallazgos.length));

        const yellowCols = new Set<string>();
        for (const h of r.hallazgos) {
          if (h.gravedad !== "ERROR" && h.gravedad !== "REVISAR") continue;
          for (const col of h.columnas) yellowCols.add(col);
          yellowCols.add(ruleCols[h.codigo] || extCol);
        }
        if (yellowCols.size > 0) {
          yellowCols.add(resultCol);
          yellowCols.add(obsCol);
        }
        for (const col of yellowCols) {
          const cur = cells.get(col);
          const oldS = cur ? parseInt(cur.match(/\bs="(\d+)"/)?.[1] || "0", 10) : 0;
          const yStyle = yellow.get(Number.isNaN(oldS) ? 0 : oldS) ?? yellow.get(0)!;
          assign(col, null, yStyle);
        }
      }

      const sortedCols = Array.from(cells.keys()).sort((a, b) => colnum(a) - colnum(b));
      const joined = sortedCols.map((c) => cells.get(c)!).join("");
      return `<${p}row${rAttrs}>${joined}</${p}row>`;
    }
  );

  return Buffer.from(`${prefix}<${p}sheetData>${patchedSdBody}</${p}sheetData>${tail}`, "utf8");
}

export function reviewSuministroBuffer(
  fileBuf: Buffer,
  fechaCorte: string,
  optionsInput?: {
    modo?: string;
    sheet?: string | null;
    dias_pendiente?: number;
    tolerancia_contratado?: string | number;
    tolerancia_ejercido?: string | number;
    extras?: boolean;
  }
): { buffer: Buffer; summary: SuministroSummary } {
  const mDate = (fechaCorte || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!mDate) throw new Error("Fecha de corte no válida: YYYY-MM-DD");

  const modoRaw = norm(optionsInput?.modo || "ambos").replace(/\s+/g, "_");
  if (!["ambos", "medicamentos", "material_curacion"].includes(modoRaw)) {
    throw new Error("modo debe ser ambos, medicamentos o material_curacion");
  }

  const diasPendiente = optionsInput?.dias_pendiente ?? 15;
  if (diasPendiente < 0 || diasPendiente > 3650) {
    throw new Error("Días pendientes fuera de rango");
  }

  const tc = Number(optionsInput?.tolerancia_contratado ?? 1);
  const te = Number(optionsInput?.tolerancia_ejercido ?? 0.01);
  if (Number.isNaN(tc) || Number.isNaN(te) || tc < 0 || te < 0 || !Number.isFinite(tc) || !Number.isFinite(te)) {
    throw new Error("Tolerancias inválidas");
  }

  const zipMap = readZipBuffer(fileBuf);
  if (!zipMap.has("xl/workbook.xml") || !zipMap.has("[Content_Types].xml")) {
    throw new Error("No es un archivo Excel .xlsx válido.");
  }

  const cat = loadCatalog();
  const opt: SuministroOptions = {
    fecha_corte: `${mDate[1]}-${mDate[2]}-${mDate[3]}`,
    dias_pendiente: diasPendiente,
    tolerancia_contratado: tc,
    tolerancia_ejercido: te,
    extras: optionsInput?.extras ?? true,
    year1904: getDateSystem(zipMap),
  };

  const sst = getSst(zipMap);
  const targetSheets = findSheets(zipMap, optionsInput?.sheet);

  const metadata = new Map<
    string,
    {
      xmlPath: string;
      header: number;
      headers: Record<string, string>;
      lastCol: number;
      reports: Map<number, SuministroRowReport>;
    }
  >();
  const totalReport = new Map<number, SuministroRowReport>();

  for (const [sheetName, xmlPath] of targetSheets) {
    const { headerRow, active, headings, lastHeader } = analyzeSource(zipMap, xmlPath, sst);
    const groups = new Map<string, Map<number, Record<string, unknown>>>();

    for (const [n, d] of active.entries()) {
      const t = rubro(d["A"]);
      if (modoRaw === "medicamentos" && t !== RUBRO_MEDICAMENTOS) continue;
      if (modoRaw === "material_curacion" && t !== RUBRO_CURACION) continue;
      const inst = norm(d["D"] || d["F"]);
      const gk = `${t}||${inst}`;
      if (!groups.has(gk)) groups.set(gk, new Map());
      groups.get(gk)!.set(n, d);
    }

    const reports = new Map<number, SuministroRowReport>();
    for (const subset of groups.values()) {
      const subRep = evaluateSubset(subset, cat, opt);
      for (const [rn, rr] of subRep.entries()) {
        reports.set(rn, rr);
        totalReport.set(rn, rr);
      }
    }

    metadata.set(sheetName, {
      xmlPath,
      header: headerRow,
      headers: headings,
      lastCol: lastHeader,
      reports,
    });
  }

  const summary = summarize(totalReport, Array.from(metadata.keys()), opt, Object.keys(cat).length, modoRaw);

  // Build output workbook
  const { stylesXml, yellow, headerStyleId } = buildFreshStyles(zipMap.get("xl/styles.xml")!.toString("utf8"));
  let wbXml = sanitizeOoxmlXml(zipMap.get("xl/workbook.xml")!.toString("utf8"));
  const wp = wbXml.match(/<(\w+:)?workbook\b/)?.[1] || "";
  wbXml = wbXml.replace(/<((?:\w+:)?workbook\b[^>]*?)>/, (m0, openTag) => {
    if (/\bxmlns:r=/.test(openTag)) return m0;
    return `<${openTag} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
  });
  let relsXml = zipMap.get("xl/_rels/workbook.xml.rels")!.toString("utf8");
  let ctXml = zipMap.get("[Content_Types].xml")!.toString("utf8");

  const existingIds = Array.from(wbXml.matchAll(/\bsheetId="(\d+)"/g)).map((m) => parseInt(m[1], 10));
  const existingRels = Array.from(relsXml.matchAll(/\bId="rId(\d+)"/g)).map((m) => parseInt(m[1], 10));
  let sheetSeq = 0;
  for (const k of zipMap.keys()) {
    const m = k.match(/^xl\/worksheets\/sheet(\d+)\.xml$/);
    if (m) sheetSeq = Math.max(sheetSeq, parseInt(m[1], 10));
  }
  const reserved = new Set<string>(Array.from(wbXml.matchAll(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]+)"/g)).map((m) => decodeXmlEntities(m[1])));
  const outputSheets: { path: string; buf: Buffer }[] = [];

  const addSheet = (rawName: string, buf: Buffer) => {
    let name = rawName;
    let step = 2;
    while (reserved.has(name)) {
      name = `${rawName} ${step}`;
      step++;
    }
    reserved.add(name);
    sheetSeq++;
    const nid = Math.max(0, ...existingIds) + outputSheets.length + 1;
    const rid = `rId${Math.max(0, ...existingRels) + outputSheets.length + 1}`;
    wbXml = wbXml.replace(
      /<\/(?:\w+:)?sheets>/,
      `<${wp}sheet name="${encodeXmlEntities(name)}" sheetId="${nid}" r:id="${rid}"/></${wp}sheets>`
    );
    relsXml = relsXml.replace(
      /<\/(?:\w+:)?Relationships>/,
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetSeq}.xml"/></Relationships>`
    );
    ctXml = ctXml.replace(
      /<\/(?:\w+:)?Types>/,
      `<Override PartName="/xl/worksheets/sheet${sheetSeq}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    );
    outputSheets.push({ path: `xl/worksheets/sheet${sheetSeq}.xml`, buf });
  };

  const allReports: [string, SuministroRowReport][] = [];
  for (const [name, info] of metadata.entries()) {
    const mirrorBuf = buildMirrorSheetXml(
      zipMap.get(info.xmlPath)!.toString("utf8"),
      info.header,
      info.reports,
      info.headers,
      info.lastCol,
      yellow,
      headerStyleId
    );
    addSheet(metadata.size === 1 ? "REVISION OIC" : `REV OIC ${name.slice(0, 20)}`, mirrorBuf);
    for (const r of info.reports.values()) {
      allReports.push([name, r]);
    }
  }

  allReports.sort((a, b) => (a[0] !== b[0] ? a[0].localeCompare(b[0]) : a[1].fila - b[1].fila));

  const obsRows: (string | number)[][] = [
    [
      "HOJA ORIGEN",
      "FILA",
      "TIPO DE SUMINISTRO",
      "INSTITUCIÓN / SIGLAS",
      "CONTRATO",
      "CLAVE CNIS",
      "PROVEEDOR",
      "SEVERIDAD",
      "REGLA",
      "CELDAS INVOLUCRADAS",
      "DESCRIPCIÓN",
      "EVIDENCIA",
      "ACCIÓN SOLICITADA",
      "DECISIÓN REVISOR",
      "COMENTARIO FINAL",
    ],
  ];
  for (const [name, r] of allReports) {
    for (const f of r.hallazgos) {
      obsRows.push([
        name,
        f.fila,
        rubro(r.datos["A"]),
        fmt(r.datos["D"]) || fmt(r.datos["F"]),
        fmt(r.datos["H"]),
        fmt(r.datos["Q"]),
        fmt(r.datos["K"]),
        f.gravedad,
        f.codigo,
        f.columnas.map((col) => `${col}${f.fila}`).join(", "),
        f.descripcion,
        f.evidencia,
        f.accion,
        "PENDIENTE",
        "",
      ]);
    }
  }
  addSheet("OBSERVACIONES OIC", makeSheetXml(obsRows, headerStyleId, 15));

  const sumRows: (string | number)[][] = [
    ["INDICADOR", "VALOR"],
    ["Fecha de corte", summary.fecha_corte],
    ["Registros analizados", summary.registros],
    ["Filas con ERROR", summary.errores],
    ["Filas con REVISAR", summary.revisar],
    ["Filas INFORMATIVO", summary.informativos],
    ["Filas OK", summary.ok],
    ["Filas con inconsistencia", summary.filas_con_inconsistencias],
    ["Total hallazgos (no filas)", summary.hallazgos],
    ["Claves CNIS en catálogo", summary.catalogo_cnis_claves],
    ["Criterio días pendientes", opt.dias_pendiente],
    ["Tolerancia monto contratado", String(opt.tolerancia_contratado)],
    ["Tolerancia monto ejercido", String(opt.tolerancia_ejercido)],
    ["Alcance", "Validación automatizada, sujeta a revisión documental."],
    ["Integridad", "Se conserva íntegra cada hoja original; marcado únicamente en espejo."],
    ["Regla", "Filas con varios hallazgos cuentan una sola vez en el resultado general."],
    ["CNIS", "Catálogo anexo del archivo de referencia; vigencia no confirmada contra versión oficial actual."],
    ["Reglas adicionales", "MX01-MX11 y controles MD01, MC01, SX01; corroboración documental."],
    ["IVA", "Coincidencia con 1.16 = INFORMATIVO; no acredita por sí sola el IVA aplicable."],
    ["ADVERTENCIA", "Monto contractual repetido por clave NO se suma como monto adicional."],
    ["MODO DE REVISIÓN", summary.modo],
    ["TIPO DE SUMINISTRO", "REGISTROS"],
  ];
  for (const [tipo, stat] of Object.entries(summary.por_tipo)) {
    sumRows.push([tipo, stat.registros]);
    for (const metrica of ["errores", "revisar", "informativos", "ok", "hallazgos"] as const) {
      sumRows.push([`    ${tipo} · ${metrica}`, stat[metrica]]);
    }
  }
  sumRows.push(["INSTITUCIÓN · TIPO", "REGISTROS / INCONSISTENCIAS"]);
  for (const item of summary.por_institucion_tipo) {
    sumRows.push([`${item.institucion} · ${item.tipo}`, `${item.registros} / ${item.con_inconsistencia}`]);
  }
  sumRows.push(["REGLA", "HALLAZGOS"]);
  for (const [c, n] of Object.entries(summary.reglas)) {
    sumRows.push([c, n]);
  }
  addSheet("RESUMEN OIC", makeSheetXml(sumRows, headerStyleId, 2));

  if (/<(?:\w+:)?calcPr\b/.test(wbXml)) {
    wbXml = wbXml.replace(/<(?:\w+:)?calcPr\b([^>]*)\/>/, (m0, a0) => {
      if (/\bfullCalcOnLoad=/.test(a0)) return m0.replace(/\bfullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"');
      return `<calcPr${a0} fullCalcOnLoad="1"/>`;
    });
  }

  const outEntries: ZipEntry[] = [];
  for (const [name, data] of zipMap.entries()) {
    if (name === "xl/styles.xml") {
      outEntries.push({ name, data: Buffer.from(stylesXml, "utf8") });
    } else if (name === "xl/workbook.xml") {
      outEntries.push({ name, data: Buffer.from(wbXml, "utf8") });
    } else if (name === "xl/_rels/workbook.xml.rels") {
      outEntries.push({ name, data: Buffer.from(relsXml, "utf8") });
    } else if (name === "[Content_Types].xml") {
      outEntries.push({ name, data: Buffer.from(ctXml, "utf8") });
    } else {
      outEntries.push({ name, data });
    }
  }
  for (const ns of outputSheets) {
    outEntries.push({ name: ns.path, data: ns.buf });
  }

  return { buffer: writeZipBuffer(outEntries), summary };
}
