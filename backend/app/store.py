"""Importación, consolidación mensual, versionado y almacenamiento (Parquet) de conjuntos de datos."""
from __future__ import annotations

import difflib
import os
import shutil
import threading
import time
from pathlib import Path

import polars as pl

from . import db
from .config import ALLOWED_EXTENSIONS, DATASET_DIR, MAX_UPLOAD_MB, STAGING_DIR, UPLOAD_DIR
from .ingest import (ROLE_LABELS, build_profile, convert_column, list_sheets, norm, read_table)

WRITE_LOCK = threading.RLock()
INTERNAL_COLS = ["_row_id", "_import_id", "_period", "_issues", "_rowhash"]
RFC_RE = r"^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$"
DATA_KINDS = {
    "movements": "Movimientos (flujo del periodo; se pueden sumar entre meses)",
    "balances": "Saldos (no se suman entre periodos)",
    "cumulative": "Corte acumulado (cada archivo incluye los anteriores)",
    "snapshot": "Fotografía de situación (estado a la fecha de corte)",
}
MODES = {"new", "append", "update", "replace_period"}


class ImportError_(ValueError):
    pass


def dataset_dir(dataset_id: str) -> Path:
    return DATASET_DIR / dataset_id


def data_path(dataset_id: str) -> Path:
    return dataset_dir(dataset_id) / "data.parquet"


def raw_path(dataset_id: str) -> Path:
    return dataset_dir(dataset_id) / "raw.parquet"


def delete_dataset_files(dataset_id: str) -> None:
    dd = dataset_dir(dataset_id)
    if dd.exists():
        shutil.rmtree(dd, ignore_errors=True)
    up = UPLOAD_DIR / dataset_id
    if up.exists():
        shutil.rmtree(up, ignore_errors=True)


# ---------------------------------------------------------------- staging
def stage_upload(filename: str, content: bytes) -> dict:
    safe = Path(filename).name
    ext = Path(safe).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ImportError_(f"Formato no permitido: '{ext}'. Formatos admitidos: {', '.join(sorted(ALLOWED_EXTENSIONS))}")
    if not content:
        raise ImportError_("El archivo está vacío.")
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise ImportError_(f"El archivo supera el límite de {MAX_UPLOAD_MB} MB.")
    if ext in (".xlsx", ".xlsm", ".xlsb") and content[:2] != b"PK":
        raise ImportError_("El contenido no corresponde a un libro de Excel válido (firma incorrecta).")
    if ext in (".csv", ".txt") and b"\x00" in content[:4096]:
        raise ImportError_("El archivo CSV contiene datos binarios; no es un texto delimitado válido.")
    uid = db.new_id()
    d = STAGING_DIR / uid
    d.mkdir(parents=True, exist_ok=True)
    (d / safe).write_bytes(content)
    try:
        sheets = list_sheets(d / safe)
    except Exception as e:  # archivo corrupto
        shutil.rmtree(d, ignore_errors=True)
        raise ImportError_(f"No se pudo abrir el archivo: {e}")
    return {"upload_id": uid, "filename": safe, "size": len(content), "format": ext.lstrip("."), "sheets": sheets}


def staged_path(upload_id: str) -> Path:
    if not upload_id.isalnum():
        raise ImportError_("Identificador de carga inválido.")
    d = STAGING_DIR / upload_id
    files = list(d.glob("*")) if d.exists() else []
    if not files:
        raise ImportError_("La carga temporal no existe o expiró. Vuelva a subir el archivo.")
    return files[0]


_cache: dict = {}


def _read_cached(path: Path, sheet, header_row) -> pl.DataFrame:
    key = (str(path), sheet, header_row, path.stat().st_mtime)
    if key not in _cache:
        if len(_cache) > 2:
            _cache.clear()
        _cache[key] = read_table(path, sheet, header_row)
    return _cache[key]


def _prior_columns(dataset: dict | None) -> dict:
    return {c["name"]: c for c in (dataset or {}).get("columns", [])}


