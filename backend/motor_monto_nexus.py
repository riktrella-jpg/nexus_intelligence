#!/usr/bin/env python3
"""Motor NEXUS v3: cálculo reproducible de montos sobre layout BASE.
Sin dependencias externas. No modifica el libro origen.
Uso:
 python motor_monto_nexus.py --origen "Layout_Suministro_Septiembre  (monto contratados).xlsx" --institucion HGMEL --salida resultados
Integración: from motor_monto_nexus import calcular_registros, ejecutar
"""
import argparse, csv, re, zipfile, unicodedata, json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from collections import defaultdict
from xml.etree import ElementTree as ET
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
CENT=Decimal('0.01')

def leer_hoja(archivo,nombre):
    with zipfile.ZipFile(archivo) as z:
        libro=ET.fromstring(z.read('xl/workbook.xml'))
        hoja=next((x for x in libro.iter(NS+'sheet') if x.get('name')==nombre),None)
        if hoja is None: raise ValueError('No existe la hoja %r'%nombre)
        relaciones=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rutas={x.get('Id'):x.get('Target').lstrip('/') for x in relaciones}
        ruta=rutas[hoja.get(REL+'id')]
        if not ruta.startswith('xl/'): ruta='xl/'+ruta
        textos=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            with z.open('xl/sharedStrings.xml') as f:
                for _,e in ET.iterparse(f,events=('end',)):
                    if e.tag==NS+'si':
                        textos.append(''.join(t.text or '' for t in e.iter(NS+'t')));e.clear()
        with z.open(ruta) as f:
            for _,e in ET.iterparse(f,events=('end',)):
                if e.tag!=NS+'row': continue
                registro={}
                for c in e:
                    if c.tag!=NS+'c':continue
                    match=re.match(r'[A-Z]+',c.get('r',''))
                    if not match:continue
                    v=c.find(NS+'v'); valor=v.text if v is not None else ''
                    if c.get('t')=='s' and valor:valor=textos[int(valor)]
                    if c.get('t')=='inlineStr':valor=''.join(t.text or '' for t in c.iter(NS+'t'))
                    registro[match.group()]=valor or ''
                yield int(e.get('r')),registro
                e.clear()

def normalizar(v):
    t=unicodedata.normalize('NFKD',str(v or '').upper()).replace('\xa0',' ')
    t=''.join(c for c in t if not unicodedata.combining(c))
    return ' '.join(t.split())

def decimal(v):
    if v is None:return None
    t=str(v).strip().replace(',','').replace('$','')
    try:
        return Decimal(t) if t else None
    except InvalidOperation:return None

def cent(v):return v.quantize(CENT,rounding=ROUND_HALF_UP)

def genérica(clave):
    c=normalizar(clave)
    return not c or c in ('N/A','NA','SIN CLAVE','SIN CLAVE DEL CNIS','NO APLICA','S/C')

def firma_descripcion(texto):
    # Solo normalización tipográfica, sin borrar números, calibres, tamaños o presentación.
    return re.sub(r'[^A-Z0-9]+',' ',normalizar(texto)).strip()

