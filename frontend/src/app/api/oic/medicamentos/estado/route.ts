import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/oicSuministroEngineServer";

export async function GET() {
  const cat = loadCatalog();
  return NextResponse.json({
    modulo: "MEDICAMENTOS_Y_MATERIAL_CURACION",
    estado: "ACTIVO",
    motor: "suministro_dual",
    version: "2.0.0",
    independiente_de_rescisiones: true,
    reglas_ae_au: 17,
    controles_transversales: 11,
    controles_especificos: 3,
    claves_cnis: Object.keys(cat).length,
    hojas_exportadas: ["base (intacta)", "REVISION OIC", "OBSERVACIONES OIC", "RESUMEN OIC"],
  });
}
