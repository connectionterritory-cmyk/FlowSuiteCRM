# Auditoría DB + RLS — FlowSuiteCRM
**Fecha:** 2026-03-03 | **Migraciones auditadas:** 0001 → 0019

---

## 1. Custom ENUMs

| Tipo | Valores |
|------|---------|
| `usuario_rol` | admin, distribuidor, vendedor, telemercadeo, embajador |
| `cliente_estado_morosidad` | 0-30, 31-60, 61-90, 91+ |
| `lead_estado_pipeline` | nuevo, contactado, calificado, descartado, cita, demo, cierre |
| `oportunidad_etapa` | nuevo, contactado, calificado, propuesta, negociacion, cerrado_ganado, cerrado_perdido |
| `programa_4en14_estado` | activo, completado, vencido |
| `programa_4en14_referido_estado` | pendiente, agendada, show, demo_calificada, venta, no_interes |
| `embajador_nivel` | silver, gold |
| `venta_tipo_movimiento` | venta_inicial, agregado |

---

## 2. Funciones Helper (SECURITY DEFINER)

| Función | Descripción |
|---------|-------------|
| `is_admin()` | Rol = 'admin' |
| `is_distribuidor()` | Rol = 'distribuidor' |
| `is_distribuidor_of(uuid)` | Verifica relación distribuidor→vendedor via `distribuidor_padre_id` |
| `is_vendedor()` | Rol = 'vendedor' OR 'telemercadeo' |
| `is_org_member(uuid)` | Pertenece a la organización (multitenant) |
| `is_org_admin(uuid)` | Admin de la organización |
| `get_distributor_phone()` | Teléfono del distribuidor o superior jerárquico |
| `set_updated_at()` | Trigger: actualiza `updated_at` |
| `fn_proteger_roles()` | Trigger: solo admin puede cambiar rol de usuario |
| `ci_referidos_enforce_prioridad_top()` | Trigger: max 4 top por activación |
| `ci_create_leads_for_activation()` | Trigger: crea leads desde ci_referidos al enviar WA |

---

## 3. Tablas Relevantes para Marketing

### 3.1 USUARIOS
**Columnas clave:** id, nombre, apellido, email, telefono, rol, distribuidor_padre_id, codigo_vendedor, organizacion, foto_url, activo

**RLS:**
| Policy | Operación | Condición |
|--------|-----------|-----------|
| admin_all | ALL | is_admin() |
| dist_team_select | SELECT | distribuidor_padre_id = auth.uid() OR self |
| dist_team_insert | INSERT | rol IN (vendedor, telemercadeo, embajador) |
| usuarios_self_read | SELECT | id = auth.uid() |

**Uso en marketing:** Filtrar envíos por vendedor/distribuidor; asignar campañas a equipos.

---

### 3.2 CLIENTES
**Columnas clave:** id, nombre, apellido, telefono, telefono_casa, email, nivel, estado_cuenta, estado_morosidad, monto_moroso, dias_atraso, saldo_actual, fecha_nacimiento, fecha_ultimo_pedido, ultima_fecha_pago, ciudad, estado_region, codigo_vendedor_hycite, elegible_addon, vendedor_id, distribuidor_id

**RLS:**
| Policy | Operación | Condición |
|--------|-----------|-----------|
| clientes_admin_all | ALL | is_admin() |
| clientes_vendedor_all | ALL | vendedor_id = auth.uid() |
| clientes_distribuidor_read | SELECT | is_distribuidor() AND (distribuidor_id = uid OR is_distribuidor_of(vendedor_id)) |

**Segmentos directamente disponibles:**
- Cobranza: `estado_morosidad IN ('0-30','31-60','61-90','91+')`
- Cumpleaños: `EXTRACT(MONTH FROM fecha_nacimiento) = EXTRACT(MONTH FROM CURRENT_DATE)`
- Inactivos: `fecha_ultimo_pedido < NOW() - INTERVAL '6 months'`
- Nivel: `nivel IN (1,2,3,...9)`
- Ciudad/Región: `ciudad = ?` o `estado_region = ?`
- Elegibles add-on: `elegible_addon = true`
- Por emprendedor: `codigo_vendedor_hycite = ?`

---

### 3.3 LEADS
**Columnas clave:** id, nombre, apellido, telefono, email, estado_pipeline, next_action, next_action_date, fuente, owner_id, deleted_at

**RLS:**
| Policy | Operación | Condición |
|--------|-----------|-----------|
| leads_admin_all | ALL | is_admin() |
| leads_vendedor_all | SELECT/INSERT | owner_id = auth.uid() AND deleted_at IS NULL |
| leads_distribuidor_read | SELECT | is_distribuidor_of(owner_id) AND deleted_at IS NULL |

**Segmentos disponibles:**
- Por pipeline: `estado_pipeline = 'contactado'`
- Con cita pendiente: `estado_pipeline = 'cita' AND next_action_date = CURRENT_DATE`
- Fuente reclutamiento: `fuente = 'reclutamiento'`

---

### 3.4 CI_ACTIVACIONES / CI_REFERIDOS
**Columnas clave activaciones:** id, representante_id, cliente_id, lead_id, estado, whatsapp_mensaje_enviado_at
**Columnas clave referidos:** id, activacion_id, nombre, telefono, estado, modo_gestion, calificacion, lead_id

**RLS:** Basada en `representante_id` y `owner_id` con extensión admin/distribuidor (migración 0014).

