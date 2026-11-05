"""Integración FastAPI para Nexus · revisión de medicamentos y material de curación.

Registro en la aplicación existente (SIN crear un app = FastAPI nuevo):
    from app.oic.api_suministro import router_suministro
    app.include_router(router_suministro)
"""
from __future__ import annotations
import shutil
import tempfile
from pathlib import Path
from functools import partial
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from .motor_suministro import review_file, load_catalog

router_suministro = APIRouter(prefix='/api/oic/suministro', tags=['OIC · Suministro de salud'])
MAX_FILE_BYTES = 100 * 1024 * 1024

@router_suministro.get('/salud')
def salud():
    return {'estado': 'activo', 'motor': 'suministro_dual', 'version': '2.0.0',
            'tipos': ['MEDICAMENTOS', 'MATERIAL DE CURACIÓN'],
            'reglas_ae_au': 17, 'controles_transversales': 11,
            'controles_especificos': 3, 'claves_cnis': len(load_catalog())}

@router_suministro.post('/revisar')
async def revisar(
    archivo: UploadFile = File(...),
    fecha_corte: str = Form(...),
    modo: str = Form('ambos'),
    hoja: str = Form(''),
    dias_pendiente: int = Form(15),
    tolerancia_contratado: str = Form('1'),
    tolerancia_ejercido: str = Form('0.01'),
    validaciones_adicionales: bool = Form(True),
):
    if not (archivo.filename or '').lower().endswith('.xlsx'):
        raise HTTPException(400, 'El layout debe ser Excel .xlsx')
    tmp = Path(tempfile.mkdtemp(prefix='nexus_suministro_oic_'))
    entry, result = tmp/'layout_entrada.xlsx', tmp/'NEXUS_REVISION_OIC_SUMINISTRO.xlsx'
    try:
        with entry.open('wb') as f:
            size = 0
            while True:
                chunk = await archivo.read(1024 * 1024)
                if not chunk: break
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, 'El Excel excede 100 MB comprimidos')
                f.write(chunk)
        summary = await run_in_threadpool(partial(
            review_file, entry, result, fecha_corte,
            modo=modo, sheet=hoja.strip() or None, dias_pendiente=dias_pendiente,
            tolerancia_contratado=tolerancia_contratado,
            tolerancia_ejercido=tolerancia_ejercido, extras=validaciones_adicionales))
    except HTTPException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    except (ValueError, FileNotFoundError, KeyError, PermissionError, OSError) as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(422, str(e))
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(500, 'Fallo al analizar el layout. Revisar bitácora del backend.')
    med = summary.get('por_tipo', {}).get('MEDICAMENTOS', {}).get('registros', 0)
    mat = summary.get('por_tipo', {}).get('MATERIAL DE CURACIÓN', {}).get('registros', 0)
    return FileResponse(
        str(result), filename='NEXUS_REVISION_OIC_SUMINISTRO.xlsx',
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={
            'X-OIC-Registros': str(summary['registros']),
            'X-OIC-Medicamentos': str(med),
            'X-OIC-Material': str(mat),
            'X-OIC-Hallazgos': str(summary['hallazgos']),
            'X-OIC-Errores': str(summary['errores']),
            'X-OIC-Revisar': str(summary['revisar']),
            'X-OIC-Informativos': str(summary['informativos']),
            'X-OIC-OK': str(summary['ok']),
        },
        background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True),
    )
