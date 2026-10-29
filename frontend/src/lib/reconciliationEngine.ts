import * as XLSX from "xlsx";

function normalizar(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\u00a0/g, " ").toUpperCase();
  return s.trim().split(/\s+/).join(" ");
}

function parseDecimal(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/[$,]/g, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function esGenerica(clave: string): boolean {
  const c = normalizar(clave);
  return !c || ["N/A", "NA", "SIN CLAVE", "SIN CLAVE DEL CNIS", "NO APLICA", "S/C"].includes(c);
}

function firmaDescripcion(texto: any): string {
  // Solo normalización tipográfica, sin borrar números, calibres, tamaños o presentación
  return normalizar(texto).replace(/[^A-Z0-9]+/g, " ").trim();
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
    if (name.trim().toUpperCase() === "BASE" || name.toUpperCase().includes("BASE")) {
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

  // Si no se detectaron encabezados por nombre, usar layout estándar SSA (columnas fijas BASE)
  // Col D=3, E=4, H=7, K=10, P=15, AC=28, AD=29, AJ=35, AK=36
  if (headerRowIdx === -1) {
    headerRowIdx = 1;
    colInst = 3;
    colUr = 4;
    colContrato = 7;
    colProv = 10;
    colMonto = 15;
    colClave = 28;
    colDesc = 29;
    colCantidad = 35;
    colPrecio = 36;
  }

  const startRow = headerRowIdx + 1;
  const vistos = new Map<string, number>();
  const grupos = new Map<string, number[]>();
  const detalles: any[] = [];
  const resumen = new Map<string, any>();

  for (let i = startRow; i < data2D.length; i++) {
    const row = data2D[i];
    if (!row || row.length === 0) continue;

    const fila = i + 1;
    const inst = normalizar(colInst >= 0 ? row[colInst] : row[3]);
    const contrato = normalizar(colContrato >= 0 ? row[colContrato] : row[7]);
    const prov = normalizar(colProv >= 0 ? row[colProv] : row[10]);
    const clave = normalizar(colClave >= 0 ? row[colClave] : (row[28] || row[16]));
    const rawDesc = String(colDesc >= 0 ? row[colDesc] : (row[29] || row[17]) || "");
    const desc = firmaDescripcion(rawDesc);

    const cantidad = parseDecimal(colCantidad >= 0 ? row[colCantidad] : (row[35] || row[18]));
    const precio = parseDecimal(colPrecio >= 0 ? row[colPrecio] : (row[36] || row[19]));
    const reportado = parseDecimal(colMonto >= 0 ? row[colMonto] : row[15]);

    const base = cantidad !== null && precio !== null ? Math.round(cantidad * precio * 100) / 100 : null;

    let iva = "SIN INFORMACION";
    if (base !== null && reportado !== null) {
      if (Math.abs(reportado - base) <= 0.02) {
        iva = "BASE SIN IVA";
      } else if (Math.abs(reportado - Math.round(base * 1.16 * 100) / 100) <= 0.02) {
        iva = "REPORTADO CON IVA 16%";
      } else {
        iva = "NO CONCILIA BASE NI IVA 16%";
      }
    }

    const sinClave = esGenerica(clave);

    const fingerprint = `${inst}|${contrato}|${prov}|${clave}|${desc}|${base ?? ""}|${cantidad ?? ""}|${precio ?? ""}`;
    const grupo = `${inst}|${contrato}|${prov}|${clave}|${base ?? ""}|${cantidad ?? ""}|${precio ?? ""}`;

    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo)!.push(detalles.length);

    const riesgo: string[] = [];
    if (!contrato) riesgo.push("SIN CONTRATO");
    if (base === null) riesgo.push("FALTA CANTIDAD/PRECIO");
    if (!desc) riesgo.push("SIN DESCRIPCION");
    if (iva === "NO CONCILIA BASE NI IVA 16%") riesgo.push("IVA/IMPORTE NO CONCILIA");
    if ((cantidad !== null && cantidad < 0) || (precio !== null && precio < 0)) riesgo.push("VALOR NEGATIVO");

    let primero: string | number = "";
    let estado = "";
    let aporte = 0;

    if (vistos.has(fingerprint)) {
      primero = vistos.get(fingerprint)!;
      estado = "REPETIDO MISMA PARTIDA";
      aporte = 0;
    } else if (base === null || !contrato || !desc || (cantidad !== null && cantidad < 0) || (precio !== null && precio < 0)) {
      primero = "";
      estado = "NO CUANTIFICABLE / REVISAR";
      aporte = 0;
    } else {
      vistos.set(fingerprint, fila);
      primero = "";
      estado = "PARTIDA CONTABILIZADA";
      aporte = base;
    }

    detalles.push({
      fila_excel: fila,
      institucion: inst,
      contrato,
      proveedor: prov,
      clave,
      descripcion_original: rawDesc,
      cantidad_contratada: cantidad !== null ? String(cantidad) : "0",
      precio_unitario: precio !== null ? String(precio) : "0",
      monto_reportado: reportado !== null ? reportado.toFixed(2) : "",
      monto_base_sin_iva: base !== null ? base.toFixed(2) : "",
      tipo_clave: sinClave ? "GENERICA" : "CNIS",
      iva,
      estado,
      duplicado_de_fila: primero,
      monto_depurado: aporte.toFixed(2),
      alertas: riesgo,
      _aporte: aporte,
    });
  }

  // Candidatos con misma clave, cantidad, precio e importe pero descripción diferente
  for (const inds of grupos.values()) {
    const descripciones = new Set(inds.map((i) => firmaDescripcion(detalles[i].descripcion_original)));
    if (descripciones.size > 1) {
      for (const i of inds) {
        if (!detalles[i].alertas.includes("POSIBLE IMPORTE GLOBAL REPETIDO ENTRE PARTIDAS")) {
          detalles[i].alertas.push("POSIBLE IMPORTE GLOBAL REPETIDO ENTRE PARTIDAS");
        }
      }
    }
  }

  // Resumen por contrato
  for (const row of detalles) {
    const k = `${row.institucion}|${row.contrato}`;
    if (!resumen.has(k)) {
      resumen.set(k, {
        institucion: row.institucion,
        contrato: row.contrato,
        proveedor: row.proveedor,
        filas: 0,
        partidas_contadas: 0,
        monto_estimado_sin_iva: 0,
        filas_alerta: 0,
        alertas: new Set<string>(),
        filas_revision: [],
      });
    }
    const item = resumen.get(k)!;
    item.filas++;
    if (row.estado === "PARTIDA CONTABILIZADA") {
      item.partidas_contadas++;
    }
    item.monto_estimado_sin_iva += row._aporte;
    if (row.alertas.length > 0) {
      item.filas_alerta++;
      row.alertas.forEach((a: string) => item.alertas.add(a));
      item.filas_revision.push(row);
    }
    row.alertas = row.alertas.join("; ");
    delete row._aporte;
  }

  const contratosSalida: any[] = [];
  let montoInferidoGlobal = 0;
  let montoRevisionGlobal = 0;
  let contratosCompletos = 0;
  let contratosConAlertas = 0;

  for (const [gid, item] of resumen.entries()) {
    const monto = Math.round(item.monto_estimado_sin_iva * 100) / 100;
    montoInferidoGlobal += monto;
    const alertList = Array.from(item.alertas as Set<string>).sort();
    const hasAlert = alertList.length > 0;
    if (hasAlert) {
      contratosConAlertas++;
      montoRevisionGlobal += monto;
    } else {
      contratosCompletos++;
    }

    contratosSalida.push({
      grupo_contrato: gid,
      institucion: item.institucion,
      contrato: item.contrato,
      proveedor: item.proveedor,
      filas: String(item.filas),
      partidas: String(item.partidas_contadas),
      monto_inferido: monto ? monto.toFixed(2) : "0.00",
      monto_revision: hasAlert && monto ? monto.toFixed(2) : "",
      pendientes: String(item.filas_alerta),
      estado: hasAlert ? "REQUIERE REVISION" : "SIN ALERTAS AUTOMATICAS",
      razon: alertList.join("; ") || "Claves y firmas de partidas conciliadas aritméticamente",
      filas_revision: item.filas_revision,
    });
  }

  contratosSalida.sort((a, b) => {
    const instCmp = a.institucion.localeCompare(b.institucion);
    if (instCmp !== 0) return instCmp;
    return a.contrato.localeCompare(b.contrato);
  });

  const pendientesSalida = detalles.filter((r) => r.alertas || r.estado === "NO CUANTIFICABLE / REVISAR");

  const summary = {
    has_data: true,
    total_filas: detalles.length,
    monto_inferido_total: Math.round(montoInferidoGlobal * 100) / 100,
    monto_revision_total: Math.round(montoRevisionGlobal * 100) / 100,
    total_contratos: contratosSalida.length,
    contratos_completos: contratosCompletos,
    contratos_parciales: contratosConAlertas,
    contratos_pendientes: 0,
    filas_duplicadas_excluidas: detalles.filter((r) => r.estado === "REPETIDO MISMA PARTIDA").length,
    filas_inferidas: detalles.filter((r) => r.estado === "PARTIDA CONTABILIZADA").length,
    filas_pendientes: pendientesSalida.length,
    partidas_candidatas: contratosSalida.reduce((acc, c) => acc + parseInt(c.partidas, 10), 0),
    meta: {
      archivo: fileName,
      filas: detalles.length,
      contratos: contratosSalida.length,
      partidas_contadas: contratosSalida.reduce((acc, c) => acc + parseInt(c.partidas, 10), 0),
      contratos_con_alertas: contratosConAlertas,
      monto_estimado_sin_iva: montoInferidoGlobal.toFixed(2),
      criterio: "Partida: institucion+contrato+proveedor+clave+descripcion normalizada+cantidad+precio+importe base; ordenes repetidas no incrementan el contrato",
      advertencia: "Monto estimado desde layout; sin ID de partida ni contrato documental no acredita monto contractual definitivo.",
    },
  };

  return {
    status: "ok",
    report: summary.meta,
    summary,
    contracts: contratosSalida,
    details: detalles,
    pendientes: pendientesSalida,
    rawMatrix: data2D,
    rawSheetName: targetSheet,
    headerRowIdx,
    colContrato,
    colInst,
  };
}
