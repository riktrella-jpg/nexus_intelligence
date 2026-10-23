"use client";
import Link from "next/link";
import { Database } from "lucide-react";
import { useApp } from "@/lib/state";

export function NoDataset() {
  const { loading, backendOk } = useApp();
  if (loading) return <div className="skeleton" style={{ height: 160 }} />;
  if (backendOk === false)
    return (
      <div className="card card-pad empty" id="backend-down">
        <b style={{ color: "var(--burgundy)" }}>No hay conexión con el servidor de análisis</b>
        <span>Inicie el backend (consulte docs/INSTALACION.md): <code>iniciar.ps1</code> o <code>uvicorn app.main:app --port 8000</code>.</span>
      </div>
    );
  return (
    <div className="card card-pad empty" id="no-dataset">
      <Database size={32} color="var(--steel)" />
      <b style={{ color: "var(--navy)", fontSize: 16 }}>Aún no hay información cargada</b>
      <span>NEXUS no muestra cifras de ejemplo. Importe un archivo Excel o CSV para generar indicadores, gráficas y análisis.</span>
      <Link className="btn primary" href="/datasets">Importar archivo</Link>
    </div>
  );
}

export function PhaseNotice({ title, phase, items }: { title: string; phase: string; items: string[] }) {
  return (
    <>
      <div className="page-head"><div><h1>{title}</h1><p className="sub">Módulo planificado para la {phase}. Aún no está implementado.</p></div></div>
      <div className="card card-pad stack">
        <div className="alert warn"><b>No disponible en esta versión.</b> Para no mostrar funciones aparentes, esta sección no contiene controles ni resultados de ejemplo.</div>
        <div><h3>Alcance previsto</h3><ul className="muted" style={{ lineHeight: 1.8 }}>{items.map((i) => <li key={i}>{i}</li>)}</ul></div>
      </div>
    </>
  );
}
