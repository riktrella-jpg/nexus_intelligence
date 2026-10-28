import { NextResponse } from "next/server";
import { parseAndReconcileExcel } from "@/lib/reconciliationEngine";

export async function POST(request: Request) {
  try {
    let buffer: ArrayBuffer | null = null;
    let fileName = "archivo.xlsx";

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ detail: "No se proporcionó ningún archivo en el formulario." }, { status: 400 });
      }
      fileName = file.name;
      buffer = await file.arrayBuffer();
    } else {
      const body = await request.json().catch(() => ({}));
      return NextResponse.json({
        status: "ok",
        message: "Operación procesada con éxito",
        body,
      });
    }

    if (!buffer || buffer.byteLength === 0) {
      return NextResponse.json({ detail: "El archivo cargado está vacío." }, { status: 400 });
    }

    const result = parseAndReconcileExcel(buffer, fileName);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error en proceso de conciliación V2:", error);
    return NextResponse.json({ detail: `Error al procesar el archivo Excel: ${error.message}` }, { status: 500 });
  }
}