def preview(upload_id: str, sheet: str | None, header_row: int, dataset_id: str | None = None) -> dict:
    path = staged_path(upload_id)
    df = _read_cached(path, sheet, header_row)
    dataset = db.get_dataset(dataset_id) if dataset_id else None
    profile = build_profile(df, _prior_columns(dataset))
    res = {
        "rows": df.height, "cols": df.width, "columns": profile,
        "preview": df.head(15).to_dicts(),
        "roles": [{"role": k, "label": v} for k, v in ROLE_LABELS.items()],
        "duplicates_exact": int(df.height - df.unique().height),
    }
    mapping = (dataset or {}).get("mapping", {})
    res["proposed_mapping"] = {}
    used = set()
    for p in profile:
        role = mapping.get(p["name"]) or p.get("suggested_role")
        if role and role not in used:
            res["proposed_mapping"][p["name"]] = role
            used.add(role)
    if dataset:
        old = {c["name"] for c in dataset["columns"]}
        new = set(df.columns)
        missing, added = sorted(old - new), sorted(new - old)
        renamed = []
        for m in missing:
            cand = difflib.get_close_matches(norm(m), [norm(a) for a in added], n=1, cutoff=0.6)
            if cand:
                renamed.append({"from": m, "to": next(a for a in added if norm(a) == cand[0])})
        res["schema_diff"] = {"missing": missing, "new": added, "possibly_renamed": renamed}
    return res


# ---------------------------------------------------------------- construcción
def _typed_frame(df: pl.DataFrame, profile: list[dict]) -> pl.DataFrame:
    cols = {p["name"]: convert_column(p["name"], df[p["name"]], p) for p in profile}
    return pl.DataFrame(cols)


def _add_issues(raw: pl.DataFrame, typed: pl.DataFrame, profile, mapping) -> pl.Series:
    # evaluar usando columnas tipadas y las originales (prefijo __raw_)
    tmp = typed.with_columns(*[pl.Series(f"__raw_{c}", raw[c]) for c in raw.columns])
    built = []
    for p in profile:
        n = p["name"]
        if p["type"] in ("number", "date"):
            built.append(pl.when(pl.col(n).is_null() & pl.col(f"__raw_{n}").is_not_null()).then(pl.lit(f"{n}: valor no interpretable")))
    for col, role in mapping.items():
        if col not in typed.columns:
            continue
        if role in ("amount", "provider", "contract_id", "rfc", "quantity", "date"):
            built.append(pl.when(pl.col(col).is_null()).then(pl.lit(f"{col}: campo crítico vacío")))
        if role == "rfc":
            built.append(pl.when(pl.col(col).is_not_null() & ~pl.col(col).str.to_uppercase().str.strip_chars().str.contains(RFC_RE))
                         .then(pl.lit(f"{col}: RFC con formato inválido")))
        if role in ("amount", "quantity", "quantity_delivered", "unit_price") and typed[col].dtype == pl.Float64:
            built.append(pl.when(pl.col(col) < 0).then(pl.lit(f"{col}: valor negativo")))
    if not built:
        return pl.Series("_issues", [None] * typed.height, dtype=pl.Utf8)
    s = tmp.select(pl.concat_str(built, separator="; ", ignore_nulls=True).alias("_issues"))["_issues"]
    return pl.Series("_issues", s.to_list(), dtype=pl.Utf8).replace("", None)


def _key_expr(cols: list[str]) -> pl.Expr:
    return pl.concat_str([pl.col(c).fill_null("∅") for c in cols], separator="\x1f")


