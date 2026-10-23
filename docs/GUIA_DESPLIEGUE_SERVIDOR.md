# 🚀 Guía de Despliegue en Servidor y Producción — NEXUS INTELLIGENCE

Esta guía detalla paso a paso cómo desplegar la plataforma **NEXUS INTELLIGENCE** en un entorno de producción accesible públicamente en internet con su propio nombre de dominio y certificado seguro SSL/HTTPS.

---

## 🏗️ 1. Entendiendo la Arquitectura

NEXUS INTELLIGENCE se compone de dos componentes independientes:

1. **Frontend (Next.js 16 / React 19):** Interfaz gráfica, dashboards, visualizaciones y tablas analíticas.
2. **Backend (FastAPI + DuckDB + Polars + SQLite):** Motor de procesamiento analítico en memoria y persistencia de datasets en formato Parquet y base de datos SQLite.

### ⚠️ Consideración Clave sobre Vercel:
- **Vercel** es la plataforma oficial y óptima para alojar el **Frontend Next.js** (despliegue automático con git, CDN global y SSL automático).
- Sin embargo, las funciones de Vercel son *serverless y efímeras* (no tienen disco persistente). Como NEXUS guarda los archivos cargados (XLSX/CSV convertidos a Parquet) y la base SQLite en disco local, el **Backend** debe ejecutarse en un entorno con almacenamiento persistente:
  - **Opción Recomendada 1 (Híbrida Cloud):** Frontend en **Vercel** + Backend en **Railway** o **Render** (despliegues automáticos desde GitHub, interfaz moderna y disco persistente).
  - **Opción Recomendada 2 (Servidor VPS):** Frontend en **Vercel** (o en el mismo servidor) + Backend en tu propio servidor Linux (Ubuntu/Debian) usando **Docker**.

---

## 🌐 Opción 1: Frontend en Vercel + Backend en Railway o Render (Sin Servidores que Administrar)

Esta es la forma más rápida, moderna y profesional.

### Paso 1: Desplegar el Backend (Railway o Render)

