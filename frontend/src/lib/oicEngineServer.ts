import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface OicFinding {
  severity: "ERROR" | "REVISAR" | "DOCUMENTAL";
  sheet: string;
  row: number;
  cell: string;
  field: string;
  rule: string;
  detail: string;
  action: string;
  unit: string;
  contract: string;
  value: string;
  related: string[];
}

export interface OicPreviewRecord {
  archivo: string;
  hoja: string;
  registros: number;
  inconsistencias: number;
  filas_observadas: number;
  por_gravedad: Record<string, number>;
  por_regla: Record<string, number>;
  columnas_reconocidas?: Record<string, string>;
  hallazgos_muestra: {
    fila: number;
    celda: string;
    contrato: string;
    regla: string;
    categoria: string;
    campo: string;
    detalle: string;
    accion: string;
    celdas_relacionadas: string[];
  }[];
}

// ============================================================================
// 1. Minimal Pure-Node ZIP Reader / Writer (using built-in node:zlib)
// ============================================================================
export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function readZipBuffer(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("No es un archivo XLSX/ZIP válido.");
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const rawComp = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? Buffer.from(rawComp) : zlib.inflateRawSync(rawComp);
    out.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function writeZipBuffer(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const uncomp = entry.data;
    const crc = zlib.crc32(uncomp);
    const comp = zlib.deflateRawSync(uncomp);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 flag
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(uncomp.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localParts.push(lh, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc >>> 0, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(uncomp.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    cdParts.push(cd, nameBuf);

    offset += 30 + nameBuf.length + comp.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

// ============================================================================
// 2. Helpers: Normalization, Dates, Numbers, Cell References
// ============================================================================
const VALID_STATUS = new Set(["EN PROCESO", "RESCINDIDO", "SUSPENSION DE LA RESCISION"]);
const VALID_FUENTE = new Set(["UNICA", "UNICA CON PATENTE", "PATENTE", "OTRA"]);

const ALIASES: Record<string, string[]> = {
  ramo: ["ramo"],
  descripcion_ramo: ["descripcion"],
  siglas: ["siglas"],
  ur: ["cve ur", "clave ur", "clave de la unidad responsable"],
  unidad: ["unidad responsable"],
  contrato: ["no de contrato", "numero de contrato", "num contrato", "no contrato"],
  proveedor: ["proveedor", "razon social"],
  monto: ["monto contratado", "importe contratado"],
  cantidad_contratada: ["cantidad contratada"],
  precio: ["precio unitario"],
  cantidad_solicitada: ["cantidad solicitada"],
  no_entregada: ["cantidad no entregada", "piezas no entregadas"],
  clave: ["clave del medicamento", "clave del insumo"],
  descripcion_insumo: ["descripcion"],
  fuente: ["fuente"],
  estatus: ["estatus de la rescision", "estatus de rescisión", "estatus de rescision"],
  sentido: ["en caso de suspension indicar el sentido"],
  motivos: ["motivos de rescision"],
  inicio: ["fecha de notificacion al proveedor del inicio"],
  formal: ["fecha de notificacion de la formalizacion"],
  suspension_fecha: ["en caso de la suspension de la rescision especificar la fecha"],
  soporte: ["soporte documental"],
  comentarios: ["comentarios"],
  clue: ["clue"],
};

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export function normalize(x: unknown): string {
  if (x === null || x === undefined) return "";
  const s = String(x)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ");
  return s.trim().split(/\s+/).filter(Boolean).join(" ");
}

export function text(x: unknown): string {
  if (x === null || x === undefined) return "";
  if (typeof x === "number" && Number.isInteger(x)) return String(x);
  return String(x).trim();
}

const MISSING_SET = new Set([
  "N A", "NA", "N D", "ND", "NO APLICA", "NO APLICABLE",
  "SIN DATO", "S D", "NULL", "NO ESPECIFICADO", "NINGUNO",
]);

export function missing(x: unknown): boolean {
  const s = normalize(x);
  return !s || MISSING_SET.has(s) || s.startsWith("NO APLICA ");
}

export function parseNumber(x: unknown): number | null {
  if (x === null || x === undefined || typeof x === "boolean" || missing(x)) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  let s = text(x).replace(/\s+/g, "").replace(/\$/g, "").replace(/MXN/gi, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(/,/g, ".");
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/,/g, ".");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function parseDate(x: unknown): string | null {
  if (x === null || x === undefined || typeof x === "boolean" || missing(x)) return null;
  const numCheck = typeof x === "number" ? x : (/^\d+(\.\d+)?$/.test(text(x)) ? Number(text(x)) : null);
  if (numCheck !== null) {
    if (numCheck >= 20000 && numCheck < 100000) {
      const utcMs = Date.UTC(1899, 11, 30) + Math.floor(numCheck) * 86400000;
      const d = new Date(utcMs);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const s = text(x);
  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) {
    const day = Number(m[1]), mon = Number(m[2]), yr = Number(m[3]);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(yr, mon - 1, day));
      if (d.getUTCFullYear() === yr && d.getUTCMonth() === mon - 1 && d.getUTCDate() === day) {
        return d.toISOString().slice(0, 10);
      }
    }
  }
  // yyyy-mm-dd or yyyy/mm/dd
  m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m) {
    const yr = Number(m[1]), mon = Number(m[2]), day = Number(m[3]);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(yr, mon - 1, day));
      if (d.getUTCFullYear() === yr && d.getUTCMonth() === mon - 1 && d.getUTCDate() === day) {
        return d.toISOString().slice(0, 10);
      }
    }
  }
  // 15 de octubre de 2026
  m = s.toLowerCase().match(/^(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(?:de\s+)?(\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTHS[normalize(m[2]).toLowerCase()];
    const yr = Number(m[3]);
    if (mon && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(yr, mon - 1, day));
      if (d.getUTCFullYear() === yr && d.getUTCMonth() === mon - 1 && d.getUTCDate() === day) {
        return d.toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

function formatDateDMY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function colLetter0(c0: number): string {
  let c = c0 + 1;
  let ans = "";
  while (c > 0) {
    const rem = (c - 1) % 26;
    ans = String.fromCharCode(65 + rem) + ans;
    c = Math.floor((c - 1) / 26);
  }
  return ans;
}

export function colLetter1(c1: number): string {
  return colLetter0(c1 - 1);
}

export function indexRef(ref: string): [number, number] {
  const m = ref.match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return [0, 0];
  let c = 0;
  const letters = m[1].toUpperCase();
  for (let i = 0; i < letters.length; i++) {
    c = c * 26 + (letters.charCodeAt(i) - 64);
  }
  return [Number(m[2]), c];
}

export function findMapping(headings: unknown[]): Record<string, number> {
  const normal = headings.map((x) => normalize(x));
  const mapping: Record<string, number> = {};
  for (const [key, candidates] of Object.entries(ALIASES)) {
    if (key === "descripcion_ramo" || key === "descripcion_insumo") continue;
    const best: [number, number][] = [];
    normal.forEach((s, ix) => {
      for (const a of candidates) {
        const aa = normalize(a);
        if (s === aa || s.startsWith(aa + " ") || (" " + s + " ").includes(" " + aa + " ")) {
          best.push([s === aa ? 2 : 1, ix]);
          break;
        }
      }
    });
    if (best.length > 0) {
      best.sort((a, b) => (b[0] !== a[0] ? b[0] - a[0] : a[1] - b[1]));
      mapping[key] = best[0][1];
    }
  }
  const descs = normal.map((s, i) => ({ s, i })).filter(({ s }) => s === "DESCRIPCION" || s.startsWith("DESCRIPCION "));
  if (descs.length > 0) {
    mapping["descripcion_ramo"] = descs[0].i;
    mapping["descripcion_insumo"] = descs.length > 1 ? descs[descs.length - 1].i : descs[0].i;
  }
  if (!("estatus" in mapping)) {
    for (let i = 0; i < normal.length; i++) {
      if (normal[i].startsWith("ESTATUS") && normal[i].includes("RESCISION")) {
        mapping["estatus"] = i;
        break;
      }
    }
  }
  return mapping;
}

// ============================================================================
// 3. OOXML Reader (parse sharedStrings, workbook, worksheets)
// ============================================================================
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function encodeXmlEntities(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getAllSheetParts(zipMap: Map<string, Buffer>): { name: string; part: string; sheetId: string; rId: string }[] {
  const wbXml = zipMap.get("xl/workbook.xml")?.toString("utf8") || "";
  const relsXml = zipMap.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const ridToTarget = new Map<string, string>();
  const relRe = /<(?:\w+:)?Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(relsXml)) !== null) {
    const attrs = m[1];
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) ridToTarget.set(id, target);
  }
  const sheets: { name: string; part: string; sheetId: string; rId: string }[] = [];
  const shRe = /<(?:\w+:)?sheet\b([^>]*)\/?>/g;
  while ((m = shRe.exec(wbXml)) !== null) {
    const attrs = m[1];
    const name = decodeXmlEntities(attrs.match(/\bname="([^"]+)"/)?.[1] || "");
    const sheetId = attrs.match(/\bsheetId="([^"]+)"/)?.[1] || "1";
    const rId = attrs.match(/\br:id="([^"]+)"/)?.[1] || attrs.match(/\bid="([^"]+)"/)?.[1] || "";
    const target = ridToTarget.get(rId);
    if (name && target) {
      const cleanTarget = target.startsWith("/") ? target.replace(/^\/+/, "") : path.posix.normalize("xl/" + target);
      sheets.push({ name, part: cleanTarget, sheetId, rId });
    }
  }
  return sheets;
}

function parseSharedStrings(zipMap: Map<string, Buffer>): string[] {
  const ssXml = zipMap.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!ssXml) return [];
  const shared: string[] = [];
  const siRe = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(ssXml)) !== null) {
    const inner = m[1];
    const tRe = /<(?:\w+:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let tm: RegExpExecArray | null;
    let textAcc = "";
    while ((tm = tRe.exec(inner)) !== null) {
      textAcc += decodeXmlEntities(tm[1]);
    }
    shared.push(textAcc);
  }
  return shared;
}

export interface ParsedSheetEntry {
  sheet: string;
  part: string;
  headerZero: number;
  mapping: Record<string, number>;
  rows: unknown[][];
}

export function readSheetsFromZip(zipMap: Map<string, Buffer>): ParsedSheetEntry[] {
  const sheetParts = getAllSheetParts(zipMap);
  const shared = parseSharedStrings(zipMap);
  const result: ParsedSheetEntry[] = [];

  for (const { name, part } of sheetParts) {
    const normName = normalize(name);
    if (
      normName.startsWith("DICCIONARIO") ||
      normName.startsWith("OBSERVACIONES") ||
      normName.startsWith("ANALISIS") ||
      normName.startsWith("REVISION OIC") ||
      normName.startsWith("PT")
    ) {
      continue;
    }
    const wsBuf = zipMap.get(part);
    if (!wsBuf) continue;
    const wsXml = wsBuf.toString("utf8");
    const values = new Map<number, Map<number, unknown>>();
    let highCol = 0;
    let maxRow = 0;

    const rowRe = /<(?:\w+:)?row\b([^/>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(wsXml)) !== null) {
      const rAttr = rm[1].match(/\br="(\d+)"/)?.[1];
      if (!rAttr) continue;
      const rNum = Number(rAttr);
      if (rNum > maxRow) maxRow = rNum;
      const rowBody = rm[2] || "";
      const rowMap = new Map<number, unknown>();

      const cellRe = /<(?:\w+:)?c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rowBody)) !== null) {
        const cAttrs = cm[1];
        const cBody = cm[2] || "";
        const ref = cAttrs.match(/\br="([A-Z]+\d+)"/i)?.[1];
        if (!ref) continue;
        const [, cc] = indexRef(ref);
        if (cc > 120 || cc <= 0) continue;
        const cType = cAttrs.match(/\bt="([^"]+)"/)?.[1] || "";
        let rawVal: unknown = null;
        if (cBody.includes("<is") || cBody.includes(":is")) {
          const tRe = /<(?:\w+:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
          let tm: RegExpExecArray | null;
          let sAcc = "";
          while ((tm = tRe.exec(cBody)) !== null) sAcc += decodeXmlEntities(tm[1]);
          rawVal = sAcc;
        } else {
          const vm = cBody.match(/<(?:\w+:)?v(?:\s+[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/);
          if (vm) {
            const vTxt = decodeXmlEntities(vm[1]);
            if (cType === "s") {
              const idx = Number(vTxt);
              rawVal = shared[idx] ?? vTxt;
            } else if (cType !== "str" && cType !== "e" && cType !== "inlineStr") {
              const num = Number(vTxt);
              rawVal = !isNaN(num) && vTxt.trim() !== "" ? num : vTxt;
            } else {
              rawVal = vTxt;
            }
          }
        }
        rowMap.set(cc - 1, rawVal);
        if (cc > highCol) highCol = cc;
      }
      values.set(rNum, rowMap);
    }

    if (values.size === 0 || highCol <= 2) continue;

    let best: { score: number; r: number; mapping: Record<string, number> } | null = null;
    const reqKeys = ["contrato", "proveedor", "estatus", "fuente", "motivos", "inicio", "cantidad_contratada"];
    const scoreKeys = ["contrato", "proveedor", "estatus", "monto", "precio", "cantidad_contratada", "cantidad_solicitada"];
    for (let r = 1; r <= Math.min(12, maxRow); r++) {
      const rMap = values.get(r);
      const heads: unknown[] = [];
      for (let c = 0; c < highCol; c++) heads.push(rMap?.get(c) ?? null);
      const mapping = findMapping(heads);
      if (reqKeys.every((k) => k in mapping)) {
        const score = scoreKeys.filter((k) => k in mapping).length;
        if (score >= 6 && (!best || score > best.score)) {
          best = { score, r, mapping };
        }
      }
    }
    if (best) {
      const matrix: unknown[][] = [];
      for (let r = best.r; r <= maxRow; r++) {
        const rMap = values.get(r);
        const rowArr: unknown[] = [];
        for (let c = 0; c < highCol; c++) rowArr.push(rMap?.get(c) ?? null);
        matrix.push(rowArr);
      }
      result.push({
        sheet: name,
        part,
        headerZero: best.r - 1,
        mapping: best.mapping,
        rows: matrix,
      });
    }
  }

  return result;
}

// ============================================================================
// 4. Full OIC Validation Engine (Auditor + AuditorAmpliado)
// ============================================================================
function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtGen(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(6)));
}

