"""Persistencia de metadatos en SQLite (datasets, importaciones, vistas guardadas, auditoría)."""
import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager

from .config import DB_PATH, ensure_dirs

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, institution TEXT, source TEXT,
  data_kind TEXT DEFAULT 'movements', key_cols TEXT DEFAULT '[]',
  mapping TEXT DEFAULT '{}', columns TEXT DEFAULT '[]',
  cutoff TEXT, created_at REAL, updated_at REAL, row_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, filename TEXT, sheet TEXT,
  period TEXT, cutoff TEXT, mode TEXT, rows_received INTEGER, rows_added INTEGER,
  rows_skipped INTEGER, rows_updated INTEGER, rows_invalid INTEGER,
  file_path TEXT, summary TEXT, created_at REAL
);
CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL, payload TEXT NOT NULL, created_at REAL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, actor TEXT, action TEXT, detail TEXT
);
"""


def new_id() -> str:
    return uuid.uuid4().hex[:12]


@contextmanager
def conn():
    ensure_dirs()
    with _lock:
        c = sqlite3.connect(DB_PATH, timeout=30)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()


def init_db() -> None:
    with conn() as c:
        c.executescript(SCHEMA)


def audit(action: str, detail: dict | str = "", actor: str = "local") -> None:
    with conn() as c:
        c.execute(
            "INSERT INTO audit(ts, actor, action, detail) VALUES (?,?,?,?)",
            (time.time(), actor, action, detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)),
        )


JSON_FIELDS = {"key_cols", "mapping", "columns", "summary", "payload"}


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for k in JSON_FIELDS:
        if k in d and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except json.JSONDecodeError:
                pass
    return d


def get_dataset(dataset_id: str) -> dict | None:
    with conn() as c:
        return row_to_dict(c.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone())


def list_datasets() -> list[dict]:
    with conn() as c:
        return [row_to_dict(r) for r in c.execute("SELECT * FROM datasets ORDER BY updated_at DESC")]


def save_dataset(d: dict) -> None:
    d = dict(d)
    d["updated_at"] = time.time()
    for k in JSON_FIELDS:
        if k in d and not isinstance(d[k], str):
            d[k] = json.dumps(d[k], ensure_ascii=False)
    cols = list(d.keys())
    with conn() as c:
        c.execute(
            f"INSERT OR REPLACE INTO datasets({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [d[k] for k in cols],
        )


def delete_dataset(dataset_id: str) -> None:
    with conn() as c:
        c.execute("DELETE FROM datasets WHERE id=?", (dataset_id,))
        c.execute("DELETE FROM imports WHERE dataset_id=?", (dataset_id,))
        c.execute("DELETE FROM saved_views WHERE dataset_id=?", (dataset_id,))


def add_import(rec: dict) -> None:
    rec = dict(rec)
    rec["summary"] = json.dumps(rec.get("summary", {}), ensure_ascii=False)
    rec["created_at"] = time.time()
    cols = list(rec.keys())
    with conn() as c:
        c.execute(f"INSERT INTO imports({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [rec[k] for k in cols])


def list_imports(dataset_id: str) -> list[dict]:
    with conn() as c:
        return [row_to_dict(r) for r in c.execute("SELECT * FROM imports WHERE dataset_id=? ORDER BY created_at", (dataset_id,))]


def list_views(dataset_id: str, kind: str | None = None) -> list[dict]:
    with conn() as c:
        q, p = "SELECT * FROM saved_views WHERE dataset_id=?", [dataset_id]
        if kind:
            q += " AND kind=?"
            p.append(kind)
        return [row_to_dict(r) for r in c.execute(q + " ORDER BY created_at DESC", p)]


def save_view(dataset_id: str, name: str, kind: str, payload: dict) -> dict:
    vid = new_id()
    with conn() as c:
        c.execute(
            "INSERT INTO saved_views(id,dataset_id,name,kind,payload,created_at) VALUES (?,?,?,?,?,?)",
            (vid, dataset_id, name, kind, json.dumps(payload, ensure_ascii=False), time.time()),
        )
    return {"id": vid, "dataset_id": dataset_id, "name": name, "kind": kind, "payload": payload}


def delete_view(view_id: str) -> None:
    with conn() as c:
        c.execute("DELETE FROM saved_views WHERE id=?", (view_id,))


def list_audit(limit: int = 200) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,))]
