# -*- coding: utf-8 -*-
"""Copia exacta de todas las piezas OOXML originales y crea una NUEVA hoja espejo.
No depende de openpyxl/pandas. El contenido de todas las hojas originales
se conserva byte a byte. El autor debe evaluar cualquier aviso de Excel.
"""
from pathlib import Path
from collections import defaultdict
from copy import deepcopy
from xml.etree import ElementTree as ET
import zipfile
import re
import posixpath
from ooxml_rescision import M,R,PKG,CT,q,xmlparse,dump,all_sheet_parts,add_relationship,col_letter,index_ref

VERDE='1C594B'
AMARILLO='FFFF00'

def _append_styles(root,source_header):
    fonts=root.find(q(M,'fonts'))
    fills=root.find(q(M,'fills'))
    xfs=root.find(q(M,'cellXfs'))
    if any(x is None for x in (fonts,fills,xfs)):
        raise ValueError('Falta estructura de estilos requerida por Excel')
    default_style=int(source_header.get('s','0')) if source_header is not None else 0
    if default_style>=len(xfs):default_style=0
    style_ids={}
    note_fill_id=None
    original_xfs=[deepcopy(x) for x in xfs]
    painted_cache={}
    readable_font_cache={}
    for role,rgb,is_bold in (('header',VERDE,True),('note',AMARILLO,False)):
        fi=len(fills)
        fill=ET.SubElement(fills,q(M,'fill'))
        pattern=ET.SubElement(fill,q(M,'patternFill'),{'patternType':'solid'})
        ET.SubElement(pattern,q(M,'fgColor'),{'rgb':'FF'+rgb})
        ET.SubElement(pattern,q(M,'bgColor'),{'indexed':'64'})
        if role=='note': note_fill_id=fi
        fo=len(fonts)
        f=ET.SubElement(fonts,q(M,'font'))
        ET.SubElement(f,q(M,'sz'),{'val':'10'})
        if is_bold:ET.SubElement(f,q(M,'b'))
        ET.SubElement(f,q(M,'color'),{'rgb':'FFFFFFFF' if is_bold else 'FF111111'})
        ET.SubElement(f,q(M,'name'),{'val':'Calibri'})
        xf=deepcopy(xfs[default_style])
        xf.set('fontId',str(fo));xf.set('fillId',str(fi));xf.set('applyFill','1');xf.set('applyFont','1')
        alignment=xf.find(q(M,'alignment'))
        if alignment is None:alignment=ET.SubElement(xf,q(M,'alignment'))
        alignment.set('vertical','center')
        alignment.set('horizontal','center' if role=='header' else 'left')
        alignment.set('wrapText','1')
        xf.set('applyAlignment','1')
        style_ids[role]=len(xfs)
        xfs.append(xf)
    def painted_style(old_id):
        try: old_id=int(old_id)
        except (ValueError,TypeError):old_id=0
        if old_id>=len(original_xfs):old_id=0
        if old_id in painted_cache:return painted_cache[old_id]
        xf=deepcopy(original_xfs[old_id]);xf.set('fillId',str(note_fill_id));xf.set('applyFill','1')
        # Amarillo con caracteres OSCUROS aunque la celda original
        # tuviera texto blanco o color de tema; sin perder número ni bordes.
        original_font=int(xf.get('fontId','0'))
        if original_font not in readable_font_cache:
            source=fonts[original_font] if original_font<len(fonts) else fonts[0]
            legible=deepcopy(source)
            for oldcolor in list(legible.findall(q(M,'color'))): legible.remove(oldcolor)
            new_color=ET.Element(q(M,'color'),{'rgb':'FF111111'})
            name_el=legible.find(q(M,'name'))
            if name_el is not None:
                legible.insert(list(legible).index(name_el),new_color)
            else:
                legible.append(new_color)
            readable_font_cache[original_font]=len(fonts)
            fonts.append(legible)
            fonts.set('count',str(len(fonts)))
        xf.set('fontId',str(readable_font_cache[original_font]));xf.set('applyFont','1')
        new_id=len(xfs);xfs.append(xf);painted_cache[old_id]=new_id
        xfs.set('count',str(len(xfs)))
        return new_id
    for elem in (fonts,fills,xfs): elem.set('count',str(len(elem)))
    return style_ids,painted_style

