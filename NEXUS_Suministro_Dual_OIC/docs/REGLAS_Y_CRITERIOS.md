# Catálogo de controles — motor dual v2.0

**Origen:** fórmulas de `BASE_REVISION!AE:AU` en la plantilla de revisión. **Archivo de entrada:** layout remitido por los institutos con A:AD y tipo indicado en la columna A. Cada regla se ejecuta tanto en Medicamentos como en Material de Curación. La clasificación `ERROR`, `REVISAR`, `INFORMATIVO` y `OK` distingue inconsistencias de captura, aclaraciones documentales y señales preventivas.

| Columna de revisión | Criterio | Columnas de entrada |
|---|---|---|
| AE | Presencia, localización y estado de clave CNIS | Q |
| AF | Suministro informado sin firma contractual acreditada en el campo | I,J,AB,AC |
| AG | Fechas contractuales faltantes, inválidas o invertidas | N,O |
| AH | Solicitud o entrega antes del inicio contractual | N,Y,AB |
| AI | Solicitud o entrega posterior a fin contractual | O,Y,AB |
| AJ | Orden sin fecha o números de órdenes/fechas no conciliados | X,Y |
| AK | Campos de montos y cantidades no numéricos | P,S,T,U,Z,AC |
| AL | Monto contratado frente a S × T, tolerancia $1 | P,S,T |
| AM | Precio distinto dentro de institución + contrato + misma clave CNIS identificada | H,Q,T |
| AN | Monto ejercido frente a AC × T, tolerancia $0.01 | U,AC,T |
| AO | Piezas entregadas y monto ejercido cero | U,AC |
| AP | Campos operativos incompletos al existir solicitud/suministro | W,X,Y,Z,AA,AB,AC |
| AQ | Solicitud pendiente más de N días al corte | Y,AB,AC |
| AR | Entrega mayor que solicitud (ERROR); parcial (INFORMATIVO) | Z,AC |
| AS | Coincidencia potencial de institución, contrato, clave o descripción y evento | D,H,Q,R,X,Y,AA,AB,AC |
| AT | Fechas como texto, múltiples fechas o valor no estructurado | N,O,Y,AB |
| AU | Solicitud o entrega después del corte (INFORMATIVO) | Y,AB |

### Controles transversales y por rubro

- **MX01–MX11**: contrato, negativos, cronología solicitud/entrega, proveedores discrepantes dentro de la institución, fracciones, motivo de falta de firma, importes repetidos por distintas claves, proveedor faltante, entregas superiores a cantidad contratada, ejercicio sin piezas y fechas improbables.
- **MD01**: marcador oncológico distinto de 0/1 en Medicamentos, si se proporcionó. No aplica en Material de Curación.
- **MC01**: un registro de Material de Curación está marcado como oncológico (`V=1`). `N/A` en V es esperado y **no** genera observación.
- **SX01**: valor de columna A no clasificable en ninguno de los dos rubros.

### Reglas antirruido y precisión

1. Si `Q="Sin clave del CNIS"`, se señala **AE**, pero para comparación de precio y detección de duplicidad se usa también la descripción **R**; artículos diferentes no se agrupan solo porque carezcan de clave.
2. Cuando `P ≈ S × T × 1.16` o `U ≈ AC × T × 1.16` se registra un **INFORMATIVO** para comprobar el tratamiento fiscal. Esto no asume que deba causarse IVA ni acredita la factura.
3. La agrupación de contratos/duplicados se hace por **institución (D), rubro (A) y contrato (H)** para que números homónimos de instituciones diferentes no se comparen.
4. Valores como `SIN ORDEN DE SUMINISTRO` no se tratan como órdenes pendientes cuando no hay fecha ni cantidad solicitada.
5. No se suman importes repetidos, ni se suprimen filas: MX07 solo previene doble conteo.
6. Solo `ERROR` o `REVISAR` activan amarillo `#FFFF00` en las celdas de origen implicadas, en el resultado de la regla y en AV/AW. `INFORMATIVO` se registra, pero no se convierte en error.
7. El libro **original queda intacto**; todas las modificaciones van a `REVISION OIC`.

**Alcance no comprobado:** clasificación normativa y vigencia del CNIS respecto del compendio oficial actual; contractualización de plazos de entrega; valoración jurídica o fiscal; procedencia de importes por partida vs contrato. Son aspectos que requieren evidencia adicional del ente informante.
