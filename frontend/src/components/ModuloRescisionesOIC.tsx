"use client";
import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  FileCheck2,
  FileSpreadsheet,
  Filter,
  Info,
  Pill,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

/**
 * Componente institucional NEXUS Intelligence — CONTROL DE CALIDAD OIC · RESCISIONES.
 * Conecta con /api/oic/rescisiones/previsualizar y /api/oic/rescisiones/exportar.
 * No modifica las hojas originales del archivo Excel; genera la pestaña espejo REVISION OIC
 * con columnas Inconsistencia_1..N y resaltado amarillo (#FFFF00) en inconsistencias y celdas relacionadas.
 */
export type Hallazgo = {
  fila: number;
  celda: string;
  contrato: string;
  categoria: string;
  regla: string;
  campo: string;
  detalle: string;
  accion: string;
  celdas_relacionadas: string[];
};

export type Resultado = {
  archivo: string;
  hoja: string;
  registros: number;
  inconsistencias: number;
  filas_observadas: number;
  por_gravedad: Record<string, number>;
  por_regla: Record<string, number>;
  columnas_reconocidas?: Record<string, string>;
  hallazgos_muestra: Hallazgo[];
};

export type Preview = {
  fecha_corte: string;
  archivos: Resultado[];
  errores: { archivo: string; error: string }[];
};

const brand = "#682138";
const navy = "#193B59";
const gold = "#C5AA72";

function getErrorMessage(data: any): string {
  const d = data?.detail ?? data;
  return typeof d === "string"
    ? d
    : d?.mensaje || JSON.stringify(d) || "No fue posible analizar.";
}