def _new_cell(row,index,row_number,val,style):
    el=ET.SubElement(row,q(M,'c'),{'r':f'{col_letter(index)}{row_number}', 't':'inlineStr','s':str(style)})
    ins=ET.SubElement(el,q(M,'is'))
    t=ET.SubElement(ins,q(M,'t'))
    t.text=str(val)
    return el

def make_note(f):
    detail=' '.join((f.detail or '').split())
    action=' '.join((f.action or '').split())
    field=' '.join((f.field or '').split())
    if f.rule=='MONTO_X_PRECIO':
        prefix='Verificar monto contratado frente a cantidad contratada por precio unitario.'
    elif f.rule in ('ESTATUS_FUERA_CATALOGO',):prefix='Ajustar estatus conforme al diccionario.'
    elif f.rule=='FUENTE_FUERA_CATALOGO':prefix='Verificar fuente conforme al diccionario.'
    elif f.rule.startswith('NUMERICO_'):prefix='Verificar el dato numérico de '+field+'.'
    elif f.rule.startswith('OBSERVACION_PREVIA_'):prefix='Observación institucional anterior.'
    else:prefix='Verificar '+field+'.' if field else 'Verificar registro.'
    related=', '.join(f.related)
    result=f'{prefix} {detail} {action}'
    if related:result+=f' Datos relacionados: {related}.'
    return result[:1020]

