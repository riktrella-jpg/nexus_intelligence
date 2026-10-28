"""Motor de Conciliación Contractual V2 para NEXUS INTELLIGENCE.
Aplica reglas reproducibles a columnas de Excel (institución, unidad responsable, contrato, proveedor,
clave de medicamento, importe P, cantidad AJ y precio unitario AK) para evitar doble contabilidad y
determinar montos computables inferidos según reglas de columnas.
"""
from __future__ import annotations

import csv
import io
import json
import re
import shutil
import sqlite3
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from .config import BASE_DIR, DATA_DIR, RECONCILIATION_DIR, STAGING_DIR, UPLOAD_DIR

D = Decimal
CENT = D("0.01")
TOL = D("0.02")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RELS_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

FIELDS = {
    "tipo": "A",
    "institucion": "D",
    "ur": "E",
    "unidad_admin": "F",
    "contrato": "H",
    "firma": "I",
    "proveedor": "K",
    "monto": "P",
    "clase_contrato_excel": "Q",
    "clase_clave_excel": "R",
    "consolidado_excel": "S",
    "unidad_destino": "AA",
    "clave": "AC",
    "descripcion": "AD",
    "cantidad": "AJ",
    "precio": "AK",
    "orden": "AO",
    "solicitadas": "AQ",
    "suministradas": "AT",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS detalle (
    fila_excel INTEGER PRIMARY KEY,
    institucion TEXT,
    ur TEXT,
    contrato TEXT,
    proveedor TEXT,
    clave_medicamento TEXT,
    descripcion TEXT,
    monto_declarado TEXT,
    cantidad TEXT,
    precio_unitario TEXT,
    subtotal_calculado TEXT,
    evaluacion_iva TEXT,
    grupo_contrato TEXT,
    grupo_partida TEXT,
    firma_partida TEXT,
    monto_computable TEXT,
    estado TEXT,
    motivo TEXT
);

CREATE TABLE IF NOT EXISTS partidas (
    id_partida TEXT PRIMARY KEY,
    grupo_contrato TEXT,
    clave_medicamento TEXT,
    descripcion TEXT,
    filas INTEGER,
    importes_distintos INTEGER,
    monto_inferido TEXT,
    estado TEXT,
    razon TEXT,
    filas_origen TEXT
);

CREATE TABLE IF NOT EXISTS contratos (
    grupo_contrato TEXT PRIMARY KEY,
    institucion TEXT,
    contrato TEXT,
    proveedor TEXT,
    filas INTEGER,
    partidas INTEGER,
    monto_inferido TEXT,
    monto_revision TEXT,
    pendientes INTEGER,
    estado TEXT,
    razon TEXT
);

CREATE INDEX IF NOT EXISTS idx_d_contrato ON detalle(grupo_contrato);
CREATE INDEX IF NOT EXISTS idx_d_clave ON detalle(clave_medicamento);
CREATE INDEX IF NOT EXISTS idx_d_estado ON detalle(estado);
CREATE INDEX IF NOT EXISTS idx_p_contrato ON partidas(grupo_contrato);
CREATE INDEX IF NOT EXISTS idx_c_estado ON contratos(estado);
"""


# ----------------------------------------------------------------------------
# Normalización y Aritmética
# ----------------------------------------------------------------------------
def norm(x: Any) -> str:
    s = unicodedata.normalize("NFKC", str(x or "")).replace("\xa0", " ")
    return " ".join(s.upper().strip().split())


def num(x: Any) -> Decimal | None:
    try:
        if x in ("", None):
            return None
        return D(str(x).replace(",", "")).quantize(CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None


def amount(x: Any) -> str:
    return str(x) if x is not None else ""


def col(ref: str) -> str:
    m = re.match(r"[A-Z]+", ref)
    return m.group(0) if m else ""


def classify(monto: Decimal | None, subtotal: Decimal | None) -> str:
    if monto is None or subtotal is None:
        return "DATOS_INSUFICIENTES"
    if abs(monto - subtotal) <= TOL:
        return "COINCIDE_DIRECTO"
    if abs(monto - (subtotal * D("1.16")).quantize(CENT)) <= TOL:
        return "COMPATIBLE_IVA_16_NO_CONFIRMADO"
    return "NO_CONCILIADO"


def calculo_firma(r: dict) -> str:
    # Misma clave + mismo monto + misma cantidad y precio significa fila repetida.
    return "|".join((r["partida"], amount(r["monto"]), amount(r["cantidad"]), amount(r["precio"])))


def decidir_partida(recs: list[dict]) -> list[tuple[list[dict], Decimal | None, str, str]]:
    """Devuelve [(filas de un candidato, monto reconocido, estado, motivo)].
    Nunca usa solo el monto como llave global.
    """
    firmas = defaultdict(list)
    for r in recs:
        firmas[calculo_firma(r)].append(r)
    result = []
    for firma, rr in firmas.items():
        r = rr[0]
        monto = r["monto"]
        iva = r["iva"]
        sub = r["subtotal"]
        if monto is None or monto < 0:
            reconocido = None
            estado = "PENDIENTE"
            motivo = "Importe ausente o negativo"
        elif iva in ("COINCIDE_DIRECTO", "COMPATIBLE_IVA_16_NO_CONFIRMADO"):
            reconocido = monto
            estado = "INFERIDO_PARTIDA"
            motivo = "Monto conciliado con cantidad × precio; registros idénticos consolidados"
        elif monto == 0 and sub == 0:
            reconocido = monto
            estado = "INFERIDO_PARTIDA"
            motivo = "Monto y subtotal en cero"
        else:
            reconocido = None
            estado = "PENDIENTE"
            motivo = "Importe no conciliado con cantidad × precio; posible total global o error"
        result.append((rr, reconocido, estado, motivo))
    return result


# ----------------------------------------------------------------------------
# Lector OpenXML (XLSX) con Descubrimiento Dinámico de Hojas
# ----------------------------------------------------------------------------
def find_sheet_target(z: zipfile.ZipFile, sheet_name: str | None = None) -> str:
    rels = {}
    if "xl/_rels/workbook.xml.rels" in z.namelist():
        try:
            r_tree = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
            for rel in r_tree.findall(RELS_NS + "Relationship"):
                rid = rel.get("Id")
                tgt = rel.get("Target", "")
                if not tgt.startswith("xl/"):
                    tgt = "xl/" + tgt.lstrip("/")
                rels[rid] = tgt
        except Exception:
            pass

    sheets = []
    if "xl/workbook.xml" in z.namelist():
        try:
            wb = ET.fromstring(z.read("xl/workbook.xml"))
            sel = wb.find(NS + "sheets")
            if sel is not None:
                for s in sel:
                    name = s.get("name") or ""
                    rid = s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                    sheets.append((name, rels.get(rid, "")))
        except Exception:
            pass

    if sheet_name:
        for n, t in sheets:
            if n.strip().lower() == sheet_name.strip().lower() and t in z.namelist():
                return t
    for n, t in sheets:
        if n.strip().lower() == "base" and t in z.namelist():
            return t
    for n, t in sheets:
        if t in z.namelist():
            return t
    for cand in ("xl/worksheets/sheet3.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"):
        if cand in z.namelist():
            return cand
    for n in z.namelist():
        if n.startswith("xl/worksheets/") and n.endswith(".xml"):
            return n
    return "xl/worksheets/sheet1.xml"


def xlsx_rows(path: Path | str, sheet_name: str | None = None):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            with z.open("xl/sharedStrings.xml") as f:
                for event, el in ET.iterparse(f, events=("end",)):
                    if el.tag == NS + "si":
                        shared.append("".join((t.text or "") for t in el.iter(NS + "t")))
                        el.clear()

        sheet_xml = find_sheet_target(z, sheet_name)
        with z.open(sheet_xml) as f:
            for event, el in ET.iterparse(f, events=("end",)):
                if el.tag != NS + "row":
                    continue
                r = int(el.get("r"))
                if r < 3:
                    el.clear()
                    continue
                cells = {}
                for c in el:
                    if c.tag != NS + "c":
                        continue
                    letter = col(c.get("r"))
                    if letter not in FIELDS.values():
                        continue
                    v = c.find(NS + "v")
                    if c.get("t") == "inlineStr":
                        value = "".join(t.text or "" for t in c.iter(NS + "t"))
                    else:
                        value = v.text if v is not None else ""
                    if c.get("t") == "s" and value:
                        try:
                            value = shared[int(value)]
                        except (IndexError, ValueError):
                            value = ""
                    cells[letter] = value
                el.clear()
                if not cells.get("H"):
                    continue
                item = {k: cells.get(v, "") for k, v in FIELDS.items()}
                item["fila_excel"] = r
                yield item


# ----------------------------------------------------------------------------
# Base de Datos de Conciliación
# ----------------------------------------------------------------------------
def get_reconciliation_db() -> Path:
    RECONCILIATION_DIR.mkdir(parents=True, exist_ok=True)
    target = RECONCILIATION_DIR / "nexus_v2.sqlite"
    if not target.exists() or target.stat().st_size == 0:
        # Intentar cargar la base precalculada del motor si existe
        seed = BASE_DIR.parent / "motor" / "resultados_v2" / "nexus_v2.sqlite"
        if seed.exists() and seed.stat().st_size > 0:
            try:
                shutil.copy2(seed, target)
                return target
            except Exception:
                pass
    return target


def ensure_reconciliation_schema(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


# ----------------------------------------------------------------------------
# Ejecución del Motor V2
# ----------------------------------------------------------------------------
def procesar_archivo(archivo: Path | str, salida_dir: Path | str, sheet_name: str | None = None) -> dict:
    salida = Path(salida_dir)
    salida.mkdir(parents=True, exist_ok=True)
    db_path = salida / "nexus_v2.sqlite"
    
    # Crear conexión fresca
    if db_path.exists():
        try:
            db_path.unlink()
        except Exception:
            pass

    cx = sqlite3.connect(str(db_path))
    cx.executescript(SCHEMA)

    contratos = defaultdict(list)
    for row in xlsx_rows(archivo, sheet_name):
        identidad = tuple(norm(row[x]) for x in ("institucion", "ur", "contrato", "proveedor"))
        gid = "|".join(identidad)
        unidad = norm(row.get("unidad_admin") or row.get("unidad_destino") or "")
        clave = norm(row["clave"])
        desc = norm(row["descripcion"])
        if ("CONASAMA" in identidad[0] or unidad) and unidad:
            partida = f"{gid}|{unidad}|{clave}" if clave else f"{gid}|{unidad}|SIN_CLAVE|{desc}"
        else:
            partida = gid + "|" + clave if clave else gid + "|SIN_CLAVE|" + desc
        monto = num(row["monto"])
        cantidad = num(row["cantidad"])
        precio = num(row["precio"])
        subtotal = (cantidad * precio).quantize(CENT) if cantidad is not None and precio is not None else None
        rec = {
            "row": row,
            "gid": gid,
            "partida": partida,
            "monto": monto,
            "cantidad": cantidad,
            "precio": precio,
            "subtotal": subtotal,
            "iva": classify(monto, subtotal),
        }
        contratos[gid].append(rec)

    estadisticas = Counter()
    filas_salida = []
    partidas_salida = []
    contratos_salida = []

    for gid, rs in contratos.items():
        by_part = defaultdict(list)
        for r in rs:
            by_part[r["partida"]].append(r)
        monto_contrato = D(0)
        pendientes = 0
        revision = []
        razones = []
        partes_total = 0

        for p, rr in by_part.items():
            candidatos = decidir_partida(rr)
            val = sum((m for _, m, _, _ in candidatos if m is not None), D(0))
            pendientes_p = sum(m is None for _, m, _, _ in candidatos)
            monto_contrato += val
            pendientes += pendientes_p
            partes_total += len(candidatos)
            if pendientes_p:
                razones.append("Hay partidas no conciliadas")
            for j, (fls, m, st, motivo) in enumerate(candidatos, 1):
                pid = p + "|" + str(j)
                for n, r in enumerate(fls):
                    row = r["row"]
                    reconocido = m if n == 0 else D(0) if m is not None else None
                    est = st if n == 0 else ("DUPLICADO_NO_SUMAR" if m is not None else "PENDIENTE_DUPLICADO")
                    why = motivo if n == 0 else "Misma clave, monto, cantidad y precio: no sumar de nuevo"
                    filas_salida.append((
                        row["fila_excel"],
                        row["institucion"],
                        row["ur"],
                        row["contrato"],
                        row["proveedor"],
                        row["clave"],
                        row["descripcion"],
                        amount(r["monto"]),
                        amount(r["cantidad"]),
                        amount(r["precio"]),
                        amount(r["subtotal"]),
                        r["iva"],
                        gid,
                        p,
                        pid,
                        amount(reconocido),
                        est,
                        why,
                    ))
                    estadisticas[est] += 1
                partidas_salida.append((
                    pid,
                    gid,
                    fls[0]["row"]["clave"],
                    fls[0]["row"]["descripcion"],
                    len(fls),
                    1,
                    amount(m),
                    st,
                    motivo,
                    ",".join(str(x["row"]["fila_excel"]) for x in fls),
                ))
                if m is None and fls[0]["monto"] is not None:
                    revision.append(fls[0]["monto"])

        estado = (
            "INFERIDO_COMPLETO"
            if pendientes == 0
            else ("PARCIAL_CON_PENDIENTES" if monto_contrato else "PENDIENTE_TOTAL")
        )
        primero = rs[0]["row"]
        contratos_salida.append((
            gid,
            primero["institucion"],
            primero["contrato"],
            primero["proveedor"],
            len(rs),
            partes_total,
            amount(monto_contrato),
            amount(sum(revision, D(0))) if revision else "",
            pendientes,
            estado,
            "; ".join(sorted(set(razones))) if razones else "Claves y firmas de partidas conciliadas aritméticamente",
        ))

    cx.executemany("INSERT INTO detalle VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", filas_salida)
    cx.executemany("INSERT INTO partidas VALUES (?,?,?,?,?,?,?,?,?,?)", partidas_salida)
    cx.executemany("INSERT INTO contratos VALUES (?,?,?,?,?,?,?,?,?,?,?)", contratos_salida)
    cx.commit()

    def export(tabla, nombre):
        cursor = cx.execute("SELECT * FROM " + tabla)
        with (salida / nombre).open("w", newline="", encoding="utf-8-sig") as f:
            wr = csv.writer(f)
            wr.writerow([x[0] for x in cursor.description])
            wr.writerows(cursor)

    export("detalle", "detalle_montos_v2.csv")
    export("partidas", "partidas_unicas_v2.csv")
    export("contratos", "resumen_contratos_v2.csv")

    total = sum((D(r[6]) for r in contratos_salida if r[6]), D(0))
    report = {
        "archivo": Path(archivo).name,
        "filas": len(filas_salida),
        "grupos_contractuales": len(contratos_salida),
        "partidas_candidatas": len(partidas_salida),
        "estados_filas": dict(estadisticas),
        "estados_contratos": dict(Counter(r[9] for r in contratos_salida)),
        "monto_inferido_con_partidas_conciliadas": str(total),
        "advertencia": "Estimación de columnas, NO monto contractual comprobado; los grupos parciales no son totales contractuales completos.",
    }
    (salida / "resumen_v2.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    cx.close()
    return report


# ----------------------------------------------------------------------------
# Consultas y Filtros para la Interfaz Web
# ----------------------------------------------------------------------------
def _build_where(filters: dict | None, allowed_cols: dict[str, str]) -> tuple[str, list]:
    where = []
    args = []
    if not filters:
        return "", args

    for key, val in filters.items():
        if val is None or val == "" or val == "Todos":
            continue
        col_name = allowed_cols.get(key)
        if not col_name:
            continue
        if key in ("search", "q"):
            # Búsqueda general
            search_cols = [c for c in allowed_cols.values() if not c.startswith("CAST")]
            if search_cols:
                sub = " OR ".join(f"{c} LIKE ?" for c in search_cols)
                where.append(f"({sub})")
                args.extend([f"%{val}%"] * len(search_cols))
        elif key in ("contrato", "proveedor", "clave_medicamento", "descripcion"):
            where.append(f"{col_name} LIKE ?")
            args.append(f"%{val}%")
        else:
            where.append(f"{col_name} = ?")
            args.append(val)

    return (" WHERE " + " AND ".join(where)) if where else "", args


def get_summary(filters: dict | None = None) -> dict:
    db_path = get_reconciliation_db()
    if not db_path.exists():
        return {
            "has_data": False,
            "total_filas": 0,
            "monto_inferido_total": 0.0,
            "monto_revision_total": 0.0,
            "total_contratos": 0,
            "contratos_completos": 0,
            "contratos_parciales": 0,
            "contratos_pendientes": 0,
            "filas_duplicadas_excluidas": 0,
            "filas_inferidas": 0,
            "filas_pendientes": 0,
            "partidas_candidatas": 0,
        }

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # Contratos
    c_cols = {
        "institucion": "institucion",
        "proveedor": "proveedor",
        "contrato": "contrato",
        "estado": "estado",
        "search": "contrato",
    }
    w_c, args_c = _build_where(filters, c_cols)

    row_c = conn.execute(
        f"""
        SELECT 
            COUNT(*) as total_contratos,
            SUM(CASE WHEN estado='INFERIDO_COMPLETO' THEN 1 ELSE 0 END) as completos,
            SUM(CASE WHEN estado='PARCIAL_CON_PENDIENTES' THEN 1 ELSE 0 END) as parciales,
            SUM(CASE WHEN estado='PENDIENTE_TOTAL' THEN 1 ELSE 0 END) as pendientes,
            SUM(CASE WHEN monto_inferido != '' THEN CAST(monto_inferido AS REAL) ELSE 0 END) as monto_inferido,
            SUM(CASE WHEN monto_revision != '' THEN CAST(monto_revision AS REAL) ELSE 0 END) as monto_revision
        FROM contratos {w_c}
        """,
        args_c,
    ).fetchone()

    # Filas de Detalle
    d_cols = {
        "institucion": "institucion",
        "proveedor": "proveedor",
        "contrato": "contrato",
        "clave_medicamento": "clave_medicamento",
        "estado": "estado",
        "search": "contrato",
    }
    w_d, args_d = _build_where(filters, d_cols)

    row_d = conn.execute(
        f"""
        SELECT 
            COUNT(*) as total_filas,
            SUM(CASE WHEN estado='DUPLICADO_NO_SUMAR' THEN 1 ELSE 0 END) as duplicadas_excluidas,
            SUM(CASE WHEN estado='INFERIDO_PARTIDA' THEN 1 ELSE 0 END) as inferidas,
            SUM(CASE WHEN estado LIKE 'PENDIENTE%' THEN 1 ELSE 0 END) as pendientes,
            SUM(CASE WHEN monto_computable != '' THEN CAST(monto_computable AS REAL) ELSE 0 END) as computable_filas
        FROM detalle {w_d}
        """,
        args_d,
    ).fetchone()

    # Partidas
    row_p = conn.execute(
        """
        SELECT 
            COUNT(*) as total_partidas,
            SUM(CASE WHEN estado='INFERIDO_PARTIDA' THEN 1 ELSE 0 END) as part_inferidas,
            SUM(CASE WHEN estado='PENDIENTE' THEN 1 ELSE 0 END) as part_pendientes
        FROM partidas
        """
    ).fetchone()

    conn.close()

    resumen_json = RECONCILIATION_DIR / "resumen_v2.json"
    if not resumen_json.exists():
        resumen_json = BASE_DIR.parent / "motor" / "resultados_v2" / "resumen_v2.json"

    meta_info = {}
    if resumen_json.exists():
        try:
            meta_info = json.loads(resumen_json.read_text(encoding="utf-8"))
        except Exception:
            pass

    return {
        "has_data": bool(row_c and row_c["total_contratos"] > 0),
        "total_filas": row_d["total_filas"] if row_d else 0,
        "monto_inferido_total": float(row_c["monto_inferido"] or 0) if row_c else 0.0,
        "monto_revision_total": float(row_c["monto_revision"] or 0) if row_c else 0.0,
        "total_contratos": row_c["total_contratos"] if row_c else 0,
        "contratos_completos": row_c["completos"] if row_c else 0,
        "contratos_parciales": row_c["parciales"] if row_c else 0,
        "contratos_pendientes": row_c["pendientes"] if row_c else 0,
        "filas_duplicadas_excluidas": row_d["duplicadas_excluidas"] if row_d else 0,
        "filas_inferidas": row_d["inferidas"] if row_d else 0,
        "filas_pendientes": row_d["pendientes"] if row_d else 0,
        "partidas_candidatas": row_p["total_partidas"] if row_p else 0,
        "partidas_inferidas": row_p["part_inferidas"] if row_p else 0,
        "partidas_pendientes": row_p["part_pendientes"] if row_p else 0,
        "meta": meta_info,
    }


def get_contracts(
    filters: dict | None = None,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "monto_inferido",
    sort_dir: str = "desc",
) -> dict:
    db_path = get_reconciliation_db()
    if not db_path.exists():
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    allowed_cols = {
        "institucion": "institucion",
        "proveedor": "proveedor",
        "contrato": "contrato",
        "estado": "estado",
        "search": "contrato",
    }
    w, args = _build_where(filters, allowed_cols)

    total = conn.execute(f"SELECT COUNT(*) FROM contratos {w}", args).fetchone()[0]

    valid_sort = {
        "institucion": "institucion",
        "contrato": "contrato",
        "proveedor": "proveedor",
        "filas": "filas",
        "partidas": "partidas",
        "monto_inferido": "CAST(monto_inferido AS REAL)",
        "monto_revision": "CAST(monto_revision AS REAL)",
        "pendientes": "pendientes",
        "estado": "estado",
    }
    s_col = valid_sort.get(sort_by, "CAST(monto_inferido AS REAL)")
    s_dir = "ASC" if sort_dir.lower() == "asc" else "DESC"

    offset = max(0, (page - 1) * page_size)
    query = f"""
        SELECT grupo_contrato, institucion, contrato, proveedor, filas, partidas,
               monto_inferido, monto_revision, pendientes, estado, razon
        FROM contratos {w}
        ORDER BY {s_col} {s_dir}
        LIMIT {page_size} OFFSET {offset}
    """
    rows = [dict(r) for r in conn.execute(query, args).fetchall()]
    conn.close()

    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def get_items(
    filters: dict | None = None,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "monto_inferido",
    sort_dir: str = "desc",
) -> dict:
    db_path = get_reconciliation_db()
    if not db_path.exists():
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    allowed_cols = {
        "clave_medicamento": "clave_medicamento",
        "estado": "estado",
        "grupo_contrato": "grupo_contrato",
        "search": "descripcion",
    }
    w, args = _build_where(filters, allowed_cols)

    total = conn.execute(f"SELECT COUNT(*) FROM partidas {w}", args).fetchone()[0]

    valid_sort = {
        "clave_medicamento": "clave_medicamento",
        "descripcion": "descripcion",
        "filas": "filas",
        "monto_inferido": "CAST(monto_inferido AS REAL)",
        "estado": "estado",
    }
    s_col = valid_sort.get(sort_by, "CAST(monto_inferido AS REAL)")
    s_dir = "ASC" if sort_dir.lower() == "asc" else "DESC"

    offset = max(0, (page - 1) * page_size)
    query = f"""
        SELECT id_partida, grupo_contrato, clave_medicamento, descripcion, filas,
               importes_distintos, monto_inferido, estado, razon, filas_origen
        FROM partidas {w}
        ORDER BY {s_col} {s_dir}
        LIMIT {page_size} OFFSET {offset}
    """
    rows = [dict(r) for r in conn.execute(query, args).fetchall()]
    conn.close()

    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def get_details(
    filters: dict | None = None,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "fila_excel",
    sort_dir: str = "asc",
) -> dict:
    db_path = get_reconciliation_db()
    if not db_path.exists():
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    allowed_cols = {
        "institucion": "institucion",
        "proveedor": "proveedor",
        "contrato": "contrato",
        "clave_medicamento": "clave_medicamento",
        "estado": "estado",
        "search": "contrato",
    }
    w, args = _build_where(filters, allowed_cols)

    total = conn.execute(f"SELECT COUNT(*) FROM detalle {w}", args).fetchone()[0]

    valid_sort = {
        "fila_excel": "fila_excel",
        "contrato": "contrato",
        "proveedor": "proveedor",
        "clave_medicamento": "clave_medicamento",
        "monto_declarado": "CAST(monto_declarado AS REAL)",
        "monto_computable": "CAST(monto_computable AS REAL)",
        "estado": "estado",
    }
    s_col = valid_sort.get(sort_by, "fila_excel")
    s_dir = "ASC" if sort_dir.lower() == "asc" else "DESC"

    offset = max(0, (page - 1) * page_size)
    query = f"""
        SELECT fila_excel, institucion, ur, contrato, proveedor, clave_medicamento, descripcion,
               monto_declarado, cantidad, precio_unitario, subtotal_calculado, evaluacion_iva,
               grupo_contrato, monto_computable, estado, motivo
        FROM detalle {w}
        ORDER BY {s_col} {s_dir}
        LIMIT {page_size} OFFSET {offset}
    """
    rows = [dict(r) for r in conn.execute(query, args).fetchall()]
    conn.close()

    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def get_filter_options() -> dict:
    db_path = get_reconciliation_db()
    if not db_path.exists():
        return {"instituciones": [], "proveedores": [], "estados": []}

    conn = sqlite3.connect(str(db_path))
    insts = [r[0] for r in conn.execute("SELECT DISTINCT institucion FROM contratos WHERE institucion IS NOT NULL AND institucion != '' ORDER BY institucion").fetchall()]
    provs = [r[0] for r in conn.execute("SELECT DISTINCT proveedor FROM contratos WHERE proveedor IS NOT NULL AND proveedor != '' ORDER BY proveedor LIMIT 200").fetchall()]
    estados = ["INFERIDO_COMPLETO", "PARCIAL_CON_PENDIENTES", "PENDIENTE_TOTAL"]
    estados_detalle = ["INFERIDO_PARTIDA", "DUPLICADO_NO_SUMAR", "PENDIENTE", "PENDIENTE_DUPLICADO"]
    conn.close()

    return {
        "instituciones": insts,
        "proveedores": provs,
        "estados": estados,
        "estados_detalle": estados_detalle,
    }


def export_csv(view_type: str = "contratos", filters: dict | None = None) -> io.BytesIO:
    """Genera un archivo CSV con BOM UTF-8 para apertura directa y perfecta en Microsoft Excel."""
    db_path = get_reconciliation_db()
    if not db_path.exists():
        buf = io.BytesIO()
        buf.write("No hay datos disponibles\n".encode("utf-8-sig"))
        buf.seek(0)
        return buf

    conn = sqlite3.connect(str(db_path))
    table = "contratos"
    allowed_cols = {
        "institucion": "institucion",
        "proveedor": "proveedor",
        "contrato": "contrato",
        "estado": "estado",
        "search": "contrato",
    }
    if view_type == "partidas":
        table = "partidas"
        allowed_cols = {
            "clave_medicamento": "clave_medicamento",
            "estado": "estado",
            "search": "descripcion",
        }
    elif view_type == "detalle":
        table = "detalle"
        allowed_cols = {
            "institucion": "institucion",
            "proveedor": "proveedor",
            "contrato": "contrato",
            "clave_medicamento": "clave_medicamento",
            "estado": "estado",
            "search": "contrato",
        }

    w, args = _build_where(filters, allowed_cols)
    cur = conn.execute(f"SELECT * FROM {table} {w}", args)

    buf = io.StringIO()
    writer = csv.writer(buf)
    headers = [d[0] for d in cur.description]
    writer.writerow(headers)
    for row in cur:
        writer.writerow(row)
    conn.close()

    b_buf = io.BytesIO()
    b_buf.write(buf.getvalue().encode("utf-8-sig"))
    b_buf.seek(0)
    return b_buf


def list_available_files() -> list[dict]:
    """Lista los archivos de Excel disponibles en el servidor para conciliar."""
    files = []
    # Buscar en uploads
    if UPLOAD_DIR.exists():
        for p in UPLOAD_DIR.glob("**/*"):
            if p.is_file() and p.suffix.lower() in (".xlsx", ".xlsm"):
                files.append({
                    "id": p.name,
                    "filename": p.name,
                    "path": str(p),
                    "size": p.stat().st_size,
                    "location": "uploads",
                })
    # Buscar en staging
    if STAGING_DIR.exists():
        for p in STAGING_DIR.glob("**/*"):
            if p.is_file() and p.suffix.lower() in (".xlsx", ".xlsm"):
                files.append({
                    "id": p.name,
                    "filename": p.name,
                    "path": str(p),
                    "size": p.stat().st_size,
                    "location": "staging",
                })
    return files
