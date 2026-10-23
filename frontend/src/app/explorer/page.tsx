"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, download, toApiFilter } from "@/lib/api";
import { useApp } from "@/lib/state";
import { fmtDate, num } from "@/lib/format";
import FilterBar from "@/components/FilterBar";

export default function ExplorerPage() {
  const { active, apiFilter, applied, track, toast } = useApp();
  const [data, setData] = useState<{ total: number; offset: number; limit: number; rows: any[] }>({
    total: 0,
    offset: 0,
    limit: 50,
    rows: [],
  });
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [visibleCols, setVisibleCols] = useState<string[]>([]);
  const [showColModal, setShowColModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Inicializar columnas visibles cuando cambie el dataset activo
  useEffect(() => {
    if (active?.columns) {
      const initial = active.columns.slice(0, 10).map((c) => c.name);
      setVisibleCols(initial);
      setSortCol(null);
      setData((d) => ({ ...d, offset: 0 }));
    }
  }, [active?.id]);

  const loadRows = async (offset = data.offset, limit = data.limit) => {
    if (!active) return;
    try {
      setLoading(true);
      const res = await track(
        api(`/api/datasets/${active.id}/rows`, {
          body: {
            filters: apiFilter,
            search: search.trim() || null,
            sort: sortCol,
            desc: sortDesc,
            offset,
            limit,
          },
        })
      );
      setData({
        total: res.total || 0,
        offset: res.offset !== undefined ? res.offset : offset,
        limit: res.limit !== undefined ? res.limit : limit,
        rows: res.rows || [],
      });
    } catch (e: any) {
      toast(e.message || "Error al cargar registros", true);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    if (active) {
      loadRows(0, data.limit);
    }
  }, [active?.id, applied, sortCol, sortDesc]); // eslint-disable-line


  const inspectRow = async (rowId: number) => {
    if (!active) return;
    try {
      const rec = await track(api(`/api/datasets/${active.id}/records/${rowId}`));
      setSelectedRecord(rec);
    } catch (e: any) {
      toast(e.message || "No se pudo obtener el detalle de auditoría", true);
    }
  };

  const toggleSort = (colName: string) => {
    if (sortCol === colName) {
      if (sortDesc) {
        setSortCol(null);
        setSortDesc(false);
      } else {
        setSortDesc(true);
      }
    } else {
      setSortCol(colName);
      setSortDesc(false);
    }
  };

  const handleExport = () => {
    if (!active) return;
    download(
      `/api/datasets/${active.id}/export.csv`,
      { filters: apiFilter, search: search.trim() || null },
      `${active.name}_registros.csv`
    ).catch((e) => toast(e.message, true));
  };


  if (!active) {
    return (
      <div className="card text-center stack pad-lg" style={{ maxWidth: "600px", margin: "3rem auto" }}>
        <h2>Sin conjunto de datos activo</h2>
        <p className="muted">Seleccione o cargue una base de datos para explorar sus registros.</p>
        <Link href="/datasets" className="btn btn-primary" style={{ margin: "1rem auto 0" }}>
          Ir a Administrador de Datos
        </Link>
      </div>
    );
  }

  const allCols = active.columns || [];
  const activeCols = allCols.filter((c) => visibleCols.includes(c.name));
  const isAll = data.limit >= 100000;
  const effectiveLimit = isAll ? Math.max(1, data.total) : (data.limit || 50);
  const totalPages = isAll ? 1 : Math.ceil((data.total || 0) / effectiveLimit) || 1;
  const currentPage = isAll ? 1 : Math.floor((data.offset || 0) / effectiveLimit) + 1;


  return (
    <div className="explorer-container stack" style={{ gap: "1.25rem" }}>
      {/* Barra superior de herramientas */}
      <div className="card" style={{ padding: "1rem 1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>
              Explorador de Datos: {active.name}
            </h1>
            <div className="muted small">
              {num(data.total)} registros que coinciden con los criterios actuales
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            {/* Buscador rápido */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                loadRows(0, data.limit);
              }}
              style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
            >
              <input
                type="text"
                className="input"
                placeholder="Buscar término…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "200px" }}
              />
              <button type="submit" className="btn icon ghost" title="Buscar">
                <Search size={16} />
              </button>
            </form>

            {/* Selector de columnas */}
            <button className="btn" onClick={() => setShowColModal(true)} title="Seleccionar columnas visibles">
              <Columns size={16} />
              Columnas ({visibleCols.length})
            </button>

            {/* Exportar CSV */}
            <button className="btn" onClick={handleExport} title="Descargar todas las filas filtradas en CSV">
              <Download size={16} />
              Exportar CSV
            </button>

            <button className="btn icon ghost" onClick={() => loadRows(data.offset, data.limit)} title="Actualizar">
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Barra de Filtros Integrada */}
      <FilterBar />

      {/* Tabla Principal */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto", maxHeight: "65vh" }}>
          <table className="table" style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--card-bg, #1e293b)", zIndex: 10 }}>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>#</th>
                <th style={{ width: "80px" }}>Periodo</th>
                {activeCols.map((c) => (
                  <th
                    key={c.name}
                    onClick={() => toggleSort(c.name)}
                    style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                    title={`Tipo: ${c.type}${c.role ? ` · Rol: ${active.role_labels[c.role] || c.role}` : ""}`}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      <span>{c.name}</span>
                      <ArrowUpDown size={12} style={{ opacity: sortCol === c.name ? 1 : 0.3 }} />
                    </div>
                  </th>
                ))}
                <th style={{ width: "60px", textAlign: "center" }}>Auditoría</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={activeCols.length + 3} style={{ textAlign: "center", padding: "3rem" }} className="muted">
                    No se encontraron registros con los filtros activos.
                  </td>
                </tr>
              ) : (
                data.rows.map((row, idx) => (
                  <tr key={row._row_id || idx} className={row._issues ? "row-warning" : ""}>
                    <td style={{ textAlign: "center", color: "var(--muted)" }}>{(data.offset || 0) + idx + 1}</td>

                    <td>
                      <span className="badge" style={{ fontSize: "0.75rem" }}>{row._period || "—"}</span>
                    </td>
                    {activeCols.map((c) => {
                      const val = row[c.name];
                      const isMoney = c.role === "amount" || c.role === "unit_price";
                      return (
                        <td key={c.name} style={{ textAlign: c.type === "number" ? "right" : "left", whiteSpace: "nowrap" }}>
                          {val === null || val === undefined ? (
                            <span className="muted" style={{ fontStyle: "italic" }}>∅</span>
                          ) : isMoney && typeof val === "number" ? (
                            `$${val.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          ) : typeof val === "number" ? (
                            val.toLocaleString("es-MX")
                          ) : (
                            String(val)
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "center" }}>
                      <button
                        className="btn icon ghost"
                        onClick={() => inspectRow(row._row_id)}
                        title="Ver detalle de trazabilidad y datos originales"
                        style={{ padding: "0.2rem" }}
                      >
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.75rem 1.25rem",
            borderTop: "1px solid var(--border)",
            background: "var(--card-head-bg)",
          }}
        >
          <div className="muted small">
            {isAll ? (
              <span>Mostrando <b>todos los movimientos ({data.rows.length.toLocaleString("es-MX")})</b></span>
            ) : (
              <span>Página {currentPage} de {totalPages} · Mostrando {data.rows.length} de {num(data.total)}</span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <select
              className="select"
              value={data.limit >= 100000 ? 100000 : data.limit}
              onChange={(e) => {
                const newLim = parseInt(e.target.value);
                loadRows(0, newLim);
              }}
              style={{ padding: "0.25rem 0.6rem", fontSize: "0.82rem", fontWeight: 550 }}
            >
              <option value={25}>25 filas</option>
              <option value={50}>50 filas</option>
              <option value={100}>100 filas</option>
              <option value={250}>250 filas</option>
              <option value={500}>500 filas</option>
              <option value={1000}>1,000 filas</option>
              <option value={100000}>Todos los movimientos ({num(data.total)})</option>
            </select>

            <button
              className="btn icon"
              disabled={isAll || data.offset === 0}
              onClick={() => loadRows(Math.max(0, data.offset - data.limit), data.limit)}
              title="Página anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="btn icon"
              disabled={isAll || data.offset + data.limit >= data.total}
              onClick={() => loadRows(data.offset + data.limit, data.limit)}
              title="Página siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal / Cajón de Trazabilidad y Detalle del Registro */}
      {selectedRecord && (
        <div className="modal-backdrop" onClick={() => setSelectedRecord(null)}>
          <div className="modal" style={{ maxWidth: "700px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3 style={{ margin: 0 }}>Trazabilidad del Registro #{selectedRecord.typed._row_id}</h3>
                <div className="muted small">
                  Archivo origen: {selectedRecord.source?.file || "N/A"} · Hoja: {selectedRecord.source?.sheet || "N/A"} · Periodo: {selectedRecord.source?.period}
                </div>
              </div>
              <button className="btn icon ghost" onClick={() => setSelectedRecord(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body stack" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              {selectedRecord.typed._issues && (
                <div className="alert alert-warning" style={{ margin: "0.5rem 0" }}>
                  <strong>Observaciones detectadas:</strong> {selectedRecord.typed._issues}
                </div>
              )}
              <table className="table" style={{ width: "100%", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th>Campo</th>
                    <th>Valor Tipificado (Sistema)</th>
                    <th>Valor Original (Archivo Fuente)</th>
                  </tr>
                </thead>
                <tbody>
                  {allCols.map((c) => {
                    const typedVal = selectedRecord.typed[c.name];
                    const rawVal = selectedRecord.original[c.name];
                    const diff = typedVal !== rawVal && rawVal !== undefined;
                    return (
                      <tr key={c.name} style={{ background: diff ? "rgba(59, 130, 246, 0.05)" : "transparent" }}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td>{typedVal === null ? <span className="muted">∅</span> : String(typedVal)}</td>
                        <td style={{ color: diff ? "#60a5fa" : "inherit" }}>
                          {rawVal === null || rawVal === undefined ? <span className="muted">∅</span> : String(rawVal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setSelectedRecord(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para selección de columnas */}
      {showColModal && (
        <div className="modal-backdrop" onClick={() => setShowColModal(false)}>
          <div className="modal" style={{ maxWidth: "500px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 style={{ margin: 0 }}>Columnas Visibles</h3>
              <button className="btn icon ghost" onClick={() => setShowColModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: "50vh", overflowY: "auto" }}>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <button
                  className="btn btn-sm"
                  onClick={() => setVisibleCols(allCols.map((c) => c.name))}
                >
                  Seleccionar todas
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setVisibleCols(allCols.slice(0, 5).map((c) => c.name))}
                >
                  Primeras 5
                </button>
              </div>
              <div className="stack" style={{ gap: "0.4rem" }}>
                {allCols.map((c) => (
                  <label key={c.name} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(c.name)}
                      onChange={(e) => {
                        if (e.target.checked) setVisibleCols([...visibleCols, c.name]);
                        else setVisibleCols(visibleCols.filter((x) => x !== c.name));
                      }}
                    />
                    <span>{c.name}</span>
                    <span className="tag" style={{ marginLeft: "auto", fontSize: "0.7rem" }}>{c.type}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-primary" onClick={() => setShowColModal(false)}>
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