export function runAuditorAmpliado(
  entry: ParsedSheetEntry,
  cutoffIso: string
): OicFinding[] {
  const { sheet: sh, headerZero: header_row, mapping, rows: data } = entry;
  const findings: OicFinding[] = [];
  const keys = new Set<string>();

  function addFinding(
    sev: "ERROR" | "REVISAR" | "DOCUMENTAL",
    row: number,
    c: number | undefined,
    line: unknown[],
    rule: string,
    detail: string,
    action: string,
    relatedKeys: string[] = []
  ) {
    if (c === undefined || c === null) return;
    const unique = `${sh}|${row}|${c}|${rule}`;
    if (keys.has(unique)) return;
    keys.add(unique);
    const letter = colLetter0(c);
    const cell = `${letter}${row}`;
    const val = (k: string) => (k in mapping && mapping[k] < line.length ? line[mapping[k]] : null);
    const heading = text(data[0]?.[c]).replace(/\n/g, " ").trim().slice(0, 100);
    const unit = text(val("unidad")) || text(val("siglas")) || text(val("ur"));
    const contract = text(val("contrato"));
    const value = text(c < line.length ? line[c] : null).slice(0, 300);
    const related = relatedKeys
      .filter((k) => k in mapping && mapping[k] !== c)
      .map((k) => `${colLetter0(mapping[k])}${row}`);
    findings.push({
      severity: sev,
      sheet: sh,
      row,
      cell,
      field: heading,
      rule,
      detail,
      action,
      unit,
      contract,
      value,
      related,
    });
  }

  const validRows: { r: number; line: unknown[] }[] = [];

  // Pass 1: Base Auditor rules
  for (let idx = 1; idx < data.length; idx++) {
    const line = data[idx];
    const i = header_row + 1 + idx; // 1-based Excel row number
    if (!line) continue;
    const val = (k: string) => (k in mapping && mapping[k] < line.length ? line[mapping[k]] : null);
    if (!["contrato", "proveedor", "estatus"].some((k) => k in mapping && !missing(val(k)))) continue;

    const add = (
      sev: "ERROR" | "REVISAR" | "DOCUMENTAL",
      key: string,
      rule: string,
      detail: string,
      action: string,
      related: string[] = []
    ) => addFinding(sev, i, mapping[key], line, rule, detail, action, related);

    const st = normalize(val("estatus"));
    const fu = normalize(val("fuente"));

    for (const fieldkey of ["ramo", "ur", "unidad", "contrato", "proveedor", "clave", "descripcion_insumo"]) {
      if (fieldkey in mapping && missing(val(fieldkey))) {
        add("REVISAR", fieldkey, "DATO_IDENTIFICADOR", "Falta un dato de identificación del registro.", "Capturar dato o justificar expresamente su no aplicabilidad.");
      }
    }
    if ("ramo" in mapping) {
      const rNum = parseNumber(val("ramo"));
      if (rNum !== null && rNum !== 12) {
        add("REVISAR", "ramo", "RAMO_INUSUAL", "El ramo es distinto de 12 en el archivo sectorial.", "Confirmar rama presupuestal reportada.");
      }
    }
    if ("fuente" in mapping && !VALID_FUENTE.has(fu)) {
      add("REVISAR", "fuente", "FUENTE_FUERA_CATALOGO", `Fuente «${text(val("fuente")).slice(0, 80)}» fuera del diccionario.`, "Seleccionar Única, Única con patente, Patente u Otra; confirmar la clasificación.");
    }
    if ("estatus" in mapping && !VALID_STATUS.has(st)) {
      add("REVISAR", "estatus", "ESTATUS_FUERA_CATALOGO", `El texto «${text(val("estatus")).slice(0, 85)}» no es uno de los tres estatus permitidos.`, "Confirmar el estado jurídico y capturar literalmente EN PROCESO, RESCINDIDO o SUSPENSIÓN DE LA RESCISIÓN; trasladar explicaciones a Comentarios.");
    }

    const vals: Record<string, number | null> = {
      monto: parseNumber(val("monto")),
      cantidad_contratada: parseNumber(val("cantidad_contratada")),
      precio: parseNumber(val("precio")),
      cantidad_solicitada: parseNumber(val("cantidad_solicitada")),
      no_entregada: parseNumber(val("no_entregada")),
    };

    for (const [k, n] of Object.entries(vals)) {
      if (!(k in mapping)) continue;
      if (n === null) {
        add("REVISAR", k, "NUMERICO_NO_VALIDO", `El campo cuantitativo contiene un valor ausente/no numérico («${text(val(k)).slice(0, 65)}»).`, "Capturar cifra numérica válida o justificar que no aplica.");
      } else if (n < 0) {
        add("ERROR", k, "NUMERICO_NEGATIVO", `Valor negativo (${fmtGen(n)}) en un campo que representa un importe o piezas.`, "Rectificar el valor; si representa ajuste, documentarlo en el campo correspondiente.");
      } else if ((k === "monto" || k === "cantidad_contratada" || k === "precio") && n === 0) {
        add("REVISAR", k, "IMPORTE_O_BASE_CERO", "Importe, precio o cantidad contratada igual a cero.", "Verificar la base económica y la partida correspondiente.");
      }
      if (n !== null && (k === "cantidad_contratada" || k === "cantidad_solicitada" || k === "no_entregada") && Math.abs(n - Math.round(n)) > 1e-8) {
        add("ERROR", k, "PIEZAS_NO_ENTERAS", `Cantidad de piezas con decimales (${fmtGen(n)}).`, "Expresar piezas en números enteros; verificar si se reportó una unidad distinta.");
      }
    }

    const { monto, cantidad_contratada: q, precio: p, cantidad_solicitada: qs, no_entregada: qn } = vals;
    if (monto !== null && q !== null && p !== null && Math.min(monto, q, p) > 0) {
      const expected = Math.round(q * p * 100) / 100;
      const difference = Math.round((monto - expected) * 100) / 100;
      if (Math.abs(difference) > Math.max(0.05, Math.abs(expected) * 0.000001)) {
        add(
          "ERROR",
          "monto",
          "MONTO_X_PRECIO",
          `Importe ${fmtMoney(monto)}; cantidad × precio = ${fmtMoney(expected)}; diferencia = ${fmtMoney(difference)} MXN.`,
          "Verificar que el importe de la partida sea sin IVA y coincida con cantidad contratada × precio unitario.",
          ["cantidad_contratada", "precio"]
        );
      }
    }

    if (qs !== null && q !== null && qs > q + 1e-8) {
      add("REVISAR", "cantidad_solicitada", "SOLICITADA_SUPERA_CONTRATADA", `Solicitada ${fmtGen(qs)} > contratada ${fmtGen(q)}.`, "Corroborar acumulación de órdenes/modificaciones; corregir cifras o justificar.", ["cantidad_contratada"]);
    }
    if (qn !== null && qs !== null && qn > qs + 1e-8) {
      add("ERROR", "no_entregada", "NO_ENTREGADA_SUPERA_SOLICITADA", `No entregada ${fmtGen(qn)} > solicitada ${fmtGen(qs)}.`, "Revisar órdenes de suministro y registrar la cantidad efectivamente incumplida.", ["cantidad_solicitada"]);
    }
    if (qn !== null && q !== null && qn > q + 1e-8) {
      add("REVISAR", "no_entregada", "NO_ENTREGADA_SUPERA_CONTRATADA", `No entregada ${fmtGen(qn)} > contratada ${fmtGen(q)}.`, "Verificar unidades y acumulación de órdenes; explicar la diferencia.", ["cantidad_contratada"]);
    }
    const normMotivos = normalize(val("motivos"));
    if (VALID_STATUS.has(st) && qn === 0 && (st === "EN PROCESO" || st === "RESCINDIDO") && (normMotivos.includes("FALTA DE ENTREGA") || normMotivos.includes("INCUMPLIMIENTO DE ENTREGA"))) {
      add("REVISAR", "no_entregada", "INCUMPLIMIENTO_CON_CERO", "Se declara incumplimiento de entrega, pero las piezas no entregadas son cero.", "Verificar el corte de la entrega, la causa de rescisión y el número de piezas.", ["motivos", "estatus"]);
    }

    const dates: Record<string, string | null> = {
      inicio: parseDate(val("inicio")),
      formal: parseDate(val("formal")),
      suspension_fecha: parseDate(val("suspension_fecha")),
    };
    for (const [k, d] of Object.entries(dates)) {
      if (!(k in mapping)) continue;
      if (d && d > cutoffIso) {
        add("ERROR", k, "FECHA_POSTERIOR_CORTE", `Fecha ${formatDateDMY(d)} posterior al corte ${formatDateDMY(cutoffIso)}.`, "Corregir la fecha o confirmar el corte reportado.");
      }
      if (d && Number(d.slice(0, 4)) < 2018) {
        add("REVISAR", k, "FECHA_MUY_ANTERIOR", `Fecha ${formatDateDMY(d)} inusualmente antigua.`, "Confirmar que corresponda al procedimiento reportado.");
      }
      if (!d && !missing(val(k))) {
        add("REVISAR", k, "FECHA_NO_CAPTURADA", "El campo de fecha contiene narración/texto en lugar de fecha o N/A.", "Capturar fecha en formato dd/mm/aaaa o N/A cuando proceda; llevar la explicación a Comentarios.");
      }
    }
    const { inicio: start, formal, suspension_fecha: susp } = dates;
    if (start && formal && formal < start) {
      add("ERROR", "formal", "FORMAL_ANTES_DE_INICIO", `Formalización ${formatDateDMY(formal)} anterior al inicio ${formatDateDMY(start)}.`, "Corregir fechas conforme a constancias de notificación.", ["inicio"]);
    }
    if (start && susp && susp < start) {
      add("REVISAR", "suspension_fecha", "SUSPENSION_ANTES_INICIO", `Fecha de suspensión/entrega ${formatDateDMY(susp)} anterior al inicio ${formatDateDMY(start)}.`, "Confirmar la naturaleza de la fecha y las actuaciones del procedimiento.", ["inicio"]);
    }
    if (st === "RESCINDIDO") {
      if (!start) {
        add("REVISAR", "inicio", "RESCINDIDO_SIN_INICIO", "Se reporta RESCINDIDO sin fecha acreditable de notificación de inicio.", "Registrar fecha de notificación al proveedor y soporte documental.", ["estatus"]);
      }
      if (!formal) {
        add("ERROR", "formal", "RESCINDIDO_SIN_FORMALIZACION", "Se reporta RESCINDIDO sin fecha de notificación de formalización.", "Capturar la fecha real y acreditar resolución/notificación.", ["estatus"]);
      }
    }
    if (st === "EN PROCESO") {
      if (!start) {
        add("REVISAR", "inicio", "PROCESO_SIN_INICIO", "EN PROCESO requiere procedimiento iniciado/notificado; falta fecha válida.", "Confirmar existencia de notificación de inicio o reclasificar estatus.", ["estatus"]);
      }
      if (formal) {
        add("REVISAR", "formal", "PROCESO_CON_FORMALIZACION", "Se reporta EN PROCESO, pero existe fecha de formalización.", "Validar si debe cambiar a RESCINDIDO u otro estatus.", ["estatus"]);
      }
    }
    if (st === "SUSPENSION DE LA RESCISION") {
      const normSentido = normalize(val("sentido"));
      if (missing(val("sentido"))) {
        add("REVISAR", "sentido", "SUSPENSION_SIN_SENTIDO", "Falta indicar qué originó la suspensión.", "Precisar acuerdo, conciliación, entrega o razón acreditada.", ["estatus"]);
      }
      if (normSentido.includes("NO SE TRATO DE UNA SUSPENSION") || normSentido.includes("NO EXISTIO SUSPENSION")) {
        add("ERROR", "sentido", "SUSPENSION_CONTRADICTORIA", "El estatus indica suspensión, pero su justificación dice que no existió.", "Aclarar estatus y sentido jurídicamente correcto.", ["estatus"]);
      }
      if (!susp) {
        add("REVISAR", "suspension_fecha", "SUSPENSION_SIN_FECHA", "No hay fecha de suspensión o entrega acordada interpretable.", "Indicar la(s) fecha(s) aplicable(s) o explicar por qué no corresponde.", ["estatus"]);
      }
    }
    if (VALID_STATUS.has(st) && missing(val("motivos"))) {
      add("REVISAR", "motivos", "SIN_MOTIVO", "El motivo de rescisión está vacío o marcado N/A.", "Describir el incumplimiento o supuesto de rescisión iniciado.", ["estatus"]);
    }
    if (VALID_STATUS.has(st) && missing(val("soporte"))) {
      add("DOCUMENTAL", "soporte", "SIN_SOPORTE", "Falta referencia documental para acreditar el estado del procedimiento.", "Identificar oficio, acuse, acuerdo o resolución, según corresponda.", ["estatus"]);
    }
    const normCom = normalize(val("comentarios"));
    if (st === "RESCINDIDO" && normCom.includes("SE CONTINUA CON EL PROCESO")) {
      add("REVISAR", "comentarios", "RESCINDIDO_VS_COMENTARIO", "Comentarios indican que continúa el proceso, pero el estatus ya es RESCINDIDO.", "Actualizar comentario o confirmar el estatus y su fecha.", ["estatus", "formal"]);
    }
    if (VALID_STATUS.has(st) && normCom.includes("NO SE INICIO PROCEDIMIENTO")) {
      add("REVISAR", "comentarios", "SIN_INICIO_VS_ESTATUS", "Comentarios señalan que no se inició procedimiento formal aunque tiene estatus activo.", "Validar notificación de inicio y clasificación reportada.", ["estatus", "inicio"]);
    }

    for (let cx = 0; cx < (data[0]?.length || 0); cx++) {
      const head = data[0][cx];
      if (normalize(head).startsWith("INCONSISTENCIA") && !missing(line[cx])) {
        const explanation = text(line[cx]);
        const nExp = normalize(explanation);
        const key = nExp.includes("ESTATUS")
          ? "estatus"
          : nExp.includes("FUENTE")
          ? "fuente"
          : nExp.includes("MONTO") || nExp.includes("IMPORTE")
          ? "monto"
          : nExp.includes("NO ENTREGADA") || nExp.includes("PIEZAS")
          ? "no_entregada"
          : "contrato";
        add("REVISAR", key, `OBSERVACION_PREVIA_${cx}`, `Observación preexistente: ${explanation.slice(0, 250)}`, "Atender la observación ya formulada; registrar aclaración o corrección.");
      }
    }
    validRows.push({ r: i, line });
  }

  // Pass 1b: Base cross-row rules by contract
  const groups = new Map<string, { r: number; line: unknown[] }[]>();
  for (const item of validRows) {
    const c = normalize(item.line[mapping["contrato"]]);
    if (c) {
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(item);
    }
  }
  for (const [, items] of groups) {
    if (items.length < 2) continue;
    const suppliers = new Map<string, number[]>();
    const sts = new Map<string, number[]>();
    const dup = new Map<string, number[]>();
    for (const { r, line } of items) {
      const val = (k: string) => (k in mapping && mapping[k] < line.length ? line[mapping[k]] : null);
      const sup = normalize(val("proveedor"));
      if (sup) {
        if (!suppliers.has(sup)) suppliers.set(sup, []);
        suppliers.get(sup)!.push(r);
      }
      const st = normalize(val("estatus"));
      if (VALID_STATUS.has(st)) {
        if (!sts.has(st)) sts.set(st, []);
        sts.get(st)!.push(r);
      }
      const sigProv = normalize(val("proveedor"));
      const sigClave = normalize(val("clave"));
      if (sigProv && sigClave) {
        const sig = JSON.stringify([
          sigProv,
          sigClave,
          normalize(val("descripcion_insumo")),
          parseNumber(val("monto")),
          parseNumber(val("cantidad_contratada")),
          parseNumber(val("precio")),
          parseNumber(val("cantidad_solicitada")),
          parseNumber(val("no_entregada")),
        ]);
        if (!dup.has(sig)) dup.set(sig, []);
        dup.get(sig)!.push(r);
      }
    }
    if (suppliers.size > 1) {
      const rowList = items.slice(0, 12).map((x) => x.r).join(", ");
      for (const { r, line } of items) {
        addFinding("REVISAR", r, mapping["proveedor"], line, "PROVEEDORES_POR_CONTRATO", `Mismo contrato con proveedores diferentes en filas ${rowList}.`, "Corroborar que el contrato corresponda al mismo proveedor; verificar posibles errores de captura.", ["contrato"]);
      }
    }
    if (sts.size > 1) {
      for (const { r, line } of items) {
        const st = normalize(line[mapping["estatus"]]);
        if (sts.has(st)) {
          addFinding("REVISAR", r, mapping["estatus"], line, "ESTATUS_DISTINTO_CONTRATO", "El contrato se reporta con diferentes estatus entre sus partidas.", "Confirmar si hay procedimientos independientes por orden/partida y explicar o unificar.", ["contrato"]);
        }
      }
    }
    for (const [, rr] of dup) {
      if (rr.length > 1) {
        const rrSet = new Set(rr);
        const rrStr = rr.slice(0, 15).join(", ");
        for (const { r, line } of items) {
          if (rrSet.has(r)) {
            addFinding("REVISAR", r, mapping["clave"], line, "POSIBLE_REGISTRO_DUPLICADO", `Contrato, clave, proveedor y cifras idénticas en filas ${rrStr}.`, "Confirmar si corresponde a órdenes distintas o eliminar duplicidad únicamente con soporte.", ["contrato", "monto"]);
          }
        }
      }
    }
  }

  // Pass 2: AuditorAmpliado rules
  const ampItems: { r: number; line: unknown[]; nums: Record<string, number | null> }[] = [];
  for (let idx = 1; idx < data.length; idx++) {
    const line = data[idx];
    const row_number = header_row + 1 + idx;
    if (!line) continue;
    const val = (k: string) => (k in mapping && mapping[k] < line.length ? line[mapping[k]] : null);
    if (!["contrato", "proveedor", "estatus"].some((k) => k in mapping && !missing(val(k)))) continue;

    const add = (
      sev: "ERROR" | "REVISAR" | "DOCUMENTAL",
      key: string,
      rule: string,
      detail: string,
      action: string,
      related: string[] = []
    ) => addFinding(sev, row_number, mapping[key], line, rule, detail, action, related);

    const nums: Record<string, number | null> = {
      monto: parseNumber(val("monto")),
      cantidad_contratada: parseNumber(val("cantidad_contratada")),
      precio: parseNumber(val("precio")),
      cantidad_solicitada: parseNumber(val("cantidad_solicitada")),
      no_entregada: parseNumber(val("no_entregada")),
    };
    const { monto: m, cantidad_contratada: q, precio: p } = nums;
    if ("monto" in mapping && "cantidad_contratada" in mapping && "precio" in mapping) {
      if (m !== null && q !== null && p !== null && m > 0 && q > 0 && p > 0) {
        const base = q * p;
        const tol = Math.max(0.06, base * 0.00002);
        if (Math.abs(m - base * 1.16) <= tol && Math.abs(m - base) > tol) {
          add("REVISAR", "monto", "POSIBLE_IVA_16_PCT", `Monto ${fmtMoney(m)}; cantidad × precio ${fmtMoney(base)}; coincide aproximadamente con agregar 16% de IVA.`, "Confirmar si el monto está expresado SIN IVA conforme al encabezado; revisar contrato y precio unitario.", ["cantidad_contratada", "precio"]);
        }
        if (q > 1 && Math.abs(m - p) <= Math.max(0.05, p * 0.00001) && Math.abs(m - base) > tol) {
          add("REVISAR", "precio", "PRECIO_APARENTA_TOTAL", `Precio unitario (${fmtMoney(p)}) coincide con monto total, aunque cantidad contratada es ${fmtGen(q)}.`, "Revisar si se capturó el importe total en lugar del precio por pieza.", ["monto", "cantidad_contratada"]);
        }
      }
      if (m !== null && m > 0 && ((q !== null && q === 0) || (p !== null && p === 0))) {
        add("REVISAR", "monto", "MONTO_SIN_BASE_POSITIVA", "Monto contratado positivo, pero cantidad contratada o precio unitario es cero.", "Corroborar los importes y la unidad de registro utilizada.", ["cantidad_contratada", "precio"]);
      }
      if (m === null && q === null && p === null) {
        add("REVISAR", "monto", "BASE_ECONOMICA_SIN_CIFRAS", "Los tres campos económicos (monto, cantidad contratada y precio unitario) carecen de cifras válidas.", "Completar la información económica, o motivar expresamente por qué no corresponde reportarla.", ["cantidad_contratada", "precio"]);
      }
    }
    if ("cantidad_solicitada" in mapping && "no_entregada" in mapping && nums.cantidad_solicitada === 0 && nums.no_entregada !== null && nums.no_entregada > 0) {
      add("ERROR", "no_entregada", "SIN_SOLICITUD_CON_PENDIENTE", "Hay piezas no entregadas pese a que la cantidad solicitada registrada es cero.", "Conciliar pedidos emitidos, cantidades solicitadas y cantidades incumplidas.", ["cantidad_solicitada"]);
    }
    const st = normalize(val("estatus"));
    const mt = normalize(val("motivos"));
    const suspension = parseDate(val("suspension_fecha"));
    const formal = parseDate(val("formal"));
    if ((st === "EN PROCESO" || st === "RESCINDIDO") && suspension) {
      add("REVISAR", "suspension_fecha", "SUSPENSION_FECHA_OTRO_ESTATUS", `Existe fecha de suspensión/entrega (${formatDateDMY(suspension)}) y el estatus es «${text(val("estatus")).slice(0, 40)}».`, "Explicar si se trata de antecedente de una suspensión ya concluida o rectificar la clasificación.", ["estatus", "comentarios"]);
    }
    if ((st === "SUSPENSION DE LA RESCISION" || st === "SUSPENSION DE RESCISION") && formal) {
      add("REVISAR", "formal", "SUSPENSION_CON_FORMALIZACION", "Se indica suspensión pero también fecha de formalización de rescisión.", "Precisar si es la misma actuación, si hubo reanudación o si el estatus quedó desactualizado.", ["estatus", "suspension_fecha"]);
    }
    if (st === "RESCINDIDO" && (mt.includes("ENTREGA TOTAL") || mt.includes("ENTREGA COMPLETA") || mt.includes("SE ENTREGO LA TOTALIDAD"))) {
      add("REVISAR", "motivos", "MOTIVO_CUMPLIMIENTO_CON_RESCISION", "El motivo menciona entrega total/completa pero el estatus es RESCINDIDO.", "Confirmar causa de rescisión y distinguir antecedentes, cumplimiento posterior y fundamento.", ["estatus", "comentarios"]);
    }
    if (nums.no_entregada !== null && nums.no_entregada > 0 && (mt.includes("ENTREGA COMPLETA") || mt.includes("ENTREGA TOTAL"))) {
      add("REVISAR", "motivos", "ENTREGA_COMPLETA_CON_PENDIENTES", `El motivo menciona entrega completa, pero se reportan ${fmtGen(nums.no_entregada)} piezas no entregadas.`, "Conciliar fecha de corte, evidencia de recepción y cantidad pendiente.", ["no_entregada", "cantidad_solicitada"]);
    }
    const clave = text(val("clave"));
    if ("clave" in mapping && !missing(clave) && clave.replace(/[^A-Za-z0-9]/g, "").length < 7) {
      add("REVISAR", "clave", "CLAVE_INSUMO_ATIPICA", `Clave «${clave.slice(0, 45)}» con longitud reducida; podría estar incompleta.`, "Corroborar contra el catálogo institucional o la clave contractual.", ["descripcion_insumo"]);
    }
    const normContrato = normalize(val("contrato"));
    if ("contrato" in mapping && normContrato.length > 0 && normContrato.replace(/\s+/g, "").length < 5) {
      add("REVISAR", "contrato", "CONTRATO_IDENTIFICADOR_CORTO", "Número de contrato muy corto para permitir identificación inequívoca.", "Confirmar el número íntegro del instrumento contractual.", ["proveedor"]);
    }
    ampItems.push({ r: row_number, line, nums });
  }

  // Pass 2b: Cross-row rules in AuditorAmpliado
  const byContractKey = new Map<string, { r: number; line: unknown[]; nums: Record<string, number | null> }[]>();
  const byContract = new Map<string, { r: number; line: unknown[]; nums: Record<string, number | null>; clave: string }[]>();

  for (const item of ampItems) {
    const val = (k: string) => (k in mapping && mapping[k] < item.line.length ? item.line[mapping[k]] : null);
    const contract = normalize(val("contrato"));
    const clave = normalize(val("clave"));
    const supplier = normalize(val("proveedor"));
    if (contract) {
      if (!byContract.has(contract)) byContract.set(contract, []);
      byContract.get(contract)!.push({ ...item, clave });
    }
    if (contract && clave && supplier) {
      const ck = `${contract}|${clave}|${supplier}`;
      if (!byContractKey.has(ck)) byContractKey.set(ck, []);
      byContractKey.get(ck)!.push(item);
    }
  }

  for (const [, group] of byContractKey) {
    if (group.length < 2) continue;
    const prices = new Set<number>();
    for (const g of group) {
      if (g.nums.precio !== null && g.nums.precio > 0) {
        prices.add(Math.round(g.nums.precio * 10000) / 10000);
      }
    }
    if (prices.size > 1) {
      const rr = group.slice(0, 10).map((g) => g.r).join(",");
      for (const g of group) {
        addFinding("REVISAR", g.r, mapping["precio"], g.line, "PRECIO_VARIABLE_MISMA_CLAVE_CONTRATO", `Hay precios unitarios diferentes para el mismo contrato, clave y proveedor; filas ${rr}.`, "Verificar convenios modificatorios, presentaciones o errores de captura.", ["contrato", "clave", "proveedor"]);
      }
    }
  }

  for (const [, group] of byContract) {
    if (group.length < 3) continue;
    const amounts = new Map<number, typeof group>();
    for (const g of group) {
      if (g.clave && g.nums.monto !== null && g.nums.monto > 0) {
        const amt = Math.round(g.nums.monto * 100) / 100;
        if (!amounts.has(amt)) amounts.set(amt, []);
        amounts.get(amt)!.push(g);
      }
    }
    for (const [amount, same] of amounts) {
      const distinctClaves = new Set(same.map((x) => x.clave));
      if (distinctClaves.size < 3) continue;
      let mismatches = 0;
      for (const s of same) {
        const q = s.nums.cantidad_contratada, p = s.nums.precio;
        if (q !== null && p !== null && q > 0 && p > 0) {
          if (Math.abs(amount - q * p) > Math.max(0.06, q * p * 0.00002)) mismatches++;
        }
      }
      if (mismatches < 2) continue;
      const rr = same.slice(0, 10).map((x) => x.r).join(",");
      for (const s of same) {
        addFinding("REVISAR", s.r, mapping["monto"], s.line, "MONTO_POTENCIALMENTE_GLOBAL_REPETIDO", `Mismo importe ${fmtMoney(amount)} repetido en tres o más claves del contrato; filas ${rr}, con diferencias frente a cantidad × precio.`, "Confirmar si se consignó el monto global del contrato en partidas; no sumar ni redistribuir importes sin evidencia.", ["contrato", "clave", "cantidad_contratada", "precio"]);
      }
    }
  }

  return findings;
}

