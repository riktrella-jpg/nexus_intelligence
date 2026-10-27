from decimal import Decimal as D
import pytest
from app.reconciliation import decidir_partida, classify, norm, num, amount


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

    # Filters
    r_f = client.get("/api/reconciliation/filters")
    assert r_f.status_code == 200
    f_data = r_f.json()
    assert "estados" in f_data

    # Export
    r_exp = client.get("/api/reconciliation/export?view_type=contratos")
    assert r_exp.status_code == 200
    assert "text/csv" in r_exp.headers.get("content-type", "")
