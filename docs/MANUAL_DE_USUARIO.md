# NEXUS INTELLIGENCE — MANUAL DE USUARIO Y GUÍA DE OPERACIÓN

**Versión de la Plataforma:** 1.0.0  
**Clasificación:** Documento Institucional y Técnico  
**Plataforma:** NEXUS INTELLIGENCE (Suite de Análisis Estratégico y Control de Suministros)

---

## 1. INTRODUCCIÓN Y OBJETIVO DE LA PLATAFORMA

**NEXUS INTELLIGENCE** es un sistema integral de analítica avanzada, monitoreo institucional y control de gestión diseñado específicamente para la supervisión, auditoría y análisis estratégico de compras públicas, contratos y abastecimiento de insumos y servicios.

### Objetivos Clave
* **Homogeneizar y validar datos:** Importar y consolidar archivos periódicos (Excel y CSV) manteniendo trazabilidad absoluta con el registro original.
* **Garantizar la transparencia y control del gasto:** Identificar de forma inmediata la concentración de mercado, sobreprecios y riesgos de contratación.
* **Agilizar la toma de decisiones ejecutivas:** Ofrecer cuadros de mando (dashboards) dinámicos, análisis cruzados multidimensionales y generación instantánea de informes formales para la alta dirección.
* **Inteligencia Aumentada con IA:** Permitir consultas en lenguaje natural mediante **NEXUS AI**, traduciendo preguntas complejas en consultas de datos estructuradas con visualizaciones automáticas.

---

## 2. ARQUITECTURA GENERAL Y REQUISITOS DEL SISTEMA

La solución opera bajo una arquitectura desacoplada y de alto rendimiento que garantiza velocidad de cálculo, seguridad y soberanía de los datos:

* **Frontend:** Desarrollado en **Next.js 16** (React 19, TypeScript, Turbopack) con motor de renderizado gráfico de alta fidelidad **Apache ECharts** y sistema de diseño visual institucional.
* **Backend:** Microservicio de alta velocidad desarrollado con **FastAPI (Python 3.12+)**, uvicorn y motor analítico columnar basado en **SQLite / DuckDB**.
* **Base de datos local:** Almacenamiento local optimizado mediante esquemas relacionales con soporte de tipos inferidos e integridad referencial.
* **Soberanía y Privacidad:** Todo el análisis de datos se ejecuta de forma determinística en el entorno local o en la infraestructura del cliente, sin exponer datos confidenciales a terceros salvo consultas opcionales a proveedores LLM autorizados.

---

## 3. INSTALACIÓN Y PUESTA EN MARCHA (DESPLIEGUE LOCAL)

Para levantar la suite completa en cualquier equipo o servidor con Windows/Linux:

### Requisitos Previos
1. **Node.js:** Versión 18.0 o superior (recomendado 20.x o 22.x).
2. **Python:** Versión 3.10 o superior (recomendado 3.12+).
3. **Git** (opcional para control de versiones).

### Inicio Rápido con Scripts Integrados
En la raíz del proyecto se incluyen lanzadores automáticos:
* **En Windows (CMD):** Doble clic en `iniciar.bat`.
* **En Windows (PowerShell):** Ejecutar `powershell -ExecutionPolicy Bypass -File .\iniciar.ps1`.

### Inicio Manual por Componentes

#### 1. Backend (FastAPI):
```bash
cd backend
# Activar entorno virtual
.\venv\Scripts\activate   # En Windows
# source venv/bin/activate # En Linux/Mac
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
*URL del servicio:* `http://127.0.0.1:8000`  
*Documentación interactiva Swagger:* `http://127.0.0.1:8000/docs`

#### 2. Frontend (Next.js):
```bash
cd frontend
npm.cmd run dev
```
*URL de la aplicación:* `http://127.0.0.1:3000`

---

## 4. GUÍA PASO A PASO POR MÓDULOS

