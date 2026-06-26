begin;

-- ============================================================
-- 0173: Phase 1 canonical payments + PTPs for cartera
--
-- Objetivo:
--   - Unificar el registro operativo de pagos en backend canónico.
--   - Asegurar que DFP no quede solo en ledger financiero.
--   - Asegurar que el modal rápido de PTP siempre cree gestión + PTP.
--
-- Alcance:
--   1. fn_cob_registrar_pago_case:
--      Pago atómico para casos de cartera/cargo de vuelta.
--      Inserta cob_pagos, cierra PTP opcional, marca cuotas, completa planes
--      cuando corresponda, y registra gestión + actividad timeline.
--   2. fn_cob_registrar_pago_revolving_operativo:
--      Envuelve el waterfall DFP existente y además registra el pago en
--      cob_pagos + cob_gestiones + contacto_actividades.
--   3. fn_cob_registrar_ptp_operativo:
--      Crea primero la gestión y luego el PTP formal vinculado a esa gestión.
--
-- Notas:
--   - No toca datos históricos.
--   - No modifica lógica financiera de statements.
--   - No desactiva superficies legacy; eso queda para fase separada.
-- ============================================================

create or replace function public.fn_cob_insert_contacto_actividad(
  p_org_id uuid,
  p_contacto_tipo text,
  p_contacto_id uuid,
  p_tipo text,
  p_resumen text,
  p_contenido text,
  p_metadata jsonb,
  p_autor_id uuid,
  p_fecha_actividad timestamptz,
  p_resultado text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_org_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contacto_actividades'
      and column_name = 'org_id'
  )
  into v_has_org_id;

  if v_has_org_id then
    insert into public.contacto_actividades (
      org_id,
      contacto_tipo,
      contacto_id,
      tipo,
      resumen,
      contenido,
      metadata,
      autor_id,
      fecha_actividad,
      resultado
    ) values (
      p_org_id,
      p_contacto_tipo,
      p_contacto_id,
      p_tipo,
      p_resumen,
      p_contenido,
      coalesce(p_metadata, '{}'::jsonb),
      p_autor_id,
      p_fecha_actividad,
      p_resultado
    );
  else
    insert into public.contacto_actividades (
      contacto_tipo,
      contacto_id,
      tipo,
      resumen,
      contenido,
      metadata,
      autor_id,
      fecha_actividad,
      resultado
    ) values (
      p_contacto_tipo,
      p_contacto_id,
      p_tipo,
      p_resumen,
      p_contenido,
      coalesce(p_metadata, '{}'::jsonb),
      p_autor_id,
      p_fecha_actividad,
      p_resultado
    );
  end if;
end;
$$;

drop function if exists public.fn_cob_registrar_pago_case(
  uuid,
  numeric,
  date,
  text,
  text,
  text,
  text,
  uuid,
  uuid[]
);

