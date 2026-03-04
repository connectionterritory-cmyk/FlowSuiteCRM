# MarketingFlow — Segmentos v1
**Fecha:** 2026-03-03 | **Sprint:** 1

Catálogo de los 12 segmentos predefinidos para Sprint 1.
Cada segmento mapea a un `segmento_key` almacenado en `mk_campaigns.segmento_key`.

---

## Convenciones

- **RLS implícito**: las queries se ejecutan vía Supabase con sesión activa. RLS de `leads` (owner_id = auth.uid()), `clientes` (vendedor_id = auth.uid()), y `ci_referidos` (via activación) filtra automáticamente por vendedor. Las queries no necesitan filtro explícito de owner.
- **Soft-delete leads**: todas las queries de leads incluyen `deleted_at IS NULL`.
- **Actividad**: `v_lead_last_activity` es la view existente que expone `last_activity` (max created_at de lead_notas por lead).
- **Fuente de datos**: solo tablas existentes en el schema actual.

---

## 1. `leads_nuevos`
**Leads nuevos sin ningún contacto**

| Campo | Valor |
|-------|-------|
| Tipo | leads |
| Prioridad | Alta |
| Plantilla sugerida | seguimiento |

**Descripción:** Leads que entraron al pipeline pero nunca han sido contactados. Sin nota, sin cita, sin actividad.

**Query:**
```sql
select
  l.id,
  l.nombre,
  l.apellido,
  l.telefono,
  l.email,
  l.fuente,
  l.estado_pipeline,
  l.created_at
from public.leads l
left join public.v_lead_last_activity v on v.id = l.id
where l.deleted_at is null
  and l.estado_pipeline = 'nuevo'
  and (v.last_activity is null)
order by l.created_at asc;
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`, `{fuente}`

---

## 2. `leads_contactados_sin_cita`
**Leads contactados sin cita programada**

| Campo | Valor |
|-------|-------|
| Tipo | leads |
| Prioridad | Alta |
| Plantilla sugerida | seguimiento, citas |

**Descripción:** Leads que ya fueron contactados (al menos una nota) pero no tienen cita agendada ni han avanzado en el pipeline. Necesitan seguimiento para convertir.

**Query:**
```sql
select
  l.id,
  l.nombre,
  l.apellido,
  l.telefono,
  l.email,
  l.estado_pipeline,
  v.last_activity
from public.leads l
join public.v_lead_last_activity v on v.id = l.id
where l.deleted_at is null
  and l.estado_pipeline = 'contactado'
  and v.last_activity is not null
order by v.last_activity asc;  -- más antiguos primero
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`

---

## 3. `leads_sin_actividad_7d`
**Leads sin actividad en los últimos 7 días**

| Campo | Valor |
|-------|-------|
| Tipo | leads |
| Prioridad | Media-Alta |
| Plantilla sugerida | seguimiento |

**Descripción:** Leads activos (no descartados, no cerrados) que no han tenido ninguna nota ni actividad en los últimos 7 días. Riesgo de enfriamiento.

**Query:**
```sql
select
  l.id,
  l.nombre,
  l.apellido,
  l.telefono,
  l.email,
  l.estado_pipeline,
  v.last_activity
from public.leads l
join public.v_lead_last_activity v on v.id = l.id
where l.deleted_at is null
  and l.estado_pipeline not in ('descartado', 'cierre')
  and v.last_activity < now() - interval '7 days'
order by v.last_activity asc;
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`, `{estado_pipeline}`

---

## 4. `leads_sin_actividad_14d`
**Leads sin actividad en los últimos 14 días**

| Campo | Valor |
|-------|-------|
| Tipo | leads |
| Prioridad | Media |
| Plantilla sugerida | seguimiento |

**Descripción:** Versión extendida del segmento anterior. Leads que llevan más de 2 semanas sin actividad. Riesgo alto de perder el interés.