def _duplicate_table(zin, original_sheet_part, dst, ct, existing_names, headers, header, end_row, last_col):
    """Crea una tabla INDEPENDIENTE con el estilo original en REVISION OIC.

    En el layout original el color puede provenir de TableStyleInfo, que
    NO está en los estilos de cada celda. Sin una tabla nueva, Excel no
    reproduce esos colores aunque se copien exactamente los estilos s=.
    La nueva tabla conserva el formato, amplía los autofiltros a las
    columnas de inconsistencias, y permite que el formato directo amarillo
    tenga preferencia para las celdas observadas.
    """
    sheet_rels=posixpath.join(posixpath.dirname(original_sheet_part),'_rels',
                                  posixpath.basename(original_sheet_part)+'.rels')
    if sheet_rels not in existing_names:return None
    sr=xmlparse(zin.read(sheet_rels))
    target_by_id={rel.get('Id'):rel.get('Target') for rel in sr
                  if (rel.get('Type') or '').endswith('/table')}
    original_source=xmlparse(zin.read(original_sheet_part))
    tparts=original_source.find(q(M,'tableParts'))
    if tparts is None:return None
    original_table=None
    for tab_link in tparts.findall(q(M,'tablePart')):
        rid=tab_link.get(q(R,'id'))
        target=target_by_id.get(rid)
        if not target:continue
        table_part=posixpath.normpath(posixpath.join(posixpath.dirname(original_sheet_part),target))
        if table_part not in existing_names:continue
        src=xmlparse(zin.read(table_part))
        if (src.get('ref') or '').upper().startswith(f'A{header}:'):
            original_table=src
            break
    if original_table is None:return None

    existing_table_names=set()
    max_id=0
    for name in existing_names:
        if name.startswith('xl/tables/') and name.endswith('.xml'):
            try:
                t=xmlparse(zin.read(name))
                existing_table_names.add((t.get('displayName') or '').lower())
                max_id=max(max_id,int(t.get('id','0')))
            except (ValueError,KeyError):pass
    table_name='RevisionOIC'
    serial=2
    while table_name.lower() in existing_table_names:
        table_name=f'RevisionOIC_{serial}';serial+=1
    table_path='xl/tables/revision_oic_tabla.xml'
    serial=2
    while table_path in existing_names:
        table_path=f'xl/tables/revision_oic_tabla_{serial}.xml';serial+=1

    full_ref=f'A{header}:{col_letter(last_col)}{end_row}'
    attrs={'id':str(max_id+1),'name':table_name,
           'displayName':table_name,'ref':full_ref,'totalsRowShown':'0'}
    # No copiar metadatos opcionales que pueden depender de extensiones privadas
    # del Excel original; la hoja nueva obtiene el color de sus celdas y de TableStyleInfo.
    tab=ET.Element(q(M,'table'),attrs)
    ET.SubElement(tab,q(M,'autoFilter'),{'ref':full_ref})
    tc=ET.SubElement(tab,q(M,'tableColumns'),{'count':str(last_col)})
    source_columns=original_table.find(q(M,'tableColumns'))
    source_cols=list(source_columns) if source_columns is not None else []
    seen=set()
    for i in range(1,last_col+1):
        if i<=len(source_cols):
            name=source_cols[i-1].get('name') or (str(headers[i-1]) if i<=len(headers) else f'Columna_{i}')
            # No duplicar xr3:uid: esas claves deben ser únicas por tabla.
            col=ET.Element(q(M,'tableColumn'))
        elif i<=len(headers):
            name=str(headers[i-1] or f'Columna_{i}')
            col=ET.Element(q(M,'tableColumn'))
        else:
            # La numeración se calcula antes en el generador.
            row=next((r for r in dst.find(q(M,'sheetData')).findall(q(M,'row'))
                     if int(r.get('r','0'))==header),None)
            cell=next((c for c in row.findall(q(M,'c')) if c.get('r')==f'{col_letter(i)}{header}'),None) if row is not None else None
            raw=cell.find(q(M,'is')) if cell is not None else None
            name=''.join(t.text or '' for t in raw.iter(q(M,'t'))) if raw is not None else f'Inconsistencia_{i-len(headers)}'
            col=ET.Element(q(M,'tableColumn'))
        name=(name or f'Columna_{i}').strip()
        original_name=name;index=2
        while name.lower() in seen:
            name=f'{original_name}_{index}';index+=1
        seen.add(name.lower())
        col.set('id',str(i));col.set('name',name)
        tc.append(col)
    tsi=original_table.find(q(M,'tableStyleInfo'))
    if tsi is not None:tab.append(deepcopy(tsi))
    else:ET.SubElement(tab,q(M,'tableStyleInfo'),{'name':'TableStyleLight1',
                                                    'showFirstColumn':'0','showLastColumn':'0',
                                                    'showRowStripes':'0','showColumnStripes':'0'})
    # tableParts se ubica al final según el orden del esquema SpreadsheetML.
    part_nodes=ET.SubElement(dst,q(M,'tableParts'),{'count':'1'})
    ET.SubElement(part_nodes,q(M,'tablePart'),{q(R,'id'):'rId1'})
    relroot=ET.Element(q(PKG,'Relationships'))
    ET.SubElement(relroot,q(PKG,'Relationship'),{
        'Id':'rId1','Type':R+'/table',
        'Target':'../tables/'+posixpath.basename(table_path)})
    ET.SubElement(ct,q(CT,'Override'),{
        'PartName':'/'+table_path,
        'ContentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml'})
    new_sheet_part='xl/worksheets/revision_oic_nueva.xml'
    if dst.get('_generated_sheet_part'):
        new_sheet_part=dst.get('_generated_sheet_part')
        del dst.attrib['_generated_sheet_part']
    new_rel_part=posixpath.join(posixpath.dirname(new_sheet_part),'_rels',
                              posixpath.basename(new_sheet_part)+'.rels')
    return {'table_path':table_path,'table_xml':dump(tab),
            'rel_path':new_rel_part,'rel_xml':dump(relroot)}

