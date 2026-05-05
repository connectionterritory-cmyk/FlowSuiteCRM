-- ============================================================
-- 0144: RPC fn_cerrar_cargo_vuelta_case
--
-- Objetivo:
--   Cierra un caso de cargo de vuelta de forma segura:
--     1. Actualiza cargo_vuelta_cases a estado='Cerrado'
--     2. Registra gestión en cob_gestiones (tipo='Cierre', resultado='pago_realizado')
--     3. Registra actividad en contacto_actividades para disparo del trigger
--        trg_sync_cliente_estado_operativo → clientes.estado_operativo='activo'
--
--   NO toca: cob_financial_ledger, saldos, cob_revolving_accounts.
--   Idempotente: si el caso ya está Cerrado, retorna sin duplicar gestión.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.fn_cerrar_cargo_vuelta_case(uuid, text);
--   -- Revertir caso manualmente:
--   UPDATE public.cargo_vuelta_cases SET estado='Abierto', fecha_cierre=NULL WHERE id='<uuid>';
--   DELETE FROM public.cob_gestiones WHERE tipo_gestion='Cierre' AND case_id='<uuid>';
--
-- Validación posterior:
--   SELECT estado, fecha_cierre, updated_at FROM public.cargo_vuelta_cases WHERE id='<uuid>';
--   SELECT tipo_gestion, resultado, notas FROM public.cob_gestiones WHERE case_id='<uuid>' AND tipo_gestion='Cierre';
-- ============================================================

create or replace function public.fn_cerrar_cargo_vuelta_case(
  p_case_id uuid,
  p_nota    text default null
)
returns table (
  case_id     uuid,
  cliente_id  uuid,
  estado      text,
  fecha_cierre timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id    uuid;
  v_caso      record;
begin
  -- ── 1. Validar sesión ────────────────────────────────────────
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select u.org_id into v_org_id
    from public.usuarios u
   where u.id = auth.uid()
   limit 1;

  if v_org_id is null then
    raise exception 'Organización no encontrada para el usuario';
  end if;

  -- ── 2. Cargar el caso con aislamiento de org ─────────────────
  select c.* into v_caso
    from public.cargo_vuelta_cases c
   where c.id = p_case_id
     and c.org_id = v_org_id;

  if not found then
    raise exception 'Caso no encontrado o no pertenece a su organización';
  end if;

  -- ── 3. Idempotencia: ya cerrado → retornar sin duplicar ──────
  if v_caso.estado = 'Cerrado' then
    return query select v_caso.id, v_caso.cliente_id, v_caso.estado, v_caso.fecha_cierre;
    return;
  end if;

  -- ── 4. Cerrar el caso ────────────────────────────────────────
  update public.cargo_vuelta_cases
     set estado       = 'Cerrado',
         fecha_cierre = now(),
         updated_by   = auth.uid(),
         updated_at   = now()
   where id = p_case_id;

  -- ── 5. Registrar gestión de cierre ───────────────────────────
  insert into public.cob_gestiones (
    org_id,
    cliente_id,
    case_id,
    tipo_gestion,
    resultado,
    notas,
    gestionado_por
  ) values (
    v_org_id,
    v_caso.cliente_id,
    p_case_id,
    'Cierre',
    'pago_realizado',
    coalesce(nullif(trim(p_nota), ''), 'Caso cerrado por pago recibido'),
    auth.uid()
  );

  -- ── 6. Registrar actividad para trigger estado_operativo ─────
  -- trg_sync_cliente_estado_operativo_from_contacto_actividades
  -- lee NEW.resultado='pago_realizado' → clientes.estado_operativo='activo'
  insert into public.contacto_actividades (
    contacto_tipo,
    contacto_id,
    tipo,
    resumen,
    contenido,
    resultado,
    autor_id
  ) values (
    'cliente',
    v_caso.cliente_id,
    'nota',
    'Caso de cargo de vuelta cerrado por pago recibido',
    coalesce(nullif(trim(p_nota), ''), 'Caso cerrado por pago recibido'),
    'pago_realizado',
    auth.uid()
  );

  -- ── 7. Retornar estado final ─────────────────────────────────
  return query
    select c.id, c.cliente_id, c.estado, c.fecha_cierre
      from public.cargo_vuelta_cases c
     where c.id = p_case_id;
end;
$$;

comment on function public.fn_cerrar_cargo_vuelta_case(uuid, text) is
  'Cierra un caso de cargo de vuelta: actualiza estado, registra gestión Cierre/pago_realizado, '
  'y dispara sync de clientes.estado_operativo. No toca ledger ni saldos. Idempotente.';