create or replace function public.fn_cob_registrar_pago_case(
  p_case_id uuid,
  p_monto numeric,
  p_fecha_pago date default current_date,
  p_metodo_pago text default 'otro',
  p_referencia_externa text default null,
  p_comprobante_url text default null,
  p_notas text default null,
  p_ptp_id uuid default null,
  p_cuota_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_case public.cargo_vuelta_cases%rowtype;
  v_pago_id uuid;
  v_gestion_id uuid;
  v_cuota_count integer := 0;
  v_updated_cuotas integer := 0;
  v_plan_ids uuid[] := '{}';
  v_planes_completados integer := 0;
  v_cuotas_total numeric(12,2) := 0;
  v_metodo_pago text := coalesce(nullif(trim(p_metodo_pago), ''), 'otro');
  v_notas_pago text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select u.org_id
    into v_org_id
  from public.usuarios u
  where u.id = v_user_id
  limit 1;

  if v_org_id is null then
    raise exception 'Usuario sin org_id en public.usuarios';
  end if;

  if not (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or security.current_user_role() = 'telemercadeo'
  ) then
    raise exception 'Usuario sin permisos para registrar pagos';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0';
  end if;

  if p_fecha_pago is null then
    raise exception 'La fecha de pago es obligatoria';
  end if;

  if v_metodo_pago not in ('cash', 'check', 'zelle', 'ach', 'card', 'hycite', 'wire', 'otro') then
    raise exception 'Metodo de pago invalido';
  end if;

  select *
    into v_case
  from public.cargo_vuelta_cases cv
  where cv.id = p_case_id
    and cv.org_id = v_org_id
  for update;

  if not found then
    raise exception 'Caso no encontrado o fuera de su organizacion';
  end if;

  if p_ptp_id is not null and not exists (
    select 1
    from public.cob_ptps ptp
    where ptp.id = p_ptp_id
      and ptp.org_id = v_org_id
      and ptp.cliente_id = v_case.cliente_id
      and ptp.case_id = v_case.id
      and ptp.estado in ('pendiente', 'vencido')
  ) then
    raise exception 'PTP invalido para el pago actual';
  end if;

  if p_cuota_ids is not null then
    select coalesce(array_length(p_cuota_ids, 1), 0)
      into v_cuota_count;

    if v_cuota_count > 0 then
      if exists (
        select 1
        from public.cob_plan_cuotas cpc
        join public.cob_plan_pagos cpp
          on cpp.id = coalesce(cpc.plan_pago_id, cpc.plan_id)
        where cpc.id = any(p_cuota_ids)
          and (
            cpc.org_id <> v_org_id
            or cpp.cliente_id <> v_case.cliente_id
            or coalesce(cpc.cargo_vuelta_case_id, cpp.cargo_vuelta_case_id, cpp.case_id) is distinct from v_case.id
            or cpc.estado not in ('pendiente', 'vencida', 'programada')
            or coalesce(cpc.cob_pago_id, cpc.pago_id) is not null
          )
      ) then
        raise exception 'Una o mas cuotas no son validas para este pago';
      end if;

      if (
        select count(*)
        from public.cob_plan_cuotas cpc
        where cpc.id = any(p_cuota_ids)
      ) <> v_cuota_count then
        raise exception 'Una o mas cuotas seleccionadas no existen';
      end if;

      select
        coalesce(sum(coalesce(cpc.saldo_cuota, cpc.monto_programado, cpc.monto, 0)), 0),
        coalesce(array_agg(distinct coalesce(cpc.plan_pago_id, cpc.plan_id)), '{}')
      into v_cuotas_total, v_plan_ids
      from public.cob_plan_cuotas cpc
      where cpc.id = any(p_cuota_ids);

      if p_monto < v_cuotas_total then
        raise exception 'El monto es menor al saldo de las cuotas seleccionadas';
      end if;
    end if;
  end if;

  v_notas_pago := nullif(trim(concat_ws(' | ',
    nullif(trim(p_notas), ''),
    case
      when nullif(trim(p_referencia_externa), '') is not null
        then 'Ref: ' || trim(p_referencia_externa)
      else null
    end
  )), '');

  insert into public.cob_pagos (
    org_id,
    cliente_id,
    cargo_vuelta_case_id,
    ptp_id,
    monto,
    moneda,
    fecha_pago,
    metodo_pago,
    referencia_externa,
    comprobante_url,
    notas,
    estado,
    source,
    created_by
  ) values (
    v_org_id,
    v_case.cliente_id,
    v_case.id,
    p_ptp_id,
    round(p_monto, 2),
    'USD',
    p_fecha_pago,
    v_metodo_pago,
    nullif(trim(p_referencia_externa), ''),
    nullif(trim(p_comprobante_url), ''),
    v_notas_pago,
    'registrado',
    'manual',
    v_user_id
  )
  returning id into v_pago_id;

  if p_ptp_id is not null then
    update public.cob_ptps
    set
      estado = 'cumplido',
      fecha_cumplimiento = p_fecha_pago,
      cumplido_at = coalesce(cumplido_at, now()),
      updated_by = v_user_id,
      updated_at = now()
    where id = p_ptp_id;
  end if;

  if v_cuota_count > 0 then
    update public.cob_plan_cuotas
    set
      cob_pago_id = v_pago_id,
      pago_id = v_pago_id,
      estado = 'pagada',
      fecha_pago = p_fecha_pago,
      paid_at = coalesce(paid_at, now()),
      monto_pagado = coalesce(saldo_cuota, monto_programado, monto, 0),
      saldo_cuota = 0,
      updated_at = now()
    where id = any(p_cuota_ids);

    get diagnostics v_updated_cuotas = row_count;

    if v_updated_cuotas <> v_cuota_count then
      raise exception 'No se pudieron actualizar todas las cuotas seleccionadas';
    end if;

    if coalesce(array_length(v_plan_ids, 1), 0) > 0 then
      update public.cob_plan_pagos cpp
      set
        estado = 'cumplido',
        updated_by = v_user_id,
        updated_at = now()
      where cpp.id = any(v_plan_ids)
        and cpp.estado <> 'cumplido'
        and not exists (
          select 1
          from public.cob_plan_cuotas cpc
          where coalesce(cpc.plan_pago_id, cpc.plan_id) = cpp.id
            and cpc.estado not in ('pagada', 'cancelada')
        );

      get diagnostics v_planes_completados = row_count;
    end if;
  end if;

  insert into public.cob_gestiones (
    org_id,
    cliente_id,
    case_id,
    tipo_gestion,
    resultado,
    monto_comprometido,
    notas,
    gestionado_por,
    ptp_id
  ) values (
    v_org_id,
    v_case.cliente_id,
    v_case.id,
    'Pago',
    'pago_realizado',
    round(p_monto, 2),
    v_notas_pago,
    v_user_id,
    p_ptp_id
  )
  returning id into v_gestion_id;

  perform public.fn_cob_insert_contacto_actividad(
    v_org_id,
    'cliente',
    v_case.cliente_id,
    'nota',
    'Pago registrado en cartera',
    v_notas_pago,
    jsonb_build_object(
      'source', 'fn_cob_registrar_pago_case',
      'case_id', v_case.id,
      'pago_id', v_pago_id,
      'gestion_id', v_gestion_id,
      'ptp_id', p_ptp_id,
      'cuota_ids', coalesce(to_jsonb(p_cuota_ids), '[]'::jsonb),
      'monto', round(p_monto, 2),
      'metodo_pago', v_metodo_pago
    ),
    v_user_id,
    (p_fecha_pago::timestamp at time zone 'UTC'),
    'pago_realizado'
  );

  return jsonb_build_object(
    'ok', true,
    'case_id', v_case.id,
    'cliente_id', v_case.cliente_id,
    'pago_id', v_pago_id,
    'gestion_id', v_gestion_id,
    'ptp_closed', p_ptp_id is not null,
    'cuotas_updated', v_updated_cuotas,
    'planes_completed', v_planes_completados
  );
end;
$$;

drop function if exists public.fn_cob_registrar_pago_revolving_operativo(
  uuid,
  numeric,
  date,
  text,
  text,
  text,
  text,
  uuid
);

create or replace function public.fn_cob_registrar_pago_revolving_operativo(
  p_account_id uuid,
  p_monto numeric,
  p_fecha date default current_date,
  p_metodo_pago text default 'otro',
  p_referencia_externa text default null,
  p_comprobante_url text default null,
  p_notas text default null,
  p_ptp_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_account public.cob_revolving_accounts%rowtype;
  v_result jsonb;
  v_aplicado_total numeric(12,2);
  v_excedente numeric(12,2);
  v_pago_id uuid;
  v_gestion_id uuid;
  v_metodo_pago text := coalesce(nullif(trim(p_metodo_pago), ''), 'otro');
  v_notas_pago text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select u.org_id
    into v_org_id
  from public.usuarios u
  where u.id = v_user_id
  limit 1;

  if v_org_id is null then
    raise exception 'Usuario sin org_id en public.usuarios';
  end if;

  if v_metodo_pago not in ('cash', 'check', 'zelle', 'ach', 'card', 'hycite', 'wire', 'otro') then
    raise exception 'Metodo de pago invalido';
  end if;

  select *
    into v_account
  from public.cob_revolving_accounts cra
  where cra.id = p_account_id
    and cra.org_id = v_org_id;

  if not found then
    raise exception 'Cuenta revolving no encontrada o fuera de su organizacion';
  end if;

  if p_ptp_id is not null and not exists (
    select 1
    from public.cob_ptps ptp
    where ptp.id = p_ptp_id
      and ptp.org_id = v_org_id
      and ptp.cliente_id = v_account.cliente_id
      and ptp.case_id = v_account.case_id
      and ptp.estado in ('pendiente', 'vencido')
  ) then
    raise exception 'PTP invalido para el pago actual';
  end if;

  v_result := public.fn_registrar_pago_revolving(
    p_account_id,
    p_monto,
    p_fecha,
    p_referencia_externa,
    p_notas
  );

  v_aplicado_total := round(
    coalesce((v_result->>'aplicado_fees')::numeric, 0)
    + coalesce((v_result->>'aplicado_interes')::numeric, 0)
    + coalesce((v_result->>'aplicado_principal')::numeric, 0),
    2
  );
  v_excedente := round(coalesce((v_result->>'excedente')::numeric, 0), 2);

  v_notas_pago := nullif(trim(concat_ws(' | ',
    nullif(trim(p_notas), ''),
    case
      when v_excedente > 0 then 'Excedente no aplicado: $' || to_char(v_excedente, 'FM999999990.00')
      else null
    end,
    case
      when nullif(trim(p_referencia_externa), '') is not null
        then 'Ref: ' || trim(p_referencia_externa)
      else null
    end
  )), '');

  insert into public.cob_pagos (
    org_id,
    cliente_id,
    cargo_vuelta_case_id,
    revolving_account_id,
    ptp_id,
    monto,
    moneda,
    fecha_pago,
    metodo_pago,
    referencia_externa,
    comprobante_url,
    notas,
    estado,
    source,
    created_by
  ) values (
    v_org_id,
    v_account.cliente_id,
    v_account.case_id,
    v_account.id,
    p_ptp_id,
    v_aplicado_total,
    'USD',
    p_fecha,
    v_metodo_pago,
    nullif(trim(p_referencia_externa), ''),
    nullif(trim(p_comprobante_url), ''),
    v_notas_pago,
    'registrado',
    'manual',
    v_user_id
  )
  returning id into v_pago_id;

  if p_ptp_id is not null then
    update public.cob_ptps
    set
      estado = 'cumplido',
      fecha_cumplimiento = p_fecha,
      cumplido_at = coalesce(cumplido_at, now()),
      updated_by = v_user_id,
      updated_at = now()
    where id = p_ptp_id;
  end if;

  insert into public.cob_gestiones (
    org_id,
    cliente_id,
    case_id,
    tipo_gestion,
    resultado,
    monto_comprometido,
    notas,
    gestionado_por,
    ptp_id
  ) values (
    v_org_id,
    v_account.cliente_id,
    v_account.case_id,
    'Pago DFP',
    'pago_realizado',
    v_aplicado_total,
    v_notas_pago,
    v_user_id,
    p_ptp_id
  )
  returning id into v_gestion_id;

  perform public.fn_cob_insert_contacto_actividad(
    v_org_id,
    'cliente',
    v_account.cliente_id,
    'nota',
    'Pago DFP registrado',
    v_notas_pago,
    jsonb_build_object(
      'source', 'fn_cob_registrar_pago_revolving_operativo',
      'case_id', v_account.case_id,
      'revolving_account_id', v_account.id,
      'pago_id', v_pago_id,
      'gestion_id', v_gestion_id,
      'ptp_id', p_ptp_id,
      'monto_recibido', round(p_monto, 2),
      'monto_aplicado', v_aplicado_total,
      'excedente', v_excedente,
      'metodo_pago', v_metodo_pago
    ),
    v_user_id,
    (p_fecha::timestamp at time zone 'UTC'),
    'pago_realizado'
  );

  return v_result
    || jsonb_build_object(
      'ok', true,
      'pago_id', v_pago_id,
      'gestion_id', v_gestion_id,
      'case_id', v_account.case_id,
      'cliente_id', v_account.cliente_id,
      'ptp_closed', p_ptp_id is not null
    );
end;
$$;

drop function if exists public.fn_cob_registrar_ptp_operativo(
  uuid,
  numeric,
  date,
  text,
  text,
  text
);

create or replace function public.fn_cob_registrar_ptp_operativo(
  p_case_id uuid,
  p_monto numeric,
  p_fecha_compromiso date,
  p_canal text default 'telefono',
  p_notas text default null,
  p_tipo_gestion text default 'PTP'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_case public.cargo_vuelta_cases%rowtype;
  v_gestion_id uuid;
  v_ptp_id uuid;
  v_canal text := coalesce(nullif(trim(p_canal), ''), 'telefono');
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select u.org_id
    into v_org_id
  from public.usuarios u
  where u.id = v_user_id
  limit 1;

  if v_org_id is null then
    raise exception 'Usuario sin org_id en public.usuarios';
  end if;

  if not (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or security.current_user_role() = 'telemercadeo'
  ) then
    raise exception 'Usuario sin permisos para registrar PTPs';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0';
  end if;

  if p_fecha_compromiso is null then
    raise exception 'La fecha compromiso es obligatoria';
  end if;

  if v_canal not in ('telefono', 'whatsapp', 'email', 'sms', 'presencial', 'otro') then
    raise exception 'Canal invalido';
  end if;

  select *
    into v_case
  from public.cargo_vuelta_cases cv
  where cv.id = p_case_id
    and cv.org_id = v_org_id;

  if not found then
    raise exception 'Caso no encontrado o fuera de su organizacion';
  end if;

  insert into public.cob_gestiones (
    org_id,
    cliente_id,
    case_id,
    tipo_gestion,
    resultado,
    monto_comprometido,
    fecha_compromiso,
    notas,
    gestionado_por
  ) values (
    v_org_id,
    v_case.cliente_id,
    v_case.id,
    coalesce(nullif(trim(p_tipo_gestion), ''), 'PTP'),
    'promesa_pago',
    round(p_monto, 2),
    p_fecha_compromiso,
    nullif(trim(p_notas), ''),
    v_user_id
  )
  returning id into v_gestion_id;

  insert into public.cob_ptps (
    org_id,
    cliente_id,
    case_id,
    gestion_id,
    monto,
    fecha_compromiso,
    estado,
    canal,
    notas,
    creado_por
  ) values (
    v_org_id,
    v_case.cliente_id,
    v_case.id,
    v_gestion_id,
    round(p_monto, 2),
    p_fecha_compromiso,
    'pendiente',
    v_canal,
    nullif(trim(p_notas), ''),
    v_user_id
  )
  returning id into v_ptp_id;

  update public.cob_gestiones
  set ptp_id = v_ptp_id
  where id = v_gestion_id;

  perform public.fn_cob_insert_contacto_actividad(
    v_org_id,
    'cliente',
    v_case.cliente_id,
    'nota',
    'Promesa de pago registrada',
    nullif(trim(p_notas), ''),
    jsonb_build_object(
      'source', 'fn_cob_registrar_ptp_operativo',
      'case_id', v_case.id,
      'gestion_id', v_gestion_id,
      'ptp_id', v_ptp_id,
      'monto', round(p_monto, 2),
      'fecha_compromiso', p_fecha_compromiso,
      'canal', v_canal
    ),
    v_user_id,
    now(),
    'promesa_pago'
  );

  return jsonb_build_object(
    'ok', true,
    'case_id', v_case.id,
    'cliente_id', v_case.cliente_id,
    'gestion_id', v_gestion_id,
    'ptp_id', v_ptp_id
  );
end;
$$;

revoke all on function public.fn_cob_registrar_pago_case(
  uuid,
  numeric,
  date,
  text,
  text,
  text,
  text,
  uuid,
  uuid[]
) from public, anon;
grant execute on function public.fn_cob_registrar_pago_case(
  uuid,
  numeric,
  date,
  text,
  text,
  text,
  text,
  uuid,
  uuid[]
) to authenticated;

revoke all on function public.fn_cob_insert_contacto_actividad(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  jsonb,
  uuid,
  timestamptz,
  text
) from public, anon;
grant execute on function public.fn_cob_insert_contacto_actividad(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  jsonb,
  uuid,
  timestamptz,
  text
) to authenticated;

revoke all on function public.fn_cob_registrar_pago_revolving_operativo(
  uuid,
  numeric,
  date,
  text,
  text,
  text,
  text,
  uuid
) from public, anon;
grant execute on function public.fn_cob_registrar_pago_revolving_operativo(
  uuid,
  numeric,
  date,
  text,
  text,
  text,
  text,
  uuid
) to authenticated;

revoke all on function public.fn_cob_registrar_ptp_operativo(
  uuid,
  numeric,
  date,
  text,
  text,
  text
) from public, anon;
grant execute on function public.fn_cob_registrar_ptp_operativo(
  uuid,
  numeric,
  date,
  text,
  text,
  text
) to authenticated;

comment on function public.fn_cob_registrar_pago_case(uuid, numeric, date, text, text, text, text, uuid, uuid[]) is
  'Registra un pago operativo para un caso de cartera/cargo de vuelta en una sola transaccion: cob_pagos, cierre opcional de PTP, cuotas/planes y bitacora operativa.';

comment on function public.fn_cob_insert_contacto_actividad(uuid, text, uuid, text, text, text, jsonb, uuid, timestamptz, text) is
  'Inserta una actividad visible en timeline con compatibilidad para bases donde contacto_actividades todavia no tiene org_id.';

comment on function public.fn_cob_registrar_pago_revolving_operativo(uuid, numeric, date, text, text, text, text, uuid) is
  'Registra un pago DFP usando el waterfall financiero existente y ademas lo publica en la bitacora operativa del caso: cob_pagos, cob_gestiones y contacto_actividades.';

comment on function public.fn_cob_registrar_ptp_operativo(uuid, numeric, date, text, text, text) is
  'Crea una promesa de pago canonica obligatoriamente ligada a una gestion de cobranza y registra la actividad visible en timeline.';

commit;

notify pgrst, 'reload schema';