### 4.1. Módulo de Inicio (Home)
Al ingresar a la plataforma (`/`), el usuario cuenta con:
* **Indicadores Globales:** Resumen del conjunto de datos activo (total de registros, importe comprometido, proveedores activos, periodo de corte).
* **Carga de Datos Demostrativos:** Si aún no ha subido un archivo propio, el botón **"Cargar base de datos de prueba"** genera un conjunto sintético con contrataciones, proveedores y entregas para familiarizarse con la herramienta.
* **Accesos Directos:** Enlaces inmediatos a los módulos de análisis con descripciones operativas.

---

### 4.2. Módulo de Bases de Datos e Ingesta (`/datasets`)
Este módulo es el núcleo de entrada de información de la plataforma.

#### A. Flujo de Importación de Archivos:
1. **Seleccionar o arrastrar archivo:** Admite archivos `.xlsx`, `.xls` y `.csv`.
2. **Selección de Hoja y Periodo:** Si el archivo Excel contiene múltiples hojas, el sistema permite elegir cuál procesar y asociarla a un periodo (por ejemplo, *Octubre 2026*).
3. **Modos de Ingesta:**
   * **Reemplazar datos (Sobrescribir):** Elimina registros previos del periodo y coloca los nuevos.
   * **Agregar registros (Append):** Suma las filas a la base histórica existente.
   * **Omitir duplicados:** Detecta filas idénticas previas para no duplicar montos.
4. **Homologación Inteligente de Columnas (Roles Institucionales):**  
   NEXUS sugiere automáticamente la asignación de columnas según los encabezados detectados:
   * **Monto total:** Columna numérica de importe contratado o pagado.
   * **Proveedor:** Razón social o RFC del contratista.
   * **Fecha:** Fecha del contrato, adjudicación o entrega.
   * **Procedimiento:** Tipo de concurso (Licitación Pública, Adjudicación Directa, Invitación a cuando menos 3).
   * **Estatus:** Estado operativo (Entregado, En tránsito, Cancelado, Pendiente).
   * **Descripción:** Objeto del contrato o catálogo de insumo.
   * **Cantidad solicitada vs Cantidad entregada:** Para calcular el porcentaje de cumplimiento de abastecimiento.
   * **Unidad administrativa:** Hospital, delegación o área requirente.

#### B. Auditoría de Calidad de Datos:
* **Registros recibidos vs Registros válidos.**
* **Bitácora de inconsistencias:** Detecta registros con importes negativos, fechas inválidas o celdas faltantes sin alterar el dato de origen.
* **Descarga de inconsistencias:** Botón para exportar un archivo CSV con las filas exactas marcadas para revisión por las áreas operativas.

---

### 4.3. Dashboard Ejecutivo (`/dashboard`)
Panel de control visual de alta dirección con filtrado dinámico en tiempo real:

* **Tarjetas KPI Principales:**
  * Monto Total Adjudicado.
  * Número de Contratos / Registros.
  * Proveedores Únicos.
  * Tasa Promedio de Entrega y Cumplimiento.
* **Gráficas Automáticas Inteligentes:**  
  Según las columnas configuradas, el sistema genera automáticamente:
  * Gráfica de tendencia temporal (gasto mensual).
  * Concentración de proveedores (Top 10 proveedores por importe).
  * Distribución por tipo de procedimiento (Adjudicación directa vs Licitación).
  * Avance de suministros por unidad administrativa.
* **Interactividad Bidireccional (Cross-Filtering):**  
  Al hacer clic en cualquier barra, rebanada de pastel o mes de una gráfica, toda la pantalla y los KPIs se filtran instantáneamente por dicho criterio.
* **Constructor de Gráficas Personalizadas (Chart Builder):**  
  Permite al analista añadir gráficos a la medida seleccionando:
  * Tipo de visualización: Barras verticales/horizontales, Líneas, Dona, Pastel, Radar.
  * Dimensión de agrupación y Métrica agregada (Suma, Promedio, Conteo).

---

### 4.4. Módulo de Análisis Cruzado Multidimensional (`/cross`)
Herramienta de análisis exploratorio para correlacionar variables complejas:

