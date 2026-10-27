"""Motor Nexus híbrido: XLSX streaming -> conciliación -> SQLite/CSV. Solo biblioteca estándar."""
import argparse,csv,decimal,hashlib,json,re,sqlite3,unicodedata,zipfile
import xml.etree.ElementTree as ET
from collections import Counter,defaultdict
from pathlib import Path
D=decimal.Decimal
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
FIELDS={'tipo':'A','institucion':'D','ur':'E','contrato':'H','firma':'I','proveedor':'K','monto':'P','clase_contrato_excel':'Q','clase_clave_excel':'R','consolidado_excel':'S','clave':'AC','descripcion':'AD','cantidad':'AJ','precio':'AK','orden':'AO','solicitadas':'AQ','suministradas':'AT'}
CENT=D('0.01'); TOL=D('0.02')
def norm(x):
 s=unicodedata.normalize('NFKC',str(x or '')).replace('\xa0',' ')
 return ' '.join(s.upper().strip().split())
def num(x):
 try:
  if x in ('',None):return None
  return D(str(x).replace(',','')).quantize(CENT,rounding=decimal.ROUND_HALF_UP)
 except (decimal.InvalidOperation,ValueError):return None
def amount(x):return str(x) if x is not None else ''
def col(ref):return re.match(r'[A-Z]+',ref).group(0)
def find_sheet_target(z, sheet_name=None):
 RELS_NS='{http://schemas.openxmlformats.org/package/2006/relationships}'
 rels={}
 if 'xl/_rels/workbook.xml.rels' in z.namelist():
  try:
   r_tree=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
   for rel in r_tree.findall(RELS_NS+'Relationship'):
    rid=rel.get('Id'); tgt=rel.get('Target','')
    if not tgt.startswith('xl/'): tgt='xl/'+tgt.lstrip('/')
    rels[rid]=tgt
  except Exception:pass
 sheets=[]
 if 'xl/workbook.xml' in z.namelist():
  try:
   wb=ET.fromstring(z.read('xl/workbook.xml'))
   sel=wb.find(NS+'sheets')
   if sel is not None:
    for s in sel:
     name=s.get('name') or ''
     rid=s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
     sheets.append((name, rels.get(rid,'')))
  except Exception:pass
 if sheet_name:
  for n,t in sheets:
   if n.strip().lower()==sheet_name.strip().lower() and t in z.namelist(): return t
 for n,t in sheets:
  if n.strip().lower()=='base' and t in z.namelist(): return t
 for n,t in sheets:
  if t in z.namelist(): return t
 for cand in ('xl/worksheets/sheet3.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml'):
  if cand in z.namelist(): return cand
 for n in z.namelist():
  if n.startswith('xl/worksheets/') and n.endswith('.xml'): return n
 return 'xl/worksheets/sheet1.xml'

def xlsx_rows(path, sheet_name=None):
 with zipfile.ZipFile(path) as z:
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   with z.open('xl/sharedStrings.xml') as f:
    for event,el in ET.iterparse(f,events=('end',)):
     if el.tag==NS+'si':
      shared.append(''.join((t.text or '') for t in el.iter(NS+'t')));el.clear()
  sheet_xml=find_sheet_target(z, sheet_name)
  with z.open(sheet_xml) as f:
   for event,el in ET.iterparse(f,events=('end',)):
    if el.tag!=NS+'row':continue
    r=int(el.get('r'))
    if r<3:el.clear();continue
    cells={}
    for c in el:
     if c.tag!=NS+'c':continue
     letter=col(c.get('r'))
     if letter not in FIELDS.values():continue
     v=c.find(NS+'v')
     if c.get('t')=='inlineStr':value=''.join(t.text or '' for t in c.iter(NS+'t'))
     else:value=v.text if v is not None else ''
     if c.get('t')=='s' and value:
      try: value=shared[int(value)]
      except (IndexError,ValueError): value=''
     cells[letter]=value
    el.clear()
    if not cells.get('H'):continue
    item={k:cells.get(v,'') for k,v in FIELDS.items()};item['fila_excel']=r
    yield item

