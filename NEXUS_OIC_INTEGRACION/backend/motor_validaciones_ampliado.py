# -*- coding: utf-8 -*-
"""Validaciones adicionales de rescisiones: solo alertas respaldadas por columnas visibles.

Sin recalcular el monto contractual ni presumir responsabilidad. Todas las
reglas añadidas se califican como REVISAR salvo aritmética verificable.
"""
from __future__ import annotations
import collections
import math
import re
from revisor_rescisiones_portable import Auditor,normalize,number,missing,text,parse_date,VALID_STATUS

class AuditorAmpliado(Auditor):
    """Conserva todas las reglas del motor original y agrega controles específicos."""
    def review(self,sh,header_row,mapping,data):
        super().review(sh,header_row,mapping,data)
        items=[]
        for row_number,line in enumerate(data[1:],header_row+2):
            def val(k,ln=line):
                ix=mapping.get(k)
                return ln[ix] if ix is not None and ix<len(ln) else None
            if not any(not missing(val(k)) for k in ('contrato','proveedor','estatus')):
                continue
            def heading(ix):return text(data[0][ix]).replace('\n',' ')[:100]
            def raw(ix, ln=line):return ln[ix] if ix<len(ln) else None
            ctx={'get':val,'map':mapping,'heading':heading,'raw':raw}
            def add(level,key,code,detail,action,related=()):
                self.add(level,sh,row_number,mapping.get(key),ctx,code,detail,action,related)
            nums={k:number(val(k)) for k in ('monto','cantidad_contratada','precio','cantidad_solicitada','no_entregada')}
            m,q,p=nums['monto'],nums['cantidad_contratada'],nums['precio']
            if all(k in mapping for k in ('monto','cantidad_contratada','precio')):
                if all(v is not None and v>0 for v in (m,q,p)):
                    base=q*p
                    tol=max(0.06,base*0.00002)
                    if abs(m-base*1.16) <= tol and abs(m-base)>tol:
                        add('REVISAR','monto','POSIBLE_IVA_16_PCT',
                            f'Monto {m:,.2f}; cantidad × precio {base:,.2f}; coincide aproximadamente con agregar 16% de IVA.',
                            'Confirmar si el monto está expresado SIN IVA conforme al encabezado; revisar contrato y precio unitario.',
                            ('cantidad_contratada','precio'))
                    if q>1 and abs(m-p)<=max(.05,p*.00001) and abs(m-base)>tol:
                        add('REVISAR','precio','PRECIO_APARENTA_TOTAL',
                            f'Precio unitario ({p:,.2f}) coincide con monto total, aunque cantidad contratada es {q:g}.',
                            'Revisar si se capturó el importe total en lugar del precio por pieza.',
                            ('monto','cantidad_contratada'))
                if m is not None and m>0 and ((q is not None and q==0) or (p is not None and p==0)):
                    add('REVISAR','monto','MONTO_SIN_BASE_POSITIVA',
                        'Monto contratado positivo, pero cantidad contratada o precio unitario es cero.',
                        'Corroborar los importes y la unidad de registro utilizada.',
                        ('cantidad_contratada','precio'))
                if all(nums[k] is None for k in ('monto','cantidad_contratada','precio')):
                    add('REVISAR','monto','BASE_ECONOMICA_SIN_CIFRAS',
                        'Los tres campos económicos (monto, cantidad contratada y precio unitario) carecen de cifras válidas.',
                        'Completar la información económica, o motivar expresamente por qué no corresponde reportarla.',
                        ('cantidad_contratada','precio'))
            if ('cantidad_solicitada' in mapping and 'no_entregada' in mapping
                and nums['cantidad_solicitada']==0 and nums['no_entregada'] is not None
                and nums['no_entregada']>0):
                add('ERROR','no_entregada','SIN_SOLICITUD_CON_PENDIENTE',
                    'Hay piezas no entregadas pese a que la cantidad solicitada registrada es cero.',
                    'Conciliar pedidos emitidos, cantidades solicitadas y cantidades incumplidas.',('cantidad_solicitada',))
            st=normalize(val('estatus')); mt=normalize(val('motivos')); cms=normalize(val('comentarios'))
            suspension=parse_date(val('suspension_fecha'))
            formal=parse_date(val('formal'))
            if st in {'EN PROCESO','RESCINDIDO'} and suspension:
                add('REVISAR','suspension_fecha','SUSPENSION_FECHA_OTRO_ESTATUS',
                    f'Existe fecha de suspensión/entrega ({suspension:%d/%m/%Y}) y el estatus es «{text(val("estatus"))[:40]}».',
                    'Explicar si se trata de antecedente de una suspensión ya concluida o rectificar la clasificación.',('estatus','comentarios'))
            if st in {'SUSPENSION DE LA RESCISION','SUSPENSION DE RESCISION'} and formal:
                add('REVISAR','formal','SUSPENSION_CON_FORMALIZACION',
                    'Se indica suspensión pero también fecha de formalización de rescisión.',
                    'Precisar si es la misma actuación, si hubo reanudación o si el estatus quedó desactualizado.',('estatus','suspension_fecha'))
            if st=='RESCINDIDO' and ('ENTREGA TOTAL' in mt or 'ENTREGA COMPLETA' in mt or 'SE ENTREGO LA TOTALIDAD' in mt):
                add('REVISAR','motivos','MOTIVO_CUMPLIMIENTO_CON_RESCISION',
                    'El motivo menciona entrega total/completa pero el estatus es RESCINDIDO.',
                    'Confirmar causa de rescisión y distinguir antecedentes, cumplimiento posterior y fundamento.',('estatus','comentarios'))
            if nums['no_entregada'] is not None and nums['no_entregada']>0 and (
                'ENTREGA COMPLETA' in mt or 'ENTREGA TOTAL' in mt):
                add('REVISAR','motivos','ENTREGA_COMPLETA_CON_PENDIENTES',
                    f'El motivo menciona entrega completa, pero se reportan {nums["no_entregada"]:g} piezas no entregadas.',
                    'Conciliar fecha de corte, evidencia de recepción y cantidad pendiente.',('no_entregada','cantidad_solicitada'))
            clave=text(val('clave'))
            if 'clave' in mapping and not missing(clave) and len(re.sub(r'[^A-Za-z0-9]','',clave))<7:
                add('REVISAR','clave','CLAVE_INSUMO_ATIPICA',
                    f'Clave «{clave[:45]}» con longitud reducida; podría estar incompleta.',
                    'Corroborar contra el catálogo institucional o la clave contractual.',('descripcion_insumo',))
            if 'contrato' in mapping and len(normalize(val('contrato')))>0 and len(normalize(val('contrato')).replace(' ',''))<5:
                add('REVISAR','contrato','CONTRATO_IDENTIFICADOR_CORTO',
                    'Número de contrato muy corto para permitir identificación inequívoca.',
                    'Confirmar el número íntegro del instrumento contractual.',('proveedor',))
            items.append((row_number,ctx,nums))

        # Contrastes por contrato+clave+proveedor; pueden existir convenios y partidas válidas.
        by_contract_key=collections.defaultdict(list)
        by_key=collections.defaultdict(list)
        by_contract=collections.defaultdict(list)
        for r,ctx,nums in items:
            getter=ctx['get']; contract=normalize(getter('contrato'))
            clave=normalize(getter('clave'));supplier=normalize(getter('proveedor'))
            if contract:
                by_contract[contract].append((r,ctx,nums,clave))
            if contract and clave and supplier:
                by_contract_key[(contract,clave,supplier)].append((r,ctx,nums))
            if clave and not missing(getter('descripcion_insumo')):
                by_key[clave].append((r,ctx,nums))

        for (contract,clave,supplier),group in by_contract_key.items():
            if len(group)<2:continue
            prices=collections.defaultdict(list)
            for r,ctx,nums in group:
                if nums['precio'] is not None and nums['precio']>0:
                    prices[round(nums['precio'],4)].append(r)
            if len(prices)>1:
                rr=','.join(str(r) for r,_,_ in group[:10])
                for r,ctx,nums in group:
                    self.add('REVISAR',sh,r,mapping.get('precio'),ctx,'PRECIO_VARIABLE_MISMA_CLAVE_CONTRATO',
                        f'Hay precios unitarios diferentes para el mismo contrato, clave y proveedor; filas {rr}.',
                        'Verificar convenios modificatorios, presentaciones o errores de captura.',('contrato','clave','proveedor'))

        # La misma clave puede variar de descripción por presentación; solo alertar
        # cuando son textos materialmente diferentes y hay al menos dos registros.
        for clave,group in by_key.items():
            descs=collections.defaultdict(list)
            for r,ctx,nums in group:
                s=normalize(ctx['get']('descripcion_insumo'))
                if len(s)>25:descs[s].append(r)
            if len(descs)>1 and len(group)>=2:
                # Un umbral de similitud protege ante cambios de puntuación.
                from difflib import SequenceMatcher
                names=list(descs)
                if min(SequenceMatcher(None,a[:200],b[:200]).ratio() for a in names for b in names if a!=b)<0.55:
                    rr=','.join(str(r) for r,_,_ in group[:10])
                    for r,ctx,nums in group:
                        self.add('REVISAR',sh,r,mapping.get('descripcion_insumo'),ctx,'DESCRIPCION_DIFERENTE_MISMA_CLAVE',
                            f'La misma clave de insumo presenta descripciones marcadamente distintas; filas {rr}.',
                            'Confirmar clave y descripción, presentación, concentración y unidad de medida.',('clave',))
        # Repetición de una misma cifra que podría corresponder al contrato completo,
        # no al importe de cada partida. Nunca eliminar ni dividir importes.
        for contract,group in by_contract.items():
            if len(group)<3:continue
            amounts=collections.defaultdict(list)
            for r,ctx,nums,clave in group:
                if clave and nums['monto'] is not None and nums['monto']>0:
                    amounts[round(nums['monto'],2)].append((r,ctx,nums,clave))
            for amount,same in amounts.items():
                if len({it[3] for it in same})<3:continue
                mismatches=0
                for r,ctx,nums,clave in same:
                    q,p=nums['cantidad_contratada'],nums['precio']
                    if q is not None and p is not None and q>0 and p>0:
                        if abs(amount-q*p)>max(0.06,q*p*.00002):mismatches+=1
                if mismatches<2:continue
                rr=','.join(str(it[0]) for it in same[:10])
                for r,ctx,nums,clave in same:
                    self.add('REVISAR',sh,r,mapping.get('monto'),ctx,'MONTO_POTENCIALMENTE_GLOBAL_REPETIDO',
                        f'Mismo importe {amount:,.2f} repetido en tres o más claves del contrato; filas {rr}, con diferencias frente a cantidad × precio.',
                        'Confirmar si se consignó el monto global del contrato en partidas; no sumar ni redistribuir importes sin evidencia.',
                        ('contrato','clave','cantidad_contratada','precio'))
