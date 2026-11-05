"""NEXUS / OIC Salud · motor dual de suministro: medicamentos y material de curación.

Reglas AE:AU transcritas y evaluadas por fila; no depende del recálculo de Excel.
No altera documentos originales. Exportación OOXML en ooxml_suministro.py.
Python >= 3.10.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, asdict, field
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
import gzip
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKGNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
T = lambda n: f'{{{NS}}}{n}'
COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
REGLAS = {
    'AE': ('CNIS / Compendio', 'Q', 'Revisar clave, vigencia y soporte documental.'),
    'AF': ('Firma frente a suministro', 'I,J,AB,AC', 'Aclarar formalización del contrato.'),
    'AG': ('Fechas contractuales', 'N,O', 'Corregir/soportar vigencia contractual.'),
    'AH': ('Evento antes del inicio', 'N,Y,AB', 'Revisar fecha y documento habilitante.'),
    'AI': ('Evento después de la conclusión', 'O,Y,AB', 'Revisar convenios y prórrogas.'),
    'AJ': ('Órdenes frente a fechas', 'X,Y', 'Aclarar órdenes/fechas y homologar estructura.'),
    'AK': ('Campos cuantitativos', 'P,S,T,U,Z,AC', 'Corregir los valores numéricos no válidos.'),
    'AL': ('Monto contratado', 'P,S,T', 'Verificar importe a nivel de renglón, clave o contrato; IVA.'),
    'AM': ('Precio por clave y contrato', 'H,Q,T', 'Confirmar precio y posibles modificaciones.'),
    'AN': ('Monto ejercido', 'U,AC,T', 'Confirmar nivel de captura y base de cálculo.'),
    'AO': ('Monto cero con suministro', 'U,AC', 'Confirmar recepción y estatus de pago.'),
    'AP': ('Campos esenciales', 'W,X,Y,Z,AA,AB,AC', 'Completar campos faltantes y documentar.'),
    'AQ': ('Solicitud pendiente', 'Y,AB,AC', 'Verificar plazo de entrega pactado.'),
    'AR': ('Solicitado frente a suministrado', 'Z,AC', 'Conciliar cantidades y soporte de recepción.'),
    'AS': ('Posible duplicado', 'D,H,Q,X,Y,AA,AB,AC', 'Verificar si es evento distinto; no borrar automáticamente.'),
    'AT': ('Fechas no estructuradas', 'N,O,Y,AB', 'Homologar fechas sin inferir eventos múltiples.'),
    'AU': ('Evento posterior al corte', 'Y,AB', 'Documentar el evento fuera del periodo.'),
}
RULE_CODES = tuple(REGLAS)
EXTRA_REGLAS = {
    'MX01': 'Registro sin contrato',
    'MX02': 'Valor cuantitativo negativo',
    'MX03': 'Suministro antes de solicitud',
    'MX04': 'Proveedor distinto para un contrato',
    'MX05': 'Piezas fraccionarias',
    'MX06': 'Contrato no firmado sin motivo',
    'MX07': 'Importe contractual potencialmente repetido',
    'MX08': 'Contrato sin proveedor',
    'MX09': 'Cantidad suministrada superior a contratada',
    'MX10': 'Importe ejercido positivo sin piezas reportadas',
    'MX11': 'Fecha fuera de rango plausible',
    'MD01': 'Marcador oncológico incorrecto en medicamento',
    'MC01': 'Marcador oncológico incompatible con material de curación',
    'SX01': 'Tipo de suministro sin clasificación',
}
FIELD_NAMES = ['BASE','Ramo','Descripción','Siglas','Cve_UR','Unidad Administrativa',
               'Área formalizadora del contrato','No. de contrato','¿El contrato está firmado?',
               'Motivo de no firma','Proveedor','Representante legal','Administrador del contrato',
               'Fecha inicio contrato','Fecha conclusión contrato','Monto contratado','Clave CNIS de insumo',
               'Descripción medicamento','Cantidad contratada','Precio unitario','Monto ejercido',
               'Medicamento oncológico','Área solicitante','Órdenes de suministro',
               'Fecha solicitud','Piezas solicitadas','Unidad médica o almacén',
               'Fecha suministro','Piezas suministradas','Comentarios']
COLS = [chr(65+i) if i<26 else 'A'+chr(65+i-26) for i in range(30)]


def colnum(letters: str) -> int:
    n=0
    for c in letters:
        n=n*26+ord(c)-64
    return n


def colletter(n: int) -> str:
    out=''
    while n:
        n,r=divmod(n-1,26)
        out=chr(65+r)+out
    return out


def norm(s: Any) -> str:
    s=unicodedata.normalize('NFKD', str(s if s is not None else ''))
    return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in s if not unicodedata.combining(c)).lower()).strip()


def empty(x: Any) -> bool:
    return x is None or str(x).strip()==''


def numeric(v: Any) -> Decimal|None:
    """Toma el tipo de celda en cuenta: un número almacenado como texto NO es numérico."""
    if isinstance(v, Decimal):return v if v.is_finite() else None
    if isinstance(v,(int,float)) and not isinstance(v,bool):
        try:return Decimal(str(v))
        except InvalidOperation:return None
    return None


def date_excel(v: Any, is_1904: bool=False) -> date|None:
    n=numeric(v)
    if n is None or n<1 or n>2958465:return None
    try:return (date(1904,1,1) if is_1904 else date(1899,12,30))+timedelta(days=int(n))
    except (ValueError,OverflowError):return None


def fmt(v: Any) -> str:
    if v is None:return ''
    if isinstance(v,Decimal):return format(v,'f').rstrip('0').rstrip('.') if '.' in format(v,'f') else str(v)
    return str(v).strip()

RUBRO_MEDICAMENTOS = 'MEDICAMENTOS'
RUBRO_CURACION = 'MATERIAL DE CURACIÓN'


def rubro(v: Any) -> str:
    """Identifica el rubro por A; no lo infiere a partir de descripciones o claves."""
    n = norm(v)
    if n in ('medicamento', 'medicamentos'):
        return RUBRO_MEDICAMENTOS
    if n in ('material de curacion', 'materiales de curacion', 'material curacion',
             'material de curaciones'):
        return RUBRO_CURACION
    return 'NO CLASIFICADO'


def clave_no_informada(q: Any) -> bool:
    x = norm(q)
    return not x or x in ('na', 'n a', 'no aplica', 'sin clave', 'sin clave del cnis',
                          'sin clave cnis', 'pendiente', 's c', 's cnis')


def clave_analitica(d: dict[str, Any]) -> str:
    """No equiparar artículos distintos que comparten el marcador Sin clave del CNIS."""
    q = fmt(d.get('Q')).upper()
    if clave_no_informada(q):
        return 'SIN CLAVE: ' + norm(d.get('R'))
    return q


def sin_orden(v: Any) -> bool:
    x = norm(v)
    return not x or x in ('na', 'n a', 'no aplica', 'sin orden',
                          'sin orden de suministro', 'sin ordenes de suministro')


def tiene_suministro(d: dict[str, Any]) -> bool:
    return (numeric(d.get('AC')) or 0) > 0 or not empty(d.get('AB'))


@dataclass
class Finding:
    fila: int
    codigo: str
    gravedad: str
    descripcion: str
    columnas: list[str]
    accion: str
    evidencia: str = ''

@dataclass
class RowReport:
    fila: int
    datos: dict[str,Any]
    reglas: dict[str,str] = field(default_factory=dict)
    hallazgos: list[Finding] = field(default_factory=list)
    estado: str = 'OK'

@dataclass
class Options:
    fecha_corte: date
    dias_pendiente: int = 15
    tolerancia_contratado: Decimal = Decimal('1')
    tolerancia_ejercido: Decimal = Decimal('0.01')
    extras: bool = True
    year1904: bool = False

    @classmethod
    def parse(cls, fecha_corte: str|date, dias_pendiente: int=15,
              tolerancia_contratado: str|float='1', tolerancia_ejercido: str|float='0.01',
              extras: bool=True, year1904: bool=False):
        fc=date.fromisoformat(fecha_corte) if isinstance(fecha_corte,str) else fecha_corte
        if not isinstance(fc,date):raise ValueError('Fecha de corte no válida: YYYY-MM-DD')
        if not 0<=dias_pendiente<=3650:raise ValueError('Días pendientes fuera de rango')
        tc=Decimal(str(tolerancia_contratado));te=Decimal(str(tolerancia_ejercido))
        if tc<0 or te<0 or not tc.is_finite() or not te.is_finite():raise ValueError('Tolerancias inválidas')
        return cls(fc,dias_pendiente,tc,te,extras,year1904)


def get_sst(z: zipfile.ZipFile) -> list[str]:
    if 'xl/sharedStrings.xml' not in z.namelist():return []
    arr=[]
    with z.open('xl/sharedStrings.xml') as fi:
        for _,e in ET.iterparse(fi,events=('end',)):
            if e.tag==T('si'):
                arr.append(''.join((x.text or '') for x in e.iter(T('t'))));e.clear()
    return arr


def cell_value(c: ET.Element, sst: list[str]) -> Any:
    t=c.get('t','')
    if t in ('inlineStr','inline'):
        return ''.join((x.text or '') for x in c.iter(T('t')))
    v=c.find(T('v'))
    if v is None or v.text is None:return None
    if t=='s':
        try:return sst[int(v.text)]
        except (ValueError,IndexError):return None
    if t in ('str','e'):return v.text
    if t=='b':return v.text=='1'
    try:return Decimal(v.text)
    except InvalidOperation:return v.text


def get_sheets(z: zipfile.ZipFile) -> list[tuple[str,str]]:
    wb=ET.fromstring(z.read('xl/workbook.xml'))
    rel=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    links={x.get('Id'):x.get('Target') for x in rel}
    out=[]
    for s in wb.find(T('sheets')):
        target=links[s.get(f'{{{RNS}}}id')].lstrip('/')
        target=target if target.startswith('xl/') else 'xl/'+target
        out.append((s.get('name',''),target))
    return out


def get_date_system(z: zipfile.ZipFile) -> bool:
    wb=ET.fromstring(z.read('xl/workbook.xml'))
    prop=wb.find(T('workbookPr'))
    return prop is not None and prop.get('date1904','0')=='1'


def find_sheets(z: zipfile.ZipFile, sheet: str|None=None) -> list[tuple[str,str]]:
    sheets=get_sheets(z)
    if sheet:
        chosen=[p for p in sheets if norm(p[0])==norm(sheet)]
        if not chosen:raise ValueError('No existe la hoja solicitada. Disponibles: '+', '.join(x[0] for x in sheets))
        return chosen
    for target in ('BASE_REVISION','BASE','MEDICAMENTOS','SUMINISTRO MEDICAMENTOS'):
        chosen=[p for p in sheets if norm(p[0])==norm(target)]
        if chosen:return chosen
    raise ValueError('No identifiqué una hoja BASE_REVISION, BASE o MEDICAMENTOS; especificar --hoja.')


def analyze_source(z: zipfile.ZipFile, path: str, sst: list[str]) -> tuple[int,dict[int,dict[str,Any]],dict[str,str],int]:
    """Retorna encabezado, filas activas, nombres originales y última columna de encabezado."""
    headings={};active={};header_row=None;lastheader=30
    with z.open(path) as fi:
        for _,r in ET.iterparse(fi,events=('end',)):
            if r.tag!=T('row'):continue
            n=int(r.get('r','0'));d={}
            for c in r:
                if c.tag!=T('c'):continue
                m=re.match(r'([A-Z]+)',c.get('r',''))
                if not m:continue
                cc=m.group(1)
                if n<=15:
                    v=cell_value(c,sst)
                    if v is not None:d[cc]=v
                elif colnum(cc)<=30:
                    v=cell_value(c,sst)
                    if v is not None:d[cc]=v
            if header_row is None and n<=15:
                matches=sum(1 for a,b in [('H','contrato'),('K','proveedor'),('Q','clave'),('P','monto'),('T','precio'),('AC','piezas'),('Y','fecha')]
                            if b in norm(d.get(a,'')))
                if matches>=4:
                    header_row=n;headings={k:fmt(v) for k,v in d.items()}
                    lastheader=max([30]+[colnum(k) for k in headings]);r.clear();continue
            if header_row is not None and n>header_row:
                row_data={k:v for k,v in d.items() if k in COLS and not empty(v)}
                # Algunos layouts contienen filas con fórmulas o estilos pero sin registros reales.
                if row_data:active[n]=row_data
            r.clear()
    if header_row is None:
        raise ValueError('Encabezados del layout incompatibles. Se requiere estructura A:AD y columnas H/K/P/Q/T/Y/AC.')
    return header_row,active,headings,lastheader


def load_catalog(path: str|Path|None = None) -> dict[str,bool]:
    p=Path(path) if path else Path(__file__).resolve().parent/'catalogo_cnis.json.gz'
    if not p.is_file():raise FileNotFoundError('Falta catálogo CNIS: '+str(p))
    with gzip.open(p,'rt',encoding='utf8') as f:data=json.load(f)
    if not isinstance(data,dict) or 'claves' not in data:raise ValueError('Estructura del CNIS inválida')
    return {str(k).strip().upper(): bool(v) for k,v in data['claves'].items()}


def get_status(findings: list[Finding]) -> str:
    for level in ('ERROR','REVISAR','INFORMATIVO'):
        if any(h.gravedad==level for h in findings):return level
    return 'OK'


def evaluate(records: dict[int,dict[str,Any]], cat: dict[str,bool], options: Options) -> dict[int,RowReport]:
    all_prices=defaultdict(set);duplicates=Counter();contract_providers=defaultdict(set);amount_key=defaultdict(set)
    for n,d in records.items():
        key=(fmt(d.get('H')).upper(),clave_analitica(d))
        pr=numeric(d.get('T'))
        if all(key) and not clave_no_informada(d.get('Q')) and pr is not None:all_prices[key].add(pr)
        dupkey=tuple(fmt(d.get(k)).upper() for k in 'D H X Y AA AB AC'.split())+(clave_analitica(d),)
        if not empty(d.get('H')):duplicates[dupkey]+=1
        if not empty(d.get('H')) and not empty(d.get('K')):contract_providers[fmt(d['H']).upper()].add(norm(d['K']))
        amount=numeric(d.get('P'))
        if not empty(d.get('H')) and amount is not None and not empty(d.get('Q')):
            amount_key[(fmt(d['H']).upper(),amount)].add(fmt(d['Q']).upper())
    out={}
    for n,d in records.items():
        report=RowReport(fila=n,datos=d);out[n]=report
        def add(code:str, severity:str, message:str, fields:str|list[str]|None=None,
                evidence:str='', action:str|None=None):
            cols=fields.split(',') if isinstance(fields,str) else (fields or REGLAS.get(code,('', '',''))[1].split(','))
            cols=[x for x in dict.fromkeys(cols) if x]
            action=action or (REGLAS[code][2] if code in REGLAS else 'Solicitar aclaración o soporte documental.')
            report.hallazgos.append(Finding(n,code,severity,message,cols,action,evidence))
            if code in REGLAS:report.reglas[code]=f'{severity}: {message}'
        def ok(code):report.reglas.setdefault(code,'OK')
        def v(c):return d.get(c)
        def num(c):return numeric(v(c))
        def fecha(c):return date_excel(v(c),options.year1904)
        def ev(fields):return '; '.join(f'{c}={fmt(v(c))}' for c in fields)
        h=fmt(v('H'));q=fmt(v('Q')).upper();a=fecha('N');b=fecha('O');req=fecha('Y');ent=fecha('AB')
        # AE. CNIS, coincide con compendio por clave exacta; vigencia por código.
        if clave_no_informada(v('Q')):add('AE','REVISAR','CLAVE CNIS NO INFORMADA O MARCADA COMO SIN CLAVE','Q',ev(['Q']))
        elif q not in cat:add('AE','REVISAR','CLAVE NO LOCALIZADA EN CNIS','Q',ev(['Q']))
        elif not cat[q]:add('AE','REVISAR','CLAVE NO VIGENTE EN CNIS','Q',ev(['Q']))
        else:ok('AE')
        # AF. Fecha/firma se valida contra suministro efectivo.
        signed=norm(v('I'))
        if signed in ('si','s'):ok('AF')
        elif (num('AC') or 0)>0 or not empty(v('AB')):
            add('AF','REVISAR','SUMINISTRO REPORTADO CON CONTRATO NO FIRMADO','I,AB,AC')
        elif signed=='no':add('AF','INFORMATIVO','CONTRATO NO FIRMADO SIN SUMINISTRO','I,J')
        else:add('AF','REVISAR','ESTATUS DE FIRMA NO VÁLIDO','I')
        # AG. Fechas obligatorias y cronología.
        if empty(v('N')) or empty(v('O')):add('AG','ERROR','FECHA CONTRACTUAL AUSENTE',','.join(c for c in ('N','O') if empty(v(c))))
        elif a is None or b is None:add('AG','ERROR','FECHA CONTRACTUAL NO VÁLIDA',','.join(c for c in ('N','O') if fecha(c) is None))
        elif a>b:add('AG','ERROR','INICIO POSTERIOR A CONCLUSIÓN','N,O',ev(['N','O']))
        else:ok('AG')
        # AH/AI. Evento fuera de vigencia contractual.
        before=[c for c,dt in (('Y',req),('AB',ent)) if dt and a and dt<a]
        after=[c for c,dt in (('Y',req),('AB',ent)) if dt and b and dt>b]
        if before:add('AH','REVISAR','EVENTO ANTERIOR AL INICIO CONTRACTUAL',[ 'N',*before],ev(['N',*before]))
        else:ok('AH')
        if after:add('AI','REVISAR','EVENTO POSTERIOR A LA CONCLUSIÓN CONTRACTUAL',['O',*after],ev(['O',*after]))
        else:ok('AI')
        # AJ. Comas y ; como separadores; si hay una única fecha numérica no se divide.
        if sin_orden(v('X')) and empty(v('Y')) and (num('Z') or 0)==0:ok('AJ')
        elif sin_orden(v('X')) or empty(v('Y')):add('AJ','REVISAR','ORDEN O FECHA INCOMPLETA','X,Y')
        else:
            def count_items(x):
                t=fmt(x)
                return len([p for p in re.split(r'[,;\n]+',t) if p.strip()])
            if count_items(v('X'))!=count_items(v('Y')):
                add('AJ','REVISAR','NO COINCIDE NÚMERO DE ÓRDENES Y FECHAS','X,Y',ev(['X','Y']))
            else:ok('AJ')
        # AK. Verificación de tipo numérico, no convierte texto silenciosamente.
        invalid=[c for c in ('P','S','T','U','Z','AC') if not empty(v(c)) and num(c) is None]
        if invalid:add('AK','ERROR','CAMPO CUANTITATIVO NO NUMÉRICO',invalid,ev(invalid))
        else:ok('AK')
        # AL y AN. NO sumar montos por renglón ni atribuir IVA sin respaldo.
        if any(empty(v(c)) or num(c) is None for c in ('P','S','T')):
            add('AL','REVISAR','SIN DESGLOSE NUMÉRICO PARA VALIDAR MONTO CONTRATADO','P,S,T')
        else:
            delta=abs(num('P')-num('S')*num('T'))
            if delta>options.tolerancia_contratado:
                base = num('S')*num('T')
                if base>0 and abs(num('P')-base*Decimal('1.16'))<=options.tolerancia_contratado:
                    add('AL','INFORMATIVO','EL MONTO COINCIDE MATEMÁTICAMENTE CON BASE MÁS 16 %; CONFIRMAR TRATAMIENTO DE IVA','P,S,T',
                        f'Base={base}; importe={num("P")}; factor observado=1.16 (no acredita régimen fiscal)')
                else:
                    add('AL','REVISAR','MONTO CONTRATADO NO COINCIDE CON CANTIDAD × PRECIO; VALIDAR NIVEL DE CAPTURA E IVA','P,S,T',
                        f'Diferencia absoluta={delta}; se debe identificar si P es importe por clave, partida o contrato')
            else:ok('AL')
        key=(h.upper(),clave_analitica(d))
        if h and not clave_no_informada(q) and num('T') is not None and len(all_prices.get(key,set()))>1:
            add('AM','REVISAR','PRECIO DIFERENTE PARA MISMO CONTRATO Y CLAVE','H,Q,T',f'Precios distintos={len(all_prices[key])}')
        else:ok('AM')
        if any(empty(v(c)) or num(c) is None for c in ('U','AC','T')):
            add('AN','REVISAR','MONTO EJERCIDO NO VALIDABLE POR DESGLOSE','U,AC,T')
        else:
            delta=abs(num('U')-num('AC')*num('T'))
            if delta>options.tolerancia_ejercido:
                base=num('AC')*num('T')
                if base>0 and abs(num('U')-base*Decimal('1.16'))<=options.tolerancia_ejercido:
                    add('AN','INFORMATIVO','MONTO EJERCIDO COINCIDE CON BASE MÁS 16 %; CONFIRMAR IVA','U,AC,T',
                        f'Base={base}; ejercido={num("U")}; factor observado=1.16')
                else:
                    add('AN','REVISAR','MONTO EJERCIDO NO COINCIDE CON PIEZAS × PRECIO; VALIDAR NIVEL DE CAPTURA','U,AC,T',f'Diferencia absoluta={delta}')
            else:ok('AN')
        if (num('AC') or 0)>0 and (empty(v('U')) or num('U')==0):
            add('AO','REVISAR','PIEZAS SUMINISTRADAS CON MONTO EJERCIDO EN CERO','AC,U')
        else:ok('AO')
        # AP. Sólo exigir campos donde ya hubo orden/suministro.
        miss=[]
        if not empty(v('Y')) or (num('Z') or 0)>0:
            miss.extend([c for c in ('W','X','Y','Z','AA') if (sin_orden(v(c)) if c=='X' else empty(v(c)))])
        if not empty(v('AB')) or (num('AC') or 0)>0:
            miss.extend([c for c in ('AB','AC','AA') if empty(v(c))])
        if miss:add('AP','ERROR','CAMPO ESENCIAL U OPERATIVO AUSENTE',list(dict.fromkeys(miss)))
        else:ok('AP')
        # AQ. No deduce incumplimiento; requiere plazo contractual.
        if req and req<=options.fecha_corte and (ent is None or ent>options.fecha_corte or num('AC')==0) and (options.fecha_corte-req).days>options.dias_pendiente:
            add('AQ','REVISAR','SOLICITUD PENDIENTE POR MÁS DEL PLAZO DEFINIDO','Y,AB,AC',f'Días al corte={(options.fecha_corte-req).days}')
        else:ok('AQ')
        # AR. Parcial ≠ error.
        if num('Z') is None or num('AC') is None:ok('AR')
        elif num('AC')>num('Z'):add('AR','ERROR','SUMINISTRO MAYOR A SOLICITADO','Z,AC',ev(['Z','AC']))
        elif num('AC')<num('Z'):add('AR','INFORMATIVO','ENTREGA PARCIAL','Z,AC',ev(['Z','AC']))
        else:ok('AR')
        # AS. Fila analíticamente duplicada; no significa que sean registros idénticos en origen.
        dup=tuple(fmt(v(k)).upper() for k in 'D H X Y AA AB AC'.split())+(clave_analitica(d),)
        if h and duplicates[dup]>1:add('AS','REVISAR','POSIBLE REGISTRO DUPLICADO','D,H,Q,R,X,Y,AA,AB,AC',f'Coincidencias={duplicates[dup]}')
        else:ok('AS')
        # AT. Fecha almacenada como texto: no se infiere qué quiso decir la institución.
        unstructured=[c for c in ('N','O','Y','AB') if not empty(v(c)) and fecha(c) is None]
        if unstructured:add('AT','REVISAR','FECHA NO ESTRUCTURADA O MÚLTIPLES FECHAS EN UNA CELDA',unstructured,ev(unstructured))
        else:ok('AT')
        # AU. Informativo si hecho después de la fecha corte.
        future=[c for c,dt in (('Y',req),('AB',ent)) if dt and dt>options.fecha_corte]
        if future:add('AU','INFORMATIVO','EVENTO POSTERIOR AL CORTE',future,ev(future))
        else:ok('AU')
        if options.extras:
            if not h:add('MX01','ERROR','REGISTRO OPERATIVO SIN NÚMERO DE CONTRATO','H')
            neg=[c for c in ('P','S','T','U','Z','AC') if num(c) is not None and num(c)<0]
            if neg:add('MX02','ERROR','VALOR CUANTITATIVO NEGATIVO',neg,ev(neg))
            if req and ent and ent<req:add('MX03','REVISAR','FECHA DE SUMINISTRO ANTERIOR A LA SOLICITUD','Y,AB',ev(['Y','AB']))
            if h and len(contract_providers[h.upper()])>1:
                add('MX04','REVISAR','DIFERENTES PROVEEDORES PARA EL MISMO NÚMERO DE CONTRATO','H,K',f'Proveedores distintos={len(contract_providers[h.upper()])}')
            fract=[c for c in ('S','Z','AC') if num(c) is not None and num(c)%1!=0]
            if fract:add('MX05','REVISAR','PIEZAS REPORTADAS CON DECIMALES',fract,ev(fract))
            if signed=='no' and empty(v('J')):add('MX06','REVISAR','NO SE INDICA MOTIVO DE CONTRATO SIN FIRMA','I,J')
            amt=num('P')
            if h and amt is not None and len(amount_key[(h.upper(),amt)])>1:
                add('MX07','INFORMATIVO','MISMO MONTO CONTRATADO EN VARIAS CLAVES; EVITAR SUMARLO MÁS DE UNA VEZ','H,P,Q',f'Claves={len(amount_key[(h.upper(),amt)])}')
            if h and empty(v('K')):add('MX08','ERROR','PROVEEDOR AUSENTE','H,K')
            if num('AC') is not None and num('S') is not None and num('AC')>num('S'):
                add('MX09','REVISAR','SUMINISTRO DE LA FILA SUPERA CANTIDAD CONTRATADA; CONFIRMAR NIVEL DE CAPTURA','S,AC')
            if (num('U') or 0)>0 and (empty(v('AC')) or num('AC')==0):
                add('MX10','REVISAR','MONTO EJERCIDO POSITIVO SIN PIEZAS SUMINISTRADAS','U,AC')
            implausible=[c for c in ('N','O','Y','AB') if fecha(c) and (fecha(c).year<1990 or fecha(c).year>options.fecha_corte.year+10)]
            if implausible:add('MX11','REVISAR','FECHA FUERA DE RANGO PLAUSIBLE',implausible,ev(implausible))
        tipo = rubro(v('A'))
        if tipo==RUBRO_MEDICAMENTOS:
            bandera = norm(v('V'))
            if not empty(v('V')) and bandera not in ('0','1'):
                add('MD01','REVISAR','MARCADOR DE MEDICAMENTO ONCOLÓGICO DEBE SER 0 O 1','A,V',ev(['A','V']))
        elif tipo==RUBRO_CURACION:
            if norm(v('V'))=='1':
                add('MC01','REVISAR','MATERIAL DE CURACIÓN REPORTADO COMO MEDICAMENTO ONCOLÓGICO','A,V',ev(['A','V']))
        else:
            add('SX01','ERROR','TIPO DE SUMINISTRO NO CLASIFICADO EN MEDICAMENTOS O MATERIAL DE CURACIÓN','A',ev(['A']))
        report.estado=get_status(report.hallazgos)
    return out


def summarize(reports: dict[int, RowReport], sheets: list[str], options: Options,
              catalog_size: int, modo: str='ambos') -> dict[str,Any]:
    niveles=Counter(r.estado for r in reports.values())
    codigos=Counter(h.codigo for r in reports.values() for h in r.hallazgos)
    tipos={}
    inst={}
    for tipo in (RUBRO_MEDICAMENTOS,RUBRO_CURACION,'NO CLASIFICADO'):
        rr=[r for r in reports.values() if rubro(r.datos.get('A'))==tipo]
        if not rr: continue
        conteo=Counter(r.estado for r in rr)
        tipos[tipo]={'registros':len(rr),'errores':conteo['ERROR'],
                     'revisar':conteo['REVISAR'],'informativos':conteo['INFORMATIVO'],
                     'ok':conteo['OK'],'hallazgos':sum(len(r.hallazgos) for r in rr)}
    for r in reports.values():
        clave=(fmt(r.datos.get('D')) or fmt(r.datos.get('F')),rubro(r.datos.get('A')))
        registro=inst.setdefault('|'.join(clave),{'institucion':clave[0], 'tipo':clave[1],
                                                'registros':0,'con_inconsistencia':0})
        registro['registros']+=1
        registro['con_inconsistencia']+=r.estado in ('ERROR','REVISAR')
    return {'motor':'suministro_dual', 'version':'2.0.0', 'modo':modo,
            'hojas_origen':sheets, 'fecha_corte':options.fecha_corte.isoformat(),
            'dias_pendiente':options.dias_pendiente,
            'tolerancia_monto_contratado':str(options.tolerancia_contratado),
            'tolerancia_monto_ejercido':str(options.tolerancia_ejercido),
            'catalogo_cnis_claves':catalog_size, 'registros':len(reports),
            'filas_con_inconsistencias':niveles['ERROR']+niveles['REVISAR'],
            'hallazgos':sum(len(r.hallazgos) for r in reports.values()),
            'errores':niveles['ERROR'],'revisar':niveles['REVISAR'],
            'informativos':niveles['INFORMATIVO'],'ok':niveles['OK'],
            'reglas':dict(sorted(codigos.items())),
            'por_tipo':tipos, 'por_institucion_tipo':list(inst.values()),
            'advertencia':'Las coincidencias aritméticas con IVA 16 % son indicios, no validación fiscal. El CNIS proviene de la plantilla; verificar su vigencia oficialmente. No sumar importes repetidos.'}


def review_file(input_path: str|Path, output_path: str|Path, fecha_corte: str|date,
                *, modo: str='ambos', sheet: str|None=None, dias_pendiente: int=15,
                tolerancia_contratado: str='1', tolerancia_ejercido: str='0.01',
                extras: bool=True, catalog_path: str|Path|None=None) -> dict[str,Any]:
    """Aplica AE–AU a 1 o ambos rubros de la hoja BASE; devuelve archivo con espejo auditable.

    modo='ambos' (por defecto), 'medicamentos' o 'material_curacion'.
    La agrupación evita cruzar contratos homónimos de distintas instituciones/rubros.
    """
    from .ooxml_suministro import export_audit
    src=Path(input_path);dst=Path(output_path)
    if not src.is_file():raise FileNotFoundError(src)
    if src.resolve()==dst.resolve():raise ValueError('No se puede sobrescribir el Excel original')
    if src.suffix.lower()!='.xlsx':raise ValueError('Archivo esperado .xlsx')
    modo=norm(modo).replace(' ','_')
    if modo not in ('ambos','medicamentos','material_curacion'):
        raise ValueError('modo debe ser ambos, medicamentos o material_curacion')
    cat=load_catalog(catalog_path)
    metadata={};total_report={}
    with zipfile.ZipFile(src) as z:
        # testzip descomprime el archivo entero dos veces; la lectura de XML valida las partes usadas.
        opt=Options.parse(fecha_corte,dias_pendiente,tolerancia_contratado,
                          tolerancia_ejercido,extras,get_date_system(z))
        sst=get_sst(z)
        for sheetname,xmlpath in find_sheets(z,sheet):
            header,records,heads,lastcol=analyze_source(z,xmlpath,sst)
            groups=defaultdict(dict)
            for n,d in records.items():
                t=rubro(d.get('A'))
                if modo=='medicamentos' and t!=RUBRO_MEDICAMENTOS:continue
                if modo=='material_curacion' and t!=RUBRO_CURACION:continue
                # Identificar institución por D, con unidad F como respaldo.
                inst=norm(d.get('D') or d.get('F'))
                groups[(t,inst)][n]=d
            reports={}
            for subset in groups.values():
                reports.update(evaluate(subset,cat,opt))
            total_report.update(reports)
            metadata[sheetname]={'xmlpath':xmlpath,'header':header,'headers':heads,
                                 'lastcol':lastcol,'reports':reports}
    summary=summarize(total_report,[x for x in metadata],opt,len(cat),modo)
    dst.parent.mkdir(parents=True,exist_ok=True)
    export_audit(src,dst,metadata,summary,opt)
    return summary
