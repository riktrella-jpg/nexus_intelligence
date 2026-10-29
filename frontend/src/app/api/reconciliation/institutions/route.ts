import { NextResponse } from "next/server";
import institutionSummaryData from "@/lib/data/institution_summary.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const institucion = searchParams.get("institucion");

  let items = institutionSummaryData as any[];
  if (institucion && institucion !== "Todos") {
    items = items.filter(
      (it) => it.siglas.toLowerCase() === institucion.toLowerCase() || it.siglas === "Total general"
    );
  }

  return NextResponse.json({
    items,
    total: items.length,
  });
}
