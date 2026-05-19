# ADR: Motor de Acuerdos de Pago Automático para Cartera/DFP

## 1. Estado
**Propuesto / Pending Approval**

## 2. Contexto
En el módulo Cartera/DFP de FlowSuiteCRM actualmente existen entidades y flujos para PTPs, pagos, planes de pago, statements, gestiones y cuentas revolving. Sin embargo, no existe una entidad explícita y canónica para representar un **acuerdo de pago automático recurrente**.

Hallazgos clave:
- `cob_ptps` representa promesas puntuales (compromisos operativos), no acuerdos recurrentes formales.
- `cob_plan_pagos` contiene campos cercanos al objetivo, pero su semántica mezcla plan/cuotas tradicionales con operación de cobranza, y ya presentó fricción histórica de constraints en cuotas/estados.
- `cob_statements` y `cob_statement_lines` deben mantenerse como snapshot financiero por ciclo.
- `cob_pagos` debe mantenerse como registro de dinero efectivamente recibido.
- `cob_financial_ledger` debe permanecer append-only y no debe escribirse directamente desde flujos operativos de UI/n8n.
- `outbox_messages`/n8n deben usarse para orquestación y mensajería, no para mutar ledger ni marcar pagos financieros sin pasar por backend/RPC oficial.

Problema operativo actual:
- Se termina usando PTP como sustituto de acuerdo recurrente mensual, generando carga manual, trazabilidad incompleta, confusión de estados y riesgos de compliance.

## 3. Decisión
Se implementará un modelo separado para acuerdos automáticos, con tres entidades principales:
- `cob_acuerdos_pago_automatico`
- `cob_cobros_programados`
- `cob_acuerdo_eventos`

Y se mantiene la separación estricta de responsabilidades:

- **Ledger** = verdad financiera
- **Statement** = snapshot de ciclo
- **Acuerdo** = regla operativa recurrente
- **Cobro programado** = intento futuro de cobro
- **Pago** = dinero confirmado
- **PTP** = excepción / promesa puntual / renegociación

## 4. Estados oficiales

### A) Estados de `cob_acuerdos_pago_automatico`
- `borrador`
- `activo`
- `pausado`
- `cancelado`
- `completado`

Transiciones permitidas:
- `borrador -> activo | cancelado`
- `activo -> pausado | cancelado | completado`
- `pausado -> activo | cancelado`
- `cancelado` y `completado` son terminales

Regla de renegociación:
- No se muta destructivamente un acuerdo histórico.
- Renegociación = cerrar/terminalizar acuerdo anterior (ej. `cancelado` con motivo renegociación) + crear nuevo acuerdo.

### B) Estados de `cob_cobros_programados`
- `programado`
- `recordatorio_enviado`
- `procesando`
- `pagado`
- `fallido`
- `vencido`
- `cancelado`

Transiciones permitidas:
- `programado -> recordatorio_enviado`
- `programado | recordatorio_enviado -> procesando`
- `procesando -> pagado | fallido`
- `programado | recordatorio_enviado -> vencido`
- `programado | recordatorio_enviado -> cancelado` (por pausa/cancelación de acuerdo)

## 5. Reglas principales
1. n8n no marca pagos como `pagado` directamente en tablas core financieras.
2. n8n no escribe en `cob_financial_ledger`.
3. Pagos exitosos deben pasar por RPC/backend oficial para registrar impacto financiero de forma controlada.
4. PTP no genera acuerdos automáticos.
5. PTP solo se crea por excepción, incumplimiento o promesa posterior explícita del cliente.
6. Acuerdos `cancelado`/`completado` son terminales.
7. Renegociación crea nuevo acuerdo (sin borrar historial).
8. Un caso no debe tener más de un acuerdo `activo`/`pausado` al mismo tiempo (unicidad parcial por caso/org).

## 6. Relación con statements
- El statement se genera por ciclo financiero y se mantiene independiente del acuerdo.
- `cob_cobros_programados.statement_id` puede ser nullable.
- **Statement sin cobro programado** es permitido, pero debe emitir alerta operativa.
- **Cobro programado sin statement** es permitido en escenarios de onboarding/transición, pero debe marcarse para revisión.
- La idempotencia de statements debe mantenerse por período/cuenta según contratos existentes.

