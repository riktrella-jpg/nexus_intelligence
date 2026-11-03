import { NextResponse } from "next/server";
import { localDatasets } from "../route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ds = localDatasets.find((d) => d.id === id) || localDatasets[0];
  if (!ds) {
    return NextResponse.json({ detail: "Conjunto de datos no encontrado." }, { status: 404 });
  }
  return NextResponse.json(ds);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const idx = localDatasets.findIndex((d) => d.id === id);
  if (idx !== -1) {
    localDatasets.splice(idx, 1);
  }
  return NextResponse.json({ ok: true, deleted_id: id });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ds = localDatasets.find((d) => d.id === id);
  if (!ds) {
    return NextResponse.json({ detail: "Conjunto no encontrado" }, { status: 404 });
  }
  try {
    const body = await request.json();
    if (body.mapping) {
      ds.mapping = { ...ds.mapping, ...body.mapping };
    }
    return NextResponse.json(ds);
  } catch (e: any) {
    return NextResponse.json({ detail: e.message }, { status: 400 });
  }
}

