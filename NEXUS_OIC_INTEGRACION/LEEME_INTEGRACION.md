# Integrar revisor OIC en NEXUS Intelligence

## Qué contiene

- `backend/revisor_oic.py`, `backend/motor_validaciones_ampliado.py`,
  `backend/revisor_rescisiones_portable.py`, `backend/generar_hoja_oic.py`,
  `backend/ooxml_rescision.py`, `backend/verificar_excel.py` y
  `backend/catalogos.json`: motor de rescisión que trabaja con XLSX. **No usa
  servicios de IA ni dependencias externas para evaluar el libro**.
- `backend/nexus_routes.py`: interfaz HTTP para consumir el motor desde NEXUS.
- `backend/servidor_demo.py`: servidor de prueba independiente.
- `backend/requirements-api.txt`: dependencias **solo para la API**.
- `frontend/ModuloRescisionesOIC.tsx`: pantalla React de ejemplo.
- `PROMPT_PARA_ANTIGRAVITY.txt`: instrucciones para adaptar los archivos al proyecto real.
- `ejemplos/Layout160_RevisionOIC.xlsx`: prueba generada con el layout 160.

## Paso 1. Llevar el paquete al proyecto Antigravity

1. Descarga y descomprime el ZIP en tu equipo.
2. Abre **Antigravity** con la **carpeta de código de NEXUS** (no una carpeta nueva).
3. Copia la carpeta `backend` del paquete a una subcarpeta del proyecto, por ejemplo `nexus-oic/backend`, y el componente de `frontend` al directorio de componentes de NEXUS.
4. Abre `PROMPT_PARA_ANTIGRAVITY.txt`, copia todo el contenido y pégalo en el agente dentro de ese proyecto.
5. Revisa el plan que proponga: debe reutilizar tu aplicación actual, no crear otra.

**No cargues el ZIP en la sección de 'Subir base de datos' de NEXUS:** esa sección recibe datos; la integración se hace en el repositorio de código usando Antigravity.

## Paso 2. Si NEXUS ya tiene backend FastAPI

Tras copiar **todos** los archivos de `backend` en una carpeta importable del servidor:

```python
from nexus_routes import router as oic_router
app.include_router(oic_router)
```

Dependencias de la API:

```bash
python -m pip install -r requirements-api.txt
```

Si tu proyecto utiliza un entorno virtual, instálalas allí. El motor de revisión no necesita `openpyxl` ni `pandas`.

## Paso 3. Si NEXUS tiene frontend React/Next/Vite y backend Node

Un navegador no puede ejecutar el motor Python. Levanta un pequeño servicio backend:

```bash
cd backend
python -m pip install -r requirements-api.txt
python -m uvicorn servidor_demo:app --host 127.0.0.1 --port 8765
```

En desarrollo, configura en Vite (si aplica) un proxy al puerto `8765`:

```js
server: { proxy: { '/api/oic': 'http://127.0.0.1:8765' } }
```

O configura en Next.js un rewrite del prefijo `/api/oic/:path*` a `http://127.0.0.1:8765/api/oic/:path*`. Ajusta la configuración existente; no dupliques rutas de NEXUS. En producción, levanta el proceso Python en el servidor y restringe acceso a la red interna/autenticación de NEXUS.

## Paso 4. Cómo probar

En modo local, abre `http://127.0.0.1:8765/docs` para probar los endpoints. En la pantalla integrada de NEXUS:

1. Selecciona `Layout_Rescisión_160_Octubre.xlsx` (el original) y la fecha de corte `2026-10-31`.
2. Ejecuta **Analizar**: la referencia de prueba es 111 registros y 236 observaciones. El conteo cambia si cambias reglas/diccionario.
3. Ejecuta **Exportar**: descargará un XLSX con la hoja `REVISION OIC`, con amarillos y filtros.
4. Carga dos o más layouts para descargar un ZIP con un resultado por instituto y un resumen CSV.

## Rutas y parámetros

| Método | Ruta | Parámetros | Salida |
|---|---|---|---|
| POST | `/api/oic/rescisiones/previsualizar` | `files` (multipart), `fecha_corte` (AAAA-MM-DD) | JSON con conteos, reglas y hasta 60 hallazgos por archivo |
| POST | `/api/oic/rescisiones/exportar` | Los mismos | XLSX (un archivo) / ZIP (varios) |

## Separación futura para medicamentos

Crea, sin tocar las reglas de rescisión, un módulo `motor_medicamentos.py` con sus propios catálogos y reglas (monto total/por partida, IVA, entregado/pendiente, claves, fechas y cruce de contratos). Comparte la infraestructura de subida y descarga, pero usa reglas y perfil de encabezados distintos. **No asumir automáticamente que un monto repetido debe eliminarse.**

## Protección de datos

El ejemplo de API valida XLSX, número y tamaño de archivos. Usa archivos temporales y los elimina al terminar. Para producción, aprovecha **autenticación, roles y auditoría** de NEXUS, limita concurrencia y mantiene el backend en una red administrada. No publiques los layouts ni los descargables sin control de acceso.

## Límites

El paquete no conoce aún el repositorio ni el framework real de NEXUS. Los adaptadores son de referencia y requieren integrarse/probarse en ese código antes de desplegar en producción. Un XLSX estructuralmente verificado no sustituye comprobar su apertura en Microsoft Excel.
