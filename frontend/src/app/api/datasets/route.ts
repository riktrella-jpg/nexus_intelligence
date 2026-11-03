import { NextResponse } from "next/server";

// Almacén en memoria para datasets locales en Vercel cuando Render no está disponible
export interface LocalDataset {
  id: string;
  name: string;
  institution: string;
  source: string;
  period: string;
  cutoff: string;
  data_kind: string;
  data_kind_label: string;
  row_count: number;
  updated_at: number;
  columns: Array<{ name: string; type: string; role?: string | null; coverage?: number }>;
  mapping: Record<string, string>;
  role_labels: Record<string, string>;
  periods?: string[];
  imports?: any[];
  key_cols?: string[];
  procurement?: { ready: boolean; missing: string[]; supply: boolean };
}

export const localDatasets: LocalDataset[] = [
  {
    id: "ds_hgmel_2026",
    name: "Layout Suministro HGMEL Septiembre 2026",
    institution: "HGMEL",
    source: "Dirección de Abastecimiento",
    period: "2026-09",
    cutoff: "30/09/2026",
    data_kind: "movements",
    data_kind_label: "Movimientos de suministro",
    row_count: 36766,
    updated_at: Date.now() - 3600000,
    columns: [
      { name: "INSTITUCION", type: "text", role: "institution", coverage: 1.0 },
      { name: "NUMERO_CONTRATO", type: "identifier", role: "contract_id", coverage: 1.0 },
      { name: "PROVEEDOR", type: "text", role: "supplier", coverage: 0.98 },
      { name: "CLAVE", type: "identifier", role: "item_code", coverage: 0.95 },
      { name: "DESCRIPCION", type: "text", role: "item_desc", coverage: 0.99 },
      { name: "CANTIDAD", type: "number", role: "quantity", coverage: 1.0 },
      { name: "PRECIO_UNITARIO", type: "number", role: "unit_price", coverage: 1.0 },
      { name: "IMPORTE_NETO", type: "number", role: "total_amount", coverage: 1.0 }
    ],
    mapping: {
      "INSTITUCION": "institution",
      "NUMERO_CONTRATO": "contract_id",
      "PROVEEDOR": "supplier",
      "CLAVE": "item_code",
      "DESCRIPCION": "item_desc",
      "CANTIDAD": "quantity",
      "PRECIO_UNITARIO": "unit_price",
      "IMPORTE_NETO": "total_amount"
    },
    role_labels: {
      "institution": "Institución",
      "contract_id": "Número de Contrato",
      "supplier": "Proveedor",
      "item_code": "Clave Medicamento / Insumo",
      "item_desc": "Descripción de Partida",
      "quantity": "Cantidad Contratada",
      "unit_price": "Precio Unitario",
      "total_amount": "Importe Total"
    },
    periods: ["2026-09"],
    imports: [
      {
        id: "imp_init",
        filename: "Layout_Suministro_Septiembre.xlsx",
        period: "2026-09",
        mode: "new",
        rows_received: 36766,
        rows_added: 36766,
        rows_skipped: 0,
        rows_updated: 0,
        rows_invalid: 0,
        created_at: Math.floor(Date.now() / 1000) - 3600
      }
    ],
    procurement: { ready: true, missing: [], supply: true }
  }
];

export async function GET() {
  return NextResponse.json(localDatasets);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const newDs: LocalDataset = {
      id: "ds_" + Date.now().toString(36),
      name: body.name || "Nuevo conjunto",
      institution: body.institution || "HGMEL",
      source: body.source || "Carga de usuario",
      period: body.period || "2026-01",
      cutoff: body.cutoff || new Date().toLocaleDateString("es-MX"),
      data_kind: body.data_kind || "movements",
      data_kind_label: "Movimientos",
      row_count: body.row_count || 100,
      updated_at: Date.now(),
      columns: body.columns || [],
      mapping: body.mapping || {},
      role_labels: body.role_labels || {},
      periods: [body.period || "2026-01"],
      imports: []
    };
    localDatasets.unshift(newDs);
    return NextResponse.json(newDs);
  } catch (e: any) {
    return NextResponse.json({ detail: e.message || "Error al crear conjunto" }, { status: 400 });
  }
}

