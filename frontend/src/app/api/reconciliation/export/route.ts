import { NextResponse } from "next/server";
import contractsData from "@/lib/data/contracts.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.toLowerCase();
  const institucion = searchParams.get("institucion");
  const proveedor = searchParams.get("proveedor");
  const contrato = searchParams.get("contrato")?.toLowerCase();
  const estado = searchParams.get("estado");

  let items = [...(contractsData as any[])];

  if (search) {
    items = items.filter(
      (c) =>
        (c.contrato && c.contrato.toLowerCase().includes(search)) ||
        (c.proveedor && c.proveedor.toLowerCase().includes(search)) ||
        (c.institucion && c.institucion.toLowerCase().includes(search))
    );
  }
  if (institucion && institucion !== "Todos") items = items.filter((c) => c.institucion === institucion);
  if (proveedor && proveedor !== "Todos") items = items.filter((c) => c.proveedor === proveedor);
  if (contrato) items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contrato));
  if (estado && estado !== "Todos") items = items.filter((c) => c.estado === estado);

  const headers = [
    "grupo_contrato",
    "institucion",
    "contrato",
    "proveedor",
    "filas",
    "partidas",
    "monto_inferido",
    "monto_revision",
    "pendientes",
    "estado",
    "razon",
  ];

  let csvContent = "\uFEFF" + headers.join(",") + "\n";
  for (const row of items) {
    const line = headers
      .map((h) => {
        const val = String(row[h] ?? "").replace(/"/g, '""');
        return `"${val}"`;
      })
      .join(",");
    csvContent += line + "\n";
  }

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="conciliacion_contratos.csv"',
    },
  });
}