def init(db):
 con=sqlite3.connect(db)
 con.executescript('''PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS registros (fila_excel INTEGER PRIMARY KEY, institucion TEXT, ur TEXT, contrato TEXT, proveedor TEXT, clave TEXT, descripcion TEXT, tipo TEXT, firma TEXT, monto TEXT, cantidad TEXT, precio TEXT, subtotal TEXT, compatibilidad_iva TEXT, clasificacion_importe TEXT, clave_contrato TEXT, clave_partida TEXT, orden_suministro TEXT, monto_consolidado_excel TEXT);
 CREATE TABLE IF NOT EXISTS contratos (clave_contrato TEXT PRIMARY KEY, institucion TEXT, contrato TEXT, proveedor TEXT, filas INTEGER, claves INTEGER, montos_diferentes INTEGER, monto_declarado_referencia TEXT, subtotal_partidas TEXT, monto_validado TEXT, monto_por_revisar TEXT, estado TEXT, justificacion TEXT);
 CREATE TABLE IF NOT EXISTS incidencias (clave_contrato TEXT, fila_excel INTEGER, tipo TEXT, detalle TEXT);
 CREATE INDEX IF NOT EXISTS idx_reg_contrato ON registros(clave_contrato);
 CREATE INDEX IF NOT EXISTS idx_reg_clave ON registros(clave_partida);
 CREATE INDEX IF NOT EXISTS idx_con_estado ON contratos(estado);
 ''')
 con.execute('DELETE FROM registros');con.execute('DELETE FROM contratos');con.execute('DELETE FROM incidencias');con.commit();return con

def classify(monto,subtotal):
 if monto is None or subtotal is None:return 'DATOS_INSUFICIENTES'
 if abs(monto-subtotal)<=TOL:return 'COINCIDE_DIRECTO'
 if abs(monto-(subtotal*D('1.16')).quantize(CENT))<=TOL:return 'COMPATIBLE_IVA_16_NO_CONFIRMADO'
 return 'NO_CONCILIADO'

