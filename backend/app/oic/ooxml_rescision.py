# -*- coding: utf-8 -*-
"""Compatibilidad OOXML para conservar tablas dinámicas, macros externos y gráficos.
Opera sobre COPIAS de archivos XLSX; mantiene intactos sus partes no afectados.
Usa exclusivamente la biblioteca estándar de Python (sin openpyxl ni pandas).
"""
from __future__ import annotations
import collections
import copy
import io
import os
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

M='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
V='urn:schemas-microsoft-com:vml'
O='urn:schemas-microsoft-com:office:office'
X='urn:schemas-microsoft-com:office:excel'
q=lambda namespace, name:'{%s}%s'%(namespace,name)

# Captura los namespaces originales para evitar perder atributos mc:Ignorable.
def xmlparse(raw):
    it=ET.iterparse(io.BytesIO(raw),events=('start-ns','start'))
    known=set()
    for ev,obj in it:
        if ev=='start-ns':
            pref,uri=obj
            if pref not in ('xml','xmlns') and (pref,uri) not in known:
                known.add((pref,uri))
                try: ET.register_namespace(pref or '',uri)
                except (ValueError,TypeError): pass
    return it.root

def dump(el):
    return ET.tostring(el,encoding='utf-8',xml_declaration=True)

def index_ref(ref):
    m=re.match(r'\$?([A-Z]+)\$?(\d+)$',ref)
    if not m: return 0,0
    c=0
    for ch in m.group(1):c=c*26+ord(ch)-64
    return int(m.group(2)),c

def col_letter(c):
    s=''
    while c: c,rem=divmod(c-1,26);s=chr(65+rem)+s
    return s

def all_sheet_parts(z):
    wb=xmlparse(z.read('xl/workbook.xml'))
    rels=xmlparse(z.read('xl/_rels/workbook.xml.rels'))
    rid_to={r.get('Id'):r.get('Target') for r in rels}
    out={}
    for sh in wb.findall('./'+q(M,'sheets')+'/'+q(M,'sheet')):
        rid=sh.get(q(R,'id'))
        target=rid_to[rid]
        part=(target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target))
        out[sh.get('name')]=part
    return out,wb,rels

def read_sheets(path,find_mapping,normalize):
    """Devuelve el mismo contrato de filas de discover_sheets sin depender de artifact_tool."""
    result=[]
    with zipfile.ZipFile(path) as z:
        parts,_,_=all_sheet_parts(z)
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            root=xmlparse(z.read('xl/sharedStrings.xml'))
            shared=[''.join((t.text or '') for t in si.iter(q(M,'t'))) for si in root.findall(q(M,'si'))]
        for name,path in parts.items():
            if normalize(name).startswith(('DICCIONARIO','OBSERVACIONES','ANALISIS')):continue
            root=xmlparse(z.read(path)); values={}; highcol=0
            for row in root.findall('.//'+q(M,'sheetData')+'/'+q(M,'row')):
                r=int(row.get('r'))
                rowvals={}
                for c in row.findall(q(M,'c')):
                    ref=c.get('r');rr,cc=index_ref(ref)
                    if cc>120: continue
                    v=c.find(q(M,'v'));ii=c.find(q(M,'is'))
                    raw=None
                    if ii is not None:raw=''.join(t.text or '' for t in ii.iter(q(M,'t')))
                    elif v is not None:
                        raw=v.text
                        if c.get('t')=='s':
                            try:raw=shared[int(raw)]
                            except (IndexError,ValueError):pass
                        elif c.get('t') not in ('str','e','inlineStr') and raw is not None:
                            try: raw=float(raw)
                            except ValueError:pass
                    rowvals[cc-1]=raw
                    highcol=max(highcol,cc)
                values[r]=rowvals
            if not values or highcol<=2:continue
            best=None
            for r in range(1,min(12,max(values))+1):
                heads=[values.get(r,{}).get(c) for c in range(highcol)]
                mapping=find_mapping(heads)
                if {'contrato','proveedor','estatus','fuente','motivos','inicio','cantidad_contratada'} <= mapping.keys():
                    score=sum(k in mapping for k in ('contrato','proveedor','estatus','monto','precio','cantidad_contratada','cantidad_solicitada'))
                    if score>=6 and (best is None or score>best[0]):best=(score,r,mapping)
            if best:
                start=best[1]
                end=max(values)
                matrix=[[values.get(r,{}).get(c) for c in range(highcol)] for r in range(start,end+1)]
                result.append((name,start-1,best[2],matrix))
    return result


