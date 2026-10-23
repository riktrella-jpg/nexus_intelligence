"""Datos SINTÉTICOS de prueba (no son datos reales). Generados con semilla fija para que las pruebas sean reproducibles."""
from __future__ import annotations

import random
from pathlib import Path

PROVIDERS = [
    ("Distribuidora Médica del Norte SA de CV", "DMN010101AB1"),
    ("Laboratorios Aurora SA de CV", "LAU020202CD2"),
    ("Suministros Hospitalarios Centro SA", "SHC030303EF3"),
    ("Farmacéutica Sierra SA de CV", "FSI040404GH4"),
    ("Insumos Clínicos del Pacífico SC", "ICP050505IJ5"),
]
INSTITUTIONS = ["Hospital General Zona 1", "Hospital Regional Sur", "Unidad Médica Norte"]
PROCEDURES = ["Licitación Pública", "Invitación a cuando menos tres", "Adjudicación Directa"]
GOODS = ["Paracetamol 500 mg", "Jeringa 5 ml", "Guante de nitrilo", "Solución salina 1000 ml", "Gasa estéril", "Omeprazol 20 mg"]
HEADERS = ["No. de Contrato", "Proveedor", "RFC del proveedor", "Institución", "Tipo de procedimiento", "Fecha de contrato",
           "Descripción del bien", "Unidad de medida", "Cantidad solicitada", "Cantidad entregada", "Precio unitario",
           "Monto contratado", "Estatus"]


def make_rows(month: int, n_contracts: int = 40, seed: int = 7, year: int = 2026, start: int = 1):
    """Devuelve (rows, expected) donde rows son listas de valores nativos y expected las cifras verdaderas."""
    rnd = random.Random(seed + month)
    rows = []
    for i in range(n_contracts):
        prov, rfc = PROVIDERS[rnd.randrange(len(PROVIDERS))]
        inst = INSTITUTIONS[rnd.randrange(len(INSTITUTIONS))]
        proc = PROCEDURES[rnd.randrange(len(PROCEDURES))]
        contract = f"CT-{year}-{start + i:04d}"
        day = rnd.randint(1, 28)
        for _ in range(rnd.randint(1, 3)):  # varias partidas por contrato
            good = GOODS[rnd.randrange(len(GOODS))]
            qty = rnd.randint(10, 500) * 10
            delivered = rnd.choice([qty, qty, round(qty * rnd.uniform(0.2, 0.95)), qty + rnd.randint(1, 30)])
            price = round(rnd.uniform(5, 400), 2)
            amount = round(qty * price, 2)
            rows.append([contract, prov, rfc, inst, proc, (year, month, day), good, "Pieza", qty, delivered, price, amount,
                         rnd.choice(["Vigente", "Concluido", "En proceso"])])
    return rows


def fmt_date(t):
    return f"{t[2]:02d}/{t[1]:02d}/{t[0]}"


def write_csv(path: Path, rows, headers=HEADERS, money_format=True):
    import csv
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for r in rows:
            r = list(r)
            r[5] = fmt_date(r[5])
            if money_format:
                r[10] = f"${r[10]:,.2f}" if r[10] is not None else ""
                r[11] = f"${r[11]:,.2f}" if r[11] is not None else ""
            w.writerow(r)


def write_xlsx(path: Path, rows, headers=HEADERS, sheet="Contratos"):
    import datetime as dt
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(headers)
    for r in rows:
        r = list(r)
        r[5] = dt.datetime(*r[5])
        ws.append(r)
    wb.save(path)


def expected(rows) -> dict:
    prov: dict[str, float] = {}
    for r in rows:
        prov[r[1]] = prov.get(r[1], 0) + r[11]
    return {
        "rows": len(rows),
        "contracts": len({r[0] for r in rows}),
        "providers": len({r[1] for r in rows}),
        "amount": round(sum(r[11] for r in rows), 2),
        "by_provider": {k: round(v, 2) for k, v in prov.items()},
        "pending": sum(max(r[8] - r[9], 0) for r in rows),
        "excess": sum(max(r[9] - r[8], 0) for r in rows),
    }


if __name__ == "__main__":
    out = Path(__file__).parent / "data"
    out.mkdir(exist_ok=True)
    jan = make_rows(1, 40, start=1)
    feb = make_rows(2, 40, start=31)  # contratos 31.. (traslape con enero 31-40 de enero)
    write_csv(out / "SINTETICO_contrataciones_enero.csv", jan)
    write_xlsx(out / "SINTETICO_contrataciones_enero.xlsx", jan)
    write_xlsx(out / "SINTETICO_contrataciones_febrero.xlsx", feb, headers=HEADERS + ["Observaciones"][:0])
    print("Archivos sintéticos generados en", out)
