"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Database,
  Download,
  HardDrive,
  KeyRound,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
} from "lucide-react";
import { api, seedDemo } from "@/lib/api";
import { useApp } from "@/lib/state";
import { fmtDate } from "@/lib/format";

export default function SettingsPage() {
  const { refresh, toast, track, busy } = useApp();
  const [health, setHealth] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [seeding, setSeeding] = useState(false);

  const loadData = async () => {
    try {
      const [h, a] = await Promise.all([
        api("/api/health"),
        api("/api/audit?limit=50"),
      ]);
      setHealth(h);
      setAudit(a);
    } catch (e: any) {
      toast("Error al consultar estado del sistema: " + e.message, true);
    }
  };

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line

  const handleSeed = async () => {
    try {
      setSeeding(true);
      await track(seedDemo());
      toast("Base de datos de prueba cargada con éxito.");
      await refresh();
      await loadData();
    } catch (e: any) {
      toast(e.message || "Error al cargar datos", true);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="settings-container stack" style={{ gap: "1.5rem", maxWidth: "900px", margin: "0 auto" }}>
      <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>
          Configuración y Estado de la Plataforma
        </h1>
        <div className="muted small">
          Trazabilidad, bitácora inmutable de auditoría y arquitectura local
        </div>
      </div>

      {/* Tarjetas de Diagnóstico */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
        <div className="card pad stack" style={{ gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#10b981" }}>
            <Server size={20} />
            <h3 style={{ fontSize: "1rem", margin: 0 }}>Servidor Backend (FastAPI)</h3>
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>
            {health ? "En línea y operativo" : "Conectando…"}
          </div>
          <div className="muted small">Puerto local 8000 · DuckDB & Polars activos</div>
        </div>

        <div className="card pad stack" style={{ gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#3b82f6" }}>
            <KeyRound size={20} />
            <h3 style={{ fontSize: "1rem", margin: 0 }}>Aislamiento de IA Externa</h3>
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>
            {health?.ai_configured ? "Clave LLM detectada" : "Modo Local Seguro"}
          </div>
          <div className="muted small">Cálculos 100% determinísticos sin depender de APIs de nube</div>
        </div>

        <div className="card pad stack" style={{ gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#8b5cf6" }}>
            <HardDrive size={20} />
            <h3 style={{ fontSize: "1rem", margin: 0 }}>Almacenamiento Local</h3>
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>
            SQLite + Parquet
          </div>
          <div className="muted small">Persistencia garantizada en carpeta de trabajo</div>
        </div>
      </div>

      {/* Utilidades de Demostración */}
      <section className="card stack">
        <div className="card-head">
          <div>
            <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Datos de Demostración Sintéticos</h2>
            <div className="muted small">Genera contratos, proveedores y registros de prueba con un solo clic</div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSeed}
            disabled={seeding || busy > 0}
          >
            <Sparkles size={16} />
            {seeding ? "Cargando..." : "Cargar Datos de Demostración"}
          </button>
        </div>
      </section>

      {/* Bitácora de Auditoría */}
      <section className="card stack">
        <div className="card-head">
          <div>
            <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Bitácora de Auditoría y Trazabilidad</h2>
            <div className="muted small">Registro inmutable de acciones realizadas en el sistema</div>
          </div>
          <button className="btn icon ghost" onClick={loadData} title="Actualizar bitácora">
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="card-pad" style={{ overflowX: "auto" }}>
          {audit.length === 0 ? (
            <div className="muted text-center" style={{ padding: "2rem" }}>
              Sin registros en la bitácora aún.
            </div>
          ) : (
            <table className="table" style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th>Fecha y Hora</th>
                  <th>Acción</th>
                  <th>Detalles del Evento</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a, idx) => (
                  <tr key={idx}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                      {fmtDate(a.timestamp)}
                    </td>
                    <td>
                      <span className="badge" style={{ fontSize: "0.75rem" }}>{a.action}</span>
                    </td>
                    <td>
                      <code style={{ fontSize: "0.78rem" }}>
                        {JSON.stringify(a.detail)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