**Query:**
```sql
select
  l.id,
  l.nombre,
  l.apellido,
  l.telefono,
  l.email,
  l.estado_pipeline,
  v.last_activity
from public.leads l
join public.v_lead_last_activity v on v.id = l.id
where l.deleted_at is null
  and l.estado_pipeline not in ('descartado', 'cierre')
  and v.last_activity < now() - interval '14 days'
order by v.last_activity asc;
```

**Nota:** Este segmento es un superconjunto de `leads_sin_actividad_7d`. Ejecutar uno u otro, no ambos en la misma campaña.

---

## 5. `leads_cita_hoy`
**Leads con cita confirmada para hoy**

| Campo | Valor |
|-------|-------|
| Tipo | leads |
| Prioridad | Urgente |
| Plantilla sugerida | citas |

**Descripción:** Leads con `estado_pipeline = 'cita'` y `next_action_date = hoy`. Recordatorio del día de la cita.

**Query:**
```sql
select
  l.id,
  l.nombre,
  l.apellido,
  l.telefono,
  l.email,
  l.next_action,
  l.next_action_date
from public.leads l
where l.deleted_at is null
  and l.estado_pipeline = 'cita'
  and l.next_action_date = current_date
order by l.nombre asc;
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`, `{next_action}`, `{next_action_date}`

---

## 6. `leads_cita_proximos_3d`
**Leads con cita en los próximos 3 días**

| Campo | Valor |
|-------|-------|
| Tipo | leads |
| Prioridad | Alta |
| Plantilla sugerida | citas |

**Descripción:** Leads con cita programada para mañana, pasado mañana, o en 3 días. Confirmación anticipada para reducir no-shows.

**Query:**
```sql
select
  l.id,
  l.nombre,
  l.apellido,
  l.telefono,
  l.email,
  l.next_action,
  l.next_action_date
from public.leads l
where l.deleted_at is null
  and l.estado_pipeline = 'cita'
  and l.next_action_date > current_date
  and l.next_action_date <= current_date + interval '3 days'
order by l.next_action_date asc;
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`, `{next_action_date}`

---

## 7. `leads_calificados`
**Leads calificados listos para demo**

| Campo | Valor |
|-------|-------|
| Tipo | leads |
| Prioridad | Alta |
| Plantilla sugerida | citas |

**Descripción:** Leads que han sido calificados pero aún no tienen cita de demo agendada. El paso ideal es convertirlos a `estado_pipeline = 'cita'`.

**Query:**
```sql
select
  l.id,
  l.nombre,
  l.apellido,
  l.telefono,
  l.email,
  l.estado_pipeline,
  l.fuente
from public.leads l
where l.deleted_at is null
  and l.estado_pipeline = 'calificado'
order by l.created_at asc;
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`

---

## 8. `leads_reclutamiento`
**Leads de reclutamiento activos**

| Campo | Valor |
|-------|-------|
| Tipo | leads |
| Prioridad | Media |
| Plantilla sugerida | referidos, general |

**Descripción:** Leads cuya fuente es `'reclutamiento'` y que no han sido descartados. Candidatos a unirse al equipo de vendedores.

**Query:**
```sql
select
  l.id,
  l.nombre,
  l.apellido,
  l.telefono,
  l.email,
  l.estado_pipeline,
  l.fuente
from public.leads l
where l.deleted_at is null
  and l.fuente = 'reclutamiento'
  and l.estado_pipeline != 'descartado'
order by l.created_at desc;
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`, `{organizacion}`

---

## 9. `clientes_cartera_0_30`
**Cartera vencida 0-30 días**

| Campo | Valor |
|-------|-------|
| Tipo | clientes |
| Prioridad | Alta |
| Plantilla sugerida | cartera |

**Descripción:** Clientes con saldo moroso de 0 a 30 días de atraso. Ventana de cobro preventivo — alta probabilidad de pago si se contacta ahora.

