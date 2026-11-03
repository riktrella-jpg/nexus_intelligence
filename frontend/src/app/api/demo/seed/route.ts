import { NextResponse } from "next/server";
import { localDatasets } from "../../datasets/route";

export async function POST() {
  const seedDs = {
    id: "ds_sintetico_demo",
    name: "Contrataciones Médicas y Suministros Hospitalarios 2026",
    institution: "Instituto Nacional de Salud y Especialidades",
    source: "Secretaría Administrativa - Dirección de Adquisiciones",
    period: "2026-01",
    cutoff: "31/01/2026",
    data_kind: "movements",
    data_kind_label: "Movimientos de suministro",
    row_count: 540,
    updated_at: Date.now(),
    columns: [
      { name: "INSTITUCION", type: "text", role: "institution", coverage: 1.0 },
      { name: "NUMERO_CONTRATO", type: "identifier", role: "contract_id", coverage: 1.0 },
      { name: "PROVEEDOR", type: "text", role: "supplier", coverage: 1.0 },
      { name: "CLAVE", type: "identifier", role: "item_code", coverage: 1.0 },
      { name: "DESCRIPCION", type: "text", role: "item_desc", coverage: 1.0 },
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
    periods: ["2026-01"],
    imports: [],
    procurement: { ready: true, missing: [], supply: true }
  };

  const existingIdx = localDatasets.findIndex((d) => d.id === seedDs.id);
  if (existingIdx !== -1) {
    localDatasets[existingIdx] = seedDs;
  } else {
    localDatasets.unshift(seedDs);
  }

  return NextResponse.json({
    status: "ok",
    dataset_id: seedDs.id,
    total_rows: seedDs.row_count,
    name: seedDs.name
  });
}

