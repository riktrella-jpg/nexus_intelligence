export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method || (opts.body || opts.form ? "POST" : "GET") };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "Content-Type": "application/json" };
  }
  let res: Response | null = null;
  try {
    res = await fetch(API + path, init);
  } catch {
    // If remote backend is unreachable, fallback to Next.js internal routes
    if (typeof window !== "undefined" && path.startsWith("/api/reconciliation")) {
      try {
        res = await fetch(path, init);
      } catch {}
    }
    if (!res) {
      throw new ApiError("No se pudo conectar con el servidor de análisis (backend). Verifique que esté iniciado en " + API);
    }
  }

  // If remote backend returned 404 (e.g. Render pending deploy), fallback to Next.js internal routes
  if (!res.ok && res.status === 404 && typeof window !== "undefined" && path.startsWith("/api/reconciliation")) {
    try {
      const fallbackRes = await fetch(path, init);
      if (fallbackRes.ok) {
        return fallbackRes.json();
      }
    } catch {}
  }

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    throw new ApiError(msg);
  }
  return res.json();
}

export async function download(path: string, body: any, fallbackName: string) {
  const res = await fetch(API + path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new ApiError("No se pudo generar la descarga.");
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="?([^";]+)"?/.exec(cd);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = m ? decodeURIComponent(m[1]) : fallbackName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export type Column = { name: string; type: string; role?: string | null; warnings?: string[]; date_format?: string };
export type Dataset = {
  id: string; name: string; institution?: string; source?: string; data_kind: string; data_kind_label: string; key_cols: string[];
  mapping: Record<string, string>; columns: Column[]; cutoff?: string; updated_at: number; row_count: number;
  role_labels: Record<string, string>; periods?: string[]; imports?: any[]; date_range?: { col: string; min: string; max: string } | null;
  procurement?: { ready: boolean; missing: string[]; supply: boolean }; warnings?: string[];
};

export type Cond = { id: string; col: string; op: string; value?: any; value2?: any; quick?: boolean };
export type FilterState = { logic: "AND" | "OR"; conds: Cond[] };
export const emptyFilters: FilterState = { logic: "AND", conds: [] };

export function toApiFilter(f: FilterState | null | undefined) {
  if (!f || f.conds.length === 0) return null;
  const valid = f.conds.filter((c) => c.col && c.op && (["isnull", "notnull"].includes(c.op) || (c.op === "in" || c.op === "not_in" ? (c.value || []).length > 0 : c.value !== undefined && c.value !== "")));
  if (!valid.length) return null;
  // Los filtros rápidos (de la barra) se combinan siempre con AND; los avanzados siguen la lógica elegida.
  const quick = valid.filter((c) => c.quick).map(strip);
  const adv = valid.filter((c) => !c.quick).map(strip);
  const items: any[] = [...quick];
  if (adv.length) items.push({ logic: f.logic, items: adv });
  return { logic: "AND", items };
}
const strip = (c: Cond) => ({ col: c.col, op: c.op, value: c.value, value2: c.value2 });

export const EMPTY_LABEL = "(vacío)";
export type Dim = { col: string; grain?: string };

/** Convierte la clave de un grupo (p. ej. «2026-03», «2026-T1», «(vacío)») en una condición de filtro equivalente. */
export function keyToCond(ds: Dataset, dim: Dim, key: string): Cond | null {
  if (key === "Otros") return null;
  const type = dim.col === "_period" ? "category" : ds.columns.find((c) => c.name === dim.col)?.type || "text";
  if (key === EMPTY_LABEL) return { id: uid2(), col: dim.col, op: "isnull", quick: true };
  if (type === "date") {
    const pad = (n: number) => String(n).padStart(2, "0");
    const last = (y: number, m: number) => new Date(y, m, 0).getDate();
    let m: RegExpExecArray | null;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key))) return { id: uid2(), col: dim.col, op: "between", value: key, value2: key, quick: true };
    if ((m = /^(\d{4})-(\d{2})$/.exec(key))) return { id: uid2(), col: dim.col, op: "between", value: `${key}-01`, value2: `${key}-${pad(last(+m[1], +m[2]))}`, quick: true };
    if ((m = /^(\d{4})-T(\d)$/.exec(key))) { const y = +m[1], q = +m[2]; const m1 = (q - 1) * 3 + 1, m3 = q * 3; return { id: uid2(), col: dim.col, op: "between", value: `${y}-${pad(m1)}-01`, value2: `${y}-${pad(m3)}-${pad(last(y, m3))}`, quick: true }; }
    if ((m = /^(\d{4})$/.exec(key))) return { id: uid2(), col: dim.col, op: "between", value: `${key}-01-01`, value2: `${key}-12-31`, quick: true };
    return null;
  }
  if (type === "number") return { id: uid2(), col: dim.col, op: "eq", value: key, quick: true };
  return { id: uid2(), col: dim.col, op: "in", value: [key], quick: true };
}

/** Combina el filtro global (formato API) con condiciones adicionales de exploración (drill-down). */
export function withExtra(apiFilter: any, extra: Cond[]) {
  const items = extra.map(strip);
  if (!items.length) return apiFilter;
  return { logic: "AND", items: [...(apiFilter ? [apiFilter] : []), ...items] };
}
const uid2 = () => Math.random().toString(36).slice(2, 10);


export async function seedDemo(): Promise<{ dataset_id: string; total_rows: number }> {
  return api("/api/demo/seed", { method: "POST" });
}

export async function getRisks(datasetId: string, filters?: any) {
  return api(`/api/datasets/${datasetId}/risks`, { method: "POST", body: { filters } });
}

export async function askAI(datasetId: string, query: string, filters?: any) {
  return api(`/api/datasets/${datasetId}/ai/query`, { method: "POST", body: { query, filters } });
}

export async function generateReport(datasetId: string, opts: any = {}) {
  return api(`/api/datasets/${datasetId}/reports/generate`, { method: "POST", body: opts });
}

export function buildQueryString(params: Record<string, any>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== "Todos") {
      q.append(k, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function getReconciliationSummary(params: Record<string, any> = {}) {
  return api(`/api/reconciliation/summary${buildQueryString(params)}`);
}

export async function getReconciliationContracts(params: Record<string, any> = {}) {
  return api(`/api/reconciliation/contracts${buildQueryString(params)}`);
}

export async function getReconciliationItems(params: Record<string, any> = {}) {
  return api(`/api/reconciliation/items${buildQueryString(params)}`);
}

export async function getReconciliationDetails(params: Record<string, any> = {}) {
  return api(`/api/reconciliation/details${buildQueryString(params)}`);
}

export async function getReconciliationFilters() {
  return api("/api/reconciliation/filters");
}

export async function getReconciliationFiles() {
  return api("/api/reconciliation/files");
}

export async function processReconciliation(bodyOrForm: { file_path?: string; upload_id?: string; sheet_name?: string } | FormData) {
  if (bodyOrForm instanceof FormData) {
    return api("/api/reconciliation/process", { method: "POST", form: bodyOrForm });
  }
  return api("/api/reconciliation/process", { method: "POST", body: bodyOrForm });
}


