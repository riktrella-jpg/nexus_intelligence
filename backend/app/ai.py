"""Asistente Inteligente NEXUS AI para Análisis Cuantitativo de Datos."""
from __future__ import annotations

import re
from typing import Any
from . import kpis, query as Q, risks


def query_assistant(ctx: Q.Ctx, query_text: str, filters: dict | None = None) -> dict[str, Any]:
    """Procesa consultas en lenguaje natural y genera respuestas ejecutivas cuantitativas verificables."""
    q_norm = query_text.lower().strip()
    roles = ctx.roles
    w, params = Q.where(ctx, filters)

    # Variables de soporte
    amt_col = roles.get("amount")
    prov_col = roles.get("provider")
    qty_col = roles.get("quantity")
    deliv_col = roles.get("quantity_delivered")
    status_col = roles.get("status")
    proc_col = roles.get("procedure_type")
    desc_col = roles.get("item_description")
    price_col = roles.get("unit_price")

    cards = []
    table_data = None
    sql_executed = None
    explanation = ""
    suggested_actions = []

    # 1. Consulta sobre Riesgos / Alertas / Anomalías
    if any(k in q_norm for k in ["riesgo", "alerta", "anomalía", "irregular", "hhi", "concentraci", "desabasto", "fracciona"]):
        r_analysis = risks.analyze_risks(ctx, filters)
        findings = r_analysis["findings"]
        overall = r_analysis["overall_severity"]
        
        text = f"**Diagnóstico de Riesgos Institucionales:**\n\nNivel de severidad global calificado como **{overall}** con **{len(findings)} hallazgos** identificados en el conjunto actual:\n\n"
        for idx, f in enumerate(findings, 1):
            text += f"{idx}. **{f['title']}** ({f['severity']}): {f['description']}\n   - *Evidencia:* {f['evidence']}\n   - *Recomendación:* {f['recommendation']}\n\n"

        cards.append({"label": "Nivel de Riesgo Global", "value": overall, "badge": overall})
        cards.append({"label": "Hallazgos Activos", "value": str(len(findings)), "badge": "alert" if len(findings) > 0 else "ok"})
        cards.append({"label": "Índice HHI", "value": f"{r_analysis['concentration']['hhi_score']:,.0f} pts", "badge": r_analysis["concentration"]["hhi_level"]})

        explanation = "Se ejecutaron algoritmos de concentración (HHI y Pareto), dispersión de precios unitarios (desviación típica y rango), cálculo de desabasto/pendientes de entrega y agrupamiento por proveedor."
        suggested_actions = ["Ver matriz completa en Análisis de Riesgos", "Exportar registros con observaciones para auditoría", "Filtrar por proveedor con mayor riesgo"]

        return {
            "query": query_text,
            "answer": text,
            "cards": cards,
            "explanation": explanation,
            "sql": "Algoritmos multimodales de detección de riesgos (DuckDB + Polars)",
            "table": None,
            "suggested_actions": suggested_actions
        }

    # 2. Consulta sobre Proveedores / Concentración
    elif any(k in q_norm for k in ["proveedor", "proveedores", "quién vendió", "quienes ganaron", "adjudicad"]):
        if prov_col and amt_col:
            sql = f"""
                SELECT {Q.q(prov_col)} AS proveedor,
                       SUM({Q.q(amt_col)}) AS monto_total,
                       COUNT(*) AS partidas,
                       ROUND(SUM({Q.q(amt_col)}) / (SELECT SUM({Q.q(amt_col)}) FROM d WHERE {w}) * 100, 2) AS cuota_mercado
                FROM d
                WHERE {w} AND {Q.q(amt_col)} > 0
                GROUP BY 1
                ORDER BY monto_total DESC
                LIMIT 5
            """
            rows = ctx.run(sql, params)
            total_amt = sum(float(r[1] or 0) for r in rows)
            top_prov = rows[0][0] if rows else "N/D"

            text = f"**Análisis de Proveedores Principales:**\n\nSe identificaron los 5 proveedores con mayor adjudicación presupuestal acumulada:\n\n"
            table_rows = []
            for r in rows:
                p_name = r[0]
                m_amt = float(r[1] or 0)
                cuota = float(r[3] or 0)
                text += f"- **{p_name}**: ${m_amt:,.2f} MXN ({cuota:.1f}% de cuota de mercado).\n"
                table_rows.append({"Proveedor": p_name, "Monto (MXN)": f"${m_amt:,.2f}", "Cuota": f"{cuota:.1f}%", "Partidas": int(r[2])})

            cards.append({"label": "Proveedor Líder", "value": str(top_prov)[:28]})
            cards.append({"label": "Monto Top 5", "value": f"${total_amt:,.2f} MXN"})

            chart_data = {
                "type": "bar",
                "title": "Top 5 Proveedores por Monto Adjudicado (MXN)",
                "categories": [str(r[0])[:20] for r in rows],
                "series": [{"name": "Monto (MXN)", "data": [float(r[1] or 0) for r in rows], "color": "#1d3452"}]
            }

            sql_executed = sql
            table_data = {"headers": ["Proveedor", "Monto (MXN)", "Cuota", "Partidas"], "rows": table_rows}
            explanation = f"Agrupación por la columna '{prov_col}' sumando el importe de '{amt_col}', calculando participación porcentual sobre el universo filtrado."
            suggested_actions = ["Filtrar dashboard por el proveedor líder", "Analizar precios unitarios del proveedor", "Ver cruce de proveedores en Análisis Cruzado"]
            return {
                "query": query_text,
                "answer": text,
                "cards": cards,
                "explanation": explanation,
                "sql": sql_executed,
                "table": table_data,
                "chart": chart_data,
                "suggested_actions": suggested_actions
            }

    # 3. Consulta sobre Suministros / Entregas / Cumplimiento / Pendientes
    elif any(k in q_norm for k in ["entrega", "entregado", "pendiente", "suministro", "cumplimiento", "abasto"]):
        if qty_col and deliv_col:
            amt_calc = f", SUM({Q.q(amt_col)}) AS monto_total" if amt_col else ""
            sql = f"""
                SELECT SUM({Q.q(qty_col)}) AS solicitada,
                       SUM({Q.q(deliv_col)}) AS entregada,
                       SUM(GREATEST({Q.q(qty_col)} - {Q.q(deliv_col)}, 0)) AS pendiente,
                       ROUND(SUM(LEAST({Q.q(deliv_col)}, {Q.q(qty_col)})) / NULLIF(SUM({Q.q(qty_col)}), 0) * 100, 2) AS pct_cumplimiento
                       {amt_calc}
                FROM d
                WHERE {w}
            """
            r = ctx.run(sql, params)[0]
            sol = int(r[0] or 0)
            ent = int(r[1] or 0)
            pen = int(r[2] or 0)
            cump = float(r[3] or 0)
            monto_tot = float(r[4] or 0) if amt_col and len(r) > 4 and r[4] is not None else 0.0

            monto_text = f"- **Monto total contratado:** ${monto_tot:,.2f} MXN.\n" if amt_col else ""
            text = (
                f"**Balance Operativo de Suministros y Contratación:**\n\n"
                f"{monto_text}"
                f"- **Cantidad solicitada total:** {sol:,} piezas.\n"
                f"- **Cantidad efectivamente entregada:** {ent:,} piezas.\n"
                f"- **Volumen pendiente de entrega:** {pen:,} piezas.\n"
                f"- **Nivel de cumplimiento general:** **{cump:.1f}%**.\n\n"
                + (f"Se detecta una brecha operativa de **{pen:,} piezas pendientes de recibir**, equivalentes al {100 - cump:.1f}% del total pactado." if pen > 0 else "Los suministros se encuentran al 100% de cumplimiento conforme a las partidas contratadas.")
            )

            if amt_col:
                cards.append({"label": "Monto Contratado", "value": f"${monto_tot:,.2f} MXN"})
            cards.append({"label": "Cumplimiento Global", "value": f"{cump:.1f}%", "badge": "ok" if cump >= 90 else "alert"})
            cards.append({"label": "Piezas Solicitadas", "value": f"{sol:,}"})
            cards.append({"label": "Piezas Entregadas", "value": f"{ent:,}"})
            cards.append({"label": "Piezas Pendientes", "value": f"{pen:,}", "badge": "alert" if pen > 0 else "ok"})

            # Si existe proveedor o descripción, generar tabla de desglose
            table_data = None
            chart_data = None
            group_col = prov_col or desc_col
            group_label = "Proveedor" if prov_col else "Concepto"
            if group_col:
                g_sql = f"""
                    SELECT {Q.q(group_col)} AS grp,
                           SUM({Q.q(qty_col)}) AS sol_g,
                           SUM({Q.q(deliv_col)}) AS ent_g,
                           SUM(GREATEST({Q.q(qty_col)} - {Q.q(deliv_col)}, 0)) AS pen_g,
                           ROUND(SUM(LEAST({Q.q(deliv_col)}, {Q.q(qty_col)})) / NULLIF(SUM({Q.q(qty_col)}), 0) * 100, 1) AS pct_g
                           {f", SUM({Q.q(amt_col)}) AS mto_g" if amt_col else ""}
                    FROM d
                    WHERE {w}
                    GROUP BY 1
                    ORDER BY pen_g DESC, sol_g DESC
                    LIMIT 6
                """
                g_rows = ctx.run(g_sql, params)
                headers = [group_label] + (["Monto (MXN)"] if amt_col else []) + ["Solicitado", "Entregado", "Pendiente", "% Cumplimiento"]
                t_rows = []
                chart_categories = []
                chart_entregadas = []
                chart_pendientes = []
                for gr in g_rows:
                    item_name = str(gr[0] or "N/D")
                    s_g = int(gr[1] or 0)
                    e_g = int(gr[2] or 0)
                    p_g = int(gr[3] or 0)
                    pct_g = f"{float(gr[4] or 0):.1f}%"
                    row_obj = {group_label: item_name}
                    if amt_col:
                        row_obj["Monto (MXN)"] = f"${float(gr[5] or 0):,.2f}"
                    row_obj.update({"Solicitado": f"{s_g:,}", "Entregado": f"{e_g:,}", "Pendiente": f"{p_g:,}", "% Cumplimiento": pct_g})
                    t_rows.append(row_obj)
                    chart_categories.append(item_name[:20])
                    chart_entregadas.append(e_g)
                    chart_pendientes.append(p_g)

                table_data = {"headers": headers, "rows": t_rows}
                chart_data = {
                    "type": "stacked_bar",
                    "title": f"Piezas Entregadas vs Pendientes por {group_label}",
                    "categories": chart_categories,
                    "series": [
                        {"name": "Entregadas", "data": chart_entregadas, "color": "#2f6b57"},
                        {"name": "Pendientes", "data": chart_pendientes, "color": "#651e32"}
                    ]
                }

            sql_executed = sql
            explanation = f"Evaluación de suministros calculando cumplimiento neto: Σ mín(entregada, solicitada) / Σ solicitada sobre '{qty_col}' y '{deliv_col}'" + (f" con monto '{amt_col}'." if amt_col else ".")
            suggested_actions = ["Ver análisis cruzado de proveedores vs estatus", "Generar informe de cumplimiento operativo", "Ver partidas en el explorador de registros"]

            return {
                "query": query_text,
                "answer": text,
                "cards": cards,
                "explanation": explanation,
                "sql": sql_executed,
                "table": table_data,
                "chart": chart_data,
                "suggested_actions": suggested_actions
            }

    # 4. Consulta sobre Precios / Dispersión / Productos
    elif any(k in q_norm for k in ["precio", "costo", "caro", "barato", "unitario", "dispersión"]):
        if desc_col and price_col:
            sql = f"""
                SELECT {Q.q(desc_col)} AS bien,
                       ROUND(AVG({Q.q(price_col)}), 2) AS prom,
                       ROUND(MIN({Q.q(price_col)}), 2) AS min_p,
                       ROUND(MAX({Q.q(price_col)}), 2) AS max_p,
                       ROUND(MAX({Q.q(price_col)}) / NULLIF(MIN({Q.q(price_col)}), 0), 2) AS ratio
                FROM d
                WHERE {w} AND {Q.q(price_col)} > 0
                GROUP BY 1
                HAVING COUNT(*) >= 2
                ORDER BY ratio DESC
                LIMIT 5
            """
            rows = ctx.run(sql, params)
            text = f"**Comportamiento de Precios Unitarios y Variación:**\n\nBienes con mayor dispersión observada entre el precio mínimo y máximo registrado:\n\n"
            t_rows = []
            for r in rows:
                b_name = r[0]
                prom_p = float(r[1] or 0)
                min_p = float(r[2] or 0)
                max_p = float(r[3] or 0)
                ratio_p = float(r[4] or 1)
                text += f"- **{b_name}**: Promedio ${prom_p:,.2f} | Rango: ${min_p:,.2f} a ${max_p:,.2f} (diferencia de **{ratio_p}x**).\n"
                t_rows.append({"Concepto": b_name, "Promedio": f"${prom_p:,.2f}", "Mínimo": f"${min_p:,.2f}", "Máximo": f"${max_p:,.2f}", "Variación": f"{ratio_p}x"})

            table_data = {"headers": ["Concepto", "Promedio", "Mínimo", "Máximo", "Variación"], "rows": t_rows}
            sql_executed = sql
            cards.append({"label": "Mayor Dispersión", "value": f"{rows[0][4]}x" if rows else "1.0x"})
            explanation = f"Análisis de precios unitarios agrupados por '{desc_col}', contrastando cotizaciones extremas y calculando ratio max/min."
            return {
                "query": query_text,
                "answer": text,
                "cards": cards,
                "explanation": explanation,
                "sql": sql_executed,
                "table": table_data,
                "suggested_actions": ["Revisar insumos con dispersión mayor a 2x en contratos"]
            }

    # 5. Consulta General / Totales / Monto
    # Consulta por defecto: métricas clave del conjunto activo
    tot_sql = f"SELECT COUNT(*) FROM d WHERE {w}"
    tot_rows = ctx.run(tot_sql, params)[0][0]
    
    amt_sum = 0.0
    if amt_col:
        amt_sql = f"SELECT SUM({Q.q(amt_col)}) FROM d WHERE {w}"
        amt_sum = float(ctx.run(amt_sql, params)[0][0] or 0)

    contracts_cnt = 0
    if "contract_id" in roles:
        c_sql = f"SELECT COUNT(DISTINCT {Q.q(roles['contract_id'])}) FROM d WHERE {w}"
        contracts_cnt = ctx.run(c_sql, params)[0][0]

    prov_cnt = 0
    if prov_col:
        p_sql = f"SELECT COUNT(DISTINCT {Q.q(prov_col)}) FROM d WHERE {w}"
        prov_cnt = ctx.run(p_sql, params)[0][0]

    text = (
        f"**Resumen Ejecutivo del Conjunto de Datos Seleccionado:**\n\n"
        f"- **Monto total adjudicado/contratado:** ${amt_sum:,.2f} MXN.\n"
        f"- **Total de registros/partidas:** {tot_rows:,}.\n"
        f"- **Contratos únicos formalizados:** {contracts_cnt:,}.\n"
        f"- **Proveedores participantes:** {prov_cnt:,}.\n\n"
        f"Puede consultar detalles específicos preguntando sobre **proveedores**, **suministros y entregas pendientes**, **variación de precios** o **evaluación de riesgos**."
    )

    cards.append({"label": "Monto Total", "value": f"${amt_sum:,.2f} MXN"})
    cards.append({"label": "Contratos", "value": f"{contracts_cnt:,}"})
    cards.append({"label": "Proveedores", "value": f"{prov_cnt:,}"})
    cards.append({"label": "Registros", "value": f"{tot_rows:,}"})

    explanation = f"Conteo y sumatorias directas sobre la tabla activa en DuckDB con los filtros aplicados actualmente."
    suggested_actions = ["¿Cuáles son los 5 proveedores con más monto?", "¿Hay concentración o riesgos en la contratación?", "¿Cuál es el estatus de las entregas pendientes?"]

    return {
        "query": query_text,
        "answer": text,
        "cards": cards,
        "explanation": explanation,
        "sql": tot_sql,
        "table": None,
        "suggested_actions": suggested_actions
    }
