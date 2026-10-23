# NEXUS INTELLIGENCE

Plataforma de Inteligencia Analítica de Contrataciones y Auditoría Cuantitativa.

---

## ⚡ Inicio Rápido Local (Windows)

Ejecuta el script de inicio en la raíz del proyecto:

```cmd
iniciar.bat
```
o en PowerShell:
```powershell
.\iniciar.ps1
```
Esto levantará automáticamente el **Backend FastAPI** en `http://127.0.0.1:8000` y el **Frontend Next.js** en `http://127.0.0.1:3000`.

---

## 🚀 Despliegue en Servidor y Producción (Vercel / VPS / Cloud)

Para desplegar la plataforma con acceso público a internet, dominio propio (`nexus.tuempresa.com`) y certificado seguro SSL/HTTPS:

👉 **Consulta la guía paso a paso:** [`docs/GUIA_DESPLIEGUE_SERVIDOR.md`](docs/GUIA_DESPLIEGUE_SERVIDOR.md)

### Resumen de Opciones:
1. **Frontend en Vercel + Backend en Railway o Render (Recomendado):**
   - El frontend Next.js se conecta a Vercel con un par de clics y SSL automático.
   - El backend FastAPI se aloja con disco persistente para DuckDB/Parquet en Railway o Render.
2. **Servidor Propio VPS (Docker Compose + Nginx):**
   - Ejecuta `docker compose up -d` en tu servidor Ubuntu/Debian.
   - Configura Nginx con el archivo [`nginx.conf`](nginx.conf) y Certbot para HTTPS.
