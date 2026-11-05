# -*- coding: utf-8 -*-
"""Comprobación OOXML autónoma, no requiere instalar bibliotecas."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from ooxml_rescision import q,M,R,all_sheet_parts,index_ref
import posixpath

def verificar(original,resultado,findings=None,new_columns=None):
    original,resultado=Path(original),Path(resultado)
    with ZipFile(original) as z0,ZipFile(resultado) as z1:
        bad=z1.testzip()
        if bad:raise RuntimeError('Hay una entrada dañada en el XLSX: '+bad)
        sheets0,_,_=all_sheet_parts(z0)
        sheets1,_,_=all_sheet_parts(z1)
        if len(sheets1)!=len(sheets0)+1:
            raise RuntimeError('No se agregó exactamente una pestaña de revisión.')
        for name,part in sheets0.items():
            if name not in sheets1 or sheets1[name]!=part:
                raise RuntimeError('Se cambió la relación de una hoja original: '+name)
            if z0.read(part)!=z1.read(part):
                raise RuntimeError('Una hoja original fue alterada: '+name)
        new=[name for name in sheets1 if name not in sheets0]
        if len(new)!=1 or not new[0].startswith('REVISION OIC'):
            raise RuntimeError('La hoja de revisión no existe o tiene nombre inesperado.')
        root=ET.fromstring(z1.read(sheets1[new[0]]))
        filter_el=root.find(q(M,'autoFilter'))
        if filter_el is None:
            # Una tabla de Excel incorpora el filtro en su pieza table.xml.
            tp=root.find(q(M,'tableParts'))
            if tp is None or not tp.findall(q(M,'tablePart')):
                raise RuntimeError('Falta el filtro o una tabla filtrable en REVISION OIC.')
            sh_part=sheets1[new[0]]
            relpath=posixpath.join(posixpath.dirname(sh_part),'_rels',posixpath.basename(sh_part)+'.rels')
            if relpath not in z1.namelist():
                raise RuntimeError('La tabla de REVISION OIC no tiene relaciones.')
            rels=ET.fromstring(z1.read(relpath))
            links={r.get('Id'):r.get('Target') for r in rels}
            for part in tp.findall(q(M,'tablePart')):
                rid=part.get(q(R,'id'))
                if rid not in links:raise RuntimeError('Vínculo de tabla no localizado.')
                tpath=posixpath.normpath(posixpath.join(posixpath.dirname(sh_part),links[rid]))
                if tpath not in z1.namelist():raise RuntimeError('Falta pieza interna de tabla: '+tpath)
                table=ET.fromstring(z1.read(tpath))
                if table.find(q(M,'autoFilter')) is None:
                    raise RuntimeError('La tabla nueva no tiene autofiltros.')
            fref='(tabla independiente con filtros)'
        else:
            fref=filter_el.get('ref')
        if b'Inconsistencia_' not in z1.read(sheets1[new[0]]):
            raise RuntimeError('Faltan las columnas de inconsistencias.')
        # Verificación obligatoria de estilo visible: evita exportaciones
        # en que los comentarios aparecen sin fondo amarillo.
        styles=ET.fromstring(z1.read('xl/styles.xml'))
        fills=styles.find(q(M,'fills'))
        xfs=styles.find(q(M,'cellXfs'))
        def fill_of(cell):
            if cell is None: return None
            sid=int(cell.get('s','0'))
            if sid>=len(xfs):return None
            fi=int(xfs[sid].get('fillId','0'))
            if fi>=len(fills):return None
            pat=fills[fi].find(q(M,'patternFill'))
            fg=pat.find(q(M,'fgColor')) if pat is not None else None
            return (fg.get('rgb') or '').upper()[-6:] if fg is not None else ''
        cells={c.get('r'):c for row in root.find(q(M,'sheetData')).findall(q(M,'row'))
                           for c in row.findall(q(M,'c'))}
        note_cols=set(); note_positions=[]; note_headers=[]
        for addr,cell in cells.items():
            inline=cell.find(q(M,'is'))
            if inline is None: continue
            content=''.join(t.text or '' for t in inline.iter(q(M,'t')))
            if content.startswith('Inconsistencia_'):
                note_headers.append((index_ref(addr)[1],index_ref(addr)[0],addr,cell))
        if new_columns:
            note_headers=sorted(note_headers)[-new_columns:]
        if not note_headers:raise RuntimeError('No se encontraron las columnas Inconsistencia_n.')
        header_row=note_headers[0][1]
        for col_idx,row_idx,addr,cell in note_headers:
            if fill_of(cell)!='1C594B':raise RuntimeError('Encabezado de inconsistencias sin verde oscuro: '+addr)
            note_cols.add(col_idx)
        for addr,cell in cells.items():
            row_idx,col_idx=index_ref(addr)
            if col_idx in note_cols and row_idx>header_row and cell.find(q(M,'is')) is not None:
                if fill_of(cell)!='FFFF00':
                    raise RuntimeError('Se perdió el amarillo de la observación '+addr)
                note_positions.append(addr)
        if findings is not None:
            if len(note_positions)!=len(findings):
                raise RuntimeError('No coincide el número de observaciones y celdas amarillas.')
            for f in findings:
                for addr in (f.cell,*f.related):
                    if addr not in cells:
                        # Referencia no presente en la tabla revisada.
                        continue
                    if fill_of(cells[addr])!='FFFF00':
                        raise RuntimeError('No se marcó en amarillo la celda relacionada '+addr)
        return {'originales_conservados':len(sheets0),'revision':new[0],
                'filtro':fref,'observaciones_amarillas':len(note_positions)}
