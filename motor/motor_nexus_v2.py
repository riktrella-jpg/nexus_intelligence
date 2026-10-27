"""Nexus v2: monto contratado inferido de columnas, sin soporte externo.
Ejecutar: python motor_nexus_v2.py archivo.xlsx --salida resultados_v2
Biblioteca estándar; importa lector XLSX del paquete original.
"""
import argparse,csv,json,sqlite3
from collections import defaultdict,Counter
from decimal import Decimal
from pathlib import Path
from motor_nexus import xlsx_rows,norm,num,classify,amount,D,TOL

SCHEMA='''
CREATE TABLE detalle (fila_excel INTEGER PRIMARY KEY, institucion TEXT, ur TEXT, contrato TEXT, proveedor TEXT, clave_medicamento TEXT, descripcion TEXT, monto_declarado TEXT, cantidad TEXT, precio_unitario TEXT, subtotal_calculado TEXT, evaluacion_iva TEXT, grupo_contrato TEXT, grupo_partida TEXT, firma_partida TEXT, monto_computable TEXT, estado TEXT, motivo TEXT);
CREATE TABLE partidas (id_partida TEXT PRIMARY KEY, grupo_contrato TEXT, clave_medicamento TEXT, descripcion TEXT, filas INTEGER, importes_distintos INTEGER, monto_inferido TEXT, estado TEXT, razon TEXT, filas_origen TEXT);
CREATE TABLE contratos (grupo_contrato TEXT PRIMARY KEY, institucion TEXT, contrato TEXT, proveedor TEXT, filas INTEGER, partidas INTEGER, monto_inferido TEXT, monto_revision TEXT, pendientes INTEGER, estado TEXT, razon TEXT);
CREATE INDEX idx_d_contrato ON detalle(grupo_contrato);
CREATE INDEX idx_d_clave ON detalle(clave_medicamento);
CREATE INDEX idx_p_contrato ON partidas(grupo_contrato);
CREATE INDEX idx_c_estado ON contratos(estado);
'''

def calculo_firma(r):
    # Misma clave + mismo monto + misma cantidad y precio significa fila repetida.
    # Variaciones de monto y/o de cantidad/precio constituyen candidatos de partida independiente.
    return '|'.join((r['partida'], amount(r['monto']),amount(r['cantidad']),amount(r['precio'])))

def decidir_partida(recs):
    """Devuelve [(filas de un candidato, monto reconocido, estado, motivo)].
    Nunca usa solo el monto como llave global.
    """
    firmas=defaultdict(list)
    for r in recs:firmas[calculo_firma(r)].append(r)
    result=[]
    for firma,rr in firmas.items():
        r=rr[0]; monto=r['monto']; iva=r['iva']; sub=r['subtotal']
        if monto is None or monto < 0:
            reconocido=None; estado='PENDIENTE'; motivo='Importe ausente o negativo'
        elif iva in ('COINCIDE_DIRECTO','COMPATIBLE_IVA_16_NO_CONFIRMADO'):
            reconocido=monto; estado='INFERIDO_PARTIDA'; motivo='Monto conciliado con cantidad × precio; registros idénticos consolidados'
        elif monto==0 and sub==0:
            reconocido=monto; estado='INFERIDO_PARTIDA'; motivo='Monto y subtotal en cero'
        else:
            reconocido=None; estado='PENDIENTE'; motivo='Importe no conciliado con cantidad × precio; posible total global o error'
        result.append((rr,reconocido,estado,motivo))
    # Distinguir montos globales: importe grande idéntico repetido en claves que no concilian.
    return result

