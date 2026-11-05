"""Acceso directo al motor revisado de Medicamentos v2.0.
No cambia la API ni el motor de medicamentos antiguo: puede coexistir.
"""
from .motor_suministro import review_file as _review_file


def revisar_medicamentos(archivo_entrada, archivo_salida, fecha_corte, **opciones):
    return _review_file(archivo_entrada, archivo_salida, fecha_corte,
                        modo='medicamentos', **opciones)
