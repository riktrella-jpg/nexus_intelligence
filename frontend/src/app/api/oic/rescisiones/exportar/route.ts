import { NextRequest, NextResponse } from "next/server";
import {
  previewWorkbookBuffer,
  buildMirrorWorkbookInMemory,
  writeZipBuffer,
  ZipEntry,
} from "@/lib/oicEngineServer";

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

function safeStem(filename: string, index: number, total: number): string {
  const base = (filename || "archivo.xlsx").replace(/\\/g, "/").split("/").pop() || "archivo.xlsx";
  const clean = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.xlsx$/i, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 80) || "archivo";
  return total > 1 ? `${String(index).padStart(2, "0")}_${clean}` : clean;
}

function csvCell(val: unknown): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const fechaCorteRaw = String(formData.get("fecha_corte") || "2026-10-31");
    const formato = String(formData.get("formato") || "auto").toLowerCase();

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

    const generatedFiles: { name: string; data: Buffer; summaryRow: (string | number)[] }[] = [];
    const errors: { archivo: string; error: string }[] = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      const origName = file.name || `archivo_${i + 1}.xlsx`;
      if (!origName.toLowerCase().endsWith(".xlsx")) {
        errors.push({ archivo: origName, error: "Extensión no válida (debe ser .xlsx)" });
        continue;
      }
      try {
        const ab = await file.arrayBuffer();
        const buf = Buffer.from(ab);
        const { record, entry, findings } = previewWorkbookBuffer(buf, origName, cutoffIso);
        const outBuf = buildMirrorWorkbookInMemory(buf, entry, findings);
        const stem = safeStem(origName, i + 1, uploadedFiles.length);
        const outName = `${stem}_REVISION_OIC.xlsx`;
        const maxIncRow = Math.max(
          1,
          ...Object.values(
            findings.reduce<Record<number, number>>((acc, f) => {
              acc[f.row] = (acc[f.row] || 0) + 1;
              return acc;
            }, {})
          )
        );
        generatedFiles.push({
          name: outName,
          data: outBuf,
          summaryRow: [
            origName,
            outName,
            record.hoja,
            cutoffIso,
            record.registros,
            record.filas_observadas,
            record.inconsistencias,
            maxIncRow,
            record.por_gravedad.ERROR || 0,
            record.por_gravedad.REVISAR || 0,
            record.por_gravedad.DOCUMENTAL || 0,
            "REVISION OIC",
            "(tabla independiente con filtros)",
          ],
        });
      } catch (ex: unknown) {
        errors.push({
          archivo: origName,
          error: (ex instanceof Error ? ex.message : String(ex)).slice(0, 400),
        });
      }
    }

    if (generatedFiles.length === 0) {
      return NextResponse.json(
        { detail: { mensaje: "No se generó ningún archivo", errores: errors } },
        { status: 422 }
      );
    }

    if (generatedFiles.length === 1 && uploadedFiles.length === 1 && formato !== "zip") {
      const single = generatedFiles[0];
      return new NextResponse(new Uint8Array(single.data), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${single.name}"`,
        },
      });
    }

    const zipEntries: ZipEntry[] = generatedFiles.map((g) => ({
      name: g.name,
      data: g.data,
    }));

    const csvHeader = [
      "archivo",
      "salida",
      "hoja_origen",
      "fecha_corte",
      "registros",
      "filas_con_inconsistencia",
      "inconsistencias",
      "columnas_agregadas",
      "errores",
      "revisar",
      "documentales",
      "hoja_revision",
      "filtro",
    ];
    const csvLines = [
      "\uFEFF" + csvHeader.join(","),
      ...generatedFiles.map((g) => g.summaryRow.map(csvCell).join(",")),
    ];
    zipEntries.push({
      name: "RESUMEN_REVISION_OIC.csv",
      data: Buffer.from(csvLines.join("\r\n") + "\r\n", "utf8"),
    });

    if (errors.length > 0) {
      const errTxt = errors.map((e) => `${e.archivo}: ${e.error}`).join("\n");
      zipEntries.push({
        name: "ERRORES_REVISION.txt",
        data: Buffer.from(errTxt, "utf8"),
      });
    }

    const zipBuf = writeZipBuffer(zipEntries);
    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="Devoluciones_OIC_NEXUS.zip"',
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Error interno al exportar rescisiones." },
      { status: 500 }
    );
  }
}