* **Matriz Pivot Multi-Nivel:** Permite cruzar hasta 4 dimensiones en filas contra hasta 3 dimensiones en columnas (ejemplo: *Institución + Procedimiento* en filas vs *Año + Mes* en columnas con botón `+` para agregar niveles).
* **Múltiples Métricas Simultáneas (hasta 12 indicadores):** Compare al mismo tiempo registros, conteos únicos de proveedores y contratos, montos comprometidos/ejercidos, y cantidades físicas contratadas, solicitadas y entregadas en una sola tabla consolidada con totales generales automáticos.
* **Vistas Gráficas Avanzadas:**
  * Barras apiladas al 100% para evaluar participación porcentual.
  * Mapas de calor (*Heatmap*) para detectar picos atípicos de gasto o concentración temporal.
  * Diagramas de dispersión (*Scatter plot*) para analizar correlaciones entre volumen y costo unitario.
* **Exportación Rápida:** Botón para descargar la matriz resultante en formato CSV listo para Microsoft Excel.

---

### 4.5. Explorador de Registros y Trazabilidad (`/explorer`)
La vista tabular exhaustiva para inspección a detalle:

* **Buscador Universal en Tiempo Real:** Busca coincidencias instantáneas por cualquier campo (nombre de proveedor, folio de contrato, descripción del insumo).
* **Filtros Compuestos:** Permite crear filtros por columnas con operadores: igual a, contiene, mayor que, menor que, entre rangos de fechas.
* **Selector de Columnas Visibles:** Oculte o muestre columnas específicas según la necesidad del análisis.
* **Cajón de Registro (Record Drawer):**  
  Al hacer clic en **"Ver detalle"** de cualquier fila, se abre un panel lateral que muestra:
  * El valor normalizado utilizado en los cálculos.
  * El **valor original sin procesar** tal como venía en el archivo fuente.
  * Trazabilidad forense: Nombre del archivo de origen, hoja de cálculo procesada, fecha de carga y observaciones de calidad.
* **Descarga Masiva:** Exporta la vista filtrada actual a CSV con un solo clic.

---

### 4.6. Módulo de Análisis de Riesgos y Cumplimiento (`/risks`)
Motor determinístico de alertas tempranas e indicadores antifraude:

1. **Índice de Concentración de Mercado (HHI & Principio de Pareto):**
   * Calcula el índice *Herfindahl-Hirschman* (HHI). Valores por encima de 2,500 puntos alertan de concentración crítica o monopolio encubierto.
   * Identifica si el 20% de los proveedores acapara más del 80% de los recursos públicos.
2. **Dispersión y Variación Atípica de Precios Unitarios (Outliers):**
   * Identifica insumos idénticos comprados a precios significativamente distintos entre unidades o proveedores (detección de potenciales sobreprecios).
3. **Riesgo por Adjudicaciones Directas Excesivas:**
   * Mide la proporción de contratos asignados sin concurso público respecto a los umbrales legales.
4. **Alerta de Fraccionamiento de Contratos:**
   * Identifica patrones donde se emiten múltiples contratos continuos con importes inmediatamente inferiores al límite que obliga a licitar públicamente.
5. **Visor de Evidencia Probatoria:**
   * Al seleccionar cualquier tarjeta de riesgo, la plataforma filtra y despliega las filas específicas que originaron la alerta, listas para integrarse en expedientes de auditoría.

---

### 4.7. NEXUS AI — Asistente de Inteligencia Analítica (`/ai`)
Interfaz conversacional asistida por IA para interactuar directamente con la base de datos:

* **Consultas en Lenguaje Natural:** Ejemplos:
  * *"¿Cuáles son los 5 proveedores con mayor facturación y qué porcentaje del total representan?"*
  * *"Compara el monto contratado contra las piezas efectivamente entregadas por delegación."*
  * *"Detecta qué contratos tuvieron un precio unitario por encima del promedio."*
