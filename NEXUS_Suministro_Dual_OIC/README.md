# NEXUS / OIC Salud — Motor dual de suministro v2.0

**MEDICAMENTOS + MATERIAL DE CURACIÓN**, sobre el mismo layout institucional A:AD. El archivo **Layout_Suministro.xlsx es una base de captura real sin fórmulas**, no un archivo de reglas. Las 17 reglas AE–AU se convirtieron desde la plantilla *Herramienta_Revision_Layout_Suministro_FINAL_OK(1).xlsx* en código Python, sin depender del recálculo de Excel.

## Qué se entrega

```text
NEXUS_Suministro_Dual_OIC/
├── backend/app/oic/
│   ├── motor_suministro.py          ← motor COMPLETO de ambas categorías: AE–AU + extras
│   ├── motor_medicamentos_nuevo.py ← acceso específico al rubro Medicamentos
│   ├── motor_material_curacion.py  ← acceso específico al rubro Material de Curación
│   ├── ooxml_suministro.py          ← exportación en amarillo, filas originales intactas
│   ├── catalogo_cnis.json.gz       ← catálogo de la plantilla (NO verificación oficial)
│   ├── api_suministro.py            ← API HTTP de Nexus (FastAPI)
│   ├── cli_suministro.py            ← ejecución opcional por consola
│   └── __init__.py                ← solo si no existe (no sustituir)
├── frontend/components/
│   └── SuministroRevision.jsx       ← pantalla React con selector ambos / medicamentos / curación
├── tests/
│   ├── casos_control_dual.xlsx      ← casos sintéticos; no institucionales
│   ├── resultado_casos_control_dual.xlsx
│   ├── test_suministro_dual.py
│   ├── resumen_prueba_real.json     ← cifras de análisis del ejemplo real
│   └── resultado_casos_control_dual.json
├── docs/
│   ├── INTEGRACION_ANTIGRAVITY.md
│   ├── REGLAS_Y_CRITERIOS.md
│   └── PROMPT_PARA_ANTIGRAVITY.md
└── requirements_modulo.txt
```

Se han dejado fuera los archivos de la versión anterior de Medicamentos **para no sobrescribir** inadvertidamente el motor antiguo de Nexus. El sistema dual es independiente del motor de Rescisiones.

## Instalación en Antigravity/Nexus

1. Descomprime el ZIP **fuera** de Nexus y copia el contenido de `backend/app/oic/` en la misma ruta dentro del proyecto existente. Si ya existe `__init__.py` con contenido, consérvalo. Añade los archivos nuevos sin sustituir código de Rescisiones ni los archivos `motor_medicamentos.py`/`api_medicamentos.py` anteriores.
2. Copia `frontend/components/SuministroRevision.jsx` a `frontend/components/` de Nexus.
3. En el archivo que ya crea `app = FastAPI()` incluye:

   ```python
   from app.oic.api_suministro import router_suministro
   app.include_router(router_suministro)
   ```

4. Dentro de la ruta React que hoy contiene la pantalla provisional de medicamentos, importa e incorpora:

   ```jsx
   import SuministroRevision from './components/SuministroRevision';
   // Dentro del JSX de la ruta existente:
   <SuministroRevision />
   ```

   **Ajusta la ruta relativa del import** de acuerdo con la ubicación de tu archivo React. Conserva el encabezado y las rutas actuales. Si backend y frontend están en puertos distintos y no existe proxy, usa `<SuministroRevision apiBase="http://localhost:8000" />` y configura CORS del servidor para el origen del frontend y para exponer `X-OIC-*`.

5. Si aún no está instalado, instala `python-multipart`; FastAPI/Starlette deben existir en el backend Nexus. Prueba `GET /api/oic/suministro/salud` y la función de revisión.

## Uso en la interfaz

Carga **un archivo .xlsx tal como lo entrega la institución**, incluso si no tiene fórmulas; selecciona `Ambos`, `Medicamentos` o `Material de Curación`; confirma la **fecha de corte**, y presiona revisar. El motor detecta la categoría por **columna A** y busca `base`, `BASE` o `BASE_REVISION` sin cambiar el orden de las columnas A:AD.

