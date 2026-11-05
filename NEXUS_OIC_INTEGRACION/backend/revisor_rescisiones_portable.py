# -*- coding: utf-8 -*-
"""Revisor portátil de layouts de rescisión administrativa (sector salud).

Crea COPIAS del Excel institucional, sin alterar el archivo origen.
Se preservan intactas todas las hojas, celdas, formulas y formatos.
Se agrega UNA PESTAÑA adicional OBSERVACIONES con filtros.
No se remarcan, recolorean ni comentan las hojas originales.

Dependencias: Python 3.10+ (solo biblioteca estándar) y ooxml_rescision.py, junto a este script.
Conserva gráficos y tablas dinámicas existentes siempre que el archivo original sea OOXML válido.
Uso:
    python revisor_layout_rescisiones.py "Layout_Rescisión_160_Octubre.xlsx" --corte 2026-10-31
    python revisor_layout_rescisiones.py "C:/layouts" --corte 2026-10-31
    python revisor_layout_rescisiones.py "C:/layouts" --salida "C:/layouts/devoluciones" --corte 2026-10-31

Las observaciones automáticas no sustituyen la revisión documental y jurídica.
"""
from __future__ import annotations

import argparse
import calendar
import collections
import datetime as dt
import math
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ooxml_rescision import read_sheets, write_report_only

VALID_STATUS = {
    'EN PROCESO', 'RESCINDIDO', 'SUSPENSION DE LA RESCISION',
}
VALID_FUENTE = {
    'UNICA', 'UNICA CON PATENTE', 'PATENTE', 'OTRA',
}
COLORS = {
    'ERROR': '#F8D7DA',       # rojo suave: diferencia/contradicción verificable
    'REVISAR': '#FFF2CC',     # ámbar: requiere confirmación institucional
    'DOCUMENTAL': '#DCEAF7', # azul: falta evidencia/explicación
    'RELACIONADA': '#E5EAF2',# gris azulado: dato empleado en el contraste
}
RANK = {'DOCUMENTAL': 1, 'REVISAR': 2, 'ERROR': 3}
PRIORITY = {'ERROR': 0, 'REVISAR': 1, 'DOCUMENTAL': 2}
# Campos del diccionario y sus posibles variaciones. No se usan posiciones fijas.
ALIASES = {
 'ramo':['ramo'],
 'descripcion_ramo':['descripcion'],
 'siglas':['siglas'],
 'ur':['cve ur','clave ur','clave de la unidad responsable'],
 'unidad':['unidad responsable'],
 'contrato':['no de contrato','numero de contrato','num contrato','no contrato'],
 'proveedor':['proveedor','razon social'],
 'monto':['monto contratado','importe contratado'],
 'cantidad_contratada':['cantidad contratada'],
 'precio':['precio unitario'],
 'cantidad_solicitada':['cantidad solicitada'],
 'no_entregada':['cantidad no entregada','piezas no entregadas'],
 'clave':['clave del medicamento','clave del insumo'],
 'descripcion_insumo':['descripcion'],
 'fuente':['fuente'],
 'estatus':['estatus de la rescision','estatus de rescisión','estatus de rescision'],
 'sentido':['en caso de suspension indicar el sentido'],
 'motivos':['motivos de rescision'],
 'inicio':['fecha de notificacion al proveedor del inicio'],
 'formal':['fecha de notificacion de la formalizacion'],
 'suspension_fecha':['en caso de la suspension de la rescision especificar la fecha'],
 'soporte':['soporte documental'],
 'comentarios':['comentarios'],
 'clue':['clue'],
}
MONTHS = {name:i for i,name in enumerate([
    '', 'enero','febrero','marzo','abril','mayo','junio','julio','agosto',
    'septiembre','octubre','noviembre','diciembre'
])}


def normalize(x: Any) -> str:
    if x is None: return ''
    s=unicodedata.normalize('NFKD', str(x))
    s=''.join(ch for ch in s if not unicodedata.combining(ch))
    s=re.sub(r'[^A-Z0-9]+',' ',s.upper())
    return ' '.join(s.split())


def text(x: Any) -> str:
    if x is None: return ''
    if isinstance(x,dt.datetime): return x.strftime('%d/%m/%Y')
    if isinstance(x,dt.date): return x.isoformat()
    if isinstance(x,float) and x.is_integer(): return str(int(x))
    return str(x).strip()


def missing(x: Any) -> bool:
    s=normalize(x)
    return not s or s in {'N A','NA','N D','ND','NO APLICA','NO APLICABLE','SIN DATO','S D','NULL','NO ESPECIFICADO', 'NINGUNO'} or s.startswith('NO APLICA ')


