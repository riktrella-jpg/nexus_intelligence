# Guía rápida — instalar ambos motores en el Nexus existente

## 1. No crear una segunda aplicación

**No pegues el ZIP en la raíz como un archivo y esperes que se active automáticamente.** Descomprímelo. Copia los archivos de `backend/app/oic/` en `NEXUS/backend/app/oic/`, respetando los nombres, y `frontend/components/SuministroRevision.jsx` en `NEXUS/frontend/components/`. No elimines las carpetas ni los motores antiguos.

Si tu proyecto usa una estructura distinta (p. ej., `src/` o `server/`), adapta las rutas de imports a esa estructura, sin duplicar las instancias de FastAPI ni React Router.

## 2. Registrar el backend

En `backend/app/main.py` o el archivo donde ya exista `app=FastAPI()`:

```python
from app.oic.api_suministro import router_suministro
app.include_router(router_suministro)
```

**No registres otra vez** `router_medicamentos` ni `router_rescisiones` si ya estaban registrados. Este router adicional usa el prefijo independiente `/api/oic/suministro`.

Instala el requerimiento adicional si falta:

```bash
pip install python-multipart
```

Prueba `http://localhost:8000/api/oic/suministro/salud` (cambia el puerto si es distinto). Respuesta esperada `estado: activo`, `motor: suministro_dual`.

## 3. Incorporar a la pantalla actual

En el archivo que contiene el contenido provisional de **Submódulo Medicamentos**, reemplaza el contenido provisional por:

```jsx
import SuministroRevision from './components/SuministroRevision';

export function ModuloMedicamentosMaterial() {
  return <SuministroRevision />;
}
```

La ruta del `import` puede ser `../components/` dependiendo del archivo existente. Conserva la cabecera y botones de navegación de tu proyecto.

**Si frontend y backend tienen orígenes distintos**: implementa el proxy habitual del proyecto o proporciona `apiBase`. Además, en middleware CORS del backend autoriza el origen del frontend y `expose_headers=["X-OIC-Registros", "X-OIC-Medicamentos", "X-OIC-Material", "X-OIC-Hallazgos", "X-OIC-Errores", "X-OIC-Revisar", "X-OIC-Informativos", "X-OIC-OK"]`.

## 4. Uso y archivo de salida

Selecciona **Medicamentos + Material de Curación** para la hoja `base` de `Layout_Suministro.xlsx`. El motor identifica el tipo por `A`, ejecuta **17 reglas AE:AU en ambas categorías**, suma controles específicos, conserva el XML original de cada hoja y crea:

`REVISION OIC` · `OBSERVACIONES OIC` · `RESUMEN OIC`.

La revisión mantiene el orden de filas institucionales. Amarillo `#FFFF00` únicamente en la combinación fila/columnas involucradas cuando el hallazgo sea `ERROR` o `REVISAR`. Las situaciones informativas, como un posible IVA de 16 %, quedan documentadas sin resaltar como error.

## 5. Probar sin frontend

```powershell
cd NEXUS\backend
python -m app.oic.cli_suministro "C:\Ruta\Layout_Suministro.xlsx" --corte 2026-10-31 --tipo ambos
```

Si esta orden produce Excel y la página no, revisa el registro del router, la URL del backend, el proxy/CORS y los permisos de carga; no modifiques el motor de reglas para solucionar errores de red.
