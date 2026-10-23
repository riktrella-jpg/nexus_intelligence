import os
from pathlib import Path

import pytest

from conftest import upload_and_commit
import synth

TMP = Path(os.environ["NEXUS_DATA_DIR"])
JAN = synth.make_rows(1, 40, start=1)
EXP = synth.expected(JAN)


def kpi_map(client, ds, filters=None):
    r = client.post(f"/api/datasets/{ds}/kpis", json={"filters": filters}).json()
    return {k["id"]: k for k in r["kpis"]}


@pytest.fixture(scope="module")
def jan_csv(client):
    p = TMP / "enero.csv"
    synth.write_csv(p, JAN)
    res, pv = upload_and_commit(client, p, dataset_name="Contrataciones CSV")
    assert res.status_code == 200, res.text
    return res.json()["dataset_id"], pv


def test_csv_import_and_recognition(client, jan_csv):
    ds, pv = jan_csv
    types = {c["name"]: c["type"] for c in pv["columns"]}
    assert types["Monto contratado"] == "number"
    assert types["Fecha de contrato"] == "date"
    assert types["No. de Contrato"] == "identifier"  # no se convierte a número
    assert types["RFC del proveedor"] == "identifier"
    roles = pv["proposed_mapping"]
    assert roles["Proveedor"] == "provider" and roles["Monto contratado"] == "amount"
    assert roles["Cantidad entregada"] == "quantity_delivered" and roles["Cantidad solicitada"] == "quantity"
    assert roles["Fecha de contrato"] == "date" and roles["No. de Contrato"] == "contract_id"


def test_ambiguous_date_flagged(client, jan_csv):
    _, pv = jan_csv
    # días <= 28: DD/MM y MM/DD ambos válidos en algunos y no en otros; si hay día >12 no es ambiguo
    d = next(c for c in pv["columns"] if c["name"] == "Fecha de contrato")
    assert d["date_format"] == "dmy"


def test_amounts_counts_and_unique(client, jan_csv):
    ds, _ = jan_csv
    k = kpi_map(client, ds)
    assert k["rows"]["value"] == EXP["rows"]
    assert k["contracts"]["value"] == EXP["contracts"]  # conteo único, no filas
    assert k["providers"]["value"] == EXP["providers"]
    assert k["amount_sum"]["value"] == pytest.approx(EXP["amount"], abs=0.01)
    assert EXP["contracts"] < EXP["rows"]


def test_sum_by_provider(client, jan_csv):
    ds, _ = jan_csv
    r = client.post(f"/api/datasets/{ds}/aggregate", json={
        "metric": {"op": "sum", "col": "Monto contratado"}, "group_by": [{"col": "Proveedor"}], "top_n": 50}).json()
    got = {x["keys"][0]: x["value"] for x in r["rows"]}
    for p, v in EXP["by_provider"].items():
        assert got[p] == pytest.approx(v, abs=0.01)
    assert sum(x["share"] for x in r["rows"]) == pytest.approx(1.0)


def test_pending_and_excess(client, jan_csv):
    ds, _ = jan_csv
    k = kpi_map(client, ds)
    assert k["pending"]["value"] == EXP["pending"]
    assert k["excess"]["value"] == EXP["excess"]


def test_filters_recalculate(client, jan_csv):
    ds, _ = jan_csv
    prov = next(iter(EXP["by_provider"]))
    f = {"logic": "AND", "items": [{"col": "Proveedor", "op": "eq", "value": prov},
                                   {"col": "Monto contratado", "op": "gte", "value": 0}]}
    k = kpi_map(client, ds, f)
    rows = [r for r in JAN if r[1] == prov]
    assert k["rows"]["value"] == len(rows)
    assert k["amount_sum"]["value"] == pytest.approx(sum(r[11] for r in rows), abs=0.01)
    assert k["pending"]["value"] == sum(max(r[8] - r[9], 0) for r in rows)
    # OR + rango + fecha
    f2 = {"logic": "OR", "items": [{"col": "Monto contratado", "op": "between", "value": 0, "value2": 1000},
                                   {"col": "Fecha de contrato", "op": "lt", "value": "2026-01-02"}]}
    assert kpi_map(client, ds, f2)["rows"]["value"] == sum(1 for r in JAN if r[11] <= 1000 or r[5][2] < 2)


def test_rows_pagination_and_export(client, jan_csv):
    ds, _ = jan_csv
    r = client.post(f"/api/datasets/{ds}/rows", json={"limit": 10, "offset": 5, "sort": "Monto contratado", "desc": True}).json()
    assert r["total"] == EXP["rows"] and len(r["rows"]) == 10
    amounts = [x["Monto contratado"] for x in r["rows"]]
    assert amounts == sorted(amounts, reverse=True)
    exp = client.post(f"/api/datasets/{ds}/export.csv", json={})
    assert exp.status_code == 200
    assert len(exp.text.strip().splitlines()) == EXP["rows"] + 1  # todas las filas, no solo las visibles


