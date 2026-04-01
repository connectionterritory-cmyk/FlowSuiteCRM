# FlowSuiteCRM — Architecture Decisions Document

**Versión:** 1.1
**Fecha última actualización:** 2026-03-20
**Fuente:** Análisis validado contra SQL real (migraciones 0001–0060 + frontend TypeScript + inspección directa remote Supabase `rxiarmbosgivaplygqug`)
**Autoridad:** Arquitecto revisor — requiere aprobación humana para cambios destructivos

> **Regla de fuente de verdad (agregada en v1.1):** En caso de discrepancia entre una migración y el estado del remote, el remote es la fuente de verdad. Las migraciones `CREATE TABLE IF NOT EXISTS` son NO-OP si la tabla ya existía con schema diferente. Toda columna debe verificarse en el remote antes de usarse en código nuevo.

---

## Índice

1. [Principios de arquitectura](#1-principios-de-arquitectura)
2. [Decisiones aprobadas](#2-decisiones-aprobadas)
3. [Contradicciones detectadas](#3-contradicciones-detectadas)
4. [Módulos legacy](#4-módulos-legacy)
5. [Módulos bloqueados](#5-módulos-bloqueados)
6. [Módulos seguros para Codex](#6-módulos-seguros-para-codex)
7. [Ownership canónico de datos](#7-ownership-canónico-de-datos)
8. [Tablas canónicas por dominio](#8-tablas-canónicas-por-dominio)
9. [Tablas pre-existentes sin migración documentada](#9-tablas-pre-existentes-sin-migración-documentada)
10. [Reglas para Codex](#10-reglas-para-codex)
11. [Reglas que requieren revisión humana obligatoria](#11-reglas-que-requieren-revisión-humana-obligatoria)
12. [Backlog de migraciones pendientes](#12-backlog-de-migraciones-pendientes)

---

## 1. Principios de arquitectura

Estos principios son inmutables. Todo cambio que los contradiga requiere discusión explícita.

| # | Principio | Descripción |
|---|---|---|
| P1 | **Primero diagnosticar** | Leer el SQL real antes de proponer cualquier cambio |
| P2 | **Sin destructivos sin advertencia** | `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` requieren aprobación humana y están marcados con ⚠️ RIESGO ALTO |
| P3 | **Nombres exactos** | Usar nombres exactos de tablas y columnas del esquema real, no los del análisis previo |
| P4 | **Migraciones idempotentes** | Todo SQL debe poder re-ejecutarse sin romper datos (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`) |
| P5 | **RLS en todo** | Ninguna tabla activa debe quedar sin RLS. `security_invoker = true` en vistas que exponen datos de múltiples roles |
| P6 | **Ownership explícito** | `owner_id` = creador inmutable, `vendedor_id` = gestor comercial activo, `assigned_to` / `asignado_a` = ejecutor operativo, `distribuidor_id` = jerarquía |
| P7 | **No inventar tablas** | Si una tabla no tiene CREATE TABLE en una migración documentada, está marcada como pre-existente y requiere documentación antes de usarla en nuevas features |
| P8 | **Remote es verdad** | `is_org_member()` no existe en el remote. `organizations` y `memberships` no existen. Cualquier política que use `is_org_member()` falló al crearse. Nunca escribir SQL que dependa de esa función. |

---

## 2. Decisiones aprobadas

Estas decisiones están implementadas, validadas en SQL y no se revierten.

### AD-001: Ownership de `leads`
- `owner_id`: inmutable, es quien creó el lead. RLS: `owner_id = auth.uid() AND deleted_at IS NULL`
- `vendedor_id`: reasignable por admin/distribuidor/supervisor_telemercadeo
- Soft-delete mediante `deleted_at`, `deleted_by`, `deleted_reason` (constraint: si `deleted_at IS NOT NULL` entonces `deleted_reason` requerido)
- **Columnas confirmadas (remote v1.1):** `id, owner_id, vendedor_id, nombre, apellido, telefono, telefono_conyuge, email, fuente, deleted_at, deleted_by, deleted_reason, fecha_nacimiento, next_action_date, next_action, direccion, ciudad, estado_region, codigo_postal, apartamento, estado_civil, estado_pipeline, ninos_en_casa, cantidad_ninos, nombre_conyuge, situacion_laboral, tipo_vivienda, tiene_productos_rp, embajador_id, programa_id, referido_por_cliente_id, last_reassigned_at, last_reassigned_by, updated_at, updated_by, whatsapp_mensaje_enviado_at, created_at`
- **Columnas adicionales descubiertas en Fase 0** (no estaban documentadas): `estado_civil, estado_pipeline, ninos_en_casa, cantidad_ninos, nombre_conyuge, telefono_conyuge, situacion_laboral, tipo_vivienda, tiene_productos_rp, embajador_id, programa_id, referido_por_cliente_id, last_reassigned_at, last_reassigned_by, updated_by, whatsapp_mensaje_enviado_at`

### AD-002: Ownership de `clientes`
- **`clientes` NO tiene `owner_id`**. Esta es una decisión de diseño confirmada.
- Ownership se controla exclusivamente mediante `vendedor_id` (gestor activo) y `distribuidor_id` (jerarquía comercial)
- `org_id` nullable — backfill al `00000000-0000-0000-0000-000000000001` default
- **Columnas confirmadas (remote v1.1):** `id, org_id, vendedor_id, distribuidor_id, nombre, apellido, telefono, telefono_casa, email, ciudad, estado_region, codigo_postal, hycite_id, tipo_cliente, monto_moroso, dias_atraso, estado_cuenta, elegible_addon, fecha_ultimo_pedido, origen, codigo_vendedor_hycite, codigo_dist_hycite, nivel, ultima_fecha_pago, next_action_date, next_action, lat, lng, activo, estado_morosidad, notas_internas, numero_cuenta_financiera, saldo_actual, ultimo_contacto_at, updated_at, fecha_nacimiento, direccion`
- **Columnas adicionales descubiertas en Fase 0** (no estaban documentadas): `activo, estado_morosidad, notas_internas, numero_cuenta_financiera, saldo_actual, ultimo_contacto_at, updated_at, fecha_nacimiento, direccion`

### AD-003: `citas` como tabla canónica de agendamiento
- Creada en migración 0032. Polimórfica: `contacto_tipo` (cliente|lead) + `contacto_id`
- Desnormaliza `nombre, telefono, direccion, ciudad, estado_region, zip` para historial offline
- `owner_id` con ON DELETE RESTRICT (no se puede borrar usuario con citas)
- `assigned_to` con ON DELETE SET NULL
- FK a `mk_campaigns`, `mk_messages`, `mk_responses` (todos ON DELETE SET NULL)
- **Citas NO reemplaza a `servicios`** — son dominios distintos. `citas` es agendamiento; `servicios` es ticket de campo.

### AD-004: MarketingFlow como dominio aislado
- `mk_campaigns` → `mk_messages` → `mk_responses` son el pipeline completo
- `mk_campaigns.owner_id` y `mk_messages.owner_id`: ON DELETE RESTRICT (final, corregido en 0026)
- `mk_messages` UNIQUE en `(campaign_id, telefono)` — soporta `onConflict` en PostgREST
- `mk_responses` UNIQUE en `(message_id)` — una respuesta por mensaje
- `mk_campaigns.segment_params`: JSONB para parámetros de segmento

### AD-005: Jerarquía de roles
Orden de acceso descendente:
```
admin > distribuidor > supervisor_telemercadeo > vendedor > telemercadeo > embajador
```
Helper functions con `security definer` + `set search_path = 'public', 'extensions'`:
- `is_admin()`, `is_distribuidor()`, `is_distribuidor_of(uuid)`, `is_vendedor()`
- `is_admin_or_distribuidor()`, `is_supervisor_tele()`
- `current_user_is_not_tele()` — evita recursión RLS en `usuarios_org_read`

**CONFIRMADO en Fase 0 (v1.1):** Todas las funciones anteriores EXISTEN en el remote. `is_org_member()` NO EXISTE y NUNCA debe usarse. `organizations` y `memberships` NO EXISTEN en el remote. Las políticas RLS de migraciones 0043/0044 que usaban `is_org_member()` fallaron al crearse y no están activas.

### AD-006: `next_action_date` / `next_action` como caché de seguimiento
- Existen en `leads` y `clientes` como desnormalización para queries rápidas
- Se populan desde `CitaModal` y auto-actions de `EnviosPage`
- `crm_tareas` es la fuente de verdad de recordatorios (ver AD-010)
- Las columnas `next_action_*` son cache — siempre se sobreescriben desde `crm_tareas`

### AD-007: `notasrp` y `lead_notas` como log de mensajes por tipo de entidad
- `notasrp`: historial de comunicación de `clientes` (cliente_id FK)
- `lead_notas`: historial de actividad de `leads` (lead_id FK)
- Ambas son legacy para log de mensajes — `contacto_actividades` es la solución moderna
- Se mantienen activas para retrocompatibilidad

### AD-008: `productos` — visibilidad separada de estado
- `activo boolean`: el producto existe en el sistema
- `visible_catalogo boolean DEFAULT true`: se muestra en catálogo público
- `estado text CHECK (activo|borrador|descontinuado|reemplazado)`: estado editorial
- `v_productos_publicos`: filtra `WHERE activo = true AND visible_catalogo = true` (security_invoker)
- `v_catalogo_vendedor`: vista completa con `reemplazado_por_id` y self-join para nombre de reemplazo

### AD-009: `v_componentes_vencidos` usa `equipos_instalados` + `componentes_equipo`
- Estas tablas son pre-existentes (sin migración documentada) pero activas
- La vista filtra `WHERE comp.activo = true AND comp.fecha_proximo_cambio <= current_date`
- `security_invoker = true` — RLS del caller se aplica
- Estas tablas son el sistema de equipos canónico (no `cliente_sistemas`/`cliente_componentes`)

### AD-010: `crm_tareas` es la tabla canónica de recordatorios
- Polimórfica: `contacto_tipo` + `contacto_id`
- Columnas confirmadas por remote (Fase 0 v1.1): `id, contacto_tipo, contacto_id, tipo, descripcion, asignado_a, created_by, fecha_vencimiento, hora_vencimiento, prioridad, estado, cita_origen_id, completada_at, completada_por, created_at, updated_at`
- Columna adicional descubierta en Fase 0: **`completada_por`** (uuid — quien marcó como completada)
- Estado: `pendiente` | `completada`
- Sin migración documentada — **requiere migración 0065 urgente**

### AD-011: `contacto_actividades` es el historial canónico unificado
- Log polimórfico para leads y clientes: `contacto_tipo` + `contacto_id`
- Columnas confirmadas por remote (Fase 0 v1.1): `id, contacto_tipo, contacto_id, tipo, resumen, contenido, metadata, autor_id, fecha_actividad, cita_id, created_at`
- Columna adicional descubierta en Fase 0: **`cita_id`** (uuid — FK opcional a `citas`)
- Tipos conocidos: `cita_completada`, y otros insertados desde `HoyPage`
- Sin migración documentada — **requiere migración 0066 urgente**

### AD-012: Arquitectura canónica de mensajería saliente (n8n)

**Decisión (2026-03-20):** El sistema de mensajería saliente se construye sobre tablas existentes. No se crea una tabla nueva de mensajería.

#### Roles por tabla

| Tabla | Rol canónico | Lo que NO hace |
|---|---|---|
| `mk_messages` | **Cola de salida** — cada fila es un mensaje pendiente o enviado. n8n lee aquí, envía, y escribe el resultado. | No es la fuente de datos del destinatario |
| `mk_responses` | **Tabla canónica de respuestas** — resultado de cada mensaje (`resultado`, `followup_at`, `monto_prometido`). Una respuesta por mensaje (UNIQUE `message_id`). | No registra el historial completo de actividad |
| `crm_tareas` | **Fuente operativa de recordatorios** — n8n puede leer tareas `pendientes` con `fecha_vencimiento <= today` para disparar mensajes. Después de enviar, actualiza `estado = 'completada'`. | No es la cola de envío — no tiene `telefono` ni `canal` directos |
| `clientes` / `leads` | **Contexto y destinatario** — fuente de `telefono`, `nombre`, estado del pipeline. Se consultan via JOIN desde `mk_messages` o `crm_tareas`. | No son colas de mensajes |
| `notasrp` / `lead_notas` | **Log de historial de comunicación** — registro post-envío para auditoría CRM. | No controlan el flujo de envío |

#### Flujo A — Campañas (funciona hoy, sin cambios)
```
mk_campaigns → mk_messages (status='pendiente')
  → n8n lee + envía
  → UPDATE mk_messages SET status='enviado', sent_at=now()
  → INSERT mk_responses (resultado, followup_at)
```

#### Flujo B — Recordatorios por vencimiento (funciona hoy, sin cambios)
```
crm_tareas (estado='pendiente', fecha_vencimiento<=today)
  → n8n lee + JOIN clientes/leads para telefono
  → n8n envía
  → UPDATE crm_tareas SET estado='completada', completada_at=now(), completada_por=<bot-uuid>
  → INSERT notasrp (cliente) o lead_notas (lead) para log de historial
```

#### Restricción conocida
`mk_messages.campaign_id` es `NOT NULL`. Los mensajes ad-hoc (no de campaña, ej. recordatorios que se quieran loggear en `mk_messages`) necesitan una **campaña de sistema estática** como catch-all. Esta campaña se crea via `INSERT` desde el frontend o desde n8n — no requiere migración.

#### Campo pendiente (no bloqueante)
`mk_messages` no tiene `scheduled_at`. Sin ese campo, n8n no puede diferenciar "enviar ahora" de "enviar en fecha futura". Agregar `scheduled_at timestamp with time zone` es seguro (SAFE-003) y se puede hacer via `ALTER TABLE mk_messages ADD COLUMN IF NOT EXISTS scheduled_at timestamp with time zone`. Esta es la única adición que agrega valor concreto al flujo — queda como mejora opcional, no prerequisito.

#### Reglas permanentes
- `mk_messages` es la única cola de salida. No crear `mensaje_salida`, `outbox`, `envios_pendientes` ni ninguna tabla equivalente.
- `mk_responses` es la única tabla de resultados. No duplicar en `notasrp` el resultado — `notasrp` es el log humano-legible, no el registro de control.
- n8n escribe en `mk_messages.status`, `mk_messages.sent_at`, `mk_responses`, y opcionalmente en `notasrp`/`lead_notas`. No escribe en ninguna otra tabla sin una decisión explícita.

---

## 3. Contradicciones detectadas

Las contradicciones marcadas como **CERRADA** fueron resueltas en la inspección de Fase 0 (2026-03-20) con evidencia directa del remote `rxiarmbosgivaplygqug`.

### CON-001: `is_org_member()` — existencia en remote DB — ✅ CERRADA

- **Evidencia (Fase 0):** Llamada RPC directa a `is_org_member()` retornó `PGRST202` — función no encontrada en schema cache. `organizations` y `memberships` retornan HTTP 404 via REST API.
- **Resolución:** `is_org_member()` NO existe en el remote. `organizations` y `memberships` NO existen. Las políticas de 0043 y 0044 que usaban esta función fallaron al crearse. Las políticas activas en `clientes` son las de migración 0042 (solo usan `is_admin()`, `is_distribuidor()`, `is_distribuidor_of()`).
- **Regla permanente (P8):** NUNCA escribir SQL que use `is_org_member()`. La función no existe y no se creará sin una decisión arquitectónica explícita.

### CON-002: `servicios` — definición de migración vs. tabla real — ✅ CERRADA

- **Evidencia (Fase 0):** Lectura directa via `REST /rest/v1/servicios?limit=1&select=*` + OpenAPI spec.
- **Schema real confirmado:** `id, cliente_id, equipo_instalado_id, fecha_servicio, hora_cita, tipo, tipo_servicio, observaciones, venta_id, vendedor_id, created_at, updated_at`
- **Columnas de migración 0002 que NO existen:** `org_id, ticket_number, titulo, descripcion, estado, prioridad, asignado_a, fecha_apertura, fecha_cierre`
- **Columna no documentada encontrada:** `tipo` (text — no aparece en `ServicioClientePage.tsx`)
- **BLK-002 desbloqueado.** Ver sección 5.

### CON-003: `v_agenda_hoy` / `servicio_componentes` — ✅ CERRADA

- **Evidencia (Fase 0):** `supabase inspect db table-stats --linked` muestra `public.servicio_componentes` con 0 filas live. OpenAPI spec confirma columnas: `id, servicio_id, componente_equipo_id, accion, created_at, updated_at`.
- **Resolución:** `servicio_componentes` SÍ existe en el remote. La vista `v_agenda_hoy` NO está rota. El análisis previo era incorrecto — la tabla no tenía migración documentada pero sí existía en el remote.
- **BLK-001 desbloqueado.** Ver sección 5.

### CON-004: Tablas legacy (agua, servicio, cartera, Team Hub) — ✅ CERRADA

- **Evidencia (Fase 0):** HTTP 404 via REST API para todas las tablas. Confirmado con `supabase inspect db table-stats` (ninguna aparece en la lista).
- **Resolución:** `cliente_sistemas`, `cliente_componentes`, `agua_sistemas`, `agua_reglas`, `agua_componentes`, `cliente_productos`, `servicio_items`, `cob_gestiones`, `cargo_vuelta_cases`, `canales`, `anuncios`, `organizations`, `memberships` **NO EXISTEN en el remote**. Las migraciones 0001 y 0002 nunca se aplicaron al remote (o fueron revertidas). No hay datos que auditar ni migrar.
- **Consecuencia para LEG-001 a LEG-004:** Cerradas como irrelevantes. Ver sección 4.
- **Consecuencia para backlog:** Migraciones 0080 y 0081 eliminadas — no hay nada que deprecar.

### CON-005: `0050_ventas_rls_no_org.sql` está corrupto — ⚠️ ABIERTA PARCIAL

- **Contenido real del archivo:** Solo contiene `"emercadeo supervisor puede ver todas las citas"` (texto truncado/corrupto)
- **Hallazgo Fase 0:** `ventas` NO tiene columna `org_id`. Por lo tanto, las políticas de 0044 que usaban `is_org_member(org_id)` sobre `ventas` también fallaron (columna inexistente). `ventas` tiene 1 fila live y 3121 dead rows (vacuum pendiente).
- **Pendiente:** El estado exacto de las políticas RLS activas sobre `ventas` no pudo verificarse sin `psql`. Requiere revisión en Supabase Dashboard → Authentication → Policies → tabla `ventas`.
- **Acción requerida:** Verificar políticas activas en Dashboard, luego escribir migración 0068.

### CON-006: `vendedor_telemercadeo` vs `tele_vendedor_assignments` — ⚠️ ABIERTA (nueva, Fase 0)

- **Descubierta en:** Fase 0 — `supabase inspect db table-stats`
- **Problema:** Dos tablas para el mismo concepto (asignación tele↔vendedor):
  - `tele_vendedor_assignments`: `id, tele_id, vendedor_id, created_at` — **usada por el frontend y todas las políticas RLS**
  - `vendedor_telemercadeo`: `id, telemercadista_id, vendedor_id, created_at, updated_at` — vacía (0 filas live), sin uso confirmado en frontend ni en migraciones documentadas
- **Riesgo:** Si algún código futuro escribe en `vendedor_telemercadeo` creyendo que es la tabla canónica, el sistema de asignaciones quedará inconsistente.
- **Tabla canónica:** `tele_vendedor_assignments` (confirmada por uso en RLS y frontend)
- **Acción requerida:** Decisión humana — registrar `vendedor_telemercadeo` como obsoleta o documentar su propósito. Sin DROP hasta revisión.

---

## 4. Módulos legacy

Estos módulos tienen código de migración en el repositorio pero las tablas **no existen en el remote** (confirmado en Fase 0, 2026-03-20).

### LEG-001: Scheduler de agua (migración 0002) — ✅ IRRELEVANTE
- **Tablas:** `agua_sistemas`, `agua_componentes`, `agua_reglas`, `cliente_sistemas`, `cliente_componentes`
- **Estado (Fase 0):** HTTP 404 via REST API. No existen en remote `rxiarmbosgivaplygqug`. Migración 0002 nunca se aplicó (o fue revertida).
- **Sistema activo equivalente:** `equipos_instalados` + `componentes_equipo` + `v_componentes_vencidos`
- **Regla:** No referenciar en ningún código. No crear migraciones para estas tablas. No hay datos que auditar.

### LEG-002: Tablas MVP de servicio (migración 0002) — ✅ IRRELEVANTE
- **Tablas:** `cliente_productos`, `servicio_items`
- **Estado (Fase 0):** HTTP 404 via REST API. No existen en remote. Migración 0002 nunca se aplicó.
- **Regla:** No referenciar en ningún código. No crear migraciones para estas tablas.

### LEG-003: Cartera legacy (migración 0002) — ✅ IRRELEVANTE
- **Tablas:** `cob_gestiones`, `cargo_vuelta_cases`
- **Estado (Fase 0):** HTTP 404 via REST API. No existen en remote. Migración 0002 nunca se aplicó.
- **Regla:** No referenciar en ningún código. No crear migraciones para estas tablas.

### LEG-004: Team Hub (migración 0002) — ✅ IRRELEVANTE
- **Tablas:** `canales`, `anuncios`
- **Estado (Fase 0):** HTTP 404 via REST API. No existen en remote. Migración 0002 nunca se aplicó.
- **Regla:** No referenciar en ningún código. No crear migraciones para estas tablas.

### LEG-005: GAP_LIST.md y MIGRATION_PLAN.md en `/docs`
- Documentos desactualizados — reflejan gaps que ya fueron cerrados (ej: piden crear `servicios`, `cliente_productos` que ya existen)
- **Regla:** No usarlos como referencia de estado actual. Reemplazados por este documento.

---

## 5. Módulos bloqueados

Los módulos BLK-001 y BLK-002 fueron **desbloqueados** en Fase 0 (2026-03-20). BLK-003 y BLK-004 permanecen bloqueados.

### BLK-001: `v_agenda_hoy` — ✅ DESBLOQUEADO (2026-03-20)
- **Bloqueaba por:** CON-003 (referencia a `servicio_componentes` supuestamente inexistente)
- **Resolución (Fase 0):** `servicio_componentes` SÍ existe en remote (0 filas live, confirmado via `supabase inspect db table-stats`). CON-003 CERRADA.
- **Estado actual:** La vista `v_agenda_hoy` NO estaba rota. El frontend puede usarla normalmente.
- **Pendiente no bloqueante:** Migración 0067 puede proceder para refactorizar o mejorar la vista — ahora requiere solo aprobación RH-004 (decisión de diseño).
- **Codex puede:** Leer y usar `v_agenda_hoy` y `HoyPage.tsx`. Proponer mejoras via migración 0067.

### BLK-002: `servicios` — ✅ DESBLOQUEADO (2026-03-20)
- **Bloqueaba por:** CON-002 (schema real desconocido)
- **Resolución (Fase 0):** Schema real confirmado via REST API + OpenAPI spec. CON-002 CERRADA.
- **Schema real confirmado:** `id, cliente_id, equipo_instalado_id, fecha_servicio, hora_cita, tipo, tipo_servicio, observaciones, venta_id, vendedor_id, created_at, updated_at`
- **Baseline documental:** `docs/schema-baselines/servicios_remote_confirmed.sql` — columnas y tipos confirmados. Defaults, FK ON DELETE, CHECK constraints y RLS marcados como `[NO CONFIRMADO]`.
- **Migración 0063:** **NO EXISTE todavía.** No promover el baseline a `supabase/migrations/` hasta verificar en Dashboard los datos marcados como `[NO CONFIRMADO]`.
- **Codex puede:** Leer `servicios` con las columnas confirmadas. Consultar el baseline documental. **No puede** crear `0063_document_servicios.sql` hasta que los `[NO CONFIRMADO]` estén resueltos.

### BLK-003: `ventas` RLS — BLOQUEADA
- **Bloqueada por:** CON-005 (migración 0050 corrupta)
- **Acción para desbloquear:** Reconstruir y aplicar las políticas RLS de `ventas`
- **Codex NO puede tocar:** No agregar políticas sobre `ventas` sin resolver el estado actual

### BLK-004: `crm_tareas` y `contacto_actividades` — BLOQUEADAS para extensión
- **Bloqueadas por:** Sin migración documentada — schema no oficializado
- **Frontend activo:** Ambas son usadas activamente
- **Acción para desbloquear:** Migraciones 0065 y 0066 de documentación
- **Codex NO puede tocar:** No agregar columnas ni RLS hasta tener las migraciones base

---

## 6. Módulos seguros para Codex

Estos módulos tienen schema estable, RLS completo y ninguna contradicción activa. Codex puede trabajar en ellos sin aprobación adicional, siguiendo las reglas de la sección 10.

### SAFE-001: `leads` — seguro para features
- Schema documentado en AD-001
- RLS completo: admin/distribuidor/vendedor/supervisor_tele con políticas separadas por operación
- Codex puede: agregar columnas nuevas (ADD COLUMN IF NOT EXISTS), agregar RLS policies, crear índices parciales, crear vistas con security_invoker

### SAFE-002: `citas` — seguro para features
- Schema documentado en AD-003 (migración 0032)
- RLS completo: citas_select, citas_insert, citas_update, citas_delete, citas_tele_read, citas_supervisor_tele_read
- Codex puede: agregar columnas nuevas, agregar tipos a los CHECK constraints existentes, crear vistas, agregar índices

### SAFE-003: `mk_campaigns` / `mk_messages` / `mk_responses` — seguro para features
- Schema documentado en AD-004 (migración 0025 + 0026)
- RLS completo por operación para todos los roles
- `v_mk_campaign_stats` segura con security_invoker
- Codex puede: agregar segmentos nuevos al `segmento_key`, agregar resultados al enum de `mk_responses.resultado`, agregar columnas analytics

### SAFE-004: `productos` / `product_images` — seguro para features
- Schema documentado en AD-008
- RLS completo para admin/distribuidor/vendedor/telemercadeo
- `v_productos_publicos` y `v_catalogo_vendedor` estables
- Codex puede: agregar columnas al catálogo, agregar imágenes via `product_images`, modificar vistas

### SAFE-005: `notasrp` — seguro para features de mensajería de clientes
- Schema documentado en AD-007 (migración 0021)
- RLS completo: admin/vendedor/distribuidor/telemercadeo
- Codex puede: agregar tipos de canal, agregar columnas de metadata

### SAFE-006: `mk_campaigns` segmentos — seguro para nuevos segmentos MarketingFlow
- `segment_params JSONB` permite nuevos parámetros sin ALTER TABLE
- Codex puede: agregar nuevos `segmento_key` en frontend sin migración

---

## 7. Ownership canónico de datos

Esta tabla es autoritativa. Cualquier discrepancia con código existente debe resolverse a favor de esta tabla.

| Columna | Significado | Mutabilidad | Tablas que la usan |
|---|---|---|---|
| `owner_id` | Creador/dueño administrativo del registro | **Inmutable** | `leads`, `citas`, `mk_campaigns`, `mk_messages`, `ci_activaciones` |
| `vendedor_id` | Responsable comercial activo | Reasignable por admin/distribuidor/supervisor_tele | `leads`, `clientes`, `servicios`, `equipos_instalados`, `ventas` |
| `assigned_to` / `asignado_a` | Ejecutor operativo actual | Reasignable | `citas` (assigned_to), `servicios` (asignado_a legacy) |
| `distribuidor_id` | Jerarquía o línea comercial | Por estructura org | `clientes` |
| `registrado_por` | Quien registró la respuesta | Inmutable post-insert | `mk_responses` |
| `asignado_a` | Ejecutor en crm_tareas | Reasignable | `crm_tareas` |
| `autor_id` | Quien generó la actividad | Inmutable | `contacto_actividades` |

**Regla crítica:** `clientes` NO tiene `owner_id`. Nunca agregar `owner_id` a `clientes` sin una decisión arquitectónica explícita.

---

## 8. Tablas canónicas por dominio

| Dominio | Tabla canónica | Alternativas deprecated |
|---|---|---|
| Prospectos | `leads` | — |
| Clientes | `clientes` | — |
| Agendamiento | `citas` | `servicios.hora_cita` (para servicios de campo) |
| Tickets de campo | `servicios` (tabla real pre-existente) | — |
| Equipos instalados | `equipos_instalados` | `cliente_productos` (legacy 0002) |
| Componentes de equipo | `componentes_equipo` | `cliente_componentes` (legacy 0002, agua) |
| Catálogo de productos | `productos` + `product_images` | — |
| Campañas | `mk_campaigns` | — |
| Cola de mensajes salientes (n8n) | `mk_messages` | — |
| Respuestas y resultados de mensajes | `mk_responses` | — |
| Notas de clientes | `notasrp` | — |
| Notas de leads | `lead_notas` | — |
| Historial unificado | `contacto_actividades` | `notasrp` + `lead_notas` (legacy por tipo) |
| Recordatorios | `crm_tareas` | `next_action_date`/`next_action` (cache) |
| Usuarios | `usuarios` | — |
| Asignaciones tele | `tele_vendedor_assignments` | — |
| Referidos CI | `ci_referidos` → `ci_activaciones` | — |
| Programa 4en14 | `programa_4en14_referidos` → `programa_4en14` | — |
| Importaciones | `importaciones_hycite` | — |
| Ventas | `ventas` | — |

---

## 9. Tablas pre-existentes sin migración documentada

Estas tablas **existen en Supabase** y son usadas activamente, pero no tienen `CREATE TABLE` en ninguna migración del repositorio. Son una deuda de documentación de alta prioridad.

| Tabla | Evidencia de uso | Prioridad de documentación |
|---|---|---|
| `leads` | RLS en 0004, 0010, 0047, 0048, 0055 | ALTA — tabla central |
| `clientes` | ADD COLUMN en 0001, 0018, 0024, 0028 | ALTA — tabla central |
| `usuarios` | FK en todas las migraciones | ALTA — tabla central |
| `servicios` | ADD COLUMN hora_cita en 0028; usado en frontend | ALTA — BLK-002 desbloqueado, baseline en docs/schema-baselines/ |
| `ventas` | RLS en 0044; RLS corrupta en 0050 | ALTA — bloqueada (CON-005) |
| `lead_notas` | ADD COLUMN en 0021, índices en 0015 | MEDIA |
| `tele_vendedor_assignments` | RLS en 0006, 0044 | MEDIA |
| `productos` | ADD COLUMN en 0019, 0052, 0057, 0058 | MEDIA |
| `equipos_instalados` | Referencia en 0027; usado en frontend | MEDIA |
| `componentes_equipo` | Referencia en 0027; usado en frontend | MEDIA |
| `crm_tareas` | Usado activamente en HoyPage.tsx, CitaModal.tsx | ALTA — ver BLK-004 |
| `contacto_actividades` | Usado en ContactoTimeline.tsx, CitaModal.tsx | ALTA — ver BLK-004 |
| `llamadas_telemercadeo` | ADD COLUMN en 0007 | BAJA |
| `programa_4en14` | FK desde programa_4en14_referidos | BAJA |
| `ci_activaciones` | RLS en 0013, 0014 | BAJA |
| `whatsapp_templates_org` | Creada en 0011 (PARTIAL — solo la tabla) | BAJA |

---

## 10. Reglas para Codex

Codex puede ejecutar estas acciones **sin aprobación extra**, siempre que cumpla TODAS las condiciones:

### Permitido sin aprobación

| Acción | Condición |
|---|---|
| `ALTER TABLE x ADD COLUMN IF NOT EXISTS` | Solo en tablas de la sección 6 (SAFE-*). Tipo apropiado. Default seguro. |
| `CREATE INDEX IF NOT EXISTS` | Solo índices parciales o covering. Nunca en tablas BLK-*. |
| `CREATE OR REPLACE VIEW ... WITH (security_invoker = true)` | Solo si la vista no referencia tablas BLK-*. |
| Agregar un nuevo `segmento_key` al frontend de MarketingFlow | Sin cambios de DB si usa `segment_params JSONB`. |
| Agregar un nuevo resultado al enum de `mk_responses.resultado` | Via ADD CONSTRAINT o modificar CHECK. Solo si el valor es aditivo. |
| Crear política RLS nueva en tablas SAFE-* | Usando las helper functions existentes. Sin DROP de políticas existentes. |
| Modificar frontend TypeScript en módulos SAFE-* | Sin cambiar tipos de datos de columnas existentes. |
| Crear migración de documentación (`0061`–`0066`) | Solo `CREATE TABLE IF NOT EXISTS`. Sin datos. Sin DROP. |

### Prohibido para Codex (requiere revisión humana)

| Acción | Razón |
|---|---|
| `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` | Destructivo irreversible |
| Cualquier cambio en tablas BLK-003 o BLK-004 | Bloqueadas por contradicciones activas o falta de RLS |
| `ALTER TABLE ventas` RLS | CON-005 sin resolver (BLK-003) |
| `ALTER TABLE crm_tareas` o `contacto_actividades` ADD COLUMN | BLK-004 — sin migración base documentada |
| `ALTER TABLE servicios ADD COLUMN` antes de aplicar migración 0063 | BLK-002 desbloqueado pero requiere documentación previa |
| Cambiar `owner_id` a nullable en cualquier tabla | Rompe invariante de ownership |
| Agregar `owner_id` a `clientes` | Contradice AD-002 |
| Modificar helper functions de seguridad (`is_admin()`, etc.) | Impacto en todas las políticas RLS |
| `DROP POLICY` + recrear en tablas activas | Riesgo de ventana sin protección |
| Modificar o eliminar el constraint UNIQUE `mk_messages(campaign_id, telefono)` | Rompe `onConflict` en PostgREST |
| Modificar `check_search_path` en funciones `security definer` | Vulnerabilidad de seguridad |
| Usar `is_org_member()` en cualquier SQL | Función NO EXISTE en remote (P8, CON-001 cerrada) |

---

## 11. Reglas que requieren revisión humana obligatoria

Estos cambios deben ser aprobados explícitamente por el arquitecto antes de implementarse.

| ID | Cambio | Razón | Estado |
|---|---|---|---|
| ~~RH-001~~ | ~~Resolver CON-001 (is_org_member)~~ | — | ✅ CERRADA — Fase 0 confirmó que no existe. Nunca usar. |
| RH-002 | Crear migración 0063 (`servicios` documentación) | Baseline en `docs/schema-baselines/servicios_remote_confirmed.sql`. Pendiente confirmar en Dashboard: defaults, FK ON DELETE, CHECK constraints, RLS. | Baseline listo — migración bloqueada hasta verificación |
| RH-003 | Reconstruir 0050 (ventas RLS) | Archivo corrupto — requiere inspección de políticas activas en Dashboard | Abierta |
| RH-004 | Mejorar / refactorizar `v_agenda_hoy` (migración 0067) | BLK-001 desbloqueado. Decidir qué columnas/fuentes incluir en la nueva versión | Listo para diseño |
| RH-005 | Documentar y crear RLS para `crm_tareas` | Tabla activa sin políticas documentadas — riesgo de exposición | Abierta |
| RH-006 | Documentar y crear RLS para `contacto_actividades` | Idem | Abierta |
| ~~RH-007~~ | ~~Deprecar `cliente_sistemas` / `cliente_componentes`~~ | — | ✅ CERRADA — Tablas no existen en remote (CON-004). No hay nada que deprecar. |
| ~~RH-008~~ | ~~Deprecar `cliente_productos` / `servicio_items`~~ | — | ✅ CERRADA — Tablas no existen en remote (CON-004). No hay nada que deprecar. |
| RH-009 | Unificar `notasrp` + `lead_notas` → `contacto_actividades` | Migración de datos + cambio de frontend — alto impacto | Abierta |
| RH-010 | Cualquier cambio a la jerarquía de roles en `usuarios.rol` | Impacto en todas las políticas RLS del sistema | Abierta |

---

## 12. Backlog de migraciones pendientes

Ordenadas por prioridad. Las marcadas con ⚠️ requieren revisión humana (sección 11) antes de ejecutarse.

### Prioridad ALTA — Sin riesgo de datos

| Migración | Descripción | Tipo | Prerequisito | Estado |
|---|---|---|---|---|
| `0061_document_leads.sql` | `CREATE TABLE IF NOT EXISTS leads (...)` | Documentación | — | Listo |
| `0062_document_clientes.sql` | `CREATE TABLE IF NOT EXISTS clientes (...)` | Documentación | — | Listo |
| `0063_document_servicios.sql` | `CREATE TABLE IF NOT EXISTS servicios (...)` con schema real | Documentación | ⚠️ RH-002 — verificar defaults/FK/RLS | Baseline documental en `docs/schema-baselines/` — migración ejecutable **pendiente** |
| `0064_document_equipos.sql` | `CREATE TABLE IF NOT EXISTS equipos_instalados + componentes_equipo` | Documentación | — | Listo |
| `0065_document_crm_tareas.sql` | `CREATE TABLE IF NOT EXISTS crm_tareas (...)` + RLS | DDL + RLS | ⚠️ RH-005 | Requiere aprobación |
| `0066_document_contacto_actividades.sql` | `CREATE TABLE IF NOT EXISTS contacto_actividades (...)` + RLS | DDL + RLS | ⚠️ RH-006 | Requiere aprobación |

### Prioridad ALTA — Mejoras y reparaciones

| Migración | Descripción | Tipo | Prerequisito | Estado |
|---|---|---|---|---|
| `0067_fix_v_agenda_hoy.sql` | Refactorizar / mejorar `v_agenda_hoy` | REPLACE VIEW | ⚠️ RH-004 | **Desbloqueado en Fase 0** — diseño pendiente |
| `0068_fix_ventas_rls.sql` | Reconstruir RLS de `ventas` (reemplaza 0050 corrupto) | RLS | ⚠️ RH-003 (CON-005) | Requiere inspección Dashboard |

### Prioridad MEDIA — Mejoras no bloqueantes

| Migración | Descripción | Tipo | Prerequisito |
|---|---|---|---|
| `0069_llamadas_tele_index.sql` | `CREATE INDEX IF NOT EXISTS idx_llamadas_followup ON llamadas_telemercadeo(followup_at) WHERE followup_at IS NOT NULL` | Index | — |
| `0070_crm_tareas_indexes.sql` | Índices en `crm_tareas(asignado_a, estado)` y `(contacto_tipo, contacto_id)` | Index | 0065 |
| `0071_contacto_actividades_indexes.sql` | Índice en `contacto_actividades(contacto_tipo, contacto_id, fecha_actividad DESC)` | Index | 0066 |

> **Nota (v1.1):** Las migraciones `0080_deprecate_agua_scheduler.sql` y `0081_deprecate_legacy_servicio.sql` fueron **eliminadas del backlog**. Las tablas que deprecaban (`agua_*`, `cliente_sistemas`, `cliente_componentes`, `cliente_productos`, `servicio_items`) no existen en el remote — confirmado en Fase 0 (CON-004 cerrada). No hay nada que deprecar.

---

## Historial de versiones

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 2026-03-20 | Documento inicial — basado en análisis validado contra SQL real (migraciones 0001–0060) |
| 1.1 | 2026-03-20 | Fase 0 ejecutada — CON-001/002/003/004 CERRADAS. CON-006 agregada. BLK-001/002 DESBLOQUEADOS. LEG-001–004 marcadas IRRELEVANTES (tablas no existen en remote). AD-001/002 actualizadas con columnas reales. AD-005/010/011 actualizadas. P8 agregado. RH-001/007/008 cerradas. Backlog 0080/0081 eliminados. AD-012 agregado. schema-baselines/ formalizado. |
