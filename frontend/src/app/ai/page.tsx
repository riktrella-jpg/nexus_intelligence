"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
  Code2,
  Database,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  Send,
  Sparkles,
  Table2,
  User,
} from "lucide-react";
import { askAI } from "@/lib/api";
import { useApp } from "@/lib/state";
import EChart from "@/components/EChart";

type Message = {
  id: string;
  sender: "user" | "ai";
  text: string;
  cards?: { label: string; value: string; badge?: string }[];
  table?: { headers: string[]; rows: any[] };
  chart?: {
    type: string;
    title: string;
    categories: string[];
    series: { name: string; data: number[]; color?: string }[];
  };
  explanation?: string;
  sql?: string;
  suggested_actions?: string[];
  timestamp: string;
};

const SUGGESTIONS = [
  "Quiero saber cual es el monto contratado contra las piezas entregadas",
  "¿Cuáles son los 5 proveedores con más monto y su participación de mercado?",
  "¿Qué riesgos o indicios de concentración existen en las contrataciones?",
  "¿Cuáles son los insumos con mayor dispersión de precios unitarios?",
  "Dame un resumen general del monto total y contratos activos",
];

function buildAiChartOption(chart: Message["chart"]) {
  if (!chart) return null;
  const isStacked = chart.type === "stacked_bar";
  return {
    title: {
      text: chart.title,
      textStyle: { color: "#1d3452", fontSize: 13, fontWeight: 650 },
      top: 6,
      left: 12,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#101c2e",
      borderWidth: 0,
      textStyle: { color: "#fff", fontSize: 12 },
    },
    legend: {
      top: 6,
      right: 12,
      textStyle: { color: "#667588", fontSize: 11 },
    },
    grid: { left: 16, right: 20, top: 44, bottom: 24, containLabel: true },
    xAxis: {
      type: "category",
      data: chart.categories,
      axisLabel: {
        color: "#667588",
        fontSize: 10.5,
        width: 85,
        overflow: "truncate",
        rotate: chart.categories.length > 4 ? 20 : 0,
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#667588",
        fontSize: 11,
        formatter: (v: number) => (v >= 1000000 ? (v / 1000000).toFixed(1) + "M" : v >= 1000 ? (v / 1000).toFixed(0) + "k" : v),
      },
      splitLine: { lineStyle: { color: "#eef1f6" } },
    },
    series: chart.series.map((s) => ({
      name: s.name,
      type: "bar",
      stack: isStacked ? "total" : undefined,
      barMaxWidth: 32,
      data: s.data,
      itemStyle: {
        color: s.color || "#1d3452",
        borderRadius: isStacked ? 0 : [4, 4, 0, 0],
      },
    })),
  };
}

