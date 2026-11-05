import { NextRequest, NextResponse } from "next/server";
import { previewWorkbookBuffer } from "@/lib/oicEngineServer";

export const runtime = "nodejs";

function validateCutoffDate(fechaCorte: string): string {
  const m = (fechaCorte || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new Error("La fecha de corte debe tener formato AAAA-MM-DD.");
  }
  const yr = Number(m[1]);
  if (yr < 2015 || yr > 2035) {
    throw new Error("La fecha de corte debe ubicarse entre 2015 y 2035.");
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const fechaCorteRaw = String(formData.get("fecha_corte") || "2026-10-31");
    let cutoffIso: string;
    try {
      cutoffIso = validateCutoffDate(fechaCorteRaw);
    } catch (err: unknown) {
      return NextResponse.json(
        { detail: err instanceof Error ? err.message : "Fecha inválida" },
        { status: 422 }
      );
    }

    const uploadedFiles = [
      ...formData.getAll("files"),
      ...formData.getAll("archivos"),
    ].filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);

    if (uploadedFiles.length === 0 || uploadedFiles.length > 25) {
      return NextResponse.json(
        { detail: "Carga de 1 a 25 libros XLSX por solicitud." },
        { status: 422 }
      );
    }

    const records = [];
    const errors = [];

    for (const file of uploadedFiles) {
      const name = file.name || "archivo.xlsx";
      if (!name.toLowerCase().endsWith(".xlsx")) {
        errors.push({ archivo: name, error: "Todos los archivos deben tener extensión .xlsx." });
        continue;
      }
      try {
        const ab = await file.arrayBuffer();
        if (ab.byteLength > 25 * 1024 * 1024) {
          errors.push({ archivo: name, error: `El archivo ${name} supera 25 MB.` });
          continue;
        }
        const buf = Buffer.from(ab);
        const { record } = previewWorkbookBuffer(buf, name, cutoffIso);
        records.push(record);
      } catch (ex: unknown) {
        errors.push({
          archivo: name,
          error: (ex instanceof Error ? ex.message : String(ex)).slice(0, 400),
        });
      }
    }

    if (records.length === 0) {
      return NextResponse.json(
        { detail: { mensaje: "No fue posible analizar los archivos", errores: errors } },
        { status: 422 }
      );
    }

    return NextResponse.json({
      fecha_corte: cutoffIso,
      archivos: records,
      errores: errors,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Error interno al previsualizar rescisiones." },
      { status: 500 }
    );
  }
}
