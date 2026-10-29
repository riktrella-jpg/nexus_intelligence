import { NextResponse } from "next/server";
import summaryData from "@/lib/data/summary.json";
import contractsData from "@/lib/data/contracts.json";
import institutionSummaryData from "@/lib/data/institution_summary.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const institucion = searchParams.get("institucion");
  const proveedor = searchParams.get("proveedor");
  const contrato = searchParams.get("contrato");
  const estado = searchParams.get("estado");

  // Check if filtered by single institution without other specific filters
  if (institucion && institucion !== "Todos" && (!proveedor || proveedor === "Todos") && !contrato && (!estado || estado === "Todos")) {
    const instMatch = (institutionSummaryData as any[]).find(
      (it) => it.siglas.toLowerCase() === institucion.toLowerCase()
    );
    if (instMatch) {
      return NextResponse.json({
        has_data: true,
        total_filas: instMatch.registros,
        monto_inferido_total: instMatch.monto_contratado,
        monto_revision_total: 0.0,
        monto_ejercido_total: instMatch.monto_ejercido,
        cantidad_contratada_total: instMatch.cantidad_contratada,
        piezas_solicitadas_total: instMatch.piezas_solicitadas,
        piezas_suministradas_total: instMatch.piezas_suministradas,
        total_contratos: instMatch.contratos,
        total_proveedores: instMatch.proveedores,
        contratos_completos: instMatch.contratos,
        contratos_parciales: 0,
        contratos_pendientes: 0,
        filas_duplicadas_excluidas: Math.max(0, instMatch.registros - instMatch.contratos),
        filas_inferidas: instMatch.registros,
        filas_pendientes: 0,
        partidas_candidatas: instMatch.registros,
        meta: summaryData,
      });
    }
  }

  const isFiltered =
    (institucion && institucion !== "Todos") ||
    (proveedor && proveedor !== "Todos") ||
    contrato ||
    (estado && estado !== "Todos");

  if (!isFiltered) {
    return NextResponse.json({
      has_data: true,
      total_filas: summaryData.filas,
      monto_inferido_total: parseFloat(summaryData.monto_inferido_con_partidas_conciliadas),
      monto_revision_total: 0.0,
      monto_ejercido_total: summaryData.monto_ejercido_total,
      cantidad_contratada_total: summaryData.cantidad_contratada_total,
      piezas_solicitadas_total: summaryData.piezas_solicitadas_total,
      piezas_suministradas_total: summaryData.piezas_suministradas_total,
      total_contratos: summaryData.total_contratos,
      total_proveedores: summaryData.total_proveedores,
      contratos_completos: (summaryData.estados_contratos as any)["SIN ALERTAS AUTOMATICAS"] ?? summaryData.estados_contratos.INFERIDO_COMPLETO ?? 6040,
      contratos_parciales: (summaryData.estados_contratos as any)["REQUIERE REVISION"] ?? summaryData.estados_contratos.PARCIAL_CON_PENDIENTES ?? 297,
      contratos_pendientes: (summaryData.estados_contratos as any).PENDIENTE_TOTAL || 0,
      filas_duplicadas_excluidas: (summaryData.estados_filas as any)["REPETIDO MISMA PARTIDA"] ?? summaryData.estados_filas.DUPLICADO_NO_SUMAR ?? 20921,
      filas_inferidas: (summaryData.estados_filas as any)["PARTIDA CONTABILIZADA"] ?? summaryData.estados_filas.INFERIDO_PARTIDA ?? 18839,
      filas_pendientes: (summaryData as any).filas_pendientes ?? (summaryData.estados_filas as any)["NO CUANTIFICABLE / REVISAR"] ?? 3606,
      partidas_candidatas: summaryData.partidas_candidatas,
      meta: summaryData,
    });
  }

  let filtered = contractsData as any[];
  if (institucion && institucion !== "Todos") {
    filtered = filtered.filter((c) => c.institucion === institucion);
  }
  if (proveedor && proveedor !== "Todos") {
    filtered = filtered.filter((c) => c.proveedor === proveedor);
  }
  if (contrato) {
    filtered = filtered.filter((c) => c.contrato.toLowerCase().includes(contrato.toLowerCase()));
  }
  if (estado && estado !== "Todos") {
    filtered = filtered.filter((c) => c.estado === estado);
  }

  let montoInferido = 0;
  let montoRevision = 0;
  let completos = 0;
  let parciales = 0;
  let pendientes = 0;
  let filas = 0;

  for (const c of filtered) {
    if (c.monto_inferido) montoInferido += parseFloat(c.monto_inferido) || 0;
    if (c.monto_revision) montoRevision += parseFloat(c.monto_revision) || 0;
    if (c.estado === "SIN ALERTAS AUTOMATICAS" || c.estado === "INFERIDO_COMPLETO") completos++;
    else if (c.estado === "REQUIERE REVISION" || c.estado === "PARCIAL_CON_PENDIENTES") parciales++;
    else pendientes++;
    filas += parseInt(c.filas, 10) || 0;
  }

  return NextResponse.json({
    has_data: filtered.length > 0,
    total_filas: filas,
    monto_inferido_total: montoInferido,
    monto_revision_total: montoRevision,
    total_contratos: filtered.length,
    contratos_completos: completos,
    contratos_parciales: parciales,
    contratos_pendientes: pendientes,
    filas_duplicadas_excluidas: (summaryData.estados_filas as any)["REPETIDO MISMA PARTIDA"] ?? summaryData.estados_filas.DUPLICADO_NO_SUMAR ?? 20921,
    filas_inferidas: (summaryData.estados_filas as any)["PARTIDA CONTABILIZADA"] ?? summaryData.estados_filas.INFERIDO_PARTIDA ?? 18839,
    filas_pendientes: (summaryData as any).filas_pendientes ?? (summaryData.estados_filas as any)["NO CUANTIFICABLE / REVISAR"] ?? 3606,
    partidas_candidatas: summaryData.partidas_candidatas,
    meta: summaryData,
  });
}
