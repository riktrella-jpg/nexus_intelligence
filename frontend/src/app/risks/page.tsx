"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  PieChart,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  X,
} from "lucide-react";
import { api, getRisks, toApiFilter } from "@/lib/api";
import { useApp } from "@/lib/state";
import { fmtDate, money, num } from "@/lib/format";
import FilterBar from "@/components/FilterBar";
import EChart from "@/components/EChart";

export default function RisksPage() {
  const { active, apiFilter, applied, track, toast } = useApp();
  const [riskData, setRiskData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<any>(null);
  const [evidenceRows, setEvidenceRows] = useState<any[]>([]);

  const loadRisks = async () => {
    if (!active) return;
    try {
      setLoading(true);
      const res = await track(getRisks(active.id, apiFilter));
      setRiskData(res);
    } catch (e: any) {
      toast(e.message || "Error al calcular análisis de riesgos", true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) {
      loadRisks();
    }
  }, [active?.id, applied]); // eslint-disable-line


  const showEvidenceModal = async (finding: any) => {
    setSelectedEvidence(finding);
    if (!finding.row_ids || finding.row_ids.length === 0) {
      setEvidenceRows([]);
      return;
    }
    try {
      const rows = [];
      for (const id of finding.row_ids.slice(0, 5)) {
        const r = await api(`/api/datasets/${active!.id}/records/${id}`);
        rows.push(r);
      }
      setEvidenceRows(rows);
    } catch (e) {
      // Ignorar fallo de carga de evidencia
    }
  };

  if (!active) {
    return (
      <div className="card text-center stack pad-lg" style={{ maxWidth: "600px", margin: "3rem auto" }}>
        <h2>Sin conjunto de datos activo</h2>
        <p className="muted">Seleccione una base de datos para ejecutar la matriz de riesgos institucionales.</p>
        <Link href="/datasets" className="btn btn-primary" style={{ margin: "1rem auto 0" }}>
          Ir a Administrador de Datos
        </Link>
      </div>
    );
  }

  const concentration = riskData?.concentration;
  const pieOption = concentration?.top_providers ? {
    tooltip: { trigger: "item", formatter: "{b}: ${c} MXN ({d}%)" },
    legend: { bottom: 0, textStyle: { color: "#94a3b8", fontSize: 11 } },
    series: [
      {
        name: "Cuota de Proveedores",
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 6, borderColor: "#0f172a", borderWidth: 2 },
        label: { show: false },
        data: concentration.top_providers.map((p: any) => ({
          name: p.provider,
          value: p.amount,
        })),
      },
    ],
  } : null;

  return (
    <div className="risks-container stack" style={{ gap: "1.5rem" }}>
      {/* Cabecera del Módulo */}
      <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{
              padding: "0.75rem",
              borderRadius: "12px",
              background: riskData?.overall_severity === "Alta" ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
              color: riskData?.overall_severity === "Alta" ? "#ef4444" : "#f59e0b"
            }}>
              <ShieldAlert size={28} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>
                  Matriz de Análisis de Riesgos y Control
                </h1>
                <span className={`badge ${riskData?.overall_severity === "Alta" ? "badge-danger" : "badge-warning"}`} style={{ fontSize: "0.8rem" }}>
                  Severidad: {riskData?.overall_severity || "Evaluando…"}
                </span>
              </div>
              <div className="muted small">
                Evaluación algorítmica sobre {active.name} · {num(active.row_count)} registros auditados
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Link href="/reports" className="btn btn-primary" title="Generar informe formal de riesgos">
              <FileText size={16} />
              Generar Informe de Riesgos
            </Link>
            <button className="btn icon ghost" onClick={loadRisks} title="Recalcular riesgos">
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Barra de Filtros Activos */}
      <FilterBar />

      {/* Tarjetas de Indicadores de Riesgo */}
      <div className="kpi-grid">
        <div className="card kpi" style={{ borderLeft: "4px solid #ef4444" }}>
          <div className="k-name">Índice HHI Concentración</div>
          <div className="k-val">
            {concentration ? num(concentration.hhi_score) : "—"}
            <span style={{ fontSize: "0.8rem", marginLeft: "0.3rem", fontWeight: 400 }}>pts</span>
          </div>
          <div className="k-foot">
            Nivel: <strong>{concentration?.hhi_level || "Calculando"}</strong> (Umbral seguro &lt; 1,500)
          </div>
        </div>

        <div className="card kpi" style={{ borderLeft: "4px solid #f59e0b" }}>
          <div className="k-name">Concentración Pareto (Top 20%)</div>
          <div className="k-val">
            {concentration ? `${concentration.pareto_share}%` : "—"}
          </div>
          <div className="k-foot">
            Del monto total en quinta parte de proveedores
          </div>
        </div>

        <div className="card kpi" style={{ borderLeft: "4px solid #3b82f6" }}>
          <div className="k-name">Dispersión de Precios</div>
          <div className="k-val">
            {riskData?.price_dispersion?.length || 0}
          </div>
          <div className="k-foot">
            Insumos con variación significativa (&gt;1.8x)
          </div>
        </div>

        <div className="card kpi" style={{ borderLeft: "4px solid #10b981" }}>
          <div className="k-name">Importe Suministros en Riesgo</div>
          <div className="k-val">
            {riskData ? money(riskData.summary.total_pending_amount) : "—"}
          </div>
          <div className="k-foot">
            {riskData?.critical_supplies?.length || 0} partidas con entrega incompleta
          </div>
        </div>
      </div>

      {/* Hallazgos Prioritarios */}
      <section className="card stack">
        <div className="card-head">
          <div>
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Hallazgos y Observaciones Institucionales</h2>
            <div className="muted small">
              Detectados mediante reglas algorítmicas de auditoría preventiva
            </div>
          </div>
          <span className="badge" style={{ fontSize: "0.75rem" }}>
            {riskData?.findings?.length || 0} observaciones activas
          </span>
        </div>

        <div className="card-pad stack" style={{ gap: "1rem" }}>
          {riskData?.findings?.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem" }} className="muted">
              <CheckCircle2 size={36} style={{ color: "#10b981", margin: "0 auto 0.5rem" }} />
              <div>No se detectaron riesgos críticos en los parámetros evaluados.</div>
            </div>
          ) : (
            riskData?.findings?.map((f: any) => (
              <div
                key={f.id}
                className="card"
                style={{
                  padding: "1.25rem",
                  background: f.severity === "Alta" ? "rgba(239, 68, 68, 0.04)" : "rgba(245, 158, 11, 0.04)",
                  borderColor: f.severity === "Alta" ? "rgba(239, 68, 68, 0.25)" : "rgba(245, 158, 11, 0.25)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
                      <span className={`badge ${f.severity === "Alta" ? "badge-danger" : "badge-warning"}`}>
                        {f.severity}
                      </span>
                      <span className="tag" style={{ textTransform: "capitalize" }}>{f.category}</span>
                      <h3 style={{ fontSize: "1.05rem", margin: 0 }}>{f.title}</h3>
                    </div>
                    <p style={{ margin: "0.4rem 0", fontSize: "0.9rem", color: "var(--foreground)" }}>
                      {f.description}
                    </p>
                    <div style={{ fontSize: "0.85rem", color: "#38bdf8", margin: "0.4rem 0" }}>
                      <strong>Evidencia verificable:</strong> {f.evidence}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.3rem" }}>
                      <strong>Recomendación:</strong> {f.recommendation}
                    </div>
                  </div>

                  {f.row_ids && f.row_ids.length > 0 && (
                    <button
                      className="btn btn-sm"
                      onClick={() => showEvidenceModal(f)}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      <Eye size={14} />
                      Ver Evidencia ({f.row_ids.length})
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Gráficos de Concentración y Tablas Detalladas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "1.25rem" }}>
        {/* Distribución de Proveedores Top */}
        <section className="card stack">
          <div className="card-head">
            <div>
              <h3 style={{ fontSize: "1rem", margin: 0 }}>Distribución de Mercado (Top Proveedores)</h3>
              <div className="muted small">Participación porcentual en el presupuesto contratado</div>
            </div>
          </div>
          <div className="card-pad">
            {pieOption ? (
              <div style={{ height: "300px" }}>
                <EChart option={pieOption} />
              </div>
            ) : (
              <div className="muted text-center" style={{ padding: "2rem" }}>Sin datos de proveedores</div>
            )}
          </div>

        </section>

        {/* Variación de Precios */}
        <section className="card stack">
          <div className="card-head">
            <div>
              <h3 style={{ fontSize: "1rem", margin: 0 }}>Dispersión Extrema en Precios Unitarios</h3>
              <div className="muted small">Bienes con mayor brecha entre precio mínimo y máximo</div>
            </div>
          </div>
          <div className="card-pad" style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th style={{ textAlign: "right" }}>Mínimo</th>
                  <th style={{ textAlign: "right" }}>Máximo</th>
                  <th style={{ textAlign: "right" }}>Brecha</th>
                </tr>
              </thead>
              <tbody>
                {riskData?.price_dispersion?.slice(0, 5).map((p: any, idx: number) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 500 }}>{p.item}</td>
                    <td style={{ textAlign: "right" }}>${p.min_price.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: "right" }}>${p.max_price.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: p.ratio >= 2 ? "#ef4444" : "#f59e0b" }}>
                      {p.ratio}x
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Modal de Evidencia */}
      {selectedEvidence && (
        <div className="modal-backdrop" onClick={() => setSelectedEvidence(null)}>
          <div className="modal" style={{ maxWidth: "750px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3 style={{ margin: 0 }}>Evidencia de Auditoría: {selectedEvidence.title}</h3>
                <div className="muted small">{selectedEvidence.metric_value} · Registros vinculados</div>
              </div>
              <button className="btn icon ghost" onClick={() => setSelectedEvidence(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body stack" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              <div style={{ background: "rgba(59, 130, 246, 0.1)", padding: "0.75rem", borderRadius: "8px", fontSize: "0.85rem" }}>
                <strong>Criterio de hallazgo:</strong> {selectedEvidence.evidence}
              </div>

              <h4 style={{ margin: "0.5rem 0 0", fontSize: "0.95rem" }}>Muestra de Registros Afectados</h4>
              {evidenceRows.length === 0 ? (
                <div className="muted small">Cargando registros asociados…</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="table" style={{ width: "100%", fontSize: "0.8rem" }}>
                    <thead>
                      <tr>
                        <th># Fila</th>
                        <th>Periodo</th>
                        <th>Datos Clave del Registro</th>
                        <th>Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidenceRows.map((er) => (
                        <tr key={er.typed._row_id}>
                          <td>#{er.typed._row_id}</td>
                          <td>{er.typed._period}</td>
                          <td>
                            <div style={{ maxWidth: "350px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {Object.entries(er.typed)
                                .filter(([k]) => !k.startsWith("_"))
                                .slice(0, 3)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" | ")}
                            </div>
                          </td>
                          <td style={{ color: er.typed._issues ? "#ef4444" : "inherit" }}>
                            {er.typed._issues || "Sin incidencias adicionales"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <Link href="/explorer" className="btn btn-sm">
                Abrir en Explorador de Datos
              </Link>
              <button className="btn" onClick={() => setSelectedEvidence(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
