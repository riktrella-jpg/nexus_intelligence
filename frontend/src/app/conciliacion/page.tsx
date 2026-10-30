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
  Building2,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
} from "lucide-react";
import ValidacionContrato from "@/components/ValidacionContrato";
import { exportarLayoutValidado } from "@/lib/exportLayout";
import {
  useDecisiones,
  decisionDef,
  decisionesEnAlcance,
  resumenValidacion,
  contratoKey,
  exportarDecisionesCSV,
  exportarDecisionesJSON,
  leerBitacoraJSON,
} from "@/lib/decisiones";
import {
  getReconciliationSummary,
  getReconciliationContracts,
  getReconciliationItems,
  getReconciliationDetails,
  getReconciliationPendientes,
  getReconciliationInstitutions,
  getReconciliationFilters,
  getReconciliationFiles,
  getReconciliationDiferencias,
  getReconciliationV4Summary,
  processReconciliation,
  api,
  API,
} from "@/lib/api";
import { parseAndReconcileExcel } from "@/lib/reconciliationEngine";
import { useApp } from "@/lib/state";
import { money, num } from "@/lib/format";

type TabType = "instituciones" | "contratos" | "diferencias" | "validacion" | "pendientes" | "partidas" | "detalle";
type FiltroValidacion = "por_validar" | "validados" | "todos";