**Uso en marketing:** Campañas de reclutamiento/CI hacia referidos con `modo_gestion='telemercadeo'` aún no trabajados.

---

### 3.5 PROGRAMA_4EN14
**Columnas clave programa:** id, propietario_id, vendedor_id, estado, ciclo_numero, presentaciones_logradas, meta_presentaciones, fecha_inicio, fecha_fin
**Columnas clave referidos:** id, programa_id, nombre, telefono, estado_presentacion, lead_id

**Segmentos:**
- Programas activos: `estado = 'activo'`
- Referidos pendientes: `estado_presentacion = 'pendiente'`
- Programas por vencer: `fecha_fin < NOW() + INTERVAL '7 days'`

---

### 3.6 COMPONENTES_EQUIPO (Garantía/Servicio)
**Columnas clave:** id, equipo_instalado_id, nombre_componente, ciclo_meses, fecha_ultimo_cambio, fecha_proximo_cambio, activo

**Segmento garantía:** `fecha_proximo_cambio BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`

JOIN: `componentes_equipo → equipos_instalados → clientes`

---

### 3.7 LLAMADAS_TELEMERCADEO
**Columnas relevantes:** followup_at, monto_prometido (migración 0007)

**Uso:** Seguimiento de compromisos de pago en cobranza.

---

### 3.8 WHATSAPP_TEMPLATES_ORG
**Columnas:** id, organizacion, template_key, label, message, category, is_system

**RLS:** SELECT para todos autenticados de la org; INSERT/UPDATE/DELETE solo admin/distribuidor.

---

## 4. Relaciones FK Críticas para Marketing

```
clientes
  ├── vendedor_id → usuarios
  ├── distribuidor_id → usuarios
  ├── equipos_instalados → componentes_equipo (garantía)
  └── (hycite_id → código externo)

leads
  ├── owner_id → usuarios
  └── referido_por_cliente_id → clientes

ci_activaciones
  ├── representante_id → usuarios
  ├── cliente_id → clientes
  └── lead_id → leads
        └── ci_referidos → leads

programa_4en14
  ├── vendedor_id → usuarios
  └── programa_4en14_referidos → leads
```

---

## 5. Riesgos y Observaciones

### Riesgo 1: Duplicación de "contacto"
- **Problema:** Un prospecto puede existir como `lead`, `ci_referido`, `programa_4en14_referido`, y `embajador` a la vez. No hay tabla unificada de "contacto".
- **Impacto para marketing:** Un envío masivo podría duplicar mensajes al mismo teléfono.
- **Mitigación:** Deduplicar por `telefono` antes de ejecutar campaña. La tabla `mk_envios` propuesta registra `telefono` y permite detectar duplicados antes de enviar.

### Riesgo 2: `estado_region` contaminado
- **Problema:** El campo `clientes.estado_region` puede contener valores de estado de cuenta ("Purgado", "Actual") si el import mapea incorrectamente la columna "Estado".
- **Impacto:** Segmentación geográfica incorrecta.
- **Mitigación:** Limpiar con update donde `estado_region IN ('Actual','Purgado','De 0 a 30 días de atraso',...)`.

### Riesgo 3: Falta de tabla unificada de "lead_notas" para follow-up
- **Problema:** `lead_notas` existe para leads, pero no hay equivalente estructurado para clientes o referidos.
- **Impacto:** No se puede auditar historial de contacto de clientes en Cartera.
- **Mitigación:** `mk_envios` cubre esto para campañas de marketing.

### Riesgo 4: Sin campo `ultimo_contacto` en clientes
- No hay `last_contacted_at` en clientes. Debe derivarse de `mk_envios` o `llamadas_telemercadeo`.

### Riesgo 5: RLS de `clientes` sin política para telemercadeo
- Rol `telemercadeo` no tiene policy explícita en `clientes`. Acceden vía `tele_vendedor_assignments`.
- Para MarketingFlow, telemercadeo necesitará leer clientes asignados.

---

## 6. Views Existentes

| Vista | Propósito | Security |
|-------|-----------|----------|
| `v_lead_last_activity` | Última actividad por lead (leads + lead_notas) | security_invoker (RLS enforced) |
| `contactos_canonical` | Mirror de contactos | — |

---

## 7. Tablas SIN uso directo en marketing (excluir del scope)

- `oportunidades` — pipeline B2B, no relevante para campañas masivas
- `ventas` — histórico financiero, solo para KPIs
- `agua_sistemas/componentes/reglas` — referencia para segmento garantía
- `cob_gestiones` / `cargo_vuelta_cases` — scope cobranza operativa
- `canales` / `anuncios` — comunicación interna
- `periodos_programa` / `embajador_programas` — ciclos del programa embajador
- `plan_limits` / `organizations` / `memberships` — multitenant (no tocar)

---

## 8. Índices útiles para queries de segmentación

```sql
-- Ya existen:
clientes_fecha_nacimiento_idx      -- segmento cumpleaños
componentes_equipo_proximo_idx     -- segmento garantía
leads_active_idx                   -- leads no eliminados
programa_4en14_estado_idx          -- programas activos

-- Faltan (crear en migración marketing):
idx_clientes_estado_morosidad      -- segmento cobranza
idx_clientes_fecha_ultimo_pedido   -- segmento reactivación
idx_clientes_elegible_addon        -- segmento addon
```