def calcular_registros(registros):
    """Entrada: iterable (numero_fila_excel, dict de columnas con letras BASE).
    Salida: (filas_detalle, resumen_contratos, indicadores). No usa referencia para decidir.
    'Monto estimado' incluye partidas diferenciadas por descripción; alertas impiden tratar
    ambigüedades como cifras validadas documentalmente.
    """
    vistos={}; grupos=defaultdict(list); detalles=[]; resumen={}
    for fila,d in registros:
        inst=normalizar(d.get('D')); contrato=normalizar(d.get('H'))
        prov=normalizar(d.get('K')); clave=normalizar(d.get('AC'))
        desc=firma_descripcion(d.get('AD')); cantidad=decimal(d.get('AJ'));precio=decimal(d.get('AK'))
        reportado=decimal(d.get('P'));base=cent(cantidad*precio) if cantidad is not None and precio is not None else None
        iva='SIN INFORMACION'
        if base is not None and reportado is not None:
            if abs(cent(reportado)-base)<=CENT:iva='BASE SIN IVA'
            elif abs(cent(reportado)-cent(base*Decimal('1.16')))<=CENT:iva='REPORTADO CON IVA 16%'
            else:iva='NO CONCILIA BASE NI IVA 16%'
        sin_clave=genérica(clave)
        # Misma descripción, cantidad y precio -> repetición de movimiento de suministro.
        # Diferente descripción (incluyendo talla/calibre) -> posible partida distinta.
        # Sin descripción -> no es seguro desduplicar por clave e importe: revisar.
        fingerprint=(inst,contrato,prov,clave,desc,base,cantidad,precio)
        grupo=(inst,contrato,prov,clave,base,cantidad,precio)
        grupos[grupo].append(len(detalles))
        riesgo=[]
        if not contrato:riesgo.append('SIN CONTRATO')
        if base is None:riesgo.append('FALTA CANTIDAD/PRECIO')
        if not desc:riesgo.append('SIN DESCRIPCION')
        if iva=='NO CONCILIA BASE NI IVA 16%':riesgo.append('IVA/IMPORTE NO CONCILIA')
        if cantidad is not None and cantidad<0 or precio is not None and precio<0:riesgo.append('VALOR NEGATIVO')
        if fingerprint in vistos:
            primero=vistos[fingerprint];estado='REPETIDO MISMA PARTIDA';aporte=Decimal('0')
        elif base is None or not contrato or not desc or (cantidad is not None and cantidad<0) or (precio is not None and precio<0):
            primero='';estado='NO CUANTIFICABLE / REVISAR';aporte=Decimal('0')
        else:
            vistos[fingerprint]=fila;primero='';estado='PARTIDA CONTABILIZADA';aporte=base
        detalles.append({'fila_excel':fila,'institucion':inst,'contrato':contrato,'proveedor':prov,'clave':clave,
                         'descripcion_original':d.get('AD',''),'cantidad_contratada':str(cantidad or 0),
                         'precio_unitario':str(precio or 0),'monto_reportado':str(cent(reportado)) if reportado is not None else '',
                         'monto_base_sin_iva':str(base) if base is not None else '',
                         'tipo_clave':'GENERICA' if sin_clave else 'CNIS','iva':iva,
                         'estado':estado,'duplicado_de_fila':primero,'monto_depurado':str(aporte),
                         'alertas':riesgo,'_aporte':aporte})
    # Candidatos con misma clave, cantidad, precio e importe, pero descripción diferente.
    # No excluirlos por defecto. Reportar la posible superposición de importe global.
    for inds in grupos.values():
        descripciones={firma_descripcion(detalles[i]['descripcion_original']) for i in inds}
        if len(descripciones)>1:
            for i in inds:
                if 'POSIBLE IMPORTE GLOBAL REPETIDO ENTRE PARTIDAS' not in detalles[i]['alertas']:
                    detalles[i]['alertas'].append('POSIBLE IMPORTE GLOBAL REPETIDO ENTRE PARTIDAS')
    for row in detalles:
        k=(row['institucion'],row['contrato'])
        if k not in resumen:resumen[k]={'institucion':k[0],'contrato':k[1],'filas':0,'partidas_contadas':0,
                                        'monto_estimado_sin_iva':Decimal('0'),'filas_alerta':0,'alertas':set()}
        item=resumen[k];item['filas']+=1
        if row['estado']=='PARTIDA CONTABILIZADA':item['partidas_contadas']+=1
        item['monto_estimado_sin_iva']+=row['_aporte']
        if row['alertas']:
            item['filas_alerta']+=1;item['alertas'].update(row['alertas'])
        row['alertas']='; '.join(row['alertas']);del row['_aporte']
    contratos=[]
    for x in sorted(resumen.values(),key=lambda x:(x['institucion'],x['contrato'])):
        contratos.append({**x,'monto_estimado_sin_iva':str(x['monto_estimado_sin_iva']),
                          'alertas':'; '.join(sorted(x['alertas'])),
                          'estado_validacion':'REQUIERE REVISION' if x['alertas'] else 'SIN ALERTAS AUTOMATICAS'})
    total=sum((Decimal(x['monto_estimado_sin_iva']) for x in contratos),Decimal('0'))
    indicadores={'filas':len(detalles),'contratos':len(contratos),
                 'partidas_contadas':sum(x['partidas_contadas'] for x in contratos),
                 'contratos_con_alertas':sum(bool(x['alertas']) for x in contratos),
                 'monto_estimado_sin_iva':str(cent(total)),
                 'criterio':'Partida: institucion+contrato+proveedor+clave+descripcion normalizada+cantidad+precio+importe base; ordenes repetidas no incrementan el contrato',
                 'advertencia':'Monto estimado desde layout; sin ID de partida ni contrato documental no acredita monto contractual definitivo.'}
    return detalles, contratos, indicadores

def escribir_csv(path,registros):
    if not registros:return
    with open(path,'w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(registros[0]),extrasaction='ignore');writer.writeheader();writer.writerows(registros)

def ejecutar(origen,institucion=None,salida='resultado_nexus',hoja='BASE'):
    ruta=Path(salida);ruta.mkdir(parents=True,exist_ok=True)
    filas=((n,d) for n,d in leer_hoja(origen,hoja) if n>2 and (not institucion or normalizar(d.get('D'))==normalizar(institucion)))
    detalle,contratos,indicadores=calcular_registros(filas)
    escribir_csv(ruta/'detalle_depuracion.csv',detalle)
    escribir_csv(ruta/'resumen_contratos.csv',contratos)
    escribir_csv(ruta/'pendientes_revision.csv',[r for r in detalle if r['alertas'] or r['estado']=='NO CUANTIFICABLE / REVISAR'])
    (ruta/'indicadores.json').write_text(json.dumps(indicadores,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(indicadores,ensure_ascii=False,indent=2))
    return indicadores

if __name__=='__main__':
    p=argparse.ArgumentParser(description='Motor NEXUS v3: mismo layout, sin forzar conciliacion con referencia')
    p.add_argument('--origen',required=True);p.add_argument('--institucion');p.add_argument('--salida',default='resultado_nexus');p.add_argument('--hoja',default='BASE')
    args=p.parse_args();ejecutar(args.origen,args.institucion,args.salida,args.hoja)
