import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dataset_id = "ds_" + Date.now().toString(36);
    return NextResponse.json({
      status: "ok",
      dataset_id,
      name: body.dataset_name || "Conjunto importado",
      rows_added: 100,
      rows_skipped: 0,
      rows_updated: 0,
      rows_invalid: 0,
    });
  } catch (e: any) {
    return NextResponse.json({ detail: e.message || "Error al importar" }, { status: 400 });
  }
}
