"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";

/** Nexus / OIC: revisión dual · archivos originales preservados.
 * apiBase opcional: proxy del frontend o backend en dominio distinto.
 */
export default function SuministroRevision({ apiBase = "" }) {
  const [file, setFile] = useState(null);
  const [modo, setModo] = useState("ambos");
  const [fecha, setFecha] = useState("2026-10-31");
  const [hoja, setHoja] = useState("");
  const [dias, setDias] = useState(15);
  const [tolContratado, setTolContratado] = useState("1");
  const [tolEjercido, setTolEjercido] = useState("0.01");
  const [extras, setExtras] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch(`${apiBase}/api/oic/suministro/salud`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.estado === "activo") setHealth(d);
      })
      .catch(() => {});
  }, [apiBase]);

  const css = {
    root: { fontFamily: "Inter, Arial, sans-serif", color: "#1b334f", maxWidth: 1380, margin: "0 auto" },
    panel: {
      padding: 24,
      background: "#fff",
      border: "1px solid #dce3ed",
      borderRadius: 12,
      boxShadow: "0 3px 14px #14243b09",
    },
    label: { fontWeight: 650, fontSize: 13, display: "block", color: "#193B59" },
    input: {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      marginTop: 8,
      padding: "11px 12px",
      background: "#fbfcfe",
      border: "1px solid #bccad8",
      borderRadius: 7,
      fontSize: 13.5,
      color: "#1b334f",
    },
    btn: {
      border: 0,
      padding: "13px 22px",
      fontWeight: 750,
      color: "#fff",
      borderRadius: 9,
      background: "linear-gradient(120deg, #193B59, #682138)",
      cursor: "pointer",
      fontSize: 14,
    },
    metric: {
      border: "1px solid #dfe4ed",
      borderRadius: 9,
      padding: 14,
      minWidth: 145,
      flex: "1 0 145px",
      background: "#fbfcfe",
    },
  };

  const n = (header) => Number(summary?.headers?.[header] || 0);

  async function submit(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setSummary(null);
    try {
      const f = new FormData();
      f.append("archivo", file);
      f.append("modo", modo);
      f.append("fecha_corte", fecha);
      f.append("hoja", hoja);
      f.append("dias_pendiente", String(dias));
      f.append("tolerancia_contratado", String(tolContratado));
      f.append("tolerancia_ejercido", String(tolEjercido));
      f.append("validaciones_adicionales", String(extras));

      const r = await fetch(`${apiBase}/api/oic/suministro/revisar`, { method: "POST", body: f });
      if (!r.ok) {
        let msg = `Error HTTP ${r.status}`;
        try {
          const j = await r.json();
          msg = j.detail || msg;
        } catch {}
        throw Error(msg);
      }

      const blob = await r.blob();
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `NEXUS_OIC_SUMINISTRO_${modo}_${fecha}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 12000);

      const keys = [
        "X-OIC-Registros",
        "X-OIC-Medicamentos",
        "X-OIC-Material",
        "X-OIC-Hallazgos",
        "X-OIC-Errores",
        "X-OIC-Revisar",
        "X-OIC-Informativos",
        "X-OIC-OK",
      ];
      setSummary({
        fileName: file.name,
        modo,
        fecha,
        headers: Object.fromEntries(keys.map((k) => [k, r.headers.get(k) || "0"])),
      });
    } catch (e) {
      setError(e.message || "No fue posible procesar el Excel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={css.root}>
      <header
        style={{
          ...css.panel,
          color: "#fff",
          background: "linear-gradient(135deg, #193B59 0%, #682138 100%)",
          borderBottom: "3px solid #C5AA72",
          marginBottom: 17,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 1.3, color: "#C5AA72" }}>
            CONTROL DE CALIDAD OIC · SUMINISTRO DUAL v2.0
          </div>
          <h2 style={{ margin: "8px 0 6px", fontSize: 22, color: "#fff" }}>
            Revisión de Medicamentos y Material de Curación
          </h2>
          <p style={{ opacity: 0.9, margin: 0, fontSize: 13.5 }}>
            17 reglas AE–AU por registro · Controles adicionales MX/MD/MC/SX · Señalamiento amarillo (#FFFF00) de celdas afectadas · Libro original intacto.
          </p>
          {health && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#e8d6af" }}>
              Motor activo: <b>{health.motor} v{health.version}</b> · Catálogo CNIS: <b>{Number(health.claves_cnis || 0).toLocaleString("es-MX")} claves</b> · Reglas AE–AU: <b>{health.reglas_ae_au}</b> · Controles adicionales: <b>{(health.controles_transversales || 0) + (health.controles_especificos || 0)}</b>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link
            href="/oic/rescisiones"
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
              textDecoration: "none",
            }}
          >
            Submódulo Rescisiones
          </Link>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              borderRadius: 8,
              background: "#C5AA72",
              color: "#101c2e",
              fontWeight: 700,
              fontSize: 12.5,
            }}
          >
            Submódulo Medicamentos y Curación (Activo)
          </span>
        </div>
      </header>

      <form style={css.panel} onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <label style={css.label}>
            Layout institucional (.xlsx)
            <input
              style={css.input}
              required
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <label style={css.label}>
            Tipo de revisión
            <select style={css.input} value={modo} onChange={(e) => setModo(e.target.value)}>
              <option value="ambos">Medicamentos + Material de Curación</option>
              <option value="medicamentos">Solo Medicamentos</option>
              <option value="material_curacion">Solo Material de Curación</option>
            </select>
          </label>
          <label style={css.label}>
            Fecha de corte
            <input
              style={css.input}
              type="date"
              required
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </label>
          <label style={css.label}>
            Hoja (opcional)
            <input
              style={css.input}
              value={hoja}
              placeholder="Automático: base"
              onChange={(e) => setHoja(e.target.value)}
            />
          </label>
          <label style={css.label}>
            Plazo de alerta (días)
            <input
              style={css.input}
              type="number"
              min={0}
              max={3650}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
            />
          </label>
          <label style={css.label}>
            Tolerancia contratado ($)
            <input
              style={css.input}
              type="number"
              step="0.01"
              min={0}
              value={tolContratado}
              onChange={(e) => setTolContratado(e.target.value)}
            />
          </label>
          <label style={css.label}>
            Tolerancia ejercido ($)
            <input
              style={css.input}
              type="number"
              step="0.01"
              min={0}
              value={tolEjercido}
              onChange={(e) => setTolEjercido(e.target.value)}
            />
          </label>
        </div>

        <label style={{ fontSize: 13, margin: "17px 0", display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={extras} onChange={(e) => setExtras(e.target.checked)} />
          Incluir controles complementarios (MX01–MX11, MD01, MC01, SX01: cantidades, importes, proveedores, secuencia y tipo de suministro)
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <button style={{ ...css.btn, opacity: busy || !file ? 0.65 : 1 }} type="submit" disabled={busy || !file}>
            {busy ? "Analizando registros y preparando Excel…" : "Revisar layout y descargar Excel"}
          </button>
          {file && !busy && (
            <span style={{ fontSize: 12.5, color: "#53657a" }}>
              Archivo seleccionado: <b>{file.name}</b> ({(file.size / (1024 * 1024)).toFixed(2)} MB)
            </span>
          )}
        </div>

        {error && (
          <p
            role="alert"
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 8,
              background: "#fdf2f4",
              border: "1px solid #f2c6ce",
              color: "#a5233b",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}
      </form>

      {summary && (
        <div style={{ ...css.panel, marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <h3 style={{ margin: 0, color: "#193B59" }}>Resultado de la revisión · {summary.fileName}</h3>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                background: "#eef6f0",
                color: "#1c594b",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              Excel descargado correctamente · Corte {summary.fecha}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {[
              ["Registros analizados", "X-OIC-Registros", "#193B59"],
              ["Medicamentos", "X-OIC-Medicamentos", "#193B59"],
              ["Material de Curación", "X-OIC-Material", "#193B59"],
              ["Total Hallazgos", "X-OIC-Hallazgos", "#682138"],
              ["Filas con ERROR", "X-OIC-Errores", "#b42318"],
              ["Filas REVISAR", "X-OIC-Revisar", "#9a6700"],
              ["Solo INFORMATIVO", "X-OIC-Informativos", "#1d4ed8"],
              ["Filas OK", "X-OIC-OK", "#1c594b"],
            ].map(([title, k, color]) => (
              <div key={k} style={{ ...css.metric, borderTop: `3px solid ${color}` }}>
                <strong style={{ fontSize: 22, color }}>{n(k).toLocaleString("es-MX")}</strong>
                <div style={{ fontSize: 12, color: "#5f7287", marginTop: 3 }}>{title}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: "#53657a", marginTop: 14, marginBottom: 0, lineHeight: 1.5 }}>
            El Excel descargado incluye las pestañas <b>REVISION OIC</b> (con las 17 columnas AE–AU, resultado AV, observaciones AW, acciones AX, códigos adicionales AY y total AZ, resaltando en amarillo <code>#FFFF00</code> las celdas involucradas en hallazgos ERROR o REVISAR), <b>OBSERVACIONES OIC</b> y <b>RESUMEN OIC</b>, conservando la hoja original institucional intacta byte por byte. Una fila puede registrar varios hallazgos simultáneos.
          </p>
        </div>
      )}
    </section>
  );
}