def procesar(archivo,salida):
    salida=Path(salida);salida.mkdir(parents=True,exist_ok=True)
    db=salida/'nexus_v2.sqlite';db.unlink(missing_ok=True)
    cx=sqlite3.connect(db);cx.executescript(SCHEMA)
    contratos=defaultdict(list)
    for row in xlsx_rows(archivo):
        identidad=tuple(norm(row[x]) for x in ('institucion','ur','contrato','proveedor'))
        gid='|'.join(identidad)
        clave=norm(row['clave']); desc=norm(row['descripcion'])
        # Diferentes descripciones de la misma clave se conservan en un mismo grupo de medicamento:
        # su cantidad, precio e importe forman la firma de partida.
        partida=gid+'|'+clave if clave else gid+'|SIN_CLAVE|'+desc
        monto=num(row['monto']);cantidad=num(row['cantidad']);precio=num(row['precio'])
        subtotal=(cantidad*precio).quantize(D('.01')) if cantidad is not None and precio is not None else None
        rec={'row':row,'gid':gid,'partida':partida,'monto':monto,'cantidad':cantidad,'precio':precio,'subtotal':subtotal,'iva':classify(monto,subtotal)}
        contratos[gid].append(rec)
    estadisticas=Counter(); filas_salida=[]; partidas_salida=[]; contratos_salida=[]
    for gid,rs in contratos.items():
        by_part=defaultdict(list)
        for r in rs:by_part[r['partida']].append(r)
        monto_contrato=D(0);pendientes=0;revision=[];razones=[];partes_total=0
        for p,rr in by_part.items():
            candidatos=decidir_partida(rr)
            # Un mismo medicamento con montos diferentes y diferentes firmas se puede sumar
            # solo si las cantidades/precios avalan cada importe; de otro modo pendiente.
            val=sum((m for _,m,_,_ in candidatos if m is not None),D(0))
            pendientes_p=sum(m is None for _,m,_,_ in candidatos)
            monto_contrato+=val; pendientes+=pendientes_p;partes_total+=len(candidatos)
            if pendientes_p:razones.append('Hay partidas no conciliadas')
            for j,(fls,m,st,motivo) in enumerate(candidatos,1):
                pid=p+'|'+str(j)
                # Duplicados exactos se computan una sola vez: primer registro representa importe.
                for n,r in enumerate(fls):
                    row=r['row'];reconocido=m if n==0 else D(0) if m is not None else None
                    est=st if n==0 else ('DUPLICADO_NO_SUMAR' if m is not None else 'PENDIENTE_DUPLICADO')
                    why=motivo if n==0 else 'Misma clave, monto, cantidad y precio: no sumar de nuevo'
                    filas_salida.append((row['fila_excel'],row['institucion'],row['ur'],row['contrato'],row['proveedor'],row['clave'],row['descripcion'],amount(r['monto']),amount(r['cantidad']),amount(r['precio']),amount(r['subtotal']),r['iva'],gid,p,pid,amount(reconocido),est,why))
                    estadisticas[est]+=1
                partidas_salida.append((pid,gid,fls[0]['row']['clave'],fls[0]['row']['descripcion'],len(fls),1,amount(m),st,motivo,','.join(str(x['row']['fila_excel']) for x in fls)))
                if m is None and fls[0]['monto'] is not None:revision.append(fls[0]['monto'])
        estado='INFERIDO_COMPLETO' if pendientes==0 else ('PARCIAL_CON_PENDIENTES' if monto_contrato else 'PENDIENTE_TOTAL')
        # revision no se suma al monto válido: puede incluir repetición de monto global
        primero=rs[0]['row']
        contratos_salida.append((gid,primero['institucion'],primero['contrato'],primero['proveedor'],len(rs),partes_total,amount(monto_contrato),amount(sum(revision,D(0))) if revision else '',pendientes,estado,'; '.join(sorted(set(razones))) if razones else 'Claves y firmas de partidas conciliadas aritméticamente'))
    cx.executemany('INSERT INTO detalle VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',filas_salida)
    cx.executemany('INSERT INTO partidas VALUES (?,?,?,?,?,?,?,?,?,?)',partidas_salida)
    cx.executemany('INSERT INTO contratos VALUES (?,?,?,?,?,?,?,?,?,?,?)',contratos_salida)
    cx.commit()
    def export(tabla,nombre):
        cursor=cx.execute('SELECT * FROM '+tabla)
        with (salida/nombre).open('w',newline='',encoding='utf-8-sig') as f:
            wr=csv.writer(f);wr.writerow([x[0] for x in cursor.description]);wr.writerows(cursor)
    export('detalle','detalle_montos_v2.csv');export('partidas','partidas_unicas_v2.csv');export('contratos','resumen_contratos_v2.csv')
    total=sum((D(r[6]) for r in contratos_salida),D(0))
    report={'filas':len(filas_salida),'grupos_contractuales':len(contratos_salida),'partidas_candidatas':len(partidas_salida),'estados_filas':dict(estadisticas),'estados_contratos':dict(Counter(r[9] for r in contratos_salida)),'monto_inferido_con_partidas_conciliadas':str(total),'advertencia':'Estimación de columnas, NO monto contractual comprobado; los grupos parciales no son totales contractuales completos.'}
    (salida/'resumen_v2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    cx.close();return report

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('archivo');ap.add_argument('--salida',default='resultados_v2');a=ap.parse_args()
    print(json.dumps(procesar(a.archivo,a.salida),ensure_ascii=False,indent=2))
