"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Calculator,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileText,
  Layers,
  LayoutDashboard,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Table2,
  Zap,
} from "lucide-react";
import { useApp } from "@/lib/state";
import { seedDemo } from "@/lib/api";
import { fmtDate, money, num } from "@/lib/format";

export default function Home() {
  const { datasets, active, setActiveId, refresh, toast, track, busy } = useApp();
  const [seeding, setSeeding] = useState(false);

  const handleSeed = async () => {
    try {
      setSeeding(true);
      const res = await track(seedDemo());
      toast("Base de datos sintética cargada exitosamente.");
      await refresh();
      if (res.dataset_id) {
        setActiveId(res.dataset_id);
      }
    } catch (e: any) {
      toast(e.message || "Error al cargar datos de prueba", true);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="home-container stack" style={{ gap: "2rem" }}>
      {/* Hero Institucional */}
      <section className="card hero-banner" style={{
        background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.98) 100%)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        color: "#f8fafc",
        padding: "2.5rem 2rem",
        borderRadius: "16px",
        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.25)"
      }}>
        <div style={{ maxWidth: "840px" }} className="stack">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{
              background: "rgba(59, 130, 246, 0.2)",
              color: "#60a5fa",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              fontSize: "0.75rem",
              fontWeight: 600,
              padding: "0.25rem 0.75rem",
              borderRadius: "9999px",
              letterSpacing: "0.05em",
              textTransform: "uppercase"
            }}>
              Inteligencia Institucional & Analítica Avanzada
            </span>
            <span style={{
              background: "rgba(16, 185, 129, 0.2)",
              color: "#34d399",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              fontSize: "0.75rem",
              fontWeight: 600,
              padding: "0.25rem 0.75rem",
              borderRadius: "9999px"
            }}>
              Motor Polars + DuckDB
            </span>
          </div>

          <h1 style={{ fontSize: "2.4rem", fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.025em", margin: "0.5rem 0 0" }}>
            NEXUS INTELLIGENCE
          </h1>
          <p style={{ fontSize: "1.1rem", color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>
            Plataforma ejecutiva de inteligencia de datos, detección sistemática de riesgos y generación de reportes institucionales. Transforma bases de datos mensuales de contrataciones y suministros en decisiones estratégicas verificables.
          </p>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem" }}>
            {active ? (
              <Link href="/dashboard" className="btn btn-primary" style={{ padding: "0.75rem 1.5rem", fontSize: "0.95rem" }}>
                <LayoutDashboard size={18} />
                Explorar Dashboard Activo
                <ArrowRight size={16} />
              </Link>
            ) : (
              <Link href="/datasets" className="btn btn-primary" style={{ padding: "0.75rem 1.5rem", fontSize: "0.95rem" }}>
                <Database size={18} />
                Cargar Archivo Excel o CSV
                <ArrowRight size={16} />
              </Link>
            )}

            <button
              onClick={handleSeed}
              disabled={seeding || busy > 0}
              className="btn"
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                borderColor: "rgba(255, 255, 255, 0.2)",
                color: "#f8fafc",
                padding: "0.75rem 1.5rem",
                fontSize: "0.95rem"
              }}
              title="Carga una base de datos de prueba con contrataciones médicas, partidas y entregas"
            >
              <Sparkles size={18} style={{ color: "#fbbf24" }} />
              {seeding ? "Cargando datos sintéticos..." : "Cargar Datos de Demostración (1 clic)"}
            </button>
          </div>
        </div>
      </section>

      {/* Estado del conjunto activo */}
      {active && (
        <section className="card stack" style={{ borderLeft: "4px solid #3b82f6" }}>
          <div className="card-head">
            <div>
              <div className="muted small" style={{ textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
                Conjunto de Datos Seleccionado
              </div>
              <h2 style={{ margin: "0.25rem 0 0" }}>{active.name}</h2>
            </div>
            <Link href="/dashboard" className="btn btn-sm">
              Ver en Dashboard <ArrowRight size={14} />
            </Link>
          </div>
          <div className="card-pad">
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div className="card kpi">
                <div className="k-name">Registros analizados</div>
                <div className="k-val">{num(active.row_count)}</div>
                <div className="k-foot">Partidas consolidadas</div>
              </div>
              <div className="card kpi">
                <div className="k-name">Columnas tipificadas</div>
                <div className="k-val">{active.columns?.length || 0}</div>
                <div className="k-foot">{Object.keys(active.mapping || {}).length} roles homologados</div>
              </div>
              <div className="card kpi">
                <div className="k-name">Períodos registrados</div>
                <div className="k-val">{active.periods?.length || 1}</div>
                <div className="k-foot">{active.periods?.join(", ") || "Único"}</div>
              </div>
              <div className="card kpi">
                <div className="k-name">Perfil operativo</div>
                <div className="k-val" style={{ fontSize: "1.2rem", color: active.procurement?.ready ? "#10b981" : "#f59e0b" }}>
                  {active.procurement?.ready ? "Contrataciones Listo" : "General"}
                </div>
                <div className="k-foot">
                  {active.procurement?.supply ? "Con control de suministros" : "Sin control de entregas"}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Módulos de la Plataforma */}
      <div>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "1rem" }}>
          Módulos Integrales del Sistema
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
          {/* Módulo 1 */}
          <Link href="/datasets" className="card hover-lift" style={{ textDecoration: "none", color: "inherit", padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(59, 130, 246, 0.1)", color: "#3b82f6" }}>
                <Database size={22} />
              </div>
              <div>
                <span className="badge">Módulo I</span>
                <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0" }}>Administrador de Datos</h3>
              </div>
            </div>
            <p className="muted small" style={{ lineHeight: 1.5 }}>
              Importación inteligente de hojas Excel y CSV, detección automática de tipos, homologación de roles analíticos y auditoría de calidad.
            </p>
          </Link>

          {/* Módulo 2 */}
          <Link href="/dashboard" className="card hover-lift" style={{ textDecoration: "none", color: "inherit", padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(16, 185, 129, 0.1)", color: "#10b981" }}>
                <LayoutDashboard size={22} />
              </div>
              <div>
                <span className="badge">Módulo II</span>
                <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0" }}>Dashboard Ejecutivo</h3>
              </div>
            </div>
            <p className="muted small" style={{ lineHeight: 1.5 }}>
              Tableros dinámicos, constructor de visualizaciones, filtros avanzados multicriterio y seguimiento de indicadores de suministros.
            </p>
          </Link>

          {/* Análisis Cruzado */}
          <Link href="/cross" className="card hover-lift" style={{ textDecoration: "none", color: "inherit", padding: "1.5rem", borderTop: "3px solid var(--gold)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(176, 146, 91, 0.15)", color: "var(--gold)" }}>
                <BarChart3 size={22} />
              </div>
              <div>
                <span className="badge" style={{ background: "rgba(176, 146, 91, 0.2)", color: "var(--gold)" }}>Multi-columna</span>
                <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0" }}>Análisis Cruzado</h3>
              </div>
            </div>
            <p className="muted small" style={{ lineHeight: 1.5 }}>
              Cruce simultáneo de variables en filas y columnas, 13 visualizaciones, matriz de calor interactiva, cálculo automático de concentración y drill-down a registros.
            </p>
          </Link>

          {/* Explorador */}
          <Link href="/explorer" className="card hover-lift" style={{ textDecoration: "none", color: "inherit", padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(99, 102, 241, 0.1)", color: "#6366f1" }}>
                <Table2 size={22} />
              </div>
              <div>
                <span className="badge">Explorador</span>
                <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0" }}>Explorador de Registros</h3>
              </div>
            </div>
            <p className="muted small" style={{ lineHeight: 1.5 }}>
              Inspección tabular fila a fila con trazabilidad completa de valores originales vs tipificados y exportación a formato CSV.
            </p>
          </Link>

          {/* Módulo 3 - Riesgos */}
          <Link href="/risks" className="card hover-lift" style={{ textDecoration: "none", color: "inherit", padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}>
                <ShieldAlert size={22} />
              </div>
              <div>
                <span className="badge" style={{ background: "rgba(239, 68, 68, 0.15)", color: "#ef4444" }}>Módulo III</span>
                <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0" }}>Análisis de Riesgos</h3>
              </div>
            </div>
            <p className="muted small" style={{ lineHeight: 1.5 }}>
              Matriz de severidad, índice HHI de concentración de proveedores, dispersión atípica de precios y detección de riesgos de desabasto.
            </p>
          </Link>

          {/* Módulo 3 - NEXUS AI */}
          <Link href="/ai" className="card hover-lift" style={{ textDecoration: "none", color: "inherit", padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(245, 158, 11, 0.1)", color: "#f59e0b" }}>
                <Brain size={22} />
              </div>
              <div>
                <span className="badge" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" }}>Módulo III</span>
                <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0" }}>NEXUS AI Assistant</h3>
              </div>
            </div>
            <p className="muted small" style={{ lineHeight: 1.5 }}>
              Asistente conversacional determinístico que ejecuta cálculos matemáticos verificables en DuckDB sin alucinaciones numéricas.
            </p>
          </Link>

          {/* Módulo 4 - Reportes */}
          <Link href="/reports" className="card hover-lift" style={{ textDecoration: "none", color: "inherit", padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(168, 85, 247, 0.1)", color: "#a855f7" }}>
                <FileText size={22} />
              </div>
              <div>
                <span className="badge" style={{ background: "rgba(168, 85, 247, 0.15)", color: "#a855f7" }}>Módulo IV</span>
                <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0" }}>Report Studio</h3>
              </div>
            </div>
            <p className="muted small" style={{ lineHeight: 1.5 }}>
              Generación de informes ejecutivos con formato institucional de alta dirección, listos para imprimir o exportar en PDF y Word.
            </p>
          </Link>

          {/* Módulo 5 - Conciliación & Motor V4 */}
          <Link href="/conciliacion" className="card hover-lift" style={{ textDecoration: "none", color: "inherit", padding: "1.5rem", borderTop: "3px solid #10b981" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}>
                <Calculator size={22} />
              </div>
              <div>
                <span className="badge" style={{ background: "rgba(16, 185, 129, 0.18)", color: "#10b981", fontWeight: 700 }}>Motor V4</span>
                <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0" }}>Conciliación de Contratos</h3>
              </div>
            </div>
            <p className="muted small" style={{ lineHeight: 1.5 }}>
              Consolidación contractual auditable ($1,205,182,002.31 en 668 contratos HGMEL), conciliación contra cálculo automático e identificación de diferencias.
            </p>
          </Link>
        </div>
      </div>

      {/* Características Institucionales */}
      <section className="card" style={{ padding: "1.75rem" }}>
        <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
          Garantías de Arquitectura y Seguridad Local
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.5rem" }}>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Lock size={20} style={{ color: "#10b981", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>Privacidad Absoluta</div>
              <div className="muted small">Tus archivos y datos se procesan 100% de manera local. Ningún dato sensible sale de la máquina.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Zap size={20} style={{ color: "#3b82f6", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>Alto Rendimiento Analítico</div>
              <div className="muted small">Motor columnar DuckDB y Polars para procesamiento instantáneo de cientos de miles de filas.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <CheckCircle2 size={20} style={{ color: "#6366f1", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>Trazabilidad y Calidad</div>
              <div className="muted small">Preservación estricta de valores crudos originales para cotejo y bitácora de auditoría inmutable.</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
