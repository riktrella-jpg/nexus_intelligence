"""Pruebas del análisis cruzado (crosstab) multi-columna y multi-indicador."""


def _seed(client):
    res = client.post("/api/demo/seed")
    assert res.status_code == 200, res.text
    ds = client.get(f"/api/datasets/{res.json()['dataset_id']}").json()
    return ds


def _cols(ds, kind):
    return [c["name"] for c in ds["columns"] if c["type"] == kind]


def test_crosstab_totals_reconcile(client):
    ds = _seed(client)
    cats = _cols(ds, "category") + _cols(ds, "text")
    nums = _cols(ds, "number")
    assert len(cats) >= 2
    metrics = [{"op": "count"}] + ([{"op": "sum", "col": nums[0]}] if nums else [])
    body = {"metrics": metrics, "rows": [{"col": cats[0]}], "col": {"col": cats[1]}, "top_rows": 1000, "top_cols": 3}
    r = client.post(f"/api/datasets/{ds['id']}/crosstab", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["grand"]["rows"] == ds["row_count"]
    # la suma de filas = total general (sin truncar filas)
    assert sum(x["rows"] for x in d["rows"]) == d["grand"]["rows"]
    # celdas + «Otros» = total de cada fila (conteo)
    for i, row in enumerate(d["rows"]):
        cell_n = sum(c["rows"] for c in d["cells"] if c["r"] == i)
        oth_n = sum(o["rows"] for o in d["others"] if o["r"] == i)
        assert cell_n + oth_n == row["rows"]
        assert row["values"][0] == row["rows"]
    assert len(d["cols"]) <= 3


def test_crosstab_multi_rows_and_filters(client):
    ds = _seed(client)
    cats = _cols(ds, "category") + _cols(ds, "text")
    body = {"metrics": [{"op": "count"}], "rows": [{"col": cats[0]}, {"col": cats[1]}], "top_rows": 5,
            "filters": {"logic": "AND", "items": [{"col": cats[0], "op": "notnull"}]}}
    d = client.post(f"/api/datasets/{ds['id']}/crosstab", json=body).json()
    assert len(d["rows"]) <= 5
    assert all(len(r["keys"]) == 2 for r in d["rows"])
    assert d["col_dim"] is None and d["cells"] == []
    vals = [r["values"][0] for r in d["rows"]]
    assert vals == sorted(vals, reverse=True)


def test_crosstab_rejects_unknown_column(client):
    ds = _seed(client)
    r = client.post(f"/api/datasets/{ds['id']}/crosstab", json={"metrics": [{"op": "count"}], "rows": [{"col": "no_existe"}]})
    assert r.status_code == 400


def test_crosstab_supports_eight_or_more_metrics(client):
    ds = _seed(client)
    cats = _cols(ds, "category") + _cols(ds, "text")
    nums = _cols(ds, "number")
    # Construir 8 indicadores simultáneos
    metrics = [
        {"op": "count"},
        {"op": "count_distinct", "col": cats[0]},
        {"op": "count_distinct", "col": cats[1] if len(cats) > 1 else cats[0]},
    ]
    for n in (nums * 3)[:5]:
        metrics.append({"op": "sum", "col": n})
    assert len(metrics) == 8
    body = {"metrics": metrics, "rows": [{"col": cats[0]}], "top_rows": 20}
    r = client.post(f"/api/datasets/{ds['id']}/crosstab", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["metrics"]) == 8
    assert len(d["grand"]["values"]) == 8
    if d["rows"]:
        assert len(d["rows"][0]["values"]) == 8
