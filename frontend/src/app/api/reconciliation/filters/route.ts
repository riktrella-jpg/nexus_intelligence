import { NextResponse } from "next/server";
import contractsData from "@/lib/data/contracts.json";

export async function GET() {
  const instsSet = new Set<string>();
  const provsSet = new Set<string>();

  for (const c of contractsData as any[]) {
    if (c.institucion) instsSet.add(c.institucion);
    if (c.proveedor) provsSet.add(c.proveedor);
  }

  const instituciones = Array.from(instsSet).sort();
  const proveedores = Array.from(provsSet).sort().slice(0, 300);
  const estados = ["INFERIDO_COMPLETO", "PARCIAL_CON_PENDIENTES", "PENDIENTE_TOTAL"];
  const estados_detalle = ["INFERIDO_PARTIDA", "DUPLICADO_NO_SUMAR", "PENDIENTE", "PENDIENTE_DUPLICADO"];

  return NextResponse.json({
    instituciones,
    proveedores,
    estados,
    estados_detalle,
  });
}
