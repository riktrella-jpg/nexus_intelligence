#!/usr/bin/env python3
"""NEXUS V4: consolidación auditable de montos contratados.

Dos orígenes de resultado:
  REFERENCIA_VALIDADA: suma de columna P, hoja HGMEL del libro NOTA.
  ESTIMACION_AUTOMATICA: motor V3 sobre BASE del libro origen.

La referencia NO se utiliza para cambiar reglas de V3 ni distribuir diferencias.
Se exporta un CSV por contrato, una conciliación y un detalle de procedencia.

Uso:
 python nexus_montos_consolidados_v4.py --origen "Layout_Suministro_Septiembre  (monto contratados).xlsx" --referencia "Layout_Suministro_Septiembre_Nota_12-10-26.xlsx" --institucion HGMEL --salida resultados_nexus_v4
"""
import argparse,csv,json,sys
from pathlib import Path
from collections import defaultdict
from decimal import Decimal,ROUND_HALF_UP
try:
    from .motor_monto_nexus import leer_hoja,normalizar,decimal,calcular_registros
except ImportError:
    from motor_monto_nexus import leer_hoja,normalizar,decimal,calcular_registros
C=Decimal('0.01')
def dinero(x):return str(x.quantize(C,rounding=ROUND_HALF_UP))
def csv_out(path,rows,fields):
    with open(path,'w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
def ejecutar(origen,referencia=None,institucion='HGMEL',salida='resultados_nexus_v4',objetivo=None):
    out=Path(salida);out.mkdir(parents=True,exist_ok=True)
    origen_rows=[(n,r) for n,r in leer_hoja(origen,'BASE') if n>2 and normalizar(r.get('D'))==normalizar(institucion)]
    detalle,estimados,indicadores=calcular_registros(origen_rows)
    estimacion={r['contrato']:Decimal(r['monto_estimado_sin_iva']) for r in estimados}
    alertas={r['contrato']:r['alertas'] for r in estimados}
    csv_out(out/'detalle_calculo_automatico.csv',detalle,list(detalle[0]) if detalle else ['fila_excel'])
    csv_out(out/'montos_estimados_por_contrato.csv',estimados,list(estimados[0]) if estimados else ['contrato'])
    if not referencia:
        informe={'estado':'ESTIMACION_NO_CONCILIADA','institucion':institucion,'filas_origen':len(origen_rows),
                 'contratos':len(estimados),'monto_estimado_sin_iva':indicadores['monto_estimado_sin_iva'],
                 'aviso':'No hay referencia validada: NO se puede afirmar que coincide con un objetivo.'}
        (out/'resumen_validacion.json').write_text(json.dumps(informe,indent=2,ensure_ascii=False),encoding='utf-8')
        print(json.dumps(informe,indent=2,ensure_ascii=False));return informe
    totales=defaultdict(lambda:Decimal('0'));filas=defaultdict(int);origenes=[]
    for n,r in leer_hoja(referencia,institucion):
        if n==1:continue
        if normalizar(r.get('D'))!=normalizar(institucion):continue
        contrato=normalizar(r.get('H'));valor=decimal(r.get('P'))
        if not contrato:raise ValueError(f'Fila {n}: falta numero de contrato en hoja {institucion}')
        if valor is None:raise ValueError(f'Fila {n}: monto contratado P no numerico: {r.get("P")!r}')
        totales[contrato]+=valor;filas[contrato]+=1
        origenes.append({'fila_hoja_referencia':n,'institucion':institucion,'contrato':contrato,'monto_referencia_fila':dinero(valor),'fuente':'Hoja '+institucion+' columna P'})
    ref_total=sum(totales.values(),Decimal(0));estim_total=sum(estimacion.values(),Decimal(0))
    contratos=sorted(set(totales)|set(estimacion));consolidado=[];conciliacion=[]
    for contrato in contratos:
        rv=totales.get(contrato);ev=estimacion.get(contrato,Decimal('0'))
        if rv is not None:
            consolidado.append({'institucion':institucion,'contrato':contrato,'monto_contratado_consolidado':dinero(rv),
                                'filas_referencia':filas[contrato],'metodo':'REFERENCIA_HGMEL_COLUMNA_P','estado':'CONCILIADO_CON_LAYOUT_DE_REFERENCIA'})
        conciliacion.append({'institucion':institucion,'contrato':contrato,
                             'monto_referencia':dinero(rv) if rv is not None else '',
                             'monto_calculo_automatico':dinero(ev),
                             'diferencia_automatico_menos_referencia':dinero(ev-rv) if rv is not None else '',
                             'alertas_motor_v3':alertas.get(contrato,''),'estado':'COINCIDE' if rv is not None and abs(ev-rv)<C else 'DIFERENCIA'})
    csv_out(out/'montos_contratados_consolidados.csv',consolidado,
            ['institucion','contrato','monto_contratado_consolidado','filas_referencia','metodo','estado'])
    csv_out(out/'conciliacion_contratos.csv',conciliacion,
            ['institucion','contrato','monto_referencia','monto_calculo_automatico','diferencia_automatico_menos_referencia','alertas_motor_v3','estado'])
    csv_out(out/'trazabilidad_referencia.csv',origenes,
            ['fila_hoja_referencia','institucion','contrato','monto_referencia_fila','fuente'])
    # Comprobación de conservación: centavos consolidados = centavos acumulados de referencia.
    suma_csv=sum((Decimal(r['monto_contratado_consolidado']) for r in consolidado),Decimal(0))
    esperado=Decimal(objetivo) if objetivo is not None else None
    informe={'institucion':institucion,'filas_referencia':len(origenes),'contratos_referencia':len(totales),
             'monto_consolidado_referencia':dinero(ref_total),'monto_exportado_csv':dinero(suma_csv),
             'monto_calculo_automatico_v3':dinero(estim_total),
             'diferencia_automatico_menos_referencia':dinero(estim_total-ref_total),
             'contratos_con_diferencias':sum(x['estado']=='DIFERENCIA' for x in conciliacion),
             'objetivo':str(esperado) if esperado is not None else None,
             'objetivo_coincide':dinero(ref_total)==dinero(esperado) if esperado is not None else None,
             'metodologia':'CSV consolidado = sumatoria de valores existentes en HGMEL!P por numero de contrato; no es recálculo independiente.',
             'advertencia':'La conciliación exacta con la referencia NO valida que el motor automático ya reproduzca su lógica.'}
    (out/'resumen_validacion.json').write_text(json.dumps(informe,indent=2,ensure_ascii=False),encoding='utf-8')
    assert suma_csv.quantize(C)==ref_total.quantize(C), 'Diferencia en CSV por redondeo'
    if esperado is not None and suma_csv.quantize(C)!=esperado.quantize(C):raise ValueError('La referencia no coincide con el objetivo: revisar fuente, no forzar ajuste.')
    print(json.dumps(informe,indent=2,ensure_ascii=False));return informe
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--origen',required=True);p.add_argument('--referencia');p.add_argument('--institucion',default='HGMEL');p.add_argument('--salida',default='resultados_nexus_v4');p.add_argument('--objetivo',default=None)  # Integración NEXUS: sin cifra objetivo por defecto (no forzar resultados)
    a=p.parse_args();ejecutar(a.origen,a.referencia,a.institucion,a.salida,a.objetivo if a.referencia else None)
