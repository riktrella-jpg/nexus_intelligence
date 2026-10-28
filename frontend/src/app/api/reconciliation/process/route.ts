import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

function norm(x: any): string {
  if (x === null || x === undefined) return "";
  return String(x).normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

function num(x: any): number | null {
  if (x === null || x === undefined || x === "") return null;
  const s = String(x).replace(/,/g, "").trim();
  const v = parseFloat(s);
  return isNaN(v) ? null : Math.round(v * 100) / 100;
}

function classify(monto: number | null, subtotal: number | null): string {
  if (monto === null || subtotal === null) return "DATOS_INSUFICIENTES";
  if (Math.abs(monto - subtotal) <= 0.02) return "COINCIDE_DIRECTO";
  if (Math.abs(monto - Math.round(subtotal * 1.16 * 100) / 100) <= 0.02) return "COMPATIBLE_IVA_16_NO_CONFIRMADO";
  return "NO_CONCILIADO";
}

export async function POST(request: Request) {
  try {
    let buffer: Buffer | null = null;
    let fileName = "archivo.xlsx";

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ detail: "No se proporcionó ningún archivo en el formulario." }, { status: 400 });
      }
      fileName = file.name;
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      // Intento leer JSON body
      const body = await request.json().catch(() => ({}));
      return NextResponse.json({
        status: "ok",
        message: "Operación procesada con éxito",
        body,
      });
    }

    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ detail: "El archivo cargado está vacío." }, { status: 400 });
    }

    // Leer libro Excel
    const wb = XLSX.read(buffer, { type: "buffer" });
    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      return NextResponse.json({ detail: "El libro Excel no contiene hojas." }, { status: 400 });
    }

    // Buscar hoja "BASE" o primera hoja
    let sheetName = wb.SheetNames[0];
    for (const name of wb.SheetNames) {
      if (name.trim().toLowerCase() === "base") {
        sheetName = name;
        break;
      }
    }

    const ws = wb.Sheets[sheetName];
    // Convertir a matriz con claves de columna letra (A, B, C...)
    const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { header: "A", defval: "" });

    // Filtrar filas válidas (omitir encabezados o filas vacías)
    const contratosMap = new Map<string, any[]>();
    let totalFilasFisicas = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rNum = i + 1;
      if (rNum < 2) continue; // Omitir primera fila

      const inst = norm(row["D"] || row["institucion"] || "");
      const ur = norm(row["E"] || row["ur"] || "");
      const contrato = norm(row["H"] || row["contrato"] || "");
      const prov = norm(row["K"] || row["proveedor"] || "");

      // Si no tiene número de contrato o proveedor, saltar fila
      if (!contrato && !inst) continue;

      const clave = norm(row["AC"] || row["clave"] || "");
      const desc = norm(row["AD"] || row["descripcion"] || "");
      const monto = num(row["P"] || row["monto"]);
      const cantidad = num(row["AJ"] || row["cantidad"]);
      const precio = num(row["AK"] || row["precio"]);

      const subtotal = cantidad !== null && precio !== null ? Math.round(cantidad * precio * 100) / 100 : null;
      const iva = classify(monto, subtotal);

      const gid = `${inst}|${ur}|${contrato}|${prov}`;
      const partida = clave ? `${gid}|${clave}` : `${gid}|SIN_CLAVE|${desc}`;

      const rec = {
        fila_excel: rNum,
        institucion: inst,
        ur,
        contrato,
        proveedor: prov,
        clave,
        descripcion: desc,
        monto,
        cantidad,
        precio,
        subtotal,
        iva,
        gid,
        partida,
      };

      if (!contratosMap.has(gid)) {
        contratosMap.set(gid, []);
      }
      contratosMap.get(gid)!.push(rec);
      totalFilasFisicas++;
    }

    // Aplicar deduplicación y reglas V2
    const contratosSalida: any[] = [];
    let montoInferidoGlobal = 0;
    let montoRevisionGlobal = 0;
    let filasDuplicadasExcluidas = 0;
    let filasInferidas = 0;
    let filasPendientes = 0;
    let totalPartidasCandidatas = 0;
    let contratosCompletos = 0;
    let contratosParciales = 0;
    let contratosPendientes = 0;

    for (const [gid, recs] of contratosMap.entries()) {
      const byPart = new Map<string, any[]>();
      for (const r of recs) {
        if (!byPart.has(r.partida)) byPart.set(r.partida, []);
        byPart.get(r.partida)!.push(r);
      }

      let montoContrato = 0;
      let pendientes = 0;
      let revisionSum = 0;
      let razones: string[] = [];
      let partesTotal = 0;

      for (const [p, rr] of byPart.entries()) {
        // Agrupar por firma exacta
        const firmas = new Map<string, any[]>();
        for (const r of rr) {
          const f = `${r.partida}|${r.monto ?? ""}|${r.cantidad ?? ""}|${r.precio ?? ""}`;
          if (!firmas.has(f)) firmas.set(f, []);
          firmas.get(f)!.push(r);
        }

        for (const [firma, fls] of firmas.entries()) {
          partesTotal++;
          totalPartidasCandidatas++;
          const r0 = fls[0];
          let reconocido: number | null = null;
          let estadoPartida = "PENDIENTE";
          let motivo = "";

          if (r0.monto === null || r0.monto < 0) {
            reconocido = null;
            estadoPartida = "PENDIENTE";
            motivo = "Importe ausente o negativo";
          } else if (r0.iva === "COINCIDE_DIRECTO" || r0.iva === "COMPATIBLE_IVA_16_NO_CONFIRMADO") {
            reconocido = r0.monto;
            estadoPartida = "INFERIDO_PARTIDA";
            motivo = "Monto conciliado con cantidad × precio; registros idénticos consolidados";
          } else if (r0.monto === 0 && r0.subtotal === 0) {
            reconocido = r0.monto;
            estadoPartida = "INFERIDO_PARTIDA";
            motivo = "Monto y subtotal en cero";
          } else {
            reconocido = null;
            estadoPartida = "PENDIENTE";
            motivo = "Importe no conciliado con cantidad × precio; posible total global o error";
          }

          if (reconocido !== null) {
            montoContrato += reconocido;
            filasInferidas++;
            if (fls.length > 1) {
              filasDuplicadasExcluidas += fls.length - 1;
            }
          } else {
            pendientes++;
            filasPendientes += fls.length;
            if (r0.monto !== null) revisionSum += r0.monto;
            razones.push("Hay partidas no conciliadas");
          }
        }
      }

      montoInferidoGlobal += montoContrato;
      montoRevisionGlobal += revisionSum;

      const estado =
        pendientes === 0
          ? "INFERIDO_COMPLETO"
          : montoContrato > 0
          ? "PARCIAL_CON_PENDIENTES"
          : "PENDIENTE_TOTAL";

      if (estado === "INFERIDO_COMPLETO") contratosCompletos++;
      else if (estado === "PARCIAL_CON_PENDIENTES") contratosParciales++;
      else contratosPendientes++;

      const primero = recs[0];
      contratosSalida.push({
        grupo_contrato: gid,
        institucion: primero.institucion,
        contrato: primero.contrato,
        proveedor: primero.proveedor,
        filas: String(recs.length),
        partidas: String(partesTotal),
        monto_inferido: montoContrato ? montoContrato.toFixed(2) : "",
        monto_revision: revisionSum ? revisionSum.toFixed(2) : "",
        pendientes: String(pendientes),
        estado,
        razon: razones.length > 0 ? "Hay partidas no conciliadas" : "Claves y firmas de partidas conciliadas aritméticamente",
      });
    }

    // Ordenar contratos por monto_inferido desc
    contratosSalida.sort((a, b) => (parseFloat(b.monto_inferido) || 0) - (parseFloat(a.monto_inferido) || 0));

    const summary = {
      has_data: true,
      total_filas: totalFilasFisicas,
      monto_inferido_total: Math.round(montoInferidoGlobal * 100) / 100,
      monto_revision_total: Math.round(montoRevisionGlobal * 100) / 100,
      total_contratos: contratosSalida.length,
      contratos_completos: contratosCompletos,
      contratos_parciales: contratosParciales,
      contratos_pendientes: contratosPendientes,
      filas_duplicadas_excluidas: filasDuplicadasExcluidas,
      filas_inferidas: filasInferidas,
      filas_pendientes: filasPendientes,
      partidas_candidatas: totalPartidasCandidatas,
      meta: {
        archivo: fileName,
        filas: totalFilasFisicas,
        grupos_contractuales: contratosSalida.length,
        partidas_candidatas: totalPartidasCandidatas,
        monto_inferido_con_partidas_conciliadas: montoInferidoGlobal.toFixed(2),
      },
    };

    return NextResponse.json({
      status: "ok",
      report: summary.meta,
      summary,
      contracts: contratosSalida,
    });
  } catch (error: any) {
    console.error("Error en proceso de conciliación V2:", error);
    return NextResponse.json({ detail: `Error al procesar el archivo Excel: ${error.message}` }, { status: 500 });
  }
}
