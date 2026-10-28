"use client";
import { useEffect, useState, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Filter,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import {
  getReconciliationSummary,
  getReconciliationContracts,
  getReconciliationItems,
  getReconciliationDetails,
  getReconciliationFilters,
  getReconciliationFiles,
  processReconciliation,
  api,
  API,
} from "@/lib/api";
import { parseAndReconcileExcel } from "@/lib/reconciliationEngine";
import { useApp } from "@/lib/state";
import { money, num } from "@/lib/format";

type TabType = "contratos" | "partidas" | "detalle";

export default function ConciliacionPage() {
  const { track, toast } = useApp();

  // State
  const [activeTab, setActiveTab] = useState<TabType>("contratos");
  const [summary, setSummary] = useState<any>(null);
  const [filterOpts, setFilterOpts] = useState<any>({ instituciones: [], proveedores: [], estados: [] });
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedInst, setSelectedInst] = useState("Todos");
  const [selectedProv, setSelectedProv] = useState("Todos");
  const [contratoFilter, setContratoFilter] = useState("");
  const [claveFilter, setClaveFilter] = useState("");
  const [selectedEstado, setSelectedEstado] = useState("Todos");

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState("monto_inferido");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Table Data
  const [tableData, setTableData] = useState<any>({ items: [], total: 0, total_pages: 0 });
  const [customDataset, setCustomDataset] = useState<{
    summary: any;
    contracts: any[];
    fileName: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showServerFilesModal, setShowServerFilesModal] = useState(false);
  const [serverFiles, setServerFiles] = useState<any[]>([]);
  const [selectedDrawerContract, setSelectedDrawerContract] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load summary and filter options
  const loadMeta = async () => {
    if (customDataset) {
      const insts = Array.from(new Set(customDataset.contracts.map((c) => c.institucion).filter(Boolean))).sort();
      const provs = Array.from(new Set(customDataset.contracts.map((c) => c.proveedor).filter(Boolean))).sort();
      setFilterOpts({
        instituciones: insts,
        proveedores: provs,
        estados: ["INFERIDO_COMPLETO", "PARCIAL_CON_PENDIENTES", "PENDIENTE_TOTAL"],
      });
      return;
    }
    try {
      const sumParams: any = {};
      if (selectedInst !== "Todos") sumParams.institucion = selectedInst;
      if (selectedProv !== "Todos") sumParams.proveedor = selectedProv;
      if (selectedEstado !== "Todos") sumParams.estado = selectedEstado;
      if (claveFilter) sumParams.clave_medicamento = claveFilter;
      if (contratoFilter) sumParams.contrato = contratoFilter;

      const [sum, opts] = await Promise.all([
        getReconciliationSummary(sumParams),
        getReconciliationFilters(),
      ]);
      setSummary(sum);
      setFilterOpts(opts);
    } catch (e: any) {
      toast(e.message || "Error al cargar resumen del motor", true);
    }
  };

  // Load current tab data
  const loadData = async () => {
    setLoading(true);
    try {
      if (customDataset) {
        let items = [...customDataset.contracts];
        if (search) {
          const s = search.toLowerCase();
          items = items.filter(
            (c) =>
              (c.contrato && c.contrato.toLowerCase().includes(s)) ||
              (c.proveedor && c.proveedor.toLowerCase().includes(s)) ||
              (c.institucion && c.institucion.toLowerCase().includes(s)) ||
              (c.razon && c.razon.toLowerCase().includes(s))
          );
        }
        if (selectedInst !== "Todos") items = items.filter((c) => c.institucion === selectedInst);
        if (selectedProv !== "Todos") items = items.filter((c) => c.proveedor === selectedProv);
        if (contratoFilter) items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contratoFilter.toLowerCase()));
        if (selectedEstado !== "Todos") items = items.filter((c) => c.estado === selectedEstado);

        items.sort((a, b) => {
          let valA = a[sortBy];
          let valB = b[sortBy];
          if (sortBy === "monto_inferido" || sortBy === "monto_revision" || sortBy === "filas" || sortBy === "partidas" || sortBy === "pendientes") {
            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;
            return sortDir === "asc" ? valA - valB : valB - valA;
          }
          const strA = String(valA || "").toLowerCase();
          const strB = String(valB || "").toLowerCase();
          return sortDir === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
        });

        const total = items.length;
        const totalPages = Math.ceil(total / pageSize);
        const offset = (page - 1) * pageSize;
        setTableData({
          items: items.slice(offset, offset + pageSize),
          total,
          page,
          page_size: pageSize,
          total_pages: totalPages,
        });

        let montoInferido = 0;
        let montoRevision = 0;
        let completos = 0;
        let parciales = 0;
        let pendientes = 0;
        let filas = 0;
        for (const c of items) {
          if (c.monto_inferido) montoInferido += parseFloat(c.monto_inferido) || 0;
          if (c.monto_revision) montoRevision += parseFloat(c.monto_revision) || 0;
          if (c.estado === "INFERIDO_COMPLETO") completos++;
          else if (c.estado === "PARCIAL_CON_PENDIENTES") parciales++;
          else pendientes++;
          filas += parseInt(c.filas, 10) || 0;
        }

        setSummary({
          has_data: true,
          total_filas: filas || customDataset.summary?.total_filas || 0,
          monto_inferido_total: Math.round(montoInferido * 100) / 100,
          monto_revision_total: Math.round(montoRevision * 100) / 100,
          total_contratos: items.length,
          contratos_completos: completos,
          contratos_parciales: parciales,
          contratos_pendientes: pendientes,
          filas_duplicadas_excluidas: customDataset.summary?.filas_duplicadas_excluidas || 0,
          filas_inferidas: customDataset.summary?.filas_inferidas || 0,
          filas_pendientes: customDataset.summary?.filas_pendientes || 0,
          partidas_candidatas: customDataset.summary?.partidas_candidatas || 0,
          meta: customDataset.summary?.meta,
        });
        return;
      }

      const params: any = {
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_dir: sortDir,
      };
      if (search) params.search = search;
      if (selectedInst !== "Todos") params.institucion = selectedInst;
      if (selectedProv !== "Todos") params.proveedor = selectedProv;
      if (contratoFilter) params.contrato = contratoFilter;
      if (claveFilter) params.clave_medicamento = claveFilter;
      if (selectedEstado !== "Todos") params.estado = selectedEstado;

      let res;
      if (activeTab === "contratos") {
        res = await getReconciliationContracts(params);
      } else if (activeTab === "partidas") {
        res = await getReconciliationItems(params);
      } else {
        res = await getReconciliationDetails(params);
      }
      setTableData(res);
    } catch (e: any) {
      toast(e.message || "Error al cargar registros", true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeta();
  }, [customDataset]);

  useEffect(() => {
    setPage(1);
    loadMeta();
  }, [activeTab, search, selectedInst, selectedProv, contratoFilter, claveFilter, selectedEstado]);

  useEffect(() => {
    loadData();
  }, [activeTab, page, pageSize, sortBy, sortDir, search, selectedInst, selectedProv, contratoFilter, claveFilter, selectedEstado, customDataset]);

  const handleResetFilters = () => {
    setSearch("");
    setSelectedInst("Todos");
    setSelectedProv("Todos");
    setContratoFilter("");
    setClaveFilter("");
    setSelectedEstado("Todos");
    setPage(1);
  };

  const handleExport = () => {
    const q = new URLSearchParams();
    q.append("view_type", activeTab);
    if (search) q.append("search", search);
    if (selectedInst !== "Todos") q.append("institucion", selectedInst);
    if (selectedProv !== "Todos") q.append("proveedor", selectedProv);
    if (contratoFilter) q.append("contrato", contratoFilter);
    if (claveFilter) q.append("clave_medicamento", claveFilter);
    if (selectedEstado !== "Todos") q.append("estado", selectedEstado);

    window.open(`/api/reconciliation/export?${q.toString()}`, "_blank");
  };

  const processSelectedFile = async (file: File) => {
    setProcessing(true);
    try {
      toast(`Procesando «${file.name}» con Motor V2...`);

      let res: any;
      try {
        // 1. Procesar en memoria en el cliente (soporta archivos de cualquier tamaño sin límite de 4.5MB)
        const buffer = await file.arrayBuffer();
        res = parseAndReconcileExcel(buffer, file.name);
      } catch (clientErr: any) {
        console.warn("Fallo procesamiento en cliente, intentando vía API:", clientErr);
        // 2. Si falla el parseo en cliente, enviar vía multipart/form-data al backend
        const fd = new FormData();
        fd.append("file", file);
        res = await processReconciliation(fd);
      }

      toast(`¡Archivo «${file.name}» cargado y conciliado exitosamente!`);
      setShowUploadModal(false);

      if (res?.contracts && Array.isArray(res.contracts)) {
        setCustomDataset({
          summary: res.summary,
          contracts: res.contracts,
          fileName: file.name,
        });
        setSelectedInst("Todos");
        setSelectedProv("Todos");
        setContratoFilter("");
        setClaveFilter("");
        setSelectedEstado("Todos");
        setSearch("");
        setPage(1);
      }
    } catch (err: any) {
      toast(err.message || "Error al procesar el archivo con el motor V2", true);
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleOpenServerFiles = async () => {
    try {
      const files = await getReconciliationFiles();
      setServerFiles(files);
      setShowServerFilesModal(true);
    } catch (e: any) {
      toast(e.message || "Error al consultar archivos del servidor", true);
    }
  };

  const handleProcessServerFile = async (filePath: string) => {
    setProcessing(true);
    try {
      toast("Ejecutando motor de conciliación V2 sobre archivo seleccionado...");
      await processReconciliation({ file_path: filePath });
      toast("¡Conciliación V2 ejecutada exitosamente!");
      setShowServerFilesModal(false);
      await loadMeta();
      await loadData();
    } catch (e: any) {
      toast(e.message || "Error al procesar archivo", true);
    } finally {
      setProcessing(false);
    }
  };

  const statusBadge = (st: string) => {
    if (st === "INFERIDO_COMPLETO" || st === "INFERIDO_PARTIDA") {
      return <span className="badge ok">✓ Conciliado</span>;
    }
    if (st === "PARCIAL_CON_PENDIENTES") {
      return <span className="badge warn">⚠️ Parcial c/ pendientes</span>;
    }
    if (st === "DUPLICADO_NO_SUMAR") {
      return <span className="badge" style={{ background: "#e2e8f0", color: "#475569" }}>Doble fila (no sumar)</span>;
    }
    if (st === "PENDIENTE_DUPLICADO") {
      return <span className="badge warn">Pendiente duplicado</span>;
    }
    return <span className="badge bad">Pendiente revisión</span>;
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1>Conciliación de montos contratados</h1>
            <span className="badge" style={{ background: "rgba(176,146,91,.15)", color: "var(--gold)", fontWeight: 700 }}>
              Motor V2
            </span>
          </div>
          <p className="sub">
            Reglas reproducibles de deduplicación por contrato, clave, cantidad y precio. Sin doble contabilidad.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={loadData} disabled={loading} title="Actualizar datos">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Actualizar
          </button>
          <button className="btn sm" onClick={handleOpenServerFiles} title="Seleccionar layout existente en el servidor">
            <FileSpreadsheet size={14} />
            Archivos del servidor
          </button>
          <button className="btn sm primary" onClick={() => setShowUploadModal(true)}>
            <Upload size={14} />
            Subir y Conciliar Excel
          </button>
          <button className="btn sm accent" onClick={handleExport} title="Descargar vista actual en Excel CSV con UTF-8 BOM">
            <Download size={14} />
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Banner de archivo personalizado cargado */}
      {customDataset && (
        <div
          className="alert info"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
          }}
        >
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <CheckCircle2 size={20} color="var(--ok)" />
            <div>
              <span style={{ fontWeight: 600, color: "var(--navy)" }}>
                Visualizando archivo cargado: «{customDataset.fileName}»
              </span>
              <div className="muted small">
                {customDataset.contracts.length} contratos y {summary?.total_filas?.toLocaleString("es-MX") || 0} filas conciliadas con Motor V2.
              </div>
            </div>
          </div>
          <button
            className="btn sm"
            onClick={() => {
              setCustomDataset(null);
              toast("Restaurando base consolidada original...");
            }}
            title="Volver a la base general de 6,353 contratos"
          >
            <RefreshCw size={14} />
            Restaurar base consolidada (6,353 contratos)
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        {/* Card 1: Monto Inferido */}
        <div className="card card-pad hover-lift" style={{ borderLeft: "4px solid var(--ok)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Importe Conciliado Computable
            </span>
            <CheckCircle2 size={18} color="var(--ok)" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>
            {summary ? money(summary.monto_inferido_total) : "—"}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {summary ? `${num(summary.filas_inferidas)} filas consolidadas` : "—"}
          </div>
        </div>

        {/* Card 2: Duplicaciones Excluidas */}
        <div className="card card-pad hover-lift" style={{ borderLeft: "4px solid var(--steel)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Duplicaciones Excluidas
            </span>
            <Layers size={18} color="var(--steel)" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--steel)", fontVariantNumeric: "tabular-nums" }}>
            {summary ? `${num(summary.filas_duplicadas_excluidas)} filas` : "—"}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Excluidas de la suma por misma firma (importe $0.00)
          </div>
        </div>

        {/* Card 3: Pendientes de Revisión */}
        <div className="card card-pad hover-lift" style={{ borderLeft: "4px solid var(--burgundy)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Importe Pendiente / En Revisión
            </span>
            <AlertTriangle size={18} color="var(--burgundy)" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--burgundy)", fontVariantNumeric: "tabular-nums" }}>
            {summary ? money(summary.monto_revision_total) : "—"}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {summary ? `${num(summary.filas_pendientes)} filas sin conciliar aritméticamente` : "—"}
          </div>
        </div>

        {/* Card 4: Contratos */}
        <div className="card card-pad hover-lift" style={{ borderLeft: "4px solid var(--gold)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Grupos Contractuales
            </span>
            <Calculator size={18} color="var(--gold)" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>
            {summary ? num(summary.total_contratos) : "—"}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {summary
              ? `${num(summary.contratos_completos)} completos · ${num(summary.contratos_parciales)} parciales · ${num(summary.contratos_pendientes)} pendientes`
              : "—"}
          </div>
        </div>
      </div>

      {/* Horizontal Filter Bar */}
      <div className="card card-pad">
        <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
          {/* Filtro Institución */}
          <div style={{ minWidth: 170, flex: "1 1 170px" }}>
            <label className="field">
              Institución
              <select className="select" value={selectedInst} onChange={(e) => setSelectedInst(e.target.value)}>
                <option value="Todos">Todas las instituciones</option>
                {filterOpts.instituciones?.map((i: string) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Filtro Proveedor */}
          <div style={{ minWidth: 200, flex: "1 1 200px" }}>
            <label className="field">
              Proveedor
              <select className="select" value={selectedProv} onChange={(e) => setSelectedProv(e.target.value)}>
                <option value="Todos">Todos los proveedores</option>
                {filterOpts.proveedores?.map((p: string) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Filtro Contrato */}
          <div style={{ minWidth: 150, flex: "1 1 150px" }}>
            <label className="field">
              No. Contrato
              <input
                type="text"
                className="input"
                placeholder="Ej. UPN, 123..."
                value={contratoFilter}
                onChange={(e) => setContratoFilter(e.target.value)}
              />
            </label>
          </div>

          {/* Filtro Clave Insumo */}
          <div style={{ minWidth: 140, flex: "1 1 140px" }}>
            <label className="field">
              Clave Medicamento
              <input
                type="text"
                className="input"
                placeholder="Ej. 010000..."
                value={claveFilter}
                onChange={(e) => setClaveFilter(e.target.value)}
              />
            </label>
          </div>

          {/* Filtro Estado */}
          <div style={{ minWidth: 160, flex: "1 1 160px" }}>
            <label className="field">
              Estado conciliación
              <select className="select" value={selectedEstado} onChange={(e) => setSelectedEstado(e.target.value)}>
                <option value="Todos">Todos los estados</option>
                <option value="INFERIDO_COMPLETO">INFERIDO_COMPLETO</option>
                <option value="PARCIAL_CON_PENDIENTES">PARCIAL_CON_PENDIENTES</option>
                <option value="PENDIENTE_TOTAL">PENDIENTE_TOTAL</option>
                <option value="DUPLICADO_NO_SUMAR">DUPLICADO_NO_SUMAR</option>
                <option value="INFERIDO_PARTIDA">INFERIDO_PARTIDA</option>
              </select>
            </label>
          </div>

          {/* Búsqueda rápida */}
          <div style={{ minWidth: 180, flex: "1 1 180px" }}>
            <label className="field">
              Búsqueda rápida
              <div className="row" style={{ position: "relative" }}>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", paddingLeft: 30 }}
                  placeholder="Buscar texto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Search size={14} style={{ position: "absolute", left: 10, color: "var(--muted)" }} />
              </div>
            </label>
          </div>

          {/* Botón limpiar */}
          <div>
            <button className="btn sm ghost" onClick={handleResetFilters} title="Limpiar todos los filtros">
              <X size={14} />
              Limpiar
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div style={{ padding: "0 18px", borderBottom: "1px solid var(--line)" }}>
          <div className="tabs" style={{ margin: 0 }}>
            <button
              className={"tab" + (activeTab === "contratos" ? " on" : "")}
              onClick={() => setActiveTab("contratos")}
            >
              📋 Contratos ({summary ? num(summary.total_contratos) : "—"})
            </button>
            <button
              className={"tab" + (activeTab === "partidas" ? " on" : "")}
              onClick={() => setActiveTab("partidas")}
            >
              💊 Partidas Únicas ({summary ? num(summary.partidas_candidatas) : "—"})
            </button>
            <button
              className={"tab" + (activeTab === "detalle" ? " on" : "")}
              onClick={() => setActiveTab("detalle")}
            >
              🔍 Auditoría Fila por Fila ({summary ? num(summary.total_filas) : "—"})
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="table-wrap">
          {loading ? (
            <div className="empty">
              <RefreshCw size={24} className="spin" color="var(--steel)" />
              <span>Cargando registros conciliados...</span>
            </div>
          ) : tableData.items.length === 0 ? (
            <div className="empty">
              <AlertCircle size={28} color="var(--muted)" />
              <b>No se encontraron registros con los criterios seleccionados</b>
              <span className="small">Pruebe ajustando o limpiando los filtros horizontales.</span>
            </div>
          ) : activeTab === "contratos" ? (
            <table className="t">
              <thead>
                <tr>
                  <th>Institución</th>
                  <th>No. Contrato</th>
                  <th>Proveedor</th>
                  <th className="num">Filas Excel</th>
                  <th className="num">Partidas</th>
                  <th className="num">Monto Conciliado</th>
                  <th className="num">Monto Revisión</th>
                  <th>Estado</th>
                  <th>Observación Forense</th>
                </tr>
              </thead>
              <tbody>
                {tableData.items.map((row: any, idx: number) => (
                  <tr key={idx} onClick={() => setSelectedDrawerContract(row)}>
                    <td><b>{row.institucion}</b></td>
                    <td><span style={{ fontFamily: "monospace", color: "var(--navy)", fontWeight: 600 }}>{row.contrato}</span></td>
                    <td title={row.proveedor}>{row.proveedor}</td>
                    <td className="num">{num(row.filas)}</td>
                    <td className="num">{num(row.partidas)}</td>
                    <td className="num" style={{ fontWeight: 700, color: "var(--navy)" }}>
                      {row.monto_inferido ? money(parseFloat(row.monto_inferido)) : "—"}
                    </td>
                    <td className="num" style={{ color: row.monto_revision ? "var(--burgundy)" : "var(--muted)" }}>
                      {row.monto_revision ? money(parseFloat(row.monto_revision)) : "—"}
                    </td>
                    <td>{statusBadge(row.estado)}</td>
                    <td className="muted small" title={row.razon}>{row.razon}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : activeTab === "partidas" ? (
            <table className="t">
              <thead>
                <tr>
                  <th>Clave Medicamento</th>
                  <th>Descripción del Insumo</th>
                  <th className="num">Filas Fuente</th>
                  <th className="num">Importe Conciliado</th>
                  <th>Estado</th>
                  <th>Motivo / Razón</th>
                  <th>Filas de Origen</th>
                </tr>
              </thead>
              <tbody>
                {tableData.items.map((row: any, idx: number) => (
                  <tr key={idx}>
                    <td><span style={{ fontFamily: "monospace", fontWeight: 700 }}>{row.clave_medicamento || "(Sin Clave)"}</span></td>
                    <td title={row.descripcion}>{row.descripcion}</td>
                    <td className="num">{num(row.filas)}</td>
                    <td className="num" style={{ fontWeight: 700, color: "var(--navy)" }}>
                      {row.monto_inferido ? money(parseFloat(row.monto_inferido)) : "—"}
                    </td>
                    <td>{statusBadge(row.estado)}</td>
                    <td className="muted small" title={row.razon}>{row.razon}</td>
                    <td className="muted small" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {row.filas_origen}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th className="num">Fila Excel</th>
                  <th>Institución</th>
                  <th>Contrato</th>
                  <th>Proveedor</th>
                  <th>Clave</th>
                  <th className="num">Monto Declarado</th>
                  <th className="num">Cant.</th>
                  <th className="num">P. Unitario</th>
                  <th className="num">Subtotal Cant×Precio</th>
                  <th>Eval. IVA</th>
                  <th className="num">Monto Computable</th>
                  <th>Estado</th>
                  <th>Motivo Forense</th>
                </tr>
              </thead>
              <tbody>
                {tableData.items.map((row: any, idx: number) => (
                  <tr key={idx}>
                    <td className="num" style={{ fontWeight: 600 }}>#{row.fila_excel}</td>
                    <td>{row.institucion}</td>
                    <td><span style={{ fontFamily: "monospace" }}>{row.contrato}</span></td>
                    <td title={row.proveedor}>{row.proveedor}</td>
                    <td><span style={{ fontFamily: "monospace" }}>{row.clave_medicamento}</span></td>
                    <td className="num">{row.monto_declarado ? money(parseFloat(row.monto_declarado)) : "—"}</td>
                    <td className="num">{row.cantidad ? num(parseFloat(row.cantidad)) : "—"}</td>
                    <td className="num">{row.precio_unitario ? money(parseFloat(row.precio_unitario)) : "—"}</td>
                    <td className="num">{row.subtotal_calculado ? money(parseFloat(row.subtotal_calculado)) : "—"}</td>
                    <td>
                      <span className="badge sm" style={{ fontSize: 10.5 }}>
                        {row.evaluacion_iva}
                      </span>
                    </td>
                    <td
                      className="num"
                      style={{
                        fontWeight: 700,
                        color: row.monto_computable && parseFloat(row.monto_computable) > 0 ? "var(--ok)" : "var(--muted)",
                      }}
                    >
                      {row.monto_computable ? money(parseFloat(row.monto_computable)) : "$0.00"}
                    </td>
                    <td>{statusBadge(row.estado)}</td>
                    <td className="muted small" title={row.motivo}>{row.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Bar */}
        <div className="pager" style={{ justifyContent: "space-between" }}>
          <div>
            Mostrando registros del <b>{tableData.total > 0 ? (page - 1) * pageSize + 1 : 0}</b> al{" "}
            <b>{Math.min(page * pageSize, tableData.total)}</b> de <b>{num(tableData.total)}</b> totales
          </div>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 6, textTransform: "none" }}>
              <span>Por página:</span>
              <select
                className="select"
                style={{ padding: "4px 8px", fontSize: 12 }}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
            <button
              className="btn sm icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ padding: "0 6px", fontWeight: 600 }}>
              Página {page} de {Math.max(1, tableData.total_pages)}
            </span>
            <button
              className="btn sm icon"
              onClick={() => setPage((p) => Math.min(tableData.total_pages, p + 1))}
              disabled={page >= tableData.total_pages || loading}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Subir Archivo Excel */}
      {showUploadModal && (
        <>
          <div className="backdrop" onClick={() => !processing && setShowUploadModal(false)} />
          <div className="modal">
            <div className="mh">
              <h2>Subir y procesar nuevo archivo Excel</h2>
              <button
                className="btn icon ghost"
                onClick={() => setShowUploadModal(false)}
                disabled={processing}
              >
                <X size={18} />
              </button>
            </div>
            <div className="mb">
              <p className="muted small">
                Cargue una hoja de suministro o layout contractual (XLSX). El motor V2 identificará automáticamente
                la hoja de datos ("BASE"), aplicará el agrupamiento y deduplicará repeticiones sin intervención manual.
              </p>
              <div
                className="dropzone"
                onClick={() => !processing && fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (processing) return;
                  const f = e.dataTransfer.files?.[0];
                  if (f) processSelectedFile(f);
                }}
                style={{
                  opacity: processing ? 0.6 : 1,
                  cursor: processing ? "wait" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "32px 20px",
                }}
              >
                <Upload size={38} color="var(--gold)" style={{ margin: "0 auto 12px" }} />
                <h3>{processing ? "Procesando con motor V2..." : "Seleccione o arrastre su archivo Excel (.XLSX / .CSV)"}</h3>
                <span className="muted small" style={{ marginBottom: 12 }}>
                  Compatible con layouts de suministro, catálogos de proveedores y reportes de contratación
                </span>
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={processing}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload size={14} />
                  Examinar archivos de mi equipo
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept=".xlsx,.xls,.xlsm,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) processSelectedFile(f);
                  }}
                  disabled={processing}
                />
              </div>
              {processing && (
                <div className="alert info">
                  <RefreshCw size={16} className="spin" />
                  <span>
                    El motor está ejecutando la deduplicación y conciliación aritmética. Esto puede tomar unos segundos...
                  </span>
                </div>
              )}
            </div>
            <div className="mf">
              <button
                className="btn sm"
                onClick={() => setShowUploadModal(false)}
                disabled={processing}
              >
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal: Archivos del Servidor */}
      {showServerFilesModal && (
        <>
          <div className="backdrop" onClick={() => !processing && setShowServerFilesModal(false)} />
          <div className="modal" style={{ width: "min(680px, 94vw)" }}>
            <div className="mh">
              <h2>Archivos de Excel disponibles en el servidor</h2>
              <button
                className="btn icon ghost"
                onClick={() => setShowServerFilesModal(false)}
                disabled={processing}
              >
                <X size={18} />
              </button>
            </div>
            <div className="mb">
              <p className="muted small">
                Seleccione un archivo ya presente en el sistema para ejecutar el motor de conciliación V2 directamente
                sin volver a transferirlo.
              </p>
              {serverFiles.length === 0 ? (
                <div className="empty">
                  <span>No hay archivos Excel disponibles en el servidor.</span>
                </div>
              ) : (
                <div className="stack" style={{ gap: 8, maxHeight: 340, overflowY: "auto" }}>
                  {serverFiles.map((f, i) => (
                    <div
                      key={i}
                      className="card card-pad"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 16px",
                      }}
                    >
                      <div className="stack" style={{ gap: 2 }}>
                        <b>{f.filename}</b>
                        <span className="muted small">
                          Ubicación: {f.location} · Tamaño: {(f.size / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>
                      <button
                        className="btn sm primary"
                        onClick={() => handleProcessServerFile(f.path)}
                        disabled={processing}
                      >
                        <Calculator size={14} />
                        {processing ? "Procesando..." : "Ejecutar Motor V2"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mf">
              <button
                className="btn sm"
                onClick={() => setShowServerFilesModal(false)}
                disabled={processing}
              >
                Cerrar
              </button>
            </div>
          </div>
        </>
      )}

      {/* Drawer: Detalle de Contrato Seleccionado */}
      {selectedDrawerContract && (
        <>
          <div className="backdrop" onClick={() => setSelectedDrawerContract(null)} />
          <div className="drawer">
            <div className="dh">
              <h3>Ficha Técnica del Contrato</h3>
              <button className="btn icon ghost" onClick={() => setSelectedDrawerContract(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="db stack" style={{ gap: 16 }}>
              <div className="card card-pad" style={{ background: "#f8fafc" }}>
                <span className="muted small">Número de Contrato</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--navy)", fontFamily: "monospace" }}>
                  {selectedDrawerContract.contrato}
                </div>
                <div style={{ marginTop: 8 }}>
                  {statusBadge(selectedDrawerContract.estado)}
                </div>
              </div>

              <dl className="kv">
                <dt>Institución:</dt>
                <dd><b>{selectedDrawerContract.institucion}</b></dd>
                <dt>Proveedor:</dt>
                <dd>{selectedDrawerContract.proveedor}</dd>
                <dt>Filas en Layout:</dt>
                <dd>{num(selectedDrawerContract.filas)} filas registradas</dd>
                <dt>Partidas Candidatas:</dt>
                <dd>{num(selectedDrawerContract.partidas)} partidas</dd>
                <dt>Importe Conciliado:</dt>
                <dd style={{ fontWeight: 700, color: "var(--navy)" }}>
                  {selectedDrawerContract.monto_inferido
                    ? money(parseFloat(selectedDrawerContract.monto_inferido))
                    : "—"}
                </dd>
                <dt>Monto en Revisión:</dt>
                <dd style={{ color: "var(--burgundy)" }}>
                  {selectedDrawerContract.monto_revision
                    ? money(parseFloat(selectedDrawerContract.monto_revision))
                    : "$0.00"}
                </dd>
                <dt>Partidas Pendientes:</dt>
                <dd>{selectedDrawerContract.pendientes} pendientes</dd>
                <dt>Observación del Motor:</dt>
                <dd className="muted">{selectedDrawerContract.razon}</dd>
              </dl>

              <div className="alert info" style={{ fontSize: 12 }}>
                <span>
                  <b>Regla V2 aplicada:</b> Si este contrato contenía filas duplicadas exactas con el mismo importe,
                  cantidad y precio, únicamente la primera fila aportó al importe computable total.
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