def pivot_present(path):
    with zipfile.ZipFile(path) as z:
        return any('pivottables/' in p.lower() or 'pivotcache/' in p.lower() for p in z.namelist())


def color_notes(found):
    rank={'DOCUMENTAL':1,'REVISAR':2,'ERROR':3}
    primary={}; relatives=set(); noted=collections.defaultdict(list)
    for f in found:
        k=(f.sheet,f.cell)
        if rank[f.severity]>rank.get(primary.get(k,''),0):primary[k]=f.severity
        noted[k].append(f)
        for r in f.related: relatives.add((f.sheet,r))
    for k in relatives-primary.keys():primary[k]='RELACIONADA'
    notes={}
    for k,finds in noted.items():
        body='OBSERVACIONES PARA ATENDER — NO ES CORRECCIÓN AUTOMÁTICA\n'
        for i,f in enumerate(finds[:8],1):
            body+=f'\n{i}. [{f.severity} | {f.rule}] {f.detail}\nAcción: {f.action}'
            if f.related:body+='\nVerificar también: '+', '.join(f.related)
        if len(finds)>8: body+=f'\n(+{len(finds)-8} observaciones adicionales en OBSERVACIONES)'
        notes[k]=body[:7000]
    return primary,notes


def fill_rgba(hexcolor):return 'FF'+hexcolor.lstrip('#').upper()

def apply_styles(root, primary, colors):
    fills=root.find(q(M,'fills')); fonts=root.find(q(M,'fonts'));cellxfs=root.find(q(M,'cellXfs'))
    if fills is None or cellxfs is None or fonts is None:raise RuntimeError('Estilos OOXML incompletos')
    fills_by_color={}
    for key,color in colors.items():
        i=len(fills)
        e=ET.SubElement(fills,q(M,'fill'))
        p=ET.SubElement(e,q(M,'patternFill'),{'patternType':'solid'})
        ET.SubElement(p,q(M,'fgColor'),{'rgb':fill_rgba(color)})
        ET.SubElement(p,q(M,'bgColor'),{'indexed':'64'})
        fills_by_color[key]=i
    # Estilos nuevos basados en los existentes, sin alterar referencias previas.
    before=list(cellxfs)
    cache={}
    def cellstyle(oldid,color,fontid=None):
        key=(oldid,color,fontid)
        if key in cache:return cache[key]
        xf=copy.deepcopy(before[oldid] if oldid<len(before) else before[0])
        if color:
            xf.set('fillId',str(fills_by_color[color]));xf.set('applyFill','1')
        if fontid is not None:
            xf.set('fontId',str(fontid));xf.set('applyFont','1')
        idx=len(cellxfs);cellxfs.append(xf);cache[key]=idx
        return idx
    font_white=ET.SubElement(fonts,q(M,'font'))
    ET.SubElement(font_white,q(M,'b'))
    ET.SubElement(font_white,q(M,'sz'),{'val':'12'})
    ET.SubElement(font_white,q(M,'color'),{'rgb':'FFFFFFFF'})
    ET.SubElement(font_white,q(M,'name'),{'val':'Calibri'})
    white_id=len(fonts)-1
    font_base=ET.SubElement(fonts,q(M,'font'))
    ET.SubElement(font_base,q(M,'sz'),{'val':'10'})
    ET.SubElement(font_base,q(M,'color'),{'rgb':'FF16253C'})
    ET.SubElement(font_base,q(M,'name'),{'val':'Calibri'})
    base_font_id=len(fonts)-1
    label_styles={
      'title':cellstyle(0,'TITLE',white_id),
      'header':cellstyle(0,'HEADER',white_id),
      'sub':cellstyle(0,'SUB',base_font_id),
      'body':cellstyle(0,None,base_font_id),
      'body_alt':cellstyle(0,'BODY_ALT',base_font_id),
      'ERROR':cellstyle(0,'ERROR',base_font_id),
      'REVISAR':cellstyle(0,'REVISAR',base_font_id),
      'DOCUMENTAL':cellstyle(0,'DOCUMENTAL',base_font_id),
      'RELACIONADA':cellstyle(0,'RELACIONADA',base_font_id),
    }
    fills.set('count',str(len(fills)));fonts.set('count',str(len(fonts)))
    def style_for(original,code):return cellstyle(original,code)
    return style_for,label_styles,cellxfs


