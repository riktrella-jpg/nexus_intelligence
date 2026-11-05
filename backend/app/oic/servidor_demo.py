"""Servidor independiente para pruebas; en NEXUS, incluir solo router."""
from fastapi import FastAPI
from nexus_routes import router

app = FastAPI(title="NEXUS Intelligence - Control OIC", version="1.0")
app.include_router(router)

@app.get("/api/oic/salud")
def salud():
    return {"estado": "ok", "modulo": "rescisiones"}
