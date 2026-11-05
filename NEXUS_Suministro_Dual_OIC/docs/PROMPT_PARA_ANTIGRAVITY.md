# Texto listo para pegar en Antigravity

Integra el módulo **NEXUS / OIC · Revisión dual de suministro v2.0** del paquete que he añadido a la carpeta de este proyecto. Debe funcionar dentro de la aplicación Nexus existente **sin sustituir ni eliminar los módulos de Rescisiones ni el antiguo motor de Medicamentos**.

1. Identifica dónde se crea la instancia FastAPI actual. Copia los archivos nuevos de `NEXUS_Suministro_Dual_OIC/backend/app/oic/` a la ruta `backend/app/oic/` real; si `__init__.py` ya existe y contiene código, **consérvalo**. No sobrescribas otros archivos de la carpeta `oic`.
2. Agrega la importación `from app.oic.api_suministro import router_suministro` y `app.include_router(router_suministro)` a la instancia FastAPI existente, sin crear una segunda `app`.
3. Copia `frontend/components/SuministroRevision.jsx` al árbol de frontend que corresponda y úsalo como contenido funcional del submódulo provisional de Medicamentos/Material de Curación. Mantén los estilos y rutas generales existentes. La nueva pantalla ofrece las tres opciones de revisión: ambos, solo medicamentos, solo material de curación.
4. Usa el API `GET /api/oic/suministro/salud` y `POST /api/oic/suministro/revisar` sin modificar el motor existente de Rescisiones. Si hay proxy o CORS, intégralo siguiendo la arquitectura actual, exponiendo encabezados `X-OIC-*` para las estadísticas.
5. El archivo de entrada es el layout institucional A:AD **sin fórmulas**. Aplica por código las 17 reglas AE–AU de la plantilla de referencia a todas las filas de Medicamentos y Material de Curación que estén en la misma hoja `base`. Agrega `REVISION OIC`, `OBSERVACIONES OIC` y `RESUMEN OIC`. Conserva intactas las hojas originales. Amarillo exacto `#FFFF00` únicamente a las celdas implicadas por fila y celdas de regla/resultado con `ERROR` o `REVISAR`.
6. Instala `python-multipart` solamente si falta. Valida las rutas, los tests del paquete y una prueba de carga/descarga desde el navegador. No simules resultados ni muestres éxito sin recibir respuesta HTTP correcta.
7. Conserva el catálogo CNIS empaquetado, pero muestra la advertencia de que su actualización oficial está pendiente de cotejo. Evita atribuir hallazgos a incumplimientos jurídicos sin soporte.

Verifica que el archivo real de ejemplo `Layout_Suministro.xlsx` con fecha de corte 2026-10-31 arroje 10,007 filas activas: 6,895 de Medicamentos y 3,112 de Material de Curación. Su ejecución local de referencia dio 2,417 filas REVISAR y 927 solo informativas; discrepancias de conteo deberán explicarse antes de poner el módulo en producción.

No generes una nueva aplicación ni reestructures toda la plataforma: integra la funcionalidad en el submódulo actual.
