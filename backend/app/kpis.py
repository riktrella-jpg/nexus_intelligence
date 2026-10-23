"""KPIs sugeridos según las columnas realmente disponibles (roles aprobados) y perfil de contrataciones."""
from __future__ import annotations

from . import query as Q
from .ingest import ROLE_LABELS


def suggest(ctx: Q.Ctx) -> list[dict]:
    r = ctx.roles
    ks: list[dict] = [{
        "id": "rows", "name": "Registros", "metric": {"op": "count"}, "unit": "registros", "format": "int",
        "definition": "Número de filas del conjunto con los filtros activos. Una fila puede ser una partida, no un contrato.",
    }]
    if "contract_id" in r:
        ks.append({"id": "contracts", "name": "Contratos únicos", "metric": {"op": "count_distinct", "col": r["contract_id"]},
                   "unit": "contratos", "format": "int",
                   "definition": f"Conteo de valores distintos de '{r['contract_id']}' (no cuenta partidas repetidas)."})
    if "provider" in r:
        ks.append({"id": "providers", "name": "Proveedores únicos", "metric": {"op": "count_distinct", "col": r["provider"]},
                   "unit": "proveedores", "format": "int", "definition": f"Valores distintos de '{r['provider']}'."})
    if "amount" in r:
        a = r["amount"]
        ks.append({"id": "amount_sum", "name": "Monto total", "metric": {"op": "sum", "col": a}, "unit": "MXN", "format": "money",
                   "definition": f"Suma de '{a}'. Si el contrato aparece en varias filas con el monto total repetido, la suma puede duplicar importes."})
        ks.append({"id": "amount_avg", "name": "Monto promedio por registro", "metric": {"op": "avg", "col": a}, "unit": "MXN", "format": "money",
                   "definition": f"Promedio de '{a}' por fila."})
        ks.append({"id": "amount_max", "name": "Monto máximo", "metric": {"op": "max", "col": a}, "unit": "MXN", "format": "money",
                   "definition": f"Valor máximo de '{a}'."})
    if "quantity" in r and "quantity_delivered" in r:
        q_, d_ = r["quantity"], r["quantity_delivered"]
        base = {"qty": q_, "delivered": d_}
        ks.append({"id": "qty", "name": "Cantidad solicitada", "metric": {"op": "sum", "col": q_}, "unit": "piezas", "format": "int",
                   "definition": f"Suma de '{q_}'."})
        ks.append({"id": "delivered", "name": "Cantidad entregada", "metric": {"op": "sum", "col": d_}, "unit": "piezas", "format": "int",
                   "definition": f"Suma de '{d_}'."})
        ks.append({"id": "pending", "name": "Piezas pendientes", "metric": {"op": "pending", **base}, "unit": "piezas", "format": "int",
                   "definition": f"Σ máximo('{q_}' − '{d_}', 0), solo filas con ambas cantidades válidas."})
        ks.append({"id": "excess", "name": "Entregas excedentes", "metric": {"op": "excess", **base}, "unit": "piezas", "format": "int",
                   "definition": f"Σ máximo('{d_}' − '{q_}', 0). Se reporta aparte y no compensa pendientes."})
        ks.append({"id": "compliance", "name": "Cumplimiento de entrega", "metric": {"op": "compliance", **base}, "unit": "%", "format": "pct",
                   "definition": "Σ mín(entregada, solicitada) / Σ solicitada; solo filas con solicitada > 0."})
    return ks


def evaluate(ctx: Q.Ctx, k: dict, filt, search=None) -> dict:
    out = {k_: v for k_, v in k.items()}
    try:
        res = Q.kpi(ctx, k["metric"], filt, search)
        out.update(res)
    except Q.QueryError as e:
        out.update({"value": None, "error": str(e)})
    return out


def unit_warnings(ctx: Q.Ctx) -> list[str]:
    w = []
    u = ctx.roles.get("unit_of_measure")
    if u and ("quantity" in ctx.roles):
        n = ctx.run(f"SELECT COUNT(DISTINCT {Q.q(u)}) FROM d")[0][0]
        if n > 1:
            w.append(f"Las cantidades están en {n} unidades de medida distintas ('{u}'). No sume piezas, cajas o dosis sin equivalencias; agrupe por unidad.")
    return w


PROFILE_REQUIRED = {"amount", "provider"}


def procurement_ready(ctx: Q.Ctx) -> dict:
    have = set(ctx.roles)
    return {"ready": PROFILE_REQUIRED <= have, "missing": [ROLE_LABELS[x] for x in PROFILE_REQUIRED - have],
            "supply": {"quantity", "quantity_delivered"} <= have}
