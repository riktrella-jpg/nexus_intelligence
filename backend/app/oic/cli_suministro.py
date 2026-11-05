"""Uso: python -m app.oic.cli_suministro Layout_Suministro.xlsx --corte 2026-10-31 --tipo ambos"""
import argparse
import json
from pathlib import Path
from .motor_suministro import review_file


def main():
    p=argparse.ArgumentParser(description='Revisor OIC de Medicamentos y Material de Curación · Nexus')
    p.add_argument('archivo',type=Path,help='Excel recibido del instituto con las columnas A:AD')
    p.add_argument('--corte',required=True,help='YYYY-MM-DD')
    p.add_argument('--salida',type=Path,help='Excel destino, nunca el original')
    p.add_argument('--tipo',choices=('ambos','medicamentos','material_curacion'),default='ambos')
    p.add_argument('--hoja',default=None,help='Nombre de hoja (BASE o BASE_REVISION)')
    p.add_argument('--dias',type=int,default=15)
    p.add_argument('--tol-contratado',default='1')
    p.add_argument('--tol-ejercido',default='0.01')
    p.add_argument('--sin-extras',action='store_true')
    args=p.parse_args()
    salida=args.salida or args.archivo.with_name(args.archivo.stem+'_REVISION_OIC.xlsx')
    summary=review_file(args.archivo,salida,args.corte,modo=args.tipo,sheet=args.hoja,
                        dias_pendiente=args.dias,tolerancia_contratado=args.tol_contratado,
                        tolerancia_ejercido=args.tol_ejercido,extras=not args.sin_extras)
    print(json.dumps({'archivo_salida':str(salida),**summary},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