def number(x: Any):
    if x is None or isinstance(x,bool) or missing(x): return None
    if isinstance(x,(int,float)):
        return float(x) if math.isfinite(float(x)) else None
    s=text(x).replace(' ','').replace('$','').replace('MXN','')
    # Acepta miles en español/inglés sólo si la notación no es ambigua.
    if re.fullmatch(r'-?\d{1,3}(,\d{3})+(\.\d+)?',s): s=s.replace(',','')
    elif re.fullmatch(r'-?\d{1,3}(\.\d{3})+(,\d+)?',s): s=s.replace('.','').replace(',','.')
    elif re.fullmatch(r'-?\d+,\d{1,2}',s): s=s.replace(',','.')
    try:
        v=float(s)
        return v if math.isfinite(v) else None
    except ValueError: return None


def parse_date(x: Any):
    if x is None or isinstance(x,bool) or missing(x): return None
    if isinstance(x,dt.datetime): return x.date()
    if isinstance(x,dt.date): return x
    if isinstance(x,(int,float)):
        if 20000 <= float(x) < 100000:
            try: return (dt.datetime(1899,12,30)+dt.timedelta(days=float(x))).date()
            except (OverflowError, ValueError): return None
        return None
    s=text(x).strip()
    for fmt in ('%d/%m/%Y','%Y-%m-%d','%d-%m-%Y','%Y/%m/%d','%d.%m.%Y'):
        try: return dt.datetime.strptime(s,fmt).date()
        except ValueError: pass
    m=re.fullmatch(r'(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(?:de\s+)?(\d{4})',s.lower())
    if m:
        mo=MONTHS.get(normalize(m.group(2)).lower())
        if mo:
            try: return dt.date(int(m.group(3)),mo,int(m.group(1)))
            except ValueError: return None
    return None


def col_letter(c0: int):
    c=c0+1; ans=''
    while c: c,r=divmod(c-1,26); ans=chr(65+r)+ans
    return ans


def extract_cell(address: str):
    m=re.match(r'\$?([A-Z]+)\$?(\d+)',address)
    if not m: return 0,0
    col=0
    for x in m.group(1): col=col*26+ord(x)-64
    return int(m.group(2))-1,col-1


def infer_corte(path: Path):
    nm=normalize(path.stem).lower()
    year_matches=re.findall(r'20\d{2}',nm)
    yr=int(year_matches[-1]) if year_matches else dt.date.today().year
    for mes,num in MONTHS.items():
        if mes and re.search(r'\b'+mes+r'\b',nm):
            return dt.date(yr,num,calendar.monthrange(yr,num)[1])
    # Sin mes reconocible: no inferir silenciosamente un corte contractual.
    return None


def find_mapping(headings):
    """Detecta semánticamente encabezados, incluso con CLUE u otras columnas."""
    normal=[normalize(x) for x in headings]
    mapping={}
    for key, candidates in ALIASES.items():
        if key in {'descripcion_ramo','descripcion_insumo'}: continue
        best=[]
        for ix,s in enumerate(normal):
            for a in candidates:
                aa=normalize(a)
                if s==aa or s.startswith(aa+' ') or (' ' + aa + ' ') in ' '+s+' ':
                    best.append((2 if s==aa else 1, ix))
                    break
        if best: mapping[key]=max(best, key=lambda z:(z[0],-z[1]))[1]
    descs=[i for i,s in enumerate(normal) if s=='DESCRIPCION' or s.startswith('DESCRIPCION ')]
    if descs:
        mapping['descripcion_ramo']=descs[0]
        mapping['descripcion_insumo']=descs[-1] if len(descs)>1 else descs[0]
    if 'estatus' not in mapping:
        for i,s in enumerate(normal):
            if s.startswith('ESTATUS') and 'RESCISION' in s:
                mapping['estatus']=i;break
    return mapping


def discover_sheets(wb):
    """Retorna (hoja, fila_encabezado_base0, mapa, matriz), sin alterar contenido."""
    result=[]
    for i in range(len(wb.worksheets.items)):
        sh=wb.worksheets.get_item_at(i)
        if normalize(sh.name).startswith(('DICCIONARIO','OBSERVACIONES','ANALISIS')): continue
        addr=sh.get_used_range().address
        _,lastcol=extract_cell(addr.split(':')[-1]); endrow,_=extract_cell(addr.split(':')[-1])
        if endrow<2: continue
        maxcols=min(lastcol+1,100)
        # En los layouts analizados la cabecera está en la fila 2; buscar hasta 12.
        head=sh.get_range_by_indexes(0,0,min(endrow+1,12),maxcols).values
        best=None
        for r, row in enumerate(head):
            mapping=find_mapping(row)
            score=sum(k in mapping for k in ('contrato','proveedor','estatus','monto','precio','cantidad_contratada','cantidad_solicitada'))
            if {'contrato','proveedor','estatus','fuente','motivos','inicio','cantidad_contratada'} <= mapping.keys() and score>=6:
                if best is None or score>best[0]: best=(score,r,mapping)
        if best:
            full=sh.get_range_by_indexes(best[1],0,endrow-best[1]+1,maxcols).values
            result.append((sh,best[1],best[2],full))
    return result

