import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json([
    { id: "kpi_monto", label: "Monto Contratado Total", op: "sum", col: "IMPORTE_NETO" },
    { id: "kpi_contratos", label: "Total de Contratos", op: "count_distinct", col: "NUMERO_CONTRATO" },
    { id: "kpi_piezas", label: "Piezas Solicitadas", op: "sum", col: "CANTIDAD" }
  ]);
}

