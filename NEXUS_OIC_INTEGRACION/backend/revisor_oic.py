# -*- coding: utf-8 -*-
"""Revisión por fila de layouts institucionales de rescisión.

Uso:
 python revisor_oic.py "C:/Layouts" --corte 2026-10-31
 python revisor_oic.py "Layout.xlsx" --corte 2026-10-31 --salida "C:/Resultados"

No toca originales. La única hoja agregada es REVISION OIC; reproduce las
filas del layout y agrega Inconsistencia_1..N a la derecha. Todas las celdas
observadas y relacionadas se resaltan amarillo en esta hoja, no en el original.
"""
from __future__ import annotations
import argparse,csv,datetime as dt,collections,re,unicodedata,json
from pathlib import Path
from motor_validaciones_ampliado import AuditorAmpliado
from revisor_rescisiones_portable import read_sheets,find_mapping,normalize,missing,PRIORITY,extract_cell,infer_corte
from generar_hoja_oic import build_mirror_workbook
from verificar_excel import verificar

def cargar_catalogos():
    """Permite ajustar sólo los listados permitidos sin editar Python."""
    archivo=Path(__file__).with_name('catalogos.json')
    if not archivo.exists():return
    data=json.loads(archivo.read_text(encoding='utf-8'))
    import revisor_rescisiones_portable as engine
    for name,field in [('VALID_FUENTE','fuente'),('VALID_STATUS','estatus')]:
        allowed=data.get(field)
        if not isinstance(allowed,list) or not allowed or not all(isinstance(x,str) and x.strip() for x in allowed):
            raise ValueError('Catálogo incorrecto: '+field)
        setattr(engine,name,{normalize(x) for x in allowed})

cargar_catalogos()

EXCLUDE=('REVISION OIC','OBSERVACIONES','DICCIONARIO','ANALISIS','PT')

def safe_name(stem):
    txt=unicodedata.normalize('NFKD',stem)
    txt=''.join(c for c in txt if not unicodedata.combining(c))
    txt=re.sub(r'[^A-Za-z0-9._-]+','_',txt).strip('_.-')
    return txt[:75] or 'Layout'

def elegir_hoja(entries):
    candidates=[item for item in entries if not any(normalize(item[0]).startswith(x) for x in EXCLUDE)]
    if not candidates:
        candidates=[item for item in entries if not normalize(item[0]).startswith('REVISION OIC')]
    if not candidates:
        return None
    return next((it for it in candidates if normalize(it[0])=='BASE'),
                next((it for it in candidates if normalize(it[0])=='DGCOES'),candidates[0]))

def auditar(path:Path,salida:Path,corte:dt.date,notify=print):
    path=Path(path);salida=Path(salida)
    if path.suffix.lower()!='.xlsx':raise ValueError('Se requiere archivo .xlsx, no .xlsb/.xls')
    entries=read_sheets(path,find_mapping,normalize)
    main=elegir_hoja(entries)
    if not main:raise ValueError('No se encontró una hoja con los encabezados de rescisión; no se modificó el original.')
    source,header_zero,mapping,rows=main
    auditor=AuditorAmpliado(corte)
    auditor.review(source,header_zero,mapping,rows)
    findings=sorted(auditor.findings,key=lambda f:(f.row,PRIORITY[f.severity],extract_cell(f.cell)[1],f.rule))
    dest=salida/(safe_name(path.stem)+'_REVISION_OIC.xlsx')
    dest.parent.mkdir(parents=True,exist_ok=True)
    seq=2
    while dest.exists():
        dest=salida/(safe_name(path.stem)+f'_REVISION_OIC_{seq}.xlsx');seq+=1
    info=build_mirror_workbook(path,dest,source,header_zero,rows[0],findings)
    try:
        verificar(path,dest,findings,info['new_columns'])
    except Exception:
        # Si una copia no es íntegra, nunca entregar el archivo como válido.
        if dest.exists(): dest.unlink()
        raise
    records=sum(1 for r in rows[1:] if any(not missing(r[mapping[k]]) for k in ('contrato','proveedor','estatus') if k in mapping and mapping[k]<len(r)))
    observed=len({f.row for f in findings})
    tally=collections.Counter(f.severity for f in findings)
    stat={'nombre':path.name,'salida':str(dest),'hoja':source,'registros':records,
          'filas_observadas':observed,'inconsistencias':len(findings),
          'columnas':info['new_columns'],'error':tally['ERROR'],
          'revisar':tally['REVISAR'],'documental':tally['DOCUMENTAL']}
    notify(f"[OK] {path.name}: {records} registros; {observed} filas observadas; {len(findings)} inconsistencias; columnas +{info['new_columns']}")
    return stat

def batch(input_path,salida,corte=None,notify=print):
    origin=Path(input_path).expanduser().resolve();salida=Path(salida).expanduser().resolve()
    if not origin.exists():raise FileNotFoundError(str(origin))
    sources=[origin] if origin.is_file() else sorted(p for p in origin.glob('*.xlsx')
        if not p.name.startswith('~$') and '_REVISION_OIC' not in p.stem.upper()
        and '_OBSERVADO' not in p.stem.upper() and '_REVISION_POR_FILA' not in p.stem.upper()
        and '_CON_INCONSISTENCIAS' not in p.stem.upper())
    if not sources:raise RuntimeError('No se encontraron archivos XLSX de origen.')
    results=[];errors=[]
    for p in sources:
        try:
            cut=corte or infer_corte(p)
            if cut is None:raise ValueError('Debe indicarse fecha de corte; no se adivina.')
            results.append(auditar(p,salida,cut,notify))
        except Exception as e:
            errors.append((p.name,str(e)));notify(f'[ERROR] {p.name}: {e}')
    if results:
        # El resumen se escribe en un CSV separado, NUNCA en el libro institucional.
        name=salida/'RESUMEN_REVISION_OIC.csv'
        with name.open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=results[0].keys());w.writeheader();w.writerows(results)
        notify(f'[RESUMEN] {name}')
    notify(f'Finalizado: {len(results)} archivos; {len(errors)} errores; originales intactos.')
    return results,errors

def main():
    p=argparse.ArgumentParser(description='Revisión OIC: comentarios y celdas relacionadas en amarillo por fila.')
    p.add_argument('entrada',help='Archivo XLSX o carpeta de archivos')
    p.add_argument('--corte',required=True,help='Fecha de corte AAAA-MM-DD')
    p.add_argument('--salida',help='Carpeta de salida, por defecto DEVOLUCIONES_OIC')
    args=p.parse_args()
    cut=dt.date.fromisoformat(args.corte)
    inp=Path(args.entrada);base=inp.parent if inp.is_file() else inp
    output=Path(args.salida) if args.salida else base/'DEVOLUCIONES_OIC'
    results,errors=batch(inp,output,cut)
    return 0 if results and not errors else 1

if __name__=='__main__':raise SystemExit(main())
