import { NextResponse } from "next/server";
import institutionSummaryData from "@/lib/data/institution_summary.json";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const items = (institutionSummaryData as any[])
      .filter((it) => it.siglas !== "Total general")
      .map((it) => ({
        key: it.siglas,
        label: it.siglas,
        value: it.monto_contratado || 0,
        count: it.registros || 0
      }));

    return NextResponse.json({
      groups: items,
      total_groups: items.length,
      metric_label: "Monto Contratado",
      ms: 15
    });
  } catch (e: any) {
    return NextResponse.json({ groups: [], total_groups: 0, metric_label: "", ms: 0 });
  }
}