* **Transparencia Total:** Cada respuesta incluye:
  * Tarjetas KPI con cifras exactas.
  * Tablas estructuradas con los resultados.
  * Gráficas automáticas generadas en tiempo real.
  * Explicación analítica y **consulta SQL subyacente** para validar que no existan alucinaciones.
  * Sugerencias de siguientes preguntas recomendadas.

---

### 4.8. Report Studio (`/reports`)
Confección y emisión de informes ejecutivos con estándar institucional:

* **Personalización del Documento:**
  * Título del informe, institución y área responsable.
  * Periodo del análisis y tipo de informe (Ejecutivo, Auditoría de Riesgos, Suministros).
* **Módulos Configurables:**
  * Active o desactive con un checkbox las secciones deseadas: Resumen Ejecutivo, Indicadores Clave, Banderas Rojas de Riesgo, Top de Proveedores, Procedimientos de Adjudicación y Apartado de Firmas de Validación.
* **Impresión Formal (`window.print()`):**
  * Estilos CSS optimizados para impresión física o exportación limpia a documento PDF de alta resolución, omitiendo barras laterales y botones de navegación.

---

### 4.9. Configuración y Auditoría (`/settings`)
Supervisión del entorno operativo del sistema:

* **Monitor de Salud (System Health):** Estado de conectividad de FastAPI, latencia, base de datos SQLite y memoria libre.
* **Bitácora Inmutable de Auditoría:** Registro cronológico de todas las importaciones, consultas y eliminaciones ejecutadas en la plataforma con marca de tiempo.
* **Reinicialización de Datos:** Opción para resetear o volver a inyectar datos de demostración en entornos de capacitación.

---

## 5. GUÍA DE BUENAS PRÁCTICAS EN LA INGESTA DE ARCHIVOS

Para asegurar la máxima precisión en los análisis, se recomienda que los archivos de insumo cumplan con las siguientes pautas:

| Variable | Formato Recomendado | Ejemplo Válido | Evitar |
| :--- | :--- | :--- | :--- |
| **Monto / Importe** | Numérico simple o moneda estándar | `1450200.50` ó `$1,450,200.50` | Textos como "A convenir" en la misma columna |
| **Fechas** | Formato ISO o estándar dd/mm/aaaa | `2026-10-15` ó `15/10/2026` | Celdas combinadas o nombres de mes con erratas |
| **RFC / Proveedor** | Razón social clara o RFC a 12/13 caracteres | `FARMACEUTICA DEL NORTE SA DE CV` | Puntos suspensivos o siglas no identificables |
| **Cantidades** | Números enteros o decimales de piezas | `5000` | "5 mil piezas" |
| **Encabezados** | Primera fila del archivo con nombres claros | `IMPORTE`, `PROVEEDOR`, `FECHA` | Dejar filas vacías antes del encabezado |

---

## 6. PREGUNTAS FRECUENTES (FAQ) Y RESOLUCIÓN DE PROBLEMAS

### P: Al abrir el navegador me aparece `ERR_CONNECTION_REFUSED` en el puerto 8000 o 3000.
**R:** Indica que los servidores locales no se encuentran en ejecución. Ejecute `iniciar.bat` en la raíz de la carpeta del proyecto para reactivar automáticamente el Backend y el Frontend.

### P: ¿Se modifican mis archivos originales de Excel al subirlos?
**R:** No. NEXUS INTELLIGENCE realiza una lectura en modo solo lectura (`read-only`) y carga los datos en su propia base local. Su archivo de origen permanece intacto en su equipo.

### P: ¿Cómo puedo restablecer los filtros cuando no encuentro datos en el Dashboard?
**R:** En la barra superior de filtros (`FilterBar`), haga clic en el botón **"Limpiar filtros"** o cierre las etiquetas de filtros activos para volver a visualizar el universo completo de registros.

### P: ¿Puedo exportar los gráficos a presentaciones ejecutivas?
**R:** Sí. Todas las gráficas de ECharts cuentan con opciones interactivas para descargarse como imagen PNG de alta calidad o copiarse directamente desde el módulo de Report Studio.

---

*Manual elaborado y certificado para el despliegue de NEXUS INTELLIGENCE.*
