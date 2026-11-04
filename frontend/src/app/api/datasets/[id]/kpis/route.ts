import { NextResponse } from "next/server";
import summaryData from "@/lib/data/summary.json";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return NextResponse.json({
      kpis: [
        {
          id: "kpi_monto",
          label: "Monto Contratado Total",
          value: parseFloat(summaryData.monto_inferido_con_partidas_conciliadas || "1205182002.31"),
          format: "money",
          unit: "MXN",
          change: "+0.56%",
          trend: "neutral"
        },
        {
          id: "kpi_contratos",
          label: "Contratos Consolidados",
          value: summaryData.total_contratos || 668,
          format: "integer",
          unit: "contratos",
          change: "100%",
          trend: "up"
        },
        {
          id: "kpi_piezas",
          label: "Piezas Solicitadas",
          value: summaryData.piezas_solicitadas_total || 24500000,
          format: "integer",
          unit: "pzas",
          change: "+12.4%",
          trend: "up"
        }
      ],
      ms: 10
    });
  } catch (e: any) {
    return NextResponse.json({ kpis: [], ms: 0 });
  }
}