def test_query_security(client, jan_csv):
    ds, _ = jan_csv
    bad = client.post(f"/api/datasets/{ds}/aggregate", json={"metric": {"op": "sum", "col": 'x"; DROP TABLE d; --'}})
    assert bad.status_code == 400
    bad = client.post(f"/api/datasets/{ds}/rows", json={"filters": {"col": "Proveedor", "op": "eq; DROP", "value": "x"}})
    assert bad.status_code == 400
    # valor malicioso queda parametrizado
    ok = client.post(f"/api/datasets/{ds}/rows", json={"filters": {"col": "Proveedor", "op": "eq", "value": "' OR 1=1 --"}}).json()
    assert ok["total"] == 0
    # suma sobre texto no permitida
    assert client.post(f"/api/datasets/{ds}/aggregate", json={"metric": {"op": "sum", "col": "Proveedor"}}).status_code == 400


def test_xlsx_import_matches_csv(client):
    p = TMP / "enero.xlsx"
    synth.write_xlsx(p, JAN)
    res, _ = upload_and_commit(client, p, dataset_name="Contrataciones XLSX")
    assert res.status_code == 200, res.text
    k = kpi_map(client, res.json()["dataset_id"])
    assert k["amount_sum"]["value"] == pytest.approx(EXP["amount"], abs=0.01)
    assert k["contracts"]["value"] == EXP["contracts"]


def test_invalid_files(client):
    assert client.post("/api/uploads", files={"file": ("x.csv", b"")}).status_code == 400
    assert client.post("/api/uploads", files={"file": ("x.exe", b"abc")}).status_code == 400
    assert client.post("/api/uploads", files={"file": ("x.xlsx", b"no es excel")}).status_code == 400
    up = client.post("/api/uploads", files={"file": ("solo_encabezado.csv", "a,b,c\n".encode())}).json()
    pv = client.get(f"/api/uploads/{up['upload_id']}/preview")
    assert pv.status_code == 400


def test_monthly_append_no_duplicates(client, jan_csv):
    ds, _ = jan_csv
    # 1) mismo archivo de enero en XLSX (otro formato): ninguna fila nueva
    p = TMP / "enero_otra_vez.xlsx"
    synth.write_xlsx(p, JAN)
    res, _ = upload_and_commit(client, p, dataset_id=ds, mode="append", period="2026-01")
    r = res.json()
    assert r["rows_added"] == 0 and r["rows_skipped_duplicates"] == EXP["rows"]
    assert r["total_rows"] == EXP["rows"]
    # 2) febrero con traslape de contratos/partidas
    feb = synth.make_rows(2, 40, start=31)
    p2 = TMP / "febrero.xlsx"
    synth.write_xlsx(p2, feb)
    res, pv = upload_and_commit(client, p2, dataset_id=ds, mode="append", period="2026-02")
    assert res.status_code == 200, res.text
    r = res.json()
    assert r["rows_added"] + r["rows_skipped_duplicates"] == len(feb)
    assert r["total_rows"] == EXP["rows"] + r["rows_added"]
    # comparativo por periodo
    agg = client.post(f"/api/datasets/{ds}/aggregate", json={"metric": {"op": "count"}, "group_by": [{"col": "_period"}], "top_n": 10}).json()
    by = {x["keys"][0]: x["value"] for x in agg["rows"]}
    assert by["2026-01"] == EXP["rows"] and by["2026-02"] == r["rows_added"]


def test_schema_diff_new_and_renamed_columns(client, jan_csv):
    ds, _ = jan_csv
    headers = list(synth.HEADERS)
    headers[1] = "Nombre del proveedor"  # renombrada
    headers.append("Observaciones")
    rows = [r + ["ok"] for r in synth.make_rows(3, 5, start=500)]
    p = TMP / "marzo.xlsx"
    synth.write_xlsx(p, rows, headers=headers)
    res, pv = upload_and_commit(client, p, dataset_id=ds, mode="append", period="2026-03")
    diff = pv["schema_diff"]
    assert "Observaciones" in diff["new"] and "Proveedor" in diff["missing"]
    assert any(x["from"] == "Proveedor" and x["to"] == "Nombre del proveedor" for x in diff["possibly_renamed"])
    assert res.status_code == 200
    info = client.get(f"/api/datasets/{ds}").json()
    assert {"Observaciones", "Nombre del proveedor"} <= {c["name"] for c in info["columns"]}


def test_replace_requires_authorization(client):
    p = TMP / "r.csv"
    synth.write_csv(p, JAN[:5])
    res, _ = upload_and_commit(client, p, dataset_name="Reemplazo")
    ds = res.json()["dataset_id"]
    res, _ = upload_and_commit(client, p, dataset_id=ds, mode="replace_period", period="2026-01")
    assert res.status_code == 400
    res, _ = upload_and_commit(client, p, dataset_id=ds, mode="replace_period", period="2026-01", confirm_replace=True)
    assert res.status_code == 200 and res.json()["total_rows"] == 5
    # update sin llave se rechaza
    res, _ = upload_and_commit(client, p, dataset_id=ds, mode="update", period="2026-01")
    assert res.status_code == 400


