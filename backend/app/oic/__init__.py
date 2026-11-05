# -*- coding: utf-8 -*-
"""Paquete de Control de Calidad Institucional OIC para NEXUS Intelligence.

Submódulos:
- Rescisiones (activo): `revisor_oic`, `revisor_rescisiones_portable`, `motor_validaciones_ampliado`
- Medicamentos (preparado, independiente): `motor_medicamentos`
- Infraestructura común OOXML / espejo Excel: `ooxml_rescision`, `generar_hoja_oic`, `verificar_excel`
"""
from pathlib import Path
import sys

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