@dataclass
class Finding:
    severity: str
    sheet: str
    row: int
    cell: str
    field: str
    rule: str
    detail: str
    action: str
    unit: str
    contract: str
    value: str
    related: tuple[str,...]=field(default_factory=tuple)

class Auditor:
    def __init__(self, cutoff:dt.date):
        self.cutoff=cutoff
        self.findings=[]
        self.keys=set()
    def add(self,sev,sh,row,c,m,rule,detail,action,related=()):
        if c is None: return
        letter=col_letter(c)
        cell=f'{letter}{row}'
        unique=(sh,row,c,rule)
        if unique in self.keys: return
        self.keys.add(unique)
        v=lambda key:m['get'](key)
        self.findings.append(Finding(
            sev,sh,row,cell,m['heading'](c),rule,detail,action,
            text(v('unidad')) or text(v('siglas')) or text(v('ur')),
            text(v('contrato')),text(m['raw'](c))[:300],
            tuple(f'{col_letter(m["map"][k])}{row}' for k in related if k in m['map'] and m['map'][k]!=c)
        ))
    def review(self,sh,header_row,mapping,data):
        rows=[]
        for i,line in enumerate(data[1:],header_row+2):
            if not line:continue
            def val(k,ln=line):return ln[mapping[k]] if k in mapping and mapping[k]<len(ln) else None
            if not any(not missing(val(k)) for k in ('contrato','proveedor','estatus') if k in mapping): continue
            def heading(c): return text(data[0][c]).replace('\n',' ').strip()[:100]
            def raw(c): return line[c] if c<len(line) else None
            ctx={'get':val,'map':mapping,'heading':heading,'raw':raw}
            def add(sev,key,rule,detail,action,related=()):
                self.add(sev,sh,i,mapping.get(key),ctx,rule,detail,action,related)
            st=normalize(val('estatus'))
            fu=normalize(val('fuente'))
            # Campos base que identifican un registro.
            for fieldkey in ('ramo','ur','unidad','contrato','proveedor','clave','descripcion_insumo'):
                if fieldkey in mapping and missing(val(fieldkey)):
                    add('REVISAR',fieldkey,'DATO_IDENTIFICADOR','Falta un dato de identificación del registro.',
                        'Capturar dato o justificar expresamente su no aplicabilidad.')
            if 'ramo' in mapping and number(val('ramo')) not in (12.0,None):
                add('REVISAR','ramo','RAMO_INUSUAL','El ramo es distinto de 12 en el archivo sectorial.',
                    'Confirmar rama presupuestal reportada.')
            if 'fuente' in mapping and fu not in VALID_FUENTE:
                add('REVISAR','fuente','FUENTE_FUERA_CATALOGO',
                    f'Fuente «{text(val("fuente"))[:80]}» fuera del diccionario.',
                    'Seleccionar Única, Única con patente, Patente u Otra; confirmar la clasificación.')
            if 'estatus' in mapping and st not in VALID_STATUS:
                add('REVISAR','estatus','ESTATUS_FUERA_CATALOGO',
                    f'El texto «{text(val("estatus"))[:85]}» no es uno de los tres estatus permitidos.',
                    'Confirmar el estado jurídico y capturar literalmente EN PROCESO, RESCINDIDO o SUSPENSIÓN DE LA RESCISIÓN; trasladar explicaciones a Comentarios.')
            # Cantidades, unidad monetaria y aritmética.
            vals={k:number(val(k)) for k in ('monto','cantidad_contratada','precio','cantidad_solicitada','no_entregada')}
            for k,n in vals.items():
                if k not in mapping: continue
                if n is None:
                    add('REVISAR',k,'NUMERICO_NO_VALIDO',
                        f'El campo cuantitativo contiene un valor ausente/no numérico («{text(val(k))[:65]}»).',
                        'Capturar cifra numérica válida o justificar que no aplica.')
                elif n<0:
                    add('ERROR',k,'NUMERICO_NEGATIVO',f'Valor negativo ({n:g}) en un campo que representa un importe o piezas.',
                        'Rectificar el valor; si representa ajuste, documentarlo en el campo correspondiente.')
                elif k in ('monto','cantidad_contratada','precio') and n==0:
                    add('REVISAR',k,'IMPORTE_O_BASE_CERO','Importe, precio o cantidad contratada igual a cero.',
                        'Verificar la base económica y la partida correspondiente.')
                if n is not None and k in ('cantidad_contratada','cantidad_solicitada','no_entregada') and not math.isclose(n,round(n),abs_tol=1e-8):
                    add('ERROR',k,'PIEZAS_NO_ENTERAS',f'Cantidad de piezas con decimales ({n:g}).',
                        'Expresar piezas en números enteros; verificar si se reportó una unidad distinta.')
            monto,q,p=vals['monto'],vals['cantidad_contratada'],vals['precio']
            if None not in (monto,q,p) and min(monto,q,p)>0:
                expected=round(q*p,2)
                difference=round(monto-expected,2)
                # $0.05 tolera residuos de precisión, no diferencias sustantivas.
                if abs(difference)>max(0.05,abs(expected)*0.000001):
                    add('ERROR','monto','MONTO_X_PRECIO',
                        f'Importe {monto:,.2f}; cantidad × precio = {expected:,.2f}; diferencia = {difference:,.2f} MXN.',
                        'Verificar que el importe de la partida sea sin IVA y coincida con cantidad contratada × precio unitario.',
                        ('cantidad_contratada','precio'))
            qc,qs,qn=vals['cantidad_contratada'],vals['cantidad_solicitada'],vals['no_entregada']
            if qs is not None and qc is not None and qs>qc+1e-8:
                add('REVISAR','cantidad_solicitada','SOLICITADA_SUPERA_CONTRATADA',
                    f'Solicitada {qs:g} > contratada {qc:g}.',
                    'Corroborar acumulación de órdenes/modificaciones; corregir cifras o justificar.',('cantidad_contratada',))
            if qn is not None and qs is not None and qn>qs+1e-8:
                add('ERROR','no_entregada','NO_ENTREGADA_SUPERA_SOLICITADA',
                    f'No entregada {qn:g} > solicitada {qs:g}.',
                    'Revisar órdenes de suministro y registrar la cantidad efectivamente incumplida.',('cantidad_solicitada',))
            if qn is not None and qc is not None and qn>qc+1e-8:
                add('REVISAR','no_entregada','NO_ENTREGADA_SUPERA_CONTRATADA',
                    f'No entregada {qn:g} > contratada {qc:g}.',
                    'Verificar unidades y acumulación de órdenes; explicar la diferencia.',('cantidad_contratada',))
            if st in VALID_STATUS and qn==0 and st in {'EN PROCESO','RESCINDIDO'} and any(w in normalize(val('motivos')) for w in ('FALTA DE ENTREGA','INCUMPLIMIENTO DE ENTREGA')):
                add('REVISAR','no_entregada','INCUMPLIMIENTO_CON_CERO',
                    'Se declara incumplimiento de entrega, pero las piezas no entregadas son cero.',
                    'Verificar el corte de la entrega, la causa de rescisión y el número de piezas.',('motivos','estatus'))
            dates={k:parse_date(val(k)) for k in ('inicio','formal','suspension_fecha')}
            for k,d in dates.items():
                if k not in mapping: continue
                if d and d>self.cutoff:
                    add('ERROR',k,'FECHA_POSTERIOR_CORTE',
                        f'Fecha {d:%d/%m/%Y} posterior al corte {self.cutoff:%d/%m/%Y}.',
                        'Corregir la fecha o confirmar el corte reportado.')
                if d and d.year<2018:
                    add('REVISAR',k,'FECHA_MUY_ANTERIOR',
                        f'Fecha {d:%d/%m/%Y} inusualmente antigua.',
                        'Confirmar que corresponda al procedimiento reportado.')
                if not d and not missing(val(k)):
                    add('REVISAR',k,'FECHA_NO_CAPTURADA',
                        'El campo de fecha contiene narración/texto en lugar de fecha o N/A.',
                        'Capturar fecha en formato dd/mm/aaaa o N/A cuando proceda; llevar la explicación a Comentarios.')
            start,formal,susp=dates['inicio'],dates['formal'],dates['suspension_fecha']
            if start and formal and formal<start:
                add('ERROR','formal','FORMAL_ANTES_DE_INICIO',
                    f'Formalización {formal:%d/%m/%Y} anterior al inicio {start:%d/%m/%Y}.',
                    'Corregir fechas conforme a constancias de notificación.',('inicio',))
            if start and susp and susp<start:
                add('REVISAR','suspension_fecha','SUSPENSION_ANTES_INICIO',
                    f'Fecha de suspensión/entrega {susp:%d/%m/%Y} anterior al inicio {start:%d/%m/%Y}.',
                    'Confirmar la naturaleza de la fecha y las actuaciones del procedimiento.',('inicio',))
            if st=='RESCINDIDO':
                if not start:
                    add('REVISAR','inicio','RESCINDIDO_SIN_INICIO',
                        'Se reporta RESCINDIDO sin fecha acreditable de notificación de inicio.',
                        'Registrar fecha de notificación al proveedor y soporte documental.',('estatus',))
                if not formal:
                    add('ERROR','formal','RESCINDIDO_SIN_FORMALIZACION',
                        'Se reporta RESCINDIDO sin fecha de notificación de formalización.',
                        'Capturar la fecha real y acreditar resolución/notificación.',('estatus',))
            if st=='EN PROCESO':
                if not start:
                    add('REVISAR','inicio','PROCESO_SIN_INICIO',
                        'EN PROCESO requiere procedimiento iniciado/notificado; falta fecha válida.',
                        'Confirmar existencia de notificación de inicio o reclasificar estatus.',('estatus',))
                if formal:
                    add('REVISAR','formal','PROCESO_CON_FORMALIZACION',
                        'Se reporta EN PROCESO, pero existe fecha de formalización.',
                        'Validar si debe cambiar a RESCINDIDO u otro estatus.',('estatus',))
            if st=='SUSPENSION DE LA RESCISION':
                if missing(val('sentido')):
                    add('REVISAR','sentido','SUSPENSION_SIN_SENTIDO',
                        'Falta indicar qué originó la suspensión.',
                        'Precisar acuerdo, conciliación, entrega o razón acreditada.',('estatus',))
                if 'NO SE TRATO DE UNA SUSPENSION' in normalize(val('sentido')) or 'NO EXISTIO SUSPENSION' in normalize(val('sentido')):
                    add('ERROR','sentido','SUSPENSION_CONTRADICTORIA',
                        'El estatus indica suspensión, pero su justificación dice que no existió.',
                        'Aclarar estatus y sentido jurídicamente correcto.',('estatus',))
                if not susp:
                    add('REVISAR','suspension_fecha','SUSPENSION_SIN_FECHA',
                        'No hay fecha de suspensión o entrega acordada interpretable.',
                        'Indicar la(s) fecha(s) aplicable(s) o explicar por qué no corresponde.',('estatus',))
            if st in {'EN PROCESO','RESCINDIDO','SUSPENSION DE LA RESCISION'} and missing(val('motivos')):
                add('REVISAR','motivos','SIN_MOTIVO','El motivo de rescisión está vacío o marcado N/A.',
                    'Describir el incumplimiento o supuesto de rescisión iniciado.',('estatus',))
            if st in VALID_STATUS and missing(val('soporte')):
                add('DOCUMENTAL','soporte','SIN_SOPORTE','Falta referencia documental para acreditar el estado del procedimiento.',
                    'Identificar oficio, acuse, acuerdo o resolución, según corresponda.',('estatus',))
            if st=='RESCINDIDO' and 'SE CONTINUA CON EL PROCESO' in normalize(val('comentarios')):
                add('REVISAR','comentarios','RESCINDIDO_VS_COMENTARIO',
                    'Comentarios indican que continúa el proceso, pero el estatus ya es RESCINDIDO.',
                    'Actualizar comentario o confirmar el estatus y su fecha.',('estatus','formal'))
            if st in VALID_STATUS and 'NO SE INICIO PROCEDIMIENTO' in normalize(val('comentarios')):
                add('REVISAR','comentarios','SIN_INICIO_VS_ESTATUS',
                    'Comentarios señalan que no se inició procedimiento formal aunque tiene estatus activo.',
                    'Validar notificación de inicio y clasificación reportada.',('estatus','inicio'))
            # Para archivos ya observados se conservan sus anotaciones y se registran en el concentrado.
            for cx,head in enumerate(data[0]):
                if normalize(head).startswith('INCONSISTENCIA') and not missing(raw(cx)):
                    explanation=text(raw(cx))
                    key='estatus' if 'ESTATUS' in normalize(explanation) else (
                        'fuente' if 'FUENTE' in normalize(explanation) else (
                        'monto' if 'MONTO' in normalize(explanation) or 'IMPORTE' in normalize(explanation) else (
                        'no_entregada' if 'NO ENTREGADA' in normalize(explanation) or 'PIEZAS' in normalize(explanation) else None)))
                    add('REVISAR', key or 'contrato','OBSERVACION_PREVIA_'+str(cx),
                        'Observación preexistente: '+explanation[:250],
                        'Atender la observación ya formulada; registrar aclaración o corrección.')
            rows.append((i,line,ctx))
        # Validaciones transversales por contrato: repetir contrato con distintas claves es legítimo.
        groups=collections.defaultdict(list)
        for r,line,ctx in rows:
            contract=normalize(ctx['get']('contrato'))
            if contract: groups[contract].append((r,line,ctx))
        for contract,items in groups.items():
            if len(items)<2: continue
            suppliers=collections.defaultdict(list)
            sts=collections.defaultdict(list)
            dup=collections.defaultdict(list)
            for r,line,ctx in items:
                suppliers[normalize(ctx['get']('proveedor'))].append(r)
                if normalize(ctx['get']('estatus')) in VALID_STATUS:
                    sts[normalize(ctx['get']('estatus'))].append(r)
                # Duplicado exacto cuantitativo, no repetir sólo por contrato o clave.
                signature=(normalize(ctx['get']('proveedor')),normalize(ctx['get']('clave')),
                    normalize(ctx['get']('descripcion_insumo')),number(ctx['get']('monto')),
                    number(ctx['get']('cantidad_contratada')),number(ctx['get']('precio')),
                    number(ctx['get']('cantidad_solicitada')),number(ctx['get']('no_entregada')))
                if signature[0] and signature[1]:dup[signature].append(r)
            if len([k for k in suppliers if k])>1:
                for r,line,ctx in items:
                    self.add('REVISAR',sh,r,mapping.get('proveedor'),ctx,'PROVEEDORES_POR_CONTRATO',
                        f'Mismo contrato con proveedores diferentes en filas {", ".join(str(x[0]) for x in items[:12])}.',
                        'Corroborar que el contrato corresponda al mismo proveedor; verificar posibles errores de captura.',('contrato',))
            if len(sts)>1:
                for r,line,ctx in items:
                    if normalize(ctx['get']('estatus')) in sts:
                        self.add('REVISAR',sh,r,mapping.get('estatus'),ctx,'ESTATUS_DISTINTO_CONTRATO',
                            'El contrato se reporta con diferentes estatus entre sus partidas.',
                            'Confirmar si hay procedimientos independientes por orden/partida y explicar o unificar.',('contrato',))
            for signature,rr in dup.items():
                if len(rr)>1:
                    for r,line,ctx in items:
                        if r in rr:
                            self.add('REVISAR',sh,r,mapping.get('clave'),ctx,'POSIBLE_REGISTRO_DUPLICADO',
                                f'Contrato, clave, proveedor y cifras idénticas en filas {", ".join(map(str,rr[:15]))}.',
                                'Confirmar si corresponde a órdenes distintas o eliminar duplicidad únicamente con soporte.',('contrato','monto'))