export default function AiPage() {
  const { active, apiFilter, track, toast } = useApp();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "ai",
      text: "Bienvenido a **NEXUS AI**. Soy el asistente cuantitativo institucional. Formule preguntas sobre montos contratados, volumen de piezas entregadas vs pendientes, proveedores líderes, dispersión de precios o riesgos presupuestales con cálculo verificable en DuckDB.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      suggested_actions: SUGGESTIONS.slice(0, 3),
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const handleSend = async (queryText?: string) => {
    const q = (queryText || input).trim();
    if (!q || !active || busy) return;

    const userMsg: Message = {
      id: "u_" + Date.now(),
      sender: "user",
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setBusy(true);

    try {
      const res = await track(askAI(active.id, q, apiFilter));

      const aiMsg: Message = {
        id: "ai_" + Date.now(),
        sender: "ai",
        text: res.answer,
        cards: res.cards,
        table: res.table,
        chart: res.chart,
        explanation: res.explanation,
        sql: res.sql,
        suggested_actions: res.suggested_actions,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e: any) {
      toast(e.message || "Error al procesar consulta analítica", true);
      const errMsg: Message = {
        id: "err_" + Date.now(),
        sender: "ai",
        text: `Lo sentimos, ocurrió un inconveniente al calcular la consulta: ${e.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setBusy(false);
    }
  };

  if (!active) {
    return (
      <div className="card text-center stack pad-lg" style={{ maxWidth: "600px", margin: "3rem auto", padding: "2rem" }}>
        <h2>Sin conjunto de datos activo</h2>
        <p className="muted">Seleccione una base de datos para iniciar la interacción con NEXUS AI.</p>
        <Link href="/datasets" className="btn btn-primary" style={{ margin: "1rem auto 0" }}>
          Ir a Administrador de Datos
        </Link>
      </div>
    );
  }

  return (
    <div className="ai-page-container stack" style={{ height: "calc(100vh - 120px)", display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Banner Superior Institucional */}
      <div className="card" style={{ padding: "0.85rem 1.4rem", flexShrink: 0, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            <div style={{ padding: "0.6rem", borderRadius: "10px", background: "rgba(176, 146, 91, 0.15)", color: "var(--gold)" }}>
              <Brain size={22} />
            </div>
            <div>
              <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0, color: "var(--navy)" }}>
                NEXUS AI — Asistente de Inteligencia Cuantitativa
              </h1>
              <div className="muted small">
                Conjunto activo: <b>{active.name}</b> · DuckDB + Polars local (cálculos matemáticos exactos sin alucinaciones)
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Link href="/cross" className="btn sm ghost" style={{ gap: 4 }}>
              <BarChart3 size={14} /> Ir a Análisis Cruzado
            </Link>
            <span className="badge ok" style={{ fontSize: "0.75rem" }}>
              Motor Cuantitativo Verificable
            </span>
          </div>
        </div>
      </div>

      {/* Área de Conversación */}
      <div
        className="card"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              gap: "0.85rem",
              alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
              maxWidth: m.sender === "user" ? "80%" : "92%",
              width: m.sender === "ai" ? "100%" : "auto",
            }}
          >
            {m.sender === "ai" && (
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, var(--deep) 0%, var(--navy) 100%)",
                  border: "2px solid var(--gold)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--gold)",
                  flexShrink: 0,
                  boxShadow: "0 2px 6px rgba(16,28,46,0.15)",
                }}
              >
                <Sparkles size={18} />
              </div>
            )}

            <div className="stack" style={{ gap: "0.5rem", width: "100%", maxWidth: m.sender === "user" ? "100%" : "840px" }}>
              <div
                style={{
                  padding: "1.25rem 1.4rem",
                  borderRadius: m.sender === "user" ? "16px 16px 2px 16px" : "16px 16px 16px 2px",
                  background: m.sender === "user" ? "linear-gradient(135deg, #1d3452 0%, #101c2e 100%)" : "#ffffff",
                  color: m.sender === "user" ? "#ffffff" : "#1e293b",
                  border: m.sender === "user" ? "none" : "1px solid #dbe3ed",
                  boxShadow: m.sender === "user" ? "0 4px 12px rgba(16,28,46,0.15)" : "0 4px 18px rgba(16,28,46,0.06)",
                  fontSize: "0.95rem",
                  lineHeight: 1.65,
                }}
              >
                {/* Texto del mensaje */}
                <div style={{ whiteSpace: "pre-line", color: m.sender === "user" ? "#ffffff" : "#1e293b", fontWeight: 400 }}>
                  {m.text}
                </div>

                {/* Tarjetas de Métricas asociadas */}
                {m.cards && m.cards.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                      gap: "0.75rem",
                      marginTop: "1.1rem",
                    }}
                  >
                    {m.cards.map((c, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%)",
                          padding: "0.75rem 1rem",
                          borderRadius: "10px",
                          border: "1px solid #cbd5e1",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                        }}
                      >
                        <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {c.label}
                        </div>
                        <div
                          style={{
                            fontSize: "1.2rem",
                            fontWeight: 750,
                            marginTop: "0.25rem",
                            color: c.badge === "alert" ? "var(--burgundy)" : c.badge === "ok" ? "var(--ok)" : "var(--navy)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {c.value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Gráfica interactiva si el asistente calculó un desglose */}
                {m.chart && (
                  <div
                    style={{
                      marginTop: "1.25rem",
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      padding: "0.5rem",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div style={{ height: "260px", width: "100%" }}>
                      <EChart option={buildAiChartOption(m.chart)} />
                    </div>
                  </div>
                )}

                {/* Tabla de Evidencia */}
                {(() => {
                  const tbl = m.table;
                  if (!tbl) return null;
                  return (
                    <div style={{ marginTop: "1rem", overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                      <table className="t" style={{ width: "100%", fontSize: "0.82rem" }}>
                        <thead>
                          <tr>
                            {tbl.headers.map((h: string) => (
                              <th key={h} style={{ background: "#f1f5f9", color: "#1e293b", fontWeight: 650 }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tbl.rows.map((row: any, rIdx: number) => (
                            <tr key={rIdx}>
                              {tbl.headers.map((h: string) => (
                                <td key={h} style={{ color: "#334155" }}>
                                  {row[h]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* Explicación de auditoría / SQL */}
                {m.explanation && (
                  <details style={{ marginTop: "0.9rem", fontSize: "0.82rem" }}>
                    <summary style={{ cursor: "pointer", color: "var(--deep)", fontWeight: 600 }}>
                      <Code2 size={14} style={{ display: "inline", verticalAlign: -2, marginRight: "0.3rem" }} />
                      Ver lógica de cálculo y consulta aplicada
                    </summary>
                    <div style={{ marginTop: "0.5rem", padding: "0.75rem 1rem", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                      <div style={{ color: "#475569" }}>{m.explanation}</div>
                      {m.sql && (
                        <pre
                          style={{
                            marginTop: "0.5rem",
                            fontSize: "0.78rem",
                            overflowX: "auto",
                            background: "#0f172a",
                            color: "#93c5fd",
                            padding: "0.6rem 0.8rem",
                            borderRadius: "6px",
                          }}
                        >
                          {m.sql}
                        </pre>
                      )}
                    </div>
                  </details>
                )}
              </div>

              {/* Sugerencias de seguimiento */}
              {m.suggested_actions && m.suggested_actions.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.25rem" }}>
                  {m.suggested_actions.map((act, idx) => (
                    <button
                      key={idx}
                      className="btn sm"
                      onClick={() => handleSend(act)}
                      style={{
                        fontSize: "0.78rem",
                        padding: "0.3rem 0.75rem",
                        borderRadius: "9999px",
                        background: "#ffffff",
                        border: "1px solid var(--line-strong)",
                        color: "var(--navy)",
                        fontWeight: 500,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                      }}
                    >
                      <Lightbulb size={12} style={{ color: "var(--gold)" }} />
                      {act}
                    </button>
                  ))}
                </div>
              )}

              <span className="muted" style={{ fontSize: "0.7rem", alignSelf: m.sender === "user" ? "flex-end" : "flex-start" }}>
                {m.timestamp}
              </span>
            </div>

            {m.sender === "user" && (
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "var(--navy)",
                  border: "2px solid var(--line-strong)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  flexShrink: 0,
                  boxShadow: "0 2px 6px rgba(16,28,46,0.12)",
                }}
              >
                <User size={18} />
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div style={{ display: "flex", gap: "0.85rem", alignItems: "center" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "var(--deep)",
                color: "var(--gold)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Sparkles size={18} className="spin" />
            </div>
            <div className="card" style={{ padding: "0.75rem 1.25rem", background: "#fff", border: "1px solid #dbe3ed", color: "var(--muted)", fontSize: "0.9rem" }}>
              Consultando DuckDB y generando respuesta verificable…
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input de Mensaje */}
      <div className="card" style={{ padding: "0.85rem 1.25rem", flexShrink: 0, background: "#fff" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
        >
          <input
            type="text"
            className="input"
            style={{ flex: 1, padding: "0.75rem 1.1rem", fontSize: "0.95rem" }}
            placeholder="Escriba su consulta (ej. Monto contratado contra entregas, principales proveedores, precios atípicos)…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn primary" disabled={busy || !input.trim()} style={{ padding: "0.75rem 1.5rem" }}>
            <Send size={16} />
            {busy ? "Calculando…" : "Consultar"}
          </button>
        </form>
      </div>
    </div>
  );
}
