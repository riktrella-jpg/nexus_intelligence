"""Pruebas funcionales de los Módulos III y IV (Riesgos, NEXUS AI, Reportes y Seed)."""
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_seed_demo_and_analytics():
    # 1. Probar carga de datos semilla
    res = client.post("/api/demo/seed")
    assert res.status_code == 200, res.text
    data = res.json()
    dataset_id = data["dataset_id"]
    assert dataset_id is not None
    assert data["total_rows"] > 0


    # 2. Probar endpoint de riesgos
    r_res = client.post(f"/api/datasets/{dataset_id}/risks", json={})
    assert r_res.status_code == 200, r_res.text
    r_data = r_res.json()
    assert "overall_severity" in r_data
    assert "concentration" in r_data
    assert "hhi_score" in r_data["concentration"]
    assert len(r_data["findings"]) > 0

    # 3. Probar endpoint de NEXUS AI (consultas conversacionales)
    ai_queries = [
        "¿Cuáles son los principales proveedores?",
        "¿Hay concentración de compras y riesgos?",
        "¿Cuál es el estatus de las entregas pendientes?",
        "¿Cuáles son los productos con mayor dispersión de precios?",
        "Dame un resumen general"
    ]
    for q in ai_queries:
        ai_res = client.post(f"/api/datasets/{dataset_id}/ai/query", json={"query": q})
        assert ai_res.status_code == 200, ai_res.text
        ai_data = ai_res.json()
        assert "answer" in ai_data
        assert "cards" in ai_data

    # 4. Probar endpoint de generador de reportes ejecutivos
    rep_res = client.post(f"/api/datasets/{dataset_id}/reports/generate", json={"type": "executive"})
    assert rep_res.status_code == 200, rep_res.text
    rep_data = rep_res.json()
    assert "metadata" in rep_data
    assert "kpis" in rep_data
    assert "narrative" in rep_data
    assert len(rep_data["kpis"]) >= 4