def save_observations(wb,found,cutoff,first_name):
    name='OBSERVACIONES'
    names={normalize(s.name) for s in wb.worksheets.items}
    if name in names:
        for i in range(2,100):
            cand=f'OBSERVACIONES_{i}'
            if normalize(cand) not in names: name=cand; break
    sh=wb.worksheets.add(name)
    n=len(found)
    counts=collections.Counter(f.severity for f in found)
    institutions=len(set(f.unit for f in found if f.unit))
    lastrow=max(7,6+n)
    sh.merge_cells('A1:M1')
    sh.get_range('A1').values=[['CONTROL DE INCONSISTENCIAS | LAYOUT DE RESCISIÓN']]
    sh.get_range('A1:M1').format={
        'fill':'#6F1736','font':{'bold':True,'color':'#FFFFFF','size':14},
        'row_height':32,'vertical_alignment':'center'
    }
    sh.merge_cells('A2:M2')
    sh.get_range('A2').values=[['Devolver este mismo archivo corregido. Atender las celdas coloreadas y registrar el resultado en esta tabla. No borrar filas ni modificar la estructura del layout original.']]
    sh.get_range('A2:M2').format={
        'fill':'#E7EEF7','font':{'color':'#243B53','size':11},
        'row_height':34,'wrap_text':True,'vertical_alignment':'center'
    }
    info=[['Fecha de corte',cutoff.isoformat(),'Total de observaciones',n,
           'Diferencias confirmables',counts['ERROR'],'Por revisar',counts['REVISAR'],
           'Documentales',counts['DOCUMENTAL'],'UR con hallazgos',institutions],
          ['ORIGINAL SIN ALTERACIONES','Sí','MARCA ROJA','ERROR','MARCA ÁMBAR','REVISAR',
           'MARCA AZUL','DOCUMENTAL','MARCA GRIS','Dato relacionado','Unidad',first_name]]
    sh.get_range('A3:L4').values=info
    sh.get_range('A3:L4').format.row_height=24
    sh.get_range('A3:L4').format.font={'size':10,'color':'#233047'}
    sh.get_range('A3:L3').format.fill='#F2F5FA'
    sh.get_range('A4:L4').format.fill='#F8FAFC'
    sh.get_range('D4').format.fill=COLORS['ERROR']
    sh.get_range('F4').format.fill=COLORS['REVISAR']
    sh.get_range('H4').format.fill=COLORS['DOCUMENTAL']
    sh.get_range('J4').format.fill=COLORS['RELACIONADA']
    headers=['Folio','Tipo','Institución / UR','No. de contrato','Hoja','Celda',
             'Campo observado','Hallazgo','Qué debe hacer el instituto',
             'Celdas relacionadas','Valor actual','Respuesta del instituto','Estatus de atención']
    sh.get_range('A6:M6').values=[headers]
    sh.get_range('A6:M6').format={
        'fill':'#193B60','font':{'bold':True,'color':'#FFFFFF','size':10},
        'row_height':32,'wrap_text':True,'vertical_alignment':'center'
    }
    if found:
        values=[[
            i,f.severity,f.unit,f.contract,f.sheet,f.cell,f.field,f.detail,
            f.action, ', '.join(f.related),f.value,'','PENDIENTE'
        ] for i,f in enumerate(found,1)]
        sh.get_range_by_indexes(6,0,n,13).values=values
        sh.get_range_by_indexes(6,0,n,13).format.row_height=34
        sh.get_range_by_indexes(6,0,n,13).format.wrap_text=True
        sh.get_range_by_indexes(6,0,n,13).format.font={'size':10,'color':'#172B4D'}
        sh.get_range_by_indexes(6,11,n,1).format.fill='#F0F6FF'
        sh.get_range_by_indexes(6,12,n,1).format.fill='#F0F6FF'
        for severity in RANK:
            matching=[6+i for i,f in enumerate(found) if f.severity==severity]
            for k in matching:
                sh.get_cell(k,1).format.fill=COLORS[severity]
        try:
            sh.get_range_by_indexes(6,12,n,1).data_validation={'rule':{'type':'list','values':['PENDIENTE','CORREGIDO','ACLARADO','NO APLICA']}}
        except Exception:
            # No comprometer el archivo si una implementación no admite la validación.
            pass
        # Tabla con filtros de Excel para localizar hallazgos por institución, contrato o tipo.
        try:
            sh.tables.add(f'A6:M{6+n}',True,'TablaHallazgos')
        except Exception:
            pass
    else:
        sh.get_range('A7').values=[['SIN OBSERVACIONES AUTOMÁTICAS']]
    widths={'A':8,'B':14,'C':29,'D':35,'E':17,'F':10,'G':28,
            'H':58,'I':65,'J':22,'K':40,'L':42,'M':18}
    for col,w in widths.items(): sh.get_range(f'{col}:{col}').format.column_width=w
    sh.freeze_panes.freeze_rows(6)
    return name


