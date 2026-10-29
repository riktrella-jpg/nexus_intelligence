import { NextResponse } from "next/server";
import pendientesData from "@/lib/data/pendientes.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.toLowerCase();
  const institucion = searchParams.get("institucion");
  const proveedor = searchParams.get("proveedor");
  const contrato = searchParams.get("contrato")?.toLowerCase();
  const clave = searchParams.get("clave")?.toLowerCase();
  const estado = searchParams.get("estado");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("page_size") || "50", 10);
  const sortBy = searchParams.get("sort_by") || "fila_excel";
  const sortDir = searchParams.get("sort_dir") || "asc";

  let items = [...(pendientesData as any[])];

  if (search) {
    items = items.filter(
      (c) =>
        (c.contrato && c.contrato.toLowerCase().includes(search)) ||
        (c.proveedor && c.proveedor.toLowerCase().includes(search)) ||
        (c.institucion && c.institucion.toLowerCase().includes(search)) ||
        (c.descripcion_original && c.descripcion_original.toLowerCase().includes(search)) ||
        (c.alertas && c.alertas.toLowerCase().includes(search))
    );
  }

  if (institucion && institucion !== "Todos") {
    items = items.filter((c) => c.institucion === institucion);
  }

  if (proveedor && proveedor !== "Todos") {
    items = items.filter((c) => c.proveedor === proveedor);
  }

  if (contrato) {
    items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contrato));
  }

  if (clave) {
    items = items.filter((c) => c.clave && c.clave.toLowerCase().includes(clave));
  }

  if (estado && estado !== "Todos") {
    items = items.filter((c) => c.estado === estado);
  }

  // Sort
  items.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    if (
      sortBy === "fila_excel" ||
      sortBy === "cantidad_contratada" ||
      sortBy === "precio_unitario" ||
      sortBy === "monto_reportado" ||
      sortBy === "monto_base_sin_iva" ||
      sortBy === "monto_depurado"
    ) {
      valA = parseFloat(valA) || 0;
      valB = parseFloat(valB) || 0;
      return sortDir === "asc" ? valA - valB : valB - valA;
    }
    const strA = String(valA || "").toLowerCase();
    const strB = String(valB || "").toLowerCase();
    return sortDir === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
  });

  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  const paginated = items.slice(offset, offset + pageSize);

  return NextResponse.json({
    items: paginated,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
  });
}
