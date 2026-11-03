import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getUploadFromCache } from "../../route";

const DEFAULT_ROLES = [
  { role: "institution", label: "Institución" },
  { role: "contract_id", label: "Número de Contrato" },
  { role: "supplier", label: "Proveedor" },
  { role: "item_code", label: "Clave Medicamento / Insumo" },
  { role: "item_desc", label: "Descripción de Partida" },
  { role: "quantity", label: "Cantidad Contratada" },
  { role: "unit_price", label: "Precio Unitario" },
  { role: "total_amount", label: "Importe Total" },
  { role: "date", label: "Fecha de Firma / Movimiento" },
  { role: "order_id", label: "Número de Orden de Suministro" },
  { role: "delivered_qty", label: "Piezas Suministradas" }
];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ upload_id: string }> }
) {
  const { upload_id } = await params;
  const { searchParams } = new URL(request.url);
  const sheetName = searchParams.get("sheet") || "";
  const headerRow = parseInt(searchParams.get("header_row") || "1", 10);

  const cached = getUploadFromCache(upload_id);

  if (!cached) {
    const dummyCols = [
      { name: "INSTITUCION", type: "text", role: "institution", ambiguous: false, nulls: 0, invalid: 0, sample: ["HGMEL"] },
      { name: "CONTRATO", type: "identifier", role: "contract_id", ambiguous: false, nulls: 0, invalid: 0, sample: ["SS-CONASAMA-AD-I-8-01-2025"] },
      { name: "PROVEEDOR", type: "text", role: "supplier", ambiguous: false, nulls: 0, invalid: 0, sample: ["FARMACEUTICA SA"] },
      { name: "CLAVE", type: "identifier", role: "item_code", ambiguous: false, nulls: 0, invalid: 0, sample: ["010.000.1234.00"] },
      { name: "DESCRIPCION", type: "text", role: "item_desc", ambiguous: false, nulls: 0, invalid: 0, sample: ["PARACETAMOL 500MG"] },
      { name: "CANTIDAD", type: "number", role: "quantity", ambiguous: false, nulls: 0, invalid: 0, sample: ["1000"] },
      { name: "PRECIO", type: "number", role: "unit_price", ambiguous: false, nulls: 0, invalid: 0, sample: ["15.50"] },
      { name: "IMPORTE", type: "number", role: "total_amount", ambiguous: false, nulls: 0, invalid: 0, sample: ["15500.00"] },
    ];
    return NextResponse.json({
      upload_id,
      sheet: sheetName || "BASE",
      header_row: headerRow,
      rows: 10,
      cols: dummyCols.length,
      columns: dummyCols,
      preview: [
        { INSTITUCION: "HGMEL", CONTRATO: "SS-CONASAMA-AD-I-8-01-2025", PROVEEDOR: "FARMACEUTICA SA", CLAVE: "010.000.1234.00", DESCRIPCION: "PARACETAMOL 500MG", CANTIDAD: "1000", PRECIO: "15.50", IMPORTE: "15500.00" }
      ],
      roles: DEFAULT_ROLES,
      duplicates_exact: 0,
      proposed_mapping: {
        INSTITUCION: "institution",
        CONTRATO: "contract_id",
        PROVEEDOR: "supplier",
        CLAVE: "item_code",
        DESCRIPCION: "item_desc",
        CANTIDAD: "quantity",
        PRECIO: "unit_price",
        IMPORTE: "total_amount",
      },
      total_rows: 10,
      sample_rows: []
    });
  }

  try {
    const wb = XLSX.read(cached.buffer, { type: "buffer" });
    const targetSheet = sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
    const ws = wb.Sheets[targetSheet];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

    const headerIdx = Math.max(0, headerRow - 1);
    const rawHeaders = (rows[headerIdx] || []) as any[];

    const dataRows = rows.slice(headerIdx + 1);
    const totalRowsCount = dataRows.length;

    const columns = rawHeaders.map((h, i) => {
      const colName = String(h || `Columna_${i + 1}`).trim();
      const lower = colName.toLowerCase();
      let role: string | null = null;
      if (lower.includes("inst")) role = "institution";
      else if (lower.includes("contra")) role = "contract_id";
      else if (lower.includes("prov")) role = "supplier";
      else if (lower.includes("clave")) role = "item_code";
      else if (lower.includes("desc")) role = "item_desc";
      else if (lower.includes("monto") || lower.includes("importe")) role = "total_amount";
      else if (lower.includes("cant")) role = "quantity";
      else if (lower.includes("prec")) role = "unit_price";
      else if (lower.includes("fecha")) role = "date";
      else if (lower.includes("orden")) role = "order_id";

      // Obtener muestras de datos y conteo de vacíos
      let nulls = 0;
      const sample: string[] = [];
      for (let r = 0; r < Math.min(25, dataRows.length); r++) {
        const val = dataRows[r]?.[i];
        if (val === undefined || val === null || val === "") {
          nulls++;
        } else if (sample.length < 3) {
          sample.push(String(val).trim());
        }
      }

      const isNum = role === "total_amount" || role === "quantity" || role === "unit_price";

      return {
        name: colName,
        type: isNum ? "number" : "text",
        role,
        ambiguous: false,
        nulls,
        invalid: 0,
        sample,
        warnings: []
      };
    });

    const proposedMapping: Record<string, string> = {};
    for (const c of columns) {
      if (c.role) proposedMapping[c.name] = c.role;
    }

    const previewRows = dataRows.slice(0, 15).map((r: any) => {
      const obj: Record<string, any> = {};
      columns.forEach((c, idx) => {
        obj[c.name] = r[idx] ?? "";
      });
      return obj;
    });

    return NextResponse.json({
      upload_id,
      sheet: targetSheet,
      header_row: headerRow,
      rows: totalRowsCount,
      cols: columns.length,
      columns,
      preview: previewRows,
      sample_rows: previewRows,
      roles: DEFAULT_ROLES,
      duplicates_exact: 0,
      proposed_mapping: proposedMapping,
      total_rows: totalRowsCount,
    });
  } catch (err: any) {
    return NextResponse.json({ detail: "Error al generar vista previa: " + err.message }, { status: 500 });
  }
}
