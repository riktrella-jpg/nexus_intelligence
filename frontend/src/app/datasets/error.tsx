"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, Database } from "lucide-react";

export default function DatasetsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error en módulo Datasets:", error);
  }, [error]);

  return (
    <div style={{ padding: "2rem", maxWidth: 640, margin: "2rem auto" }}>
      <div className="card card-pad stack" style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, gap: 16 }}>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <div style={{ padding: 10, background: "rgba(239, 68, 68, 0.1)", borderRadius: 8, color: "var(--burgundy)" }}>
            <AlertCircle size={24} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.15rem" }}>Sincronización de Base de Datos</h3>
            <p className="muted small" style={{ margin: "2px 0 0" }}>
              {error?.message || "La vista se está actualizando con el nuevo despliegue."}
            </p>
          </div>
        </div>

        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          <button
            className="btn primary"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.reload();
              } else {
                reset();
              }
            }}
          >
            <RefreshCw size={14} />
            Actualizar página limpia
          </button>
          <Link href="/conciliacion" className="btn ghost">
            <Database size={14} />
            Ir a Conciliación
          </Link>
        </div>
      </div>
    </div>
  );
}