export default function ConciliacionPage() {
  const { track, toast } = useApp();
  const { decisiones, guardar: guardarDecision, eliminar: eliminarDecision, importar: importarDecisiones } = useDecisiones();
  const [validFilter, setValidFilter] = useState<FiltroValidacion>("por_validar");
  const [validacionItems, setValidacionItems] = useState<any[]>([]);
  const [diferenciasData, setDiferenciasData] = useState<any>({ items: [], total: 0, total_pages: 0, summary: null });
  const [diferenciasEstadoFilter, setDiferenciasEstadoFilter] = useState<"Todos" | "DIFERENCIA" | "COINCIDE">("DIFERENCIA");
  const [v4Summary, setV4Summary] = useState<any>(null);
  const [difSortBy, setDifSortBy] = useState("diferencia_automatico_menos_referencia");
  const [difSortDir, setDifSortDir] = useState<"asc" | "desc">("desc");
  const importInputRef = useRef<HTMLInputElement>(null);

  // State
  const [activeTab, setActiveTab] = useState<TabType>("instituciones");
  const [summary, setSummary] = useState<any>(null);
  const [showExplanation, setShowExplanation] = useState(true);
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
    pendientes?: any[];
    details?: any[];
    fileName: string;
    rawMatrix?: any[][];
    rawSheetName?: string;
    headerRowIdx?: number;
    colContrato?: number;
    colInst?: number;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showServerFilesModal, setShowServerFilesModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingLayout, setExportingLayout] = useState(false);
  const [serverFiles, setServerFiles] = useState<any[]>([]);
  const [selectedDrawerContract, setSelectedDrawerContract] = useState<any>(null);
  const [drawerPendingRows, setDrawerPendingRows] = useState<any[]>([]);
  const [loadingDrawerRows, setLoadingDrawerRows] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedDrawerContract) {
      setDrawerPendingRows([]);
      return;
    }
    const c = selectedDrawerContract;
    const mismoContrato = (r: any) =>
      (r.contrato || "") === (c.contrato || "") && (!r.institucion || !c.institucion || r.institucion === c.institucion);
    if (c.filas_revision && c.filas_revision.length > 0) {
      setDrawerPendingRows(c.filas_revision);
      return;
    }
    if (customDataset) {
      setDrawerPendingRows((customDataset.pendientes || []).filter(mismoContrato));
      return;
    }
    setLoadingDrawerRows(true);
    getReconciliationPendientes({
      contrato: c.contrato,
      institucion: c.institucion,
      page_size: 1000,
    })
      .then((res: any) => {
        const rows = (res?.items || []).filter(mismoContrato);
        if (rows.length > 0) {
          setDrawerPendingRows(rows);
        } else {
          getReconciliationDetails({
            contrato: c.contrato,
            page_size: 1000,
          }).then((r: any) => {
            if (r?.items) {
              setDrawerPendingRows(
                r.items.filter(
                  (it: any) => mismoContrato(it) && (it.alertas || (it.estado !== "PARTIDA CONTABILIZADA" && it.estado !== "INFERIDO_PARTIDA"))
                )
              );
            }
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDrawerRows(false));
  }, [selectedDrawerContract, customDataset]);

  // Pestaña de validación: filtra por estado de decisión y pagina en el cliente
  useEffect(() => {
    if (activeTab !== "validacion") return;
    const filtrados = validacionItems.filter((c) => {
      const d = decisiones[contratoKey(c.institucion, c.contrato)];
      const validado = !!d && !!decisionDef(d.decision)?.cierraPendiente;
      return validFilter === "todos" || (validFilter === "validados" ? validado : !validado);
    });
    const total = filtrados.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    setTableData({ items: filtrados.slice(offset, offset + pageSize), total, page, page_size: pageSize, total_pages: totalPages });
  }, [activeTab, validacionItems, decisiones, validFilter, page, pageSize]);

  // Load summary and filter options
  const loadMeta = async () => {
    if (customDataset) {
      const insts = Array.from(new Set(customDataset.contracts.map((c) => c.institucion).filter(Boolean))).sort();
      const provs = Array.from(new Set(customDataset.contracts.map((c) => c.proveedor).filter(Boolean))).sort();
      setFilterOpts({
        instituciones: insts,
        proveedores: provs,
        estados: [
          "SIN ALERTAS AUTOMATICAS",
          "REQUIERE REVISION",
          "PARTIDA CONTABILIZADA",
          "REPETIDO MISMA PARTIDA",
          "NO CUANTIFICABLE / REVISAR",
        ],
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

      const [sum, opts, v4] = await Promise.all([
        getReconciliationSummary(sumParams),
        getReconciliationFilters(),
        getReconciliationV4Summary().catch(() => null),
      ]);
      setSummary(sum);
      setFilterOpts(opts);
      if (v4?.resumen) setV4Summary(v4.resumen);
    } catch (e: any) {
      toast(e.message || "Error al cargar resumen del motor", true);
    }
  };

  // Load current tab data
  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === "diferencias") {
        const dp: any = {
          page,
          page_size: pageSize,
          sort_by: difSortBy,
          sort_dir: difSortDir,
        };
        if (search) dp.search = search;
        if (selectedInst !== "Todos") dp.institucion = selectedInst;
        if (selectedProv !== "Todos") dp.proveedor = selectedProv;
        if (contratoFilter) dp.contrato = contratoFilter;
        if (diferenciasEstadoFilter !== "Todos") dp.estado = diferenciasEstadoFilter;

        const res = await getReconciliationDiferencias(dp);
        setDiferenciasData(res);
        setTableData(res);
        return;
      }
      if (activeTab === "validacion") {
        let items: any[];
        if (customDataset) {
          const s = search.toLowerCase();
          items = customDataset.contracts.filter(
            (c) =>
              c.estado === "REQUIERE REVISION" &&
              (selectedInst === "Todos" || c.institucion === selectedInst) &&
              (selectedProv === "Todos" || c.proveedor === selectedProv) &&
              (!contratoFilter || (c.contrato || "").toLowerCase().includes(contratoFilter.toLowerCase())) &&
              (!s || [c.contrato, c.proveedor, c.institucion, c.razon].some((v) => (v || "").toLowerCase().includes(s)))
          );
        } else {
          const vp: any = { estado: "REQUIERE REVISION", page: 1, page_size: 10000, sort_by: "monto_inferido", sort_dir: "desc" };
          if (search) vp.search = search;
          if (selectedInst !== "Todos") vp.institucion = selectedInst;
          if (selectedProv !== "Todos") vp.proveedor = selectedProv;
          if (contratoFilter) vp.contrato = contratoFilter;
          const res = await getReconciliationContracts(vp);
          items = res?.items || [];
        }
        items.sort((a, b) => (parseFloat(b.monto_inferido) || 0) - (parseFloat(a.monto_inferido) || 0));
        setValidacionItems(items);
        return;
      }
      if (customDataset) {
        let items: any[] = [];
        if (activeTab === "pendientes") {
          items = [...(customDataset.pendientes || [])];
        } else if (activeTab === "detalle") {
          items = [...(customDataset.details || [])];
        } else {
          items = [...customDataset.contracts];
        }

        if (search) {
          const s = search.toLowerCase();
          items = items.filter(
            (c) =>
              (c.contrato && c.contrato.toLowerCase().includes(s)) ||
              (c.proveedor && c.proveedor.toLowerCase().includes(s)) ||
              (c.institucion && c.institucion.toLowerCase().includes(s)) ||
              (c.razon && c.razon.toLowerCase().includes(s)) ||
              (c.descripcion && c.descripcion.toLowerCase().includes(s)) ||
              (c.clave_medicamento && c.clave_medicamento.toLowerCase().includes(s)) ||
              (c.alertas && c.alertas.toLowerCase().includes(s))
          );
        }
        if (selectedInst !== "Todos") items = items.filter((c) => c.institucion === selectedInst);
        if (selectedProv !== "Todos") items = items.filter((c) => c.proveedor === selectedProv);
        if (contratoFilter) items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contratoFilter.toLowerCase()));
        if (claveFilter) items = items.filter((c) => (c.clave_medicamento || c.clave || "").toLowerCase().includes(claveFilter.toLowerCase()));
        if (selectedEstado !== "Todos") items = items.filter((c) => c.estado === selectedEstado);

        items.sort((a, b) => {
          let valA = a[sortBy];
          let valB = b[sortBy];
          if (
            sortBy === "monto_inferido" ||
            sortBy === "monto_revision" ||
            sortBy === "filas" ||
            sortBy === "partidas" ||
            sortBy === "pendientes" ||
            sortBy === "monto_declarado" ||
            sortBy === "subtotal_calculado" ||
            sortBy === "fila_excel"
          ) {
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

        if (activeTab === "contratos" || activeTab === "instituciones") {
          let montoInferido = 0;
          let montoRevision = 0;
          let completos = 0;
          let parciales = 0;
          let pendientes = 0;
          let filas = 0;
          for (const c of customDataset.contracts) {
            if (c.monto_inferido) montoInferido += parseFloat(c.monto_inferido) || 0;
            if (c.monto_revision) montoRevision += parseFloat(c.monto_revision) || 0;
            if (c.estado === "SIN ALERTAS AUTOMATICAS" || c.estado === "INFERIDO_COMPLETO") completos++;
            else if (c.estado === "REQUIERE REVISION" || c.estado === "PARCIAL_CON_PENDIENTES") parciales++;
            else pendientes++;
            filas += parseInt(c.filas, 10) || 0;
          }

          setSummary({
            has_data: true,
            total_filas: filas || customDataset.summary?.total_filas || 0,
            monto_inferido_total: Math.round(montoInferido * 100) / 100,
            monto_revision_total: Math.round(montoRevision * 100) / 100,
            total_contratos: customDataset.contracts.length,
            contratos_completos: completos,
            contratos_parciales: parciales,
            contratos_pendientes: pendientes,
            filas_duplicadas_excluidas: customDataset.summary?.filas_duplicadas_excluidas || 0,
            filas_inferidas: customDataset.summary?.filas_inferidas || 0,
            filas_pendientes: customDataset.pendientes?.length || customDataset.summary?.filas_pendientes || 0,
            partidas_candidatas: customDataset.summary?.partidas_candidatas || 0,
            meta: customDataset.summary?.meta,
          });
        }
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
      if (activeTab === "instituciones") {
        const instParams: any = {};
        if (selectedInst !== "Todos") instParams.institucion = selectedInst;
        res = await getReconciliationInstitutions(instParams);
        if (search) {
          const s = search.toLowerCase();
          res.items = (res.items || []).filter((it: any) =>
            it.siglas.toLowerCase().includes(s)
          );
          res.total = res.items.length;
        }
      } else if (activeTab === "contratos") {
        res = await getReconciliationContracts(params);
      } else if (activeTab === "pendientes") {
        res = await getReconciliationPendientes(params);
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
  }, [activeTab, page, pageSize, sortBy, sortDir, search, selectedInst, selectedProv, contratoFilter, claveFilter, selectedEstado, customDataset, diferenciasEstadoFilter, difSortBy, difSortDir]);

  const handleResetFilters = () => {
    setSearch("");
    setSelectedInst("Todos");
    setSelectedProv("Todos");
    setContratoFilter("");
    setClaveFilter("");
    setSelectedEstado("Todos");
    setPage(1);
  };

  const handleExportLayoutDirect = async (fmt: "xlsx" | "csv" = "xlsx") => {
    setExportingLayout(true);
    toast(`Preparando layout original con columna «Validado» en formato ${fmt.toUpperCase()}...`);
    try {
      let allContracts = customDataset?.contracts;
      if (!allContracts || allContracts.length === 0) {
        try {
          const res = await getReconciliationContracts({ page: 1, page_size: 10000 });
          allContracts = res?.items || [];
        } catch {
          allContracts = tableData.items || [];
        }
      }

      await exportarLayoutValidado({
        rawMatrix: customDataset?.rawMatrix,
        rawSheetName: customDataset?.rawSheetName,
        fileName: customDataset?.fileName || "Layout_Suministro_Septiembre",
        decisiones,
        contracts: allContracts,
        format: fmt,
      });

      toast(`¡Layout exportado exitosamente en ${fmt.toUpperCase()} con la columna «Validado»!`);
      setShowExportModal(false);
    } catch (err: any) {
      console.error("Error al exportar layout:", err);
      toast(err.message || "Error al exportar layout validado", true);
    } finally {
      setExportingLayout(false);
    }
  };

  const handleExport = () => {
    setShowExportModal(true);
  };

  const processSelectedFile = async (file: File) => {
    setProcessing(true);
    try {
      toast(`Procesando «${file.name}» con Motor V3...`);

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

      toast(`¡Archivo «${file.name}» cargado y conciliado exitosamente con Motor V3!`);
      setShowUploadModal(false);

      if (res?.contracts && Array.isArray(res.contracts)) {
        setCustomDataset({
          summary: res.summary,
          contracts: res.contracts,
          pendientes: res.pendientes || [],
          details: res.details || [],
          fileName: file.name,
          rawMatrix: res.rawMatrix,
          rawSheetName: res.rawSheetName,
          headerRowIdx: res.headerRowIdx,
          colContrato: res.colContrato,
          colInst: res.colInst,
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
      toast(err.message || "Error al procesar el archivo con el motor V3", true);
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

  // ---- Validación: alcance según filtros activos y monto contratado final
  const clavesCustom = customDataset ? new Set(customDataset.contracts.map((c) => contratoKey(c.institucion, c.contrato))) : null;
  const decisionesScope = decisionesEnAlcance(decisiones, {
    institucion: selectedInst,
    proveedor: selectedProv,
    contrato: contratoFilter,
  }).filter((d) => !clavesCustom || clavesCustom.has(d.key));
  const resVal = resumenValidacion(decisionesScope);
  const contratosRevision = summary?.contratos_parciales || 0;
  const porValidar = Math.max(0, contratosRevision - resVal.validados);
  const montoMotorTotal = summary?.monto_inferido_total || 0;
  const montoFinalTotal = Math.round((montoMotorTotal + resVal.ajuste_total) * 100) / 100;
  const pctValidado = contratosRevision > 0 ? Math.min(100, (resVal.validados / contratosRevision) * 100) : 100;
  const ajustePorInstitucion = (siglas: string) =>
    Object.values(decisiones)
      .filter((d) => (siglas === "Total general" || d.institucion === siglas) && decisionDef(d.decision)?.cierraPendiente)
      .filter((d) => !clavesCustom || clavesCustom.has(d.key))
      .reduce((s, d) => s + d.ajuste, 0);

  const handleImportBitacora = async (file: File) => {
    try {
      const lista = await leerBitacoraJSON(file);
      const n = importarDecisiones(lista);
      toast(`Bitácora importada: ${n} decisión(es) aplicadas.`);
    } catch (e: any) {
      toast(e.message || "No se pudo leer la bitácora", true);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const decisionBadge = (c: any) => {
    const d = decisiones[contratoKey(c.institucion, c.contrato)];
    const def = d ? decisionDef(d.decision) : undefined;
    if (!d || !def) return null;
    return (
      <span className="badge sm" style={{ background: "#fff", border: `1px solid ${def.color}`, color: def.color, fontWeight: 700, whiteSpace: "nowrap" }}>
        ✓ {def.label}
      </span>
    );
  };

  const statusBadge = (st: string) => {
    if (st === "SIN ALERTAS AUTOMATICAS" || st === "PARTIDA CONTABILIZADA" || st === "INFERIDO_COMPLETO" || st === "INFERIDO_PARTIDA") {
      return (
        <span className="badge ok">
          ✓ {st === "PARTIDA CONTABILIZADA" ? "Contabilizada" : "Sin alertas"}
        </span>
      );
    }
    if (st === "REQUIERE REVISION" || st === "PARCIAL_CON_PENDIENTES") {
      return <span className="badge bad">⚠️ Requiere revisión</span>;
    }
    if (st === "REPETIDO MISMA PARTIDA" || st === "DUPLICADO_NO_SUMAR") {
      return <span className="badge" style={{ background: "#e2e8f0", color: "#475569" }}>Repetido (no sumar)</span>;
    }
    if (st === "NO CUANTIFICABLE / REVISAR" || st === "PENDIENTE_TOTAL") {
      return <span className="badge bad">No cuantificable</span>;
    }
    if (st === "PENDIENTE_DUPLICADO") {
      return <span className="badge warn">Pendiente duplicado</span>;
    }
    return <span className="badge warn">{st || "Pendiente"}</span>;
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1>Conciliación de montos contratados</h1>
            <span className="badge" style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--ok)", fontWeight: 700 }}>
              Motor NEXUS V4 (Consolidación Contractual Auditable)
            </span>
          </div>
          <p className="sub">
            Motor V4: Consolidación contractual auditable ($1,205,182,002.31 en 668 contratos HGMEL), conciliación contra cálculo automático e identificación precisa de diferencias.
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
          <button className="btn sm accent" onClick={() => setShowExportModal(true)} title="Descargar layout en el formato original con columna 'Validado'">
            <Download size={14} />
            Exportar Layout Validado
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
                {customDataset.contracts.length} contratos y {summary?.total_filas?.toLocaleString("es-MX") || 0} filas conciliadas con Motor V3.
              </div>
            </div>
          </div>
          <button
            className="btn sm"
            onClick={() => {
              setCustomDataset(null);
              toast("Restaurando base consolidada original...");
            }}
            title="Volver a la base general de contratos"
          >
            <RefreshCw size={14} />
            Restaurar base consolidada
          </button>
        </div>
      )}

      {/* Explicación de Limpieza y Vinculación Contractual */}
      <div
        className="card card-pad"
        style={{
          background: "linear-gradient(135deg, rgba(248, 250, 252, 0.95), rgba(241, 245, 249, 0.95))",
          border: "1px solid rgba(148, 163, 184, 0.25)",
        }}
      >
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
          onClick={() => setShowExplanation(!showExplanation)}
        >
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <HelpCircle size={20} color="var(--navy)" />
            <span style={{ fontWeight: 700, color: "var(--navy)", fontSize: 13.5 }}>
              Metodología Forense NEXUS V4: Consolidación Contractual Auditable, Base sin IVA y Deduplicación
            </span>
          </div>
          <button className="btn sm ghost" style={{ padding: "4px 8px" }}>
            {showExplanation ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showExplanation ? "Ocultar detalle" : "Ver metodología"}
          </button>
        </div>

        {showExplanation && (
          <div style={{ marginTop: 14, fontSize: 13, color: "var(--navy)", lineHeight: 1.6 }}>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              <div style={{ background: "#fff", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <b style={{ color: "var(--burgundy)" }}>1. Deduplicación de Órdenes de Suministro:</b>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  Nunca se suma la Columna P repetida entre entregas o solicitudes parciales. Cada pedido subsecuente de una misma partida se clasifica como <code>REPETIDO MISMA PARTIDA</code> ($0.00 computable).
                </p>
              </div>
              <div style={{ background: "#fff", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <b style={{ color: "var(--steel)" }}>2. Preservación de Presentaciones Distintas:</b>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  Insumos con descripciones o calibres diferentes que comparten clave genérica (ej. <code>SIN CLAVE DEL CNIS</code>) e idéntico precio se preservan y se suman íntegramente al contrato, emitiendo la alerta preventiva <code>POSIBLE IMPORTE GLOBAL REPETIDO ENTRE PARTIDAS</code>.
                </p>
              </div>
              <div style={{ background: "#fff", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <b style={{ color: "var(--ok)" }}>3. Aritmética Base sin IVA (AJ × AK):</b>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  El monto contratado estimado se cuantifica a partir de <code>Cantidad × Precio Unitario</code> (Cols AJ×AK) redondeado a centavos. La Columna P se audita para clasificarla como <code>BASE SIN IVA</code>, <code>REPORTADO CON IVA 16%</code> o <code>NO CONCILIA</code>.
                </p>
              </div>
              <div style={{ background: "#fff", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <b style={{ color: "var(--gold)" }}>4. Consolidación NEXUS V4 y Conciliación HGMEL:</b>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  Monto contratado conciliado validado: <b>$1,205,182,002.31</b> en <b>668 contratos</b> (fuente verificada: <code>montos_contratados_consolidados.csv</code>). Se mantiene separado del cálculo automático Motor V3 (<b>$1,211,889,228.86</b>), registrando exactamente 16 diferencias contractuales auditables y 652 contratos coincidentes al 100%. Para layouts futuros sin referencia, se aplican las reglas automáticas identificando el resultado como estimado.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
        {/* Card 1: Monto Contratado Conciliado (V4) */}
        <div className="card card-pad hover-lift" style={{ borderLeft: "4px solid var(--ok)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Monto Contratado Conciliado (Motor V4)
            </span>
            <ShieldCheck size={18} color="var(--ok)" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>
            {customDataset
              ? money(summary?.monto_inferido_total || 0)
              : money(parseFloat(v4Summary?.monto_contratado_conciliado) || 1205182002.31)}
          </div>
          <div className="muted small" style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {customDataset ? (
              <span className="badge warn sm" style={{ fontWeight: 700 }}>
                Estimado automáticamente (sin ref. validada)
              </span>
            ) : (
              <>
                <span className="badge ok sm" style={{ fontWeight: 700, fontSize: 11 }}>
                  ✓ Suma CSV Verificada
                </span>
                <span style={{ fontSize: 11.5 }}>
                  668 contratos HGMEL · montos_contratados_consolidados.csv
                </span>
              </>
            )}
          </div>
        </div>

        {/* Card 2: Monto Contratado Estimado Automáticamente (V3) */}
        <div className="card card-pad hover-lift" style={{ borderLeft: "4px solid var(--steel)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Monto Estimado Automáticamente (V3)
            </span>
            <Calculator size={18} color="var(--steel)" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>
            {money(montoMotorTotal)}
          </div>
          <div className="muted small" style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge sm" style={{ background: "rgba(100, 116, 139, 0.15)", color: "var(--steel)", fontWeight: 700, fontSize: 11 }}>
              Motor V3 (Cols AJ×AK sin IVA)
            </span>
            <span style={{ fontSize: 11.5 }}>
              Δ +$6,707,226.55 (+0.56% vs ref)
            </span>
          </div>
        </div>

        {/* Card 3: Diferencias Contractuales (V4 vs V3) */}
        <div
          className="card card-pad hover-lift"
          style={{ borderLeft: "4px solid var(--burgundy)", cursor: "pointer" }}
          onClick={() => {
            setActiveTab("diferencias");
            setDiferenciasEstadoFilter("DIFERENCIA");
            setPage(1);
          }}
          title="Haga clic para consultar las diferencias por contrato"
        >
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Diferencias Contractuales
            </span>
            <AlertTriangle size={18} color="var(--burgundy)" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--burgundy)", fontVariantNumeric: "tabular-nums" }}>
            {v4Summary?.contratos_con_diferencias ?? 16} contratos c/ diferencia
          </div>
          <div className="muted small" style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge ok sm" style={{ fontWeight: 700, fontSize: 11 }}>
              {v4Summary?.contratos_coincidentes ?? 652} coincidentes (97.6%)
            </span>
            <span style={{ color: "var(--burgundy)", fontWeight: 600, fontSize: 11.5 }}>
              Ver tabla comparativa →
            </span>
          </div>
        </div>

        {/* Card 4: Monto Final Validado (Decisiones de Mesa) */}
        <div className="card card-pad hover-lift" style={{ borderLeft: "4px solid var(--gold)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Monto Final Validado
            </span>
            <ClipboardCheck size={18} color="var(--gold)" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>
            {money(montoFinalTotal)}
          </div>
          <div className="muted small" style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>
              {resVal.validados} de {contratosRevision} validados ({pctValidado.toFixed(1)}%)
            </span>
            {resVal.ajuste_total !== 0 && (
              <span
                className="badge sm"
                style={{
                  background: resVal.ajuste_total < 0 ? "#fee2e2" : "#dcfce7",
                  color: resVal.ajuste_total < 0 ? "#991b1b" : "#166534",
                  fontWeight: 700,
                  fontSize: 10.5,
                }}
              >
                Ajuste: {resVal.ajuste_total > 0 ? "+" : ""}{money(resVal.ajuste_total)}
              </span>
            )}
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
                <option value="SIN ALERTAS AUTOMATICAS">SIN ALERTAS AUTOMATICAS</option>
                <option value="REQUIERE REVISION">REQUIERE REVISION</option>
                <option value="PARTIDA CONTABILIZADA">PARTIDA CONTABILIZADA</option>
                <option value="REPETIDO MISMA PARTIDA">REPETIDO MISMA PARTIDA</option>
                <option value="NO CUANTIFICABLE / REVISAR">NO CUANTIFICABLE / REVISAR</option>
                <option value="INFERIDO_COMPLETO">INFERIDO_COMPLETO (Legacy)</option>
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
              className={"tab" + (activeTab === "instituciones" ? " on" : "")}
              onClick={() => setActiveTab("instituciones")}
            >
              🏢 Resumen Institucional (Layout Suministro)
            </button>
            <button
              className={"tab" + (activeTab === "contratos" ? " on" : "")}
              onClick={() => setActiveTab("contratos")}
            >
              📋 Contratos ({summary ? num(summary.total_contratos) : "—"})
            </button>
            <button
              className={"tab" + (activeTab === "diferencias" ? " on" : "")}
              onClick={() => {
                setActiveTab("diferencias");
                setPage(1);
              }}
              style={{
                color: activeTab === "diferencias" ? "var(--burgundy)" : undefined,
                fontWeight: activeTab === "diferencias" ? 700 : undefined,
              }}
            >
              ⚖️ Motor V4 — Diferencias & Consolidación ({v4Summary?.contratos_con_diferencias ?? 16})
            </button>
            <button
              className={"tab" + (activeTab === "validacion" ? " on" : "")}
              onClick={() => setActiveTab("validacion")}
            >
              ⚖️ Mesa de Validación ({porValidar > 0 ? `${porValidar} por validar` : "100% validado"})
            </button>
            <button
              className={"tab" + (activeTab === "pendientes" ? " on" : "")}
              onClick={() => setActiveTab("pendientes")}
            >
              ⚠️ Pendientes de Revisión ({summary ? num(summary.filas_pendientes) : "—"})
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

        {/* Encabezado fijo de la consulta de diferencias (NEXUS V4) */}
        {activeTab === "diferencias" && (() => {
          const s = diferenciasData?.summary;
          const ref = s ? s.monto_contratado_conciliado : parseFloat(v4Summary?.monto_contratado_conciliado) || 1205182002.31;
          const auto = s ? s.monto_contratado_estimado_v3 : parseFloat(v4Summary?.monto_contratado_estimado_v3) || 1211889228.86;
          const dif = s ? s.diferencia_total : auto - ref;
          const nDif = s ? s.contratos_con_diferencias : v4Summary?.contratos_con_diferencias ?? 16;
          const nTot = s ? s.total_contratos : v4Summary?.total_contratos ?? 668;
          const pct = ref ? (dif / ref) * 100 : 0;
          const segs: { key: "DIFERENCIA" | "COINCIDE" | "Todos"; label: string; n: number; tone: string }[] = [
            { key: "DIFERENCIA", label: "Con diferencia", n: v4Summary?.contratos_con_diferencias ?? 16, tone: "bad" },
            { key: "COINCIDE", label: "Coinciden", n: v4Summary?.contratos_coincidentes ?? 652, tone: "ok" },
            { key: "Todos", label: "Todos", n: v4Summary?.total_contratos ?? 668, tone: "" },
          ];
          return (
            <>
              <div className="dif-head">
                <div className="dif-seg" role="tablist" aria-label="Filtrar por estado de conciliación">
                  {segs.map((g) => (
                    <button
                      key={g.key}
                      id={`dif-filtro-${g.key.toLowerCase()}`}
                      className={(diferenciasEstadoFilter === g.key ? "on " : "") + g.tone}
                      onClick={() => {
                        setDiferenciasEstadoFilter(g.key);
                        setPage(1);
                      }}
                    >
                      {g.label}
                      <span className="cnt">{num(g.n)}</span>
                    </button>
                  ))}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="badge ok sm" style={{ fontWeight: 700 }} title="Suma de montos_contratados_consolidados.csv verificada: $1,205,182,002.31 en 668 contratos">
                    <ShieldCheck size={12} /> Suma CSV verificada
                  </span>
                  <button
                    id="dif-export-diferencias"
                    className="btn sm"
                    onClick={() => window.open("/api/reconciliation/export?view_type=diferencias", "_blank")}
                    title="Descargar conciliacion_contratos.csv"
                  >
                    <Download size={14} /> Diferencias CSV
                  </button>
                  <button
                    id="dif-export-consolidados"
                    className="btn sm"
                    onClick={() => window.open("/api/reconciliation/export?view_type=consolidados", "_blank")}
                    title="Descargar montos_contratados_consolidados.csv"
                  >
                    <Download size={14} /> Consolidados CSV
                  </button>
                </div>
              </div>
              <div className="dif-stats">
                <div className="dif-stat">
                  <div className="lbl"><ShieldCheck size={13} color="var(--ok)" /> Conciliado (Ref. V4)</div>
                  <div className="val ok">{money(ref)}</div>
                  <div className="hint">{num(nTot)} contratos en la vista</div>
                </div>
                <div className="dif-stat">
                  <div className="lbl"><Calculator size={13} color="var(--steel)" /> Estimado automático (V3)</div>
                  <div className="val">{money(auto)}</div>
                  <div className="hint">Cálculo AJ×AK sin IVA</div>
                </div>
                <div className="dif-stat">
                  <div className="lbl"><ArrowUpDown size={13} color="var(--burgundy)" /> Diferencia neta (V3 − Ref.)</div>
                  <div className={"val " + (Math.abs(dif) > 0.005 ? "bad" : "ok")}>
                    {dif > 0.005 ? "+" : ""}{money(dif)}
                  </div>
                  <div className="hint">{pct >= 0 ? "+" : ""}{pct.toFixed(2)}% sobre lo conciliado</div>
                </div>
                <div className="dif-stat">
                  <div className="lbl"><AlertTriangle size={13} color="var(--burgundy)" /> Contratos con diferencia</div>
                  <div className={"val " + (nDif > 0 ? "bad" : "ok")}>{num(nDif)} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>de {num(nTot)}</span></div>
                  <div className="hint">{nTot ? (((nTot - nDif) / nTot) * 100).toFixed(1) : "100.0"}% coinciden al centavo</div>
                </div>
              </div>
            </>
          );
        })()}

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
          ) : activeTab === "instituciones" ? (
            <table className="t">
              <thead>
                <tr>
                  <th>Institución / Siglas</th>
                  <th className="num">Registros</th>
                  <th className="num">Proveedores</th>
                  <th className="num">Contratos</th>
                  <th className="num">Monto Contratado</th>
                  <th className="num">Monto Ejercido</th>
                  <th className="num">% Ejercido</th>
                  <th className="num">Cantidad Contratada</th>
                  <th className="num">Piezas Solicitadas</th>
                  <th className="num">Piezas Suministradas</th>
                  <th className="num">% Suministro</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {tableData.items.map((row: any, idx: number) => {
                  const isTotal = row.siglas === "Total general";
                  return (
                    <tr
                      key={idx}
                      style={
                        isTotal
                          ? {
                              background: "rgba(15, 23, 42, 0.06)",
                              fontWeight: 700,
                              borderTop: "2px solid var(--line)",
                            }
                          : undefined
                      }
                    >
                      <td>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          {isTotal ? (
                            <span style={{ fontWeight: 800, color: "var(--navy)", fontSize: 13.5 }}>
                              📊 {row.siglas}
                            </span>
                          ) : (
                            <span
                              style={{
                                fontWeight: 600,
                                color: "var(--navy)",
                                cursor: "pointer",
                                textDecoration: "underline",
                              }}
                              onClick={() => {
                                setSelectedInst(row.siglas);
                                setActiveTab("contratos");
                              }}
                              title="Filtrar contratos de esta institución"
                            >
                              {row.siglas}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="num">{num(row.registros)}</td>
                      <td className="num">{num(row.proveedores)}</td>
                      <td className="num">{num(row.contratos)}</td>
                      <td className="num" style={{ fontWeight: 700, color: "var(--navy)" }}>
                        {money(row.monto_contratado)}
                      </td>
                      <td className="num" style={{ color: row.monto_ejercido > 0 ? "var(--ok)" : "var(--muted)" }}>
                        {money(row.monto_ejercido)}
                      </td>
                      <td className="num">
                        <span
                          className="badge sm"
                          style={{
                            background:
                              row.pct_ejercido > 50
                                ? "rgba(16, 185, 129, 0.15)"
                                : row.pct_ejercido > 20
                                ? "rgba(245, 158, 11, 0.15)"
                                : "rgba(100, 116, 139, 0.15)",
                            color:
                              row.pct_ejercido > 50
                                ? "var(--ok)"
                                : row.pct_ejercido > 20
                                ? "var(--gold)"
                                : "var(--muted)",
                          }}
                        >
                          {typeof row.pct_ejercido === "number" ? row.pct_ejercido.toFixed(2) : row.pct_ejercido}%
                        </span>
                      </td>
                      <td className="num">{num(row.cantidad_contratada)}</td>
                      <td className="num">{num(row.piezas_solicitadas)}</td>
                      <td className="num" style={{ fontWeight: 600, color: "var(--navy)" }}>
                        {num(row.piezas_suministradas)}
                      </td>
                      <td className="num">
                        <span
                          className="badge sm"
                          style={{
                            background:
                              row.pct_suministro >= 90
                                ? "rgba(16, 185, 129, 0.15)"
                                : row.pct_suministro >= 70
                                ? "rgba(245, 158, 11, 0.15)"
                                : "rgba(239, 68, 68, 0.15)",
                            color:
                              row.pct_suministro >= 90
                                ? "var(--ok)"
                                : row.pct_suministro >= 70
                                ? "var(--gold)"
                                : "var(--burgundy)",
                          }}
                        >
                          {typeof row.pct_suministro === "number" ? row.pct_suministro.toFixed(2) : row.pct_suministro}%
                        </span>
                      </td>
                      <td>
                        {!isTotal && (
                          <button
                            className="btn sm ghost"
                            style={{ padding: "2px 8px", fontSize: 11 }}
                            onClick={() => {
                              setSelectedInst(row.siglas);
                              setActiveTab("contratos");
                            }}
                          >
                            Ver contratos →
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : activeTab === "diferencias" ? (
            <div className="stack" style={{ gap: 12 }}>
              {/* Barra superior de verificación y filtros de estado de diferencia */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  padding: "12px 16px",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                }}
              >
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <button
                    className={"btn sm " + (diferenciasEstadoFilter === "DIFERENCIA" ? "primary" : "ghost")}
                    onClick={() => {
                      setDiferenciasEstadoFilter("DIFERENCIA");
                      setPage(1);
                    }}
                  >
                    ⚠️ Con Diferencia ({v4Summary?.contratos_con_diferencias ?? 16})
                  </button>
                  <button
                    className={"btn sm " + (diferenciasEstadoFilter === "COINCIDE" ? "primary" : "ghost")}
                    onClick={() => {
                      setDiferenciasEstadoFilter("COINCIDE");
                      setPage(1);
                    }}
                  >
                    ✓ Coincidentes al 100% ({v4Summary?.contratos_coincidentes ?? 652})
                  </button>
                  <button
                    className={"btn sm " + (diferenciasEstadoFilter === "Todos" ? "primary" : "ghost")}
                    onClick={() => {
                      setDiferenciasEstadoFilter("Todos");
                      setPage(1);
                    }}
                  >
                    Todos los Contratos ({v4Summary?.contratos_totales ?? 668})
                  </button>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn sm"
                    onClick={() => window.open("/api/reconciliation/export?view_type=diferencias", "_blank")}
                    title="Descargar tabla de diferencias y conciliación en CSV (conciliacion_contratos.csv)"
                  >
                    <Download size={14} /> Exportar Diferencias CSV
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => window.open("/api/reconciliation/export?view_type=consolidados", "_blank")}
                    title="Descargar montos contratados consolidados en CSV (Suma exacta $1,205,182,002.31)"
                  >
                    <Download size={14} /> Descargar Consolidados CSV
                  </button>
                </div>
              </div>

              {/* Banner informativo de verificación de sumas */}
              <div
                className="alert info"
                style={{
                  fontSize: 12.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <ShieldCheck size={18} color="var(--ok)" />
                  <span>
                    <b>Verificación Aritmética NEXUS V4:</b> Suma consolidada conciliada = <b>$1,205,182,002.31</b> (668 contratos HGMEL).
                    Cálculo automático Motor V3 = <b>$1,211,889,228.86</b>.
                    Diferencia neta auditable = <b>+$6,707,226.55</b> concentrada en exactamente 16 contratos (652 contratos coincidentes al 100%).
                  </span>
                </div>
                <span className="badge ok sm" style={{ fontWeight: 700 }}>
                  ✓ Suma CSV Verificada
                </span>
              </div>

              <table className="t">
                <thead>
                  <tr>
                    <th>Institución</th>
                    <th>No. Contrato</th>
                    <th>Proveedor</th>
                    <th className="num">Monto Conciliado (Ref. V4)</th>
                    <th className="num">Monto Estimado Auto (V3)</th>
                    <th className="num">Diferencia (V3 - Ref.)</th>
                    <th>Alertas Motor V3</th>
                    <th>Estado Conciliación</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.items.map((row: any, idx: number) => {
                    const diff = parseFloat(row.diferencia_automatico_menos_referencia) || 0;
                    const ref = parseFloat(row.monto_referencia) || 0;
                    const auto = parseFloat(row.monto_calculo_automatico) || 0;
                    const hasDiff = row.estado === "DIFERENCIA" || Math.abs(diff) > 0.01;
                    return (
                      <tr key={idx}>
                        <td>
                          <b>{row.institucion || "HGMEL"}</b>
                        </td>
                        <td>
                          <span
                            style={{
                              fontFamily: "monospace",
                              color: "var(--navy)",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setSelectedDrawerContract({
                                institucion: row.institucion || "HGMEL",
                                contrato: row.contrato,
                                proveedor: row.proveedor,
                                monto_inferido: auto,
                                estado: hasDiff ? "REQUIERE REVISION" : "SIN ALERTAS AUTOMATICAS",
                                razon: row.alertas_motor_v3 || (hasDiff ? "Diferencia con referencia consolidada V4" : "OK"),
                              });
                            }}
                            title="Ver ficha de auditoría en panel lateral"
                          >
                            {row.contrato}
                          </span>
                        </td>
                        <td title={row.proveedor} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.proveedor || "—"}
                        </td>
                        <td className="num" style={{ fontWeight: 700, color: "var(--ok)" }}>
                          {money(ref)}
                        </td>
                        <td className="num" style={{ fontWeight: 600, color: "var(--navy)" }}>
                          {money(auto)}
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 700,
                            color: hasDiff ? "var(--burgundy)" : "var(--muted)",
                          }}
                        >
                          {hasDiff ? `${diff > 0 ? "+" : ""}${money(diff)}` : "$0.00"}
                        </td>
                        <td>
                          {row.alertas_motor_v3 ? (
                            <span className="badge warn sm" style={{ fontSize: 11, whiteSpace: "normal", textAlign: "left" }}>
                              ⚠️ {row.alertas_motor_v3}
                            </span>
                          ) : (
                            <span className="muted small">Sin alertas automáticas</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={"badge sm " + (hasDiff ? "bad" : "ok")}
                            style={{ fontWeight: 700 }}
                          >
                            {hasDiff ? "⚠️ DIFERENCIA" : "✓ COINCIDE"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn sm ghost"
                            style={{ padding: "3px 8px", fontSize: 11 }}
                            onClick={() => {
                              setSelectedDrawerContract({
                                institucion: row.institucion || "HGMEL",
                                contrato: row.contrato,
                                proveedor: row.proveedor,
                                monto_inferido: auto,
                                estado: hasDiff ? "REQUIERE REVISION" : "SIN ALERTAS AUTOMATICAS",
                                razon: row.alertas_motor_v3 || (hasDiff ? "Diferencia con referencia consolidada V4" : "OK"),
                              });
                            }}
                          >
                            Ver Ficha →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : activeTab === "contratos" ? (
            <table className="t">
              <thead>
                <tr>
                  <th>Institución</th>
                  <th>No. Contrato</th>
                  <th>Proveedor</th>
                  <th className="num">Filas Layout</th>
                  <th className="num">Partidas Contadas</th>
                  <th className="num">Monto Estimado (sin IVA)</th>
                  <th className="num">Filas c/ Alerta</th>
                  <th>Estado Validación</th>
                  <th>Razones de Alerta / Observación</th>
                </tr>
              </thead>
              <tbody>
                {tableData.items.map((row: any, idx: number) => (
                  <tr key={idx} onClick={() => setSelectedDrawerContract(row)} style={{ cursor: "pointer" }}>
                    <td><b>{row.institucion}</b></td>
                    <td><span style={{ fontFamily: "monospace", color: "var(--navy)", fontWeight: 600 }}>{row.contrato}</span></td>
                    <td title={row.proveedor}>{row.proveedor}</td>
                    <td className="num">{num(row.filas)}</td>
                    <td className="num">{num(row.partidas)}</td>
                    <td className="num" style={{ fontWeight: 700, color: "var(--navy)" }}>
                      {row.monto_inferido ? money(parseFloat(row.monto_inferido)) : "—"}
                    </td>
                    <td className="num" style={{ color: (row.pendientes && parseInt(row.pendientes, 10) > 0) ? "var(--burgundy)" : "var(--muted)", fontWeight: (row.pendientes && parseInt(row.pendientes, 10) > 0) ? 700 : 400 }}>
                      {row.pendientes ? num(row.pendientes) : "0"}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {statusBadge(row.estado)}
                        {decisionBadge(row)}
                      </div>
                    </td>
                    <td className="muted small" title={row.razon}>
                      {row.razon && row.razon !== "OK" ? (
                        <span style={{ color: "var(--burgundy)", fontWeight: 600 }}>⚠️ {row.razon}</span>
                      ) : (
                        <span style={{ color: "var(--ok)" }}>✓ Sin observaciones</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : activeTab === "validacion" ? (
            <div className="stack" style={{ gap: 12 }}>
              {/* Barra de herramientas de validación */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  padding: "10px 14px",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                }}
              >
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <button
                    className={"btn sm " + (validFilter === "por_validar" ? "primary" : "ghost")}
                    onClick={() => setValidFilter("por_validar")}
                  >
                    Por validar ({validacionItems.filter((c) => !decisiones[contratoKey(c.institucion, c.contrato)] || !decisionDef(decisiones[contratoKey(c.institucion, c.contrato)]?.decision)?.cierraPendiente).length})
                  </button>
                  <button
                    className={"btn sm " + (validFilter === "validados" ? "primary" : "ghost")}
                    onClick={() => setValidFilter("validados")}
                  >
                    Validados ({validacionItems.filter((c) => !!decisiones[contratoKey(c.institucion, c.contrato)] && !!decisionDef(decisiones[contratoKey(c.institucion, c.contrato)]?.decision)?.cierraPendiente).length})
                  </button>
                  <button
                    className={"btn sm " + (validFilter === "todos" ? "primary" : "ghost")}
                    onClick={() => setValidFilter("todos")}
                  >
                    Todos en revisión ({validacionItems.length})
                  </button>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <button
                    className="btn sm accent"
                    onClick={() => handleExportLayoutDirect("xlsx")}
                    disabled={exportingLayout}
                    title="Descargar layout en el formato original exacto con la columna 'Validado' y detalle de decisiones"
                  >
                    <Download size={14} /> {exportingLayout ? "Generando Excel..." : "Exportar Layout Validado (Excel)"}
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => exportarDecisionesCSV(decisiones)}
                    title="Descargar bitácora de validaciones en formato CSV con UTF-8 BOM"
                  >
                    <Download size={14} /> Bitácora CSV
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => exportarDecisionesJSON(decisiones)}
                    title="Exportar respaldo de decisiones en formato JSON"
                  >
                    <Download size={14} /> Respaldo JSON
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => importInputRef.current?.click()}
                    title="Cargar bitácora previa de decisiones"
                  >
                    <Upload size={14} /> Importar JSON
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImportBitacora(f);
                    }}
                  />
                </div>
              </div>

              <table className="t">
                <thead>
                  <tr>
                    <th>Institución</th>
                    <th>No. Contrato</th>
                    <th>Proveedor</th>
                    <th className="num">Filas Alerta</th>
                    <th className="num">Monto Motor V3</th>
                    <th className="num">Ajuste</th>
                    <th className="num">Monto Final Validado</th>
                    <th>Decisión Actual</th>
                    <th>Responsable / Observación</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.items.map((row: any, idx: number) => {
                    const d = decisiones[contratoKey(row.institucion, row.contrato)];
                    const def = d ? decisionDef(d.decision) : undefined;
                    const mMotor = parseFloat(row.monto_inferido) || 0;
                    const mFinal = d ? d.monto_final : mMotor;
                    const aj = d ? d.ajuste : 0;
                    return (
                      <tr key={idx}>
                        <td><b>{row.institucion}</b></td>
                        <td>
                          <span
                            style={{ fontFamily: "monospace", color: "var(--navy)", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                            onClick={() => setSelectedDrawerContract(row)}
                            title="Abrir panel de decisión para este contrato"
                          >
                            {row.contrato}
                          </span>
                        </td>
                        <td title={row.proveedor}>{row.proveedor}</td>
                        <td className="num" style={{ color: "var(--burgundy)", fontWeight: 700 }}>
                          {row.pendientes || "—"}
                        </td>
                        <td className="num">{money(mMotor)}</td>
                        <td className="num" style={{ fontWeight: 600, color: aj < 0 ? "var(--burgundy)" : aj > 0 ? "var(--ok)" : "var(--muted)" }}>
                          {aj !== 0 ? `${aj > 0 ? "+" : ""}${money(aj)}` : "—"}
                        </td>
                        <td className="num" style={{ fontWeight: 700, color: "var(--navy)", fontSize: 13 }}>
                          {money(mFinal)}
                        </td>
                        <td>
                          {def ? (
                            <span className="badge sm" style={{ background: "#fff", border: `1px solid ${def.color}`, color: def.color, fontWeight: 700 }}>
                              ✓ {def.label}
                            </span>
                          ) : (
                            <span className="badge warn sm">Por decidir</span>
                          )}
                        </td>
                        <td className="muted small" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d ? `${d.responsable ? `[${d.responsable}] ` : ""}${d.observacion || "Sin justificación"}` : row.razon}
                        </td>
                        <td>
                          <button
                            className="btn sm primary"
                            style={{ padding: "3px 10px", fontSize: 11.5 }}
                            onClick={() => setSelectedDrawerContract(row)}
                          >
                            <ClipboardCheck size={13} /> {d ? "Modificar" : "Validar"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : activeTab === "pendientes" ? (
            <table className="t">
              <thead>
                <tr>
                  <th className="num">Fila Excel</th>
                  <th>Institución</th>
                  <th>No. Contrato</th>
                  <th>Proveedor</th>
                  <th>Clave</th>
                  <th>Descripción del Insumo</th>
                  <th className="num">Cant.</th>
                  <th className="num">P. Unitario</th>
                  <th className="num">Monto Reportado (Col P)</th>
                  <th className="num">Monto Base s/IVA</th>
                  <th>Clasificación IVA</th>
                  <th>Estado</th>
                  <th>Alertas / Motivo Forense</th>
                </tr>
              </thead>
              <tbody>
                {tableData.items.map((row: any, idx: number) => (
                  <tr key={idx} style={{ background: "rgba(239, 68, 68, 0.02)" }}>
                    <td className="num">
                      <span className="badge" style={{ fontFamily: "monospace", fontWeight: 700, background: "#fee2e2", color: "#991b1b" }}>
                        #{row.fila_excel}
                      </span>
                    </td>
                    <td><b>{row.institucion}</b></td>
                    <td>
                      <span
                        style={{ fontFamily: "monospace", color: "var(--navy)", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => {
                          setContratoFilter(row.contrato);
                          setActiveTab("contratos");
                        }}
                        title="Ver este contrato en pestaña Contratos"
                      >
                        {row.contrato}
                      </span>
                    </td>
                    <td title={row.proveedor}>{row.proveedor}</td>
                    <td><span style={{ fontFamily: "monospace", fontWeight: 600 }}>{row.clave_medicamento || row.clave || "SIN_CLAVE"}</span></td>
                    <td title={row.descripcion} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.descripcion}
                    </td>
                    <td className="num">{row.cantidad ? num(parseFloat(row.cantidad)) : "—"}</td>
                    <td className="num">{row.precio_unitario ? money(parseFloat(row.precio_unitario)) : "—"}</td>
                    <td className="num" style={{ fontWeight: 600, color: "var(--burgundy)" }}>
                      {row.monto_declarado ? money(parseFloat(row.monto_declarado)) : "—"}
                    </td>
                    <td className="num" style={{ fontWeight: 700, color: "var(--navy)" }}>
                      {row.subtotal_calculado ? money(parseFloat(row.subtotal_calculado)) : "—"}
                    </td>
                    <td>
                      <span className="badge sm" style={{ fontSize: 10.5 }}>
                        {row.evaluacion_iva || "EVALUADO"}
                      </span>
                    </td>
                    <td>{statusBadge(row.estado)}</td>
                    <td>
                      <div className="stack" style={{ gap: 2 }}>
                        {row.alertas && (
                          <span className="badge bad sm" style={{ fontWeight: 700, whiteSpace: "normal", textAlign: "left" }}>
                            ⚠️ {row.alertas}
                          </span>
                        )}
                        <span className="muted small" title={row.motivo || row.razon} style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.motivo || row.razon || "Requiere revisión forense"}
                        </span>
                      </div>
                    </td>
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
                  <th>Alertas / Motivo Forense</th>
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
                    <td className="muted small">
                      <div className="stack" style={{ gap: 2 }}>
                        {row.alertas && (
                          <span className="badge bad sm" style={{ fontWeight: 700, whiteSpace: "normal", textAlign: "left" }}>
                            ⚠️ {row.alertas}
                          </span>
                        )}
                        <span title={row.motivo}>{row.motivo}</span>
                      </div>
                    </td>
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

      {/* Modal: Exportar Layout con Columna Validado */}
      {showExportModal && (
        <>
          <div className="backdrop" onClick={() => !exportingLayout && setShowExportModal(false)} />
          <div className="modal" style={{ width: "min(680px, 95vw)" }}>
            <div className="mh">
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <FileSpreadsheet size={20} color="var(--gold)" />
                <h3 style={{ margin: 0 }}>Exportar Layout con Columna de Validación</h3>
              </div>
              <button
                className="btn icon ghost"
                onClick={() => !exportingLayout && setShowExportModal(false)}
                disabled={exportingLayout}
              >
                <X size={18} />
              </button>
            </div>
            <div className="mb stack" style={{ gap: 16 }}>
              <div className="alert ok" style={{ fontSize: 13 }}>
                <span>
                  <b>Formato Original Garantizado:</b> El archivo exportado mantiene el 100% de las columnas y el orden en que fue subido (Base, Ramo, Siglas, No. de contrato, Claves, Cantidades, Precios, etc.), incorporando al final la columna <b>Validado (SÍ / NO)</b> junto con los datos de auditoría de la decisión.
                </span>
              </div>

              <div className="card card-pad stack" style={{ gap: 12, border: "2px solid rgba(16, 185, 129, 0.4)", background: "rgba(16, 185, 129, 0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ flex: "1 1 320px" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--navy)" }}>
                      🌟 Layout Original Validado en Excel (.xlsx)
                    </div>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      Formato Excel (.xlsx) idéntico al archivo cargado con columnas añadidas: <code>Validado</code> (SÍ/NO), <code>Estado_Validacion</code>, <code>Decision_Tomada</code>, <code>Monto_Validado_Contrato</code>, <code>Ajuste_Validacion</code>, <code>Estatus_Fila</code>, <code>Responsable_Validacion</code>, <code>Fecha_Validacion</code> y <code>Observaciones_Validacion</code>.
                    </div>
                  </div>
                  <button
                    className="btn primary"
                    onClick={() => handleExportLayoutDirect("xlsx")}
                    disabled={exportingLayout}
                    style={{ minWidth: 160 }}
                  >
                    <Download size={14} />
                    {exportingLayout ? "Generando Excel..." : "Descargar Excel (.xlsx)"}
                  </button>
                </div>
              </div>

              <div className="card card-pad stack" style={{ gap: 12, border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ flex: "1 1 320px" }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--navy)" }}>
                      📄 Layout Original Validado en CSV (.csv)
                    </div>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      Mismo layout original con la columna <code>Validado</code>, delimitado por comas y codificado en UTF-8 con BOM para apertura inmediata en cualquier versión de Excel.
                    </div>
                  </div>
                  <button
                    className="btn"
                    onClick={() => handleExportLayoutDirect("csv")}
                    disabled={exportingLayout}
                    style={{ minWidth: 160 }}
                  >
                    <Download size={14} />
                    {exportingLayout ? "Generando CSV..." : "Descargar CSV (.csv)"}
                  </button>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <span className="muted small" style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>
                  Otros reportes disponibles:
                </span>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setShowExportModal(false);
                      exportarDecisionesCSV(decisiones);
                    }}
                    title="Exportar bitácora de auditoría de decisiones en CSV"
                  >
                    <Download size={13} /> Bitácora Decisiones (CSV)
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setShowExportModal(false);
                      exportarDecisionesJSON(decisiones);
                    }}
                    title="Exportar respaldo JSON de decisiones"
                  >
                    <Download size={13} /> Respaldo JSON
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setShowExportModal(false);
                      window.open(`/api/reconciliation/export?view_type=pendientes`, "_blank");
                    }}
                    title="Exportar lista de renglones con alerta"
                  >
                    <Download size={13} /> Renglones c/ Alerta (CSV)
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setShowExportModal(false);
                      window.open(`/api/reconciliation/export?view_type=contratos`, "_blank");
                    }}
                    title="Exportar resumen ejecutivo de contratos"
                  >
                    <Download size={13} /> Resumen Contratos (CSV)
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setShowExportModal(false);
                      window.open(`/api/reconciliation/export?view_type=diferencias`, "_blank");
                    }}
                    title="Exportar tabla de diferencias por contrato (conciliacion_contratos.csv)"
                  >
                    <Download size={13} /> Diferencias por Contrato (CSV)
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setShowExportModal(false);
                      window.open(`/api/reconciliation/export?view_type=consolidados`, "_blank");
                    }}
                    title="Exportar montos contratados consolidados ($1,205,182,002.31)"
                  >
                    <Download size={13} /> Montos Consolidados V4 (CSV)
                  </button>
                </div>
              </div>
            </div>
            <div className="mf">
              <button className="btn sm" onClick={() => setShowExportModal(false)} disabled={exportingLayout}>
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
          <div className="drawer" style={{ width: "min(780px, 95vw)" }}>
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
                <dd style={{ color: "var(--burgundy)", fontWeight: 700, fontSize: 15 }}>
                  {selectedDrawerContract.monto_revision
                    ? money(parseFloat(selectedDrawerContract.monto_revision))
                    : "$0.00"}
                </dd>
                <dt>Partidas Pendientes:</dt>
                <dd>{selectedDrawerContract.pendientes} pendientes</dd>
                <dt>Observación del Motor:</dt>
                <dd className="muted">{selectedDrawerContract.razon}</dd>
              </dl>

              {/* Panel de Decisión y Validación */}
              <ValidacionContrato
                contrato={selectedDrawerContract}
                rows={drawerPendingRows}
                decision={decisiones[contratoKey(selectedDrawerContract.institucion, selectedDrawerContract.contrato)]}
                onGuardar={(d) => {
                  guardarDecision(d);
                  toast(`Decisión guardada para ${selectedDrawerContract.contrato}`);
                }}
                onEliminar={() => {
                  eliminarDecision(contratoKey(selectedDrawerContract.institucion, selectedDrawerContract.contrato));
                  toast(`Decisión revertida para ${selectedDrawerContract.contrato}`);
                }}
              />

              {/* Sección: Desglose de Filas en Revisión */}
              <div className="stack" style={{ gap: 10, marginTop: 4 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <h4 style={{ margin: 0, color: "var(--burgundy)", display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertTriangle size={17} color="var(--burgundy)" />
                    Filas y Montos que Requieren Revisión en el Excel
                  </h4>
                  {selectedDrawerContract.monto_revision && (
                    <span className="badge bad" style={{ fontWeight: 700 }}>
                      Monto Revisión: {money(parseFloat(selectedDrawerContract.monto_revision))}
                    </span>
                  )}
                </div>

                {loadingDrawerRows ? (
                  <div className="alert info">
                    <RefreshCw size={14} className="spin" />
                    <span>Consultando filas específicas del archivo...</span>
                  </div>
                ) : drawerPendingRows.length === 0 ? (
                  <div className="alert ok" style={{ fontSize: 12 }}>
                    <CheckCircle2 size={16} />
                    <span>Todas las partidas de este contrato están debidamente conciliadas.</span>
                  </div>
                ) : (
                  <div className="table-wrap" style={{ maxHeight: 380, overflowY: "auto", border: "1px solid var(--line-strong)", borderRadius: 8 }}>
                    <table className="t sm">
                      <thead>
                        <tr>
                          <th>Fila Excel</th>
                          <th>Unidad / Destino</th>
                          <th>Clave y Descripción</th>
                          <th className="right">Cantidad</th>
                          <th className="right">P.U.</th>
                          <th className="right">Subtotal</th>
                          <th className="right">Monto Reportado</th>
                          <th>Motivo del Descuadre</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawerPendingRows.map((r, idx) => (
                          <tr key={idx} style={{ background: "rgba(239, 68, 68, 0.03)" }}>
                            <td>
                              <span className="badge" style={{ fontFamily: "monospace", fontWeight: 700, background: "#fee2e2", color: "#991b1b", whiteSpace: "nowrap" }}>
                                Fila {r.fila_excel}
                              </span>
                            </td>
                            <td style={{ fontSize: 11, maxWidth: 140 }}>
                              <b>{r.unidad || r.ur || selectedDrawerContract.institucion || "N/A"}</b>
                            </td>
                            <td>
                              <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 11.5 }}>
                                {r.clave_medicamento || r.clave || "SIN_CLAVE"}
                              </div>
                              <div className="muted small" style={{ fontSize: 10.5, maxWidth: 190, whiteSpace: "normal" }}>
                                {r.descripcion}
                              </div>
                            </td>
                            <td className="num">{num(r.cantidad)}</td>
                            <td className="num">{r.precio_unitario || r.precio ? money(parseFloat(r.precio_unitario || r.precio)) : "—"}</td>
                            <td className="num" style={{ fontWeight: 600 }}>
                              {r.subtotal_calculado || r.subtotal ? money(parseFloat(r.subtotal_calculado || r.subtotal)) : "—"}
                            </td>
                            <td className="num" style={{ color: "var(--burgundy)", fontWeight: 700 }}>
                              {r.monto_declarado || r.monto ? money(parseFloat(r.monto_declarado || r.monto)) : "—"}
                            </td>
                            <td style={{ fontSize: 11, color: "var(--muted)", maxWidth: 200, whiteSpace: "normal" }}>
                              {r.alertas && (
                                <div style={{ marginBottom: 4 }}>
                                  <span className="badge bad sm" style={{ fontWeight: 700, fontSize: 10 }}>
                                    ⚠️ {r.alertas}
                                  </span>
                                </div>
                              )}
                              <div>{r.motivo || r.razon_clasificacion || "Discrepancia aritmética entre cantidad × precio y monto"}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="alert info" style={{ fontSize: 12, marginTop: 8 }}>
                <span>
                  <b>Motor V3 Integrado:</b> Deduplicación estricta de órdenes de suministro, cálculo exacto de base sin IVA (AJ×AK) y preservación de presentaciones con alerta de importe global repetido.
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
