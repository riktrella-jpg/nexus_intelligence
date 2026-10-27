# Nexus Intelligence · Motor híbrido v2

## Qué cambia
Ya no exige soporte documental. Aplica reglas reproducibles a las columnas del XLSX: institución, unidad responsable, contrato, proveedor, clave de medicamento, importe (P), cantidad contratada (AJ) y precio unitario (AK).

1. Identifica contrato mediante institución + unidad responsable + número de contrato + proveedor.
2. Agrupa por clave de medicamento. Si falta, utiliza descripción.
3. Deduplica repeticiones con misma clave, monto, cantidad y precio; **solo la primera fila aporta al total**.
4. Si una misma clave presenta diferentes combinaciones de monto, cantidad y precio, considera cada combinación candidata a partida independiente si el cálculo concilia.
5. Si el monto coincide con cantidad × precio o con 1.16 × esa cantidad, lo reconoce como **inferido aritmético**. Esto no significa que el IVA legal sea 16 %.
6. Si el monto no concilia, no lo suma: lo marca pendiente. La duplicación de importes en claves distintas no implica por sí sola repetición del monto total contractual.
7. Guarda trazabilidad por fila de Excel y genera bases SQL + CSV para filtros y reportes.

## Ejecutar en Windows
Con Python 3.10+ y en esta carpeta:

```powershell
py -3 motor_nexus_v2.py "C:\ruta\Layout_Suministro_Septiembre(2).xlsx" --salida resultados_v2
py -3 -m unittest -v test_motor_v2
pip install streamlit
streamlit run dashboard_v2.py
```

No hay dependencias de terceros para ejecutar el motor principal. `dashboard_v2.py` utiliza Streamlit. SQLite está incluido en Python.

## Archivos
- `resultados_v2/nexus_v2.sqlite`: tablas `detalle`, `partidas` y `contratos`.
- `resultados_v2/detalle_montos_v2.csv`: 1 registro por fila original, con monto computable 0 en duplicados comprobados por firma.
- `resultados_v2/partidas_unicas_v2.csv`: candidatas únicas de partidas y filas fuente.
- `resultados_v2/resumen_contratos_v2.csv`: importes inferidos y pendientes por contrato.
- `resultados_v2/resumen_v2.json`: métricas de ejecución.
- `consultas_nexus_v2.sql`: consultas SQL reutilizables.

## Interpretación responsable
`INFERIDO_COMPLETO` significa todas las firmas del contrato conciliadas numéricamente; NO valida legalmente los importes ni que el contrato solo tenga las partidas declaradas. `PARCIAL_CON_PENDIENTES` muestra únicamente el subtotal inferido, no el total contractual. `PENDIENTE_TOTAL` no participa del total inferido. Un importe repetido en dos medicamentos distintos solo se suma dos veces si **cada medicamento** cuadra con sus cantidades y precios; esto preserva partidas de idéntico importe.

Límite: dos partidas verdaderamente distintas con la misma clave, importe, cantidad y precio son indistinguibles con estos datos y serán tratadas como repetidas. También puede existir un total contractual global que casualmente concilie con una partida. Los resultados deben denominarse *montos inferidos según reglas de columnas*, no *montos acreditados*.
