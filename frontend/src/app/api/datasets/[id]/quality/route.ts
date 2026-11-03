import { NextResponse } from "next/server";
import { localDatasets } from "../../route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ds = localDatasets.find((d) => d.id === id) || localDatasets[0];
  const total = ds ? ds.row_count : 36766;

  return NextResponse.json({
    total,
    valid: Math.round(total * 0.96),
    with_issues: Math.round(total * 0.04),
    exact_duplicates: 0,
    issues: [
      { issue: "Posible repetición de clave CNIS en órdenes subsecuentes", count: Math.round(total * 0.03) },
      { issue: "Descripción con formato genérico o sin clave", count: Math.round(total * 0.01) }
    ],
    columns: (ds?.columns || []).map((c) => ({
      name: c.name,
      type: c.type,
      role: c.role || null,
      non_null: total,
      nulls: 0,
      coverage: c.coverage ?? 1.0,
      warnings: []
    })),
    unmapped_columns: (ds?.columns || []).filter((c) => !c.role).map((c) => c.name),
    imports: ds?.imports || []
  });
}

