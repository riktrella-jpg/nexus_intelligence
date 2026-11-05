"""Escritor OOXML sin dependencias: original intacto y espejo con celdas afectadas #FFFF00.

No usa coloración de filas completas, no altera hoja original y jamás guarda encima
 del archivo recibido. Mantiene estilos originales por XF derivado.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
import re
import shutil
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from .motor_suministro import NS, RNS, PKGNS, T, colnum, colletter, REGLAS, RULE_CODES, fmt, rubro

ET.register_namespace('',NS)
ET.register_namespace('r',RNS)
ET.register_namespace('mc','http://schemas.openxmlformats.org/markup-compatibility/2006')
ET.register_namespace('x14','http://schemas.microsoft.com/office/spreadsheetml/2009/9/main')
ET.register_namespace('x14ac','http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac')
ET.register_namespace('x15','http://schemas.microsoft.com/office/spreadsheetml/2010/11/main')
ET.register_namespace('x15ac','http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac')
ET.register_namespace('x16r2','http://schemas.microsoft.com/office/spreadsheetml/2015/02/main')
ET.register_namespace('xr','http://schemas.microsoft.com/office/spreadsheetml/2014/revision')
ET.register_namespace('xr2','http://schemas.microsoft.com/office/spreadsheetml/2015/revision2')
ET.register_namespace('xr3','http://schemas.microsoft.com/office/spreadsheetml/2016/revision3')
ET.register_namespace('xr6','http://schemas.microsoft.com/office/spreadsheetml/2016/revision6')
ET.register_namespace('xr10','http://schemas.microsoft.com/office/spreadsheetml/2016/revision10')
ET.register_namespace('xcalcf','http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures')
ET.register_namespace('xlwcv','http://schemas.microsoft.com/office/spreadsheetml/2024/workbookCompatibilityVersion')
MAIN=NS
CT='http://schemas.openxmlformats.org/package/2006/content-types'
REL=PKGNS
ET.register_namespace('ct',CT)


def _register_and_clean_xml(raw_bytes: bytes, default_ns: str = NS) -> bytes:
    """Conserva prefijos xmlns y limpia atributos Ignorable huérfanos tras serializar con ElementTree."""
    txt = raw_bytes.decode('utf-8', errors='ignore')
    for pfx, uri in re.findall(r'xmlns:([A-Za-z0-9_.-]+)="([^"]+)"', txt):
        if pfx not in ('xml', 'xmlns'):
            ET.register_namespace(pfx, uri)
    ET.register_namespace('', default_ns)
    def _fix_ign(m):
        tag = m.group(0)
        ign = re.search(r'\b([A-Za-z0-9_.-]+:)?Ignorable="([^"]+)"', tag)
        if not ign:
            return tag
        attr_prefix = ign.group(1) or ''
        valid = [p for p in ign.group(2).split() if f'xmlns:{p}=' in tag]
        if valid:
            return re.sub(r'\b(?:[A-Za-z0-9_.-]+:)?Ignorable="[^"]+"', f'{attr_prefix}Ignorable="{" ".join(valid)}"', tag)
        return re.sub(r'\s*\b(?:[A-Za-z0-9_.-]+:)?Ignorable="[^"]+"', '', tag)
    txt = re.sub(r'<[A-Za-z0-9_:]+[^>]*\bIgnorable="[^"]+"[^>]*>', _fix_ign, txt)
    return txt.encode('utf-8')


def _node(root,local):
    child=root.find(T(local))
    if child is None:
        child=ET.SubElement(root,T(local))
    return child


def _fresh_style(original:bytes):
    _register_and_clean_xml(original)
    root=ET.fromstring(original)
    fonts=_node(root,'fonts'); fills=_node(root,'fills'); xfs=_node(root,'cellXfs')
    base_len=len(xfs)
    fill_id=len(fills)
    fill=ET.SubElement(fills,T('fill'))
    pat=ET.SubElement(fill,T('patternFill'),{'patternType':'solid'})
    ET.SubElement(pat,T('fgColor'),{'rgb':'FFFFFF00'})
    ET.SubElement(pat,T('bgColor'),{'indexed':'64'})
    fills.set('count',str(len(fills)))
    yellow={}
    for old in range(base_len):
        dup=deepcopy(xfs[old]);dup.set('fillId',str(fill_id));dup.set('applyFill','1')
        yellow[old]=len(xfs);xfs.append(dup)
    # Estilo cabecera granate/azul. No afecta estilos fuente originales.
    header_font_id=len(fonts)
    font=ET.SubElement(fonts,T('font'))
    ET.SubElement(font,T('b'))
    ET.SubElement(font,T('sz'),{'val':'11'})
    ET.SubElement(font,T('color'),{'rgb':'FFFFFFFF'})
    ET.SubElement(font,T('name'),{'val':'Calibri'})
    fonts.set('count',str(len(fonts)))
    header_fill_id=len(fills)
    f=ET.SubElement(fills,T('fill'))
    p=ET.SubElement(f,T('patternFill'),{'patternType':'solid'})
    ET.SubElement(p,T('fgColor'),{'rgb':'FF5F233D'})
    ET.SubElement(p,T('bgColor'),{'indexed':'64'})
    fills.set('count',str(len(fills)))
    header=deepcopy(xfs[0]);header.set('fontId',str(header_font_id));header.set('fillId',str(header_fill_id))
    header.set('applyFill','1');header.set('applyFont','1');header.set('applyAlignment','1')
    alignment=header.find(T('alignment'))
    if alignment is None:alignment=ET.SubElement(header,T('alignment'))
    alignment.set('wrapText','1');alignment.set('vertical','center')
    header_id=len(xfs);xfs.append(header)
    xfs.set('count',str(len(xfs)))
    return _register_and_clean_xml(ET.tostring(root,encoding='utf-8',xml_declaration=True)),yellow,header_id


def _asrow(raw:bytes)->ET.Element:
    prefix=b'<root xmlns="'+NS.encode()+b'" xmlns:x="'+NS.encode()+b'" xmlns:r="'+RNS.encode()+b'" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">'
    return ET.fromstring(prefix+raw+b'</root>')[0]


def _change(row:ET.Element, col:str, n:int, value=None, style:int|None=None, clear_formula=False):
    name=f'{col}{n}';c=None;insert_at=len(row)
    for j,k in enumerate(row):
        if k.tag!=T('c'):continue
        if k.get('r')==name:c=k;break
        m=re.match(r'[A-Z]+',k.get('r',''))
        if m and colnum(m.group())>colnum(col):insert_at=j;break
    if c is None:
        c=ET.Element(T('c'),{'r':name});row.insert(insert_at,c)
    if style is not None:c.set('s',str(style))
    if value is not None or clear_formula:
        for sub in list(c):
            if sub.tag in (T('f'),T('v'),T('is')):c.remove(sub)
    if value is not None:
        c.set('t','inlineStr')
        ins=ET.SubElement(c,T('is'));tt=ET.SubElement(ins,T('t'))
        text=str(value)
        if text[:1].isspace() or text[-1:].isspace():tt.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        tt.text=text[:32767]
    elif clear_formula:
        c.attrib.pop('t',None)
    return c


def _base_style(row:ET.Element,col:str,n:int)->int:
    ref=f'{col}{n}'
    for c in row:
        if c.tag==T('c') and c.get('r')==ref:
            try:return int(c.get('s','0'))
            except ValueError:return 0
    return 0


def _mirror_sheet(z:zipfile.ZipFile,source:str,metadata:dict,yellow:dict[int,int],header_style:int,sink)->None:
    header=metadata['header'];reports=metadata['reports'];heads=metadata['headers'];lastcol=metadata['lastcol']
    is_template=all(heads.get(k)=='CNIS_Compendio' for k in ['AE']) and heads.get('AU')=='Evento_posterior_al_corte'
    start=31 if (is_template or lastcol<=30) else lastcol+1
    rulecols={code:colletter(start+i) for i,code in enumerate(RULE_CODES)}
    resultcol=colletter(start+17);obscol=colletter(start+18);actcol=colletter(start+19)
    extras_start=max(start+20,lastcol+1)
    extcol=colletter(extras_start);countcol=colletter(extras_start+1)
    metadata['export_columns']={**rulecols,'RESULTADO':resultcol,'OBSERVACION':obscol,'ACCION':actcol,
                                  'CODIGOS':extcol,'TOTAL':countcol}
    # No reescribir 34,314 filas vacías de plantilla: lectura, espejo y guardado son lineales.
    # Solo el encabezado y las filas efectivamente analizadas necesitan modificación.
    def patch(rowbytes:bytes)->bytes:
        """Edición de UNA fila en O(celdas); evita reescanear XML por cada hallazgo."""
        match=re.match(rb'<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*\br="(\d+)"',rowbytes)
        if not match:return rowbytes
        n=int(match.group(1))
        if n!=header and n not in reports:return rowbytes
        row=_asrow(rowbytes)
        originals=[c for c in row if c.tag==T('c')]
        others=[c for c in row if c.tag!=T('c')]
        cells={re.match(r'[A-Z]+',c.get('r','')).group():c for c in originals if re.match(r'[A-Z]+',c.get('r',''))}
        def assign(col:str,value=None,style:int|None=None):
            c=cells.get(col)
            if c is None:
                c=ET.Element(T('c'),{'r':f'{col}{n}'})
                cells[col]=c
            if style is not None:c.set('s',str(style))
            if value is not None:
                for sub in list(c):
                    if sub.tag in (T('f'),T('v'),T('is')):c.remove(sub)
                c.set('t','inlineStr')
                ins=ET.SubElement(c,T('is'))
                tt=ET.SubElement(ins,T('t'))
                t=str(value)[:32767]
                if t[:1].isspace() or t[-1:].isspace():
                    tt.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
                tt.text=t
        if n==header:
            for code,c in rulecols.items():
                if is_template and c in heads:continue
                assign(c,code+' · '+REGLAS[code][0],style=header_style)
            for c,label in ((resultcol,'Resultado_general'),(obscol,'Observacion_automatica'),
                            (actcol,'Accion_sugerida'),(extcol,'Codigos_hallazgos_adicionales'),
                            (countcol,'Total_hallazgos')):
                if is_template and c in heads:continue
                assign(c,label,style=header_style)
        elif n in reports:
            r=reports[n]
            for code,c in rulecols.items():assign(c,r.reglas.get(code,'OK'))
            message=' | '.join(f'{h.codigo}: {h.descripcion}' for h in r.hallazgos)
            acciones=' | '.join(dict.fromkeys(h.accion for h in r.hallazgos))
            assign(resultcol,r.estado)
            assign(obscol,message or 'SIN ALERTAS')
            assign(actcol,acciones)
            assign(extcol,', '.join(h.codigo for h in r.hallazgos if h.codigo.startswith(('MX','MD','MC','SX'))))
            assign(countcol,str(len(r.hallazgos)))
            yellowcols=set()
            for h in r.hallazgos:
                if h.gravedad not in ('ERROR','REVISAR'):continue
                yellowcols.update(h.columnas)
                yellowcols.add(rulecols.get(h.codigo,extcol))
            if yellowcols:yellowcols.update((resultcol,obscol))
            for col in yellowcols:
                c=cells.get(col)
                oldstyle=0
                if c is not None:
                    try:oldstyle=int(c.get('s','0'))
                    except ValueError:pass
                assign(col,style=yellow.get(oldstyle,yellow[0]))
        row[:]=sorted(cells.values(),key=lambda c:colnum(re.match(r'[A-Z]+',c.get('r','')).group()))+others
        return ET.tostring(row,encoding='utf-8')
    # Escaneo de XML por bloques: evita cargar hojas de 100 MB+ a memoria.
    row_pattern=re.compile(rb'<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>.*?</(?:[A-Za-z_][\w.-]*:)?row>',re.DOTALL)
    start_pattern=re.compile(rb'<(?:[A-Za-z_][\w.-]*:)?row\b')
    enddata_pattern=re.compile(rb'</(?:[A-Za-z_][\w.-]*:)?sheetData>')
    maxcol=colletter(max(extras_start+1,lastcol))
    last_row=max(max(reports,default=header),header)
    dimension_updated=False
    def emit_prefix(prefix:bytes):
        nonlocal dimension_updated
        if not dimension_updated:
            prefix=re.sub(rb'\s+tabSelected="[^"]*"',b'',prefix)
            prefix=re.sub(rb'(<(?:[A-Za-z_][\w.-]*:)?worksheet\b[^>]*?)\s+\w*:?uid="[^"]*"',rb'\1',prefix)
            def dimension_value(m):
                oldref=m.group(0)
                refs=re.findall(rb'\d+',oldref)
                oldrow=int(refs[-1]) if refs else 1
                return m.group(1)+f'A1:{maxcol}{max(last_row,oldrow)}'.encode()+m.group(2)
            prefix,nreplace=re.subn(
                rb'(<(?:[A-Za-z_][\w.-]*:)?dimension\s+ref=")[^"]+(")',
                dimension_value,prefix,count=1)
            if not re.search(rb'<(?:[A-Za-z_][\w.-]*:)?cols\b',prefix):
                root_prefix=re.search(rb'<([A-Za-z_][\w.-]*):worksheet\b',prefix)
                tag_prefix=(root_prefix.group(1).decode()+':') if root_prefix else ''
                columns_xml=(f'<{tag_prefix}cols><{tag_prefix}col min="{start}" max="{start+16}" width="33" customWidth="1"/>'
                    f'<{tag_prefix}col min="{start+17}" max="{start+19}" width="43" customWidth="1"/>'
                    f'<{tag_prefix}col min="{extras_start}" max="{extras_start+1}" width="24" customWidth="1"/></{tag_prefix}cols>').encode()
                prefix=re.sub(rb'(<(?:[A-Za-z_][\w.-]*:)?sheetData>)',lambda m:columns_xml+m.group(1),prefix,count=1)
            dimension_updated=True
        sink.write(prefix)
    def scrub_tail(tail:bytes):
        tail=re.sub(rb'<(?:[A-Za-z_][\w.-]*:)?tableParts\b[^>]*>.*?</(?:[A-Za-z_][\w.-]*:)?tableParts>',b'',tail,flags=re.DOTALL)
        tail=re.sub(rb'<(?:[A-Za-z_][\w.-]*:)?drawing\b[^>]*/>',b'',tail)
        tail=re.sub(rb'<(?:[A-Za-z_][\w.-]*:)?legacyDrawing\b[^>]*/>',b'',tail)
        tail=re.sub(rb'<(?:[A-Za-z_][\w.-]*:)?hyperlinks\b[^>]*>.*?</(?:[A-Za-z_][\w.-]*:)?hyperlinks>',b'',tail,flags=re.DOTALL)
        return tail
    with z.open(source) as fp:
        buffer=b''
        while True:
            chunk=fp.read(1024*1024)
            eof=not chunk
            buffer+=chunk
            while True:
                match=row_pattern.search(buffer)
                if match is not None:
                    emit_prefix(buffer[:match.start()])
                    sink.write(patch(match.group()))
                    buffer=buffer[match.end():]
                    continue
                partial=start_pattern.search(buffer)
                if partial is not None and not eof:
                    emit_prefix(buffer[:partial.start()])
                    buffer=buffer[partial.start():]
                    break
                if eof or enddata_pattern.search(buffer):
                    emit_prefix(scrub_tail(buffer+fp.read()))
                    return
                # Reservar caracteres para cuando el inicio de <row> cruce el bloque.
                if len(buffer)>256:
                    emit_prefix(buffer[:-256]);buffer=buffer[-256:]
                break


def _make_sheet(rows:list[list],header_style:int,cols: int|None=None)->bytes:
    root=ET.Element(T('worksheet'))
    end=colletter(cols or max(map(len,rows),default=1))
    ET.SubElement(root,T('dimension'),{'ref':f'A1:{end}{len(rows)}'})
    views=ET.SubElement(root,T('sheetViews'))
    view=ET.SubElement(views,T('sheetView'),{'workbookViewId':'0'})
    ET.SubElement(view,T('pane'),{'ySplit':'1','topLeftCell':'A2','activePane':'bottomLeft','state':'frozen'})
    widths=([20,9,25,21,25,19,35,13,13,40,60,48,62,23,50]
            if (cols or max(map(len,rows),default=1))>2 else [46,96])
    config=ET.SubElement(root,T('cols'))
    for ci,w in enumerate(widths,1):ET.SubElement(config,T('col'),{'min':str(ci),'max':str(ci),'width':str(w),'customWidth':'1'})
    sheetdata=ET.SubElement(root,T('sheetData'))
    for rownum,rowvalues in enumerate(rows,1):
        attributes={'r':str(rownum)}
        if rownum==1:attributes.update(ht='31',customHeight='1')
        line=ET.SubElement(sheetdata,T('row'),attributes)
        for ci,v in enumerate(rowvalues,1):
            if v is None or v=='':continue
            c=ET.SubElement(line,T('c'),{'r':f'{colletter(ci)}{rownum}'})
            if rownum==1:c.set('s',str(header_style))
            if isinstance(v,int):
                ET.SubElement(c,T('v')).text=str(v)
            else:
                c.set('t','inlineStr');i=ET.SubElement(c,T('is'));ET.SubElement(i,T('t')).text=str(v)[:32767]
    ET.SubElement(root,T('autoFilter'),{'ref':f'A1:{end}{len(rows)}'})
    ET.SubElement(root,T('pageMargins'),{'left':'0.7','right':'0.7','top':'0.75','bottom':'0.75','header':'0.3','footer':'0.3'})
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)


def export_audit(original:Path,destination:Path,metadata:dict,summary:dict,options):
    with zipfile.ZipFile(original,'r') as zin:
        original_names=set(zin.namelist())
        styles,yellow,head_style=_fresh_style(zin.read('xl/styles.xml'))
        wb_raw=zin.read('xl/workbook.xml')
        _register_and_clean_xml(wb_raw)
        workbook=ET.fromstring(wb_raw)
        rels=ET.fromstring(zin.read('xl/_rels/workbook.xml.rels'))
        content=ET.fromstring(zin.read('[Content_Types].xml'))
        sheetparent=workbook.find(T('sheets'))
        existingids=[int(x.get('sheetId','0')) for x in sheetparent]
        existingrel=[int(x.get('Id')[3:]) for x in rels if re.fullmatch(r'rId\d+',x.get('Id',''))]
        sheet_seq=max([0]+[int(m.group(1)) for path in original_names if (m:=re.fullmatch(r'xl/worksheets/sheet(\d+)\.xml',path))])
        reserved={s.get('name') for s in sheetparent}
        output_sheets=[]
        def add(name,xmlbytes):
            nonlocal sheet_seq
            base=name;step=2
            while name in reserved:
                name=f'{base} {step}';step+=1
            reserved.add(name);sheet_seq+=1
            nid=max(existingids+[0])+len(output_sheets)+1
            rid=f'rId{max(existingrel+[0])+len(output_sheets)+1}'
            ET.SubElement(sheetparent,T('sheet'),{'name':name,'sheetId':str(nid),f'{{{RNS}}}id':rid})
            ET.SubElement(rels,f'{{{REL}}}Relationship',{'Id':rid,'Type':RNS+'/worksheet',
                                                         'Target':f'worksheets/sheet{sheet_seq}.xml'})
            ET.SubElement(content,f'{{{CT}}}Override',{'PartName':f'/xl/worksheets/sheet{sheet_seq}.xml',
                                                       'ContentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'})
            output_sheets.append((f'xl/worksheets/sheet{sheet_seq}.xml',xmlbytes))
        allreports=[]
        for name,info in metadata.items():
            add('REVISION OIC' if len(metadata)==1 else 'REV OIC '+name[:20],('mirror',info['xmlpath'],info))
            allreports.extend((name,r) for r in info['reports'].values())
        obsrows=[['HOJA ORIGEN','FILA','TIPO DE SUMINISTRO','INSTITUCIÓN / SIGLAS','CONTRATO','CLAVE CNIS','PROVEEDOR',
                  'SEVERIDAD','REGLA','CELDAS INVOLUCRADAS','DESCRIPCIÓN','EVIDENCIA','ACCIÓN SOLICITADA',
                  'DECISIÓN REVISOR','COMENTARIO FINAL']]
        for name,r in sorted(allreports,key=lambda x:(x[0],x[1].fila)):
            for f in r.hallazgos:
                obsrows.append([name,f.fila,rubro(r.datos.get('A')),fmt(r.datos.get('D')) or fmt(r.datos.get('F')),
                    fmt(r.datos.get('H')),fmt(r.datos.get('Q')),fmt(r.datos.get('K')),f.gravedad,f.codigo,
                    ', '.join(f'{col}{f.fila}' for col in f.columnas),f.descripcion,
                    f.evidencia,f.accion,'PENDIENTE',''])
        add('OBSERVACIONES OIC',_make_sheet(obsrows,head_style,15))
        sumrows=[['INDICADOR','VALOR'],['Fecha de corte',summary['fecha_corte']],
                 ['Registros analizados',summary['registros']],['Filas con ERROR',summary['errores']],
                 ['Filas con REVISAR',summary['revisar']],['Filas INFORMATIVO',summary['informativos']],
                 ['Filas OK',summary['ok']],['Filas con inconsistencia',summary['filas_con_inconsistencias']],
                 ['Total hallazgos (no filas)',summary['hallazgos']],['Claves CNIS en catálogo',summary['catalogo_cnis_claves']],
                 ['Criterio días pendientes',options.dias_pendiente],
                 ['Tolerancia monto contratado',str(options.tolerancia_contratado)],
                 ['Tolerancia monto ejercido',str(options.tolerancia_ejercido)],
                 ['Alcance','Validación automatizada, sujeta a revisión documental.'],
                 ['Integridad','Se conserva íntegra cada hoja original; marcado únicamente en espejo.'],
                 ['Regla','Filas con varios hallazgos cuentan una sola vez en el resultado general.'],
                 ['CNIS','Catálogo anexo del archivo de referencia; vigencia no confirmada contra versión oficial actual.'],
                 ['Reglas adicionales','MX01-MX11 y controles MD01, MC01, SX01; corroboración documental.'],
                 ['IVA','Coincidencia con 1.16 = INFORMATIVO; no acredita por sí sola el IVA aplicable.'],
                 ['ADVERTENCIA','Monto contractual repetido por clave NO se suma como monto adicional.'],
                 ['MODO DE REVISIÓN',summary['modo']],
                 ['TIPO DE SUMINISTRO','REGISTROS'],]
        for tipo,stat in summary.get('por_tipo',{}).items():
            sumrows.append([tipo,stat['registros']])
            for metrica in ('errores','revisar','informativos','ok','hallazgos'):
                sumrows.append(['    '+tipo+' · '+metrica,stat[metrica]])
        sumrows.extend([['INSTITUCIÓN · TIPO','REGISTROS / INCONSISTENCIAS']])
        for item in summary.get('por_institucion_tipo',[]):
            sumrows.append([item['institucion']+' · '+item['tipo'],
                            str(item['registros'])+' / '+str(item['con_inconsistencia'])])
        sumrows.append(['REGLA','HALLAZGOS'])
        sumrows.extend([c,n] for c,n in summary['reglas'].items())
        add('RESUMEN OIC',_make_sheet(sumrows,head_style,2))
        # En calcPr, Excel recalcula fórmulas originales cuando se abra el libro.
        calc=workbook.find(T('calcPr'))
        if calc is not None:calc.set('fullCalcOnLoad','1')
        overwrites={
            'xl/styles.xml':styles,
            'xl/workbook.xml':_register_and_clean_xml(ET.tostring(workbook,encoding='utf-8',xml_declaration=True)),
            'xl/_rels/workbook.xml.rels':ET.tostring(rels,encoding='utf-8',xml_declaration=True).replace(b'ns0:',b'').replace(b'xmlns:ns0=',b'xmlns='),
            '[Content_Types].xml':ET.tostring(content,encoding='utf-8',xml_declaration=True).replace(b'ct:',b'').replace(b'xmlns:ct=',b'xmlns='),
        }
        with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as zout:
            for info in zin.infolist():
                payload=overwrites.get(info.filename)
                if payload is None:
                    # Copia el contenido del miembro original por streaming; no cambia un byte.
                    with zin.open(info) as fi,zout.open(deepcopy(info),'w',force_zip64=True) as fo:
                        shutil.copyfileobj(fi,fo,length=1024*1024)
                else:
                    zout.writestr(deepcopy(info),payload)
            for newname,spec in output_sheets:
                if isinstance(spec,tuple) and spec[0]=='mirror':
                    with zout.open(newname,'w',force_zip64=True) as sink:
                        _mirror_sheet(zin,spec[1],spec[2],yellow,head_style,sink)
                else:zout.writestr(newname,spec)