def color_and_comments(wb,found):
    """El original queda intacto: resalta y comenta en su copia editada."""
    primary={}; related=set(); notes=collections.defaultdict(list)
    for f in found:
        key=(f.sheet,f.cell)
        if RANK[f.severity]>RANK.get(primary.get(key,''),0): primary[key]=f.severity
        notes[key].append(f)
        for rel in f.related: related.add((f.sheet,rel))
    ops=[]
    for sheet,cell in sorted(related-primary.keys()):
        ops.append({'op':'range.format.set','target':{'sheet':sheet,'range':cell},
                    'props':{'fill':COLORS['RELACIONADA']}})
    for (sheet,cell),sev in sorted(primary.items()):
        ops.append({'op':'range.format.set','target':{'sheet':sheet,'range':cell},
                    'props':{'fill':COLORS[sev]}})
    for start in range(0,len(ops),125): wb.apply(ops[start:start+125])
    # Un solo comentario por celda, aunque se activen varias reglas.
    # Se exporta también como comentario legible en versiones antiguas de Excel.
    try:
        wb.apply([{'op':'comments.self.set','person':{
            'displayName':'Revisor automático OIC (observaciones por verificar)',
            'initials':'OIC'}}])
    except Exception: pass
    ops=[]
    for (sheet,cell),items in sorted(notes.items()):
        body='OBSERVACIONES PARA ATENDER — NO ES CORRECCIÓN AUTOMÁTICA\n'
        for i,f in enumerate(items[:8],1):
            body+=f'\n{i}. [{f.severity} | {f.rule}] {f.detail}\nAcción: {f.action}'
            if f.related: body+='\nVerificar también: '+', '.join(f.related)
        if len(items)>8: body+=f'\n(+{len(items)-8} observaciones adicionales en OBSERVACIONES)'
        ops.append({'op':'thread.add','target':{'cell':{'sheet':sheet,'address':cell}},'body':body[:7000]})
    for start in range(0,len(ops),100):
        result=wb.apply(ops[start:start+100])
        # Algunas versiones exponen el resultado como objeto remoto, no dict.
        warnings = getattr(result, 'warnings', None)
        if isinstance(warnings, list) and warnings:
            print('Aviso al agregar comentarios:',warnings[:3],file=sys.stderr)