def apply_cell_colors(root,styles,style_for):
    sd=root.find(q(M,'sheetData'))
    if sd is None:return
    byrow=collections.defaultdict(dict)
    for addr,sev in styles.items():
        row,col=index_ref(addr);byrow[row][col]=(addr,sev)
    rowindex={int(row.get('r')):row for row in sd.findall(q(M,'row'))}
    for r,data in byrow.items():
        row=rowindex.get(r)
        if row is None:
            row=ET.SubElement(sd,q(M,'row'),{'r':str(r)})
            rowindex[r]=row
        existing={index_ref(c.get('r'))[1]:c for c in row.findall(q(M,'c'))}
        for col,(addr,sev) in data.items():
            c=existing.get(col)
            if c is None:
                c=ET.SubElement(row,q(M,'c'),{'r':addr})
            old=int(c.get('s','0'))
            c.set('s',str(style_for(old,sev)))
        row[:]=sorted(row,key=lambda obj:index_ref(obj.get('r','A1'))[1] if obj.tag==q(M,'c') else -1)
    sd[:]=sorted(sd,key=lambda x:int(x.get('r','0')))


def xlsx_comment_part(notes):
    root=ET.Element(q(M,'comments'))
    authors=ET.SubElement(root,q(M,'authors'))
    ET.SubElement(authors,q(M,'author')).text='Observaciones automáticas para validación'
    lst=ET.SubElement(root,q(M,'commentList'))
    for addr,body in sorted(notes.items(),key=lambda x:index_ref(x[0])):
        e=ET.SubElement(lst,q(M,'comment'),{'ref':addr,'authorId':'0'})
        txt=ET.SubElement(e,q(M,'text'))
        t=ET.SubElement(txt,q(M,'t'),{q('http://www.w3.org/XML/1998/namespace','space'):'preserve'})
        t.text=body
    return dump(root)

def make_vml(notes):
    ET.register_namespace('v',V)
    ET.register_namespace('o',O)
    ET.register_namespace('x',X)
    root=ET.Element('xml')
    layout=ET.SubElement(root,q(O,'shapelayout'),{q(V,'ext'):'edit'})
    ET.SubElement(layout,q(O,'idmap'),{q(V,'ext'):'edit','data':'1'})
    ET.SubElement(root,q(V,'shapetype'),{'id':'_x0000_t202','coordsize':'21600,21600',q(O,'spt'):'202',
             'path':'m,l,21600r21600,l21600,xe'})
    for n,(addr,body) in enumerate(sorted(notes.items(),key=lambda x:index_ref(x[0]))):
        row,col=index_ref(addr)
        sh=ET.SubElement(root,q(V,'shape'),{
            'id':'_x0000_s'+str(1025+n),'type':'#_x0000_t202',
            'style':'position:absolute;visibility:hidden','fillcolor':'#ffffe1',q(O,'insetmode'):'auto'})
        ET.SubElement(sh,q(V,'fill'),{'color2':'#ffffe1'})
        ET.SubElement(sh,q(V,'shadow'),{'on':'t','color':'black','obscured':'t'})
        ET.SubElement(sh,q(V,'path'),{q(O,'connecttype'):'none'})
        t=ET.SubElement(sh,q(V,'textbox'),{'style':'mso-direction-alt:auto'})
        ET.SubElement(t,'div',{'style':'text-align:left'})
        cli=ET.SubElement(sh,q(X,'ClientData'),{'ObjectType':'Note'})
        ET.SubElement(cli,q(X,'MoveWithCells'))
        ET.SubElement(cli,q(X,'SizeWithCells'))
        ET.SubElement(cli,q(X,'Anchor')).text=f'{max(0,col-1)}, 15, {max(0,row-1)}, 2, {col+4}, 20, {row+3}, 3'
        ET.SubElement(cli,q(X,'AutoFill')).text='False'
        ET.SubElement(cli,q(X,'Row')).text=str(row-1)
        ET.SubElement(cli,q(X,'Column')).text=str(col-1)
    return dump(root)


def add_relationship(rels,reltype,target):
    ids={el.get('Id') for el in rels}
    i=1
    while 'rId'+str(i) in ids:i+=1
    rid='rId'+str(i)
    ET.SubElement(rels,q(PKG,'Relationship'),{'Id':rid,'Type':reltype,'Target':target})
    return rid


