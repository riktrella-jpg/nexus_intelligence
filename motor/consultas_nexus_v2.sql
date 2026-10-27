-- Contratos completos sin partidas pendientes
SELECT institucion, contrato, proveedor, monto_inferido
FROM contratos WHERE estado='INFERIDO_COMPLETO';
-- Sumatoria solo de contratos completos
SELECT SUM(CAST(monto_inferido AS REAL)) AS monto_inferido_completo
FROM contratos WHERE estado='INFERIDO_COMPLETO';
-- Partidas deduplicadas: no se suman entregas repetidas
SELECT grupo_contrato, clave_medicamento, filas, monto_inferido, estado, filas_origen
FROM partidas ORDER BY grupo_contrato;
-- Filas que se excluyen de la suma por duplicación
SELECT fila_excel, contrato, clave_medicamento, monto_declarado, motivo
FROM detalle WHERE estado='DUPLICADO_NO_SUMAR';
-- Pendientes y monto de revisión (no sumable)
SELECT institucion, contrato, pendientes, monto_revision, razon
FROM contratos WHERE estado<>'INFERIDO_COMPLETO';
