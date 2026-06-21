-- ============================================================
-- 0166: fn_cv_resumen_generar
--
-- Objetivo:
--   Generar en draft un snapshot histórico mensual para Cargo de Vuelta
--   sin tocar DFP y sin mezclar ambas lógicas.
--
-- Reglas:
--   - usa cargo_vuelta_cases + cob_pagos + cob_cv_balance_adjustments
--   - evita duplicados por case_id + periodo_inicio + periodo_fin
--   - rechaza casos con cuenta revolving activa (híbrido / DFP)
--   - no envía, solo genera documento draft y sus líneas
-- ============================================================

begin;

drop function if exists public.fn_cv_resumen_generar(uuid, date, date, date, uuid);

create or replace function public.fn_cv_resumen_generar(
  p_case_id         uuid,
  p_periodo_inicio  date,
  p_periodo_fin     date,
  p_fecha_corte     date default null,
  p_generated_by    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case                        public.cargo_vuelta_cases%rowtype;
  v_caller_org                  uuid;
  v_caller_rol                  text;
  v_resumen_id                  uuid;
  v_fecha_corte                 date;
  v_monto_original              numeric(12,2);
  v_monto_source                text;
  v_requires_reconciliation     boolean := false;

  v_pagos_before                numeric(12,2) := 0;
  v_pagos_periodo               numeric(12,2) := 0;
  v_pagos_acumulados            numeric(12,2) := 0;
  v_fee_before                  numeric(12,2) := 0;
  v_fee_periodo                 numeric(12,2) := 0;
  v_fee_acumulado               numeric(12,2) := 0;

  v_creditos_before             numeric(12,2) := 0;
  v_creditos_periodo            numeric(12,2) := 0;
  v_creditos_acumulados         numeric(12,2) := 0;
  v_ajustes_before              numeric(12,2) := 0;
  v_ajustes_periodo             numeric(12,2) := 0;
  v_ajustes_acumulados          numeric(12,2) := 0;

  v_saldo_apertura              numeric(12,2) := 0;
  v_saldo_cierre                numeric(12,2) := 0;
  v_running_balance             numeric(12,2) := 0;
  v_line_number                 integer := 0;

  v_proximo_pago_esperado       numeric(12,2) := null;
  v_fecha_proximo_pago          date := null;
  v_fuente_proximo_pago         text := null;

  v_row                         record;
begin
  if p_case_id is null then
    raise exception 'CV_CASE_REQUIRED: p_case_id es obligatorio';
  end if;

  if p_periodo_inicio is null or p_periodo_fin is null then
    raise exception 'CV_PERIOD_REQUIRED: periodo_inicio y periodo_fin son obligatorios';
  end if;

  if p_periodo_fin < p_periodo_inicio then
    raise exception 'CV_INVALID_PERIOD: periodo_fin no puede ser menor a periodo_inicio';
  end if;

  -- CORRECCIÓN v2: fecha_corte = LEAST(periodo_fin, hoy)
  -- Así el snapshot nunca incluye pagos futuros si el período aún no termina.
  -- Si se pasa p_fecha_corte explícita (regeneración retroactiva) se respeta,
  -- pero debe estar dentro del período.
  v_fecha_corte := coalesce(p_fecha_corte, least(p_periodo_fin, current_date));

  if v_fecha_corte < p_periodo_inicio or v_fecha_corte > p_periodo_fin then
    raise exception 'CV_INVALID_CUTOFF: fecha_corte (%) debe estar entre periodo_inicio (%) y periodo_fin (%)',
      v_fecha_corte, p_periodo_inicio, p_periodo_fin;
  end if;

  select u.org_id into v_caller_org
  from public.usuarios u
  where u.id = coalesce(auth.uid(), p_generated_by)
  limit 1;

  if v_caller_org is null then
    raise exception 'CV_UNAUTHORIZED: usuario sin org_id';
  end if;

  -- CORRECCIÓN v2: guard de rol — solo admin/distribuidor/supervisor_telemercadeo
  select rol::text into v_caller_rol
  from public.usuarios
  where id = coalesce(auth.uid(), p_generated_by);

  if v_caller_rol is null or v_caller_rol not in ('admin', 'distribuidor', 'supervisor_telemercadeo') then
    raise exception 'CV_UNAUTHORIZED: el rol "%" no tiene permiso para generar resúmenes de cargo de vuelta',
      coalesce(v_caller_rol, 'no_identificado')
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_case_id::text));

  select *
    into v_case
  from public.cargo_vuelta_cases
  where id = p_case_id
    and org_id = v_caller_org
  for update;

  if not found then
    raise exception 'CV_CASE_NOT_FOUND: caso no existe o pertenece a otra organización';
  end if;

  if v_case.tipo_caso <> 'cargo_vuelta' then
    raise exception 'CV_INVALID_CASE_TYPE: este generador solo acepta casos cargo_vuelta';
  end if;

  if exists (
    select 1
    from public.cob_revolving_accounts ra
    where ra.case_id = v_case.id
      and ra.org_id = v_case.org_id
      and ra.estado in ('activo', 'moroso', 'en_plan', 'reestructurado')
  ) then
    raise exception 'CV_HYBRID_OR_DFP_CASE: el caso tiene cuenta revolving activa; no debe usar resumen de cargo de vuelta';
  end if;

  select r.id
    into v_resumen_id
  from public.cob_cv_resumenes r
  where r.case_id = p_case_id
    and r.periodo_inicio = p_periodo_inicio
    and r.periodo_fin = p_periodo_fin
  limit 1;

  if v_resumen_id is not null then
    return v_resumen_id;
  end if;

  if v_case.monto_devuelto is not null and v_case.monto_devuelto > 0 then
    v_monto_original := round(v_case.monto_devuelto, 2);
    v_monto_source := 'monto_devuelto';
  elsif v_case.monto_total is not null and v_case.monto_total > 0 then
    v_monto_original := round(v_case.monto_total, 2);
    v_monto_source := 'monto_total_legacy';
    v_requires_reconciliation := true;
  else
    raise exception 'CV_BASE_AMOUNT_MISSING: el caso no tiene monto_devuelto ni monto_total utilizables';
  end if;

  if v_case.requiere_reconciliacion then
    v_requires_reconciliation := true;
  end if;

  if v_case.monto_devuelto is not null
     and v_case.monto_total is not null
     and abs(v_case.monto_devuelto - v_case.monto_total) > 0.01 then
    v_requires_reconciliation := true;
  end if;

  -- CORRECCIÓN v2: columna cargo_vuelta_case_id (confirmada en prod; no 'case_id')
  -- CORRECCIÓN v2: pagos_before usa < periodo_inicio (sin cambio)
  select
    coalesce(sum(coalesce(p.monto_aplicado_balance, p.monto)), 0)::numeric(12,2),
    coalesce(sum(p.fee_plataforma), 0)::numeric(12,2)
    into v_pagos_before, v_fee_before
  from public.cob_pagos p
  where p.cargo_vuelta_case_id = p_case_id
    and coalesce(p.estado, 'registrado') not in ('anulado', 'rechazado')
    and p.fecha_pago < p_periodo_inicio;

  -- CORRECCIÓN v2: pagos_periodo usa <= v_fecha_corte (no p_periodo_fin)
  -- Evita contar pagos futuros cuando el período aún no ha terminado.
  select
    coalesce(sum(coalesce(p.monto_aplicado_balance, p.monto)), 0)::numeric(12,2),
    coalesce(sum(p.fee_plataforma), 0)::numeric(12,2)
    into v_pagos_periodo, v_fee_periodo
  from public.cob_pagos p
  where p.cargo_vuelta_case_id = p_case_id
    and coalesce(p.estado, 'registrado') not in ('anulado', 'rechazado')
    and p.fecha_pago >= p_periodo_inicio
    and p.fecha_pago <= v_fecha_corte;

  v_pagos_acumulados := round(v_pagos_before + v_pagos_periodo, 2);
  v_fee_acumulado := round(v_fee_before + v_fee_periodo, 2);

  select
    coalesce(sum(case when a.clase = 'credito' then a.monto_aplicado_balance else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when a.clase = 'ajuste' then a.monto_aplicado_balance else 0 end), 0)::numeric(12,2)
    into v_creditos_before, v_ajustes_before
  from public.cob_cv_balance_adjustments a
  where a.case_id = p_case_id
    and a.status = 'activo'
    and a.fecha_ajuste < p_periodo_inicio;

  select
    coalesce(sum(case when a.clase = 'credito' then a.monto_aplicado_balance else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when a.clase = 'ajuste' then a.monto_aplicado_balance else 0 end), 0)::numeric(12,2)
    into v_creditos_periodo, v_ajustes_periodo
  from public.cob_cv_balance_adjustments a
  where a.case_id = p_case_id
    and a.status = 'activo'
    and a.fecha_ajuste >= p_periodo_inicio
    and a.fecha_ajuste <= p_periodo_fin;

  v_creditos_acumulados := round(v_creditos_before + v_creditos_periodo, 2);
  v_ajustes_acumulados := round(v_ajustes_before + v_ajustes_periodo, 2);

  v_saldo_apertura := greatest(
    round(v_monto_original - v_pagos_before - v_creditos_before - v_ajustes_before, 2),
    0
  );

  v_saldo_cierre := greatest(
    round(v_monto_original - v_pagos_acumulados - v_creditos_acumulados - v_ajustes_acumulados, 2),
    0
  );

  -- CORRECCIÓN v2: resolver fecha_proximo_pago en orden de prioridad:
  --   (1) próxima cuota pendiente en cob_plan_cuotas (plan activo/vigente)
  --   (2) cob_acuerdos_pago_automatico.fecha_proximo_cobro (fallback)
  --   (3) NULL si no hay plan ni acuerdo formal
  --
  -- Fuente 1: cob_plan_cuotas — próxima cuota no pagada ni cancelada
  select
    pp.monto_cuota,
    min(pc.fecha_vencimiento)
  into
    v_proximo_pago_esperado,
    v_fecha_proximo_pago
  from public.cob_plan_pagos pp
  join public.cob_plan_cuotas pc on pc.plan_pago_id = pp.id
  where pp.cargo_vuelta_case_id = p_case_id
    and pp.estado in ('activo', 'vigente')
    and pc.estado not in ('pagado', 'cancelado')
    and pc.fecha_vencimiento >= current_date
  group by pp.monto_cuota
  order by min(pc.fecha_vencimiento) asc
  limit 1;

  if v_fecha_proximo_pago is not null then
    v_fuente_proximo_pago := 'cob_plan_cuotas';
  else
    -- Fuente 2: cob_acuerdos_pago_automatico (fallback)
    select
      a.monto_total_cobro,
      a.fecha_proximo_cobro
    into
      v_proximo_pago_esperado,
      v_fecha_proximo_pago
    from public.cob_acuerdos_pago_automatico a
    where a.cargo_vuelta_case_id = p_case_id
      and a.estado = 'activo'
    order by a.created_at desc
    limit 1;

    if v_fecha_proximo_pago is not null then
      v_fuente_proximo_pago := 'cob_acuerdos_pago_automatico';
    end if;
    -- Si sigue null → sin fuente formal, se inserta NULL (correcto)
  end if;

  insert into public.cob_cv_resumenes (
    org_id,
    case_id,
    cliente_id,
    periodo_inicio,
    periodo_fin,
    fecha_corte,
    monto_devuelto_snapshot,
    monto_total_legacy_snapshot,
    monto_original,
    monto_base_source,
    requiere_reconciliacion_snapshot,
    saldo_apertura_periodo,
    pagos_periodo,
    pagos_acumulados,
    fee_plataforma_periodo,
    fee_plataforma_acumulado,
    monto_total_cobrado_periodo,
    monto_total_cobrado_acumulado,
    creditos_periodo,
    creditos_acumulados,
    ajustes_periodo,
    ajustes_acumulados,
    saldo_pendiente_corte,
    proximo_pago_esperado,
    fecha_proximo_pago,
    fuente_proximo_pago,
    status,
    generated_by
  ) values (
    v_case.org_id,
    v_case.id,
    v_case.cliente_id,
    p_periodo_inicio,
    p_periodo_fin,
    v_fecha_corte,
    v_case.monto_devuelto,
    v_case.monto_total,
    v_monto_original,
    v_monto_source,
    v_requires_reconciliation,
    v_saldo_apertura,
    v_pagos_periodo,
    v_pagos_acumulados,
    v_fee_periodo,
    v_fee_acumulado,
    round(v_pagos_periodo + v_fee_periodo, 2),
    round(v_pagos_acumulados + v_fee_acumulado, 2),
    v_creditos_periodo,
    v_creditos_acumulados,
    v_ajustes_periodo,
    v_ajustes_acumulados,
    v_saldo_cierre,
    v_proximo_pago_esperado,
    v_fecha_proximo_pago,
    v_fuente_proximo_pago,
    'draft',
    coalesce(p_generated_by, auth.uid())
  )
  returning id into v_resumen_id;

  v_running_balance := v_saldo_apertura;
  v_line_number := v_line_number + 1;

  insert into public.cob_cv_resumen_lines (
    org_id,
    resumen_id,
    case_id,
    cliente_id,
    line_number,
    line_type,
    event_date,
    description,
    running_balance_after,
    metadata
  ) values (
    v_case.org_id,
    v_resumen_id,
    v_case.id,
    v_case.cliente_id,
    v_line_number,
    'saldo_apertura',
    p_periodo_inicio,
    'Saldo de apertura del período',
    v_running_balance,
    jsonb_build_object(
      'monto_original', v_monto_original,
      'monto_base_source', v_monto_source,
      'pagos_antes_periodo', v_pagos_before,
      'creditos_antes_periodo', v_creditos_before,
      'ajustes_antes_periodo', v_ajustes_before
    )
  );

  for v_row in
    (
      select
        p.fecha_pago as event_date,
        'pago'::text as line_type,
        'cob_pagos'::text as source_table,
        p.id as source_id,
        'Pago recibido'::text as description,
        coalesce(p.monto_aplicado_balance, p.monto)::numeric(12,2) as monto_aplicado_balance,
        coalesce(p.fee_plataforma, 0)::numeric(12,2) as fee_plataforma
      from public.cob_pagos p
      where p.cargo_vuelta_case_id = p_case_id
        and coalesce(p.estado, 'registrado') not in ('anulado', 'rechazado')
        and p.fecha_pago >= p_periodo_inicio
        and p.fecha_pago <= v_fecha_corte

      union all

      select
        a.fecha_ajuste as event_date,
        case when a.clase = 'credito' then 'credito' else 'ajuste' end as line_type,
        'cob_cv_balance_adjustments'::text as source_table,
        a.id as source_id,
        coalesce(a.descripcion, initcap(a.clase) || ' aplicado al balance') as description,
        a.monto_aplicado_balance::numeric(12,2) as monto_aplicado_balance,
        0::numeric(12,2) as fee_plataforma
      from public.cob_cv_balance_adjustments a
      where a.case_id = p_case_id
        and a.status = 'activo'
        and a.fecha_ajuste >= p_periodo_inicio
        and a.fecha_ajuste <= p_periodo_fin
    )
    order by event_date, source_table, source_id
  loop
    if v_row.line_type in ('pago', 'credito', 'ajuste') then
      v_running_balance := greatest(round(v_running_balance - v_row.monto_aplicado_balance, 2), 0);
    end if;

    v_line_number := v_line_number + 1;

    insert into public.cob_cv_resumen_lines (
      org_id,
      resumen_id,
      case_id,
      cliente_id,
      line_number,
      line_type,
      source_table,
      source_id,
      event_date,
      description,
      monto_aplicado_balance,
      fee_plataforma,
      monto_total_cobrado_cliente,
      running_balance_after,
      metadata
    ) values (
      v_case.org_id,
      v_resumen_id,
      v_case.id,
      v_case.cliente_id,
      v_line_number,
      v_row.line_type,
      v_row.source_table,
      v_row.source_id,
      v_row.event_date,
      v_row.description,
      v_row.monto_aplicado_balance,
      v_row.fee_plataforma,
      round(v_row.monto_aplicado_balance + v_row.fee_plataforma, 2),
      v_running_balance,
      jsonb_build_object('generated_by', coalesce(p_generated_by, auth.uid()))
    );
  end loop;

  v_line_number := v_line_number + 1;
  insert into public.cob_cv_resumen_lines (
    org_id,
    resumen_id,
    case_id,
    cliente_id,
    line_number,
    line_type,
    event_date,
    description,
    running_balance_after,
    metadata
  ) values (
    v_case.org_id,
    v_resumen_id,
    v_case.id,
    v_case.cliente_id,
    v_line_number,
    'saldo_cierre',
    v_fecha_corte,
    'Saldo pendiente al corte',
    v_saldo_cierre,
    jsonb_build_object(
      'pagos_acumulados', v_pagos_acumulados,
      'creditos_acumulados', v_creditos_acumulados,
      'ajustes_acumulados', v_ajustes_acumulados
    )
  );

  if v_proximo_pago_esperado is not null or v_fecha_proximo_pago is not null then
    v_line_number := v_line_number + 1;
    insert into public.cob_cv_resumen_lines (
      org_id,
      resumen_id,
      case_id,
      cliente_id,
      line_number,
      line_type,
      event_date,
      description,
      monto_aplicado_balance,
      running_balance_after,
      metadata
    ) values (
      v_case.org_id,
      v_resumen_id,
      v_case.id,
      v_case.cliente_id,
      v_line_number,
      'proximo_pago',
      v_fecha_proximo_pago,
      'Próximo pago esperado',
      coalesce(v_proximo_pago_esperado, 0),
      v_saldo_cierre,
      jsonb_build_object('fuente_proximo_pago', v_fuente_proximo_pago)
    );
  end if;

  return v_resumen_id;
end;
$$;

revoke all on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid) from public, anon;
grant execute on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid) to authenticated;

comment on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid) is
  'v2: guard rol (admin/distribuidor/supervisor_telemercadeo). '
  'fecha_corte = LEAST(periodo_fin, hoy). '
  'Filtra cob_pagos por cargo_vuelta_case_id (no case_id). '
  'proximo_pago: (1) cob_plan_cuotas, (2) cob_acuerdos_pago_automatico, (3) NULL. '
  'Genera snapshot draft; rechaza casos con revolving activo.';

commit;