**Query:**
```sql
select
  c.id,
  c.nombre,
  c.apellido,
  c.telefono,
  c.telefono_casa,
  c.saldo_actual,
  c.monto_moroso,
  c.dias_atraso,
  c.estado_morosidad,
  c.codigo_vendedor_hycite
from public.clientes c
where c.estado_morosidad = '0-30'
  and c.monto_moroso > 0
  and c.telefono is not null
order by c.monto_moroso desc;  -- mayor deuda primero
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`, `{saldo_actual}`, `{monto_moroso}`, `{dias_atraso}`, `{estado_morosidad}`

**Resultados relevantes:** `pago_prometido`, `pago_realizado`, `ya_pago`, `disputa`, `reagendar`, `sin_respuesta`, `buzon`, `numero_incorrecto`

---

## 10. `clientes_cartera_31_60`
**Cartera vencida 31-60 días**

| Campo | Valor |
|-------|-------|
| Tipo | clientes |
| Prioridad | Urgente |
| Plantilla sugerida | cartera |

**Descripción:** Clientes con 31 a 60 días de atraso. Requieren contacto urgente antes de que entren en estado crítico.

**Query:**
```sql
select
  c.id,
  c.nombre,
  c.apellido,
  c.telefono,
  c.telefono_casa,
  c.saldo_actual,
  c.monto_moroso,
  c.dias_atraso,
  c.estado_morosidad,
  c.codigo_vendedor_hycite
from public.clientes c
where c.estado_morosidad = '31-60'
  and c.monto_moroso > 0
  and c.telefono is not null
order by c.monto_moroso desc;
```

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`, `{saldo_actual}`, `{monto_moroso}`, `{dias_atraso}`, `{estado_morosidad}`

---

## 11. `clientes_cumpleanos_semana`
**Clientes con cumpleaños en los próximos 7 días**

| Campo | Valor |
|-------|-------|
| Tipo | clientes |
| Prioridad | Media |
| Plantilla sugerida | cumpleanos, general |

**Descripción:** Clientes cuyo cumpleaños (mes + día) cae dentro de los próximos 7 días. Oportunidad de contacto cálido y fidelización.

**Query:**
```sql
select
  c.id,
  c.nombre,
  c.apellido,
  c.telefono,
  c.fecha_nacimiento,
  c.nivel
from public.clientes c
where c.fecha_nacimiento is not null
  and c.telefono is not null
  and (
    -- cumpleaños dentro de los próximos 7 días en el año actual
    make_date(
      extract(year from current_date)::int,
      extract(month from c.fecha_nacimiento)::int,
      extract(day from c.fecha_nacimiento)::int
    ) between current_date and current_date + interval '7 days'
    or
    -- manejo de wrap año nuevo (ej: hoy = 28 dic, cumple = 2 ene)
    make_date(
      extract(year from current_date)::int + 1,
      extract(month from c.fecha_nacimiento)::int,
      extract(day from c.fecha_nacimiento)::int
    ) between current_date and current_date + interval '7 days'
  )
order by
  extract(month from c.fecha_nacimiento) asc,
  extract(day from c.fecha_nacimiento) asc;
```

**Nota técnica:** `make_date` falla si `fecha_nacimiento` es 29-feb y el año actual no es bisiesto. Agregar guard en TypeScript antes de insertar en mk_messages: si el contacto tiene feb-29 y el año no es bisiesto, usar feb-28.

**Variables de plantilla disponibles:**
`{cliente}`, `{nombre_completo}`, `{vendedor}`, `{organizacion}`

---

## 12. `ci_referidos_tele_pendientes`
**Referidos CI asignados a telemercadeo sin gestionar**

| Campo | Valor |
|-------|-------|
| Tipo | ci_referidos |
| Prioridad | Alta |
| Plantilla sugerida | referidos |

**Descripción:** Referidos de Conexiones Infinitas en modo telemercadeo que aún no han sido contactados (estado = 'pendiente'). El equipo de telemercadeo debe iniciar el contacto para convertirlos a lead.

**Query:**
```sql
select
  r.id,
  r.nombre,
  r.telefono,
  r.calificacion,
  r.estado,
  r.modo_gestion,
  a.representante_id,
  -- datos del representante (para contexto)
  u.nombre  as rep_nombre,
  u.apellido as rep_apellido
