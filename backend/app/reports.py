"""Generador de Reportes Ejecutivos Institucionales de NEXUS INTELLIGENCE."""
from __future__ import annotations

import datetime as dt
from typing import Any
from . import kpis, query as Q, risks


def build_report_data(ctx: Q.Ctx, opts: dict | None = None) -> dict[str, Any]:
    """Compila la información integral para la confección del reporte ejecutivo."""
    opts = opts or {}
    report_type = opts.get("type", "executive")  # executive | risks | procurement | audit
    title = opts.get("title") or "INFORME EJECUTIVO DE INTELIGENCIA DE DATOS Y CONTRATACIONES"
    institution = opts.get("institution") or ctx.dataset.get("institution") or "DIRECCIÓN GENERAL DE ADMINISTRACIÓN"
    author = opts.get("author") or "Unidad de Inteligencia y Control de Gestión"
    period = opts.get("period") or (ctx.dataset.get("periods")[0] if ctx.dataset.get("periods") else "Ejercicio 2026")
    filters = opts.get("filters")

    w, params = Q.where(ctx, filters)
    roles = ctx.roles
    amt_col = roles.get("amount")
    prov_col = roles.get("provider")
    qty_col = roles.get("quantity")
    deliv_col = roles.get("quantity_delivered")
    desc_col = roles.get("item_description")
    proc_col = roles.get("procedure_type")

    # 1. KPIs Fundamentales
    tot_rows = ctx.run(f"SELECT COUNT(*) FROM d WHERE {w}", params)[0][0]
    total_amount = 0.0
    if amt_col:
        total_amount = float(ctx.run(f"SELECT SUM({Q.q(amt_col)}) FROM d WHERE {w}", params)[0][0] or 0)

    contracts_cnt = 0
    if "contract_id" in roles:
        contracts_cnt = ctx.run(f"SELECT COUNT(DISTINCT {Q.q(roles['contract_id'])}) FROM d WHERE {w}", params)[0][0]

    prov_cnt = 0
    if prov_col:
        prov_cnt = ctx.run(f"SELECT COUNT(DISTINCT {Q.q(prov_col)}) FROM d WHERE {w}", params)[0][0]

    # Suministros
    deliv_rate = 100.0
    pending_units = 0
    if qty_col and deliv_col:
        s_res = ctx.run(f"""
            SELECT SUM({Q.q(qty_col)}),
                   SUM(LEAST({Q.q(deliv_col)}, {Q.q(qty_col)})),
                   SUM(GREATEST({Q.q(qty_col)} - {Q.q(deliv_col)}, 0))
            FROM d WHERE {w}
        """, params)[0]
        sol = float(s_res[0] or 0)
        ent = float(s_res[1] or 0)
        pending_units = int(s_res[2] or 0)
        deliv_rate = round((ent / sol * 100.0) if sol > 0 else 100.0, 1)

    # 2. Análisis de Riesgos
    risk_data = risks.analyze_risks(ctx, filters)

    # 3. Desglose de Proveedores
    providers_summary = []
    if prov_col and amt_col:
        p_rows = ctx.run(f"""
            SELECT {Q.q(prov_col)},
                   SUM({Q.q(amt_col)}) AS amt,
                   COUNT(*) AS cnt,
                   ROUND(SUM({Q.q(amt_col)}) / NULLIF({total_amount}, 0) * 100, 2) AS share
            FROM d WHERE {w} AND {Q.q(amt_col)} > 0
            GROUP BY 1
            ORDER BY amt DESC
            LIMIT 10
        """, params)
        for pr in p_rows:
            providers_summary.append({
                "provider": pr[0],
                "amount": float(pr[1] or 0),
                "count": int(pr[2]),
                "share": float(pr[3] or 0)
            })

    # 4. Desglose por Procedimiento de Contratación
    procedures_summary = []
    if proc_col and amt_col:
        proc_rows = ctx.run(f"""
            SELECT {Q.q(proc_col)},
                   SUM({Q.q(amt_col)}) AS amt,
                   COUNT(*) AS cnt,
                   ROUND(SUM({Q.q(amt_col)}) / NULLIF({total_amount}, 0) * 100, 2) AS share
            FROM d WHERE {w} AND {Q.q(amt_col)} > 0
            GROUP BY 1
            ORDER BY amt DESC
        """, params)
        for pcr in proc_rows:
            procedures_summary.append({
                "procedure": str(pcr[0] or "Sin especificar"),
                "amount": float(pcr[1] or 0),
                "count": int(pcr[2]),
                "share": float(pcr[3] or 0)
            })

    # 5. Narrativa del Resumen Ejecutivo
    exec_summary = (
        f"El presente informe consolida los resultados cuantitativos y el diagnóstico de control interno "
        f"correspondiente al período {period} para {institution}. Durante este ciclo se registraron un total de "
        f"{contracts_cnt:,} contratos y {tot_rows:,} partidas presupuestales con un ejercicio contratado de "
        f"${total_amount:,.2f} MXN distribuido entre {prov_cnt:,} proveedores adjudicados.\n\n"
        f"En materia de suministros, la tasa global de entrega se sitúa en un {deliv_rate:.1f}%, con un remanente "
        f"pendiente de {pending_units:,} unidades sujetas a seguimiento en almacén. La evaluación integral de riesgos "
        f"arrojó un nivel de severidad '{risk_data['overall_severity']}', destacando un índice de concentración de mercado "
        f"HHI de {risk_data['concentration']['hhi_score']:,.0f} puntos y {len(risk_data['findings'])} observaciones de control."
    )

    return {
        "metadata": {
            "title": title,
            "report_type": report_type,
            "institution": institution,
            "author": author,
            "period": period,
            "generated_at": dt.datetime.now().strftime("%d/%m/%Y %H:%M"),
            "dataset_name": ctx.dataset.get("name", "Conjunto de Datos"),
            "dataset_id": ctx.dataset.get("id")
        },
        "kpis": [
            {"label": "Monto Total Contratado", "value": f"${total_amount:,.2f} MXN", "sub": "Importe total formalizado"},
            {"label": "Contratos Adjudicados", "value": f"{contracts_cnt:,}", "sub": "Instrumentos jurídicos"},
            {"label": "Cumplimiento de Entrega", "value": f"{deliv_rate:.1f}%", "sub": f"{pending_units:,} pzas pendientes"},
            {"label": "Proveedores Únicos", "value": f"{prov_cnt:,}", "sub": "Padrón activo en ejercicio"},
            {"label": "Índice de Concentración", "value": f"{risk_data['concentration']['hhi_score']:,.0f} pts", "sub": f"Nivel {risk_data['concentration']['hhi_level']}"},
            {"label": "Severidad de Riesgo", "value": risk_data["overall_severity"], "sub": f"{len(risk_data['findings'])} hallazgos prioritarios"}
        ],
        "narrative": exec_summary,
        "risks": risk_data,
        "providers": providers_summary,
        "procedures": procedures_summary,
        "sections": opts.get("sections") or ["header", "kpis", "summary", "risks", "providers", "procedures", "signatures"]
    }
