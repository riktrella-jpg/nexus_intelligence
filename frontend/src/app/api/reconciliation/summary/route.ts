import { NextResponse } from "next/server";
import summaryData from "@/lib/data/summary.json";
import contractsData from "@/lib/data/contracts.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const institucion = searchParams.get("institucion");
  const proveedor = searchParams.get("proveedor");
  const contrato = searchParams.get("contrato");
  const estado = searchParams.get("estado");

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

  const isFiltered = (institucion && institucion !== "Todos") || (proveedor && proveedor !== "Todos") || contrato || (estado && estado !== "Todos");

  if (!isFiltered) {
    return NextResponse.json({
      has_data: true,
      total_filas: summaryData.filas,
      monto_inferido_total: parseFloat(summaryData.monto_inferido_con_partidas_conciliadas),
      monto_revision_total: 2015968862.0,
      total_contratos: summaryData.grupos_contractuales,
      contratos_completos: summaryData.estados_contratos.INFERIDO_COMPLETO || 0,
      contratos_parciales: summaryData.estados_contratos.PARCIAL_CON_PENDIENTES || 0,
      contratos_pendientes: summaryData.estados_contratos.PENDIENTE_TOTAL || 0,
      filas_duplicadas_excluidas: summaryData.estados_filas.DUPLICADO_NO_SUMAR || 0,
      filas_inferidas: summaryData.estados_filas.INFERIDO_PARTIDA || 0,
      filas_pendientes: (summaryData.estados_filas.PENDIENTE || 0) + (summaryData.estados_filas.PENDIENTE_DUPLICADO || 0),
      partidas_candidatas: summaryData.partidas_candidatas,
      meta: summaryData,
    });
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
    if (c.estado === "INFERIDO_COMPLETO") completos++;
    else if (c.estado === "PARCIAL_CON_PENDIENTES") parciales++;
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
    filas_duplicadas_excluidas: summaryData.estados_filas.DUPLICADO_NO_SUMAR || 0,
    filas_inferidas: summaryData.estados_filas.INFERIDO_PARTIDA || 0,
    filas_pendientes: (summaryData.estados_filas.PENDIENTE || 0) + (summaryData.estados_filas.PENDIENTE_DUPLICADO || 0),
    partidas_candidatas: summaryData.partidas_candidatas,
    meta: summaryData,
  });
}