function makeNote(f: OicFinding): string {
  const detail = (f.detail || "").trim().replace(/\s+/g, " ");
  const action = (f.action || "").trim().replace(/\s+/g, " ");
  const field = (f.field || "").trim().replace(/\s+/g, " ");
  let prefix = "";
  if (f.rule === "MONTO_X_PRECIO") {
    prefix = "Verificar monto contratado frente a cantidad contratada por precio unitario.";
  } else if (f.rule === "ESTATUS_FUERA_CATALOGO") {
    prefix = "Ajustar estatus conforme al diccionario.";
  } else if (f.rule === "FUENTE_FUERA_CATALOGO") {
    prefix = "Verificar fuente conforme al diccionario.";
  } else if (f.rule.startsWith("NUMERICO_")) {
    prefix = "Verificar el dato numérico de " + field + ".";
  } else if (f.rule.startsWith("OBSERVACION_PREVIA_")) {
    prefix = "Observación institucional anterior.";
  } else {
    prefix = field ? `Verificar ${field}.` : "Verificar registro.";
  }
  const related = f.related.join(", ");
  let result = `${prefix} ${detail} ${action}`;
  if (related) result += ` Datos relacionados: ${related}.`;
  return result.slice(0, 1020);
}

// ============================================================================
// 5. OOXML Mirror Workbook Builder (100% compatible with verificar_excel.py)
// ============================================================================
export function buildMirrorWorkbookInMemory(
  originalBuf: Buffer,
  entry: ParsedSheetEntry,
  findings: OicFinding[]
): Buffer {
  const zipMap = readZipBuffer(originalBuf);
  const sheetParts = getAllSheetParts(zipMap);
  const existingSheetNames = new Set(sheetParts.map((s) => s.name));
  let newName = "REVISION OIC";
  let serial = 2;
  while (existingSheetNames.has(newName)) {
    newName = `REVISION OIC ${serial}`;
    serial++;
  }
  let newPart = "xl/worksheets/revision_oic_nueva.xml";
  serial = 2;
  while (zipMap.has(newPart)) {
    newPart = `xl/worksheets/revision_oic_nueva_${serial}.xml`;
    serial++;
  }

  const sourceSheetXml = zipMap.get(entry.part)!.toString("utf8");
  const header = entry.headerZero + 1;
  const headers = (entry.rows[0] || []).map((h) => text(h));

  // Determine maxCol and rows in sourceSheetXml
  let maxCol = headers.length;
  const cellRefRe = /\br="([A-Z]+)(\d+)"/gi;
  let crm: RegExpExecArray | null;
  let endRow = header;
  while ((crm = cellRefRe.exec(sourceSheetXml)) !== null) {
    const [r, c] = indexRef(crm[1] + crm[2]);
    if (c > maxCol) maxCol = c;
    if (r > endRow) endRow = r;
  }
  const baseCol = Math.max(maxCol, headers.length);

  // Previous Inconsistencia_N
  let startIdx = 1;
  for (const h of headers) {
    const pm = h.match(/^\s*INCONSISTENCIA[_\s-]*(\d+)\s*$/i);
    if (pm) startIdx = Math.max(startIdx, Number(pm[1]) + 1);
  }

  const byRow = new Map<number, OicFinding[]>();
  for (const f of findings) {
    if (f.sheet === entry.sheet && f.row > header) {
      if (!byRow.has(f.row)) byRow.set(f.row, []);
      byRow.get(f.row)!.push(f);
    }
  }
  let ncols = 1;
  for (const lst of byRow.values()) {
    if (lst.length > ncols) ncols = lst.length;
  }
  const lastCol = baseCol + ncols;

  // Related cells by row
  const relatedByRow = new Map<number, Set<number>>();
  for (const [, finds] of byRow) {
    for (const f of finds) {
      for (const addr of [f.cell, ...f.related]) {
        const [tr, tc] = indexRef(addr);
        if (tr > header && tc >= 1 && tc <= baseCol) {
          if (!relatedByRow.has(tr)) relatedByRow.set(tr, new Set());
          relatedByRow.get(tr)!.add(tc);
        }
      }
    }
  }

  // Update xl/styles.xml
  let stylesXml = zipMap.get("xl/styles.xml")!.toString("utf8");

  // Extract fonts, fills, cellXfs blocks
  const fontsBlock = stylesXml.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)?.[1] || "";
  const fillsBlock = stylesXml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/)?.[1] || "";
  const cellXfsBlock = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "";

  const fontItems = fontsBlock.match(/<font\b[^/>]*(?:\/>|>[\s\S]*?<\/font>)/g) || [];
  let fontCount = fontItems.length;
  const fHeadId = fontCount++;
  const fNoteId = fontCount++;
  const newFontXmls = [
    `<font><sz val="10"/><b/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`,
    `<font><sz val="10"/><color rgb="FF111111"/><name val="Calibri"/></font>`,
  ];

  const fillItems = fillsBlock.match(/<fill\b[^/>]*(?:\/>|>[\s\S]*?<\/fill>)/g) || [];
  let fillCount = fillItems.length;
  const fillHeaderId = fillCount++;
  const fillYellowId = fillCount++;
  const newFillXmls = [
    `<fill><patternFill patternType="solid"><fgColor rgb="FF1C594B"/><bgColor indexed="64"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>`,
  ];

  const xfItems = cellXfsBlock.match(/<xf\b[^/>]*(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
  let xfCount = xfItems.length;

  // Detect default style from header row's first cell, matching generar_hoja_oic.py line 24
  const sheetDataMatch = sourceSheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  const rawRowsXml = sheetDataMatch?.[1] || "";
  let defaultStyleIdx = 0;
  const hdrRowMatch = rawRowsXml.match(new RegExp(`<row\\b[^>]*\\br="${header}"[^>]*>([\\s\\S]*?)<\\/row>`));
  if (hdrRowMatch) {
    const firstCellS = hdrRowMatch[1].match(/<c\b[^/>]*\bs="(\d+)"/)?.[1];
    if (firstCellS !== undefined) {
      const parsedS = Number(firstCellS);
      if (parsedS >= 0 && parsedS < xfItems.length) defaultStyleIdx = parsedS;
    }
  }
  const baseHeaderXf = xfItems[defaultStyleIdx] || xfItems[0] || `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`;
  const setXfAttr = (tag: string, k: string, v: string) => {
    const re = new RegExp(`\\b${k}="[^"]*"`);
    if (re.test(tag)) return tag.replace(re, `${k}="${v}"`);
    return tag.replace(/^<xf\b/, `<xf ${k}="${v}"`);
  };
  const makeRoleXf = (fontId: number, fillId: number, horiz: "center" | "left") => {
    let xf = baseHeaderXf;
    xf = setXfAttr(xf, "fontId", String(fontId));
    xf = setXfAttr(xf, "fillId", String(fillId));
    xf = setXfAttr(xf, "applyFill", "1");
    xf = setXfAttr(xf, "applyFont", "1");
    xf = setXfAttr(xf, "applyAlignment", "1");
    const alignXml = `<alignment vertical="center" horizontal="${horiz}" wrapText="1"/>`;
    if (xf.endsWith("/>")) {
      xf = xf.replace(/\/>$/, `>${alignXml}</xf>`);
    } else if (/<alignment\b[^/>]*\/>/.test(xf)) {
      xf = xf.replace(/<alignment\b[^/>]*\/>/, alignXml);
    } else {
      xf = xf.replace(/<\/xf>$/, `${alignXml}</xf>`);
    }
    return xf;
  };

  const headerStyleId = xfCount++;
  const noteStyleId = xfCount++;
  const newXfXmls = [
    makeRoleXf(fHeadId, fillHeaderId, "center"),
    makeRoleXf(fNoteId, fillYellowId, "left"),
  ];

  const paintedCache = new Map<number, number>();
  const readableFontCache = new Map<number, number>();

  function getPaintedStyle(oldStyleStr: string): number {
    let oldId = Number(oldStyleStr || "0");
    if (isNaN(oldId) || oldId < 0 || oldId >= xfItems.length) oldId = 0;
    if (paintedCache.has(oldId)) return paintedCache.get(oldId)!;
    const origXf = xfItems[oldId] || xfItems[0] || `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`;
    const origFontId = Number(origXf.match(/\bfontId="(\d+)"/)?.[1] || "0");
    if (!readableFontCache.has(origFontId)) {
      const srcFont = fontItems[origFontId] || fontItems[0] || `<font><sz val="10"/><name val="Calibri"/></font>`;
      let cleanedFont = srcFont;
      if (/<color\b[^/>]*\/>/.test(cleanedFont)) {
        cleanedFont = cleanedFont.replace(/<color\b[^/>]*\/>/g, `<color rgb="FF111111"/>`);
      } else if (/<name\b/.test(cleanedFont)) {
        cleanedFont = cleanedFont.replace(/<name\b/, `<color rgb="FF111111"/><name`);
      } else {
        cleanedFont = cleanedFont.replace(/<\/font>$/, `<color rgb="FF111111"/></font>`);
      }
      const rfId = fontCount++;
      newFontXmls.push(cleanedFont);
      readableFontCache.set(origFontId, rfId);
    }
    const rfId = readableFontCache.get(origFontId)!;
    let updatedXf = origXf;
    updatedXf = setXfAttr(updatedXf, "fillId", String(fillYellowId));
    updatedXf = setXfAttr(updatedXf, "applyFill", "1");
    updatedXf = setXfAttr(updatedXf, "fontId", String(rfId));
    updatedXf = setXfAttr(updatedXf, "applyFont", "1");
    const newXfId = xfCount++;
    newXfXmls.push(updatedXf);
    paintedCache.set(oldId, newXfId);
    return newXfId;
  }

  // Transform sheetData rows
  const rowRe = /<row\b([^/>]*)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  const newRowsXml: string[] = [];
  const headerTitles: string[] = [];
  for (let j = 0; j < ncols; j++) {
    headerTitles.push(`Inconsistencia_${startIdx + j}`);
  }

  while ((rm = rowRe.exec(rawRowsXml)) !== null) {
    let rAttrs = rm[1];
    const rBody = rm[2] || "";
    const rNum = Number(rAttrs.match(/\br="(\d+)"/)?.[1] || "0");

    // Parse existing cells in row
    const cellsByCol = new Map<number, string>();
    const cellRe = /<c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rBody)) !== null) {
      const fullCell = cm[0];
      const cAttrs = cm[1];
      const ref = cAttrs.match(/\br="([A-Z]+\d+)"/i)?.[1];
      if (!ref) continue;
      const [, cc] = indexRef(ref);
      cellsByCol.set(cc, fullCell);
    }

    if (rNum === header) {
      for (let j = 0; j < ncols; j++) {
        const colIdx = baseCol + j + 1;
        const ref = `${colLetter1(colIdx)}${rNum}`;
        cellsByCol.set(
          colIdx,
          `<c r="${ref}" t="inlineStr" s="${headerStyleId}"><is><t>${encodeXmlEntities(headerTitles[j])}</t></is></c>`
        );
      }
    } else if (rNum > header) {
      const rowFinds = byRow.get(rNum) || [];
      for (let j = 0; j < rowFinds.length; j++) {
        const colIdx = baseCol + j + 1;
        const ref = `${colLetter1(colIdx)}${rNum}`;
        const noteText = makeNote(rowFinds[j]);
        cellsByCol.set(
          colIdx,
          `<c r="${ref}" t="inlineStr" s="${noteStyleId}"><is><t>${encodeXmlEntities(noteText)}</t></is></c>`
        );
      }
      const relCols = relatedByRow.get(rNum);
      if (relCols) {
        for (const cc of relCols) {
          const existingCell = cellsByCol.get(cc);
          const ref = `${colLetter1(cc)}${rNum}`;
          if (!existingCell) {
            const ps = getPaintedStyle("0");
            cellsByCol.set(cc, `<c r="${ref}" s="${ps}"/>`);
          } else {
            const oldS = existingCell.match(/\bs="(\d+)"/)?.[1] || "0";
            const ps = getPaintedStyle(oldS);
            if (/\bs="\d+"/.test(existingCell)) {
              cellsByCol.set(cc, existingCell.replace(/\bs="\d+"/, `s="${ps}"`));
            } else {
              cellsByCol.set(cc, existingCell.replace(/^<c\b/, `<c s="${ps}"`));
            }
          }
        }
      }
    }

    if (rNum >= header) {
      rAttrs = rAttrs.replace(/\s+hidden="[^"]*"/g, "");
    }
    if (/\bspans="[^"]*"/.test(rAttrs)) {
      rAttrs = rAttrs.replace(/\bspans="[^"]*"/, `spans="1:${lastCol}"`);
    } else {
      rAttrs += ` spans="1:${lastCol}"`;
    }

    const sortedCols = Array.from(cellsByCol.keys()).sort((a, b) => a - b);
    const joinedCells = sortedCols.map((c) => cellsByCol.get(c)!).join("");
    newRowsXml.push(`<row${rAttrs}>${joinedCells}</row>`);
  }

  // Finalize stylesXml with updated fonts, fills, cellXfs (preserving original borders intact)
  stylesXml = stylesXml
    .replace(/<fonts\b[^>]*>[\s\S]*?<\/fonts>/, `<fonts count="${fontCount}">${fontItems.join("")}${newFontXmls.join("")}</fonts>`)
    .replace(/<fills\b[^>]*>[\s\S]*?<\/fills>/, `<fills count="${fillCount}">${fillItems.join("")}${newFillXmls.join("")}</fills>`)
    .replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfCount}">${xfItems.join("")}${newXfXmls.join("")}</cellXfs>`);

  // Build cols and dimension for new worksheet
  const extraColsXml: string[] = [];
  for (let j = baseCol + 1; j <= lastCol; j++) {
    extraColsXml.push(`<col min="${j}" max="${j}" width="66" customWidth="1"/>`);
  }
  const origColsInner = sourceSheetXml.match(/<cols\b[^>]*>([\s\S]*?)<\/cols>/)?.[1] || "";
  const newColsBlock = `<cols>${origColsInner}${extraColsXml.join("")}</cols>`;
  const fullRef = `A${header}:${colLetter1(lastCol)}${endRow}`;
  const newDimBlock = `<dimension ref="A1:${colLetter1(lastCol)}${endRow}"/>`;

  let newSheetViewsBlock = sourceSheetXml.match(/<sheetViews\b[^>]*>[\s\S]*?<\/sheetViews>/)?.[0] || "";
  if (newSheetViewsBlock) {
    newSheetViewsBlock = newSheetViewsBlock
      .replace(/\s+tabSelected="[^"]*"/g, "")
      .replace(/<sheetView\b([^>]*)/g, (m0, a0) => {
        if (/\btopLeftCell="[^"]*"/.test(a0)) {
          return `<sheetView${a0.replace(/\btopLeftCell="[^"]*"/, 'topLeftCell="A1"')}`;
        }
        return `<sheetView topLeftCell="A1"${a0}`;
      })
      .replace(/<pane\b([^>]*)/g, (m0, a0) => {
        const ySplit = Number(a0.match(/\bySplit="(\d+)"/)?.[1] || "0");
        if (ySplit > 0 && /\btopLeftCell="[^"]*"/.test(a0)) {
          return `<pane${a0.replace(/\btopLeftCell="[^"]*"/, `topLeftCell="A${ySplit + 1}"`)}`;
        }
        return m0;
      });
  }
  const sheetFormatPrBlock = sourceSheetXml.match(/<sheetFormatPr\b[^>]*\/>/)?.[0] || `<sheetFormatPr defaultRowHeight="15"/>`;
  const mergeCellsBlock = sourceSheetXml.match(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/)?.[0] || "";
  const pageMarginsBlock = sourceSheetXml.match(/<pageMargins\b[^>]*\/>/)?.[0] || `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`;

  // Check if source sheet has a tablePart
  const sheetRelsPath = path.posix.join(path.posix.dirname(entry.part), "_rels", path.posix.basename(entry.part) + ".rels");
  let originalTableStyleInfo = `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>`;
  const sourceColNames: string[] = [];
  let hasOriginalTable = false;

  if (zipMap.has(sheetRelsPath) && sourceSheetXml.includes("<tableParts")) {
    const srXml = zipMap.get(sheetRelsPath)!.toString("utf8");
    const relRe = /<Relationship\b([^>]*)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = relRe.exec(srXml)) !== null) {
      const attrs = m[1];
      const type = attrs.match(/\bType="([^"]+)"/)?.[1] || "";
      const target = attrs.match(/\bTarget="([^"]+)"/)?.[1] || "";
      if (type.endsWith("/table") && target) {
        const tPath = path.posix.normalize(path.posix.join(path.posix.dirname(entry.part), target));
        if (zipMap.has(tPath)) {
          const tXml = zipMap.get(tPath)!.toString("utf8");
          const tRef = tXml.match(/\bref="([^"]+)"/)?.[1] || "";
          if (!tRef.toUpperCase().startsWith(`A${header}:`)) {
            continue;
          }
          const tsi = tXml.match(/<tableStyleInfo\b[^>]*\/>/)?.[0];
          if (tsi) originalTableStyleInfo = tsi;
          const tcRe = /<tableColumn\b([^/>]*)\/?>/g;
          let tcm: RegExpExecArray | null;
          while ((tcm = tcRe.exec(tXml)) !== null) {
            const nm = decodeXmlEntities(tcm[1].match(/\bname="([^"]+)"/)?.[1] || "");
            sourceColNames.push(nm);
          }
          hasOriginalTable = true;
          break;
        }
      }
    }
  }

  let tablePartPath = "xl/tables/revision_oic_tabla.xml";
  serial = 2;
  while (zipMap.has(tablePartPath)) {
    tablePartPath = `xl/tables/revision_oic_tabla_${serial}.xml`;
    serial++;
  }
  let maxTableId = 1;
  for (const [k, v] of zipMap.entries()) {
    if (k.startsWith("xl/tables/") && k.endsWith(".xml")) {
      const tid = Number(v.toString("utf8").match(/\bid="(\d+)"/)?.[1] || "0");
      if (tid > maxTableId) maxTableId = tid;
    }
  }
  const newTableId = maxTableId + 1;
  const newTableName = newTableId > 2 ? `RevisionOIC_${newTableId}` : "RevisionOIC";

  let tableXmlBuf: Buffer | null = null;
  let newSheetRelsPath = "";
  let newSheetRelsBuf: Buffer | null = null;

  if (hasOriginalTable) {
    const seenNames = new Set<string>();
    const tcXmls: string[] = [];
    for (let i = 1; i <= lastCol; i++) {
      let nm = "";
      if (i <= sourceColNames.length && sourceColNames[i - 1]) {
        nm = sourceColNames[i - 1];
      } else if (i <= headers.length && headers[i - 1]) {
        nm = headers[i - 1];
      } else {
        nm = headerTitles[i - baseCol - 1] || `Inconsistencia_${i - baseCol}`;
      }
      nm = (nm || `Columna_${i}`).trim();
      const baseNm = nm;
      let idx = 2;
      while (seenNames.has(nm.toLowerCase())) {
        nm = `${baseNm}_${idx}`;
        idx++;
      }
      seenNames.add(nm.toLowerCase());
      tcXmls.push(`<tableColumn id="${i}" name="${encodeXmlEntities(nm)}"/>`);
    }
    const tableXml = `<?xml version='1.0' encoding='utf-8'?>\n<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${newTableId}" name="${newTableName}" displayName="${newTableName}" ref="${fullRef}" totalsRowShown="0"><autoFilter ref="${fullRef}"/><tableColumns count="${lastCol}">${tcXmls.join("")}</tableColumns>${originalTableStyleInfo}</table>`;
    tableXmlBuf = Buffer.from(tableXml, "utf8");
    newSheetRelsPath = path.posix.join(path.posix.dirname(newPart), "_rels", path.posix.basename(newPart) + ".rels");
    const relXml = `<?xml version='1.0' encoding='utf-8'?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/${path.posix.basename(tablePartPath)}"/></Relationships>`;
    newSheetRelsBuf = Buffer.from(relXml, "utf8");
  }

  // CRITICAL ECMA-376 CT_Worksheet sequence:
  // <sheetData> -> <autoFilter> -> <mergeCells> -> <pageMargins> -> <tableParts>
  const autoFilterBlock = hasOriginalTable ? "" : `<autoFilter ref="${fullRef}"/>`;
  const tablePartsBlock = hasOriginalTable ? `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` : "";

  const origWorksheetOpenTag = (
    sourceSheetXml.match(/<worksheet\b[^>]*>/)?.[0] ||
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
  ).replace(/\s+\w*:?uid="[^"]*"/g, "");

  const newWorksheetXml = `<?xml version='1.0' encoding='utf-8'?>\n${origWorksheetOpenTag}${newDimBlock}${newSheetViewsBlock}${sheetFormatPrBlock}${newColsBlock}<sheetData>${newRowsXml.join("")}</sheetData>${autoFilterBlock}${mergeCellsBlock}${pageMarginsBlock}${tablePartsBlock}</worksheet>`;

  // Update workbook.xml, workbook.xml.rels, [Content_Types].xml
  let wbXml = zipMap.get("xl/workbook.xml")!.toString("utf8");
  let wbRelsXml = zipMap.get("xl/_rels/workbook.xml.rels")!.toString("utf8");
  let ctXml = zipMap.get("[Content_Types].xml")!.toString("utf8");

  const usedRids = new Set<string>();
  for (const m of wbRelsXml.matchAll(/\bId="(rId\d+)"/g)) usedRids.add(m[1]);
  let ridNum = 1;
  while (usedRids.has(`rId${ridNum}`)) ridNum++;
  const newRid = `rId${ridNum}`;

  let maxSheetId = 1;
  for (const s of sheetParts) {
    const sid = Number(s.sheetId);
    if (sid > maxSheetId) maxSheetId = sid;
  }
  const newSheetId = maxSheetId + 1;

  wbXml = wbXml.replace(
    /<\/sheets>/,
    `<sheet name="${encodeXmlEntities(newName)}" sheetId="${newSheetId}" r:id="${newRid}"/></sheets>`
  );
  wbRelsXml = wbRelsXml.replace(
    /<\/Relationships>/,
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${newPart.replace(/^xl\//, "")}"/></Relationships>`
  );
  let ctAdditions = `<Override PartName="/${newPart}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  if (hasOriginalTable) {
    ctAdditions += `<Override PartName="/${tablePartPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`;
  }
  ctXml = ctXml.replace(/<\/Types>/, `${ctAdditions}</Types>`);

  const outEntries: ZipEntry[] = [];
  for (const [name, data] of zipMap.entries()) {
    if (name === "xl/workbook.xml") {
      outEntries.push({ name, data: Buffer.from(wbXml, "utf8") });
    } else if (name === "xl/_rels/workbook.xml.rels") {
      outEntries.push({ name, data: Buffer.from(wbRelsXml, "utf8") });
    } else if (name === "xl/styles.xml") {
      outEntries.push({ name, data: Buffer.from(stylesXml, "utf8") });
    } else if (name === "[Content_Types].xml") {
      outEntries.push({ name, data: Buffer.from(ctXml, "utf8") });
    } else {
      outEntries.push({ name, data });
    }
  }
  outEntries.push({ name: newPart, data: Buffer.from(newWorksheetXml, "utf8") });
  if (hasOriginalTable && tableXmlBuf && newSheetRelsBuf) {
    outEntries.push({ name: tablePartPath, data: tableXmlBuf });
    outEntries.push({ name: newSheetRelsPath, data: newSheetRelsBuf });
  }

  return writeZipBuffer(outEntries);
}

