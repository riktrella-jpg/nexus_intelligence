FROM python:3.12-slim

# Evitar prompts interactivos y buffers de Python
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NEXUS_DATA_DIR=/app/data \
    PORT=8000

WORKDIR /app

# Instalar dependencias del sistema mínimas necesarias
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copiar e instalar dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código de la aplicación
COPY app/ ./app/

# Crear directorio de datos persistentes
RUN mkdir -p /app/data

# Exponer puerto del servicio
EXPOSE 8000

# Comando de inicio con soporte de puerto dinámico ($PORT)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