La revisión produce un libro **nuevo** con:

- **base**: copia XML idéntica del documento recibido, sin alteraciones.
- **REVISION OIC**: espejo sobre el que calcula AE:AU, AV (resultado), AW (observaciones), AX (acciones), AY (códigos de controles adicionales), AZ (conteo). **Solo las celdas afectadas por ERROR o REVISAR, más las celdas que identifican la regla y resultado, reciben #FFFF00**. Estilos del resto de celdas intactos.
- **OBSERVACIONES OIC**: hallazgo por fila con categoría, institución, clave, contrato, celdas implicadas, evidencia y acción solicitada.
- **RESUMEN OIC**: totales por categoría e institución y conteos por regla.

## Ejecutar sin Nexus (opcional)

Dentro de `backend` (Python 3.10+):

```powershell
python -m app.oic.cli_suministro "C:\RUTA\Layout_Suministro.xlsx" --corte 2026-10-31 --tipo ambos --salida "C:\RUTA\Layout_Suministro_REVISION.xlsx"
```

También funciona `--tipo medicamentos` o `--tipo material_curacion`. `--dias 15` fija el umbral indicativo de órdenes sin suministro; no es un plazo contractual legal presumido. `--sin-extras` desactiva los controles complementarios, **no** las reglas AE–AU.

## Prueba sobre el archivo real proporcionado

Fecha analítica solicitada para el ejercicio: **2026-10-31**. En `Layout_Suministro.xlsx`, hoja `base`, se analizaron **10,007 filas con datos** de **cinco instituciones**; las otras filas físicas no contenían registros operativos. Se obtuvieron:

| Categoría | Registros | Filas ERROR | Filas REVISAR | Solo INFORMATIVO | OK |
|---|---:|---:|---:|---:|---:|
| Medicamentos | 6,895 | 0 | 1,479 | 110 | 5,306 |
| Material de Curación | 3,112 | 0 | 938 | 817 | 1,357 |
| **Total** | **10,007** | **0** | **2,417** | **927** | **6,663** |

**6,029 hallazgos** en total (una fila puede contener más de uno). El libro real ya revisado se proporciona **por separado** del ZIP para evitar redistribuir información institucional dentro del paquete de código. La ejecución de referencia tardó alrededor de **13.5 segundos** en este entorno; no es un compromiso de rendimiento para otros servidores.

## Validación funcional

```bash
cd NEXUS_Suministro_Dual_OIC
PYTHONPATH=backend python -m unittest discover -s tests -p 'test_*.py' -v
```

Las pruebas comprueban ambos rubros, indicadores, 17 celdas AE:AU, validaciones específicas, IVA informativo, no confundir artículos sin clave, resaltado amarillo, preservación XML exacta de la hoja original y tres modalidades de selección. También se probó FastAPI `GET /salud` y `POST /revisar` con un Excel sintético.

## Límites y advertencias

- El catálogo CNIS adjunto **se tomó del archivo de referencia**, no se cotejó contra una publicación oficial vigente. Una clave ausente o no localizada genera una **solicitud de aclaración**, no una conclusión jurídica.
- Las comparaciones monetarias **no suman ni distribuyen importes contractuales repetidos**. Se documenta el posible nivel de captura por partida, clave o contrato. La coincidencia con una multiplicación por **1.16** se conserva **INFORMATIVA**: no acredita por sí misma el tratamiento fiscal del insumo.
- Cuando varias filas dicen «Sin clave del CNIS», **no son el mismo artículo automáticamente**. Para precios y duplicados se incorpora la descripción de la fila.
- El análisis no sustituye soporte de contrato, pedidos, facturas, actas de entrega o convenios. `REVISAR` requiere valoración documental; `ERROR` refleja inconsistencia interna según los controles, no una sanción.
- No requiere `pandas` ni `openpyxl`. Acepta `.xlsx`; `.xlsb`, `.xlsm` y `.xls` no son compatibles y requieren conversión controlada.
- La integración final a la versión remota de Nexus aún debe realizarse: no se recibió su repositorio.
