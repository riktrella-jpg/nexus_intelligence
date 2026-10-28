import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getUploadFromCache } from "../../route";

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
    // Si no está en memoria local, devolver una respuesta de preview genérica
    return NextResponse.json({
      upload_id,
      sheet: sheetName || "BASE",
      header_row: headerRow,
      columns: [
        { name: "institucion", type: "text", role: "institution", ambiguous: false },
        { name: "contrato", type: "text", role: "contract_id", ambiguous: false },
        { name: "proveedor", type: "text", role: "vendor", ambiguous: false },
        { name: "clave", type: "text", role: "item_code", ambiguous: false },
        { name: "descripcion", type: "text", role: "item_desc", ambiguous: false },
        { name: "monto", type: "number", role: "amount", ambiguous: false },
        { name: "cantidad", type: "number", role: "quantity", ambiguous: false },
        { name: "precio", type: "number", role: "unit_price", ambiguous: false },
      ],
      sample_rows: [],
      proposed_mapping: {
        institucion: "institution",
        contrato: "contract_id",
        proveedor: "vendor",
        clave: "item_code",
        descripcion: "item_desc",
        monto: "amount",
        cantidad: "quantity",
        precio: "unit_price",
      },
      total_rows: 10,
    });
  }

  try {
    const wb = XLSX.read(cached.buffer, { type: "buffer" });
    const targetSheet = sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
    const ws = wb.Sheets[targetSheet];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

    const headerIdx = Math.max(0, headerRow - 1);
    const rawHeaders = (rows[headerIdx] || []) as any[];

    const columns = rawHeaders.map((h, i) => {
      const colName = String(h || `Columna_${i + 1}`).trim();
      const lower = colName.toLowerCase();
      let role: string | null = null;
      if (lower.includes("inst")) role = "institution";
      else if (lower.includes("contra")) role = "contract_id";
      else if (lower.includes("prov")) role = "vendor";
      else if (lower.includes("clave")) role = "item_code";
      else if (lower.includes("desc")) role = "item_desc";
      else if (lower.includes("monto") || lower.includes("importe")) role = "amount";
      else if (lower.includes("cant")) role = "quantity";
      else if (lower.includes("prec")) role = "unit_price";
      else if (lower.includes("fecha")) role = "date";

      return {
        name: colName,
        type: role === "amount" || role === "quantity" || role === "unit_price" ? "number" : "text",
        role,
        ambiguous: false,
      };
    });

    const proposedMapping: Record<string, string> = {};
    for (const c of columns) {
      if (c.role) proposedMapping[c.name] = c.role;
    }

    const sampleRows = rows.slice(headerIdx + 1, headerIdx + 11).map((r: any) => {
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
      columns,
      sample_rows: sampleRows,
      proposed_mapping: proposedMapping,
      total_rows: Math.max(0, rows.length - (headerIdx + 1)),
    });
  } catch (err: any) {
    return NextResponse.json({ detail: "Error al generar vista previa: " + err.message }, { status: 500 });
  }
}
