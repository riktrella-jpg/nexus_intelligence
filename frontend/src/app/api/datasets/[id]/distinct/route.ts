import { NextResponse } from "next/server";
import institutionSummaryData from "@/lib/data/institution_summary.json";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const col = (body.col || "").toLowerCase();

    let values: string[] = [];
    if (col.includes("inst")) {
      values = (institutionSummaryData as any[]).map((it) => it.siglas).filter((s) => s !== "Total general");
    } else {
      values = ["HGMEL", "ISSSTE", "IMSS", "IMSS-BIENESTAR", "CCINSHAE"];
    }

    return NextResponse.json({
      col: body.col || "col",
      values: values.map((v) => ({ value: v, count: 100 })),
      total_distinct: values.length
    });
  } catch (e: any) {
    return NextResponse.json({ col: "", values: [], total_distinct: 0 });
  }
}

