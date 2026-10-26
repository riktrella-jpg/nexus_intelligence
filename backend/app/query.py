"""Motor de consultas analíticas sobre Parquet con DuckDB.

Seguridad: los nombres de columna se validan contra el catálogo del conjunto de datos y se citan;
los valores siempre se pasan como parámetros. Nunca se ejecuta SQL libre recibido del cliente.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any

import duckdb

from . import store

NUMERIC_OPS = {"sum", "avg", "median", "min", "max"}
GRAINS = {"day": "%Y-%m-%d", "month": "%Y-%m", "year": "%Y"}
EMPTY_LABEL = "(vacío)"


class QueryError(ValueError):
    pass


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class Ctx:
    """Contexto de consulta para un conjunto de datos: catálogo de columnas y conexión."""

    def __init__(self, dataset: dict):
        self.dataset = dataset
        self.cols: dict[str, str] = {c["name"]: c["type"] for c in dataset["columns"]}
        self.cols.update({"_period": "category", "_import_id": "category", "_issues": "text", "_row_id": "number"})
        self.roles: dict[str, str] = {c["role"]: c["name"] for c in dataset["columns"] if c.get("role")}
        path = str(store.data_path(dataset["id"])).replace("'", "''")
        self.con = duckdb.connect()
        self.con.execute(f"CREATE VIEW d AS SELECT * FROM read_parquet('{path}')")

    def col(self, name: str, kinds: tuple[str, ...] | None = None) -> str:
        if name not in self.cols:
            raise QueryError(f"La columna '{name}' no existe en el conjunto de datos.")
        if kinds and self.cols[name] not in kinds:
            raise QueryError(f"La columna '{name}' es de tipo '{self.cols[name]}' y no es compatible con esta operación.")
        return q(name)

    def run(self, sql: str, params: list | None = None) -> list[tuple]:
        return self.con.execute(sql, params or []).fetchall()

    def close(self):
        self.con.close()


# ------------------------------------------------------------------ filtros
def _cond(ctx: Ctx, c: dict) -> tuple[str, list]:
    name, op = c.get("col"), c.get("op")
    col = ctx.col(name)
    t = ctx.cols[name]
    v, v2 = c.get("value"), c.get("value2")
    if op == "isnull":
        return f"{col} IS NULL", []
    if op == "notnull":
        return f"{col} IS NOT NULL", []
    if t == "number":
        def num(x):
            try:
                return float(str(x).replace(",", ""))
            except (TypeError, ValueError):
                raise QueryError(f"Valor numérico inválido para '{name}': {x!r}")
        if op in ("eq", "neq", "gt", "gte", "lt", "lte"):
            sym = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            return f"{col} {sym} ?", [num(v)]
        if op == "between":
            return f"{col} BETWEEN ? AND ?", [num(v), num(v2)]
        raise QueryError(f"Operador '{op}' no válido para columnas numéricas.")
    if t == "date":
        def dte(x):
            try:
                return dt.date.fromisoformat(str(x)[:10])
            except ValueError:
                raise QueryError(f"Fecha inválida para '{name}': {x!r} (use AAAA-MM-DD).")
        if op in ("eq", "neq", "gt", "gte", "lt", "lte"):
            sym = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            return f"{col} {sym} ?", [dte(v)]
        if op == "between":
            return f"{col} BETWEEN ? AND ?", [dte(v), dte(v2)]
        raise QueryError(f"Operador '{op}' no válido para columnas de fecha.")
    # texto / categoría / identificador
    txt = f"lower(CAST({col} AS VARCHAR))"
    if op == "eq":
        return f"{txt} = lower(?)", [str(v)]
    if op == "neq":
        return f"({col} IS NULL OR {txt} <> lower(?))", [str(v)]
    if op in ("in", "not_in"):
        vals = [str(x).lower() for x in (v or [])]
        if not vals:
            return ("FALSE" if op == "in" else "TRUE"), []
        ph = ",".join("?" * len(vals))
        return (f"{txt} IN ({ph})" if op == "in" else f"({col} IS NULL OR {txt} NOT IN ({ph}))"), vals
    if op == "contains":
        return f"contains({txt}, lower(?))", [str(v)]
    if op == "not_contains":
        return f"({col} IS NULL OR NOT contains({txt}, lower(?)))", [str(v)]
    if op == "startswith":
        return f"starts_with({txt}, lower(?))", [str(v)]
    raise QueryError(f"Operador '{op}' no válido para columnas de texto.")


def compile_filter(ctx: Ctx, node: dict | None, depth: int = 0) -> tuple[str, list]:
    if not node:
        return "TRUE", []
    if depth > 6:
        raise QueryError("Agrupación de filtros demasiado profunda.")
    if "items" in node:
        logic = {"AND": " AND ", "OR": " OR "}.get(str(node.get("logic", "AND")).upper())
        if not logic:
            raise QueryError("Lógica de filtro inválida (use AND/OR).")
        parts, params = [], []
        for it in node["items"]:
            s, p = compile_filter(ctx, it, depth + 1)
            if s != "TRUE":
                parts.append(f"({s})")
                params += p
        sql = logic.join(parts) if parts else "TRUE"
        return (f"NOT ({sql})" if node.get("negate") and parts else sql), params
    return _cond(ctx, node)


def where(ctx: Ctx, filt: dict | None, search: str | None = None) -> tuple[str, list]:
    s, p = compile_filter(ctx, filt)
    if search:
        txtcols = [n for n, t in ctx.cols.items() if t in ("text", "category", "identifier") and not n.startswith("_")]
        if txtcols:
            ors = " OR ".join(f"contains(lower(CAST({q(n)} AS VARCHAR)), lower(?))" for n in txtcols)
            s = f"({s}) AND ({ors})"
            p = p + [search] * len(txtcols)
    return s, p


# ------------------------------------------------------------------ métricas
def metric_sql(ctx: Ctx, m: dict) -> str:
    op = m.get("op")
    if op == "count":
        return "COUNT(*)"
    if op == "count_distinct":
        return f"COUNT(DISTINCT {ctx.col(m['col'])})"
    if op in NUMERIC_OPS:
        kinds = ("number", "date") if op in ("min", "max") else ("number",)
        c = ctx.col(m["col"], kinds)
        fn = {"sum": "SUM", "avg": "AVG", "median": "MEDIAN", "min": "MIN", "max": "MAX"}[op]
        return f"{fn}({c})"
    if op in ("pending", "excess", "compliance", "delivered_valid"):
        qty = ctx.col(m["qty"], ("number",))
        dlv = ctx.col(m["delivered"], ("number",))
        ok = f"{qty} IS NOT NULL AND {dlv} IS NOT NULL"
        if op == "pending":  # máximo(solicitada - entregada, 0)
            return f"SUM(CASE WHEN {ok} THEN GREATEST({qty} - {dlv}, 0) END)"
        if op == "excess":
            return f"SUM(CASE WHEN {ok} THEN GREATEST({dlv} - {qty}, 0) END)"
        if op == "delivered_valid":
            return f"SUM(CASE WHEN {ok} THEN LEAST({dlv}, {qty}) END)"
        den = f"SUM(CASE WHEN {ok} AND {qty} > 0 THEN {qty} END)"
        return f"SUM(CASE WHEN {ok} AND {qty} > 0 THEN LEAST({dlv}, {qty}) END) / NULLIF({den}, 0)"
    if op == "ratio":
        return f"(({metric_sql(ctx, m['num'])}) * 1.0 / NULLIF(({metric_sql(ctx, m['den'])}), 0))"
    raise QueryError(f"Operación de indicador no soportada: {op!r}")


def metric_label(m: dict) -> str:
    op = m.get("op")
    names = {"count": "Conteo de registros", "count_distinct": "Conteo único de", "sum": "Suma de", "avg": "Promedio de",
             "median": "Mediana de", "min": "Mínimo de", "max": "Máximo de", "pending": "Piezas pendientes",
             "excess": "Entregas excedentes", "compliance": "% de cumplimiento", "ratio": "Razón"}
    base = names.get(op, op)
    if op in ("count_distinct", "sum", "avg", "median", "min", "max"):
        return f"{base} {m['col']}"
    if op == "ratio":
        return f"{metric_label(m['num'])} / {metric_label(m['den'])}"
    return base


def is_additive(m: dict) -> bool:
    return m.get("op") in ("count", "sum", "pending", "excess", "delivered_valid")


def _dim_sql(ctx: Ctx, d: dict) -> str:
    name = d["col"]
    col = ctx.col(name)
    if ctx.cols[name] == "date":
        grain = d.get("grain") or "month"
        if grain == "quarter":
            e = f"CAST(year({col}) AS VARCHAR) || '-T' || CAST(quarter({col}) AS VARCHAR)"
        elif grain in GRAINS:
            e = f"strftime({col}, '{GRAINS[grain]}')"
        else:
            raise QueryError("Granularidad de fecha inválida.")
        return f"COALESCE({e}, '{EMPTY_LABEL}')"
    return f"COALESCE(CAST({col} AS VARCHAR), '{EMPTY_LABEL}')"


def _json_val(v: Any):
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    if isinstance(v, float):
        return None if v != v else v
    if hasattr(v, "__float__") and not isinstance(v, (int, str, bool)):
        return float(v)
    return v


def kpi(ctx: Ctx, m: dict, filt: dict | None, search: str | None = None) -> dict:
    w, p = where(ctx, filt, search)
    sql = metric_sql(ctx, m)
    val = ctx.run(f"SELECT {sql}, COUNT(*) FROM d WHERE {w}", p)[0]
    return {"value": _json_val(val[0]), "rows": val[1]}


def aggregate(ctx: Ctx, metric: dict, group_by: list[dict], filt: dict | None, top_n: int | None = 10, sort: str = "desc",
              sort_by_label: bool = False, include_others: bool = False, search: str | None = None, limit_rows: int = 5000) -> dict:
    w, p = where(ctx, filt, search)
    msql = metric_sql(ctx, metric)
    total_row = ctx.run(f"SELECT {msql}, COUNT(*) FROM d WHERE {w}", p)[0]
    total, nrows = _json_val(total_row[0]), total_row[1]
    if not group_by:
        return {"total": total, "rows_considered": nrows, "rows": [], "metric": metric_label(metric)}
    dims = [_dim_sql(ctx, d) for d in group_by]
    sel = ", ".join(f"{d} AS d{i}" for i, d in enumerate(dims))
    order = "ASC" if sort == "asc" else "DESC"
    is_time = ctx.cols[group_by[0]["col"]] == "date"
    order_sql = "d0 ASC" if (is_time or sort_by_label) else f"v {order} NULLS LAST"
    lim = f"LIMIT {int(top_n)}" if top_n and not include_others else f"LIMIT {int(limit_rows)}"
    sql = f"SELECT {sel}, {msql} AS v, COUNT(*) AS n FROM d WHERE {w} GROUP BY {', '.join(f'd{i}' for i in range(len(dims)))} ORDER BY {order_sql} {lim}"
    rows = ctx.run(sql, p)
    out = []
    for r in rows:
        keys = list(r[: len(dims)])
        out.append({"keys": keys, "label": " · ".join(map(str, keys)), "value": _json_val(r[-2]), "rows": r[-1]})
    others = None
    if top_n and include_others and len(out) > top_n and is_additive(metric):
        head, tail = out[:top_n], out[top_n:]
        others = {"keys": ["Otros"], "label": "Otros", "value": sum(x["value"] or 0 for x in tail), "rows": sum(x["rows"] for x in tail)}
        out = head + [others]
    elif top_n and include_others:
        out = out[:top_n]
    if is_additive(metric) and total:
        for r in out:
            r["share"] = (r["value"] or 0) / total if total else None
    return {"total": total, "rows_considered": nrows, "rows": out, "metric": metric_label(metric),
            "additive": is_additive(metric), "groups": len(rows)}


def pivot(ctx: Ctx, metric: dict, rows: list[dict], cols: list[dict], filt: dict | None, limit: int = 2000) -> dict:
    """Tabla dinámica con subtotales y total general calculados en el motor (no en el cliente)."""
    w, p = where(ctx, filt)
    msql = metric_sql(ctx, metric)
    rdims = [_dim_sql(ctx, d) for d in rows]
    cdims = [_dim_sql(ctx, d) for d in cols[:1]]

    def grp(dims: list[str]):
        if not dims:
            return ctx.run(f"SELECT {msql}, COUNT(*) FROM d WHERE {w}", p)
        s = ", ".join(f"{d} AS d{i}" for i, d in enumerate(dims))
        g = ", ".join(f"d{i}" for i in range(len(dims)))
        return ctx.run(f"SELECT {s}, {msql}, COUNT(*) FROM d WHERE {w} GROUP BY {g} ORDER BY {g} LIMIT {limit}", p)

    cells = [{"row": list(r[: len(rdims)]), "col": list(r[len(rdims): len(rdims) + len(cdims)]), "value": _json_val(r[-2]), "rows": r[-1]}
             for r in grp(rdims + cdims)]
    row_tot = [{"row": list(r[: len(rdims)]), "value": _json_val(r[-2]), "rows": r[-1]} for r in grp(rdims)] if rdims else []
    col_tot = [{"col": list(r[: len(cdims)]), "value": _json_val(r[-2]), "rows": r[-1]} for r in grp(cdims)] if cdims else []
    # subtotales por primer nivel cuando hay más de un nivel de filas
    sub = []
    if len(rdims) > 1:
        sub = [{"row": list(r[:1]), "value": _json_val(r[-2]), "rows": r[-1]} for r in grp(rdims[:1])]
    g = grp([])[0]
    return {"cells": cells, "row_totals": row_tot, "col_totals": col_tot, "subtotals": sub,
            "grand_total": _json_val(g[0]), "rows_considered": g[1], "metric": metric_label(metric), "additive": is_additive(metric)}


def crosstab(ctx: Ctx, metrics: list[dict], rows: list[dict], col: dict | None, filt: dict | None, search: str | None = None,
             top_rows: int = 50, top_cols: int = 12, sort: str = "desc", sort_metric: int = 0, sort_by_label: bool = False) -> dict:
    """Análisis cruzado: varias dimensiones en filas × una dimensión en columnas × varios indicadores.

    Todo se agrega en DuckDB. Se limita a las Top-N filas/columnas según el indicador elegido; para indicadores
    aditivos (sumas, conteos) el resto de columnas se resume en «Otros» para que los totales cuadren.
    """
    if not metrics:
        raise QueryError("Seleccione al menos un indicador.")
    if len(metrics) > 12 or len(rows) > 6:
        raise QueryError("Máximo 12 indicadores y 6 dimensiones en filas.")
    if not rows:
        raise QueryError("Seleccione al menos una dimensión para las filas.")
    top_rows = max(1, min(int(top_rows or 50), 1000))
    top_cols = max(1, min(int(top_cols or 12), 60))
    sort_metric = sort_metric if 0 <= int(sort_metric) < len(metrics) else 0

    w, p = where(ctx, filt, search)
    msqls = [metric_sql(ctx, m) for m in metrics]
    rdims = [_dim_sql(ctx, d) for d in rows]
    cdim = _dim_sql(ctx, col) if col else None
    rnames = [f"__r{i}" for i in range(len(rdims))]
    sel = ", ".join(f"{e} AS {n}" for e, n in zip(rdims, rnames)) + (f", {cdim} AS __c0" if cdim else "")
    ctx.con.execute(f"CREATE OR REPLACE TEMP TABLE f AS SELECT *, {sel} FROM d WHERE {w}", p)
    mcols = ", ".join(f"{s} AS __m{i}" for i, s in enumerate(msqls))
    nm = len(msqls)

    def vals(r, start: int) -> list:
        return [_json_val(v) for v in r[start: start + nm]]

    order_dir = "ASC" if sort == "asc" else "DESC"
    r_is_time = ctx.cols[rows[0]["col"]] == "date"
    r_order = ", ".join(rnames) if (r_is_time or sort_by_label) else f"__m{sort_metric} {order_dir} NULLS LAST, {', '.join(rnames)}"
    gr = ", ".join(rnames)

    g = ctx.run(f"SELECT {mcols}, COUNT(*) FROM f")[0]
    grand = {"values": vals(g, 0), "rows": g[-1]}
    row_groups = ctx.run(f"SELECT COUNT(*) FROM (SELECT 1 FROM f GROUP BY {gr})")[0][0]
    rres = ctx.run(f"SELECT {gr}, {mcols}, COUNT(*) FROM f GROUP BY {gr} ORDER BY {r_order} LIMIT {top_rows}")
    nr = len(rnames)
    out_rows = [{"keys": list(r[:nr]), "label": " · ".join(map(str, r[:nr])), "values": vals(r, nr), "rows": r[-1]} for r in rres]
    ctx.con.execute(f"CREATE OR REPLACE TEMP TABLE tr AS SELECT {gr}, {msqls[sort_metric]} AS __m{sort_metric} FROM f "
                    f"GROUP BY {gr} ORDER BY {r_order} LIMIT {top_rows}")

    out_cols, cells, others, col_groups = [], [], [], 0
    if cdim:
        c_is_time = ctx.cols[col["col"]] == "date"
        c_order = "__c0" if c_is_time else f"__m{sort_metric} DESC NULLS LAST, __c0"
        col_groups = ctx.run("SELECT COUNT(DISTINCT __c0) FROM f")[0][0]
        cres = ctx.run(f"SELECT __c0, {mcols}, COUNT(*) FROM f GROUP BY __c0 ORDER BY {c_order} LIMIT {top_cols}")
        out_cols = [{"key": r[0], "values": vals(r, 1), "rows": r[-1]} for r in cres]
        ctx.con.execute(f"CREATE OR REPLACE TEMP TABLE tc AS SELECT __c0, {msqls[sort_metric]} AS __m{sort_metric} FROM f "
                        f"GROUP BY __c0 ORDER BY {c_order} LIMIT {top_cols}")
        ridx = {tuple(r["keys"]): i for i, r in enumerate(out_rows)}
        cidx = {c["key"]: i for i, c in enumerate(out_cols)}
        cres2 = ctx.run(f"SELECT {', '.join('f.' + n for n in rnames)}, f.__c0, {mcols}, COUNT(*) FROM f "
                        f"JOIN tr USING ({gr}) WHERE f.__c0 IN (SELECT __c0 FROM tc) GROUP BY {', '.join('f.' + n for n in rnames)}, f.__c0")
        for r in cres2:
            ri, ci = ridx.get(tuple(r[:nr])), cidx.get(r[nr])
            if ri is not None and ci is not None:
                cells.append({"r": ri, "c": ci, "values": vals(r, nr + 1), "rows": r[-1]})
        # «Otros»: diferencia entre el total de la fila y las columnas mostradas (solo indicadores aditivos)
        if col_groups > len(out_cols):
            acc: dict[int, list] = {}
            cnt: dict[int, int] = {}
            for c in cells:
                a = acc.setdefault(c["r"], [0.0] * nm)
                for k, v in enumerate(c["values"]):
                    a[k] += v or 0
                cnt[c["r"]] = cnt.get(c["r"], 0) + c["rows"]
            for i, r in enumerate(out_rows):
                a = acc.get(i, [0.0] * nm)
                ov = [((r["values"][k] or 0) - a[k]) if is_additive(metrics[k]) else None for k in range(nm)]
                orows = r["rows"] - cnt.get(i, 0)
                if orows > 0:
                    others.append({"r": i, "values": ov, "rows": orows})

    additive = [is_additive(m) for m in metrics]
    for r in out_rows:
        r["share"] = [((r["values"][k] or 0) / grand["values"][k]) if additive[k] and grand["values"][k] else None for k in range(nm)]
    # concentración: participación acumulada de los primeros grupos (indicador principal, si es aditivo)
    conc = None
    k0 = sort_metric
    if additive[k0] and grand["values"][k0] and not (r_is_time or sort_by_label) and sort != "asc":
        acc_v, conc = 0.0, {}
        for i, r in enumerate(out_rows, 1):
            acc_v += r["values"][k0] or 0
            if i in (1, 3, 5, 10, 20):
                conc[f"top{i}"] = acc_v / grand["values"][k0]
    return {
        "metrics": [{"label": metric_label(m), "additive": a, "op": m.get("op"), "col": m.get("col")} for m, a in zip(metrics, additive)],
        "row_dims": [d["col"] for d in rows], "col_dim": col["col"] if col else None,
        "rows": out_rows, "row_groups": row_groups, "cols": out_cols, "col_groups": col_groups,
        "cells": cells, "others": others, "grand": grand, "rows_considered": grand["rows"], "concentration": conc,
        "truncated_rows": row_groups > len(out_rows), "truncated_cols": col_groups > len(out_cols),
    }


def fetch_rows(ctx: Ctx, filt: dict | None, search: str | None, sort: str | None, desc: bool, offset: int, limit: int,
               columns: list[str] | None = None) -> dict:
    w, p = where(ctx, filt, search)
    total = ctx.run(f"SELECT COUNT(*) FROM d WHERE {w}", p)[0][0]
    cols = columns or [c["name"] for c in ctx.dataset["columns"]]
    sel = ", ".join(ctx.col(c) for c in cols) + ", _row_id, _period, _issues"
    order = f"ORDER BY {ctx.col(sort)} {'DESC' if desc else 'ASC'} NULLS LAST, _row_id" if sort else "ORDER BY _row_id"
    res = ctx.con.execute(f"SELECT {sel} FROM d WHERE {w} {order} LIMIT {int(limit)} OFFSET {int(offset)}", p)
    names = [x[0] for x in res.description]
    return {"total": total, "offset": int(offset), "limit": int(limit), "rows": [{n: _json_val(v) for n, v in zip(names, r)} for r in res.fetchall()]}





def distinct_values(ctx: Ctx, col: str, search: str | None, limit: int = 50, filt: dict | None = None) -> list[dict]:
    c = ctx.col(col)
    w, p = where(ctx, filt)
    extra = ""
    if search:
        extra = f" AND contains(lower(CAST({c} AS VARCHAR)), lower(?))"
        p = p + [search]
    rows = ctx.run(f"SELECT CAST({c} AS VARCHAR) v, COUNT(*) n FROM d WHERE {w} AND {c} IS NOT NULL{extra} GROUP BY 1 ORDER BY n DESC, v LIMIT {int(limit)}", p)
    return [{"value": r[0], "count": r[1]} for r in rows]


def column_stats(ctx: Ctx, col: str) -> dict:
    c = ctx.col(col)
    t = ctx.cols[col]
    base = ctx.run(f"SELECT COUNT(*), COUNT({c}), COUNT(DISTINCT {c}) FROM d")[0]
    out = {"column": col, "type": t, "total": base[0], "non_null": base[1], "distinct": base[2]}
    if t in ("number", "date"):
        mm = ctx.run(f"SELECT MIN({c}), MAX({c}) FROM d")[0]
        out["min"], out["max"] = _json_val(mm[0]), _json_val(mm[1])
    return out
