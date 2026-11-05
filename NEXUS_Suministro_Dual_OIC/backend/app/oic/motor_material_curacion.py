"""Acceso directo al motor de Material de Curación.
La base de 17 reglas AE:AU es compartida con Medicamentos,
con controles adicionales específicos para material de curación.
"""
from .motor_suministro import review_file as _review_file


def revisar_material_curacion(archivo_entrada, archivo_salida, fecha_corte, **opciones):
    return _review_file(archivo_entrada, archivo_salida, fecha_corte,
                        modo='material_curacion', **opciones)
