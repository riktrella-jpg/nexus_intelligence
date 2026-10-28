import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const filename = file?.name || "archivo.xlsx";
    const upload_id = "up_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

    return NextResponse.json({
      upload_id,
      filename,
      size: file?.size || 0,
      status: "staged",
    });
  } catch (e: any) {
    return NextResponse.json({ detail: e.message || "Error al subir archivo" }, { status: 400 });
  }
}
