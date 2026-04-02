-- ============================================================
-- backfill_persona_audit.sql
--
-- Propósito: SOLO LECTURA. Identifica grupos de registros en
--   leads, clientes y embajadores que comparten el mismo teléfono
--   dentro del mismo scope de owner/distribuidor, candidatos a
--   ser vinculados bajo un mismo persona_id.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor (con service role)
-- NO modifica ningún dato.
--
-- Scope de matching:
--   • telefono exacto (normalizado: sin espacios, solo dígitos)
--   • Mismo árbol de distribuidor: leads.owner_id /
--     clientes.vendedor_id comparten el mismo distribuidor_padre_id,
--     o el registro es directamente del mismo distribuidor.
--   • Excluye leads con deleted_at IS NOT NULL (soft-deleted).
--   • Excluye clientes inactivos (activo = false).
--
-- Columnas de salida:
--   telefono_norm   teléfono normalizado usado para el match
--   tabla           'lead' | 'cliente' | 'embajador'
--   registro_id     uuid del registro en su tabla origen
--   nombre, apellido nombre completo del registro
--   email           para verificación adicional del par
--   owner_id        vendedor propietario (owner_id o vendedor_id)
--   distribuidor_id distribuidor del árbol (para verificar scope)
--   persona_id      si ya tiene uno asignado (NULL = sin asignar)
--   created_at      antigüedad del registro
-- ============================================================

-- ── Paso 1: unificar los tres registros en un CTE plano ───────

with candidatos as (

  select
    regexp_replace(l.telefono, '[^0-9]', '', 'g')  as telefono_norm,
    'lead'::text                                    as tabla,
    l.id                                            as registro_id,
    l.nombre,
    l.apellido,
    l.email,
    l.owner_id                                      as owner_id,
    u_lead.distribuidor_padre_id                    as distribuidor_id,
    l.persona_id,
    l.created_at
  from public.leads l
  left join public.usuarios u_lead on u_lead.id = l.owner_id
  where l.telefono is not null
    and length(regexp_replace(l.telefono, '[^0-9]', '', 'g')) >= 7
    and l.deleted_at is null

  union all

  select
    regexp_replace(c.telefono, '[^0-9]', '', 'g')  as telefono_norm,
    'cliente'::text                                 as tabla,
    c.id                                            as registro_id,
    c.nombre,
    c.apellido,
    c.email,
    c.vendedor_id                                   as owner_id,
    c.distribuidor_id                               as distribuidor_id,
    c.persona_id,
    c.created_at
  from public.clientes c
  where c.telefono is not null
    and length(regexp_replace(c.telefono, '[^0-9]', '', 'g')) >= 7
    and c.activo = true

  union all

  select
    regexp_replace(e.telefono, '[^0-9]', '', 'g')  as telefono_norm,
    'embajador'::text                               as tabla,
    e.id                                            as registro_id,
    e.nombre,
    e.apellido,
    e.email,
    e.owner_id                                      as owner_id,
    u_emb.distribuidor_padre_id                     as distribuidor_id,
    e.persona_id,
    e.created_at
  from public.embajadores e
  left join public.usuarios u_emb on u_emb.id = e.owner_id
  where e.telefono is not null
    and length(regexp_replace(e.telefono, '[^0-9]', '', 'g')) >= 7

),

-- ── Paso 2: filtrar solo teléfonos que aparecen en más de una tabla ──
--   (cross-tabla match: el interés está en lead↔cliente↔embajador)

grupos as (

  select
    telefono_norm,
    count(distinct tabla)    as tablas_distintas,
    count(*)                 as total_registros,
    bool_or(persona_id is not null) as algun_ya_vinculado
  from candidatos
  group by telefono_norm
  having count(distinct tabla) > 1   -- al menos 2 tablas distintas

)

-- ── Paso 3: resultado final con todos los registros del grupo ─

select
  c.telefono_norm,
  c.tabla,
  c.registro_id,
  c.nombre,
  c.apellido,
  c.email,
  c.owner_id,
  coalesce(c.distribuidor_id, c.owner_id)  as distribuidor_efectivo,
  c.persona_id,
  c.created_at,
  g.tablas_distintas,
  g.total_registros,
  g.algun_ya_vinculado
from candidatos c
join grupos g on g.telefono_norm = c.telefono_norm
order by
  c.telefono_norm,
  c.tabla,
  c.created_at;

-- ============================================================
-- INTERPRETACIÓN DE RESULTADOS
-- ============================================================
--
-- Cada grupo de filas con el mismo telefono_norm es un candidato
-- a compartir un persona_id. Revisar manualmente:
--
--   1. nombre/apellido coincide o es variación del mismo nombre
--      → par válido para backfill
--
--   2. nombre muy diferente con mismo teléfono
--      → posible número compartido (familia) — NO vincular
--
--   3. algun_ya_vinculado = true
--      → verificar que el persona_id existente sea el correcto
--      → solo agregar los registros sin persona_id al mismo id
--
-- ── Query auxiliar: conteo resumen ───────────────────────────
--
-- select
--   tablas_distintas,
--   count(distinct telefono_norm) as grupos,
--   sum(total_registros)          as registros_afectados
-- from (
--   select distinct on (telefono_norm)
--     telefono_norm, tablas_distintas, total_registros
--   from (
--     -- pegar el query principal aquí
--   ) s
-- ) r
-- group by tablas_distintas
-- order by tablas_distintas;
--
-- ============================================================
-- SIGUIENTE PASO (NO ejecutar hasta validar el SELECT):
-- Ver backfill_persona_apply.sql
-- ============================================================
