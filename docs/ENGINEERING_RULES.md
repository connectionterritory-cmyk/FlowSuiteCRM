# FlowSuiteCRM — Engineering Rules

**Versión:** 1.1
**Fecha:** 2026-03-20
**Complementa:** [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md)
**Audiencia:** Codex, Claude Code, cualquier agente o colaborador que ejecute cambios en este repositorio

> Este documento es operativo. No define arquitectura — la describe en términos de acciones concretas.
> Todas las decisiones aquí derivan de `ARCHITECTURE_DECISIONS.md`. No se introduce ninguna decisión nueva.

---

## Índice

1. [Cambios que Codex puede hacer sin aprobación extra](#1-cambios-que-codex-puede-hacer-sin-aprobación-extra)
2. [Cambios que requieren revisión humana obligatoria](#2-cambios-que-requieren-revisión-humana-obligatoria)
3. [Módulos bloqueados temporalmente](#3-módulos-bloqueados-temporalmente)
4. [Orden recomendado de implementación](#4-orden-recomendado-de-implementación)
5. [Reglas para PRs pequeños y seguros](#5-reglas-para-prs-pequeños-y-seguros)
6. [Checklist de validación antes de merge](#6-checklist-de-validación-antes-de-merge)

---

## 1. Cambios que Codex puede hacer sin aprobación extra

Codex puede ejecutar cualquier cambio en esta lista **siempre que cumpla las condiciones indicadas y el módulo no esté en la sección 3**.

### 1.1 Migraciones SQL

| Acción | Condición obligatoria | Referencia |
|---|---|---|
| `ALTER TABLE x ADD COLUMN IF NOT EXISTS` | Solo en tablas SAFE-001 a SAFE-006 (`leads`, `citas`, `mk_*`, `productos`, `product_images`, `notasrp`). El tipo de dato debe ser nullable o tener `DEFAULT` seguro. | AD-001, AD-003, AD-004, AD-008 |
| `CREATE INDEX IF NOT EXISTS` | Preferir índices parciales (`WHERE condicion`). Nunca en tablas BLK-001 a BLK-004. | P4 |
| `CREATE OR REPLACE VIEW ... WITH (security_invoker = true)` | La vista no puede referenciar tablas BLK-*. Siempre incluir `security_invoker = true`. | P5 |
| Agregar nuevo valor al CHECK de `mk_responses.resultado` | El valor es aditivo — no modifica ni elimina valores existentes. | AD-004 |
| `CREATE POLICY ... ON tabla` (nueva política) | Solo en tablas SAFE-*. Usar únicamente las helper functions existentes: `is_admin()`, `is_distribuidor()`, `is_distribuidor_of(uuid)`, `is_vendedor()`, `is_admin_or_distribuidor()`, `is_supervisor_tele()`, `current_user_is_not_tele()`. Sin `DROP POLICY` previo. | AD-005 |
| `CREATE TABLE IF NOT EXISTS` para tablas de documentación 0061–0066 | Solo `CREATE TABLE IF NOT EXISTS`. Sin datos. Sin `DROP`. Sin `ALTER TABLE` sobre tablas existentes en la misma migración. | P4, P7 |
| `CREATE INDEX IF NOT EXISTS` en tablas pre-existentes MEDIA/BAJA | Sin `DROP INDEX`. Confirmar que la tabla existe con evidencia en el frontend o en una migración. | P7 |

### 1.2 Frontend TypeScript

| Acción | Condición obligatoria | Referencia |
|---|---|---|
| Agregar columna nueva al `select()` de Supabase | Solo si la columna existe en el schema confirmado o en una migración aplicada. | P3 |
| Agregar nuevo `segmento_key` en MarketingFlow | Si los parámetros del segmento son JSON, no requiere migración. Agregar solo al frontend. | AD-004, SAFE-006 |
| Modificar lógica de UI en módulos SAFE-001 a SAFE-006 | Sin cambiar nombres de columnas ni tipos en las queries. | P3 |
| Agregar traducción i18n en `es.json` / `en.json` | Sin restricciones, siempre que las claves sean nuevas. | — |
| Añadir componente React nuevo en módulos SAFE-* | Sin cambiar el schema de Supabase. | — |
| Modificar RLS-dependiente `contacto_tipo` en frontend | Solo los valores ya permitidos por CHECK: `'cliente'`, `'lead'`, `'ci_referido'`, `'4en14_referido'`. | AD-011 |

### 1.3 Lo que Codex NO puede hacer (resumen rápido)

> Lista completa en sección 2.

- `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` — nunca
- `ALTER TABLE servicios ADD COLUMN` antes de aplicar migración 0063 — requiere documentación base primero
- `ALTER TABLE ventas` RLS — BLK-003
- `DROP POLICY` en ninguna tabla activa
- Agregar `owner_id` a `clientes` — AD-002
- Modificar `is_admin()` u otras helper functions — AD-005
- `ALTER TABLE crm_tareas` o `contacto_actividades` ADD COLUMN — BLK-004
- Usar `is_org_member()` en cualquier SQL — función no existe (P8, CON-001 cerrada)

---

## 2. Cambios que requieren revisión humana obligatoria

Estos cambios **no pueden implementarse** hasta que el arquitecto los apruebe explícitamente, indicando en qué PR o issue queda registrada la aprobación.

### 2.1 Contradicciones activas sin resolver

Las contradicciones CON-001 a CON-004 fueron **resueltas en Fase 0 (2026-03-20)**. Solo CON-005 y CON-006 permanecen abiertas.

| ID | Qué resolver primero | Bloquea | Estado |
|---|---|---|---|
| ~~CON-001~~ | ~~`is_org_member()` en remote~~ | — | ✅ CERRADA — función no existe. Nunca usar. |
| ~~CON-002~~ | ~~Columnas reales de `servicios`~~ | — | ✅ CERRADA — schema confirmado (ver AD-002 v1.1). BLK-002 desbloqueado. |
| ~~CON-003~~ | ~~`servicio_componentes` inexistente~~ | — | ✅ CERRADA — tabla existe en remote. BLK-001 desbloqueado. |
| ~~CON-004~~ | ~~Filas en tablas legacy~~ | — | ✅ CERRADA — tablas no existen en remote. Migraciones 0080/0081 eliminadas. |
| CON-005 | Reconstruir 0050 desde estado real: `SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'ventas'` | Migración 0068, desbloqueo de BLK-003 | ⚠️ ABIERTA |
| CON-006 | Decidir si `vendedor_telemercadeo` es obsoleta o tiene propósito: tabla duplicada de `tele_vendedor_assignments` (vacía, sin uso documentado) | Riesgo de inconsistencia si se escribe en ella | ⚠️ ABIERTA |

### 2.2 Cambios de seguridad

| Cambio | Razón |
|---|---|
| Modificar cualquier función `security definer`: `is_admin()`, `is_distribuidor()`, `is_distribuidor_of()`, `is_vendedor()`, `is_admin_or_distribuidor()`, `is_supervisor_tele()`, `current_user_is_not_tele()`, `get_distributor_phone()`, `get_conversion_kpis()` | Afectan todas las políticas RLS del sistema. Un error expone datos de todos los usuarios. |
| `DROP POLICY` sobre cualquier tabla activa | Crea ventana sin protección entre el DROP y el CREATE siguiente. |
| Cambiar `ON DELETE` en FK existentes | Puede permitir borrado en cascada no deseado o bloquear borrados legítimos. |
| Cambiar `owner_id` de `NOT NULL` a nullable en cualquier tabla | Rompe el invariante de ownership (AD-002, AD-003). |
| Modificar el CHECK constraint de `usuarios.rol` | Afecta la jerarquía de roles completa (AD-005 / RH-010). |

### 2.3 Cambios arquitectónicos

| Cambio | Razón |
|---|---|
| Agregar `owner_id` a `clientes` | Contradice AD-002. Requiere decisión explícita. |
| Unificar `notasrp` + `lead_notas` en `contacto_actividades` | Migración de datos + cambio de frontend masivo (RH-009). |
| Refactorizar `v_agenda_hoy` (migración 0067) | BLK-001 desbloqueado — pero requiere decidir qué fuentes de datos y columnas incluir (RH-004). |
| Crear RLS para `crm_tareas` (migración 0065) | Tabla activa sin políticas — cualquier error expone recordatorios de todos (RH-005). |
| Crear RLS para `contacto_actividades` (migración 0066) | Idem (RH-006). |
| Cualquier `ALTER TABLE ventas` | BLK-003 sin resolver (RH-003). |
| Registrar `vendedor_telemercadeo` como obsoleta o documentar su propósito | CON-006 sin resolver — no hacer DROP hasta decisión. |

---

## 3. Módulos bloqueados temporalmente

Ningún cambio — migraciones, frontend, índices, vistas — puede aplicarse sobre módulos BLK-003 y BLK-004 hasta que su bloqueo se resuelva. BLK-001 y BLK-002 fueron **desbloqueados en Fase 0**.

### BLK-001 — `v_agenda_hoy` — ✅ DESBLOQUEADO (2026-03-20)

| Estado | ✅ DESBLOQUEADO |
|---|---|
| Causa original | CON-003 — referencia a `servicio_componentes` supuestamente inexistente |
| Resolución | `servicio_componentes` SÍ existe en remote (Fase 0). CON-003 CERRADA. |
| Archivos | `supabase/migrations/0028_clientes_geolocation.sql`, `flowsuitecrm/src/modules/hoy/HoyPage.tsx`, `flowsuitecrm/src/components/AgendaHoy.tsx` |
| Ahora permitido | Leer y usar `v_agenda_hoy`. Proponer mejoras via migración 0067 (requiere RH-004 para diseño). |

### BLK-002 — `servicios` — ✅ DESBLOQUEADO (2026-03-20)

| Estado | ✅ DESBLOQUEADO |
|---|---|
| Causa original | CON-002 — schema real desconocido |
| Resolución | Schema confirmado via REST API: `id, cliente_id, equipo_instalado_id, fecha_servicio, hora_cita, tipo, tipo_servicio, observaciones, venta_id, vendedor_id, created_at, updated_at`. CON-002 CERRADA. |
| Baseline documental | `docs/schema-baselines/servicios_remote_confirmed.sql` — columnas y tipos confirmados. Defaults, FK ON DELETE, CHECK y RLS marcados `[NO CONFIRMADO]`. |
| Migración 0063 | **NO EXISTE.** No crear hasta verificar `[NO CONFIRMADO]` en Dashboard. |
| Archivos | `flowsuitecrm/src/modules/servicio-cliente/ServicioClientePage.tsx` |
| Ahora permitido | Consultar `servicios` con las columnas confirmadas. Leer el baseline. `ALTER TABLE servicios ADD COLUMN` permitido solo **después** de crear y aplicar la migración 0063. |

### BLK-003 — `ventas` RLS

| Estado | BLOQUEADA para cambios de políticas RLS |
|---|---|
| Causa | Migración 0050 corrupta — CON-005 |
| Archivos afectados | `supabase/migrations/0050_ventas_rls_no_org.sql` |
| Para desbloquear | Resolver CON-005 + aprobación RH-003 + migración 0068 |
| Mientras tanto | El frontend puede consultar `ventas` con las políticas actuales (estado real desconocido). No agregar nuevas políticas. |

### BLK-004 — `crm_tareas` y `contacto_actividades` (extensión de schema)

| Estado | BLOQUEADAS para extensión de schema y nuevas políticas RLS |
|---|---|
| Causa | Tablas activas sin migración documentada ni RLS confirmado |
| Archivos afectados | `flowsuitecrm/src/modules/hoy/HoyPage.tsx`, `flowsuitecrm/src/modules/citas/CitaModal.tsx`, `flowsuitecrm/src/components/ContactoTimeline.tsx` |
| Para desbloquear | Aprobación RH-005 y RH-006 + migraciones 0065 y 0066 |
| Mientras tanto | El frontend puede seguir leyendo y escribiendo con las columnas actuales. No agregar `ALTER TABLE crm_tareas` ni `ALTER TABLE contacto_actividades`. |

---

## 4. Orden recomendado de implementación

Derivado del backlog de migraciones pendientes en `ARCHITECTURE_DECISIONS.md` sección 12. Cada fase solo puede comenzar cuando la fase anterior está completa y los bloqueos activos están resueltos.

### Fase 0 — Resolución de contradicciones — ✅ COMPLETADA (2026-03-20)

Inspecciones ejecutadas directamente contra el remote `rxiarmbosgivaplygqug` via Supabase CLI + REST API.

```
[✅] CON-001: is_org_member() — PGRST202 (no existe). organizations/memberships = HTTP 404.
[✅] CON-002: servicios schema real confirmado via REST + OpenAPI spec.
[✅] CON-003: servicio_componentes EXISTS en remote (0 live rows). v_agenda_hoy funcional.
[✅] CON-004: cliente_sistemas, cliente_componentes, agua_*, cob_gestiones = HTTP 404. No existen.
[ ] CON-005: ventas RLS — pendiente inspección en Dashboard (migración 0050 corrupta).
[ ] CON-006: vendedor_telemercadeo vacía — decisión de estado pendiente.
```

### Fase 1 — Documentación de tablas pre-existentes (sin riesgo)

Solo `CREATE TABLE IF NOT EXISTS`. Idempotente. Sin datos. Sin DROP.

```
[ ] 0061_document_leads.sql              — leads (schema de AD-001 v1.1)
[ ] 0062_document_clientes.sql           — clientes (schema de AD-002 v1.1)
[ ] 0063_document_servicios.sql          — servicios ← baseline en docs/schema-baselines/ — pendiente verificar defaults/FK/RLS en Dashboard antes de promover
[ ] 0064_document_equipos.sql            — equipos_instalados + componentes_equipo
```

### Fase 2 — Desbloqueo de crm_tareas y contacto_actividades

Requiere aprobación RH-005 y RH-006.

```
[ ] 0065_document_crm_tareas.sql         — CREATE TABLE IF NOT EXISTS + RLS
[ ] 0066_document_contacto_actividades.sql — CREATE TABLE IF NOT EXISTS + RLS
[ ] 0070_crm_tareas_indexes.sql          — depende de 0065
[ ] 0071_contacto_actividades_indexes.sql — depende de 0066
```

### Fase 3 — Mejoras y reparaciones

```
[ ] 0067_fix_v_agenda_hoy.sql            — BLK-001 DESBLOQUEADO. Requiere diseño (RH-004).
[ ] 0068_fix_ventas_rls.sql              — requiere CON-005 resuelto + RH-003
```

### Fase 4 — Mejoras no bloqueantes

Sin prerequisitos de contradicciones. Pueden ejecutarse en paralelo con las fases anteriores.

```
[ ] 0069_llamadas_tele_index.sql         — índice en followup_at (no bloqueante)
```

> **Nota (v1.1):** Fase 5 (deprecación de legacy) **eliminada**. Las tablas `agua_*`, `cliente_sistemas`, `cliente_componentes`, `cliente_productos`, `servicio_items` no existen en el remote. Las migraciones 0080 y 0081 se eliminaron del backlog (CON-004 cerrada).

---

## 5. Reglas para PRs pequeños y seguros

Un PR es seguro si cumple **todas** las siguientes condiciones. Si falla una, el PR requiere revisión humana antes de merge.

### 5.1 Definición de PR seguro

| Criterio | Definición |
|---|---|
| **Scope único** | El PR toca un solo dominio funcional (ej: solo `citas`, o solo frontend de MarketingFlow, o solo una migración). No mezcla dominios. |
| **Sin DROP** | No contiene ningún `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `DROP VIEW`, `DROP POLICY`, `DROP FUNCTION`, `DROP CONSTRAINT`, ni `TRUNCATE`. |
| **Módulos desbloqueados** | Ningún archivo modificado toca los módulos BLK-003 o BLK-004. (BLK-001 y BLK-002 desbloqueados en Fase 0.) |
| **Tablas SAFE** | Si hay SQL, solo toca tablas SAFE-001 a SAFE-006: `leads`, `citas`, `mk_campaigns`, `mk_messages`, `mk_responses`, `productos`, `product_images`, `notasrp`. |
| **Idempotente** | Todo SQL usa `IF NOT EXISTS` o `ON CONFLICT DO NOTHING`. Puede re-ejecutarse sin error. |
| **RLS intacto** | No elimina ni desactiva políticas RLS existentes. Si agrega políticas, usa solo helper functions de AD-005. |
| **Ownership respetado** | No agrega `owner_id` a `clientes`. No cambia `owner_id` a nullable en ninguna tabla. |
| **TypeCheck pasa** | `cd flowsuitecrm && npx tsc --noEmit` sale con 0 errores. |

### 5.2 Tamaño máximo recomendado

| Tipo de cambio | Máximo sugerido |
|---|---|
| Migración SQL pura | 1 archivo `.sql`, < 60 líneas |
| Migración + frontend relacionado | 1 `.sql` + archivos de 1 módulo |
| Frontend puro (sin DB) | 1 módulo completo o 1 componente |
| Documentación | Sin límite de tamaño |
| `docs/schema-baselines/*.sql` | Sin límite — son documentación, no migraciones ejecutables |

> **Regla `schema-baselines`:** Los archivos en `docs/schema-baselines/` son documentación técnica. **No son migraciones.** No se ejecutan contra el remote. No se colocan en `supabase/migrations/`. Solo se promueven a migración cuando todos los datos marcados `[NO CONFIRMADO]` en el baseline hayan sido verificados en Dashboard.

### 5.3 Naming de migraciones

```
{numero}_{verbo}_{objeto}.sql

Verbos permitidos:
  add_       → ADD COLUMN, CREATE INDEX
  create_    → CREATE TABLE
  fix_       → corrección de bug (vista, RLS)
  document_  → CREATE TABLE IF NOT EXISTS de tabla pre-existente
  rls_       → políticas RLS nuevas sobre tabla existente

Ejemplos:
  0069_add_llamadas_tele_index.sql       ✓
  0065_document_crm_tareas.sql           ✓
  0067_fix_v_agenda_hoy.sql              ✓
  0068_rls_ventas.sql                    ✓
  0099_drop_legacy_tables.sql            ✗ — DROP requiere revisión humana
```

### 5.4 Header obligatorio en cada migración

Cada archivo `.sql` debe comenzar con este bloque:

```sql
-- ============================================================
-- {numero}_{nombre}.sql
-- Descripción: {qué hace en una línea}
-- Tipo: documentación | add_column | create_index | fix_view | rls | ddl+rls
-- Prerequisito: {número de migración anterior si aplica, o "ninguno"}
-- Reversible: sí | no | parcial
-- ============================================================
```

---

## 6. Checklist de validación antes de merge

Ejecutar en orden. Si cualquier punto falla, **no hacer merge**.

### 6.1 Checklist para migraciones SQL

```
SCHEMA
[ ] El archivo comienza con el header obligatorio (sección 5.4)
[ ] El número de migración es consecutivo al último aplicado
[ ] Todo CREATE usa IF NOT EXISTS
[ ] No hay DROP TABLE, DROP COLUMN ni TRUNCATE sin aprobación de sección 2
[ ] No hay DROP POLICY (si se reemplaza una política, se hace con DROP + CREATE en transaction)

TABLAS
[ ] Las tablas modificadas no están en BLK-001 a BLK-004
[ ] Los nombres de tablas y columnas coinciden exactamente con ARCHITECTURE_DECISIONS.md
[ ] Si se agrega una columna a leads o citas, el schema en AD-001 / AD-003 fue actualizado

RLS
[ ] Si la migración crea una tabla nueva, tiene ALTER TABLE x ENABLE ROW LEVEL SECURITY
[ ] Si la migración crea una vista nueva, tiene security_invoker = true
[ ] Las nuevas políticas usan las helper functions de AD-005
[ ] No hay política que use is_org_member() — NUNCA usar, función no existe en remote (P8)

OWNERSHIP
[ ] No se agrega owner_id a clientes
[ ] No se cambia owner_id a nullable en ninguna tabla
[ ] Si se agrega una FK a usuarios(id), el ON DELETE está documentado (RESTRICT | SET NULL | CASCADE — elegir explícitamente)

IDEMPOTENCIA
[ ] La migración puede ejecutarse dos veces sin error
[ ] Si inserta datos, usa ON CONFLICT DO NOTHING
```

### 6.2 Checklist para cambios de frontend TypeScript

```
TIPOS
[ ] npx tsc --noEmit pasa sin errores desde flowsuitecrm/
[ ] No hay @ts-ignore ni as any nuevo

QUERIES SUPABASE
[ ] Las columnas en .select() existen en el schema confirmado o en una migración aplicada
[ ] Si se usa .from('tabla'), la tabla no está en BLK-001 a BLK-004 (o está en modo solo-lectura permitido)
[ ] Si se usa .insert() o .update() en crm_tareas o contacto_actividades, no se agregaron columnas nuevas

OWNERSHIP EN FRONTEND
[ ] Si se construye un objeto para insert/update en leads, incluye owner_id = user.id al crear
[ ] Si se construye un objeto para insert/update en clientes, NO incluye owner_id
[ ] Si se construye una cita, owner_id = auth.uid() en el insert

RLS
[ ] No se llama a supabase.rpc('is_org_member', ...) directamente desde frontend
[ ] Las queries no asumen acceso sin RLS (ej: no hacen .eq('org_id', x) como sustituto de RLS)

CONTACTO_TIPO
[ ] Los valores de contacto_tipo usados son solo: 'cliente', 'lead', 'ci_referido', '4en14_referido'
[ ] El frontend no escribe un valor nuevo de contacto_tipo sin migración que lo valide en DB
```

### 6.3 Checklist para documentación

```
[ ] Si se resolvió una contradicción (CON-*), actualizar la sección 3 de ARCHITECTURE_DECISIONS.md
[ ] Si se desbloqueó un módulo (BLK-*), actualizar la sección 5 de ARCHITECTURE_DECISIONS.md y la sección 3 de este documento
[ ] Si se aplicó una migración del backlog, marcarla como completada en la sección 12 de ARCHITECTURE_DECISIONS.md
[ ] Si se tomó una nueva decisión arquitectónica, agregarla como AD-0XX en ARCHITECTURE_DECISIONS.md antes del merge
[ ] GAP_LIST.md y MIGRATION_PLAN.md NO deben editarse — están reemplazados por ARCHITECTURE_DECISIONS.md (LEG-005)
```

### 6.4 Señales de alerta (pedir revisión humana si aparecen)

Si cualquiera de estos patrones aparece en el diff, detener y pedir revisión:

```
- DROP TABLE
- DROP COLUMN
- TRUNCATE
- DROP POLICY
- DROP CONSTRAINT
- security definer        ← modificación de función existente
- owner_id               ← en contexto de clientes
- is_org_member          ← NUNCA: función no existe en remote (P8, CON-001 cerrada)
- ALTER TABLE servicios ADD COLUMN ← solo después de aplicar migración 0063
- ALTER TABLE ventas     ← BLK-003
- crm_tareas ADD COLUMN  ← BLK-004
- contacto_actividades ADD COLUMN ← BLK-004
- vendedor_telemercadeo  ← CON-006 abierta, no escribir en esta tabla
```

---

## Historial de versiones

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 2026-03-20 | Documento inicial — derivado de ARCHITECTURE_DECISIONS.md v1.0 |
| 1.1 | 2026-03-20 | Fase 0 completada — CON-001/002/003/004 cerradas. BLK-001/002 desbloqueados. Sección 2.1 actualizada (solo CON-005/006 activas). Sección 3 actualizada. Sección 4 Fase 0 marcada como ✅. Fase 5 eliminada. Alert signals actualizadas. |