def observe_worksheet(findings,cutoff,label_styles):
    sh=ET.Element(q(M,'worksheet'))
    ET.SubElement(sh,q(M,'dimension'),{'ref':'A1:M'+str(6+max(1,len(findings)))})
    views=ET.SubElement(sh,q(M,'sheetViews'))
    view=ET.SubElement(views,q(M,'sheetView'),{'workbookViewId':'0'})
    ET.SubElement(view,q(M,'pane'),{'ySplit':'6','topLeftCell':'A7','activePane':'bottomLeft','state':'frozen'})
    ET.SubElement(view,q(M,'selection'),{'pane':'bottomLeft','activeCell':'A7','sqref':'A7'})
    ET.SubElement(sh,q(M,'sheetFormatPr'),{'defaultRowHeight':'17'})
    cols=ET.SubElement(sh,q(M,'cols'))
    widths=[8,14,29,35,17,10,28,58,65,22,40,42,18]
    for k,w in enumerate(widths,1):ET.SubElement(cols,q(M,'col'),{'min':str(k),'max':str(k),'width':str(w),'customWidth':'1'})
    data=ET.SubElement(sh,q(M,'sheetData'))
    def row(r,items,height=None):
        attrs={'r':str(r)}
        if height: attrs.update({'ht':str(height),'customHeight':'1'})
        rr=ET.SubElement(data,q(M,'row'),attrs)
        for ci,(val,style) in enumerate(items,1):
            if val is None:continue
            c=ET.SubElement(rr,q(M,'c'),{'r':col_letter(ci)+str(r),'s':str(label_styles[style])})
            if isinstance(val,(int,float)) and not isinstance(val,bool):
                ET.SubElement(c,q(M,'v')).text=str(val)
            else:
                c.set('t','inlineStr')
                s=ET.SubElement(c,q(M,'is'))
                t=ET.SubElement(s,q(M,'t'),{q('http://www.w3.org/XML/1998/namespace','space'):'preserve'})
                t.text=str(val)
        return rr
    row(1,[('CONTROL DE INCONSISTENCIAS | LAYOUT DE RESCISIÓN','title')],34)
    row(2,[('El layout original se conserva sin cambios. Filtre los hallazgos, vaya a la hoja y celda indicada, corrija o aclare y registre la atención en esta pestaña.','sub')],38)
    cc=collections.Counter(f.severity for f in findings)
    row(3,[('Fecha de corte','sub'),(cutoff.isoformat(),'body'),('Total observaciones','sub'),(len(findings),'body'),
           ('Errores','sub'),(cc['ERROR'],'ERROR'),('Por revisar','sub'),(cc['REVISAR'],'REVISAR'),
           ('Documentales','sub'),(cc['DOCUMENTAL'],'DOCUMENTAL')],22)
    row(4,[('ROJO','ERROR'),('Error verificable','body'),('ÁMBAR','REVISAR'),('Confirmar con soporte','body'),
           ('AZUL','DOCUMENTAL'),('Evidencia por identificar','body'),('GRIS','RELACIONADA'),('Dato relacionado','body')],22)
    headers=['Folio','Tipo','Institución / UR','No. de contrato','Hoja','Celda','Campo observado','Hallazgo',
             'Qué debe hacer el instituto','Celdas relacionadas','Valor actual','Respuesta del instituto','Estatus de atención']
    row(6,[(h,'header') for h in headers],36)
    for i,f in enumerate(findings,1):
        row(6+i,[(i,'body'),(f.severity,f.severity),(f.unit,'body'),(f.contract,'body'),
             (f.sheet,'body'),(f.cell,'body'),(f.field,'body'),(f.detail,'body'),
             (f.action,'body'),(', '.join(f.related),'body'),(f.value,'body'),('', 'body'),('PENDIENTE','body')],38)
    if not findings:row(7,[('SIN OBSERVACIONES AUTOMÁTICAS','body')])
    merges=ET.SubElement(sh,q(M,'mergeCells'),{'count':'2'})
    ET.SubElement(merges,q(M,'mergeCell'),{'ref':'A1:M1'})
    ET.SubElement(merges,q(M,'mergeCell'),{'ref':'A2:M2'})
    if findings:
        ET.SubElement(sh,q(M,'autoFilter'),{'ref':f'A6:M{6+len(findings)}'})
        dv=ET.SubElement(sh,q(M,'dataValidations'),{'count':'1'})
        v=ET.SubElement(dv,q(M,'dataValidation'),{
            'type':'list','allowBlank':'0','showDropDown':'0','sqref':f'M7:M{6+len(findings)}'})
        ET.SubElement(v,q(M,'formula1')).text='"PENDIENTE,CORREGIDO,ACLARADO,NO APLICA"'
        links=ET.SubElement(sh,q(M,'hyperlinks'))
        for i,f in enumerate(findings,7):
            ET.SubElement(links,q(M,'hyperlink'),{'ref':'F'+str(i),
                'location':f"'{f.sheet.replace(chr(39),chr(39)*2)}'!{f.cell}",
                'display':f.cell,'tooltip':'Ir al dato observado en la hoja original'})
    return dump(sh)


