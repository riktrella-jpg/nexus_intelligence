# -*- coding: utf-8 -*-
"""Rutas HTTP para integrar el motor de rescisión en NEXUS.

No modifica archivos originales ni envia datos a servicios externos.
Integra este APIRouter en el backend Python ya existente:
    from nexus_routes import router as oic_router
    app.include_router(oic_router)
"""
from __future__ import annotations

import collections
import datetime as dt
import json
import re
import shutil
import tempfile
import unicodedata
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from motor_validaciones_ampliado import AuditorAmpliado
from revisor_oic import batch, elegir_hoja
from revisor_rescisiones_portable import find_mapping, missing, normalize, read_sheets

router = APIRouter(prefix="/api/oic", tags=["Control OIC / Rescisiones"])
MAX_FILES = 25
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_ZIP_UNCOMPRESSED_BYTES = 220 * 1024 * 1024


def _parse_date(value: str) -> dt.date:
    try:
        when = dt.date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="La fecha de corte debe tener formato AAAA-MM-DD.") from exc
    if when.year < 2015 or when > dt.date.today():
        raise HTTPException(status_code=422, detail="La fecha de corte no puede ser futura ni anterior a 2015.")
    return when


def _safe_filename(name: str, index: int) -> str:
    # Nunca usar rutas completas recibidas desde un cliente.
    name = str(name or "archivo.xlsx").replace("\\", "/").split("/")[-1]
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    stem = Path(name).stem[:80] or "archivo"
    return f"{index:02d}_{stem}.xlsx"


def _check_xlsx(path: Path) -> None:
    if not zipfile.is_zipfile(path):
        raise HTTPException(422, detail=f"No es un libro XLSX valido: {path.name}")
    with zipfile.ZipFile(path) as book:
        entries = book.infolist()
        if len(entries) > 12000 or sum(i.file_size for i in entries) > MAX_ZIP_UNCOMPRESSED_BYTES:
            raise HTTPException(413, detail=f"Archivo Excel demasiado complejo: {path.name}")
        names = {i.filename for i in entries}
        if "xl/workbook.xml" not in names or "[Content_Types].xml" not in names:
            raise HTTPException(422, detail=f"No es un libro XLSX valido: {path.name}")
        if any(i.filename.lower().endswith("vbaProject.bin".lower()) for i in entries):
            raise HTTPException(422, detail="No se admiten macros en los archivos recibidos.")


async def _save_uploads(files: list[UploadFile], folder: Path) -> list[Path]:
    if not 1 <= len(files) <= MAX_FILES:
        raise HTTPException(422, detail=f"Carga de 1 a {MAX_FILES} libros XLSX por solicitud.")
    saved = []
    for index, upload in enumerate(files, 1):
        if not (upload.filename or "").lower().endswith(".xlsx"):
            raise HTTPException(422, detail="Todos los archivos deben tener extension .xlsx.")
        target = folder / _safe_filename(upload.filename or "", index)
        total = 0
        try:
            with target.open("wb") as out:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        raise HTTPException(413, detail=f"El archivo {upload.filename} supera 25 MB.")
                    out.write(chunk)
        finally:
            await upload.close()
        _check_xlsx(target)
        saved.append(target)
    return saved


def _preview_one(path: Path, corte: dt.date) -> dict:
    entries = read_sheets(path, find_mapping, normalize)
    main = elegir_hoja(entries)
    if not main:
        raise ValueError("No se encontraron encabezados reconocibles del layout de rescisión.")
    sheet, header_zero, mapping, rows = main
    auditor = AuditorAmpliado(corte)
    auditor.review(sheet, header_zero, mapping, rows)
    findings = auditor.findings
    num_rows = sum(1 for r in rows[1:] if any(
        not missing(r[mapping[k]]) for k in ("contrato", "proveedor", "estatus")
        if k in mapping and mapping[k] < len(r)))
    return {
        "archivo": path.name, "hoja": sheet, "registros": num_rows,
        "inconsistencias": len(findings), "filas_observadas": len({f.row for f in findings}),
        "por_gravedad": dict(collections.Counter(f.severity for f in findings)),
        "por_regla": dict(collections.Counter(f.rule for f in findings).most_common(25)),
        "hallazgos_muestra": [{
            "fila": f.row, "celda": f.cell, "contrato": f.contract,
            "regla": f.rule, "categoria": f.severity,
            "campo": f.field, "detalle": f.detail, "accion": f.action,
            "celdas_relacionadas": list(f.related)
        } for f in findings[:60]]
    }


@router.post("/rescisiones/previsualizar")
async def previsualizar_rescisiones(
    files: list[UploadFile] = File(...), fecha_corte: str = Form(...)
):
    corte = _parse_date(fecha_corte)
    working = Path(tempfile.mkdtemp(prefix="nexus_oic_preview_"))
    try:
        inputs = await _save_uploads(files, working)
        records, errors = [], []
        for path in inputs:
            try:
                records.append(await run_in_threadpool(_preview_one, path, corte))
            except Exception as ex:
                errors.append({"archivo": path.name, "error": str(ex)[:400]})
        if not records:
            raise HTTPException(422, detail={"mensaje": "No fue posible analizar los archivos", "errores": errors})
        return {"fecha_corte": str(corte), "archivos": records, "errores": errors}
    finally:
        shutil.rmtree(working, ignore_errors=True)


@router.post("/rescisiones/exportar")
async def exportar_rescisiones(
    files: list[UploadFile] = File(...), fecha_corte: str = Form(...)
):
    corte = _parse_date(fecha_corte)
    working = Path(tempfile.mkdtemp(prefix="nexus_oic_export_"))
    try:
        input_dir = working / "originales"
        output_dir = working / "resultado"
        input_dir.mkdir();output_dir.mkdir()
        paths = await _save_uploads(files, input_dir)
        # Motor de análisis existente, con verificación estructural y colores.
        # Ejecutar fuera del hilo de eventos de FastAPI.
        if len(paths) == 1:
            stats, errors = await run_in_threadpool(batch, paths[0], output_dir, corte, lambda _: None)
        else:
            stats, errors = await run_in_threadpool(batch, input_dir, output_dir, corte, lambda _: None)
        if not stats:
            raise HTTPException(422, detail={"mensaje": "No se genero ningun archivo", "errores": errors})
        if len(paths) == 1 and len(stats) == 1:
            generated = Path(stats[0]["salida"])
            return FileResponse(
                generated, filename=generated.name,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                background=BackgroundTask(shutil.rmtree, working, ignore_errors=True),
            )
        package = working / "Devoluciones_OIC_NEXUS.zip"
        with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as zout:
            for output in output_dir.glob("*.xlsx"):
                zout.write(output, output.name)
            summary = output_dir / "RESUMEN_REVISION_OIC.csv"
            if summary.exists():
                zout.write(summary, summary.name)
            if errors:
                zout.writestr("ERRORES_REVISION.txt", "\n".join(f"{name}: {err}" for name, err in errors))
        return FileResponse(
            package, filename=package.name, media_type="application/zip",
            background=BackgroundTask(shutil.rmtree, working, ignore_errors=True),
        )
    except Exception:
        shutil.rmtree(working, ignore_errors=True)
        raise