#### A) En Railway (Recomendado):
1. Regístrate en [railway.app](https://railway.app).
2. Crea un **New Project** → **Deploy from GitHub repo**.
3. Selecciona tu repositorio de NEXUS.
4. En **Settings**:
   - **Root Directory:** Pon `/backend` o deja que use el `backend/Dockerfile` ya creado en el repositorio.
   - En la pestaña **Volumes**: Añade un volumen persistente montado en `/app/data` (ej. 5GB o 10GB).
   - En **Variables**:
     - `NEXUS_DATA_DIR=/app/data`
     - `NEXUS_CORS_ORIGINS=https://nexus.tuempresa.com,https://tu-proyecto.vercel.app`
     - `PORT=8000`
5. En **Networking** → **Generate Domain** (o asigna tu subdominio `api.tuempresa.com`).
6. Copia la URL generada (ej: `https://nexus-backend-production.up.railway.app`).

#### B) En Render:
1. Regístrate en [render.com](https://render.com).
2. El repositorio ya incluye el archivo `render.yaml`. En el dashboard haz clic en **New +** → **Blueprint** y selecciona tu repositorio.
3. Se aprovisionará automáticamente el servicio web con su disco persistente (`/app/data`).

---

### Paso 2: Desplegar el Frontend en Vercel

1. Ingresa a [vercel.com](https://vercel.com) e inicia sesión con tu cuenta de GitHub.
2. Haz clic en **Add New...** → **Project**.
3. Importa tu repositorio de GitHub.
4. En la configuración del proyecto:
   - **Framework Preset:** Next.js (se detecta automáticamente).
   - **Root Directory:** Haz clic en *Edit* y selecciona la carpeta `frontend`.
5. En la sección **Environment Variables**, añade:
   - **Key:** `NEXT_PUBLIC_API_URL`
   - **Value:** La URL HTTPS de tu backend (ej. `https://api.tuempresa.com` o la URL de Railway/Render).
6. Haz clic en **Deploy**.
7. ¡Listo! Vercel compilará la aplicación y te otorgará una URL con HTTPS activa de inmediato.

---

### Paso 3: Asignar tu Dominio Propio en Vercel

1. En el panel de Vercel de tu proyecto, ve a **Settings** → **Domains**.
2. Escribe tu dominio (ej: `nexus.tuempresa.com` o `www.tuempresa.com`) y presiona **Add**.
3. Vercel te indicará el registro DNS a crear en tu proveedor de dominio (GoDaddy, Cloudflare, Namecheap, etc.):
   - **Tipo:** `CNAME`
   - **Nombre / Host:** `nexus` (o `@` si es dominio raíz)
   - **Valor / Target:** `cname.vercel-dns.com`
4. Vercel verificará el registro y generará automáticamente tu certificado SSL gratuito (Let's Encrypt).

---

## 🖥️ Opción 2: Todo en un Servidor VPS Propio (Ubuntu / Debian con Docker)

Si prefieres tener todo bajo tu propia infraestructura física o en un servidor virtual (DigitalOcean, AWS EC2, Hetzner, Linode, etc.):

### Requisitos Previos en el Servidor:
Instalar Docker y Docker Compose en tu VPS:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 git curl
sudo systemctl enable --now docker
```

---

### Paso 1: Clonar el Repositorio en el Servidor
```bash
cd /opt
sudo git clone <URL_DE_TU_REPOSITORIO>.git nexus_intelligence
cd nexus_intelligence
```

---

### Paso 2: Configurar Variables de Entorno
Crea el archivo `.env`:
```bash
cp .env.example .env
nano .env
```
Configura:
```ini
DOMAIN=nexus.tuempresa.com
NEXT_PUBLIC_API_URL=https://api.tuempresa.com
NEXUS_CORS_ORIGINS=https://nexus.tuempresa.com
```

---

### Paso 3: Iniciar los Contenedores con Docker Compose
```bash
docker compose up -d --build
```
Verifica que los servicios estén corriendo:
```bash
docker compose ps
```
- Backend estará escuchando en el puerto local `8000`.
- Frontend estará escuchando en el puerto local `3000`.
- Los datos se guardan en el volumen seguro `nexus_data`.

---

### Paso 4: Configurar Dominio y SSL con Nginx y Certbot

1. Instala Nginx y Certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

2. Copia la plantilla de Nginx incluida:
```bash
sudo cp nginx.conf /etc/nginx/sites-available/nexus.conf
sudo ln -s /etc/nginx/sites-available/nexus.conf /etc/nginx/sites-enabled/
```

3. Modifica los nombres de dominio en `/etc/nginx/sites-available/nexus.conf` para que coincidan con los tuyos (`nexus.tuempresa.com` y `api.tuempresa.com`).

4. Genera los certificados SSL gratuitos con Certbot:
```bash
sudo certbot --nginx -d nexus.tuempresa.com -d api.tuempresa.com
```

5. Reinicia Nginx:
```bash
sudo nginx -t && sudo systemctl restart nginx
```

---

## 📋 Resumen de Registros DNS Necesarios

En el panel de control de tu registrador de dominios (Cloudflare, GoDaddy, etc.):

| Tipo | Host | Valor / Destino | Descripción |
|---|---|---|---|
| **CNAME** | `nexus` | `cname.vercel-dns.com` | Si usas Frontend en Vercel |
| **A** | `nexus` | `IP_DE_TU_SERVIDOR` | Si alojas Frontend en tu VPS |
| **A** | `api` | `IP_DE_TU_SERVIDOR` | Backend en tu VPS |
| **CNAME** | `api` | `tu-app.up.railway.app` | Si usas Backend en Railway |

---

## 🔍 Comprobación de Salud y Funcionamiento

Una vez desplegado:
- **API Backend:** Abre en el navegador `https://api.tuempresa.com/api/health` → Debe responder `{"status":"ok","service":"NEXUS INTELLIGENCE API"}`.
- **Frontend:** Abre `https://nexus.tuempresa.com` → Carga de inmediato la interfaz de NEXUS INTELLIGENCE con conexión activa a la API.