def test_nulls_and_quality(client):
    rows = [list(r) for r in JAN[:10]]
    rows[0][11] = None            # monto vacío
    rows[1][5] = (2026, 1, 1)
    rows[2][2] = "RFC-MALO"       # RFC inválido
    rows[3][8] = -5               # cantidad negativa
    rows[4] = list(rows[5])       # duplicado exacto
    p = TMP / "calidad.csv"
    synth.write_csv(p, rows)
    res, _ = upload_and_commit(client, p, dataset_name="Calidad")
    ds = res.json()["dataset_id"]
    q = client.get(f"/api/datasets/{ds}/quality").json()
    txt = " | ".join(i["issue"] for i in q["issues"])
    assert "campo crítico vacío" in txt and "RFC con formato inválido" in txt and "valor negativo" in txt
    assert q["exact_duplicates"] >= 1 and q["with_issues"] >= 4
    assert client.get(f"/api/datasets/{ds}/quality/review.csv").status_code == 200
    k = kpi_map(client, ds)
    assert k["amount_sum"]["value"] is not None  # los nulos no rompen la suma


def test_missing_columns_dataset_has_no_unavailable_kpis(client):
    p = TMP / "simple.csv"
    p.write_text("Ciudad,Ventas\nA,10\nB,20\nA,5\n", encoding="utf-8")
    res, pv = upload_and_commit(client, p, dataset_name="Genérico", mapping={})
    ds = res.json()["dataset_id"]
    ids = {k["id"] for k in client.get(f"/api/datasets/{ds}/suggested-kpis").json()}
    assert ids == {"rows"}
    r = client.post(f"/api/datasets/{ds}/aggregate", json={"metric": {"op": "sum", "col": "Ventas"}, "group_by": [{"col": "Ciudad"}]}).json()
    assert {x["keys"][0]: x["value"] for x in r["rows"]} == {"A": 15, "B": 20}


def test_ids_not_numeric_and_money_formats(client):
    p = TMP / "ids.csv"
    p.write_text("RFC,Folio,Monto\nABC010101AA1,00123,\"$1,234.50\"\nDEF020202BB2,00456,\"(500.25)\"\n", encoding="utf-8")
    res, pv = upload_and_commit(client, p, dataset_name="Ids", mapping={})
    ds = res.json()["dataset_id"]
    rows = client.post(f"/api/datasets/{ds}/rows", json={"sort": "Folio"}).json()["rows"]
    assert rows[0]["Folio"] == "00123"  # ceros a la izquierda conservados
    assert rows[0]["Monto"] == 1234.5 and rows[1]["Monto"] == -500.25


def test_ambiguous_decimal_comma_requires_confirmation(client):
    p = TMP / "coma.csv"
    p.write_text("Concepto;Importe\nA;1.234,50\nB;2,5\n", encoding="utf-8")
    res, pv = upload_and_commit(client, p, dataset_name="Coma", mapping={})
    c = next(c for c in pv["columns"] if c["name"] == "Importe")
    assert c["type"] != "number" and c["ambiguous"]


def test_saved_views_persist(client, jan_csv):
    ds, _ = jan_csv
    v = client.post(f"/api/datasets/{ds}/views", json={"name": "Mi consulta", "kind": "filters",
                                                        "payload": {"filters": {"logic": "AND", "items": []}}}).json()
    got = client.get(f"/api/datasets/{ds}/views").json()
    assert any(x["id"] == v["id"] and x["payload"]["filters"]["logic"] == "AND" for x in got)
    client.delete(f"/api/views/{v['id']}")
    assert not any(x["id"] == v["id"] for x in client.get(f"/api/datasets/{ds}/views").json())


def test_mapping_conflict_rejected(client, jan_csv):
    ds, _ = jan_csv
    r = client.put(f"/api/datasets/{ds}/mapping", json={"mapping": {"Monto contratado": "amount", "Precio unitario": "amount"}})
    assert r.status_code == 400
    # restaurar
    ok = client.put(f"/api/datasets/{ds}/mapping", json={"mapping": {"Monto contratado": "amount", "Proveedor": "provider"}})
    assert ok.status_code == 200


def test_pivot_totals(client, jan_csv):
    ds, _ = jan_csv
    r = client.post(f"/api/datasets/{ds}/pivot", json={"metric": {"op": "sum", "col": "Monto contratado"},
                                                       "rows": [{"col": "Proveedor"}], "cols": [{"col": "Institución"}]}).json()
    assert r["grand_total"] == pytest.approx(sum(c["value"] for c in r["cells"]), abs=0.01)
    assert r["grand_total"] == pytest.approx(sum(x["value"] for x in r["row_totals"]), abs=0.01)
