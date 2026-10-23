"""Motor de Análisis de Riesgos Institucionales de NEXUS INTELLIGENCE."""
from __future__ import annotations

import math
from typing import Any
from . import query as Q


def analyze_risks(ctx: Q.Ctx, filters: dict | None = None, search: str | None = None) -> dict[str, Any]:
    """Ejecuta análisis de riesgos determinístico sobre las contrataciones y suministros."""
    w, params = Q.where(ctx, filters, search)
    roles = ctx.roles
    findings: list[dict] = []
    
    # 1. Concentración de Proveedores (HHI & Pareto)
    prov_col = roles.get("provider")
    amt_col = roles.get("amount")
    hhi_score = 0
    hhi_level = "Bajo"
    pareto_share = 0.0
    top_providers = []

    if prov_col and amt_col:
        # Suma total de montos
        total_sql = f"SELECT SUM({Q.q(amt_col)}) FROM d WHERE {w} AND {Q.q(amt_col)} > 0"
        tot_res = ctx.run(total_sql, params)[0][0]
        total_amount = float(tot_res or 0)

        if total_amount > 0:
            prov_sql = f"""
                SELECT {Q.q(prov_col)} AS prov,
                       SUM({Q.q(amt_col)}) AS amt,
                       COUNT(*) AS row_cnt,
                       list(_row_id) AS rids
                FROM d
                WHERE {w} AND {Q.q(amt_col)} > 0
                GROUP BY {Q.q(prov_col)}
                ORDER BY amt DESC
            """
            rows = ctx.run(prov_sql, params)
            num_providers = len(rows)

            # Cálculo de HHI: sum( (share_pct * 100) ^ 2 )
            shares = []
            cumulative_amt = 0.0
            top_20_pct_count = max(1, math.ceil(num_providers * 0.2))

            for idx, r in enumerate(rows):
                prov_name = str(r[0] or "Sin proveedor")
                amt = float(r[1] or 0)
                rids = [int(x) for x in (r[3] or [])][:20]
                pct = (amt / total_amount) * 100.0
                shares.append(pct)
                cumulative_amt += amt

                if idx < 5:
                    top_providers.append({
                        "provider": prov_name,
                        "amount": amt,
                        "share_pct": round(pct, 2),
                        "row_count": int(r[2]),
                        "row_ids": rids
                    })

                if idx < top_20_pct_count:
                    pareto_share = (cumulative_amt / total_amount) * 100.0

            hhi_score = round(sum((s) ** 2 for s in shares), 1)

            # Clasificación HHI según estándar antimonopolio y de compras públicas
            if hhi_score >= 2500:
                hhi_level = "Alta"
                findings.append({
                    "id": "risk_hhi_high",
                    "category": "concentracion",
                    "title": "Alta Concentración de Mercado (HHI Crítico)",
                    "severity": "Alta",
                    "metric_value": f"HHI {hhi_score:,.0f} pts",
                    "description": f"El mercado presenta un índice HHI de {hhi_score:,.0f} puntos (umbral crítico: 2,500). El 20% de los proveedores concentra el {pareto_share:.1f}% del monto total adjudicado.",
                    "evidence": f"Proveedor dominante '{top_providers[0]['provider']}' con {top_providers[0]['share_pct']}% del presupuesto total (${top_providers[0]['amount']:,.2f} MXN).",
                    "row_ids": top_providers[0]["row_ids"],
                    "recommendation": "Diversificar fuentes de adjudicación y revisar si existen barreras técnicas injustificadas en los términos de referencia."
                })
            elif hhi_score >= 1500:
                hhi_level = "Media"
                findings.append({
                    "id": "risk_hhi_med",
                    "category": "concentracion",
                    "title": "Concentración Moderada de Contrataciones",
                    "severity": "Media",
                    "metric_value": f"HHI {hhi_score:,.0f} pts",
                    "description": f"El índice HHI de {hhi_score:,.0f} refleja una concentración moderada del presupuesto en pocos competidores.",
                    "evidence": f"Los primeros {len(top_providers[:3])} proveedores acumulan el {sum(p['share_pct'] for p in top_providers[:3]):.1f}% del importe total.",
                    "row_ids": top_providers[0]["row_ids"] if top_providers else [],
                    "recommendation": "Fomentar mayor concurrencia en convocatorias públicas y monitorear dependencia de proveedores específicos."
                })

    # 2. Variación Atípica de Precios Unitarios (Outliers / Dispersión)
    desc_col = roles.get("item_description")
    price_col = roles.get("unit_price")
    price_outliers = []

    if desc_col and price_col:
        price_sql = f"""
            SELECT {Q.q(desc_col)} as item,
                   AVG({Q.q(price_col)}) as avg_p,
                   STDDEV({Q.q(price_col)}) as std_p,
                   MIN({Q.q(price_col)}) as min_p,
                   MAX({Q.q(price_col)}) as max_p,
                   COUNT(*) as cnt
            FROM d
            WHERE {w} AND {Q.q(price_col)} IS NOT NULL AND {Q.q(price_col)} > 0
            GROUP BY {Q.q(desc_col)}
            HAVING COUNT(*) >= 3 AND STDDEV({Q.q(price_col)}) > 0
            ORDER BY (MAX({Q.q(price_col)}) / NULLIF(MIN({Q.q(price_col)}), 0)) DESC
            LIMIT 10
        """
        item_rows = ctx.run(price_sql, params)
        for ir in item_rows:
            item_name = str(ir[0])
            avg_p = float(ir[1] or 0)
            std_p = float(ir[2] or 0)
            min_p = float(ir[3] or 0)
            max_p = float(ir[4] or 0)
            ratio = (max_p / min_p) if min_p > 0 else 1.0

            if ratio >= 1.8 or (std_p / avg_p if avg_p else 0) > 0.4:
                # Buscar filas con precio mayor a avg + 1.5*std
                outlier_rows_sql = f"""
                    SELECT _row_id, {Q.q(price_col)}, {Q.q(roles.get('provider', desc_col))}
                    FROM d
                    WHERE {w} AND {Q.q(desc_col)} = ? AND {Q.q(price_col)} >= ?
                    ORDER BY {Q.q(price_col)} DESC
                    LIMIT 5
                """
                out_rows = ctx.run(outlier_rows_sql, params + [item_name, avg_p + std_p])
                rids = [int(x[0]) for x in out_rows]

                price_outliers.append({
                    "item": item_name,
                    "avg_price": round(avg_p, 2),
                    "min_price": round(min_p, 2),
                    "max_price": round(max_p, 2),
                    "ratio": round(ratio, 2),
                    "dispersion_pct": round((std_p / avg_p * 100.0) if avg_p else 0, 1),
                    "row_ids": rids
                })

        if price_outliers:
            top_out = price_outliers[0]
            findings.append({
                "id": "risk_price_dispersion",
                "category": "precios",
                "title": "Dispersión Significativa en Precios de Adquisición",
                "severity": "Alta" if top_out["ratio"] >= 2.5 else "Media",
                "metric_value": f"Variación de {top_out['ratio']}x",
                "description": f"Se detectaron diferencias sustanciales de precios unitarios para el mismo bien o insumo en diferentes contratos o partidas.",
                "evidence": f"'{top_out['item']}': precio mínimo ${top_out['min_price']:,.2f} vs máximo ${top_out['max_price']:,.2f} (diferencia de {top_out['ratio']}x, dispersión {top_out['dispersion_pct']}%).",
                "row_ids": top_out["row_ids"],
                "recommendation": "Homologar precios de referencia a través de compras consolidadas y verificar condiciones de entrega o plazos que justifiquen el sobreprecio."
            })

    # 3. Entregas Críticas y Suministros Pendientes
    qty_col = roles.get("quantity")
    deliv_col = roles.get("quantity_delivered")
    pending_items = []
    total_pending_qty = 0
    total_pending_amount = 0.0

    if qty_col and deliv_col:
        price_calc = f"COALESCE({Q.q(price_col)}, 0)" if price_col else "0"
        pending_sql = f"""
            SELECT _row_id,
                   {Q.q(desc_col or qty_col)} as item,
                   {Q.q(qty_col)} as requested,
                   {Q.q(deliv_col)} as delivered,
                   ({Q.q(qty_col)} - {Q.q(deliv_col)}) as pending_qty,
                   (({Q.q(qty_col)} - {Q.q(deliv_col)}) * {price_calc}) as pending_amt,
                   {Q.q(roles.get('provider', qty_col))} as prov
            FROM d
            WHERE {w} AND {Q.q(qty_col)} > {Q.q(deliv_col)}
            ORDER BY pending_amt DESC, pending_qty DESC
            LIMIT 10
        """
        pend_rows = ctx.run(pending_sql, params)
        pend_rids = []
        for pr in pend_rows:
            p_qty = int(pr[4] or 0)
            p_amt = float(pr[5] or 0)
            total_pending_qty += p_qty
            total_pending_amount += p_amt
            pend_rids.append(int(pr[0]))
            pending_items.append({
                "row_id": int(pr[0]),
                "item": str(pr[1]),
                "requested": int(pr[2] or 0),
                "delivered": int(pr[3] or 0),
                "pending_qty": p_qty,
                "pending_amount": round(p_amt, 2),
                "provider": str(pr[6] or "")
            })

        if total_pending_qty > 0:
            findings.append({
                "id": "risk_pending_deliveries",
                "category": "suministros",
                "title": "Desabasto Potencial por Suministros Críticos Pendientes",
                "severity": "Alta" if total_pending_amount > 500000 or len(pending_items) >= 5 else "Media",
                "metric_value": f"{total_pending_qty:,} pzas pendientes",
                "description": f"Se identificaron partidas con entregas inconclusas o cantidades recibidas inferiores a lo convenido contractualmente.",
                "evidence": f"Total de {total_pending_qty:,} piezas pendientes con un valor acumulado en riesgo estimado de ${total_pending_amount:,.2f} MXN.",
                "row_ids": pend_rids[:15],
                "recommendation": "Emitir requerimientos formales a proveedores en mora, verificar notas de entrada en almacén y aplicar penalizaciones convencionales si procede."
            })

    # 4. Posible Fraccionamiento de Contratos
    contract_col = roles.get("contract_id")
    date_col = roles.get("date")
    proc_col = roles.get("procedure_type")
    fragmentation_alerts = []

    if prov_col and (contract_col or amt_col):
        frag_sql = f"""
            SELECT {Q.q(prov_col)} as prov,
                   COUNT(DISTINCT {Q.q(contract_col or prov_col)}) as num_contracts,
                   SUM({Q.q(amt_col or '1')}) as total_amt,
                   AVG({Q.q(amt_col or '1')}) as avg_amt,
                   list(_row_id) as rids
            FROM d
            WHERE {w}
            GROUP BY {Q.q(prov_col)}
            HAVING COUNT(DISTINCT {Q.q(contract_col or prov_col)}) >= 3
            ORDER BY num_contracts DESC
            LIMIT 5
        """
        frag_rows = ctx.run(frag_sql, params)
        for fr in frag_rows:
            pname = str(fr[0])
            cnt = int(fr[1])
            tot = float(fr[2] or 0)
            avg = float(fr[3] or 0)
            rids = [int(x) for x in (fr[4] or [])][:15]

            # Si el monto total es considerable pero se dividió en múltiples contratos pequeños
            if cnt >= 3 and tot > 100000:
                fragmentation_alerts.append({
                    "provider": pname,
                    "contracts_count": cnt,
                    "total_amount": round(tot, 2),
                    "avg_amount": round(avg, 2),
                    "row_ids": rids
                })

        if fragmentation_alerts:
            top_frag = fragmentation_alerts[0]
            findings.append({
                "id": "risk_contract_fragmentation",
                "category": "procedimiento",
                "title": "Indicios de Fraccionamiento de Contrataciones",
                "severity": "Media",
                "metric_value": f"{top_frag['contracts_count']} contratos agrupados",
                "description": f"Se observan múltiples adjudicaciones sucesivas a un mismo proveedor en montos parciales, lo que amerita verificación de umbrales normativos.",
                "evidence": f"Proveedor '{top_frag['provider']}' ostenta {top_frag['contracts_count']} contratos por un total acumulado de ${top_frag['total_amount']:,.2f} MXN (promedio unitario de ${top_frag['avg_amount']:,.2f} MXN).",
                "row_ids": top_frag["row_ids"],
                "recommendation": "Revisar justificación técnica del desglose contractual para asegurar cumplimiento con los montos máximos permitidos en adjudicaciones directas."
            })

    # Resumen general del riesgo
    high_count = sum(1 for f in findings if f["severity"] == "Alta")
    med_count = sum(1 for f in findings if f["severity"] == "Media")
    overall_severity = "Alta" if high_count >= 1 else "Media" if med_count >= 1 else "Baja"

    return {
        "overall_severity": overall_severity,
        "summary": {
            "findings_count": len(findings),
            "high": high_count,
            "medium": med_count,
            "low": sum(1 for f in findings if f["severity"] == "Baja"),
            "hhi_score": hhi_score,
            "hhi_level": hhi_level,
            "pareto_share": round(pareto_share, 1),
            "total_pending_amount": round(total_pending_amount, 2),
            "price_outliers_count": len(price_outliers)
        },
        "findings": findings,
        "concentration": {
            "hhi_score": hhi_score,
            "hhi_level": hhi_level,
            "pareto_share": round(pareto_share, 1),
            "top_providers": top_providers
        },
        "price_dispersion": price_outliers,
        "critical_supplies": pending_items,
        "fragmentation": fragmentation_alerts
    }
