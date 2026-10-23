import { Dataset } from "./api";
import type { ChartSpec } from "@/components/ChartCard";
import { uid } from "./format";

const col = (ds: Dataset, role: string) => ds.columns.find((c) => c.role === role)?.name;

/** Gráficas sugeridas solo con las columnas realmente existentes (según roles aprobados o tipos detectados). */
export function autoCharts(ds: Dataset): ChartSpec[] {
  const out: ChartSpec[] = [];
  const amount = col(ds, "amount"), date = col(ds, "date") || ds.columns.find((c) => c.type === "date")?.name;
  const provider = col(ds, "provider"), inst = col(ds, "institution"), proc = col(ds, "procedure"), status = col(ds, "status");
  const category = col(ds, "category") || col(ds, "description");
  const q = col(ds, "quantity"), d = col(ds, "quantity_delivered");
  const measure = amount ? { metric: { op: "sum", col: amount }, kind: "money", label: `Monto (${amount})` } : { metric: { op: "count" }, kind: "int", label: "Registros" };
  const mk = (title: string, type: string, dimCol: string, over: Partial<ChartSpec> = {}): ChartSpec => ({
    id: uid(), title, type, metric: measure.metric, kind: measure.kind, dims: [{ col: dimCol }], topN: 10, sort: "desc", ...over,
  });
  if (date) out.push(mk(`Evolución mensual · ${measure.label}`, "area", date, { dims: [{ col: date, grain: "month" }], topN: 120, sort: "asc" }));
  if (provider) out.push(mk(`Principales proveedores · ${measure.label}`, "hbar", provider));
  if (provider && amount) out.push(mk("Concentración por proveedor (Pareto)", "pareto", provider, { topN: 12 }));
  if (inst) out.push(mk(`Por institución · ${measure.label}`, "pie", inst, { topN: 8, others: true }));
  if (proc) out.push(mk(`Por tipo de procedimiento · ${measure.label}`, "bar", proc, { topN: 8 }));
  if (provider && q && d) out.push({ id: uid(), title: "Piezas pendientes por proveedor", type: "hbar", metric: { op: "pending", qty: q, delivered: d }, kind: "int", dims: [{ col: provider }], topN: 10, sort: "desc",
    note: "Pendiente = máximo(solicitada − entregada, 0). Las entregas excedentes se reportan aparte." });
  if (category) out.push(mk(`Por categoría · ${measure.label}`, "treemap", category, { topN: 15 }));
  if (status) out.push(mk("Por estatus · registros", "bar", status, { metric: { op: "count" }, kind: "int" }));
  if (out.length === 0) {
    const cats = ds.columns.filter((c) => c.type === "category").slice(0, 3);
    cats.forEach((c) => out.push({ id: uid(), title: `Registros por ${c.name}`, type: "hbar", metric: { op: "count" }, kind: "int", dims: [{ col: c.name }], topN: 10, sort: "desc" }));
  }
  return out.slice(0, 6);
}