def build_mirror_workbook(original,output,source_sheet,header_zero,headers,findings):
    """Agrega REVISION OIC como hoja con las MISMAS filas y columnas + Inconsistencia_n.
    No cambia hojas originales. Regresa columnas nuevas, filas, comentarios.
    """
    original=Path(original);output=Path(output)
    if original.resolve()==output.resolve():raise ValueError('No se permite sobrescribir el archivo original.')
    with zipfile.ZipFile(original) as zin:
        all_names=set(zin.namelist())
        sheets,workbook,wb_rels=all_sheet_parts(zin)
        if source_sheet not in sheets:raise ValueError(f'No existe hoja principal: {source_sheet}')
        existing=set(sheets)
        new_name='REVISION OIC';i=2
        while new_name in existing:new_name=f'REVISION OIC {i}';i+=1
        part='xl/worksheets/revision_oic_nueva.xml';i=2
        while part in all_names:part=f'xl/worksheets/revision_oic_nueva_{i}.xml';i+=1
        src=xmlparse(zin.read(sheets[source_sheet]))
        sdata=src.find(q(M,'sheetData'))
        if sdata is None:raise ValueError('No se encontró hoja de registros')
        header=header_zero+1
        # Construye raíz y nodos en orden de SpreadsheetML, sin copiar asociaciones
        # externas (tablas, comentarios, pivotes, relaciones o dibujos).
        dst=ET.Element(q(M,'worksheet'))
        for name in ('sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData','mergeCells','conditionalFormatting','dataValidations','pageMargins'):
            for node in src.findall(q(M,name)):
                if name=='sheetPr':
                    # sheetPr puede referir a recursos de otro objeto, omitir.
                    continue
                if name in ('conditionalFormatting','dataValidations'):
                    # No propagar reglas referenciando celdas de hojas externas.
                    continue
                dst.append(deepcopy(node))
        ds=dst.find(q(M,'sheetData'))
        if ds is None:raise ValueError('Falta información de la tabla fuente.')
        # Estilos de nuevas columnas, sin modificar los estilos que usa el original.
        sty=xmlparse(zin.read('xl/styles.xml'))
        hdr_row=next((r for r in ds.findall(q(M,'row')) if int(r.get('r','0'))==header),None)
        hdr_cell=next(iter(hdr_row.findall(q(M,'c'))),None) if hdr_row is not None else None
        style,painted_style=_append_styles(sty,hdr_cell)
        max_col=max((index_ref(c.get('r','A1'))[1] for r in ds.findall(q(M,'row')) for c in r.findall(q(M,'c'))),default=len(headers))
        base_col=max(max_col,len(headers))
        # Las observaciones anteriores se conservan; las nuevas se numeran a continuación.
        previous=[int(m.group(1)) for h in headers if (m:=re.fullmatch(r'\s*INCONSISTENCIA[_\s-]*(\d+)\s*',str(h or ''),re.I))]
        start=max(previous,default=0)+1
        by_row=defaultdict(list)
        for f in findings:
            if f.sheet==source_sheet and f.row>header:by_row[f.row].append(f)
        ncols=max((len(lst) for lst in by_row.values()),default=0)
        ncols=max(1,ncols)
        last_col=base_col+ncols
        all_rows={int(r.get('r','0')):r for r in ds.findall(q(M,'row'))}
        if hdr_row is None:
            hdr_row=ET.Element(q(M,'row'),{'r':str(header)})
            all_rows[header]=hdr_row
            ds.append(hdr_row)
        # Colorear únicamente la hoja espejo: celda observada y TODAS las
        # celdas relacionadas con cada regla, incluso si estaban vacías.
        # Nunca colorear la hoja original que entregó la institución.
        related_by_row=defaultdict(set)
        for no,finds in by_row.items():
            for f in finds:
                for addr in (f.cell,*f.related):
                    m=re.fullmatch(r'\$?([A-Z]+)\$?(\d+)',str(addr).upper())
                    if not m:continue
                    target_row=int(m.group(2))
                    cc=0
                    for ch in m.group(1):cc=cc*26+(ord(ch)-64)
                    # Las reglas entre registros pueden referirse a OTRA fila.
                    # También se resalta esa celda implicada en REVISION OIC.
                    if target_row in all_rows and target_row>header and 1<=cc<=base_col:
                        related_by_row[target_row].add(cc)
        for no,r in sorted(all_rows.items()):
            if no==header:
                for j in range(ncols):_new_cell(r,base_col+j+1,no,f'Inconsistencia_{start+j}',style['header'])
            elif no>header:
                for j,f in enumerate(by_row.get(no,())):
                    _new_cell(r,base_col+j+1,no,make_note(f),style['note'])
                already={index_ref(c.get('r','A1'))[1]:c for c in r.findall(q(M,'c'))}
                for cc in related_by_row.get(no,()):
                    cell=already.get(cc)
                    if cell is None:
                        cell=ET.SubElement(r,q(M,'c'),{'r':f'{col_letter(cc)}{no}'})
                    cell.set('s',str(painted_style(cell.get('s','0'))))
            if no>=header:
                r.attrib.pop('hidden',None)
            r.set('spans',f'1:{last_col}')
            r[:]=sorted(r,key=lambda cell:index_ref(cell.get('r','A1'))[1] if cell.tag==q(M,'c') else 0)
        ds[:]=sorted(list(ds),key=lambda r:int(r.get('r','0')))
        # Extender columnas sin alterar sus estilos original.
        cols=dst.find(q(M,'cols'))
        if cols is None:
            cols=ET.Element(q(M,'cols'))
            place=list(dst).index(ds)
            dst.insert(place,cols)
        for j in range(base_col+1,last_col+1):
            ET.SubElement(cols,q(M,'col'),{'min':str(j),'max':str(j),'width':'66','customWidth':'1'})
        dimension=dst.find(q(M,'dimension'))
        end_row=max(all_rows)
        if dimension is None:
            dimension=ET.Element(q(M,'dimension'))
            dst.insert(0,dimension)
        dimension.set('ref',f'A1:{col_letter(last_col)}{end_row}')
        # Nuevo autofiltro sólo en revisión; conserva original sin tocar.
        # Si existe tabla de Excel, el filtro se incorpora a una tabla
        # independiente; si no, usar filtro convencional en la hoja.
        filter=ET.Element(q(M,'autoFilter'),{'ref':f'A{header}:{col_letter(last_col)}{end_row}'})
        dsidx=list(dst).index(ds)
        dst.insert(dsidx+1,filter)
        views=dst.find(q(M,'sheetViews'))
        if views is not None:
            for view in views.findall(q(M,'sheetView')):
                view.attrib.pop('tabSelected',None)
                # Revisión comienza en parte izquierda, no al final del layout.
                view.set('topLeftCell','A1')
                pane=view.find(q(M,'pane'))
                if pane is not None and pane.get('ySplit'):
                    try:
                        ys=int(float(pane.get('ySplit','0')))
                        if ys>0:pane.set('topLeftCell',f'A{ys+1}')
                    except ValueError:pass
        # Inscripción de la nueva hoja en partes de Excel.
        sheet_xml=workbook.find(q(M,'sheets'))
        new_id=max((int(s.get('sheetId','0')) for s in sheet_xml),default=0)+1
        rid=add_relationship(wb_rels,R+'/worksheet',part.removeprefix('xl/'))
        ET.SubElement(sheet_xml,q(M,'sheet'),{'name':new_name,'sheetId':str(new_id),q(R,'id'):rid})
        ct=xmlparse(zin.read('[Content_Types].xml'))
        ET.SubElement(ct,q(CT,'Override'),{'PartName':'/'+part,'ContentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'})
        # Una tabla de Excel tiene sus propios estilos visuales (TableStyleInfo).
        # Copiar solo celdas no garantiza conservarlos; duplicamos la tabla
        # manteniendo INTACTA la tabla y las relaciones del instituto.
        dst.set('_generated_sheet_part',part)
        extra=_duplicate_table(zin,sheets[source_sheet],dst,ct,all_names,headers,header,end_row,last_col)
        if extra:
            dst.remove(filter)  # El autofiltro es parte de la tabla nueva.
        else:
            dst.attrib.pop('_generated_sheet_part',None)
        # Los lectores de Excel esperan que [Content_Types].xml declare CT
        # como espacio de nombres predeterminado (no ns0:Types).
        # Registrar el namespace a propósito evita depender del último XML leído.
        ET.register_namespace('', M)
        workbook_bytes=dump(workbook)
        styles_bytes=dump(sty)
        ET.register_namespace('', PKG)
        wb_rels_bytes=dump(wb_rels)
        ET.register_namespace('', CT)
        content_types_bytes=dump(ct)
        ET.register_namespace('', M)
        replacements={'xl/workbook.xml':workbook_bytes,
                      'xl/_rels/workbook.xml.rels':wb_rels_bytes,
                      'xl/styles.xml':styles_bytes,
                      '[Content_Types].xml':content_types_bytes}
        output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                zout.writestr(info,replacements.get(info.filename,zin.read(info.filename)))
            zout.writestr(part,dump(dst))
            if extra:
                zout.writestr(extra['table_path'],extra['table_xml'])
                zout.writestr(extra['rel_path'],extra['rel_xml'])
    return {'sheet_name':new_name,'new_columns':ncols,'records':end_row-header,'styled_table':bool(extra),'findings':sum(map(len,by_row.values()))}
