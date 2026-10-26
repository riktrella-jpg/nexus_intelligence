"""API de NEXUS INTELLIGENCE (FastAPI)."""
from __future__ import annotations

import csv
import io
import time
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import db, kpis, query as Q, store, risks as R, ai as AI, reports as REP
from .config import AI_PROVIDER_KEY, CORS_ORIGINS, CORS_ORIGIN_REGEX, ensure_dirs
from .ingest import ROLE_LABELS



@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_dirs()
    db.init_db()
    yield


app = FastAPI(title="NEXUS INTELLIGENCE API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX if CORS_ORIGIN_REGEX else None,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
    expose_headers=["Content-Disposition"]
)


@app.get("/api/health")
@app.get("/health")
async def health_check():
    """Endpoint de verificación de estado del servicio."""
    return {"status": "ok", "service": "NEXUS INTELLIGENCE API"}

@app.exception_handler(ValueError)
async def _value_err(_, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(store.ImportError_)
async def _import_err(_, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(Q.QueryError)
async def _query_err(_, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=400, content={"detail": str(exc)})


def _ctx(dataset_id: str) -> Q.Ctx:
    ds = db.get_dataset(dataset_id)
    if not ds or not store.data_path(dataset_id).exists():
        raise HTTPException(404, "Conjunto de datos no encontrado.")
    return Q.Ctx(ds)


def _public(ds: dict) -> dict:
    out = {k: v for k, v in ds.items()}
    out["role_labels"] = ROLE_LABELS
    out["data_kind_label"] = store.DATA_KINDS.get(ds.get("data_kind"), "")
    return out


# ------------------------------------------------------------------ sistema
@app.get("/api/health")
def health():
    return {"status": "ok", "ai_configured": bool(AI_PROVIDER_KEY), "time": time.time(),
            "auth": "no implementada en esta versión (uso local de un solo usuario)"}


# ------------------------------------------------------------------ importación
@app.post("/api/uploads")
async def upload(file: UploadFile = File(...)):
    content = await file.read()
    return store.stage_upload(file.filename or "archivo", content)


@app.get("/api/uploads/{upload_id}/preview")
def upload_preview(upload_id: str, sheet: str | None = None, header_row: int = 1, dataset_id: str | None = None):
    return store.preview(upload_id, sheet, max(1, header_row), dataset_id)


@app.post("/api/imports")
def commit(body: dict = Body(...)):
    return store.commit_import(body)


@app.get("/api/data-kinds")
def data_kinds():
    return store.DATA_KINDS


# ------------------------------------------------------------------ catálogo
@app.get("/api/datasets")
def datasets():
    return [_public(d) for d in db.list_datasets()]


@app.get("/api/datasets/{dataset_id}")
def dataset(dataset_id: str):
    ds = db.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(404, "Conjunto de datos no encontrado.")
    ctx = _ctx(dataset_id)
    try:
        periods = [r[0] for r in ctx.run("SELECT DISTINCT _period FROM d ORDER BY 1")]
        dates = [c["name"] for c in ds["columns"] if c["type"] == "date"]
        rng = None
        if dates:
            r = ctx.run(f"SELECT MIN({Q.q(dates[0])}), MAX({Q.q(dates[0])}) FROM d")[0]
            rng = {"col": dates[0], "min": Q._json_val(r[0]), "max": Q._json_val(r[1])}
        out = _public(ds)
        out.update({"periods": periods, "date_range": rng, "imports": db.list_imports(dataset_id),
                    "procurement": kpis.procurement_ready(ctx), "warnings": kpis.unit_warnings(ctx)})
        return out
    finally:
        ctx.close()


@app.put("/api/datasets/{dataset_id}/mapping")
def update_mapping(dataset_id: str, body: dict = Body(...)):
    """Diccionario de datos: el usuario aprueba o cambia la correspondencia columna → rol analítico."""
    ds = db.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(404, "Conjunto de datos no encontrado.")
    mapping = {c: r for c, r in (body.get("mapping") or {}).items() if r in ROLE_LABELS}
    names = {c["name"] for c in ds["columns"]}
    if any(c not in names for c in mapping):
        raise HTTPException(400, "Se indicó una columna inexistente.")
    seen = {}
    for c, r in mapping.items():
        if r in seen:
            raise HTTPException(400, f"El rol '{ROLE_LABELS[r]}' no puede asignarse a dos columnas ({seen[r]} y {c}).")
        seen[r] = c
    for c in ds["columns"]:
        c["role"] = mapping.get(c["name"])
    ds["mapping"] = mapping
    db.save_dataset(ds)
    db.audit("mapping_update", {"dataset": dataset_id, "mapping": mapping})
    return _public(ds)


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: str):
    """Elimina permanentemente un conjunto de datos, sus archivos Parquet y vistas guardadas."""
    ds = db.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(404, "Conjunto de datos no encontrado.")
    store.delete_dataset_files(dataset_id)
    db.delete_dataset(dataset_id)
    db.audit("delete_dataset", {"dataset_id": dataset_id, "name": ds.get("name")})
    return {"ok": True, "deleted_id": dataset_id, "name": ds.get("name")}


# ------------------------------------------------------------------ analítica
@app.get("/api/datasets/{dataset_id}/suggested-kpis")
def suggested_kpis(dataset_id: str):
    ctx = _ctx(dataset_id)
    try:
        return kpis.suggest(ctx)
    finally:
        ctx.close()


@app.post("/api/datasets/{dataset_id}/kpis")
def eval_kpis(dataset_id: str, body: dict = Body(...)):
    ctx = _ctx(dataset_id)
    t0 = time.time()
    try:
        items = body.get("kpis") or kpis.suggest(ctx)
        res = [kpis.evaluate(ctx, k, body.get("filters"), body.get("search")) for k in items]
        return {"kpis": res, "ms": round((time.time() - t0) * 1000, 1)}
    finally:
        ctx.close()


@app.post("/api/datasets/{dataset_id}/aggregate")
def aggregate(dataset_id: str, body: dict = Body(...)):
    ctx = _ctx(dataset_id)
    t0 = time.time()
    try:
        res = Q.aggregate(ctx, body.get("metric") or {"op": "count"}, body.get("group_by") or [], body.get("filters"),
                          body.get("top_n", 10), body.get("sort", "desc"), bool(body.get("sort_by_label")),
                          bool(body.get("include_others")), body.get("search"))
        res["ms"] = round((time.time() - t0) * 1000, 1)
        return res
    finally:
        ctx.close()


@app.post("/api/datasets/{dataset_id}/pivot")
def pivot(dataset_id: str, body: dict = Body(...)):
    ctx = _ctx(dataset_id)
    try:
        return Q.pivot(ctx, body.get("metric") or {"op": "count"}, body.get("rows") or [], body.get("cols") or [], body.get("filters"))
    finally:
        ctx.close()


@app.post("/api/datasets/{dataset_id}/crosstab")
def crosstab(dataset_id: str, body: dict = Body(...)):
    """Análisis cruzado multi-columna: dimensiones en filas × columnas opcionales × varios indicadores."""
    ctx = _ctx(dataset_id)
    t0 = time.time()
    try:
        raw_cols = body.get("cols")
        raw_col = body.get("col")
        if raw_cols is not None:
            col_list = raw_cols if isinstance(raw_cols, list) else ([raw_cols] if raw_cols else [])
        elif raw_col:
            col_list = [raw_col]
        else:
            col_list = []
        res = Q.crosstab(ctx, body.get("metrics") or [{"op": "count"}], body.get("rows") or [], col_list,
                         body.get("filters"), body.get("search"), body.get("top_rows", 50), body.get("top_cols", 12),
                         body.get("sort", "desc"), int(body.get("sort_metric", 0) or 0), bool(body.get("sort_by_label")))
        res["ms"] = round((time.time() - t0) * 1000, 1)
        return res
    finally:
        ctx.close()


@app.post("/api/datasets/{dataset_id}/rows")
def rows(dataset_id: str, body: dict = Body(...)):
    ctx = _ctx(dataset_id)
    t0 = time.time()
    try:
        req_lim = int(body.get("limit", 100))
        # Si req_lim <= 0 o >= 100000, se permite consultar todos los movimientos (hasta 100,000)
        lim = 100000 if (req_lim <= 0 or req_lim >= 100000) else max(1, min(req_lim, 100000))
        res = Q.fetch_rows(ctx, body.get("filters"), body.get("search"), body.get("sort"), bool(body.get("desc")),
                           max(0, int(body.get("offset", 0))), lim)
        res["ms"] = round((time.time() - t0) * 1000, 1)
        return res
    finally:
        ctx.close()


@app.post("/api/datasets/{dataset_id}/distinct")
def distinct(dataset_id: str, body: dict = Body(...)):
    ctx = _ctx(dataset_id)
    try:
        return Q.distinct_values(ctx, body["col"], body.get("search"), min(500, int(body.get("limit", 50))), body.get("filters"))
    finally:
        ctx.close()


@app.get("/api/datasets/{dataset_id}/column-stats")
def column_stats(dataset_id: str, col: str):
    ctx = _ctx(dataset_id)
    try:
        return Q.column_stats(ctx, col)
    finally:
        ctx.close()


@app.post("/api/datasets/{dataset_id}/export.csv")
def export_csv(dataset_id: str, body: dict = Body(default={})):
    """Exporta TODAS las filas que cumplen los filtros (no solo las visibles)."""
    ctx = _ctx(dataset_id)
    w, p = Q.where(ctx, body.get("filters"), body.get("search"))
    cols = [c["name"] for c in ctx.dataset["columns"]]
    sel = ", ".join(ctx.col(c) for c in cols) + ", _row_id, _period, _issues"
    cur = ctx.con.execute(f"SELECT {sel} FROM d WHERE {w} ORDER BY _row_id", p)
    header = [x[0] for x in cur.description]

    def gen():
        try:
            buf = io.StringIO()
            buf.write("\ufeff")
            wr = csv.writer(buf)
            wr.writerow(header)
            yield buf.getvalue()
            while True:
                chunk = cur.fetchmany(20000)
                if not chunk:
                    break
                buf = io.StringIO()
                csv.writer(buf).writerows([["" if v is None else v for v in r] for r in chunk])
                yield buf.getvalue()
        finally:
            ctx.close()

    db.audit("export_csv", {"dataset": dataset_id})
    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{ctx.dataset["name"]}_seleccion.csv"'})


# ------------------------------------------------------------------ calidad de datos
@app.get("/api/datasets/{dataset_id}/quality")
def quality(dataset_id: str):
    ctx = _ctx(dataset_id)
    try:
        total = ctx.run("SELECT COUNT(*) FROM d")[0][0]
        with_issues = ctx.run("SELECT COUNT(*) FROM d WHERE _issues IS NOT NULL")[0][0]
        dups = ctx.run("SELECT COUNT(*) FROM d WHERE _issues LIKE '%duplicado exacto%'")[0][0]
        issue_rows = ctx.run("SELECT issue, COUNT(*) FROM (SELECT unnest(string_split(_issues, '; ')) AS issue FROM d WHERE _issues IS NOT NULL) GROUP BY 1 ORDER BY 2 DESC")
        cols = []
        for c in ctx.dataset["columns"]:
            n = ctx.run(f"SELECT COUNT({Q.q(c['name'])}) FROM d")[0][0]
            cols.append({"name": c["name"], "type": c["type"], "role": c.get("role"), "non_null": n, "nulls": total - n,
                         "coverage": (n / total) if total else None, "warnings": c.get("warnings", [])})
        return {"total": total, "valid": total - with_issues, "with_issues": with_issues, "exact_duplicates": dups,
                "issues": [{"issue": r[0], "count": r[1]} for r in issue_rows], "columns": cols,
                "unmapped_columns": [c["name"] for c in ctx.dataset["columns"] if not c.get("role")],
                "imports": db.list_imports(dataset_id)}
    finally:
        ctx.close()


@app.get("/api/datasets/{dataset_id}/quality/review.csv")
def quality_review(dataset_id: str):
    ctx = _ctx(dataset_id)
    cols = [c["name"] for c in ctx.dataset["columns"]]
    sel = "_row_id, _period, _issues, " + ", ".join(ctx.col(c) for c in cols)
    cur = ctx.con.execute(f"SELECT {sel} FROM d WHERE _issues IS NOT NULL ORDER BY _row_id")
    header = [x[0] for x in cur.description]

    def gen():
        try:
            buf = io.StringIO()
            buf.write("\ufeff")
            csv.writer(buf).writerow(header)
            yield buf.getvalue()
            while True:
                chunk = cur.fetchmany(20000)
                if not chunk:
                    break
                buf = io.StringIO()
                csv.writer(buf).writerows([["" if v is None else v for v in r] for r in chunk])
                yield buf.getvalue()
        finally:
            ctx.close()

    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="registros_para_revision.csv"'})


# ------------------------------------------------------------------ vistas guardadas / bitácora
@app.get("/api/datasets/{dataset_id}/records/{row_id}")
def record(dataset_id: str, row_id: int):
    """Trazabilidad: devuelve el registro tipificado y los valores originales tal como llegaron en el archivo."""
    import polars as pl
    ctx = _ctx(dataset_id)
    try:
        typed = ctx.con.execute("SELECT * FROM d WHERE _row_id = ?", [row_id])
        names = [x[0] for x in typed.description]
        trow = typed.fetchone()
        if not trow:
            raise HTTPException(404, "Registro no encontrado.")
        raw = pl.scan_parquet(store.raw_path(dataset_id)).filter(pl.col("_row_id") == row_id).collect().to_dicts()
        meta = {r["id"]: r for r in db.list_imports(dataset_id)}
        t = {n: Q._json_val(v) for n, v in zip(names, trow)}
        imp = meta.get(t.get("_import_id"), {})
        return {"typed": t, "original": raw[0] if raw else {},
                "source": {"file": imp.get("filename"), "sheet": imp.get("sheet"), "period": imp.get("period"), "import_id": imp.get("id")}}
    finally:
        ctx.close()


@app.get("/api/datasets/{dataset_id}/views")
def views(dataset_id: str, kind: str | None = None):
    return db.list_views(dataset_id, kind)


@app.post("/api/datasets/{dataset_id}/views")
def create_view(dataset_id: str, body: dict = Body(...)):
    if not body.get("name") or not body.get("kind"):
        raise HTTPException(400, "Se requiere nombre y tipo de vista.")
    v = db.save_view(dataset_id, body["name"][:120], body["kind"], body.get("payload") or {})
    db.audit("save_view", {"dataset": dataset_id, "name": body["name"], "kind": body["kind"]})
    return v


@app.delete("/api/views/{view_id}")
def remove_view(view_id: str):
    db.delete_view(view_id)
    return {"ok": True}


@app.get("/api/audit")
def audit_log(limit: int = Query(200, le=1000)):
    return db.list_audit(limit)


# ------------------------------------------------------------------ módulo III: análisis de riesgos
@app.post("/api/datasets/{dataset_id}/risks")
def evaluate_risks(dataset_id: str, body: dict = Body(default={})):
    """Ejecuta análisis de riesgos determinístico (HHI, precios, suministros, fraccionamiento)."""
    ctx = _ctx(dataset_id)
    try:
        return R.analyze_risks(ctx, body.get("filters"), body.get("search"))
    finally:
        ctx.close()


# ------------------------------------------------------------------ módulo III: asistente conversacional NEXUS AI
@app.post("/api/datasets/{dataset_id}/ai/query")
def ai_query(dataset_id: str, body: dict = Body(...)):
    """Procesa consultas en lenguaje natural y genera respuestas analíticas verificables."""
    ctx = _ctx(dataset_id)
    try:
        return AI.query_assistant(ctx, body.get("query", ""), body.get("filters"))
    finally:
        ctx.close()


# ------------------------------------------------------------------ módulo IV: generador de reportes
@app.post("/api/datasets/{dataset_id}/reports/generate")
def generate_report(dataset_id: str, body: dict = Body(default={})):
    """Genera la estructura de datos completa para el reporte ejecutivo institucional."""
    ctx = _ctx(dataset_id)
    try:
        return REP.build_report_data(ctx, body)
    finally:
        ctx.close()


# ------------------------------------------------------------------ utilería de demostración
@app.post("/api/demo/seed")
def seed_demo_data():
    """Carga automáticamente el conjunto de datos de prueba sintético para demostración inmediata."""
    ensure_dirs()
    db.init_db()
    from pathlib import Path
    data_file = Path(__file__).parent.parent / "tests" / "data" / "SINTETICO_contrataciones_enero.xlsx"
    if not data_file.exists():
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent / "tests"))
        import synth
        out = Path(__file__).parent.parent / "tests" / "data"
        out.mkdir(exist_ok=True)
        jan = synth.make_rows(1, 40, start=1)
        synth.write_xlsx(out / "SINTETICO_contrataciones_enero.xlsx", jan)
        data_file = out / "SINTETICO_contrataciones_enero.xlsx"

    with open(data_file, "rb") as f:
        st = store.stage_upload(data_file.name, f.read())

    prev = store.preview(st["upload_id"], sheet="Contratos", header_row=1)
    mapping = prev.get("proposed_mapping") or {c["name"]: c.get("suggested_role") for c in prev["columns"] if c.get("suggested_role")}

    res = store.commit_import({
        "upload_id": st["upload_id"],
        "sheet": "Contratos",
        "header_row": 1,
        "dataset_name": "Contrataciones Médicas y Suministros Hospitalarios 2026",
        "institution": "Instituto Nacional de Salud y Especialidades",
        "source": "Secretaría Administrativa - Dirección de Adquisiciones",
        "period": "2026-01",
        "cutoff": "31/01/2026",
        "data_kind": "movements",
        "mode": "new",
        "mapping": mapping,
        "ack_unresolved": True
    })

    db.audit("demo_seed", {"dataset_id": res["dataset_id"], "name": "Contrataciones Médicas y Suministros Hospitalarios 2026"})
    return res



