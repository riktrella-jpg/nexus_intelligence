import { NextResponse } from "next/server";
import contractsData from "@/lib/data/contracts.json";
import institutionSummaryData from "@/lib/data/institution_summary.json";
import pendientesData from "@/lib/data/pendientes.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const viewType = searchParams.get("view_type") || "contratos";
  const search = searchParams.get("search")?.toLowerCase();
  const institucion = searchParams.get("institucion");
  const proveedor = searchParams.get("proveedor");
  const contrato = searchParams.get("contrato")?.toLowerCase();
  const estado = searchParams.get("estado");

  if (viewType === "pendientes") {
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
    if (institucion && institucion !== "Todos") items = items.filter((c) => c.institucion === institucion);
    if (proveedor && proveedor !== "Todos") items = items.filter((c) => c.proveedor === proveedor);
    if (contrato) items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contrato));
    if (estado && estado !== "Todos") items = items.filter((c) => c.estado === estado);

    const headers = [
      "fila_excel",
      "institucion",
      "contrato",
      "proveedor",
      "clave",
      "descripcion_original",
      "cantidad_contratada",
      "precio_unitario",
      "monto_reportado",
      "monto_base_sin_iva",
      "tipo_clave",
      "iva",
      "estado",
      "duplicado_de_fila",
      "monto_depurado",
      "alertas",
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
        "Content-Disposition": 'attachment; filename="pendientes_revision.csv"',
      },
    });
  }

  if (viewType === "instituciones") {
    let items = [...(institutionSummaryData as any[])];
    if (institucion && institucion !== "Todos") {
      items = items.filter(
        (it) => it.siglas.toLowerCase() === institucion.toLowerCase() || it.siglas === "Total general"
      );
    }
    if (search) {
      items = items.filter((it) => it.siglas.toLowerCase().includes(search));
    }

    const headers = [
      "Institución",
      "Registros",
      "Proveedores",
      "Contratos",
      "Monto Contratado",
      "Monto Ejercido",
      "% Ejercido",
      "Cantidad Contratada (pzas)",
      "Piezas Solicitadas",
      "Piezas Suministradas",
      "% Suministro",
    ];

    let csvContent = "\uFEFF" + headers.join(",") + "\n";
    for (const r of items) {
      const line = [
        `"${r.siglas}"`,
        r.registros,
        r.proveedores,
        r.contratos,
        r.monto_contratado,
        r.monto_ejercido,
        `"${r.pct_ejercido}%"`,
        r.cantidad_contratada,
        r.piezas_solicitadas,
        r.piezas_suministradas,
        `"${r.pct_suministro}%"`,
      ].join(",");
      csvContent += line + "\n";
    }

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="resumen_institucional_layout.csv"',
      },
    });
  }

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
  if (institucion && institucion !== "Todos") items = items.filter((c) => c.institucion === institucion);
  if (proveedor && proveedor !== "Todos") items = items.filter((c) => c.proveedor === proveedor);
  if (contrato) items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contrato));
  if (estado && estado !== "Todos") items = items.filter((c) => c.estado === estado);

  const headers = [
    "institucion",
    "contrato",
    "proveedor",
    "filas",
    "partidas",
    "monto_inferido",
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
      "Content-Disposition": 'attachment; filename="resumen_contratos.csv"',
    },
  });
}