export default function ModuloRescisionesOIC({ apiBase = "" }: { apiBase?: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [cutoff, setCutoff] = useState("2026-10-31");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [sevFilter, setSevFilter] = useState<string>("TODAS");
  const [ruleFilter, setRuleFilter] = useState<string>("TODAS");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showDictInfo, setShowDictInfo] = useState(false);

  const endpoint = (suffix: string) => `${apiBase}/api/oic/rescisiones/${suffix}`;

  const buildFormData = (customFiles?: File[], customCutoff?: string, formato?: string) => {
    const form = new FormData();
    const list = customFiles ?? files;
    list.forEach((f) => form.append("files", f));
    form.append("fecha_corte", customCutoff ?? cutoff);
    if (formato) form.append("formato", formato);
    return form;
  };

  async function analyze(customFiles?: File[], customCutoff?: string) {
    const targetFiles = customFiles ?? files;
    const targetCutoff = customCutoff ?? cutoff;
    if (!targetFiles.length || !targetCutoff) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setActiveFileIdx(0);
    setSevFilter("TODAS");
    setRuleFilter("TODAS");
    try {
      const response = await fetch(endpoint("previsualizar"), {
        method: "POST",
        body: buildFormData(targetFiles, targetCutoff),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(data));
      setPreview(data as Preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadLayout160Demo() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(endpoint("ejemplo-layout160"));
      if (!res.ok) throw new Error("No se pudo descargar el archivo de prueba Layout 160.");
      const blob = await res.blob();
      const demoFile = new File(
        [blob],
        "Layout_Rescision_160_Octubre.xlsx",
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      );
      const demoCutoff = "2026-10-31";
      setFiles([demoFile]);
      setCutoff(demoCutoff);
      await analyze([demoFile], demoCutoff);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function exportExcel(formato: "auto" | "zip" = "auto") {
    if (!files.length || !cutoff) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint("exportar"), {
        method: "POST",
        body: buildFormData(files, cutoff, formato),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(getErrorMessage(errData));
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      if (files.length === 1 && formato !== "zip") {
        const stem = files[0].name.replace(/\.xlsx$/i, "");
        anchor.download = `${stem}_REVISION_OIC.xlsx`;
      } else {
        anchor.download = "Devoluciones_OIC_NEXUS.zip";
      }
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const activeResult: Resultado | null =
    preview && preview.archivos.length > 0
      ? preview.archivos[Math.min(activeFileIdx, preview.archivos.length - 1)]
      : null;

  const filteredHallazgos = useMemo(() => {
    if (!activeResult) return [];
    const q = searchQuery.trim().toLowerCase();
    return activeResult.hallazgos_muestra.filter((h) => {
      if (sevFilter !== "TODAS" && h.categoria !== sevFilter) return false;
      if (ruleFilter !== "TODAS" && h.regla !== ruleFilter) return false;
      if (q) {
        const hay = `${h.fila} ${h.celda} ${h.contrato} ${h.regla} ${h.campo} ${h.detalle} ${h.accion} ${(h.celdas_relacionadas || []).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeResult, sevFilter, ruleFilter, searchQuery]);

  const totals = useMemo(() => {
    if (!preview) return null;
    return preview.archivos.reduce(
      (acc, r) => {
        acc.registros += r.registros;
        acc.filas += r.filas_observadas;
        acc.inconsistencias += r.inconsistencias;
        acc.errores += r.por_gravedad?.ERROR || 0;
        acc.revisar += r.por_gravedad?.REVISAR || 0;
        acc.documental += r.por_gravedad?.DOCUMENTAL || 0;
        return acc;
      },
      { registros: 0, filas: 0, inconsistencias: 0, errores: 0, revisar: 0, documental: 0 }
    );
  }, [preview]);

  return (
    <section style={{ color: navy, maxWidth: 1480, margin: "0 auto" }}>
      {/* Encabezado Institucional NEXUS OIC */}
      <header
        style={{
          background: `linear-gradient(135deg, ${navy} 0%, ${brand} 100%)`,
          color: "white",
          borderRadius: 12,
          padding: "22px 28px",
          marginBottom: 18,
          borderBottom: `3px solid ${gold}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: gold,
              marginBottom: 4,
            }}
          >
            <ShieldCheck size={14} /> CONTROL DE CALIDAD OIC · AUDITORÍA DE LAYOUTS INSTITUCIONALES
          </div>
          <h1 style={{ fontSize: 23, margin: "0 0 6px", color: "#fff" }}>
            REVISIÓN OIC · RESCISIONES ADMINISTRATIVAS
          </h1>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            NEXUS Intelligence · Validación por diccionario oficial, controles lógicos, numéricos, cronológicos y documentales
          </div>
        </div>

        {/* Selector de Submódulos OIC */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Link
            href="/oic/rescisiones"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              borderRadius: 8,
              background: gold,
              color: "#101c2e",
              fontWeight: 700,
              fontSize: 12.5,
            }}
          >
            <FileCheck2 size={15} /> Submódulo Rescisiones (Activo)
          </Link>
          <Link
            href="/oic/medicamentos"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.24)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 12.5,
            }}
          >
            <Pill size={15} /> Submódulo Medicamentos y Curación
          </Link>
          <button
            type="button"
            onClick={() => setShowDictInfo(!showDictInfo)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.1)",
              border: `1px solid ${gold}`,
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Info size={14} /> {showDictInfo ? "Ocultar diccionario y reglas" : "Ver diccionario y formato"}
          </button>
        </div>
      </header>

      {/* Panel informativo desplegable del Diccionario y Reglas OIC */}
      {showDictInfo && (
        <div
          className="card card-pad"
          style={{
            marginBottom: 18,
            borderLeft: `4px solid ${gold}`,
            background: "#fbfcfe",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
            <div>
              <h3 style={{ color: navy, marginBottom: 6 }}>Diccionario Oficial de Catálogos</h3>
              <p className="small muted" style={{ marginBottom: 8 }}>
                Validación estricta sin posiciones fijas de columna (reconocimiento semántico de encabezados):
              </p>
              <div className="small" style={{ marginBottom: 6 }}>
                <b>Estatus permitidos:</b>{" "}
                <span className="badge">EN PROCESO</span>{" "}
                <span className="badge">RESCINDIDO</span>{" "}
                <span className="badge">SUSPENSIÓN DE LA RESCISIÓN</span>
              </div>
              <div className="small">
                <b>Fuentes permitidas:</b>{" "}
                <span className="badge">ÚNICA</span>{" "}
                <span className="badge">ÚNICA CON PATENTE</span>{" "}
                <span className="badge">PATENTE</span>{" "}
                <span className="badge">OTRA</span>
              </div>
            </div>
            <div>
              <h3 style={{ color: navy, marginBottom: 6 }}>Controles Automatizados (34 Reglas)</h3>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                <li><b>Numéricos y aritméticos:</b> Monto vs Cantidad × Precio unitario, detección de IVA 16%, piezas enteras, cantidades negativas o en cero.</li>
                <li><b>Lógicos de suministro:</b> Solicitada vs Contratada, No entregada vs Solicitada/Contratada, entrega completa con pendientes.</li>
                <li><b>Cronológicos y jurídicos:</b> Fecha de corte, formalización vs inicio, suspensión sin fecha/sentido, soporte documental.</li>
                <li><b>Transversales por contrato:</b> Proveedores o estatus distintos en mismo contrato, variación de precios y montos globales repetidos.</li>
              </ul>
            </div>
            <div>
              <h3 style={{ color: brand, marginBottom: 6 }}>Garantía de Formato de Exportación</h3>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                <li><b>Hoja original intacta:</b> Conservada byte por byte sin ninguna alteración.</li>
                <li><b>Hoja adicional <code>REVISION OIC</code>:</b> Copia espejo con todos los registros, colores, encabezados, estilo de tabla y autofiltros originales.</li>
                <li><b>Columnas <code>Inconsistencia_1..N</code>:</b> Encabezado verde institucional (<code>#1C594B</code>) al final de la tabla.</li>
                <li><b>Resaltado amarillo (<code>#FFFF00</code>):</b> Aplicado tanto en las celdas de inconsistencia como en todas las celdas relacionadas del registro.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Paso 1: Carga de archivos y Fecha de Corte */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 16, color: navy }}>1 · Seleccionar layouts institucionales y fecha de corte</h2>
            <p className="muted small" style={{ marginTop: 3 }}>
              Cargue de 1 a 25 archivos <code>.xlsx</code>. Cada archivo se audita de forma independiente conservando intactas sus hojas originales.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={loadLayout160Demo}
            className="btn sm"
            style={{
              borderColor: gold,
              background: "#fbf8f1",
              color: navy,
              fontWeight: 650,
            }}
            id="btn-load-layout160"
          >
            <Sparkles size={14} style={{ color: brand }} />
            Probar con Layout 160 (Octubre 2026)
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 18, alignItems: "stretch" }}>
          {/* Zona de carga de archivos */}
          <label
            htmlFor="oic-file-input"
            className="dropzone"
            style={{
              padding: "22px 18px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderColor: files.length ? navy : undefined,
              background: files.length ? "#f4f7fb" : "#fff",
            }}
          >
            <Upload size={24} style={{ color: files.length ? navy : gold }} />
            <div style={{ fontWeight: 600, color: navy }}>
              {files.length > 0
                ? `${files.length} archivo(s) XLSX seleccionado(s)`
                : "Haga clic para seleccionar uno o varios archivos .xlsx"}
            </div>
            <div className="small muted">
              {files.length > 0
                ? files.map((f) => f.name).join(" · ")
                : "Soporta carga individual o múltiple (devolución en paquete ZIP institucional)"}
            </div>
            <input
              id="oic-file-input"
              type="file"
              multiple
              accept=".xlsx"
              onChange={(e) => {
                const selected = Array.from(e.target.files || []);
                setFiles(selected);
                setPreview(null);
                setError("");
              }}
              style={{ display: "none" }}
            />
          </label>

          {/* Fecha de corte y resumen de selección */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "14px 16px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--bg)",
              gap: 12,
            }}
          >
            <label className="field" htmlFor="oic-cutoff-date">
              <span>Fecha de corte oficial</span>
              <input
                id="oic-cutoff-date"
                type="date"
                required
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
                className="input"
                style={{ fontWeight: 600 }}
              />
            </label>
            <div className="small muted" style={{ lineHeight: 1.4 }}>
              Las fechas de notificación, formalización o suspensión posteriores al corte se marcan como error cronológico.
            </div>
          </div>
        </div>

        {/* Lista de archivos cargados si hay varios */}
        {files.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {files.map((f, idx) => (
              <span
                key={`${f.name}-${idx}`}
                className="badge"
                style={{
                  padding: "4px 10px",
                  background: "#eef3f9",
                  color: navy,
                  border: "1px solid #cfdcea",
                }}
              >
                <FileSpreadsheet size={13} />
                {f.name} ({(f.size / 1024).toFixed(1)} KB)
                <button
                  type="button"
                  onClick={() => {
                    const next = files.filter((_, i) => i !== idx);
                    setFiles(next);
                    setPreview(null);
                  }}
                  style={{
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    color: brand,
                    display: "inline-flex",
                    padding: 2,
                  }}
                  title="Quitar archivo"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Botones de Acción */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16, alignItems: "center" }}>
          <button
            type="button"
            id="btn-oic-analyze"
            disabled={busy || !files.length || !cutoff}
            onClick={() => analyze()}
            style={{
              border: "none",
              background: brand,
              color: "#fff",
              borderRadius: 8,
              cursor: busy || !files.length || !cutoff ? "not-allowed" : "pointer",
              padding: "11px 20px",
              fontWeight: 700,
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              opacity: busy || !files.length || !cutoff ? 0.55 : 1,
            }}
          >
            <Play size={15} />
            {busy ? "Procesando validaciones OIC…" : "ANALIZAR Y PREVISUALIZAR"}
          </button>

          <button
            type="button"
            id="btn-oic-export-xlsx"
            disabled={busy || !files.length || !cutoff}
            onClick={() => exportExcel("auto")}
            style={{
              border: "none",
              background: navy,
              color: "#fff",
              borderRadius: 8,
              cursor: busy || !files.length || !cutoff ? "not-allowed" : "pointer",
              padding: "11px 20px",
              fontWeight: 700,
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              opacity: busy || !files.length || !cutoff ? 0.55 : 1,
            }}
          >
            <Download size={15} />
            {files.length > 1
              ? "EXPORTAR PAQUETE ZIP DE DEVOLUCIONES (.zip)"
              : "EXPORTAR EXCEL OBSERVADO (_REVISION_OIC.xlsx)"}
          </button>

          {files.length === 1 && (
            <button
              type="button"
              id="btn-oic-export-zip"
              disabled={busy || !files.length || !cutoff}
              onClick={() => exportExcel("zip")}
              className="btn"
              style={{
                borderColor: navy,
                color: navy,
                padding: "10px 16px",
                fontWeight: 650,
              }}
              title="Descargar archivo Excel revisado junto con el concentrado RESUMEN_REVISION_OIC.csv en formato ZIP"
            >
              <FileArchive size={15} />
              Descargar también en ZIP (+ Resumen CSV)
            </button>
          )}
        </div>

        {error && (
          <div className="alert err" role="alert" style={{ marginTop: 14 }}>
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Paso 2: Resultados e Inspector de Inconsistencias */}
      {preview && totals && (
        <div className="stack">
          {/* Tarjetas KPI globales */}
          <div className="kpi-grid">
            <div className="card kpi">
              <div className="k-name">
                <span>Archivos Auditados</span>
                <FileSpreadsheet size={15} />
              </div>
              <div className="k-val">{preview.archivos.length}</div>
              <div className="k-foot">Fecha de corte: {preview.fecha_corte}</div>
            </div>

            <div className="card kpi">
              <div className="k-name">
                <span>Registros Evaluados</span>
                <CheckCircle2 size={15} />
              </div>
              <div className="k-val">{totals.registros.toLocaleString("es-MX")}</div>
              <div className="k-foot">
                {totals.filas.toLocaleString("es-MX")} filas con observaciones
              </div>
            </div>

            <div className="card kpi attn" onClick={() => setSevFilter("TODAS")}>
              <div className="k-name">
                <span>Total Inconsistencias</span>
                <AlertTriangle size={15} style={{ color: brand }} />
              </div>
              <div className="k-val" style={{ color: brand }}>
                {totals.inconsistencias.toLocaleString("es-MX")}
              </div>
              <div className="k-foot">Clic para mostrar todas las categorías</div>
            </div>

            <div
              className="card kpi attn"
              onClick={() => setSevFilter(sevFilter === "ERROR" ? "TODAS" : "ERROR")}
              style={{ outline: sevFilter === "ERROR" ? `2px solid ${brand}` : undefined }}
            >
              <div className="k-name">
                <span>Errores Verificables</span>
                <span className="badge bad">ERROR</span>
              </div>
              <div className="k-val" style={{ color: brand }}>
                {totals.errores.toLocaleString("es-MX")}
              </div>
              <div className="k-foot">Diferencias aritméticas o contradicciones</div>
            </div>

            <div
              className="card kpi gold"
              onClick={() => setSevFilter(sevFilter === "REVISAR" ? "TODAS" : "REVISAR")}
              style={{ outline: sevFilter === "REVISAR" ? `2px solid ${gold}` : undefined }}
            >
              <div className="k-name">
                <span>Por Revisar / Diccionario</span>
                <span className="badge warn">REVISAR</span>
              </div>
              <div className="k-val" style={{ color: "#8a6a2f" }}>
                {totals.revisar.toLocaleString("es-MX")}
              </div>
              <div className="k-foot">Confirmación institucional o catálogo</div>
            </div>

            <div
              className="card kpi"
              onClick={() => setSevFilter(sevFilter === "DOCUMENTAL" ? "TODAS" : "DOCUMENTAL")}
              style={{ outline: sevFilter === "DOCUMENTAL" ? `2px solid ${navy}` : undefined }}
            >
              <div className="k-name">
                <span>Soporte Documental</span>
                <span className="badge">DOCUMENTAL</span>
              </div>
              <div className="k-val" style={{ color: navy }}>
                {totals.documental.toLocaleString("es-MX")}
              </div>
              <div className="k-foot">Evidencia u oficio por acreditar</div>
            </div>
          </div>

          {/* Selector de archivo cuando se cargan varios */}
          {preview.archivos.length > 1 && (
            <div className="card card-pad" style={{ padding: "12px 18px" }}>
              <div className="row wrap">
                <span className="small muted" style={{ fontWeight: 700, textTransform: "uppercase" }}>
                  Institución / Archivo:
                </span>
                {preview.archivos.map((arch, idx) => (
                  <button
                    key={arch.archivo}
                    type="button"
                    onClick={() => {
                      setActiveFileIdx(idx);
                      setRuleFilter("TODAS");
                    }}
                    className={"btn sm " + (idx === activeFileIdx ? "primary" : "")}
                  >
                    <FileSpreadsheet size={14} />
                    {arch.archivo} ({arch.inconsistencias})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Detalle del archivo activo */}
          {activeResult && (
            <div className="card">
              <div
                className="card-head"
                style={{
                  borderBottom: `2px solid ${gold}`,
                  background: "#fbfcfe",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <h2 style={{ fontSize: 16 }}>{activeResult.archivo}</h2>
                    <span className="badge">Hoja fuente: {activeResult.hoja}</span>
                    <span className="badge ok">Hoja original intacta</span>
                    <span
                      className="badge"
                      style={{ background: "#1C594B", color: "#fff" }}
                    >
                      Hoja agregada: REVISION OIC
                    </span>
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {activeResult.registros} registros auditados · {activeResult.filas_observadas} filas con observaciones · {activeResult.inconsistencias} inconsistencias totales
                  </div>
                </div>

                <div className="row wrap">
                  <button
                    type="button"
                    onClick={() => exportExcel("auto")}
                    className="btn primary sm"
                  >
                    <Download size={14} /> Descargar Excel con REVISION OIC
                  </button>
                </div>
              </div>

              {/* Desglose por Regla (filtros rápidos interactivos) */}
              <div
                style={{
                  padding: "12px 18px",
                  borderBottom: "1px solid var(--line)",
                  background: "#f7f9fc",
                }}
              >
                <div className="small muted" style={{ fontWeight: 650, marginBottom: 8 }}>
                  DESGLOSE POR REGLA DE VALIDACIÓN (CLIC PARA FILTRAR):
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setRuleFilter("TODAS")}
                    className="btn sm"
                    style={{
                      background: ruleFilter === "TODAS" ? navy : "#fff",
                      color: ruleFilter === "TODAS" ? "#fff" : navy,
                      borderColor: ruleFilter === "TODAS" ? navy : "var(--line-strong)",
                    }}
                  >
                    Todas las reglas ({activeResult.inconsistencias})
                  </button>
                  {Object.entries(activeResult.por_regla).map(([regla, count]) => {
                    const active = ruleFilter === regla;
                    return (
                      <button
                        key={regla}
                        type="button"
                        onClick={() => setRuleFilter(active ? "TODAS" : regla)}
                        className="btn sm"
                        style={{
                          background: active ? brand : "#fff",
                          color: active ? "#fff" : navy,
                          borderColor: active ? brand : "var(--line-strong)",
                          fontSize: 11.5,
                        }}
                      >
                        <code>{regla}</code>
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 999,
                            background: active ? "rgba(255,255,255,0.2)" : "#eef2f7",
                            fontWeight: 700,
                          }}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Barra de búsqueda y filtro de categoría */}
              <div
                style={{
                  padding: "12px 18px",
                  borderBottom: "1px solid var(--line)",
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div className="row wrap" style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
                    <Search
                      size={15}
                      style={{
                        position: "absolute",
                        left: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "var(--muted)",
                      }}
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar por contrato, fila, celda, campo o detalle…"
                      className="input"
                      style={{ width: "100%", paddingLeft: 32 }}
                    />
                  </div>

                  <div className="seg">
                    {(["TODAS", "ERROR", "REVISAR", "DOCUMENTAL"] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={sevFilter === cat ? "on" : ""}
                        onClick={() => setSevFilter(cat)}
                      >
                        {cat === "TODAS" ? "Todas" : cat}
                      </button>
                    ))}
                  </div>

                  {(sevFilter !== "TODAS" || ruleFilter !== "TODAS" || searchQuery) && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => {
                        setSevFilter("TODAS");
                        setRuleFilter("TODAS");
                        setSearchQuery("");
                      }}
                    >
                      <Filter size={13} /> Limpiar filtros
                    </button>
                  )}
                </div>

                <div className="small muted">
                  Mostrando <b>{filteredHallazgos.length}</b> de{" "}
                  <b>{activeResult.hallazgos_muestra.length}</b> inconsistencias identificadas
                </div>
              </div>

              {/* Tabla de Hallazgos */}
              <div className="table-wrap" style={{ maxHeight: 540 }}>
                <table className="t">
                  <thead>
                    <tr style={{ background: navy, color: "#fff" }}>
                      <th style={{ background: navy, color: "#fff", width: 65 }}>Fila</th>
                      <th style={{ background: navy, color: "#fff", width: 90 }}>Celda</th>
                      <th style={{ background: navy, color: "#fff", width: 115 }}>Categoría</th>
                      <th style={{ background: navy, color: "#fff", width: 210 }}>Contrato</th>
                      <th style={{ background: navy, color: "#fff", width: 210 }}>Regla / Campo</th>
                      <th style={{ background: navy, color: "#fff" }}>Inconsistencia Detectada</th>
                      <th style={{ background: navy, color: "#fff" }}>Acción Requerida en REVISION OIC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHallazgos.map((h, i) => (
                      <tr key={`${h.fila}-${h.celda}-${h.regla}-${i}`}>
                        <td className="mono" style={{ fontWeight: 700 }}>
                          {h.fila}
                        </td>
                        <td className="mono">
                          <span
                            style={{
                              background: "#FFFF00",
                              color: "#111111",
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontWeight: 700,
                              border: "1px solid #d4c600",
                            }}
                            title="Celda resaltada en amarillo (#FFFF00) en la hoja REVISION OIC"
                          >
                            {h.celda}
                          </span>
                          {h.celdas_relacionadas && h.celdas_relacionadas.length > 0 && (
                            <div className="small muted" style={{ marginTop: 3, fontSize: 10.5 }}>
                              Rel:{" "}
                              {h.celdas_relacionadas.map((rc) => (
                                <span
                                  key={rc}
                                  style={{
                                    background: "#fff9b0",
                                    color: "#111",
                                    padding: "0 4px",
                                    borderRadius: 3,
                                    marginRight: 3,
                                    border: "1px solid #e2d64b",
                                  }}
                                >
                                  {rc}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className={
                              "badge " +
                              (h.categoria === "ERROR"
                                ? "bad"
                                : h.categoria === "REVISAR"
                                ? "warn"
                                : "")
                            }
                          >
                            {h.categoria}
                          </span>
                        </td>
                        <td
                          className="mono"
                          style={{
                            maxWidth: 220,
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            fontWeight: 600,
                            color: navy,
                          }}
                        >
                          {h.contrato || "—"}
                        </td>
                        <td style={{ whiteSpace: "normal", maxWidth: 230 }}>
                          <div style={{ fontWeight: 700, fontSize: 11.5, color: navy }}>
                            {h.regla}
                          </div>
                          <div className="small muted">{h.campo}</div>
                        </td>
                        <td style={{ whiteSpace: "normal", maxWidth: 380, lineHeight: 1.4 }}>
                          {h.detalle}
                        </td>
                        <td
                          style={{
                            whiteSpace: "normal",
                            maxWidth: 340,
                            lineHeight: 1.4,
                            color: "var(--muted)",
                          }}
                        >
                          {h.accion}
                        </td>
                      </tr>
                    ))}
                    {filteredHallazgos.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: 32 }} className="muted">
                          No se encontraron inconsistencias con los filtros seleccionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  padding: "12px 18px",
                  borderTop: "1px solid var(--line)",
                  background: "#fbfcfe",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <span className="small muted">
                  En el archivo Excel exportado, la hoja original (<b>{activeResult.hoja}</b>) permanece intacta byte por byte y la hoja <b>REVISION OIC</b> incorpora las columnas <code>Inconsistencia_1..N</code> en verde oscuro (<code>#1C594B</code>) con fondo amarillo (<code>#FFFF00</code>) en observaciones y celdas relacionadas.
                </span>
              </div>
            </div>
          )}

          {!!preview.errores?.length && (
            <div className="alert err" role="alert">
              <AlertTriangle size={16} />
              <span>
                Archivos omitidos:{" "}
                {preview.errores.map((e) => `${e.archivo}: ${e.error}`).join("; ")}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

