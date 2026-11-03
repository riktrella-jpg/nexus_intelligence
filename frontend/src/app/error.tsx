"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error capturado en ErrorBoundary:", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div
        className="card card-pad stack"
        style={{
          maxWidth: 520,
          background: "#ffffff",
          border: "1px solid var(--line)",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)",
          borderRadius: 14,
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(239, 68, 68, 0.1)",
            color: "var(--burgundy)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AlertTriangle size={28} />
        </div>

        <div>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0 0 6px" }}>
            Ha ocurrido un problema al cargar esta vista
          </h2>
          <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>
            {error?.message || "La sesión o los datos de la vista no pudieron sincronizarse correctamente."}
          </p>
        </div>

        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          <button className="btn primary" onClick={() => reset()}>
            <RefreshCw size={15} />
            Reintentar
          </button>
          <Link href="/" className="btn ghost">
            <Home size={15} />
            Ir al Inicio
          </Link>
        </div>
      </div>
    </div>
  );
}

