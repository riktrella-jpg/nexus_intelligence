import { NextRequest, NextResponse } from "next/server";
import { reviewSuministroBuffer } from "@/lib/oicSuministroEngineServer";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const archivo = formData.get("archivo") || formData.get("file");
    if (!archivo || typeof archivo !== "object" || !("arrayBuffer" in archivo)) {
      return NextResponse.json({ detail: "Falta el archivo Excel (.xlsx)." }, { status: 400 });
    }
    const file = archivo as File;
    if (!(file.name || "").toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ detail: "El layout debe ser Excel .xlsx" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ detail: "El Excel excede 100 MB comprimidos" }, { status: 413 });
    }

    const fechaCorte = String(formData.get("fecha_corte") || "2026-10-31").trim();
    const modo = String(formData.get("modo") || "ambos").trim();
    const hojaRaw = String(formData.get("hoja") || "").trim();
    const diasPendiente = Number(formData.get("dias_pendiente") ?? 15);
    const toleranciaContratado = String(formData.get("tolerancia_contratado") ?? "1").trim();
    const toleranciaEjercido = String(formData.get("tolerancia_ejercido") ?? "0.01").trim();
    const valAdicRaw = String(formData.get("validaciones_adicionales") ?? "true").toLowerCase();
    const extras = valAdicRaw !== "false" && valAdicRaw !== "0";

    const buf = Buffer.from(await file.arrayBuffer());
    const { buffer: outBuf, summary } = reviewSuministroBuffer(buf, fechaCorte, {
      modo,
      sheet: hojaRaw || null,
      dias_pendiente: diasPendiente,
      tolerancia_contratado: toleranciaContratado,
      tolerancia_ejercido: toleranciaEjercido,
      extras,
    });

    const med = summary.por_tipo?.["MEDICAMENTOS"]?.registros ?? 0;
    const mat = summary.por_tipo?.["MATERIAL DE CURACIÓN"]?.registros ?? 0;

    return new NextResponse(new Uint8Array(outBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="NEXUS_REVISION_OIC_SUMINISTRO.xlsx"',
        "X-OIC-Registros": String(summary.registros),
        "X-OIC-Medicamentos": String(med),
        "X-OIC-Material": String(mat),
        "X-OIC-Hallazgos": String(summary.hallazgos),
        "X-OIC-Errores": String(summary.errores),
        "X-OIC-Revisar": String(summary.revisar),
        "X-OIC-Informativos": String(summary.informativos),
        "X-OIC-OK": String(summary.ok),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Fallo al analizar el layout.";
    return NextResponse.json({ detail: msg }, { status: 422 });
  }
}

