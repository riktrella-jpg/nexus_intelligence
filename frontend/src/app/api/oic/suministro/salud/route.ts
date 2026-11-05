import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/oicSuministroEngineServer";

export const runtime = "nodejs";

export async function GET() {
  const cat = loadCatalog();
  return NextResponse.json({
    estado: "activo",
    motor: "suministro_dual",
    version: "2.0.0",
    tipos: ["MEDICAMENTOS", "MATERIAL DE CURACIÓN"],
    reglas_ae_au: 17,
    controles_transversales: 11,
    controles_especificos: 3,
    claves_cnis: Object.keys(cat).length,
  });
}

