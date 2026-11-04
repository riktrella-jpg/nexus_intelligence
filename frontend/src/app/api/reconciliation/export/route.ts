import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import contractsData from "@/lib/data/contracts.json";
import institutionSummaryData from "@/lib/data/institution_summary.json";
import pendientesData from "@/lib/data/pendientes.json";
import { parseAndReconcileExcel } from "@/lib/reconciliationEngine";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const viewType = searchParams.get("view_type") || "contratos";
  const search = searchParams.get("search")?.toLowerCase();
  const institucion = searchParams.get("institucion");
  const proveedor = searchParams.get("proveedor");
  const contrato = searchParams.get("contrato")?.toLowerCase();
  const claveMedicamento = searchParams.get("clave_medicamento")?.toLowerCase();
  const estado = searchParams.get("estado");

  if (viewType === "contratos_considerados") {
    try {
      const filePath = path.join(process.cwd(), "public", "data", "layout_base.xlsx");
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        const ab = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
        const parsed = parseAndReconcileExcel(ab, "layout_base.xlsx");
        let details = parsed.details || [];
        const contracts = parsed.contracts || [];

        const contractMap = new Map<string, any>();
        for (const c of contracts) {
          const k = `${String(c.institucion || "").toUpperCase()}|${String(c.contrato || "").toUpperCase()}`;
          contractMap.set(k, c);
        }

        if (institucion && institucion !== "Todos") {
          details = details.filter((r: any) => String(r.institucion || "").toUpperCase() === institucion.toUpperCase());
        }
        if (proveedor && proveedor !== "Todos") {
          details = details.filter((r: any) => String(r.proveedor || "").toUpperCase() === proveedor.toUpperCase());
        }
        if (contrato) {
          details = details.filter((r: any) => String(r.contrato || "").toLowerCase().includes(contrato));
        }
        if (claveMedicamento) {
          details = details.filter((r: any) => String(r.clave || "").toLowerCase().includes(claveMedicamento));
        }
        if (estado && estado !== "Todos") {
          details = details.filter((r: any) => {
            const ck = `${String(r.institucion || "").toUpperCase()}|${String(r.contrato || "").toUpperCase()}`;
            const cInfo = contractMap.get(ck);
            return r.estado === estado || cInfo?.estado === estado;
          });
        }
        if (search) {
          details = details.filter((r: any) => {
            const hay = [r.contrato, r.proveedor, r.institucion, r.clave, r.descripcion_original, r.estado, r.alertas]
              .map((x) => String(x || "").toLowerCase())
              .join(" ");
            return hay.includes(search);
          });
        }

        details.sort((a: any, b: any) => {
          const ic = String(a.institucion || "").localeCompare(String(b.institucion || ""));
          if (ic !== 0) return ic;
          const cc = String(a.contrato || "").localeCompare(String(b.contrato || ""));
          if (cc !== 0) return cc;
          return (Number(a.fila_excel) || 0) - (Number(b.fila_excel) || 0);
        });

        const headers = [
          "fila_excel",
          "institucion",
          "numero_contrato",
          "proveedor",
          "clave",
          "tipo_clave",
          "descripcion_original",
          "cantidad_contratada",
          "precio_unitario",
          "monto_reportado_fila",
          "monto_base_sin_iva",
          "iva",
          "estado_partida",
          "es_repetido",
          "duplicado_de_fila",
          "se_suma_al_contrato",
          "monto_aportado_partida",
          "es_primera_ocurrencia",
          "monto_contratado_contrato",
          "partidas_contabilizadas_contrato",
          "filas_totales_contrato",
          "estado_conciliacion_contrato",
          "alertas_partida",
          "criterio_conciliacion",
        ];

        const contratosVistos = new Set<string>();
        let csvOut = "\uFEFF" + headers.join(",") + "\n";

        for (const r of details) {
          const ck = `${String(r.institucion || "").toUpperCase()}|${String(r.contrato || "").toUpperCase()}`;
          const cInfo = contractMap.get(ck);
          const esPrimera = !contratosVistos.has(ck);
          contratosVistos.add(ck);

          const estadoPartida = r.estado || "";
          const esRepetido = estadoPartida === "REPETIDO MISMA PARTIDA" ? "SI" : "NO";
          const seSuma = estadoPartida === "PARTIDA CONTABILIZADA" ? "SI" : "NO";
          const montoAportado = seSuma === "SI" ? (r.monto_depurado ?? r.monto_base_sin_iva ?? "0.00") : "0.00";
          const montoContratadoCol = esPrimera ? (cInfo?.monto_inferido ?? "0.00") : "";

          let criterio = "FILA NO CUANTIFICABLE (REVISAR)";
          if (seSuma === "SI") {
            criterio = "CONSIDERADO EN MONTO CONTRATADO (PARTIDA UNICA)";
          } else if (esRepetido === "SI") {
            criterio = `EXCLUIDO POR REPETICION DE PARTIDA (DUPLICADO DE FILA ${r.duplicado_de_fila || ""})`.trim();
          }

          const vals = [
            r.fila_excel ?? "",
            r.institucion ?? "",
            r.contrato ?? "",
            r.proveedor ?? "",
            r.clave ?? "",
            r.tipo_clave ?? "",
            r.descripcion_original ?? "",
            r.cantidad_contratada ?? "",
            r.precio_unitario ?? "",
            r.monto_reportado ?? "",
            r.monto_base_sin_iva ?? "",
            r.iva ?? "",
            estadoPartida,
            esRepetido,
            r.duplicado_de_fila ?? "",
            seSuma,
            montoAportado,
            esPrimera ? "SI" : "NO",
            montoContratadoCol,
            cInfo?.partidas ?? "",
            cInfo?.filas ?? "",
            cInfo?.estado ?? "",
            r.alertas ?? "",
            criterio,
          ];

          csvOut += vals.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",") + "\n";
        }

        return new NextResponse(csvOut, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="contratos_considerados_para_monto_contratado.csv"',
          },
        });
      }
    } catch (err) {
      console.error("Error en export contratos_considerados:", err);
    }
  }

  // Exportar el layout completo en su formato original con la columna 'Validado'
  if (viewType === "layout") {
    try {
      const filePath = path.join(process.cwd(), "public", "data", "layout_base.xlsx");
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        const wb = XLSX.read(fileBuffer, { type: "buffer" });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (rawData.length > 0) {
          // Detectar encabezados
          let headerIdx = -1;
          for (let r = 0; r < Math.min(10, rawData.length); r++) {
            const rowStr = (rawData[r] || []).map((c) => String(c || "").toLowerCase()).join(" ");
            if (rowStr.includes("contrato") && (rowStr.includes("proveedor") || rowStr.includes("monto"))) {
              headerIdx = r;
              break;
            }
          }
          if (headerIdx === -1) headerIdx = rawData.length > 1 ? 1 : 0;

          // Mapa de contratos para saber si tenían alertas
          const contractMap = new Map<string, any>();
          for (const c of (contractsData as any[])) {
            const key = `${c.institucion || ""}|${c.contrato || ""}`.toUpperCase();
            contractMap.set(key, c);
          }

          const auditHeaders = [
            "Validado",
            "Estado_Validacion",
            "Decision_Tomada",
            "Monto_Validado_Contrato",
            "Ajuste_Validacion",
            "Estatus_Fila",
            "Responsable_Validacion",
            "Fecha_Validacion",
            "Observaciones_Validacion",
          ];

          rawData[headerIdx] = [...(rawData[headerIdx] || []), ...auditHeaders];

          for (let r = headerIdx + 1; r < rawData.length; r++) {
            const row = rawData[r];
            if (!row || row.length === 0) continue;
            const instVal = String(row[3] || "").trim().toUpperCase();
            const contVal = String(row[7] || "").trim().toUpperCase();
            const k = `${instVal}|${contVal}`;
            const cInfo = contractMap.get(k);

            const hasAlerts = cInfo && cInfo.estado === "REQUIERE REVISION";
            const validado = hasAlerts ? "NO" : "SÍ";
            const estValidacion = hasAlerts ? "PENDIENTE DE REVISIÓN" : "VALIDADO (MOTOR SIN ALERTAS)";
            const decTomada = hasAlerts ? "REQUIERE VALIDACIÓN" : "CONFIRMADO MOTOR";
            const montoVal = cInfo ? parseFloat(cInfo.monto_inferido) || 0 : 0;

            const auditVals = [
              validado,
              estValidacion,
              decTomada,
              montoVal.toFixed(2),
              "0.00",
              "CONTABILIZADA",
              hasAlerts ? "" : "MOTOR V3",
              hasAlerts ? "" : "AUTOMÁTICO",
              cInfo?.razon || "",
            ];
            rawData[r] = [...row, ...auditVals];
          }

          let csvOut = "\uFEFF";
          for (const row of rawData) {
            const line = (row || [])
              .map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`)
              .join(",");
            csvOut += line + "\n";
          }

          return new NextResponse(csvOut, {
            status: 200,
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="Layout_Suministro_Validado.csv"',
            },
          });
        }
      }
    } catch (layoutErr) {
      console.error("Error en exportación de layout:", layoutErr);
    }
  }

  // Exportar diferencias por contrato V4 vs V3
  if (viewType === "diferencias" || viewType === "conciliacion_v4") {
    try {
      const filePath = path.join(process.cwd(), "public", "data", "conciliacion_contratos.csv");
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        return new NextResponse(fileContent, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="conciliacion_contratos.csv"',
          },
        });
      }
    } catch (e) {
      console.error("Error al exportar conciliacion_contratos.csv:", e);
    }
  }

  // Exportar montos contratados consolidados V4
  if (viewType === "consolidados" || viewType === "consolidados_v4") {
    try {
      const filePath = path.join(process.cwd(), "public", "data", "montos_contratados_consolidados.csv");
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        return new NextResponse(fileContent, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="montos_contratados_consolidados.csv"',
          },
        });
      }
    } catch (e) {
      console.error("Error al exportar montos_contratados_consolidados.csv:", e);
    }
  }

  if (viewType === "pendientes") {
    let items = [...(pendientesData as any[])];
    if (search) {
      items = items.filter(
        (c) =>
          (c.contrato && c.contrato.toLowerCase().includes(search)) ||
          (c.proveedor && c.proveedor.toLowerCase().includes(search)) ||
          (c.institucion && c.institucion.toLowerCase().includes(search)) ||
          (c.descripcion_original && c.descripcion_original.toLowerCase().includes(search)) ||
          (c.alertas && c.alertas.toLowerCase().includes(search))
      );
    }
    if (institucion && institucion !== "Todos") items = items.filter((c) => c.institucion === institucion);
    if (proveedor && proveedor !== "Todos") items = items.filter((c) => c.proveedor === proveedor);
    if (contrato) items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contrato));
    if (estado && estado !== "Todos") items = items.filter((c) => c.estado === estado);

    const headers = [
      "fila_excel",
      "institucion",
      "contrato",
      "proveedor",
      "clave",
      "descripcion_original",
      "cantidad_contratada",
      "precio_unitario",
      "monto_reportado",
      "monto_base_sin_iva",
      "tipo_clave",
      "iva",
      "estado",
      "duplicado_de_fila",
      "monto_depurado",
      "alertas",
    ];

    let csvContent = "\uFEFF" + headers.join(",") + "\n";
    for (const row of items) {
      const line = headers
        .map((h) => {
          const val = String(row[h] ?? "").replace(/"/g, '""');
          return `"${val}"`;
        })
        .join(",");
      csvContent += line + "\n";
    }

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pendientes_revision.csv"',
      },
    });
  }

  if (viewType === "instituciones") {
    let items = [...(institutionSummaryData as any[])];
    if (institucion && institucion !== "Todos") {
      items = items.filter(
        (it) => it.siglas.toLowerCase() === institucion.toLowerCase() || it.siglas === "Total general"
      );
    }
    if (search) {
      items = items.filter((it) => it.siglas.toLowerCase().includes(search));
    }

    const headers = [
      "Institución",
      "Registros",
      "Proveedores",
      "Contratos",
      "Monto Contratado",
      "Monto Ejercido",
      "% Ejercido",
      "Cantidad Contratada (pzas)",
      "Piezas Solicitadas",
      "Piezas Suministradas",
      "% Suministro",
    ];

    let csvContent = "\uFEFF" + headers.join(",") + "\n";
    for (const r of items) {
      const line = [
        `"${r.siglas}"`,
        r.registros,
        r.proveedores,
        r.contratos,
        r.monto_contratado,
        r.monto_ejercido,
        `"${r.pct_ejercido}%"`,
        r.cantidad_contratada,
        r.piezas_solicitadas,
        r.piezas_suministradas,
        `"${r.pct_suministro}%"`,
      ].join(",");
      csvContent += line + "\n";
    }

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="resumen_institucional_layout.csv"',
      },
    });
  }

  let items = [...(contractsData as any[])];

  if (search) {
    items = items.filter(
      (c) =>
        (c.contrato && c.contrato.toLowerCase().includes(search)) ||
        (c.proveedor && c.proveedor.toLowerCase().includes(search)) ||
        (c.institucion && c.institucion.toLowerCase().includes(search)) ||
        (c.razon && c.razon.toLowerCase().includes(search))
    );
  }
  if (institucion && institucion !== "Todos") items = items.filter((c) => c.institucion === institucion);
  if (proveedor && proveedor !== "Todos") items = items.filter((c) => c.proveedor === proveedor);
  if (contrato) items = items.filter((c) => c.contrato && c.contrato.toLowerCase().includes(contrato));
  if (estado && estado !== "Todos") items = items.filter((c) => c.estado === estado);

  const headers = [
    "institucion",
    "contrato",
    "proveedor",
    "filas",
    "partidas",
    "monto_inferido",
    "pendientes",
    "estado",
    "razon",
  ];

  let csvContent = "\uFEFF" + headers.join(",") + "\n";
  for (const row of items) {
    const line = headers
      .map((h) => {
        const val = String(row[h] ?? "").replace(/"/g, '""');
        return `"${val}"`;
      })
      .join(",");
    csvContent += line + "\n";
  }

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="resumen_contratos.csv"',
    },
  });
}
