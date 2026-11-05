# -*- coding: utf-8 -*-
"""Arquitectura base preparada para el submódulo CONTROL DE CALIDAD OIC -> MEDICAMENTOS.

IMPORTANTE:
Este motor es completamente independiente del motor de RESCISIONES (`revisor_rescisiones_portable.py`
y `motor_validaciones_ampliado.py`). Comparte únicamente la infraestructura de lectura OOXML sin pérdida
(`ooxml_rescision.py`) y de generación de hoja espejo (`generar_hoja_oic.py` / `verificar_excel.py`),
manteniendo separados sus diccionarios, alias de columnas y reglas de auditoría.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class MedicamentoFinding:
    sheet: str
    row: int
    cell: str
    contract: str
    severity: str
    rule: str
    field: str
    detail: str
    action: str
    related: tuple[str, ...] = ()


ALIASES_MEDICAMENTOS: dict[str, list[str]] = {
    "clave": ["clave", "clave_cnis", "clave_medicamento", "cbm", "insumo"],
    "descripcion": ["descripcion", "descripcion_bien", "medicamento", "denominacion_generica"],
    "contrato": ["numero_contrato", "contrato", "no_contrato"],
    "proveedor": ["proveedor", "razon_social", "adjudicado"],
    "cantidad_minima": ["cantidad_minima", "minimo_contratado", "piezas_minimas"],
    "cantidad_maxima": ["cantidad_maxima", "maximo_contratado", "piezas_maximas"],
    "cantidad_entregada": ["cantidad_entregada", "piezas_entregadas", "surtido"],
    "precio_unitario": ["precio_unitario", "precio_adjudicado", "costo_unitario"],
    "monto_maximo": ["monto_maximo", "importe_maximo", "monto_contratado"],
    "registro_sanitario": ["registro_sanitario", "cofepris", "no_registro_sanitario"],
    "caducidad": ["fecha_caducidad", "caducidad", "vigencia_lote"],
}


class AuditorMedicamentos:
    """Esqueleto de auditoría independiente para el futuro módulo de Medicamentos OIC."""

    def __init__(self, cutoff: dt.date):
        self.cutoff = cutoff
        self.findings: list[MedicamentoFinding] = []

    def estado_modulo(self) -> dict[str, Any]:
        return {
            "modulo": "MEDICAMENTOS",
            "estado": "ARQUITECTURA_PREPARADA",
            "independiente_de_rescisiones": True,
            "infraestructura_compartida": [
                "ooxml_rescision.py (lectura XML nativa sin alterar el archivo original)",
                "generar_hoja_oic.py (hoja espejo REVISION OIC con columnas Inconsistencia_n y resaltado #FFFF00)",
                "verificar_excel.py (comprobación byte por byte de hojas originales y autofiltros)",
            ],
            "campos_previstos": list(ALIASES_MEDICAMENTOS.keys()),
            "fecha_corte_referencia": str(self.cutoff),
        }
