const nf0 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfc = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

export function fmt(v: any, kind: string = "auto"): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (kind === "money") return "$" + nf2.format(v);
    if (kind === "pct") return (v * 100).toFixed(1) + "%";
    if (kind === "int") return nf0.format(v);
    return Number.isInteger(v) ? nf0.format(v) : nf2.format(v);
  }
  return String(v);
}
export const compact = (v: number) => nfc.format(v);
export const money = (v: any) => fmt(v, "money");
export const num = (v: any) => fmt(v, "int");

export function fmtDate(ts?: number | string | null) {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: typeof ts === "number" ? "short" : undefined });
}
export function bytes(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
export const OPS: Record<string, string> = {
  eq: "es igual a", neq: "es distinto de", gt: "mayor que", gte: "mayor o igual a", lt: "menor que", lte: "menor o igual a",
  between: "entre", contains: "contiene", not_contains: "no contiene", startswith: "comienza con", in: "es uno de", not_in: "no es ninguno de",
  isnull: "está vacío", notnull: "no está vacío",
};
export const OPS_BY_TYPE: Record<string, string[]> = {
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isnull", "notnull"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "isnull", "notnull"],
  text: ["contains", "not_contains", "eq", "neq", "startswith", "in", "not_in", "isnull", "notnull"],
};
export const opsFor = (t: string) => OPS_BY_TYPE[t] || OPS_BY_TYPE.text;
export const uid = () => Math.random().toString(36).slice(2, 10);