def audit_one(path:Path,outdir:Path,cutoff:dt.date):
    """Analiza y agrega una hoja; conserva sin cambios cada hoja del original."""
    found_sheets=read_sheets(path, find_mapping, normalize)
    if not found_sheets:
        print(f'[OMITIDO] {path.name}: no hay hoja de datos con encabezados reconocibles')
        return None
    auditor=Auditor(cutoff)
    records=0
    for sheet_name,header_row,mapping,content in found_sheets:
        before=len(auditor.findings)
        auditor.review(sheet_name,header_row,mapping,content)
        n=sum(1 for r in content[1:] if any(not missing(r[mapping[k]]) for k in ('contrato','proveedor','estatus') if k in mapping and len(r)>mapping[k]))
        records+=n
        print(f'   Hoja «{sheet_name}»: {n:,} registros, {len(auditor.findings)-before:,} observaciones')
    auditor.findings.sort(key=lambda f:(PRIORITY[f.severity],f.unit,f.sheet,f.row,extract_cell(f.cell)[1],f.rule))
    outdir.mkdir(parents=True,exist_ok=True)
    out=outdir/(path.stem+'_CON_INCONSISTENCIAS.xlsx')
    index=2
    while out.exists():
        out=outdir/(path.stem+f'_CON_INCONSISTENCIAS_{index}.xlsx'); index+=1
    write_report_only(path,out,auditor.findings,cutoff,COLORS)
    return out,records,collections.Counter(f.severity for f in auditor.findings),len(auditor.findings)

