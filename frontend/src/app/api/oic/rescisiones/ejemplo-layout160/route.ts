import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const filePath = path.join(process.cwd(), "public", "data", "Layout_Rescision_160_Octubre.xlsx");
  if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    const buf = fs.readFileSync(/*turbopackIgnore: true*/ filePath);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="Layout_Rescision_160_Octubre.xlsx"',
      },
    });
  }
  return NextResponse.json({ detail: "Archivo de ejemplo Layout 160 no encontrado." }, { status: 404 });
}
