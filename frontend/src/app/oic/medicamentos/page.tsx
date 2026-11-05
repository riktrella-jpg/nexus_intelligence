"use client";
import Link from "next/link";
import { CheckCircle2, FileCheck2, Layers, Pill, ShieldCheck } from "lucide-react";

const brand = "#682138";
const navy = "#193B59";
const gold = "#C5AA72";

export default function OicMedicamentosPage() {
  const camposPrevistos = [
    { key: "clave", desc: "Clave CNIS / CBM del medicamento o insumo para la salud" },
    { key: "descripcion", desc: "Denominación genérica, concentración y presentación" },
    { key: "contrato", desc: "Número de instrumento contractual o pedido" },
    { key: "proveedor", desc: "Razón social del proveedor o distribuidor adjudicado" },
    { key: "cantidad_minima / cantidad_maxima", desc: "Rango de piezas contratadas (mínimo y máximo)" },
    { key: "cantidad_entregada", desc: "Volumen efectivamente suministrado y recibido" },
    { key: "precio_unitario / monto_maximo", desc: "Validación aritmética de importes sin IVA vs precios adjudicados" },
    { key: "registro_sanitario", desc: "Vigencia y consistencia del registro sanitario COFEPRIS" },
    { key: "caducidad", desc: "Control cronológico de vigencia de lotes y carta canje" },
  ];

  return (
    <section style={{ color: navy, maxWidth: 1280, margin: "0 auto" }}>
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
            <ShieldCheck size={14} /> CONTROL DE CALIDAD OIC · ARQUITECTURA MODULAR
          </div>
          <h1 style={{ fontSize: 23, margin: "0 0 6px", color: "#fff" }}>
            REVISIÓN OIC · MEDICAMENTOS (ARQUITECTURA PREPARADA)
          </h1>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            Módulo independiente del motor de rescisiones · Infraestructura OOXML y espejo REVISION OIC lista para incorporación de reglas específicas
          </div>
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
            }}
          >
            <FileCheck2 size={15} /> Ir a Submódulo Rescisiones (Activo)
          </Link>
          <span
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
            <Pill size={15} /> Submódulo Medicamentos
          </span>
        </div>
      </header>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 18 }}>
        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <Layers size={18} style={{ color: brand }} />
            <h2 style={{ fontSize: 16 }}>Separación de Motores de Reglas</h2>
          </div>
          <p className="muted" style={{ marginBottom: 14, lineHeight: 1.55 }}>
            La arquitectura de <b>CONTROL DE CALIDAD OIC</b> fue diseñada para mantener el motor de{" "}
            <b>MEDICAMENTOS</b> (<code>backend/app/oic/motor_medicamentos.py</code>) completamente desacoplado del motor de{" "}
            <b>RESCISIONES</b> (<code>revisor_rescisiones_portable.py</code> y <code>motor_validaciones_ampliado.py</code>).
          </p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              <b>Independencia de reglas y catálogos:</b> Ninguna regla de medicamentos altera las 34 validaciones de rescisiones ni su diccionario (<code>catalogos.json</code>).
            </li>
            <li>
              <b>Infraestructura OOXML compartida:</b> Reutiliza <code>ooxml_rescision.py</code> para lectura nativa XML sin alterar tablas dinámicas ni formatos originales.
            </li>
            <li>
              <b>Generador de hoja espejo <code>REVISION OIC</code>:</b> Reutiliza <code>generar_hoja_oic.py</code> y <code>verificar_excel.py</code> para garantizar hojas originales intactas byte por byte y resaltado amarillo (<code>#FFFF00</code>).
            </li>
          </ul>
        </div>

        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <CheckCircle2 size={18} style={{ color: navy }} />
            <h2 style={{ fontSize: 16 }}>Esquema de Campos Previstos (Medicamentos)</h2>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {camposPrevistos.map((c) => (
              <div
                key={c.key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "7px 10px",
                  borderRadius: 7,
                  background: "#f7f9fc",
                  border: "1px solid var(--line)",
                  gap: 12,
                }}
              >
                <code style={{ fontWeight: 700, color: brand, fontSize: 12 }}>{c.key}</code>
                <span className="small muted" style={{ textAlign: "right" }}>
                  {c.desc}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
