-- ============================================================
-- backfill_persona_apply.sql
--
-- Propósito: Crea registros en public.personas y vincula los
--   leads/clientes/embajadores confirmados por el operador.
--
-- PREREQUISITO: Ejecutar backfill_persona_audit.sql primero y
--   validar manualmente cada grupo antes de correr este script.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor (service role)
-- Envuelto en transacción — se puede hacer ROLLBACK si algo falla.
--
-- Estrategia:
--   1. Por cada grupo de telefono_norm confirmado, crear UN solo
--      registro en personas usando los datos del registro más antiguo.
--   2. Actualizar persona_id en todos los registros del grupo.
--   3. Si algún registro ya tiene persona_id, reusar ese id en lugar
--      de crear uno nuevo.
-- ============================================================

begin;

-- ── Grupo 1: Isabella Caicedo — teléfono 7866147099 ──────────
--
-- Confirmado: mismo nombre/apellido, mismo árbol de distribuidor.
-- Fuente canónica de identidad: cliente (registro más consolidado).
-- Validado manualmente en audit 2026-04-01.

do $$
declare
  v_persona_id uuid;
  v_lead_id      uuid := 'ebc77453-ea51-4d64-8571-3c902e25bae6';
  v_cliente_id   uuid := 'cc1aa2d9-14b3-4cd6-b02d-4529a8cb1bed';
  v_embajador_id uuid := null;
  -- Identidad tomada del registro cliente (fuente canónica):
  v_nombre           text;
  v_apellido         text;
  v_email            text;
  v_telefono         text := '7866147099';
  v_fecha_nacimiento date;
  v_org_id           uuid := '00000000-0000-0000-0000-000000000001';
begin

  -- Leer identidad directamente del cliente (evita hardcodear datos que pueden cambiar)
  select nombre, apellido, email, fecha_nacimiento
  into   v_nombre, v_apellido, v_email, v_fecha_nacimiento
  from   public.clientes
  where  id = v_cliente_id;

  -- Verificar si algún registro del grupo ya tiene persona_id
  select coalesce(
    (select persona_id from public.leads       where id = v_lead_id      and persona_id is not null),
    (select persona_id from public.clientes    where id = v_cliente_id   and persona_id is not null),
    (select persona_id from public.embajadores where id = v_embajador_id and persona_id is not null)
  ) into v_persona_id;

  -- Si no existe persona aún, crear una nueva
  if v_persona_id is null then
    insert into public.personas (nombre, apellido, email, telefono, fecha_nacimiento, org_id)
    values (v_nombre, v_apellido, v_email, v_telefono, v_fecha_nacimiento, v_org_id)
    returning id into v_persona_id;
  end if;

  -- Vincular lead
  if v_lead_id is not null then
    update public.leads set persona_id = v_persona_id where id = v_lead_id;
  end if;

  -- Vincular cliente
  if v_cliente_id is not null then
    update public.clientes set persona_id = v_persona_id where id = v_cliente_id;
  end if;

  -- Vincular embajador (ninguno en este grupo)
  if v_embajador_id is not null then
    update public.embajadores set persona_id = v_persona_id where id = v_embajador_id;
  end if;

  raise notice 'Grupo vinculado: persona_id=%, lead=%, cliente=%, embajador=%',
    v_persona_id, v_lead_id, v_cliente_id, v_embajador_id;

end $$;

-- ── Grupos pendientes de validación manual ───────────────────
--
-- 7862913042: Betty Lopez (cliente) / Patricia Caicedo (lead) → ❌ NO vincular
-- 7866146546: Jorge Escalante (embajador) / Julian Caicedo (lead) → ❌ NO vincular
-- 8135918310: Nathaly Rivas (cliente) / Nathaly (lead) → ❌ NO vincular (descartada 2026-04-01)

-- ── Verificación antes de commit ──────────────────────────────

select
  p.id         as persona_id,
  p.nombre,
  p.apellido,
  p.telefono,
  l.id         as lead_id,
  c.id         as cliente_id,
  e.id         as embajador_id
from public.personas p
left join public.leads       l on l.persona_id = p.id
left join public.clientes    c on c.persona_id = p.id
left join public.embajadores e on e.persona_id = p.id
order by p.created_at desc
limit 20;

-- Si los datos se ven correctos: COMMIT
-- Si algo está mal:             ROLLBACK

commit;
-- rollback;
