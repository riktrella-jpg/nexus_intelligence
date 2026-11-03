import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    movements: "Movimientos de suministro y entregas",
    contracts: "Padrón general de contratos",
    inventory: "Existencias e inventarios hospitalarios"
  });
}