def main(argv=None):
    ap=argparse.ArgumentParser(description='Revisar un layout de rescisión o una carpeta de layouts sin modificar originales.')
    ap.add_argument('entrada',help='Archivo .xlsx o carpeta con archivos .xlsx')
    ap.add_argument('--corte',help='Fecha de corte AAAA-MM-DD. Si se omite, se deduce del mes en el nombre cuando es posible.')
    ap.add_argument('--salida',help='Carpeta para copias observadas. Por defecto: <carpeta_origen>/DEVOLUCIONES_OBSERVADAS')
    args=ap.parse_args(argv)
    path=Path(args.entrada).expanduser().resolve()
    if not path.exists():ap.error('No existe el archivo o carpeta de entrada: '+str(path))
    if args.corte:
        try: cutoff=dt.date.fromisoformat(args.corte)
        except ValueError:ap.error('La fecha --corte debe ser AAAA-MM-DD')
    else:cutoff=None
    files=([path] if path.is_file() else [p for p in sorted(path.glob('*.xlsx')) if not p.name.startswith('~$') and '_OBSERVADO' not in p.stem.upper() and '_CON_INCONSISTENCIAS' not in p.stem.upper()])
    outdir=Path(args.salida).expanduser().resolve() if args.salida else ((path.parent if path.is_file() else path)/'DEVOLUCIONES_OBSERVADAS')
    print(f'Archivos: {len(files)} | Salida: {outdir}')
    result=[]
    for file in files:
        if file.suffix.lower()!='.xlsx': continue
        cutoff_file=cutoff or infer_corte(file)
        if cutoff_file is None:
            print(f'[OMITIDO] {file.name}: especifica --corte AAAA-MM-DD; no se reconoció mes en nombre')
            continue
        print(f'Analizando {file.name} (corte {cutoff_file:%d/%m/%Y})')
        try:
            x=audit_one(file,outdir,cutoff_file)
            if x:
                output,records,counts,total=x
                result.append(x)
                print(f'[LISTO] {output.name} | Registros: {records} | Hallazgos: {total} (errores {counts["ERROR"]}, revisión {counts["REVISAR"]}, documental {counts["DOCUMENTAL"]})')
        except Exception as exc:
            print(f'[ERROR] {file.name}: {type(exc).__name__}: {exc}',file=sys.stderr)
            if len(files)==1: raise
    print(f'Terminó. Archivos procesados: {len(result)}/{len(files)}. Originales intactos.')
    return 0 if result else 1

if __name__=='__main__': raise SystemExit(main())
