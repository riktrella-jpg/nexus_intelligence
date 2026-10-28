import { NextResponse } from "next/server";
import contractsData from "@/lib/data/contracts.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.toLowerCase();
  const institucion = searchParams.get("institucion");
  const proveedor = searchParams.get("proveedor");
  const contrato = searchParams.get("contrato")?.toLowerCase();
  const estado = searchParams.get("estado");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("page_size") || "50", 10);
  const sortBy = searchParams.get("sort_by") || "monto_inferido";
  const sortDir = searchParams.get("sort_dir") || "desc";

  let items = [...(contractsData as any[])];

  if (search) {
    items = items.filter(
      (c) =>
        (c.contrato && c.contrato.toLowerCase().includes(search)) ||
        (c.proveedor && c.proveedor.toLowerCase().includes(search)) ||
        (c.institucion && c.institucion.toLowerCase().includes(search)) ||
        (c.razon && c.razon.toLowerCase().includes(search))
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

  if (estado && estado !== "Todos") {
    items = items.filter((c) => c.estado === estado);
  }

  // Sort
  items.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    if (sortBy === "monto_inferido" || sortBy === "monto_revision" || sortBy === "filas" || sortBy === "partidas" || sortBy === "pendientes") {
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
