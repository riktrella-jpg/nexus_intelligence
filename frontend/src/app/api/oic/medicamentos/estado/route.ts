import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    modulo: "MEDICAMENTOS",
    estado: "ARQUITECTURA_PREPARADA",
    independiente_de_rescisiones: true,
    infraestructura_compartida: [
      "ooxml_rescision.py / oicEngineServer.ts (lectura XML nativa sin alterar hojas originales)",
      "generar_hoja_oic.py / buildMirrorWorkbookInMemory (hoja espejo REVISION OIC con columnas Inconsistencia_n y resaltado #FFFF00)",
      "verificar_excel.py (comprobación byte por byte de hojas originales y autofiltros)",
    ],
    campos_previstos: [
      "clave",
      "descripcion",
      "contrato",
      "proveedor",
      "cantidad_minima",
      "cantidad_maxima",
      "cantidad_entregada",
      "precio_unitario",
      "monto_maximo",
      "registro_sanitario",
      "caducidad",
    ],
  });
}