// ============================================================================
// 6. High-Level API Functions (Preview & Export)
// ============================================================================
export function previewWorkbookBuffer(
  fileBuf: Buffer,
  fileName: string,
  cutoffIso: string
): { record: OicPreviewRecord; entry: ParsedSheetEntry; findings: OicFinding[] } {
  const zipMap = readZipBuffer(fileBuf);
  if (!zipMap.has("xl/workbook.xml") || !zipMap.has("[Content_Types].xml")) {
    throw new Error(`No es un libro XLSX válido: ${fileName}`);
  }
  for (const k of zipMap.keys()) {
    if (k.toLowerCase().endsWith("vbaproject.bin")) {
      throw new Error("No se admiten macros en los archivos recibidos.");
    }
  }
  const sheets = readSheetsFromZip(zipMap);
  if (sheets.length === 0) {
    throw new Error("No se encontraron encabezados reconocibles del layout de rescisión.");
  }
  const main =
    sheets.find((s) => normalize(s.sheet) === "BASE") ||
    sheets.find((s) => normalize(s.sheet) === "DGCOES") ||
    sheets[0];
  const rawFindings = runAuditorAmpliado(main, cutoffIso);
  const sevPriority: Record<string, number> = { ERROR: 0, REVISAR: 1, DOCUMENTAL: 2 };
  const findings = [...rawFindings].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    const pa = sevPriority[a.severity] ?? 9;
    const pb = sevPriority[b.severity] ?? 9;
    if (pa !== pb) return pa - pb;
    const ca = indexRef(a.cell)[1];
    const cb = indexRef(b.cell)[1];
    if (ca !== cb) return ca - cb;
    return a.rule.localeCompare(b.rule);
  });
  const { mapping, rows } = main;

  let numRows = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (["contrato", "proveedor", "estatus"].some((k) => k in mapping && mapping[k] < r.length && !missing(r[mapping[k]]))) {
      numRows++;
    }
  }

  const porGravedad: Record<string, number> = {};
  const porReglaMap = new Map<string, number>();
  const obsRows = new Set<number>();

  for (const f of findings) {
    porGravedad[f.severity] = (porGravedad[f.severity] || 0) + 1;
    porReglaMap.set(f.rule, (porReglaMap.get(f.rule) || 0) + 1);
    obsRows.add(f.row);
  }
  const sortedRules = Array.from(porReglaMap.entries()).sort((a, b) => b[1] - a[1]);
  const porRegla: Record<string, number> = {};
  for (const [k, v] of sortedRules) porRegla[k] = v;

  const columnasReconocidas: Record<string, string> = {};
  for (const [k, idx] of Object.entries(mapping)) {
    if (idx < (rows[0]?.length || 0)) {
      columnasReconocidas[k] = text(rows[0][idx]);
    }
  }

  return {
    record: {
      archivo: fileName,
      hoja: main.sheet,
      registros: numRows,
      inconsistencias: findings.length,
      filas_observadas: obsRows.size,
      por_gravedad: porGravedad,
      por_regla: porRegla,
      columnas_reconocidas: columnasReconocidas,
      hallazgos_muestra: findings.map((f) => ({
        fila: f.row,
        celda: f.cell,
        contrato: f.contract,
        regla: f.rule,
        categoria: f.severity,
        campo: f.field,
        detalle: f.detail,
        accion: f.action,
        celdas_relacionadas: f.related,
      })),
    },
    entry: main,
    findings,
  };
}