def commit_import(p: dict) -> dict:
    """Confirma una importación. p: upload_id, sheet, header_row, dataset_id|dataset_name, institution, source,
    period, cutoff, mode, data_kind, key_cols, mapping, confirm_replace."""
    mode = p.get("mode", "new")
    if mode not in MODES:
        raise ImportError_("Modo de importación inválido.")
    path = staged_path(p["upload_id"])
    with WRITE_LOCK:
        ds = db.get_dataset(p["dataset_id"]) if p.get("dataset_id") else None
        if mode == "new":
            if not p.get("dataset_name"):
                raise ImportError_("Indique un nombre para el conjunto de datos.")
            if ds:
                raise ImportError_("El conjunto ya existe. Use agregar/actualizar/reemplazar.")
        elif not ds:
            raise ImportError_("Debe seleccionar un conjunto de datos existente.")
        key_cols = p.get("key_cols") or (ds or {}).get("key_cols") or []
        if mode in ("update",) and not key_cols:
            raise ImportError_("La actualización requiere definir columnas llave. Sin llave confiable no es posible identificar registros.")
        period = (p.get("period") or "").strip() or "(sin periodo)"
        if mode == "replace_period" and not p.get("confirm_replace"):
            raise ImportError_("El reemplazo de un periodo requiere autorización expresa (confirm_replace).")

        raw = _read_cached(path, p.get("sheet"), int(p.get("header_row") or 1))
        for k in key_cols:
            if k not in raw.columns:
                raise ImportError_(f"La columna llave '{k}' no existe en el archivo.")
        profile = build_profile(raw, _prior_columns(ds))
        pmap = {c["name"]: c for c in profile}
        mapping = {c: r for c, r in (p.get("mapping") or {}).items() if c in raw.columns and r in ROLE_LABELS}
        if ds:  # conservar mapeos previos, salvo que el usuario reasigne ese rol a otra columna (p. ej. columna renombrada)
            for c, r in ds.get("mapping", {}).items():
                if r not in mapping.values():
                    mapping.setdefault(c, r)
        # No equivalentes: un mismo rol no puede asignarse a dos columnas
        seen_roles: dict[str, str] = {}
        for c, r in mapping.items():
            if r in seen_roles and seen_roles[r] != c:
                raise ImportError_(f"El rol '{ROLE_LABELS[r]}' está asignado a dos columnas ({seen_roles[r]} y {c}).")
            seen_roles[r] = c
        typed = _typed_frame(raw, profile)
        issues = _add_issues(raw, typed, profile, mapping)
        dup_file = ~raw.select(pl.struct(raw.columns).is_first_distinct().alias("f"))["f"]
        issues = pl.Series("_issues", [
            ("; ".join(x for x in (a, "duplicado exacto en el archivo" if d else None) if x) or None)
            for a, d in zip(issues.to_list(), dup_file.to_list())
        ], dtype=pl.Utf8)
        rowhash = typed.select(pl.concat_str([pl.col(c).cast(pl.Utf8).fill_null("∅") for c in typed.columns], separator="\x1f").hash().alias("h"))["h"]

        import_id = db.new_id()
        n_received = raw.height
        n_invalid = int(issues.is_not_null().sum())
        added = skipped = updated = 0
        existing = None
        old_typed = None
        ddir = dataset_dir(p["dataset_id"] if ds else "pending")
        dataset_id = ds["id"] if ds else db.new_id()
        ddir = dataset_dir(dataset_id)
        ddir.mkdir(parents=True, exist_ok=True)
        if ds and data_path(dataset_id).exists():
            existing = pl.read_parquet(data_path(dataset_id))
            old_raw = pl.read_parquet(raw_path(dataset_id))
        start_id = int(existing["_row_id"].max()) + 1 if existing is not None and existing.height else 1

        new_df = typed.with_columns(
            pl.Series("_row_id", range(start_id, start_id + n_received), dtype=pl.Int64),
            pl.lit(import_id).alias("_import_id"), pl.lit(period).alias("_period"),
            issues, rowhash.alias("_rowhash"),
        )
        new_raw = raw.with_columns(new_df["_row_id"])
        keep = pl.Series([True] * n_received)

        if existing is not None:
            vdir = ddir / "versions"
            vdir.mkdir(exist_ok=True)
            if mode in ("update", "replace_period"):
                shutil.copy2(data_path(dataset_id), vdir / f"{int(time.time())}_{import_id}_data.parquet")
                shutil.copy2(raw_path(dataset_id), vdir / f"{int(time.time())}_{import_id}_raw.parquet")
            if mode == "replace_period":
                gone = existing.filter(pl.col("_period") == period)
                updated = gone.height
                existing = existing.filter(pl.col("_period") != period)
                old_raw = old_raw.filter(pl.col("_row_id").is_in(existing["_row_id"]))
            if mode in ("append", "update") and key_cols:
                # llaves sobre el texto original (no alteran identificadores)
                old_keys = old_raw.select(_key_expr([k for k in key_cols if k in old_raw.columns]).alias("k"))["k"] \
                    if all(k in old_raw.columns for k in key_cols) else pl.Series("k", [], dtype=pl.Utf8)
                new_keys = raw.select(_key_expr(key_cols).alias("k"))["k"]
                exists_mask = new_keys.is_in(old_keys.implode())
                if mode == "append":
                    keep = ~exists_mask
                    skipped = int(exists_mask.sum())
                else:  # update: los existentes se reemplazan
                    drop_ids = old_raw.filter(old_keys.is_in(new_keys.implode()))["_row_id"]
                    updated = drop_ids.len()
                    existing = existing.filter(~pl.col("_row_id").is_in(drop_ids))
                    old_raw = old_raw.filter(~pl.col("_row_id").is_in(drop_ids))
            elif mode == "append":
                keep = ~new_df["_rowhash"].is_in(existing["_rowhash"].implode())
                skipped = int((~keep).sum())
            new_df = new_df.filter(keep)
            new_raw = new_raw.filter(keep)
            added = new_df.height
            data = pl.concat([existing, new_df], how="diagonal_relaxed")
            raw_all = pl.concat([old_raw, new_raw], how="diagonal_relaxed")
        else:
            added = new_df.height
            data, raw_all = new_df, new_raw

        # escritura atómica
        for pth, frame in ((data_path(dataset_id), data), (raw_path(dataset_id), raw_all)):
            tmp = pth.with_suffix(".tmp")
            frame.write_parquet(tmp, compression="zstd")
            os.replace(tmp, pth)

        # archivo original conservado
        udir = UPLOAD_DIR / dataset_id
        udir.mkdir(parents=True, exist_ok=True)
        stored = udir / f"{import_id}_{path.name}"
        shutil.copy2(path, stored)

        # catálogo de columnas (unión)
        cols_meta = {c["name"]: c for c in (ds or {}).get("columns", [])}
        for pr in profile:
            prev = cols_meta.get(pr["name"], {})
            cols_meta[pr["name"]] = {
                "name": pr["name"], "type": pr["type"], "date_format": pr.get("date_format"),
                "serial_date": pr.get("serial_date", False), "percent": pr.get("percent", False),
                "role": mapping.get(pr["name"]), "label": pr["name"],
                "warnings": pr["warnings"] or prev.get("warnings", []),
            }
        for c, m in cols_meta.items():
            m["role"] = mapping.get(c)
        record = {
            "id": dataset_id,
            "name": (ds or {}).get("name") or p["dataset_name"],
            "institution": p.get("institution") or (ds or {}).get("institution"),
            "source": p.get("source") or (ds or {}).get("source"),
            "data_kind": p.get("data_kind") or (ds or {}).get("data_kind") or "movements",
            "key_cols": key_cols, "mapping": mapping, "columns": list(cols_meta.values()),
            "cutoff": p.get("cutoff") or (ds or {}).get("cutoff"),
            "created_at": (ds or {}).get("created_at") or time.time(), "row_count": data.height,
        }
        db.save_dataset(record)
        summary = {"schema_diff": None, "warnings": []}
        if ds:
            old = {c["name"] for c in ds["columns"]}
            summary["schema_diff"] = {"missing": sorted(old - set(raw.columns)), "new": sorted(set(raw.columns) - old)}
        if record["data_kind"] in ("cumulative", "snapshot", "balances"):
            summary["warnings"].append("El tipo de datos no es 'movimientos': no sume periodos; el dashboard usa el último periodo por omisión.")
        db.add_import({
            "id": import_id, "dataset_id": dataset_id, "filename": path.name, "sheet": p.get("sheet"), "period": period,
            "cutoff": p.get("cutoff"), "mode": mode, "rows_received": n_received, "rows_added": added,
            "rows_skipped": skipped, "rows_updated": updated, "rows_invalid": n_invalid,
            "file_path": str(stored), "summary": summary,
        })
        db.audit("import", {"dataset": dataset_id, "import": import_id, "file": path.name, "mode": mode, "added": added,
                            "skipped": skipped, "updated": updated})
        shutil.rmtree(path.parent, ignore_errors=True)
        _cache.clear()
        return {"dataset_id": dataset_id, "import_id": import_id, "rows_received": n_received, "rows_added": added,
                "rows_skipped_duplicates": skipped, "rows_replaced": updated, "rows_with_issues": n_invalid,
                "total_rows": data.height, "summary": summary}