from public.ci_referidos r
join public.ci_activaciones a on a.id = r.activacion_id
join public.usuarios u on u.id = a.representante_id
where r.modo_gestion = 'telemercadeo'
  and r.estado = 'pendiente'
  and r.telefono is not null
  and r.lead_id is null  -- no convertido aún
order by r.calificacion desc nulls last, a.created_at asc;
```

**Nota de acceso:** Este segmento es usado principalmente por rol `telemercadeo`. Las campañas con este segmento deben tener `owner_id` del vendedor/distribuidor que asigna al equipo tele.

**Variables de plantilla disponibles:**
`{cliente}` (= nombre del referido), `{nombre_completo}`, `{vendedor}` (= nombre del representante), `{calificacion}`

---

## Resumen

| # | Key | Tipo | Tabla(s) | Prioridad |
|---|-----|------|----------|-----------|
| 1 | `leads_nuevos` | leads | leads, v_lead_last_activity | Alta |
| 2 | `leads_contactados_sin_cita` | leads | leads, v_lead_last_activity | Alta |
| 3 | `leads_sin_actividad_7d` | leads | leads, v_lead_last_activity | Media-Alta |
| 4 | `leads_sin_actividad_14d` | leads | leads, v_lead_last_activity | Media |
| 5 | `leads_cita_hoy` | leads | leads | Urgente |
| 6 | `leads_cita_proximos_3d` | leads | leads | Alta |
| 7 | `leads_calificados` | leads | leads | Alta |
| 8 | `leads_reclutamiento` | leads | leads | Media |
| 9 | `clientes_cartera_0_30` | clientes | clientes | Alta |
| 10 | `clientes_cartera_31_60` | clientes | clientes | Urgente |
| 11 | `clientes_cumpleanos_semana` | clientes | clientes | Media |
| 12 | `ci_referidos_tele_pendientes` | ci_referidos | ci_referidos, ci_activaciones, usuarios | Alta |

---

## Implementación TypeScript (`segments.ts`)

Cada segmento se implementa como un objeto `SegmentDefinition`:

```typescript
export type SegmentDefinition = {
  key: string
  label: string
  descripcion: string
  contacto_tipo: 'lead' | 'cliente' | 'ci_referido' | '4en14_referido'
  badge: 'leads' | 'clientes' | 'CI'
  fetchContacts: (supabase: SupabaseClient, session: Session) => Promise<ContactRow[]>
  buildVariables: (row: ContactRow, currentUser: Usuario) => Record<string, string>
}

export const SEGMENTS: Record<string, SegmentDefinition> = {
  leads_nuevos: {
    key: 'leads_nuevos',
    label: 'Leads nuevos sin contactar',
    descripcion: 'Leads en estado nuevo sin ninguna actividad registrada',
    contacto_tipo: 'lead',
    badge: 'leads',
    fetchContacts: async (supabase) => {
      const { data } = await supabase
        .from('leads')
        .select('id, nombre, apellido, telefono, email, fuente, estado_pipeline, created_at')
        .eq('estado_pipeline', 'nuevo')
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
      return data ?? []
    },
    buildVariables: (row, user) => ({
      cliente: row.nombre,
      nombre_completo: `${row.nombre} ${row.apellido ?? ''}`.trim(),
      vendedor: `${user.nombre} ${user.apellido ?? ''}`.trim(),
      organizacion: user.organizacion ?? '',
      telefono: user.telefono ?? '',
    }),
  },
  // ... resto de segmentos siguen el mismo patrón
}
```
