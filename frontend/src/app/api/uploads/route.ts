import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

// Almacenamiento en memoria para previews de subidas en la misma sesión
const uploadCache = new Map<string, { filename: string; buffer: Buffer; sheets: string[] }>();

export function getUploadFromCache(uploadId: string) {
  return uploadCache.get(uploadId);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ detail: "No se proporcionó ningún archivo." }, { status: 400 });
    }

    const filename = file.name || "archivo.xlsx";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let sheets = ["Hoja1"];
    try {
      const wb = XLSX.read(buffer, { type: "buffer" });
      if (wb.SheetNames && wb.SheetNames.length > 0) {
        sheets = wb.SheetNames;
      }
    } catch {}

    const upload_id = "up_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
    uploadCache.set(upload_id, { filename, buffer, sheets });

    return NextResponse.json({
      upload_id,
      filename,
      size: buffer.length,
      format: filename.endsWith(".csv") ? "csv" : "xlsx",
      sheets,
      status: "staged",
    });
  } catch (e: any) {
    return NextResponse.json({ detail: e.message || "Error al subir archivo" }, { status: 400 });
  }
}