## 7. Relación con outbox/n8n
Eventos oficiales:
- `acuerdo_creado`
- `recordatorio_pre_cobro`
- `cobro_programado_listo`
- `cobro_exitoso`
- `cobro_fallido`
- `statement_disponible`
- `acuerdo_pausado`
- `acuerdo_cancelado`

Regla de idempotencia:
- Todo evento debe incluir `event_key` idempotente (ej. composición por `tipo_evento + acuerdo_id + fecha_programada [+ cobro_id]`).

Principio de consumo:
- n8n consume/coordina notificaciones e integraciones externas.
- Actualizaciones de estado crítico financiero/operativo se consolidan vía backend/RPC oficial.

## 8. Auditoría
Se aprueba crear tabla dedicada `cob_acuerdo_eventos` para trazabilidad fuerte.

Debe registrar al menos:
- creación
- edición
- pausa
- cancelación
- cambio de monto
- cambio de método
- cobro exitoso
- cobro fallido
- renegociación

Razón:
- `cob_gestiones` es útil para operación de cobranza, pero no reemplaza bitácora técnica/auditable de lifecycle del acuerdo.

## 9. Consecuencias positivas
- Elimina la dependencia incorrecta de PTP como motor recurrente.
- Mejora trazabilidad y separación de responsabilidades.
- Habilita automatización real de cobros/recordatorios/statements.
- Prepara integración robusta con n8n y proveedores de pago (p. ej. Square).
- Reduce errores manuales y reprocesos.
- Fortalece cumplimiento operativo y auditoría.

## 10. Consecuencias y riesgos
- Aumenta complejidad del modelo.
- Requiere diseño cuidadoso de RLS por `org_id`.
- Requiere idempotencia fuerte en cobros/eventos.
- Requiere pruebas robustas de fechas (29/30/31, febrero, bisiesto, timezone).
- Requiere disciplina estricta para no mezclar operación de cobros con escritura directa de ledger financiero.

## 11. Plan de implementación (commits sugeridos)
1. `feat(schema): add automatic payment agreement tables`
2. `feat(backend): add agreement lifecycle RPCs`
3. `feat(backend): add scheduled charge RPCs`
4. `feat(events): wire outbox lifecycle events`
5. `feat(cartera-ui): add automatic agreement panel`
6. `feat(cartera-ui): add create/edit/pause/cancel flows`
7. `test(dfp): add QA tests for agreements, dates, idempotency and RLS`

## 12. Caso Alejandrina (ejemplo operativo, no ejecutable)
Cliente de referencia:
- Nombre: Alejandrina Herrera Diaz
- `case_id`: `b39e16e8-1a10-4f86-8bfc-5208c70db259`

Ejemplo objetivo de acuerdo:
- `monto_base_mensual`: 40.00
- `porcentaje_cargo_autorizado`: 4%
- `monto_total_cobro`: 41.60
- `fecha_primer_cobro`: 2026-06-04
- `dia_cobro_preferido`: 4
- `frecuencia`: mensual
- estado del acuerdo: `activo`

Criterios operativos del ejemplo:
- PTP de mayo puede marcarse cumplido si el pago registrado corresponde.
- Plan cancelado defectuoso permanece histórico.
- PTPs futuros solo para excepciones/renegociación.

## 13. Checklist de aprobación previa a implementación
Antes de ejecutar migraciones o cambios productivos, confirmar:
- [ ] Schema real validado contra tablas y constraints actuales.
- [ ] RLS diseñada y revisada para nuevas tablas.
- [ ] RPCs/servicios de lifecycle definidos y aprobados.
- [ ] Contrato de integración con n8n/outbox aprobado.
- [ ] Garantía explícita de no escritura directa a ledger.
- [ ] Regla de no duplicación de acuerdos `activo/pausado` por caso aprobada.
- [ ] Reglas de cálculo de fechas (incluye 29/30/31, febrero, bisiesto, timezone) aprobadas.
- [ ] UI separa claramente Acuerdo vs PTP (Promesas/Excepciones).
- [ ] QA del caso Alejandrina definido sin tocar producción.

## 14. Notas de alcance
Este ADR documenta diseño y decisiones arquitectónicas. No implica ejecución inmediata de SQL, migraciones ni cambios de datos reales.

