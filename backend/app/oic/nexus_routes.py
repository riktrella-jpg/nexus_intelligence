# -*- coding: utf-8 -*-
"""Rutas HTTP para integrar el motor de Control de Calidad OIC en NEXUS Intelligence.

No modifica archivos originales ni envía datos a servicios externos.
Integra este APIRouter en el backend Python ya existente:
    from .oic.nexus_routes import router as oic_router
    app.include_router(oic_router)
"""
from __future__ import annotations

import collections
import datetime as dt
import re
import shutil
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from motor_validaciones_ampliado import AuditorAmpliado
from motor_medicamentos import AuditorMedicamentos
from revisor_oic import batch, elegir_hoja
from revisor_rescisiones_portable import find_mapping, missing, normalize, read_sheets

router = APIRouter(prefix="/api/oic", tags=["Control de Calidad OIC"])
MAX_FILES = 25
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_ZIP_UNCOMPRESSED_BYTES = 220 * 1024 * 1024


def _parse_date(value: str) -> dt.date:
    try:
        when = dt.date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="La fecha de corte debe tener formato AAAA-MM-DD.") from exc
    if when.year < 2015 or when.year > 2035:
        raise HTTPException(status_code=422, detail="La fecha de corte debe ubicarse entre 2015 y 2035.")
    return when


def _safe_filename(name: str, index: int, total_files: int = 1) -> str:
    # Nunca usar rutas completas recibidas desde un cliente.
    name = str(name or "archivo.xlsx").replace("\\", "/").split("/")[-1]
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    stem = Path(name).stem[:80] or "archivo"
    if total_files > 1:
        return f"{index:02d}_{stem}.xlsx"
    return f"{stem}.xlsx"


def _check_xlsx(path: Path) -> None:
    if not zipfile.is_zipfile(path):
        raise HTTPException(422, detail=f"No es un libro XLSX válido: {path.name}")
    with zipfile.ZipFile(path) as book:
        entries = book.infolist()
        if len(entries) > 12000 or sum(i.file_size for i in entries) > MAX_ZIP_UNCOMPRESSED_BYTES:
            raise HTTPException(413, detail=f"Archivo Excel demasiado complejo: {path.name}")
        names = {i.filename for i in entries}
        if "xl/workbook.xml" not in names or "[Content_Types].xml" not in names:
            raise HTTPException(422, detail=f"No es un libro XLSX válido: {path.name}")
        if any(i.filename.lower().endswith("vbaproject.bin") for i in entries):
            raise HTTPException(422, detail="No se admiten macros en los archivos recibidos.")


async def _save_uploads(files: list[UploadFile], folder: Path) -> list[Path]:
    if not 1 <= len(files) <= MAX_FILES:
        raise HTTPException(422, detail=f"Carga de 1 a {MAX_FILES} libros XLSX por solicitud.")
    saved = []
    used_names: set[str] = set()
    for index, upload in enumerate(files, 1):
        if not (upload.filename or "").lower().endswith(".xlsx"):
            raise HTTPException(422, detail="Todos los archivos deben tener extensión .xlsx.")
        fname = _safe_filename(upload.filename or "", index, len(files))
        if fname in used_names:
            fname = f"{index:02d}_{fname}"
        used_names.add(fname)
        target = folder / fname
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
    all_hallazgos = [{
        "fila": f.row,
        "celda": f.cell,
        "contrato": f.contract,
        "regla": f.rule,
        "categoria": f.severity,
        "campo": f.field,
        "detalle": f.detail,
        "accion": f.action,
        "celdas_relacionadas": list(f.related),
    } for f in findings]
    return {
        "archivo": path.name,
        "hoja": sheet,
        "registros": num_rows,
        "inconsistencias": len(findings),
        "filas_observadas": len({f.row for f in findings}),
        "por_gravedad": dict(collections.Counter(f.severity for f in findings)),
        "por_regla": dict(collections.Counter(f.rule for f in findings).most_common(50)),
        "columnas_reconocidas": {k: rows[0][idx] for k, idx in mapping.items() if idx < len(rows[0])},
        "hallazgos_muestra": all_hallazgos,
    }


@router.get("/salud")
def salud_oic():
    return {
        "estado": "ok",
        "modulos": {
            "rescisiones": "activo",
            "medicamentos": "arquitectura_preparada",
        },
    }


@router.get("/medicamentos/estado")
def estado_medicamentos():
    aud = AuditorMedicamentos(dt.date(2026, 10, 31))
    return aud.estado_modulo()


@router.get("/rescisiones/ejemplo-layout160")
def descargar_ejemplo_layout160():
    """Devuelve el archivo oficial de prueba Layout 160 para validación rápida en 1 clic."""
    root = _HERE.parent.parent.parent
    candidates = [
        root / "NEXUS_OIC_INTEGRACION" / "ejemplos" / "Layout_Rescision_160_Octubre.xlsx",
        root / "frontend" / "public" / "data" / "Layout_Rescision_160_Octubre.xlsx",
        root / "NEXUS_OIC_INTEGRACION" / "ejemplos" / "Layout160_RevisionOIC.xlsx",
    ]
    for cand in candidates:
        if cand.exists():
            return FileResponse(
                cand,
                filename="Layout_Rescision_160_Octubre.xlsx",
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
    raise HTTPException(404, detail="Archivo de ejemplo Layout 160 no encontrado.")


@router.post("/rescisiones/previsualizar")
async def previsualizar_rescisiones(
    files: list[UploadFile] = File(...),
    fecha_corte: str = Form("2026-10-31"),
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
    files: list[UploadFile] = File(...),
    fecha_corte: str = Form("2026-10-31"),
    formato: str = Form("auto"),
):
    corte = _parse_date(fecha_corte)
    working = Path(tempfile.mkdtemp(prefix="nexus_oic_export_"))
    try:
        input_dir = working / "originales"
        output_dir = working / "resultado"
        input_dir.mkdir()
        output_dir.mkdir()
        paths = await _save_uploads(files, input_dir)
        # Motor de análisis existente, con verificación estructural y colores.
        # Ejecutar fuera del hilo de eventos de FastAPI.
        if len(paths) == 1:
            stats, errors = await run_in_threadpool(batch, paths[0], output_dir, corte, lambda _: None)
        else:
            stats, errors = await run_in_threadpool(batch, input_dir, output_dir, corte, lambda _: None)
        if not stats:
            raise HTTPException(422, detail={"mensaje": "No se generó ningún archivo", "errores": errors})
        if len(paths) == 1 and len(stats) == 1 and formato.lower() != "zip":
            generated = Path(stats[0]["salida"])
            return FileResponse(
                generated,
                filename=generated.name,
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
            package,
            filename=package.name,
            media_type="application/zip",
            background=BackgroundTask(shutil.rmtree, working, ignore_errors=True),
        )
    except Exception:
        shutil.rmtree(working, ignore_errors=True)
        raise
