"""Configuración central de NEXUS INTELLIGENCE (variables de entorno, rutas)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("NEXUS_DATA_DIR", BASE_DIR / "data")).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
DATASET_DIR = DATA_DIR / "datasets"
STAGING_DIR = DATA_DIR / "staging"
DB_PATH = DATA_DIR / "nexus_meta.sqlite"

ALLOWED_EXTENSIONS = {".xlsx", ".xlsm", ".xlsb", ".csv", ".txt"}
MAX_UPLOAD_MB = int(os.environ.get("NEXUS_MAX_UPLOAD_MB", "500"))
_raw_cors = os.environ.get("NEXUS_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
if _raw_cors.strip() == "*":
    CORS_ORIGINS = ["*"]
else:
    CORS_ORIGINS = [o.strip() for o in _raw_cors.split(",") if o.strip()]

CORS_ORIGIN_REGEX = os.environ.get("NEXUS_CORS_REGEX", r"^https:\/\/.*\.vercel\.app$")


# Integración de IA (opcional, aislada). Nunca se envía al frontend.
AI_PROVIDER_KEY = os.environ.get("NEXUS_AI_API_KEY", "")


def ensure_dirs() -> None:
    for d in (DATA_DIR, UPLOAD_DIR, DATASET_DIR, STAGING_DIR):
        d.mkdir(parents=True, exist_ok=True)