def write_annotated(original,dest,found,cutoff,colors):
    """Modifica sólo los elementos necesarios de una COPIA, conservando pivotes y originales."""
    original=Path(original);dest=Path(dest)
    prim,notes=color_notes(found)
    with zipfile.ZipFile(original) as z:
        original_parts=set(z.namelist())
        sheet_paths,workbook,wb_rels=all_sheet_parts(z)
        sheet_changes=collections.defaultdict(dict)
        note_changes=collections.defaultdict(dict)
        for (sheet,addr),severity in prim.items():sheet_changes[sheet][addr]=severity
        for (sheet,addr),body in notes.items():note_changes[sheet][addr]=body
        styles=xmlparse(z.read('xl/styles.xml'))
        palette={**colors,'TITLE':'#6F1736','HEADER':'#193B60','SUB':'#E7EEF7','BODY_ALT':'#F6F8FC'}
        color_style,label_style,_=apply_styles(styles,prim,palette)
        replacements={'xl/styles.xml':dump(styles)}
        additions={}
        used=set(original_parts)
        comments_type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
        vml_type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing'
        # Un archivo de comentarios/notas por hoja con hallazgos.
        for i,(name,part) in enumerate(sheet_paths.items(),1):
            if name not in sheet_changes:continue
            sheet=xmlparse(z.read(part))
            apply_cell_colors(sheet,sheet_changes[name],color_style)
            relpart=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')
            rels=xmlparse(z.read(relpart)) if relpart in used else ET.Element(q(PKG,'Relationships'))
            # Evitar sobrescribir comentarios previos; estos archivos provienen de layouts sin comentarios.
            existing_comments=any(x.get('Type','').endswith('/comments') for x in rels)
            if existing_comments:
                raise RuntimeError('La hoja contiene comentarios anteriores; requiere resguardar/conciliar antes de agregar nuevos.')
            if note_changes[name]:
                commentpart=f'xl/commentsRevision_{i}.xml'
                vmlpart=f'xl/drawings/vmlRevision_{i}.vml'
                while commentpart in used:commentpart=commentpart.replace('.xml','_a.xml')
                while vmlpart in used:vmlpart=vmlpart.replace('.vml','_a.vml')
                additions[commentpart]=xlsx_comment_part(note_changes[name])
                additions[vmlpart]=make_vml(note_changes[name])
                used.add(commentpart);used.add(vmlpart)
                add_relationship(rels,comments_type,posixpath.relpath(commentpart,posixpath.dirname(part)))
                vid=add_relationship(rels,vml_type,posixpath.relpath(vmlpart,posixpath.dirname(part)))
                # legacyDrawing debe insertarse antes de tableParts.
                drawing=ET.Element(q(M,'legacyDrawing'),{q(R,'id'):vid})
                insert=len(sheet)
                for idx,tag in enumerate(sheet):
                    if tag.tag in (q(M,'tableParts'),q(M,'extLst')):insert=idx;break
                sheet.insert(insert,drawing)
            replacements[part]=dump(sheet)
            replacements[relpart]=dump(rels)
        # Una hoja adicional sin tocar las tablas dinámicas existentes.
        existing_sheet_names=set(sheet_paths)
        obs_name='OBSERVACIONES'
        count=2
        while obs_name in existing_sheet_names:
            obs_name=f'OBSERVACIONES_{count}';count+=1
        sheets_el=workbook.find(q(M,'sheets'))
        sheet_id=max((int(sh.get('sheetId','0')) for sh in sheets_el),default=0)+1
        new_wspath='xl/worksheets/obs_rescision_auto.xml'
        while new_wspath in used: new_wspath=new_wspath.replace('.xml','_a.xml')
        used.add(new_wspath)
        rid=add_relationship(wb_rels,R+'/worksheet',new_wspath.removeprefix('xl/'))
        ET.SubElement(sheets_el,q(M,'sheet'),{'name':obs_name,'sheetId':str(sheet_id),q(R,'id'):rid})
        replacements['xl/workbook.xml']=dump(workbook)
        replacements['xl/_rels/workbook.xml.rels']=dump(wb_rels)
        additions[new_wspath]=observe_worksheet(found,cutoff,label_style)
        content=xmlparse(z.read('[Content_Types].xml'))
        current_defaults={x.get('Extension') for x in content.findall(q(CT,'Default'))}
        if 'vml' not in current_defaults:
            ET.SubElement(content,q(CT,'Default'),{'Extension':'vml','ContentType':'application/vnd.openxmlformats-officedocument.vmlDrawing'})
        ET.SubElement(content,q(CT,'Override'),{'PartName':'/'+new_wspath,
                    'ContentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'})
        for path in additions:
            if path.startswith('xl/commentsRevision'):
                ET.SubElement(content,q(CT,'Override'),{'PartName':'/'+path,
                'ContentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml'})
        replacements['[Content_Types].xml']=dump(content)
        dest.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(dest,'w') as output:
            for info in z.infolist():output.writestr(info,replacements.get(info.filename,z.read(info.filename)))
            for path,blob in additions.items():output.writestr(path,blob,zipfile.ZIP_DEFLATED)
            for path,blob in replacements.items():
                if path not in original_parts:output.writestr(path,blob,zipfile.ZIP_DEFLATED)
    return dest


