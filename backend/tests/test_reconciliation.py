from decimal import Decimal as D
from pathlib import Path
import pytest
from app.reconciliation import (
    decidir_partida,
    classify,
    norm,
    num,
    amount,
    calcular_registros,
    leer_hoja_nexus,
    normalizar,
)


def test_reconciliation_decidir_partida():
    def rec(partida, monto, subtotal, iva="COINCIDE_DIRECTO", qty="1", precio="100"):
        return {
            "partida": partida,
            "monto": D(monto),
            "subtotal": D(subtotal),
            "cantidad": D(qty),
            "precio": D(precio),
            "iva": iva,
            "row": {"fila_excel": 1, "institucion": "IMSS", "ur": "U1", "contrato": "C1", "proveedor": "P1", "clave": "K1", "descripcion": "D1"},
        }

    # 1. Deduplicación exacta: 3 filas idénticas -> 1 candidata con monto 100
    a = rec("k1", "100", "100")
    cands = decidir_partida([a, a, a])
    assert len(cands) == 1
    assert cands[0][1] == D(100)
    assert len(cands[0][0]) == 3

    # 2. Dos montos distintos para la misma clave respaldados por cantidad/precio
    cand_dist = decidir_partida([rec("k1", "100", "100"), rec("k1", "200", "200", qty="2")])
    assert sum(t[1] for t in cand_dist) == D(300)

    # 3. Compatible con IVA 16% aritmético
    iva_cand = decidir_partida([rec("k1", "116", "100", "COMPATIBLE_IVA_16_NO_CONFIRMADO")])
    assert iva_cand[0][1] == D(116)

    # 4. No conciliado -> queda pendiente (monto None)
    mismatch = decidir_partida([rec("k1", "400", "100", "NO_CONCILIADO")])
    assert mismatch[0][1] is None
    assert mismatch[0][2] == "PENDIENTE"


def test_motor_nexus_pedido_repetido_no_duplica():
    base = {"D": "HGMEL", "H": "CONTRATO-X", "K": "PROVEEDOR", "AC": "123", "AD": "PRODUCTO X", "AJ": "10", "AK": "50", "P": "580"}
    detalle, contratos, ind = calcular_registros([(3, base), (4, {**base, "AO": "PEDIDO 2"})])
    assert ind["monto_estimado_sin_iva"] == "500.00"
    assert detalle[1]["estado"] == "REPETIDO MISMA PARTIDA"
    assert detalle[0]["estado"] == "PARTIDA CONTABILIZADA"
    assert contratos[0]["monto_estimado_sin_iva"] == "500.00"


def test_motor_nexus_precios_iguales_presentaciones_distintas():
    b = {"D": "HGMEL", "H": "CONTRATO-X", "K": "PROVEEDOR", "AC": "Sin clave del CNIS", "AJ": "5", "AK": "1800", "P": "10440"}
    detalle, c, i = calcular_registros([(3, {**b, "AD": "CANULA NUM 2.5"}), (4, {**b, "AD": "CANULA NUM 5"})])
    assert i["monto_estimado_sin_iva"] == "18000.00"
    assert c[0]["estado_validacion"] == "REQUIERE REVISION"
    assert "POSIBLE IMPORTE GLOBAL REPETIDO ENTRE PARTIDAS" in c[0]["alertas"]
    assert len(detalle) == 2
    assert detalle[0]["estado"] == "PARTIDA CONTABILIZADA"
    assert detalle[1]["estado"] == "PARTIDA CONTABILIZADA"


def test_motor_nexus_los_cuatro_casos_reales():
    candidates = [
        Path(__file__).resolve().parent.parent.parent / "nexus" / "Layout_Suministro_Septiembre  (monto contratados).xlsx",
        Path("C:/Users/ricardo.escamilla/Downloads/Layout_Suministro_Septiembre  (monto contratados).xlsx"),
    ]
    target_file = next((p for p in candidates if p.exists()), None)
    if not target_file:
        pytest.skip("Layout_Suministro_Septiembre  (monto contratados).xlsx no encontrado para prueba de integración real.")

    ids = ["HGMEL-LPI-034-2026", "HGMEL-LPI-226-2026", "HGMEL-LPI-234-2026", "HGMEL-LPI-237-2026"]
    datos = ((n, d) for n, d in leer_hoja_nexus(target_file, "BASE") if n > 2 and normalizar(d.get("H")) in ids)
    _, cs, _ = calcular_registros(datos)
    encontrados = {x["contrato"]: D(x["monto_estimado_sin_iva"]) for x in cs}
    esperado = {
        "HGMEL-LPI-034-2026": "38242072.00",
        "HGMEL-LPI-226-2026": "15696.00",
        "HGMEL-LPI-234-2026": "51000.00",
        "HGMEL-LPI-237-2026": "88199.92",
    }
    for k, v in esperado.items():
        assert encontrados[k] == D(v)


def test_reconciliation_api_endpoints(client):
    # Summary
    r = client.get("/api/reconciliation/summary")
    assert r.status_code == 200
    data = r.json()
    assert "has_data" in data
    assert "monto_inferido_total" in data

    # Contracts
    r_c = client.get("/api/reconciliation/contracts?page=1&page_size=10")
    assert r_c.status_code == 200
    c_data = r_c.json()
    assert "items" in c_data
    assert "total" in c_data

    # Details
    r_d = client.get("/api/reconciliation/details?page=1&page_size=10")
    assert r_d.status_code == 200
    d_data = r_d.json()
    assert "items" in d_data
    assert "total" in d_data

    # Pendientes
    r_p = client.get("/api/reconciliation/pendientes?page=1&page_size=10")
    assert r_p.status_code == 200
    p_data = r_p.json()
    assert "items" in p_data
    assert "total" in p_data

    # Filters
    r_f = client.get("/api/reconciliation/filters")
    assert r_f.status_code == 200
    f_data = r_f.json()
    assert "estados" in f_data

    # Export
    r_exp = client.get("/api/reconciliation/export?view_type=contratos")
    assert r_exp.status_code == 200
    assert "text/csv" in r_exp.headers.get("content-type", "")

    # Export Pendientes
    r_exp_p = client.get("/api/reconciliation/export?view_type=pendientes")
    assert r_exp_p.status_code == 200
    assert "text/csv" in r_exp_p.headers.get("content-type", "")
