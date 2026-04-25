# FlowSuiteCRM — Proyecto

## Prioridad actual
Construir el módulo de cartera/cobranza priorizando operación real, reutilización y compatibilidad con n8n.

## Reglas de arquitectura
- El caso es la entidad central del módulo de cartera.
- `clientes` es la ficha maestra del cliente, no el workflow de cobranza.
- Hy-Cite es la fuente de verdad del saldo externo.
- FlowSuiteCRM es la fuente de verdad operativa de gestiones, PTPs, planes de pago y automatizaciones.
- No mezclar cartera con pipeline comercial.

## Decisiones de arquitectura tomadas

### llamadas_telemercadeo vs cob_gestiones (2026-04-25)
- `cob_gestiones` es la tabla canónica de gestiones de cobranza.
- `TelemercadeoCallModal` ya escribe solo en `cob_gestiones` (Paso 1).
- `TelemercadeoCarteraPage` ya lee solo desde `cob_gestiones` (Paso 2).
- **`EnviosPage` sigue escribiendo en `llamadas_telemercadeo`** para `pago_prometido` de campañas WhatsApp — esto es intencional. Las respuestas de campaña son contexto de marketing, no gestiones de cobranza. No mezclar hasta que exista lógica explícita para abrir/actualizar un caso desde ese flujo.
- `TelemercadeoCallModal` todavía lee `llamadas_telemercadeo` para mostrar historial legacy en el modal. No eliminar esa lectura sin backfill previo.
- 16 clientes tienen historial solo en `llamadas_telemercadeo` (sin caso activo hoy). Pendiente backfill opcional.

## Reutilizar primero
- clientes
- cob_gestiones
- llamadas_telemercadeo (legacy — solo lectura de historial y escritura de campañas WhatsApp)
- cargo_vuelta_cases
- contacto_actividades
- outbox_messages
- message_templates
- TelemercadeoCarteraPage
- TelemercadeoCallModal
- ContactoTimeline
- MessageModal
- MessagingProvider

## Huecos conocidos
- falta tabla de pagos
- falta plan de pagos con cuotas
- falta detalle de caso
- consolidación llamadas_telemercadeo → cob_gestiones: escritura y lectura principal migradas; pendiente backfill 16 clientes legacy y decisión final sobre EnviosPage
- falta RLS granular para cobrador
- falta PTP como entidad formal

## Estilo de trabajo
- no inventes tablas ni archivos existentes
- cita rutas exactas
- haz primero auditoría rápida antes de cambiar
- propone MVP antes de arquitectura completa
- cuando hagas migraciones, explica impacto y rollback
