import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json([
    {
      id: "Layout_Suministro_Septiembre.xlsx",
      filename: "Layout_Suministro_Septiembre.xlsx",
      path: "Layout_Suministro_Septiembre.xlsx",
      size: 15482910,
      location: "servidor_principal",
    },
  ]);
}
