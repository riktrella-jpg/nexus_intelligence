"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCheck,
  FileText,
  Layers,
  Printer,
  RefreshCw,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { generateReport, toApiFilter } from "@/lib/api";
import { useApp } from "@/lib/state";
import { fmtDate, money, num } from "@/lib/format";

export default function ReportsPage() {
  const { active, apiFilter, applied, track, toast } = useApp();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Opciones del reporte
  const [repType, setRepType] = useState("executive");
  const [title, setTitle] = useState("INFORME EJECUTIVO DE INTELIGENCIA DE DATOS Y CONTRATACIONES");
  const [institution, setInstitution] = useState("DIRECCIÓN GENERAL DE ADMINISTRACIÓN Y FINANZAS");
  const [author, setAuthor] = useState("Unidad de Inteligencia y Control de Gestión");
  const [sections, setSections] = useState({
    header: true,
    summary: true,
    kpis: true,
    risks: true,
    providers: true,
    procedures: true,
    signatures: true,
  });

  const loadReport = async () => {
    if (!active) return;
    try {
      setLoading(true);
      const res = await track(
        generateReport(active.id, {
          type: repType,
          title,
          institution,
          author,
          filters: apiFilter,
        })
      );
      setReport(res);
    } catch (e: any) {
      toast(e.message || "Error al generar informe", true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) {
      loadReport();
    }
  }, [active?.id, repType, applied]); // eslint-disable-line


  const handlePrint = () => {
    window.print();
  };

  const handleCopy = () => {
    if (!report) return;
    const text = `${report.metadata.title}\n${report.metadata.institution}\nFecha: ${report.metadata.generated_at}\n\nRESUMEN:\n${report.narrative}\n\nINDICADORES:\n` +
      report.kpis.map((k: any) => `- ${k.label}: ${k.value} (${k.sub})`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast("Resumen ejecutivo copiado al portapapeles.");
  };

  if (!active) {
    return (
      <div className="card text-center stack pad-lg" style={{ maxWidth: "600px", margin: "3rem auto" }}>
        <h2>Sin conjunto de datos activo</h2>
        <p className="muted">Seleccione una base de datos para confeccionar un informe ejecutivo.</p>
        <Link href="/datasets" className="btn btn-primary" style={{ margin: "1rem auto 0" }}>
          Ir a Administrador de Datos
        </Link>
      </div>
    );
  }

  return (
    <div className="reports-container stack" style={{ gap: "1.5rem" }}>
      {/* Barra de Configuración y Acciones (No se imprime) */}
      <div className="card hide-on-print" style={{ padding: "1.25rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Report Studio Institucional</h1>
            <div className="muted small">Generador y exportador de informes ejecutivos de alta dirección</div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button className="btn" onClick={handleCopy} title="Copiar texto ejecutivo al portapapeles">
              {copied ? <Check size={16} style={{ color: "#10b981" }} /> : <Copy size={16} />}
              {copied ? "Copiado" : "Copiar Texto"}
            </button>
            <button className="btn btn-primary" onClick={handlePrint} title="Imprimir o guardar como PDF">
              <Printer size={16} />
              Imprimir / Guardar en PDF
            </button>
          </div>
        </div>

        {/* Controles de Personalización */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginTop: "1.25rem" }}>
          <div>
            <label className="muted small" style={{ fontWeight: 600 }}>Tipo de Informe</label>
            <select className="select" value={repType} onChange={(e) => setRepType(e.target.value)} style={{ width: "100%", marginTop: "0.25rem" }}>
              <option value="executive">Informe Ejecutivo Resumido</option>
              <option value="risks">Informe Integral de Riesgos</option>
              <option value="procurement">Auditoría Operativa de Suministros</option>
            </select>
          </div>

          <div>
            <label className="muted small" style={{ fontWeight: 600 }}>Institución / Ente</label>
            <input
              type="text"
              className="input"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </div>

          <div>
            <label className="muted small" style={{ fontWeight: 600 }}>Área Emisora</label>
            <input
              type="text"
              className="input"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </div>
        </div>

        {/* Interruptores de Secciones */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
          {Object.entries({
            header: "Membrete",
            summary: "Resumen Narrativo",
            kpis: "Cuadrícula de KPIs",
            risks: "Matriz de Riesgos",
            providers: "Proveedores",
            procedures: "Procedimientos",
            signatures: "Firmas",
          }).map(([key, label]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={(sections as any)[key]}
                onChange={(e) => setSections({ ...sections, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* DOCUMENTO EJECUTIVO (Listo para Imprimir / Exportar a PDF) */}
      <div
        id="executive-report"
        className="card report-sheet"
        style={{
          background: "#ffffff",
          color: "#0f172a",
          padding: "3.5rem 3rem",
          borderRadius: "8px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)",
          maxWidth: "960px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        {report ? (
          <div className="stack" style={{ gap: "2rem" }}>
            {/* Membrete Institucional */}
            {sections.header && (
              <header style={{ borderBottom: "2px solid #0f172a", paddingBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.08em", color: "#64748b", textTransform: "uppercase" }}>
                    {institution}
                  </div>
                  <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "0.4rem 0 0.2rem", color: "#0f172a", letterSpacing: "-0.02em" }}>
                    {title}
                  </h1>
                  <div style={{ fontSize: "0.9rem", color: "#475569" }}>
                    Conjunto de Datos: {report.metadata.dataset_name} · Periodo: {report.metadata.period}
                  </div>
                </div>

                <div style={{ textAlign: "right", fontSize: "0.8rem", color: "#64748b" }}>
                  <div><strong>Emisión:</strong> {report.metadata.generated_at}</div>
                  <div><strong>Elaboró:</strong> {author}</div>
                  <div><strong>Estatus:</strong> Concluido / Validado</div>
                </div>
              </header>
            )}

            {/* Resumen Ejecutivo */}
            {sections.summary && (
              <section>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, borderBottom: "1px solid #e2e8f0", paddingBottom: "0.4rem", color: "#1e293b", margin: "0 0 0.75rem" }}>
                  1. RESUMEN EJECUTIVO Y ANÁLISIS DE SITUACIÓN
                </h2>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.7, color: "#334155", textAlign: "justify", margin: 0, whiteSpace: "pre-line" }}>
                  {report.narrative}
                </p>
              </section>
            )}

            {/* Cuadrícula de KPIs Fundamentales */}
            {sections.kpis && (
              <section>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, borderBottom: "1px solid #e2e8f0", paddingBottom: "0.4rem", color: "#1e293b", margin: "0 0 0.75rem" }}>
                  2. INDICADORES CLAVE DE DESEMPEÑO
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
                  {report.kpis.map((k: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        padding: "1rem",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                      }}
                    >
                      <div style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>{k.label}</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", margin: "0.25rem 0" }}>{k.value}</div>
                      <div style={{ fontSize: "0.75rem", color: "#475569" }}>{k.sub}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Matriz y Hallazgos de Riesgo */}
            {sections.risks && (
              <section>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, borderBottom: "1px solid #e2e8f0", paddingBottom: "0.4rem", color: "#1e293b", margin: "0 0 0.75rem" }}>
                  3. EVALUACIÓN DE CONTROL INTERNO Y RIESGOS
                </h2>
                <div className="stack" style={{ gap: "0.75rem" }}>
                  {report.risks?.findings?.map((f: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        padding: "0.85rem 1rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                        background: f.severity === "Alta" ? "#fff1f2" : "#fffbeb",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: f.severity === "Alta" ? "#991b1b" : "#92400e" }}>
                          {idx + 1}. {f.title}
                        </div>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", padding: "0.15rem 0.5rem", borderRadius: "4px", background: f.severity === "Alta" ? "#fecdd3" : "#fef3c7" }}>
                          Riesgo {f.severity}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "#334155", margin: "0.3rem 0" }}>{f.description}</div>
                      <div style={{ fontSize: "0.8rem", color: "#475569" }}><strong>Evidencia:</strong> {f.evidence}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Tabla de Principales Proveedores */}
            {sections.providers && report.providers?.length > 0 && (
              <section>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, borderBottom: "1px solid #e2e8f0", paddingBottom: "0.4rem", color: "#1e293b", margin: "0 0 0.75rem" }}>
                  4. PRINCIPALES PROVEEDORES ADJUDICADOS
                </h2>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                      <th style={{ padding: "0.5rem", borderBottom: "1px solid #cbd5e1" }}>Proveedor</th>
                      <th style={{ padding: "0.5rem", borderBottom: "1px solid #cbd5e1", textAlign: "right" }}>Partidas</th>
                      <th style={{ padding: "0.5rem", borderBottom: "1px solid #cbd5e1", textAlign: "right" }}>Monto Adjudicado (MXN)</th>
                      <th style={{ padding: "0.5rem", borderBottom: "1px solid #cbd5e1", textAlign: "right" }}>Cuota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.providers.slice(0, 5).map((p: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "0.5rem", fontWeight: 600 }}>{p.provider}</td>
                        <td style={{ padding: "0.5rem", textAlign: "right" }}>{p.count}</td>
                        <td style={{ padding: "0.5rem", textAlign: "right" }}>${p.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
                        <td style={{ padding: "0.5rem", textAlign: "right", fontWeight: 700 }}>{p.share}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Firmas de Autorización */}
            {sections.signatures && (
              <section style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid #e2e8f0", pageBreakInside: "avoid" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", textAlign: "center" }}>
                  <div>
                    <div style={{ borderBottom: "1px solid #94a3b8", height: "45px" }} />
                    <div style={{ fontSize: "0.85rem", fontWeight: 700, marginTop: "0.4rem" }}>ELABORÓ</div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>{author}</div>
                  </div>
                  <div>
                    <div style={{ borderBottom: "1px solid #94a3b8", height: "45px" }} />
                    <div style={{ fontSize: "0.85rem", fontWeight: 700, marginTop: "0.4rem" }}>AUTORIZÓ</div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Titular de la Unidad Administrativa</div>
                  </div>
                </div>
              </section>
            )}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "3rem" }}>
            <RefreshCw size={24} className="spin" style={{ margin: "0 auto 1rem", color: "#3b82f6" }} />
            <div>Generando estructura del reporte ejecutivo…</div>
          </div>
        )}
      </div>
    </div>
  );
}