def run(src,folder):
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
 con=init(folder/'nexus_contrataciones.sqlite');groups=defaultdict(list);batch=[]
 for row in xlsx_rows(src):
  identity=(norm(row['institucion']),norm(row['ur']),norm(row['contrato']),norm(row['proveedor']))
  contract='|'.join(identity)
  partida='|'.join((contract,norm(row['clave']),norm(row['descripcion'])))
  monto=num(row['monto']);cantidad=num(row['cantidad']);precio=num(row['precio'])
  subtotal=(cantidad*precio).quantize(CENT) if cantidad is not None and precio is not None else None
  iva=classify(monto,subtotal)
  record={'fila':row['fila_excel'],'contract':contract,'partida':partida,'monto':monto,'subtotal':subtotal,'iva':iva,'raw':row}
  groups[contract].append(record)
  batch.append((row['fila_excel'],*identity[:2],row['contrato'],row['proveedor'],row['clave'],row['descripcion'],row['tipo'],row['firma'],amount(monto),amount(cantidad),amount(precio),amount(subtotal),iva,'PENDIENTE',contract,partida,row['orden'],row['consolidado_excel']))
  if len(batch)>=1000:
   con.executemany('INSERT INTO registros VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',batch);batch=[]
 if batch:con.executemany('INSERT INTO registros VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',batch)
 states=Counter();issues=Counter();out=[];audit=[]
 for key,recs in groups.items():
  parts=defaultdict(list)
  for r in recs:parts[r['partida']].append(r)
  amounts={r['monto'] for r in recs if r['monto'] is not None}
  all_monto=[r['monto'] for r in recs]
  unique_per_part=[];duplicates=0;ambiguous=False
  for p,rr in parts.items():
   vals={r['monto'] for r in rr if r['monto'] is not None}
   subtotals={r['subtotal'] for r in rr if r['subtotal'] is not None}
   if len(rr)>1:duplicates+=len(rr)-1
   if len(vals)==1 and len(subtotals)<=1 and None not in [r['monto'] for r in rr]:
    unique_per_part.append(next(iter(vals)))
   else:ambiguous=True
  total_part=sum(unique_per_part,D('0')) if len(unique_per_part)==len(parts) else None
  statuses={r['iva'] for r in recs}
  if any(x in statuses for x in ('NO_CONCILIADO','DATOS_INSUFICIENTES')):ambiguous=True
  # Only one physical record => no potential repetition; arithmetic must match.
  if len(recs)==1 and not ambiguous and next(iter(amounts),None) is not None:
   verified=next(iter(amounts));state='VALIDADO_ARITMETICO_UNICO';reason='Un registro; importe coincide con cantidad por precio (o 1.16); IVA solo compatibilidad aritmética.'
  # Multiple physical rows: only safe if distinct part IDs, all amounts reconcile, no repeated key, AND
  # no evidence that amount is one contract-wide replicated value. Identical sums remain pending.
  elif len(recs)>1 and len(parts)==len(recs) and not ambiguous and len(amounts)==len(recs):
   verified=total_part;state='VALIDADO_PARTIDAS_DIFERENTES';reason='Claves/descripciones distintas e importes distintos, todos conciliados aritméticamente; sujeto a corroboración documental.'
  else:
   verified=None;state='REVISION_REQUERIDA'
   reason=('Existen filas repetidas, importes iguales entre distintas partidas, importes sin conciliar o datos faltantes: no se puede determinar el alcance del monto con certeza.')
  # Distinguish arithmetically validated from documentarily confirmed - not claim legal verification.
  pending=total_part if verified is None else None
  representative=next(iter(amounts)) if len(amounts)==1 else None
  meta=recs[0]['raw'];states[state]+=1
  if len(parts)<len(recs):issues['CLAVE_REPETIDA']+=1
  if len(amounts)==1 and len(recs)>1:issues['MONTO_UNIFORME']+=1
  if 'NO_CONCILIADO' in statuses:issues['DESCUADRE_CALCULO']+=1
  if 'COMPATIBLE_IVA_16_NO_CONFIRMADO' in statuses:issues['COMPATIBLE_IVA_16']+=1
  con.execute('INSERT INTO contratos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (key,meta['institucion'],meta['contrato'],meta['proveedor'],len(recs),len(parts),len(amounts),amount(representative),amount(total_part),amount(verified),amount(pending),state,reason))
  if state=='REVISION_REQUERIDA':
   for r in recs[:3]:con.execute('INSERT INTO incidencias VALUES (?,?,?,?)',(key,r['fila'],state,reason))
  audit.append({'institucion':meta['institucion'],'contrato':meta['contrato'],'proveedor':meta['proveedor'],'filas':len(recs),'claves':len(parts),'importes_distintos':len(amounts),'monto_validado_aritmetico':amount(verified),'monto_candidato_pendiente':amount(pending),'estado':state,'justificacion':reason})
 con.commit()
 with (folder/'resumen_contratos.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(audit[0]));w.writeheader();w.writerows(audit)
 numeric=con.execute("SELECT monto_validado FROM contratos WHERE monto_validado IS NOT NULL AND monto_validado <> ''").fetchall()
 total=sum((D(x[0]) for x in numeric),D('0'))
 summary={'archivo':Path(src).name,'registros':sum(len(x) for x in groups.values()),'contratos_identificados':len(groups),'estados':dict(states),'incidencias_grupos':dict(issues),'total_aritmetico_no_documental':str(total),'advertencia':'No equivalente a monto contractual certificado. Revisar expedientes y tasas antes del reporte oficial.'}
 (folder/'resumen_ejecucion.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
 con.close();return summary

def main():
 p=argparse.ArgumentParser();p.add_argument('archivo');p.add_argument('--salida',default='salida_nexus');a=p.parse_args();print(json.dumps(run(a.archivo,a.salida),indent=2,ensure_ascii=False))
if __name__=='__main__':main()
