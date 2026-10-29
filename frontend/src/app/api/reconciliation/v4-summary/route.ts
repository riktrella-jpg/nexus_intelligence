import { NextResponse } from "next/server";
import resumenV4Data from "@/lib/data/resumen_v4.json";
import consolidadosData from "@/lib/data/montos_contratados_consolidados.json";

export async function GET() {
  // Comprobación de integridad de sumas en tiempo de ejecución
  const totalSuma = (consolidadosData as any[]).reduce(
    (acc, c) => acc + (parseFloat(c.monto_contratado_consolidado) || 0),
    0
  );
  const sumaExacta = Math.round(totalSuma * 100) / 100;

  return NextResponse.json({
    status: "ok",
    resumen: resumenV4Data,
    verificacion_suma_csv: {
      esperado: "1205182002.31",
      calculado: sumaExacta.toFixed(2),
      coincide: sumaExacta.toFixed(2) === "1205182002.31",
      contratos_count: consolidadosData.length,
    },
  });
}
