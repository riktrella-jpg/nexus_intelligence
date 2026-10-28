import * as XLSX from "xlsx";

function norm(x: any): string {
  if (x === null || x === undefined) return "";
  return String(x).normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

function num(x: any): number | null {
  if (x === null || x === undefined || x === "") return null;
  const s = String(x).replace(/[$,]/g, "").trim();
  const v = parseFloat(s);
  return isNaN(v) ? null : Math.round(v * 100) / 100;
}

function classify(monto: number | null, subtotal: number | null): string {
  if (monto === null || subtotal === null) return "DATOS_INSUFICIENTES";
  if (Math.abs(monto - subtotal) <= 0.02) return "COINCIDE_DIRECTO";
  if (Math.abs(monto - Math.round(subtotal * 1.16 * 100) / 100) <= 0.02) return "COMPATIBLE_IVA_16_NO_CONFIRMADO";
  return "NO_CONCILIADO";
}

function findColIndex(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").normalize("NFKC").trim();
    if (!h) continue;
    for (const pat of patterns) {
      if (pat.test(h)) return i;
    }
  }
  return -1;
}

export function parseAndReconcileExcel(arrayBuffer: ArrayBuffer, fileName: string = "archivo.xlsx") {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error("El archivo no contiene hojas de datos.");
  }

  // Priorizar hoja 'BASE', sino buscar la primera hoja
  let targetSheet = wb.SheetNames[0];
  for (const name of wb.SheetNames) {
    if (name.trim().toLowerCase() === "base") {
      targetSheet = name;
      break;
    }
  }

  const ws = wb.Sheets[targetSheet];
  const data2D = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });

  if (!data2D || data2D.length === 0) {
    throw new Error(`La hoja «${targetSheet}» no contiene filas de datos.`);
  }

  // Detectar fila de encabezados examinando las primeras 10 filas
  let headerRowIdx = -1;
  let colContrato = -1;
  let colInst = -1;
  let colUr = -1;
  let colProv = -1;
  let colClave = -1;
  let colDesc = -1;
  let colMonto = -1;
  let colCantidad = -1;
  let colPrecio = -1;

  for (let r = 0; r < Math.min(10, data2D.length); r++) {
    const row = (data2D[r] || []).map((v) => String(v || "").toLowerCase());
    const hasContrato = row.some((c) => /contrato|pedido|folio/i.test(c));
    const hasProv = row.some((c) => /proveedor|raz[oó]n\s*social|empresa/i.test(c));
    const hasMonto = row.some((c) => /monto|importe|total|precio/i.test(c));
    const hasClave = row.some((c) => /clave|cucop|medicamento|art[ií]culo|descripci[oó]n/i.test(c));

    let matchCount = 0;
    if (hasContrato) matchCount++;
    if (hasProv) matchCount++;
    if (hasMonto) matchCount++;
    if (hasClave) matchCount++;

    if (matchCount >= 2) {
      headerRowIdx = r;
      const rawHeaders = data2D[r].map((v) => String(v || ""));

      colContrato = findColIndex(rawHeaders, [/n[uú]m.*contrato/i, /no\..*contrato/i, /contrato/i, /pedido/i, /folio/i]);
      colInst = findColIndex(rawHeaders, [/instituci[oó]n/i, /dependencia/i, /siglas/i, /ente/i, /cliente/i]);
      colUr = findColIndex(rawHeaders, [/\bur\b/i, /cve_ur/i, /unidad\s*responsable/i, /area/i]);
      colProv = findColIndex(rawHeaders, [/proveedor/i, /raz[oó]n\s*social/i, /empresa/i, /licitante/i]);
      colClave = findColIndex(rawHeaders, [/clave/i, /cucop/i, /medicamento/i, /art[ií]culo/i, /c[oó]digo/i, /insumo/i]);
      colDesc = findColIndex(rawHeaders, [/descripci[oó]n/i, /concepto/i, /partida/i, /bien/i]);
      colMonto = findColIndex(rawHeaders, [/monto\s*contratado/i, /importe\s*total/i, /monto/i, /importe/i, /total/i, /subtotal/i]);
      colCantidad = findColIndex(rawHeaders, [/cantidad\s*solicitada/i, /cantidad\s*contratada/i, /cantidad/i, /piezas/i, /unidades/i, /volumen/i]);
      colPrecio = findColIndex(rawHeaders, [/precio\s*unitario/i, /costo\s*unitario/i, /precio/i, /p\.?u\.?/i]);
      break;
    }
  }

  // Si no se detectaron encabezados por nombre, usar layout estándar SSA (40+ cols)
  if (headerRowIdx === -1) {
    headerRowIdx = 1; // Suponer encabezados en fila 1-2
    colInst = 3;      // Col D
    colUr = 4;        // Col E
    colContrato = 7;  // Col H
    colProv = 10;     // Col K
    colMonto = 15;    // Col P
    colClave = 28;    // Col AC
    colDesc = 29;     // Col AD
    colCantidad = 35; // Col AJ
    colPrecio = 36;   // Col AK
  }

  const startRow = headerRowIdx + 1;
  const contratosMap = new Map<string, any[]>();
  let totalFilasFisicas = 0;

  for (let i = startRow; i < data2D.length; i++) {
    const row = data2D[i];
    if (!row || row.length === 0) continue;

    const inst = norm(colInst >= 0 ? row[colInst] : "INSTITUCIÓN GENERAL") || "INSTITUCIÓN GENERAL";
    const ur = norm(colUr >= 0 ? row[colUr] : "");
    let contrato = norm(colContrato >= 0 ? row[colContrato] : "");
    let prov = norm(colProv >= 0 ? row[colProv] : "PROVEEDOR GENERAL") || "PROVEEDOR GENERAL";

    const clave = norm(colClave >= 0 ? row[colClave] : "");
    const desc = norm(colDesc >= 0 ? row[colDesc] : "");
    let monto = num(colMonto >= 0 ? row[colMonto] : null);
    let cantidad = num(colCantidad >= 0 ? row[colCantidad] : null);
    let precio = num(colPrecio >= 0 ? row[colPrecio] : null);

    if (!contrato && !prov && monto === null) continue;

    if (!contrato) {
      contrato = `S/C-${inst.substring(0, 8)}-${prov.substring(0, 10)}`;
    }

    if (monto === null && cantidad !== null && precio !== null) {
      monto = Math.round(cantidad * precio * 100) / 100;
    }

    if (precio === null && monto !== null && cantidad !== null && cantidad > 0) {
      precio = Math.round((monto / cantidad) * 100) / 100;
    }

    let subtotal: number | null = null;
    let iva = "DATOS_INSUFICIENTES";

    if (cantidad !== null && precio !== null) {
      subtotal = Math.round(cantidad * precio * 100) / 100;
      iva = classify(monto, subtotal);
    } else if (monto !== null && monto > 0) {
      subtotal = monto;
      iva = "COINCIDE_DIRECTO";
    }

    const gid = `${inst}|${ur}|${contrato}|${prov}`;
    const partida = clave ? `${gid}|${clave}` : `${gid}|SIN_CLAVE|${desc || "ITEM"}`;

    const rec = {
      fila_excel: i + 1,
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

  if (totalFilasFisicas === 0) {
    throw new Error("No se identificaron contratos ni partidas válidas en las filas del archivo.");
  }

  // Deduplicación y cálculo según Motor V2
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
      // Agrupar por firma exacta Motor V2: partida|monto|cantidad|precio
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

        if (r0.monto === null || r0.monto < 0) {
          reconocido = null;
          estadoPartida = "PENDIENTE";
        } else if (r0.iva === "COINCIDE_DIRECTO" || r0.iva === "COMPATIBLE_IVA_16_NO_CONFIRMADO") {
          reconocido = r0.monto;
          estadoPartida = "INFERIDO_PARTIDA";
        } else if (r0.monto === 0 && r0.subtotal === 0) {
          reconocido = r0.monto;
          estadoPartida = "INFERIDO_PARTIDA";
        } else {
          reconocido = null;
          estadoPartida = "PENDIENTE";
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
          razones.push("Partida pendiente de validación aritmética");
        }
      }
    }

    montoContrato = Math.round(montoContrato * 100) / 100;
    revisionSum = Math.round(revisionSum * 100) / 100;

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
      razon: razones.length > 0 ? "Hay partidas con importes pendientes de revisión" : "Claves y firmas de partidas conciliadas aritméticamente",
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
      advertencia: "Resultados calculados con Motor V2 en tiempo real.",
    },
  };

  return {
    status: "ok",
    report: summary.meta,
    summary,
    contracts: contratosSalida,
  };
}