# MODO DE DEVOLUCION SIN MARCAS EN EL LAYOUT
# Agrega UNICAMENTE la nueva hoja de observaciones. Todas las piezas originales de
# cada hoja (datos, formato, filtros, validaciones, tablas dinámicas, dibujos) se
# copian byte a byte sin modificarlas.
def write_report_only(original, dest, findings, cutoff, colors):
    original=Path(original)
    dest=Path(dest)
    if original.resolve()==dest.resolve():
        raise ValueError('La salida no puede ser el archivo original.')
    with zipfile.ZipFile(original,'r') as zin:
        all_parts=set(zin.namelist())
        sheet_paths, workbook, wb_rels=all_sheet_parts(zin)
        obs_name='OBSERVACIONES'
        suffix=2
        while obs_name in sheet_paths:
            obs_name=f'OBSERVACIONES_{suffix}'
            suffix+=1
        ws_part='xl/worksheets/observaciones_rescision.xml'
        while ws_part in all_parts:
            ws_part=ws_part.replace('.xml','_2.xml')
        styles=xmlparse(zin.read('xl/styles.xml'))
        palette={**colors,'TITLE':'#6F1736','HEADER':'#193B60',
                 'SUB':'#E7EEF7','BODY_ALT':'#F6F8FC'}
        _,label_styles,_=apply_styles(styles, {}, palette)
        sheets_el=workbook.find(q(M,'sheets'))
        new_sheet_id=max((int(sh.get('sheetId','0')) for sh in sheets_el),default=0)+1
        rid=add_relationship(wb_rels,R+'/worksheet',ws_part.removeprefix('xl/'))
        ET.SubElement(sheets_el,q(M,'sheet'),{
            'name':obs_name,'sheetId':str(new_sheet_id),q(R,'id'):rid})
        content_types=xmlparse(zin.read('[Content_Types].xml'))
        ET.SubElement(content_types,q(CT,'Override'),{
            'PartName':'/'+ws_part,
            'ContentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
        })
        rewritten={
            'xl/workbook.xml':dump(workbook),
            'xl/_rels/workbook.xml.rels':dump(wb_rels),
            'xl/styles.xml':dump(styles),
            '[Content_Types].xml':dump(content_types),
        }
        dest.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(dest,'w') as zout:
            for zi in zin.infolist():
                zout.writestr(zi,rewritten.get(zi.filename,zin.read(zi.filename)))
            zout.writestr(ws_part,observe_worksheet(findings,cutoff,label_styles),zipfile.ZIP_DEFLATED)
    return dest
