import { NextResponse } from "next/server";
import conciliacionData from "@/lib/data/conciliacion_contratos.json";
import resumenV4Data from "@/lib/data/resumen_v4.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.toLowerCase();
  const institucion = searchParams.get("institucion");
  const proveedor = searchParams.get("proveedor");
  const contrato = searchParams.get("contrato")?.toLowerCase();
  const estado = searchParams.get("estado");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("page_size") || "50", 10);
  const sortBy = searchParams.get("sort_by") || "diferencia_automatico_menos_referencia";
  const sortDir = searchParams.get("sort_dir") || "desc";

  let items = [...(conciliacionData as any[])];

  // Filtros
  if (institucion && institucion !== "Todos") {
    items = items.filter((c) => c.institucion && c.institucion.toUpperCase() === institucion.toUpperCase());
  }
  if (proveedor && proveedor !== "Todos") {
    items = items.filter((c) => c.proveedor && c.proveedor.toUpperCase() === proveedor.toUpperCase());
  }
  if (contrato) {
    items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contrato));
  }
  if (estado && estado !== "Todos") {
    items = items.filter((c) => c.estado === estado);
  }
  if (search) {
    items = items.filter(
      (c) =>
        (c.contrato && c.contrato.toLowerCase().includes(search)) ||
        (c.proveedor && c.proveedor.toLowerCase().includes(search)) ||
        (c.institucion && c.institucion.toLowerCase().includes(search)) ||
        (c.alertas_motor_v3 && c.alertas_motor_v3.toLowerCase().includes(search))
    );
  }

  // Métricas agregadas sobre el conjunto filtrado
  let sumRef = 0;
  let sumAuto = 0;
  let conDiferencia = 0;
  let coincidentes = 0;

  for (const r of items) {
    const ref = parseFloat(r.monto_referencia) || 0;
    const auto = parseFloat(r.monto_calculo_automatico) || 0;
    sumRef += ref;
    sumAuto += auto;
    if (r.estado === "DIFERENCIA") conDiferencia++;
    else coincidentes++;
  }

  // Ordenamiento
  items.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];

    if (
      sortBy === "monto_referencia" ||
      sortBy === "monto_calculo_automatico" ||
      sortBy === "diferencia_automatico_menos_referencia"
    ) {
      valA = Math.abs(parseFloat(valA) || 0);
      valB = Math.abs(parseFloat(valB) || 0);
      return sortDir === "asc" ? valA - valB : valB - valA;
    }

    const strA = String(valA || "").toLowerCase();
    const strB = String(valB || "").toLowerCase();
    return sortDir === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
  });

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const pagedItems = items.slice(offset, offset + pageSize);

  return NextResponse.json({
    items: pagedItems,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    summary: {
      monto_contratado_conciliado: Math.round(sumRef * 100) / 100,
      monto_contratado_estimado_v3: Math.round(sumAuto * 100) / 100,
      diferencia_total: Math.round((sumAuto - sumRef) * 100) / 100,
      total_contratos: total,
      contratos_coincidentes: coincidentes,
      contratos_con_diferencias: conDiferencia,
      meta_global: resumenV4Data,
    },
  });
}
