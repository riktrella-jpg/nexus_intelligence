import { NextResponse } from "next/server";
import contractsData from "@/lib/data/contracts.json";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const offset = parseInt(body.offset || "0", 10);
    const limit = parseInt(body.limit || "50", 10);

    const items = (contractsData as any[]).slice(offset, offset + limit).map((c, i) => ({
      _row_id: offset + i + 1,
      _period: "2026-09",
      INSTITUCION: c.institucion || "HGMEL",
      NUMERO_CONTRATO: c.contrato || "",
      PROVEEDOR: c.proveedor || "",
      CLAVE: "010.000.1234.00",
      DESCRIPCION: c.razon || "Partida contractual",
      CANTIDAD: c.filas || 1,
      PRECIO_UNITARIO: 100.0,
      IMPORTE_NETO: parseFloat(c.monto_inferido || "0")
    }));

    return NextResponse.json({
      rows: items,
      total: (contractsData as any[]).length,
      limit,
      offset,
      ms: 12
    });
  } catch (e: any) {
    return NextResponse.json({ rows: [], total: 0, limit: 50, offset: 0, ms: 0 });
  }
}

