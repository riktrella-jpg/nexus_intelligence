"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Layers,
  LayoutDashboard,
  Play,
  Printer,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Table2,
  Terminal,
  Zap,
} from "lucide-react";
import { useApp } from "@/lib/state";

export default function ManualPage() {
  const { toast } = useApp();
  const [activeSec, setActiveSec] = useState("quickstart");
  const [query, setQuery] = useState("");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const copyCode = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    toast("Comando copiado al portapapeles");
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadMd = () => {
    const el = document.createElement("a");
    el.href = "/api/health"; // fallback or directly trigger download
    // Let's create a blob from the actual manual text content
    const content = `# MANUAL DE USUARIO — NEXUS INTELLIGENCE
Versión 1.0.0 — Documento de Operación y Arquitectura

Consulte la versión completa en docs/MANUAL_DE_USUARIO.md en la raíz del repositorio.`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    el.href = URL.createObjectURL(blob);
    el.download = "MANUAL_DE_USUARIO_NEXUS.md";
    el.click();
    toast("Descargando archivo del manual...");
  };

  const SECTIONS = [
    { id: "quickstart", title: "1. Guía Rápida (4 Pasos)", icon: Zap },
    { id: "intro", title: "2. Introducción y Arquitectura", icon: BookOpen },
    { id: "datasets", title: "3. Bases de Datos e Ingesta", icon: Database },
    { id: "dashboard", title: "4. Dashboard Ejecutivo", icon: LayoutDashboard },
    { id: "cross", title: "5. Análisis Cruzado Multidimensional", icon: BarChart3 },
    { id: "explorer", title: "6. Explorador y Trazabilidad", icon: Table2 },
    { id: "risks", title: "7. Análisis de Riesgos y Alertas", icon: ShieldAlert },
    { id: "ai", title: "8. NEXUS AI (Asistente Natural)", icon: Brain },
    { id: "reports", title: "9. Report Studio (Informes)", icon: FileText },
    { id: "deploy", title: "10. Puesta en Marcha Local", icon: Terminal },
    { id: "faq", title: "11. FAQ y Resolución de Problemas", icon: HelpCircle },
  ];

  const matches = (text: string) => {
    if (!query.trim()) return true;
    return text.toLowerCase().includes(query.toLowerCase());
  };

  return (
    <div className="manual-view stack" style={{ gap: "2rem" }}>
      {/* Encabezado Principal */}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
            <span className="tag" style={{ background: "rgba(176, 146, 91, 0.15)", color: "var(--gold)", fontWeight: 600 }}>
              DOCUMENTACIÓN OFICIAL
            </span>
            <span className="muted small">Versión 1.0.0 · Actualizado Octubre 2026</span>
          </div>
          <h1>Manual de Usuario y Operación del Sistema</h1>
          <div className="sub">
            Guía completa para la ingesta de archivos, análisis forense de contrataciones, detección de riesgos y reportes institucionales.
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button className="btn ghost" onClick={handleDownloadMd} title="Descargar manual en formato Markdown">
            <Download size={15} />
            Descargar Markdown
          </button>
          <button className="btn primary" onClick={handlePrint} id="btn-print-manual" title="Imprimir o guardar en PDF">
            <Printer size={15} />
            Imprimir / Guardar en PDF
          </button>
        </div>
      </div>

      {/* Buscador y Resumen */}
      <div className="card card-pad hide-on-print" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: "260px" }}>
            <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input
              type="text"
              placeholder="Buscar tema en el manual (ej: sobreprecio, HHI, roles, Excel, uvicorn)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="select"
              style={{ width: "100%", paddingLeft: "36px" }}
              id="input-manual-search"
            />
          </div>
          {query && (
            <button className="btn ghost" onClick={() => setQuery("")} style={{ fontSize: 12 }}>
              Limpiar búsqueda
            </button>
          )}
        </div>
      </div>

      {/* Layout de Contenido: Índice lateral + Cuerpo */}
      <div className="grid manual-grid" style={{ gridTemplateColumns: "270px 1fr", gap: "1.75rem", alignItems: "start" }}>
        {/* Barra de Navegación del Manual */}
        <aside
          className="card hide-on-print"
          style={{
            position: "sticky",
            top: "80px",
            padding: "1rem 0.75rem",
            background: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}
        >
          <div style={{ padding: "0.25rem 0.75rem 0.5rem", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}>
            Índice de Contenido
          </div>
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const active = activeSec === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => {
                  setActiveSec(sec.id);
                  const el = document.getElementById(sec.id);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={`btn ghost ${active ? "active" : ""}`}
                style={{
                  justifyContent: "flex-start",
                  textAlign: "left",
                  padding: "0.6rem 0.75rem",
                  fontSize: "13px",
                  background: active ? "rgba(176,146,91,0.12)" : "transparent",
                  color: active ? "var(--navy)" : "var(--text)",
                  fontWeight: active ? 600 : 400,
                  borderLeft: active ? "3px solid var(--gold)" : "3px solid transparent",
                  borderRadius: "0 6px 6px 0",
                }}
              >
                <Icon size={16} style={{ color: active ? "var(--gold)" : "var(--steel)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sec.title}</span>
              </button>
            );
          })}
        </aside>

        {/* Artículos y Capítulos del Manual */}
        <div className="stack" style={{ gap: "2.5rem" }}>
          {/* 1. GUÍA RÁPIDA (4 PASOS) */}
          {matches("inicio rapido 4 pasos flujo carga dashboard riesgos reportes") && (
            <section id="quickstart" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span className="tag" style={{ background: "rgba(47, 107, 87, 0.12)", color: "var(--ok)", fontWeight: 600 }}>FLUJO OPERATIVO</span>
                  <h2 style={{ fontSize: "18px", marginTop: "0.35rem" }}>1. Guía de Inicio Rápido en 4 Pasos</h2>
                </div>
              </div>

              <p className="muted">
                Siga este flujo estándar para procesar cualquier archivo de adquisiciones o suministros desde su recepción hasta la entrega del informe ejecutivo.
              </p>

              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "1rem" }}>
                <div className="card card-pad stack" style={{ background: "#f8fafc", border: "1px solid var(--line)", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--navy)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>1</span>
                    <Database size={18} style={{ color: "var(--steel)" }} />
                  </div>
                  <b>Cargar y Homologar</b>
                  <p className="muted small">Suba el archivo Excel o CSV en <i>Bases de datos</i>. El sistema asociará automáticamente montos, proveedores y fechas.</p>
                  <Link href="/datasets" className="btn ghost" style={{ marginTop: "auto", fontSize: "12px", padding: "4px 8px" }}>
                    Ir a Bases de datos <ArrowRight size={13} />
                  </Link>
                </div>

                <div className="card card-pad stack" style={{ background: "#f8fafc", border: "1px solid var(--line)", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--navy)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>2</span>
                    <LayoutDashboard size={18} style={{ color: "var(--steel)" }} />
                  </div>
                  <b>Analizar en Dashboard</b>
                  <p className="muted small">Explore tarjetas KPI globales y aplique filtrado cruzado interactivo haciendo clic en las barras o líneas de tiempo.</p>
                  <Link href="/dashboard" className="btn ghost" style={{ marginTop: "auto", fontSize: "12px", padding: "4px 8px" }}>
                    Abrir Dashboard <ArrowRight size={13} />
                  </Link>
                </div>

                <div className="card card-pad stack" style={{ background: "#f8fafc", border: "1px solid var(--line)", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--navy)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>3</span>
                    <ShieldAlert size={18} style={{ color: "var(--steel)" }} />
                  </div>
                  <b>Auditar Banderas Rojas</b>
                  <p className="muted small">Revise el índice HHI de concentración de mercado, sobreprecios unitarios atípicos y adjudicaciones directas.</p>
                  <Link href="/risks" className="btn ghost" style={{ marginTop: "auto", fontSize: "12px", padding: "4px 8px" }}>
                    Ver Riesgos <ArrowRight size={13} />
                  </Link>
                </div>

                <div className="card card-pad stack" style={{ background: "#f8fafc", border: "1px solid var(--line)", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--navy)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>4</span>
                    <FileText size={18} style={{ color: "var(--steel)" }} />
                  </div>
                  <b>Emitir Informe Oficial</b>
                  <p className="muted small">Genere en Report Studio el informe institucional con conclusiones ejecutivas y firmas de autorización.</p>
                  <Link href="/reports" className="btn ghost" style={{ marginTop: "auto", fontSize: "12px", padding: "4px 8px" }}>
                    Report Studio <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            </section>
          )}

          {/* 2. INTRODUCCIÓN Y ARQUITECTURA */}
          {matches("arquitectura tecnologia backend frontend privacidad soberania") && (
            <section id="intro" className="card card-pad stack" style={{ gap: "1rem" }}>
              <h2>2. Introducción y Arquitectura del Sistema</h2>
              <p className="muted">
                NEXUS INTELLIGENCE es una plataforma de análisis estratégico orientada a la supervisión y control del gasto público, contrataciones institucionales y cadenas de abastecimiento de insumos médicos y servicios generales.
              </p>

              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem", marginTop: "0.5rem" }}>
                <div style={{ padding: "1rem", borderRadius: "8px", background: "rgba(16, 28, 46, 0.03)", border: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <Server size={17} style={{ color: "var(--navy)" }} />
                    <b>Backend & Motor Analítico</b>
                  </div>
                  <p className="small muted">
                    FastAPI (Python 3.12+) con motor relacional columnar (SQLite/DuckDB). Realiza agregaciones en milisegundos sobre cientos de miles de registros sin bloquear el servidor.
                  </p>
                </div>

                <div style={{ padding: "1rem", borderRadius: "8px", background: "rgba(16, 28, 46, 0.03)", border: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <LayoutDashboard size={17} style={{ color: "var(--navy)" }} />
                    <b>Frontend & Visualización</b>
                  </div>
                  <p className="small muted">
                    Next.js 16 con Turbopack, React 19 y Apache ECharts. Interfaz receptiva con soporte de filtrado multidireccional, cajón de trazabilidad de registros y modo de impresión formal.
                  </p>
                </div>
              </div>

              <div className="alert info" style={{ marginTop: "0.5rem" }}>
                <div>
                  <b>Privacidad y Soberanía de Datos:</b> Toda la información procesada se mantiene dentro del entorno local o la infraestructura institucional. Ningún registro financiero o contractual es compartido con servidores externos sin la autorización explícita del administrador.
                </div>
              </div>
            </section>
          )}

          {/* 3. BASES DE DATOS E INGESTA */}
          {matches("bases de datos ingesta importar excel csv columnas roles sustituir agregar duplicados calidad") && (
            <section id="datasets" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>3. Bases de Datos e Ingesta de Archivos</h2>
                <Link href="/datasets" className="btn ghost" style={{ fontSize: "12px" }}>
                  Ir a Bases de datos <ExternalLink size={13} />
                </Link>
              </div>

              <p className="muted">
                Permite crear y gestionar repositorios de datos a partir de archivos de hoja de cálculo sin necesidad de reestructurar manualmente las columnas en Excel.
              </p>

              <h3>Roles Institucionales Clave</h3>
              <p className="small muted">Al importar un archivo, el asistente asigna los siguientes roles funcionales:</p>

              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th style={{ cursor: "default" }}>Rol</th>
                      <th style={{ cursor: "default" }}>Descripción Operativa</th>
                      <th style={{ cursor: "default" }}>Impacto en la Plataforma</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="badge" style={{ background: "rgba(16,28,46,0.08)" }}>Monto total</span></td>
                      <td>Importe pagado o comprometido en el contrato.</td>
                      <td>Alimenta los KPIs financieros, índice HHI y gráficas de presupuesto.</td>
                    </tr>
                    <tr>
                      <td><span className="badge" style={{ background: "rgba(16,28,46,0.08)" }}>Proveedor</span></td>
                      <td>Razón social, RFC o nombre de la empresa adjudicada.</td>
                      <td>Habilita el análisis de concentración y detección de monopolios.</td>
                    </tr>
                    <tr>
                      <td><span className="badge" style={{ background: "rgba(16,28,46,0.08)" }}>Fecha</span></td>
                      <td>Fecha del fallo, contrato o recepción de bienes.</td>
                      <td>Permite la agregación temporal por mes, trimestre y año.</td>
                    </tr>
                    <tr>
                      <td><span className="badge" style={{ background: "rgba(16,28,46,0.08)" }}>Procedimiento</span></td>
                      <td>Licitación Pública, Adjudicación Directa, etc.</td>
                      <td>Evalúa el apego normativo a la ley de contrataciones públicas.</td>
                    </tr>
                    <tr>
                      <td><span className="badge" style={{ background: "rgba(16,28,46,0.08)" }}>Precio Unitario</span></td>
                      <td>Costo unitario por pieza, medicamento o servicio.</td>
                      <td>Activa la detección de anomalías y sobreprecios (outliers).</td>
                    </tr>
                    <tr>
                      <td><span className="badge" style={{ background: "rgba(16,28,46,0.08)" }}>Cantidad & Suministro</span></td>
                      <td>Piezas requeridas vs piezas efectivamente recibidas.</td>
                      <td>Calcula el % de cumplimiento del abasto y piezas en desabasto.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3>Políticas de Ingesta al Cargar Datos Adicionales</h3>
              <ul className="muted small" style={{ paddingLeft: "1.25rem", margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <li><b>Reemplazar datos del periodo:</b> Útil si la dependencia emite una versión corregida del mes actual.</li>
                <li><b>Agregar registros (Append):</b> Concatena las nuevas filas para armar históricos multianuales.</li>
                <li><b>Omitir duplicados exactos:</b> Evita inflar la contabilidad si un registro ya existía previamente.</li>
              </ul>
            </section>
          )}

          {/* 4. DASHBOARD EJECUTIVO */}
          {matches("dashboard graficas kpis filtrado cruzado barras series constructor") && (
            <section id="dashboard" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>4. Dashboard Ejecutivo y Filtrado Cruzado</h2>
                <Link href="/dashboard" className="btn ghost" style={{ fontSize: "12px" }}>
                  Abrir Dashboard <ExternalLink size={13} />
                </Link>
              </div>

              <p className="muted">
                Proporciona un panorama sintético de alto impacto con indicadores clave de desempeño (KPIs) y gráficos interactivos coordinados.
              </p>

              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="card card-pad" style={{ background: "#fcfdfe", border: "1px solid var(--line)" }}>
                  <b>Filtrado Cruzado Bidireccional</b>
                  <p className="small muted" style={{ marginTop: "0.4rem" }}>
                    Al hacer clic en cualquier barra (ej: un proveedor) o en un mes de la gráfica de evolución temporal, toda la pantalla —incluyendo los demás gráficos y los totales numéricos— se filtra de inmediato por ese criterio.
                  </p>
                </div>
                <div className="card card-pad" style={{ background: "#fcfdfe", border: "1px solid var(--line)" }}>
                  <b>Constructor de Gráficos (Chart Builder)</b>
                  <p className="small muted" style={{ marginTop: "0.4rem" }}>
                    El usuario puede crear tarjetas personalizadas seleccionando la variable de agrupación (dimensión) y la operación deseada (Suma de montos, Conteo de eventos o Promedio), guardándolas en su vista ejecutiva.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* 5. ANÁLISIS CRUZADO */}
          {matches("analisis cruzado tabla pivot heatmap matriz multidimensional agrupacion") && (
            <section id="cross" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>5. Módulo de Análisis Cruzado Multidimensional</h2>
                <Link href="/cross" className="btn ghost" style={{ fontSize: "12px" }}>
                  Ir a Análisis cruzado <ExternalLink size={13} />
                </Link>
              </div>

              <p className="muted">
                Diseñado para responder preguntas analíticas complejas como: <i>¿Qué proveedores concentran el presupuesto en cada trimestre?</i> o <i>¿Cuál es la tasa de cumplimiento por unidad hospitalaria?</i>
              </p>

              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
                <div style={{ borderLeft: "3px solid var(--gold)", paddingLeft: "0.75rem" }}>
                  <b>Matriz Pivot 2D</b>
                  <p className="small muted">Cruza hasta 3 dimensiones en renglones y 1 dimensión en columnas para desgloses matriciales exhaustivos.</p>
                </div>
                <div style={{ borderLeft: "3px solid var(--deep)", paddingLeft: "0.75rem" }}>
                  <b>Vistas Visuales Especiales</b>
                  <p className="small muted">Cambie entre tablas dinámicas, mapas de calor (Heatmaps) para picos de gasto y barras apiladas al 100%.</p>
                </div>
                <div style={{ borderLeft: "3px solid var(--steel)", paddingLeft: "0.75rem" }}>
                  <b>Exportación Directa a Excel</b>
                  <p className="small muted">Descargue la matriz calculada en formato CSV limpio con encabezados jerárquicos.</p>
                </div>
              </div>
            </section>
          )}

          {/* 6. EXPLORADOR Y TRAZABILIDAD */}
          {matches("explorador trazabilidad drawer registro original archivo auditoria celdas") && (
            <section id="explorer" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>6. Explorador de Registros y Trazabilidad Forense</h2>
                <Link href="/explorer" className="btn ghost" style={{ fontSize: "12px" }}>
                  Abrir Explorador <ExternalLink size={13} />
                </Link>
              </div>

              <p className="muted">
                Permite la auditoría fila por fila de todo el universo de contratos con garantía de inalterabilidad.
              </p>

              <div className="alert info">
                <div>
                  <b>Principio de Trazabilidad Total:</b> Al hacer clic en <b>"Ver detalle"</b> de cualquier registro, se abre el panel lateral <i>RecordDrawer</i>, el cual muestra tanto el dato analizado como el <b>valor original sin tocar</b> del archivo Excel de origen, así como la hoja, periodo y bitácora de observaciones de calidad.
                </div>
              </div>
            </section>
          )}

          {/* 7. ANÁLISIS DE RIESGOS */}
          {matches("analisis de riesgos hhi sobreprecio pareto adjudicacion directa fraccionamiento evidencia") && (
            <section id="risks" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span className="tag" style={{ background: "rgba(101, 30, 50, 0.12)", color: "var(--burgundy)", fontWeight: 600 }}>CUMPLIMIENTO & CONTROL</span>
                  <h2 style={{ fontSize: "18px", marginTop: "0.35rem" }}>7. Análisis de Riesgos y Banderas Rojas</h2>
                </div>
                <Link href="/risks" className="btn ghost" style={{ fontSize: "12px" }}>
                  Ver Riesgos <ExternalLink size={13} />
                </Link>
              </div>

              <p className="muted">
                El motor analiza patrones de alerta temprana basándose en metodologías internacionales de fiscalización y libre competencia:
              </p>

              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="card card-pad" style={{ borderLeft: "4px solid var(--burgundy)" }}>
                  <b>1. Concentración de Mercado (Índice HHI)</b>
                  <p className="small muted" style={{ marginTop: "0.4rem" }}>
                    Calcula el <i>Herfindahl-Hirschman Index</i>. Si supera los 2,500 puntos o si el 20% de los proveedores acapara más del 80% del presupuesto, se clasifica como riesgo crítico de colusión o dependencia severa.
                  </p>
                </div>
                <div className="card card-pad" style={{ borderLeft: "4px solid var(--warn)" }}>
                  <b>2. Dispersión de Precios Unitarios (Outliers)</b>
                  <p className="small muted" style={{ marginTop: "0.4rem" }}>
                    Compara el costo de un mismo insumo entre distintas compras. Registros con un valor 1.8x superior al promedio se aíslan para inspección por posible sobrecosto.
                  </p>
                </div>
                <div className="card card-pad" style={{ borderLeft: "4px solid var(--gold)" }}>
                  <b>3. Adjudicaciones Directas</b>
                  <p className="small muted" style={{ marginTop: "0.4rem" }}>
                    Supervisa que los procedimientos sin concurso se mantengan dentro de los límites porcentuales autorizados por la normativa institucional.
                  </p>
                </div>
                <div className="card card-pad" style={{ borderLeft: "4px solid var(--steel)" }}>
                  <b>4. Fraccionamiento de Contratos</b>
                  <p className="small muted" style={{ marginTop: "0.4rem" }}>
                    Detecta si se emitieron múltiples contratos a un mismo proveedor con montos inmediatamente por debajo del tope que obligaría a licitar.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* 8. NEXUS AI */}
          {matches("nexus ai lenguaje natural preguntas consultas sql bot chat asistente") && (
            <section id="ai" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span className="tag" style={{ background: "rgba(176, 146, 91, 0.15)", color: "var(--gold)", fontWeight: 600 }}>INTELIGENCIA AUMENTADA</span>
                  <h2 style={{ fontSize: "18px", marginTop: "0.35rem" }}>8. NEXUS AI — Asistente de Inteligencia Analítica</h2>
                </div>
                <Link href="/ai" className="btn ghost" style={{ fontSize: "12px" }}>
                  Ir a NEXUS AI <ExternalLink size={13} />
                </Link>
              </div>

              <p className="muted">
                Permite a los usuarios realizar preguntas en lenguaje natural sobre sus bases de datos sin necesidad de conocer SQL o fórmulas complejas de cálculo.
              </p>

              <div className="card card-pad stack" style={{ background: "rgba(16, 28, 46, 0.02)", gap: "0.75rem" }}>
                <b>Ejemplos de preguntas admitidas:</b>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div className="card card-pad" style={{ background: "#fff", fontSize: 13 }}>
                    💬 <i>"¿Cuáles son los 5 proveedores con más monto contratado y qué porcentaje representan?"</i>
                  </div>
                  <div className="card card-pad" style={{ background: "#fff", fontSize: 13 }}>
                    💬 <i>"Muestra las piezas contratadas contra las entregadas por unidad médica."</i>
                  </div>
                  <div className="card card-pad" style={{ background: "#fff", fontSize: 13 }}>
                    💬 <i>"¿Qué contratos se asignaron por adjudicación directa en el último periodo?"</i>
                  </div>
                  <div className="card card-pad" style={{ background: "#fff", fontSize: 13 }}>
                    💬 <i>"Identifica anomalías en precios unitarios respecto al promedio histórico."</i>
                  </div>
                </div>
                <p className="small muted">
                  * Cada respuesta de NEXUS AI despliega tarjetas KPI con cifras exactas, tablas dinámicas, gráficos de apoyo y la consulta SQL generada de manera transparente.
                </p>
              </div>
            </section>
          )}

          {/* 9. REPORT STUDIO */}
          {matches("report studio informes ejecutivo impresion pdf formal firmas exportacion") && (
            <section id="reports" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>9. Report Studio — Confección de Informes Ejecutivos</h2>
                <Link href="/reports" className="btn ghost" style={{ fontSize: "12px" }}>
                  Ir a Report Studio <ExternalLink size={13} />
                </Link>
              </div>

              <p className="muted">
                Herramienta para redactar y exportar dictámenes e informes técnicos con estándar formal de gobierno corporativo.
              </p>

              <ul className="muted small" style={{ paddingLeft: "1.25rem", margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <li><b>Secciones Modulares:</b> Active o desactive mediante casillas el Resumen Ejecutivo, Banderas Rojas, Proveedores Principales y Tablas de Abastecimiento.</li>
                <li><b>Identidad Institucional:</b> Ingrese el nombre de la dependencia, área emisora y nombres de los funcionarios para el bloque de firmas de autorización.</li>
                <li><b>Salida Impresa de Alta Resolución:</b> Optimizado con hojas de estilo para generar un documento PDF pulcro y libre de elementos de navegación al pulsar <i>Imprimir Reporte</i>.</li>
              </ul>
            </section>
          )}

          {/* 10. PUESTA EN MARCHA LOCAL */}
          {matches("puesta en marcha despliegue comandos terminal backend frontend iniciar bat ps1 uvicorn npm") && (
            <section id="deploy" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <h2>10. Puesta en Marcha y Despliegue Local</h2>
              <p className="muted">
                Comandos de terminal para arrancar o reiniciar los servicios de NEXUS INTELLIGENCE en cualquier estación de trabajo:
              </p>

              <div className="stack" style={{ gap: "1rem" }}>
                {/* Opción rápida: scripts */}
                <div className="card card-pad" style={{ background: "#f8fafc", border: "1px solid var(--line)" }}>
                  <b>Opción Automática (Recomendada):</b>
                  <p className="small muted" style={{ marginTop: "0.25rem", marginBottom: "0.75rem" }}>
                    Ejecute el script unificado que verifica puertos y abre el navegador automáticamente:
                  </p>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0f172a", color: "#f8fafc", padding: "0.6rem 1rem", borderRadius: "6px", fontFamily: "monospace", fontSize: "13px" }}>
                    <span>powershell -ExecutionPolicy Bypass -File .\iniciar.ps1</span>
                    <button className="btn icon ghost" style={{ color: "#94a3b8" }} onClick={() => copyCode("powershell -ExecutionPolicy Bypass -File .\\iniciar.ps1", "cmd-auto")} title="Copiar comando">
                      {copiedCmd === "cmd-auto" ? <CheckCircle2 size={16} style={{ color: "#4ade80" }} /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>

                {/* Comandos individuales */}
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div className="card card-pad stack" style={{ gap: "0.5rem" }}>
                    <b>Terminal 1: Backend (FastAPI)</b>
                    <p className="small muted">Puerto 8000 (Python 3.12+)</p>
                    <div style={{ background: "#0f172a", color: "#f8fafc", padding: "0.5rem 0.75rem", borderRadius: "6px", fontFamily: "monospace", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>cd backend; .\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000</span>
                      <button className="btn icon ghost" style={{ color: "#94a3b8" }} onClick={() => copyCode("cd backend; .\\venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8000", "cmd-be")}>
                        {copiedCmd === "cmd-be" ? <CheckCircle2 size={15} style={{ color: "#4ade80" }} /> : <Copy size={15} />}
                      </button>
                    </div>
                  </div>

                  <div className="card card-pad stack" style={{ gap: "0.5rem" }}>
                    <b>Terminal 2: Frontend (Next.js)</b>
                    <p className="small muted">Puerto 3000 (Turbopack)</p>
                    <div style={{ background: "#0f172a", color: "#f8fafc", padding: "0.5rem 0.75rem", borderRadius: "6px", fontFamily: "monospace", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>cd frontend; npm.cmd run dev</span>
                      <button className="btn icon ghost" style={{ color: "#94a3b8" }} onClick={() => copyCode("cd frontend; npm.cmd run dev", "cmd-fe")}>
                        {copiedCmd === "cmd-fe" ? <CheckCircle2 size={15} style={{ color: "#4ade80" }} /> : <Copy size={15} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 11. FAQ Y RESOLUCIÓN DE PROBLEMAS */}
          {matches("faq preguntas frecuentes problemas solucion error puerto conexion rechazado err_connection_refused") && (
            <section id="faq" className="card card-pad stack" style={{ gap: "1.25rem" }}>
              <h2>11. Preguntas Frecuentes (FAQ) y Solución de Problemas</h2>

              <div className="stack" style={{ gap: "0.75rem" }}>
                <details className="card card-pad" style={{ cursor: "pointer", background: "var(--surface)" }}>
                  <summary style={{ fontWeight: 600, color: "var(--navy)" }}>
                    ¿Qué hacer si aparece "ERR_CONNECTION_REFUSED" en http://localhost:8000 o 3000?
                  </summary>
                  <p className="small muted" style={{ marginTop: "0.5rem", lineHeight: 1.5 }}>
                    Significa que el proceso del Backend o del Frontend no está iniciado. Ejecute <code>iniciar.bat</code> o inicie la terminal de backend con <code>uvicorn app.main:app --port 8000</code>.
                  </p>
                </details>

                <details className="card card-pad" style={{ cursor: "pointer", background: "var(--surface)" }}>
                  <summary style={{ fontWeight: 600, color: "var(--navy)" }}>
                    ¿Mis archivos originales de Excel sufren alguna modificación?
                  </summary>
                  <p className="small muted" style={{ marginTop: "0.5rem", lineHeight: 1.5 }}>
                    No. El sistema únicamente lee en modo seguro la información y la guarda en la base de datos interna. Su archivo físico original permanece completamente intacto en su computadora.
                  </p>
                </details>

                <details className="card card-pad" style={{ cursor: "pointer", background: "var(--surface)" }}>
                  <summary style={{ fontWeight: 600, color: "var(--navy)" }}>
                    ¿Cómo exporto los gráficos para pegarlos en una presentación de PowerPoint?
                  </summary>
                  <p className="small muted" style={{ marginTop: "0.5rem", lineHeight: 1.5 }}>
                    Todas las gráficas de ECharts cuentan con opciones interactivas para descargarse como imagen PNG en alta definición, o bien puede utilizar la función de impresión de Report Studio.
                  </p>
                </details>

                <details className="card card-pad" style={{ cursor: "pointer", background: "var(--surface)" }}>
                  <summary style={{ fontWeight: 600, color: "var(--navy)" }}>
                    ¿Puedo trabajar con múltiples bases de datos de diferentes años o secretarías?
                  </summary>
                  <p className="small muted" style={{ marginTop: "0.5rem", lineHeight: 1.5 }}>
                    Sí. La plataforma permite tener múltiples conjuntos de datos independientes. Puede cambiar de uno a otro en cualquier momento desde el selector superior de la barra de navegación o desde la vista de <i>Bases de datos</i>.
                  </p>
                </details>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
