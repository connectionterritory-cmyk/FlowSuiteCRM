


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "security";


ALTER SCHEMA "security" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."cliente_estado" AS ENUM (
    'actual',
    'cancelacion_total',
    'cargo_de_vuelta',
    'inactivo'
);


ALTER TYPE "public"."cliente_estado" OWNER TO "postgres";


CREATE TYPE "public"."cliente_estado_morosidad" AS ENUM (
    '0-30',
    '31-60',
    '61-90',
    '91+'
);


ALTER TYPE "public"."cliente_estado_morosidad" OWNER TO "postgres";


CREATE TYPE "public"."cliente_origen" AS ENUM (
    'hycite_import',
    'manual',
    'lead_convertido',
    'referido'
);


ALTER TYPE "public"."cliente_origen" OWNER TO "postgres";


CREATE TYPE "public"."embajador_nivel" AS ENUM (
    'silver',
    'gold'
);


ALTER TYPE "public"."embajador_nivel" OWNER TO "postgres";


CREATE TYPE "public"."lead_estado_pipeline" AS ENUM (
    'nuevo',
    'contactado',
    'calificado',
    'descartado',
    'cita',
    'demo',
    'cierre'
);


ALTER TYPE "public"."lead_estado_pipeline" OWNER TO "postgres";


CREATE TYPE "public"."oportunidad_etapa" AS ENUM (
    'nuevo',
    'contactado',
    'calificado',
    'propuesta',
    'negociacion',
    'cerrado_ganado',
    'cerrado_perdido',
    'cerrado'
);


ALTER TYPE "public"."oportunidad_etapa" OWNER TO "postgres";


CREATE TYPE "public"."programa_4en14_estado" AS ENUM (
    'activo',
    'completado',
    'vencido'
);


ALTER TYPE "public"."programa_4en14_estado" OWNER TO "postgres";


CREATE TYPE "public"."programa_4en14_referido_estado" AS ENUM (
    'pendiente',
    'agendada',
    'show',
    'demo_calificada',
    'venta',
    'no_interes'
);


ALTER TYPE "public"."programa_4en14_referido_estado" OWNER TO "postgres";


CREATE TYPE "public"."usuario_rol" AS ENUM (
    'admin',
    'distribuidor',
    'vendedor',
    'telemercadeo',
    'embajador',
    'supervisor_telemercadeo'
);


ALTER TYPE "public"."usuario_rol" OWNER TO "postgres";


CREATE TYPE "public"."venta_tipo_movimiento" AS ENUM (
    'venta_inicial',
    'agregado'
);


ALTER TYPE "public"."venta_tipo_movimiento" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ci_create_leads_for_activation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  _owner_id uuid;
begin
  if new.whatsapp_mensaje_enviado_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.whatsapp_mensaje_enviado_at is not null then
    return new;
  end if;
  _owner_id := new.representante_id;
  with referidos as (
    select id, nombre, telefono
    from public.ci_referidos
    where activacion_id = new.id
      and telefono is not null
      and telefono <> ''
  ),
  inserted as (
    insert into public.leads (
      nombre,
      telefono,
      fuente,
      estado_pipeline,
      owner_id,
      referido_por_cliente_id
    )
    select
      r.nombre,
      r.telefono,
      'conexiones_infinitas',
      'nuevo',
      _owner_id,
      new.cliente_id
    from referidos r
    on conflict (telefono)
      where telefono is not null and telefono <> ''
    do nothing
    returning id, telefono
  ),
  existing as (
    select l.id, l.telefono
    from public.leads l
    join referidos r on r.telefono = l.telefono
  ),
  lead_map as (
    select * from inserted
    union
    select * from existing
  )
  update public.ci_referidos r
  set lead_id = lead_map.id
  from lead_map
  where r.activacion_id = new.id
    and r.telefono = lead_map.telefono
    and r.lead_id is null;
  return new;
end;
$$;


ALTER FUNCTION "public"."ci_create_leads_for_activation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_bot_sessions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare v_count integer;
begin
  update public.bot_sessions
  set activa = false
  where activa = true and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."cleanup_bot_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_is_not_tele"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid()
      and rol not in ('telemercadeo', 'supervisor_telemercadeo')
  );
$$;


ALTER FUNCTION "public"."current_user_is_not_tele"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_abrir_o_actualizar_cargo_vuelta_case"("p_cliente_id" "uuid", "p_monto_cargo_vuelta" numeric DEFAULT NULL::numeric, "p_fecha_cargo_vuelta" "date" DEFAULT NULL::"date", "p_dias_vencido" integer DEFAULT NULL::integer, "p_numero_cuenta_hycite" "text" DEFAULT NULL::"text", "p_numero_orden_hycite" "text" DEFAULT NULL::"text", "p_notas" "text" DEFAULT NULL::"text", "p_tipo_caso" "text" DEFAULT 'cargo_vuelta'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_user_id         uuid;
  v_org_id          uuid;
  v_user_role       text;
  v_case_id         uuid;
  v_has_ledger      boolean;
  v_existing_monto  numeric(12,2);
  v_monto           numeric(12,2);
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_tipo_caso not in ('cargo_vuelta', 'dfp') then
    raise exception 'tipo_caso inválido: %', p_tipo_caso;
  end if;

  select u.org_id, u.rol
    into v_org_id, v_user_role
  from public.usuarios u
  where u.id = v_user_id
  limit 1;

  if v_org_id is null then
    raise exception 'Usuario sin org_id';
  end if;

  if not (
    v_user_role in ('admin', 'distribuidor', 'supervisor_tele')
    or public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
  ) then
    raise exception 'Sin permisos para gestionar casos. Rol requerido: admin, distribuidor o supervisor_tele';
  end if;

  if not exists (
    select 1 from public.clientes
    where id = p_cliente_id and org_id = v_org_id
  ) then
    raise exception 'Cliente no encontrado o no pertenece a su organización';
  end if;

  select cv.id, cv.monto_devuelto
    into v_case_id, v_existing_monto
  from public.cargo_vuelta_cases cv
  where cv.org_id    = v_org_id
    and cv.cliente_id = p_cliente_id
    and cv.tipo_caso  = p_tipo_caso
    and cv.estado is distinct from 'Cerrado'
  order by cv.updated_at desc, cv.created_at desc
  limit 1;

  v_monto := case
    when p_monto_cargo_vuelta is not null and p_monto_cargo_vuelta > 0
    then p_monto_cargo_vuelta::numeric(12,2)
    else null
  end;

  if v_case_id is not null and v_monto is not null and v_existing_monto is not null
     and abs(v_monto - v_existing_monto) > 0.01
  then
    select exists(
      select 1
      from public.cob_revolving_accounts ra
      join public.cob_financial_ledger fl on fl.revolving_account_id = ra.id
      where ra.case_id = v_case_id
        and ra.org_id  = v_org_id
      limit 1
    ) into v_has_ledger;

    if v_has_ledger then
      raise exception
        'El caso tiene una cuenta revolving con movimientos de ledger. No se puede cambiar el monto de % a % automáticamente.',
        v_existing_monto, v_monto;
    end if;
  end if;

  if v_case_id is null then
    insert into public.cargo_vuelta_cases (
      org_id, cliente_id, tipo_caso, origen_cargo_vuelta, estado,
      fecha_apertura, fecha_cargo_vuelta, monto_devuelto, monto_total,
      dias_vencido, numero_cuenta_hycite, numero_orden_hycite,
      requiere_reconciliacion, updated_by
    ) values (
      v_org_id, p_cliente_id, p_tipo_caso, 'hycite', 'Abierto',
      now(), p_fecha_cargo_vuelta, v_monto, v_monto,
      coalesce(p_dias_vencido, 0), p_numero_cuenta_hycite, p_numero_orden_hycite,
      case when v_monto is null or v_monto = 0 then true else false end,
      v_user_id
    )
    returning id into v_case_id;

    if p_notas is not null and trim(p_notas) <> '' then
      insert into public.cob_gestiones (
        org_id, cliente_id, case_id, tipo_gestion, resultado, notas, gestionado_por
      ) values (
        v_org_id, p_cliente_id, v_case_id, 'Nota', 'cargo_vuelta_apertura', p_notas, v_user_id
      );
    end if;
  else
    update public.cargo_vuelta_cases
    set
      tipo_caso            = p_tipo_caso,
      fecha_cargo_vuelta   = coalesce(p_fecha_cargo_vuelta, fecha_cargo_vuelta),
      dias_vencido         = coalesce(p_dias_vencido, dias_vencido),
      numero_cuenta_hycite = coalesce(p_numero_cuenta_hycite, numero_cuenta_hycite),
      numero_orden_hycite  = coalesce(p_numero_orden_hycite, numero_orden_hycite),
      monto_devuelto       = case when v_monto is not null then v_monto else monto_devuelto end,
      monto_total          = case when v_monto is not null then v_monto else monto_total end,
      requiere_reconciliacion = case
        when v_monto is not null and v_monto > 0 then false
        else requiere_reconciliacion
      end,
      updated_by = v_user_id,
      updated_at = now()
    where id = v_case_id;

    if p_notas is not null and trim(p_notas) <> '' then
      insert into public.cob_gestiones (
        org_id, cliente_id, case_id, tipo_gestion, resultado, notas, gestionado_por
      ) values (
        v_org_id, p_cliente_id, v_case_id, 'Nota', 'cargo_vuelta_actualizacion', p_notas, v_user_id
      );
    end if;
  end if;

  return v_case_id;
end;
$$;


ALTER FUNCTION "public"."fn_abrir_o_actualizar_cargo_vuelta_case"("p_cliente_id" "uuid", "p_monto_cargo_vuelta" numeric, "p_fecha_cargo_vuelta" "date", "p_dias_vencido" integer, "p_numero_cuenta_hycite" "text", "p_numero_orden_hycite" "text", "p_notas" "text", "p_tipo_caso" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_abrir_o_recuperar_caso_cartera"("p_cliente_id" "uuid", "p_monto_total" numeric DEFAULT NULL::numeric, "p_dias_vencido" integer DEFAULT NULL::integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_user_id uuid;
  v_user_org_id uuid;
  v_user_role text;
  v_case_id uuid;
  v_cliente_monto_moroso numeric(12,2);
  v_cliente_dias_atraso integer;
  v_monto_total numeric(12,2);
  v_dias_vencido integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select u.org_id, u.rol
    into v_user_org_id, v_user_role
  from public.usuarios u
  where u.id = v_user_id
  limit 1;

  if v_user_org_id is null then
    raise exception 'Usuario sin org_id en public.usuarios';
  end if;

  if not (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or v_user_role = 'telemercadeo'
  ) then
    raise exception 'Usuario sin permisos para abrir casos de cartera';
  end if;

  select c.monto_moroso, c.dias_atraso
    into v_cliente_monto_moroso, v_cliente_dias_atraso
  from public.clientes c
  where c.id = p_cliente_id
    and c.org_id = v_user_org_id
  for update;

  if not found then
    raise exception 'Cliente no encontrado o no pertenece a su organización';
  end if;

  select cv.id
    into v_case_id
  from public.cargo_vuelta_cases cv
  where cv.org_id = v_user_org_id
    and cv.cliente_id = p_cliente_id
    and cv.estado is distinct from 'Cerrado'
  order by cv.updated_at desc, cv.created_at desc
  limit 1;

  if v_case_id is not null then
    return v_case_id;
  end if;

  v_monto_total := coalesce(p_monto_total, v_cliente_monto_moroso, 0)::numeric(12,2);
  v_dias_vencido := coalesce(p_dias_vencido, v_cliente_dias_atraso, 0);

  insert into public.cargo_vuelta_cases (
    org_id,
    cliente_id,
    monto_total,
    dias_vencido,
    estado,
    fecha_apertura,
    updated_by
  ) values (
    v_user_org_id,
    p_cliente_id,
    v_monto_total,
    v_dias_vencido,
    'Abierto',
    now(),
    v_user_id
  )
  returning id into v_case_id;

  return v_case_id;
end;
$$;


ALTER FUNCTION "public"."fn_abrir_o_recuperar_caso_cartera"("p_cliente_id" "uuid", "p_monto_total" numeric, "p_dias_vencido" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_abrir_o_recuperar_caso_cartera"("p_cliente_id" "uuid", "p_monto_total" numeric, "p_dias_vencido" integer) IS 'Recupera un caso activo de cartera para un cliente o crea uno nuevo dentro del org_id del usuario autenticado.';



CREATE OR REPLACE FUNCTION "public"."fn_calcular_due_date"("p_fecha_corte" "date", "p_min_days" smallint DEFAULT 21, "p_preferred_day" smallint DEFAULT NULL::smallint) RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  v_min_due    date;
  v_year       integer;
  v_month      integer;
  v_day        integer;
  v_candidate  date;
begin
  if p_fecha_corte is null then
    return null;
  end if;

  v_min_due := p_fecha_corte + coalesce(p_min_days, 21)::integer;

  if p_preferred_day is null then
    return v_min_due;
  end if;

  -- Usar el menor entre preferred_day y 28 (schema garantiza ≤28, pero defensivo)
  v_day   := least(p_preferred_day::integer, 28);
  v_year  := extract(year  from v_min_due)::integer;
  v_month := extract(month from v_min_due)::integer;

  v_candidate := make_date(v_year, v_month, v_day);

  -- Si el candidato cae antes de la fecha mínima, avanzar un mes
  if v_candidate < v_min_due then
    if v_month = 12 then
      v_candidate := make_date(v_year + 1, 1, v_day);
    else
      v_candidate := make_date(v_year, v_month + 1, v_day);
    end if;
  end if;

  return v_candidate;
end;
$$;


ALTER FUNCTION "public"."fn_calcular_due_date"("p_fecha_corte" "date", "p_min_days" smallint, "p_preferred_day" smallint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_calcular_due_date"("p_fecha_corte" "date", "p_min_days" smallint, "p_preferred_day" smallint) IS 'Calcula fecha_vencimiento de un statement DFP. Garantiza >= fecha_corte + min_days (CARD Act default 21). Con preferred_day: busca la próxima ocurrencia del día en el mes correcto. Inmutable y sin acceso a tablas; úsarla desde fn_cob_statement_generar.';



CREATE OR REPLACE FUNCTION "public"."fn_case_next_step_agreement"("p_case_id" "uuid") RETURNS TABLE("case_id" "uuid", "cliente_id" "uuid", "recommended_action" "text", "recommended_agreement_type" "text", "reason" "text", "risk_level" "text", "has_active_ptp" boolean, "has_overdue_ptp" boolean, "last_gestion_at" timestamp with time zone, "suggested_followup_date" "date", "missing_data" "text"[], "warnings" "text"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_case record;
  v_cliente record;
  v_revolving record;
  v_ptp record;
  v_last_gestion_at timestamptz;
  v_missing_data text[] := '{}';
  v_warnings text[] := '{}';
  v_recommended_action text;
  v_recommended_agreement_type text;
  v_reason text;
  v_risk_level text := 'medium';
  v_has_active_ptp boolean := false;
  v_has_overdue_ptp boolean := false;
  v_suggested_followup_date date;
BEGIN
  -- 1. Seguridad e Identificación del Tenant
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT org_id INTO v_org_id FROM usuarios WHERE id = v_user_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User organization context not found';
  END IF;

  -- 2. Cargar datos del caso con aislamiento de Tenant (org_id)
  SELECT * INTO v_case 
  FROM cargo_vuelta_cases 
  WHERE id = p_case_id AND org_id = v_org_id;
  
  -- Si el caso no existe o es de otra org, devolvemos fila con acción de bloqueo
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      p_case_id, 
      NULL::uuid, 
      'case_not_available'::text, 
      NULL::text, 
      'El caso no está disponible o no pertenece a su organización.'::text, 
      'unknown'::text, 
      false, 
      false, 
      NULL::timestamptz, 
      NULL::date, 
      '{}'::text[], 
      '{}'::text[];
    RETURN;
  END IF;

  -- 3. Cargar datos relacionados
  SELECT * INTO v_cliente FROM clientes WHERE id = v_case.cliente_id;
  SELECT * INTO v_revolving FROM cob_revolving_accounts WHERE case_id = p_case_id;
  
  -- PTP pendiente más próximo
  SELECT * INTO v_ptp FROM cob_ptps 
  WHERE case_id = p_case_id AND estado = 'pendiente' 
  ORDER BY fecha_compromiso ASC LIMIT 1;

  -- Última gestión realizada
  SELECT created_at INTO v_last_gestion_at FROM cob_gestiones 
  WHERE case_id = p_case_id 
  ORDER BY created_at DESC LIMIT 1;

  -- 4. Diagnóstico de Datos Faltantes
  IF v_cliente.nombre IS NULL OR v_cliente.nombre = '' THEN v_missing_data := array_append(v_missing_data, 'cliente.nombre'); END IF;
  IF v_cliente.telefono IS NULL OR v_cliente.telefono = '' THEN v_missing_data := array_append(v_missing_data, 'cliente.telefono'); END IF;
  IF v_case.monto_devuelto IS NULL OR v_case.monto_devuelto <= 0 THEN v_missing_data := array_append(v_missing_data, 'case.monto_devuelto'); END IF;

  -- 5. Lógica de Decisión Operativa (Basada en Prioridades solicitadas)

  -- Prioridad 1: Caso Cerrado o Sin Saldo
  IF v_case.estado IN ('Cerrado', 'Cancelado') OR (v_revolving.saldo_total_actual IS NOT NULL AND v_revolving.saldo_total_actual <= 0) THEN
    v_recommended_action := 'sin_accion';
    v_reason := 'El caso está resuelto, cerrado o no presenta saldo pendiente.';
    v_risk_level := 'low';
  
  -- Prioridad 2 & 3: Faltan datos críticos para operar
  ELSIF array_length(v_missing_data, 1) > 0 THEN
    v_recommended_action := 'completar_datos';
    v_reason := 'Faltan datos clave del cliente o del caso para proceder con la gestión.';
    v_risk_level := 'medium';

  -- Prioridad 4: PTP Pendiente Vencido (Incumplido)
  ELSIF v_ptp.id IS NOT NULL AND v_ptp.fecha_compromiso < CURRENT_DATE THEN
    v_recommended_action := 'gestionar_incumplimiento';
    v_recommended_agreement_type := 'renegotiated_ptp';
    v_reason := 'El cliente tiene una promesa de pago vencida desde el ' || v_ptp.fecha_compromiso || '. Requiere contacto inmediato.';
    v_risk_level := 'high';
    v_has_overdue_ptp := true;
    v_has_active_ptp := true;
    v_suggested_followup_date := CURRENT_DATE;

  -- Prioridad 5: PTP Pendiente Vigente (Esperando fecha)
  ELSIF v_ptp.id IS NOT NULL THEN
    v_recommended_action := 'seguimiento_ptp';
    v_recommended_agreement_type := 'promise_to_pay';
    v_reason := 'Existe una promesa de pago activa programada para el ' || v_ptp.fecha_compromiso || '.';
    v_risk_level := 'medium';
    v_has_active_ptp := true;
    v_suggested_followup_date := v_ptp.fecha_compromiso;

  -- Prioridad 6: Sin acuerdo activo y con saldo pendiente
  ELSE
    v_recommended_action := 'ofrecer_acuerdo';
    v_recommended_agreement_type := 'payment_plan';
    v_reason := 'El caso tiene saldo operativo pero no cuenta con un acuerdo o promesa de pago activa.';
    v_risk_level := CASE 
      WHEN (v_revolving.saldo_total_actual IS NOT NULL AND v_revolving.saldo_total_actual > 1000) THEN 'high'
      ELSE 'medium'
    END;
    v_suggested_followup_date := CURRENT_DATE;
  END IF;

  -- 6. Alertas / Advertencias Adicionales
  IF v_case.en_proceso_legal THEN
    v_warnings := array_append(v_warnings, 'en_proceso_legal');
  END IF;
  IF v_case.requiere_reconciliacion THEN
    v_warnings := array_append(v_warnings, 'requiere_reconciliacion');
  END IF;
  IF v_last_gestion_at IS NULL OR v_last_gestion_at < (now() - interval '30 days') THEN
    v_warnings := array_append(v_warnings, 'sin_gestion_reciente');
  END IF;

  RETURN QUERY SELECT 
    v_case.id,
    v_case.cliente_id,
    v_recommended_action,
    v_recommended_agreement_type,
    v_reason,
    v_risk_level,
    v_has_active_ptp,
    v_has_overdue_ptp,
    v_last_gestion_at,
    v_suggested_followup_date,
    v_missing_data,
    v_warnings;
END;
$$;


ALTER FUNCTION "public"."fn_case_next_step_agreement"("p_case_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_case_next_step_agreement"("p_case_id" "uuid") IS 'Recomienda el próximo paso de cobranza para un caso DFP/Cargo Vuelta analizando PTPs, saldos y gestiones. SECURITY DEFINER con filtrado por org_id.';



CREATE OR REPLACE FUNCTION "public"."fn_cerrar_cargo_vuelta_case"("p_case_id" "uuid", "p_nota" "text" DEFAULT NULL::"text") RETURNS TABLE("case_id" "uuid", "cliente_id" "uuid", "estado" "text", "fecha_cierre" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_org_id    uuid;
  v_caso      record;
begin
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

  select c.* into v_caso
    from public.cargo_vuelta_cases c
   where c.id = p_case_id
     and c.org_id = v_org_id;

  if not found then
    raise exception 'Caso no encontrado o no pertenece a su organización';
  end if;

  if v_caso.estado = 'Cerrado' then
    return query select v_caso.id, v_caso.cliente_id, v_caso.estado, v_caso.fecha_cierre;
    return;
  end if;

  update public.cargo_vuelta_cases
     set estado       = 'Cerrado',
         fecha_cierre = now(),
         updated_by   = auth.uid(),
         updated_at   = now()
   where id = p_case_id;

  insert into public.cob_gestiones (
    org_id, cliente_id, case_id, tipo_gestion, resultado, notas, gestionado_por
  ) values (
    v_org_id,
    v_caso.cliente_id,
    p_case_id,
    'Cierre',
    'pago_realizado',
    coalesce(nullif(trim(p_nota), ''), 'Caso cerrado por pago recibido'),
    auth.uid()
  );

  insert into public.contacto_actividades (
    contacto_tipo, contacto_id, tipo, resumen, contenido, resultado, autor_id
  ) values (
    'cliente',
    v_caso.cliente_id,
    'nota',
    'Caso de cargo de vuelta cerrado por pago recibido',
    coalesce(nullif(trim(p_nota), ''), 'Caso cerrado por pago recibido'),
    'pago_realizado',
    auth.uid()
  );

  return query
    select c.id, c.cliente_id, c.estado, c.fecha_cierre
      from public.cargo_vuelta_cases c
     where c.id = p_case_id;
end;
$$;


ALTER FUNCTION "public"."fn_cerrar_cargo_vuelta_case"("p_case_id" "uuid", "p_nota" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cerrar_cargo_vuelta_case"("p_case_id" "uuid", "p_nota" "text") IS 'Cierra un caso de cargo de vuelta: actualiza estado, registra gestión Cierre/pago_realizado, y dispara sync de clientes.estado_operativo. No toca ledger ni saldos. Idempotente.';



CREATE OR REPLACE FUNCTION "public"."fn_check_mk_owner_exists"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if not exists (select 1 from public.usuarios where id = NEW.owner_id) then
    raise exception 'owner_id % does not exist in public.usuarios', NEW.owner_id;
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."fn_check_mk_owner_exists"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."outbox_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid",
    "org_id" "text",
    "contact_tipo" "text",
    "contact_id" "uuid",
    "canal" "text" NOT NULL,
    "destinatario" "text",
    "asunto" "text",
    "mensaje" "text" NOT NULL,
    "mensaje_resuelto" "text",
    "template_id" "uuid",
    "status" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "scheduled_for" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attachment_urls" "text"[] DEFAULT '{}'::"text"[],
    "provider_message_id" "text",
    "from_email" "text",
    "from_name" "text",
    "reply_to" "text",
    "sender_name" "text",
    "contexto_tipo" "text" DEFAULT 'ad_hoc'::"text",
    "retry_after" timestamp with time zone,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "tipo_envio" "text" DEFAULT 'text'::"text" NOT NULL,
    "template_name" "text",
    "template_params" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "provider" "text",
    "dispatch_provider" "text",
    "n8n_execution_id" "text",
    "dispatched_to_n8n_at" timestamp with time zone,
    "provider_response" "jsonb",
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "cc_emails" "text"[],
    "dfp_notification_key" "text",
    "dfp_notification_date" "date",
    CONSTRAINT "outbox_messages_canal_check" CHECK (("canal" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'email'::"text", 'telegram'::"text"]))),
    CONSTRAINT "outbox_messages_contact_tipo_check" CHECK (("contact_tipo" = ANY (ARRAY['cliente'::"text", 'lead'::"text", 'embajador'::"text"]))),
    CONSTRAINT "outbox_messages_contexto_tipo_check" CHECK (("contexto_tipo" = ANY (ARRAY['campaign'::"text", 'cobranza'::"text", 'servicio'::"text", 'cumpleanos'::"text", 'seguimiento'::"text", 'ad_hoc'::"text"]))),
    CONSTRAINT "outbox_messages_status_check" CHECK (("status" = ANY (ARRAY['borrador'::"text", 'programado'::"text", 'en_proceso'::"text", 'enviado'::"text", 'fallido'::"text", 'retry_pending'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "outbox_messages_tipo_envio_check" CHECK (("tipo_envio" = ANY (ARRAY['text'::"text", 'template'::"text"])))
);


ALTER TABLE "public"."outbox_messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."outbox_messages"."provider_message_id" IS 'ID devuelto por el proveedor (Resend email ID, etc.) para tracking de entrega/bounce';



COMMENT ON COLUMN "public"."outbox_messages"."from_email" IS 'Dirección FROM del remitente (ej: ventas@flowiadigital.com)';



COMMENT ON COLUMN "public"."outbox_messages"."from_name" IS 'Nombre visible del remitente (ej: Royal Prestige Ventas)';



COMMENT ON COLUMN "public"."outbox_messages"."reply_to" IS 'Reply-To real (ej: oportunidad@connectionworldwidegroup.com)';



COMMENT ON COLUMN "public"."outbox_messages"."sender_name" IS 'Nombre real del vendedor que envía (para firma en email)';



COMMENT ON COLUMN "public"."outbox_messages"."retry_after" IS 'Earliest timestamp for next retry attempt. NULL = no delay. Set by worker when transitioning to retry_pending. Worker query: status = ''retry_pending'' AND (retry_after IS NULL OR retry_after <= now()).';



COMMENT ON COLUMN "public"."outbox_messages"."locked_at" IS 'Timestamp when the worker claimed this row (set status = en_proceso). Orphan recovery: rows with status = en_proceso AND locked_at < now() - interval ''10 minutes'' can be safely reset to programado.';



COMMENT ON COLUMN "public"."outbox_messages"."locked_by" IS 'Identifier of the worker invocation that locked this row (e.g., Deno.env request-id or UUID). For debugging stale locks and concurrent processing issues.';



COMMENT ON COLUMN "public"."outbox_messages"."tipo_envio" IS 'Tipo de envio para proveedor de mensajeria: text o template (Meta WhatsApp Cloud API).';



COMMENT ON COLUMN "public"."outbox_messages"."template_name" IS 'Nombre del template aprobado en Meta, usado cuando tipo_envio=template.';



COMMENT ON COLUMN "public"."outbox_messages"."template_params" IS 'Parametros del template en orden (array JSON) para componentes body de WhatsApp.';



COMMENT ON COLUMN "public"."outbox_messages"."provider" IS 'Proveedor usado para envio (meta, resend, telegram, etc.).';



COMMENT ON COLUMN "public"."outbox_messages"."dispatch_provider" IS 'Dispatcher/proveedor responsable del envio. Fase 1 n8n solo procesa filas con valor n8n.';



COMMENT ON COLUMN "public"."outbox_messages"."n8n_execution_id" IS 'Execution id devuelto por n8n para trazabilidad del workflow.';



COMMENT ON COLUMN "public"."outbox_messages"."dispatched_to_n8n_at" IS 'Timestamp cuando el mensaje fue entregado al webhook de n8n.';



COMMENT ON COLUMN "public"."outbox_messages"."provider_response" IS 'Respuesta cruda del dispatcher/proveedor final.';



COMMENT ON COLUMN "public"."outbox_messages"."attempt_count" IS 'Cantidad acumulada de intentos de despacho.';



COMMENT ON COLUMN "public"."outbox_messages"."cc_emails" IS 'Destinatarios en copia (CC) del email. Solo aplica cuando canal = email.';



COMMENT ON COLUMN "public"."outbox_messages"."dfp_notification_key" IS 'Llave logica idempotente para recordatorios DFP, ej. dfp_cuota_reminder:{cuota_id}:{fecha}:{canal}.';



COMMENT ON COLUMN "public"."outbox_messages"."dfp_notification_date" IS 'Fecha America/New_York en la que se genero el recordatorio DFP.';



CREATE OR REPLACE FUNCTION "public"."fn_claim_outbox_messages_for_n8n"("batch_size" integer DEFAULT 50) RETURNS SETOF "public"."outbox_messages"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with candidates as (
    select om.id
    from public.outbox_messages om
    where om.dispatch_provider = 'n8n'
      and om.canal = 'whatsapp'
      and om.status in ('programado', 'retry_pending')
      and coalesce(om.retry_after, om.scheduled_for, now()) <= now()
    order by coalesce(om.retry_after, om.scheduled_for, om.created_at) asc
    for update skip locked
    limit greatest(1, least(coalesce(batch_size, 50), 200))
  ),
  claimed as (
    update public.outbox_messages om
       set status = 'en_proceso',
           locked_at = now(),
           locked_by = 'n8n',
           attempt_count = coalesce(om.attempt_count, 0) + 1
      from candidates c
     where om.id = c.id
     returning om.*
  )
  select *
  from claimed;
$$;


ALTER FUNCTION "public"."fn_claim_outbox_messages_for_n8n"("batch_size" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_claim_outbox_messages_for_n8n"("batch_size" integer) IS 'Reclama de forma atomica mensajes WhatsApp programados para n8n usando FOR UPDATE SKIP LOCKED.';



CREATE OR REPLACE FUNCTION "public"."fn_clasificar_atraso"("p_monto_moroso" numeric, "p_fecha_ultimo_pedido" "date") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_dias integer;
BEGIN
  IF p_monto_moroso = 0 THEN
    RETURN 'al_dia';
  END IF;

  IF p_fecha_ultimo_pedido IS NULL THEN
    RETURN 'sin_pedido';
  END IF;

  v_dias := CURRENT_DATE - p_fecha_ultimo_pedido;

  IF v_dias BETWEEN 0 AND 30 THEN
    RETURN '0_30_dias';
  ELSIF v_dias BETWEEN 31 AND 60 THEN
    RETURN '31_60_dias';
  ELSIF v_dias BETWEEN 61 AND 90 THEN
    RETURN '61_90_dias';
  ELSE
    RETURN 'mas_90_dias';
  END IF;
END;
$$;


ALTER FUNCTION "public"."fn_clasificar_atraso"("p_monto_moroso" numeric, "p_fecha_ultimo_pedido" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_clientes_phone_fallback"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Solo aplica fallback si telefono_casa no colisiona con otro cliente de la misma org
  IF (NEW.telefono IS NULL OR NEW.telefono = '')
     AND (NEW.telefono_casa IS NOT NULL AND NEW.telefono_casa != '')
     AND NOT EXISTS (
       SELECT 1 FROM clientes other
       WHERE other.org_id = NEW.org_id
         AND other.telefono = NEW.telefono_casa
         AND other.id <> NEW.id
     )
  THEN
    NEW.telefono := NEW.telefono_casa;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_clientes_phone_fallback"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cob_acuerdo_calcular_fecha_mensual"("p_anio" integer, "p_mes" integer, "p_dia" integer) RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE STRICT
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_first_day date;
  v_last_day  date;
  v_day       int;
begin
  if p_mes < 1 or p_mes > 12 then
    raise exception 'INVALID_PARAM: p_mes (%) debe estar entre 1 y 12', p_mes;
  end if;

  if p_dia < 1 or p_dia > 31 then
    raise exception 'INVALID_PARAM: p_dia (%) debe estar entre 1 y 31', p_dia;
  end if;

  v_first_day := make_date(p_anio, p_mes, 1);
  v_last_day  := (date_trunc('month', v_first_day::timestamp) + interval '1 month - 1 day')::date;
  v_day       := least(p_dia, extract(day from v_last_day)::int);

  return make_date(p_anio, p_mes, v_day);
end;
$$;


ALTER FUNCTION "public"."fn_cob_acuerdo_calcular_fecha_mensual"("p_anio" integer, "p_mes" integer, "p_dia" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cob_acuerdo_calcular_fecha_mensual"("p_anio" integer, "p_mes" integer, "p_dia" integer) IS 'Devuelve fecha ajustada al último día del mes si p_dia no existe en ese mes.';



CREATE OR REPLACE FUNCTION "public"."fn_cob_acuerdo_calcular_proximo_cobro"("p_fecha_base" "date", "p_dia" integer) RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE STRICT
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_anio int;
  v_mes int;
  v_candidate date;
  v_next_month date;
begin
  if p_dia < 1 or p_dia > 31 then
    raise exception 'INVALID_PARAM: p_dia (%) debe estar entre 1 y 31', p_dia;
  end if;

  v_anio := extract(year from p_fecha_base)::int;
  v_mes  := extract(month from p_fecha_base)::int;

  v_candidate := public.fn_cob_acuerdo_calcular_fecha_mensual(v_anio, v_mes, p_dia);

  if v_candidate > p_fecha_base then
    return v_candidate;
  end if;

  v_next_month := (date_trunc('month', p_fecha_base::timestamp) + interval '1 month')::date;
  return public.fn_cob_acuerdo_calcular_fecha_mensual(
    extract(year from v_next_month)::int,
    extract(month from v_next_month)::int,
    p_dia
  );
end;
$$;


ALTER FUNCTION "public"."fn_cob_acuerdo_calcular_proximo_cobro"("p_fecha_base" "date", "p_dia" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cob_acuerdo_calcular_proximo_cobro"("p_fecha_base" "date", "p_dia" integer) IS 'Calcula próximo cobro mensual ajustando días 29/30/31 al último día del mes.';



CREATE OR REPLACE FUNCTION "public"."fn_cob_acuerdo_cancelar"("p_acuerdo_id" "uuid", "p_motivo" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_actor_id uuid;
  v_actor_org_id uuid;
  v_actor_can_operate boolean;
  v_acuerdo public.cob_acuerdos_pago_automatico%rowtype;
  v_cancelados int := 0;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  v_actor_can_operate := (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or security.current_user_role() = 'telemercadeo'
  );

  if not v_actor_can_operate then
    raise exception 'FORBIDDEN: rol sin permiso para cancelar acuerdos';
  end if;

  if p_acuerdo_id is null then
    raise exception 'INVALID_PARAM: p_acuerdo_id es requerido';
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'INVALID_PARAM: p_motivo es obligatorio';
  end if;

  select * into v_acuerdo
  from public.cob_acuerdos_pago_automatico a
  where a.id = p_acuerdo_id
    and a.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'ACUERDO_NOT_FOUND_OR_FORBIDDEN: acuerdo no existe o no pertenece a la organización';
  end if;

  if v_acuerdo.estado not in ('borrador', 'activo', 'pausado') then
    raise exception 'INVALID_STATE: solo se puede cancelar acuerdo en borrador, activo o pausado';
  end if;

  update public.cob_acuerdos_pago_automatico
  set estado = 'cancelado',
      updated_by = v_actor_id,
      updated_at = now()
  where id = v_acuerdo.id;

  with cte as (
    update public.cob_cobros_programados cp
    set estado = 'cancelado',
        notas = concat_ws(' | ', cp.notas, 'cancelado_por_acuerdo: ' || p_motivo),
        updated_at = now()
    where cp.acuerdo_id = v_acuerdo.id
      and cp.org_id = v_actor_org_id
      and cp.estado in ('programado', 'recordatorio_enviado')
      and cp.fecha_programada >= current_date
    returning cp.id
  ), ins as (
    insert into public.cob_acuerdo_eventos (
      org_id,
      acuerdo_id,
      cobro_programado_id,
      tipo_evento,
      actor_user_id,
      motivo,
      metadata
    )
    select
      v_actor_org_id,
      v_acuerdo.id,
      cte.id,
      'cobro_cancelado',
      v_actor_id,
      p_motivo,
      jsonb_build_object('source', 'fn_cob_acuerdo_cancelar')
    from cte
    returning 1
  )
  select count(*)::int into v_cancelados from cte;

  insert into public.cob_acuerdo_eventos (
    org_id,
    acuerdo_id,
    tipo_evento,
    actor_user_id,
    motivo,
    metadata
  )
  values (
    v_actor_org_id,
    v_acuerdo.id,
    'acuerdo_cancelado',
    v_actor_id,
    p_motivo,
    jsonb_build_object('source', 'fn_cob_acuerdo_cancelar', 'cobros_cancelados', v_cancelados)
  );

  return jsonb_build_object(
    'acuerdo_id', v_acuerdo.id,
    'estado', 'cancelado',
    'cobros_cancelados', v_cancelados
  );
end;
$$;


ALTER FUNCTION "public"."fn_cob_acuerdo_cancelar"("p_acuerdo_id" "uuid", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cob_acuerdo_cancelar"("p_acuerdo_id" "uuid", "p_motivo" "text") IS 'Cancela acuerdo y cobros futuros; no cierra caso automáticamente.';



CREATE OR REPLACE FUNCTION "public"."fn_cob_acuerdo_crear"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_actor_id uuid;
  v_actor_org_id uuid;
  v_actor_can_operate boolean;

  v_case record;
  v_metodo record;
  v_existing uuid;

  v_cliente_id uuid;
  v_case_id uuid;
  v_revolving_id uuid;
  v_metodo_id uuid;

  v_monto_base numeric(12,2);
  v_pct numeric(5,2);
  v_monto_total numeric(12,2);
  v_frecuencia text;
  v_dia int;
  v_fecha_primer date;
  v_autorizado boolean;
  v_fecha_aut timestamptz;
  v_canal text;
  v_notas text;
  v_metadata jsonb;
  v_estado text;

  v_acuerdo_id uuid;
  v_gen_result jsonb := '{}'::jsonb;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  v_actor_can_operate := (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or security.current_user_role() = 'telemercadeo'
  );

  if not v_actor_can_operate then
    raise exception 'FORBIDDEN: rol sin permiso para crear acuerdos';
  end if;

  if p_payload is null then
    raise exception 'INVALID_PARAM: p_payload es requerido';
  end if;

  v_cliente_id   := (p_payload->>'cliente_id')::uuid;
  v_case_id      := (p_payload->>'cargo_vuelta_case_id')::uuid;
  v_revolving_id := nullif(p_payload->>'revolving_account_id', '')::uuid;
  v_metodo_id    := nullif(p_payload->>'metodo_pago_id', '')::uuid;

  v_monto_base   := (p_payload->>'monto_base_mensual')::numeric(12,2);
  v_pct          := coalesce((p_payload->>'porcentaje_cargo_autorizado')::numeric(5,2), 0);
  v_monto_total  := (p_payload->>'monto_total_cobro')::numeric(12,2);

  v_frecuencia   := coalesce(p_payload->>'frecuencia', 'mensual');
  v_dia          := (p_payload->>'dia_cobro_preferido')::int;
  v_fecha_primer := (p_payload->>'fecha_primer_cobro')::date;

  v_autorizado   := coalesce((p_payload->>'autorizado_por_cliente')::boolean, false);
  v_fecha_aut    := nullif(p_payload->>'fecha_autorizacion', '')::timestamptz;
  v_canal        := nullif(p_payload->>'canal_autorizacion', '');
  v_notas        := nullif(p_payload->>'notas', '');
  v_metadata     := coalesce(p_payload->'metadata', '{}'::jsonb);

  if v_cliente_id is null or v_case_id is null then
    raise exception 'INVALID_PARAM: cliente_id y cargo_vuelta_case_id son requeridos';
  end if;

  if v_monto_base is null or v_monto_base <= 0 then
    raise exception 'INVALID_PARAM: monto_base_mensual debe ser > 0';
  end if;

  if v_pct < 0 or v_pct > 100 then
    raise exception 'INVALID_PARAM: porcentaje_cargo_autorizado debe estar entre 0 y 100';
  end if;

  if v_monto_total is null or v_monto_total <= 0 then
    raise exception 'INVALID_PARAM: monto_total_cobro debe ser > 0';
  end if;

  if v_frecuencia <> 'mensual' then
    raise exception 'INVALID_PARAM: frecuencia debe ser mensual';
  end if;

  if v_dia is null or v_dia < 1 or v_dia > 31 then
    raise exception 'INVALID_PARAM: dia_cobro_preferido debe estar entre 1 y 31';
  end if;

  if v_fecha_primer is null then
    raise exception 'INVALID_PARAM: fecha_primer_cobro es requerida';
  end if;

  if v_autorizado and v_fecha_aut is null then
    raise exception 'INVALID_PARAM: fecha_autorizacion es requerida cuando autorizado_por_cliente = true';
  end if;

  select c.id, c.org_id, c.cliente_id
  into v_case
  from public.cargo_vuelta_cases c
  where c.id = v_case_id
    and c.org_id = v_actor_org_id
  limit 1;

  if not found then
    raise exception 'CASE_NOT_FOUND_OR_FORBIDDEN: el caso no existe o no pertenece a la organización';
  end if;

  if v_case.cliente_id is distinct from v_cliente_id then
    raise exception 'INVALID_RELATION: cliente_id no corresponde al cliente del caso';
  end if;

  if v_metodo_id is not null then
    select m.id, m.org_id, m.cliente_id, m.cargo_vuelta_case_id
    into v_metodo
    from public.cob_metodos_pago m
    where m.id = v_metodo_id
      and m.org_id = v_actor_org_id
    limit 1;

    if not found then
      raise exception 'METODO_PAGO_NOT_FOUND_OR_FORBIDDEN: método de pago no existe o no pertenece a la organización';
    end if;

    if v_metodo.cliente_id is not null and v_metodo.cliente_id is distinct from v_cliente_id then
      raise exception 'INVALID_RELATION: metodo_pago_id no corresponde al cliente del acuerdo';
    end if;

    if v_metodo.cargo_vuelta_case_id is not null and v_metodo.cargo_vuelta_case_id is distinct from v_case_id then
      raise exception 'INVALID_RELATION: metodo_pago_id no corresponde al caso del acuerdo';
    end if;
  end if;

  if v_revolving_id is not null then
    perform 1
    from public.cob_revolving_accounts a
    where a.id = v_revolving_id
      and a.org_id = v_actor_org_id
      and a.cargo_vuelta_case_id = v_case_id;

    if not found then
      raise exception 'REVOLVING_NOT_FOUND_OR_FORBIDDEN: revolving_account_id inválido para org/caso';
    end if;
  end if;

  select a.id into v_existing
  from public.cob_acuerdos_pago_automatico a
  where a.org_id = v_actor_org_id
    and a.cargo_vuelta_case_id = v_case_id
    and a.estado in ('activo', 'pausado')
  limit 1;

  if v_existing is not null then
    raise exception 'DUPLICATE_ACTIVE_AGREEMENT: ya existe acuerdo activo/pausado para este caso (%)', v_existing;
  end if;

  v_estado := case
    when v_autorizado then 'activo'
    else 'borrador'
  end;

  insert into public.cob_acuerdos_pago_automatico (
    org_id,
    cliente_id,
    cargo_vuelta_case_id,
    revolving_account_id,
    metodo_pago_id,
    monto_base_mensual,
    porcentaje_cargo_autorizado,
    monto_total_cobro,
    frecuencia,
    dia_cobro_preferido,
    fecha_primer_cobro,
    fecha_proximo_cobro,
    statement_automatico,
    recordatorio_automatico,
    estado,
    autorizado_por_cliente,
    fecha_autorizacion,
    canal_autorizacion,
    notas,
    metadata,
    created_by,
    updated_by
  )
  values (
    v_actor_org_id,
    v_cliente_id,
    v_case_id,
    v_revolving_id,
    v_metodo_id,
    v_monto_base,
    v_pct,
    v_monto_total,
    'mensual',
    v_dia,
    v_fecha_primer,
    v_fecha_primer,
    coalesce((p_payload->>'statement_automatico')::boolean, true),
    coalesce((p_payload->>'recordatorio_automatico')::boolean, true),
    v_estado,
    v_autorizado,
    v_fecha_aut,
    v_canal,
    v_notas,
    v_metadata,
    v_actor_id,
    v_actor_id
  )
  returning id into v_acuerdo_id;

  insert into public.cob_acuerdo_eventos (
    org_id,
    acuerdo_id,
    tipo_evento,
    actor_user_id,
    payload_after,
    metadata
  )
  values (
    v_actor_org_id,
    v_acuerdo_id,
    'acuerdo_creado',
    v_actor_id,
    jsonb_build_object(
      'estado', v_estado,
      'fecha_primer_cobro', v_fecha_primer,
      'monto_total_cobro', v_monto_total,
      'dia_cobro_preferido', v_dia
    ),
    jsonb_build_object('source', 'fn_cob_acuerdo_crear')
  );

  if v_estado = 'activo' then
    v_gen_result := public.fn_cob_acuerdo_generar_cobros(v_acuerdo_id, 3);
  end if;

  return jsonb_build_object(
    'acuerdo_id', v_acuerdo_id,
    'estado', v_estado,
    'fecha_proximo_cobro', v_fecha_primer,
    'cobros_generados', v_gen_result
  );
end;
$$;


ALTER FUNCTION "public"."fn_cob_acuerdo_crear"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cob_acuerdo_crear"("p_payload" "jsonb") IS 'Crea acuerdo automático DFP, audita evento y genera cobros iniciales si queda activo.';



CREATE OR REPLACE FUNCTION "public"."fn_cob_acuerdo_generar_cobros"("p_acuerdo_id" "uuid", "p_meses_a_generar" integer DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_actor_id uuid;
  v_actor_org_id uuid;
  v_actor_can_operate boolean;

  v_acuerdo public.cob_acuerdos_pago_automatico%rowtype;

  v_created_count int := 0;
  v_skipped_count int := 0;
  v_i int;
  v_month_anchor date;
  v_base_month date;
  v_fecha_programada date;
  v_inserted_id uuid;
  v_fechas date[] := '{}';
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  v_actor_can_operate := (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or security.current_user_role() = 'telemercadeo'
  );

  if not v_actor_can_operate then
    raise exception 'FORBIDDEN: rol sin permiso para generar cobros de acuerdos';
  end if;

  if p_acuerdo_id is null then
    raise exception 'INVALID_PARAM: p_acuerdo_id es requerido';
  end if;

  if p_meses_a_generar is null or p_meses_a_generar < 1 or p_meses_a_generar > 24 then
    raise exception 'INVALID_PARAM: p_meses_a_generar (%) debe estar entre 1 y 24', p_meses_a_generar;
  end if;

  select * into v_acuerdo
  from public.cob_acuerdos_pago_automatico a
  where a.id = p_acuerdo_id
    and a.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'ACUERDO_NOT_FOUND_OR_FORBIDDEN: acuerdo no existe o no pertenece a la org del usuario';
  end if;

  if v_acuerdo.estado <> 'activo' then
    raise exception 'INVALID_STATE: acuerdo % debe estar en estado activo para generar cobros', p_acuerdo_id;
  end if;

  v_month_anchor := coalesce(v_acuerdo.fecha_proximo_cobro, v_acuerdo.fecha_primer_cobro);
  v_base_month := date_trunc('month', v_month_anchor::timestamp)::date;

  for v_i in 0..(p_meses_a_generar - 1) loop
    v_month_anchor := (v_base_month + make_interval(months => v_i))::date;

    v_fecha_programada := public.fn_cob_acuerdo_calcular_fecha_mensual(
      extract(year from v_month_anchor)::int,
      extract(month from v_month_anchor)::int,
      v_acuerdo.dia_cobro_preferido
    );

    insert into public.cob_cobros_programados (
      org_id,
      acuerdo_id,
      cliente_id,
      cargo_vuelta_case_id,
      metodo_pago_id,
      fecha_programada,
      monto_programado,
      estado,
      intento_numero
    )
    values (
      v_acuerdo.org_id,
      v_acuerdo.id,
      v_acuerdo.cliente_id,
      v_acuerdo.cargo_vuelta_case_id,
      v_acuerdo.metodo_pago_id,
      v_fecha_programada,
      v_acuerdo.monto_total_cobro,
      'programado',
      0
    )
    on conflict (acuerdo_id, fecha_programada) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is not null then
      v_created_count := v_created_count + 1;
      v_fechas := array_append(v_fechas, v_fecha_programada);

      insert into public.cob_acuerdo_eventos (
        org_id,
        acuerdo_id,
        cobro_programado_id,
        tipo_evento,
        actor_user_id,
        payload_after,
        metadata
      )
      values (
        v_acuerdo.org_id,
        v_acuerdo.id,
        v_inserted_id,
        'cobro_programado_creado',
        v_actor_id,
        jsonb_build_object(
          'fecha_programada', v_fecha_programada,
          'monto_programado', v_acuerdo.monto_total_cobro,
          'metodo_pago_id', v_acuerdo.metodo_pago_id
        ),
        jsonb_build_object('source', 'fn_cob_acuerdo_generar_cobros')
      );
    else
      v_skipped_count := v_skipped_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'acuerdo_id', v_acuerdo.id,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'fechas_generadas', coalesce(to_jsonb(v_fechas), '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."fn_cob_acuerdo_generar_cobros"("p_acuerdo_id" "uuid", "p_meses_a_generar" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cob_acuerdo_generar_cobros"("p_acuerdo_id" "uuid", "p_meses_a_generar" integer) IS 'Genera cobros programados futuros de forma idempotente para acuerdos activos.';



CREATE OR REPLACE FUNCTION "public"."fn_cob_acuerdo_pausar"("p_acuerdo_id" "uuid", "p_motivo" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_actor_id uuid;
  v_actor_org_id uuid;
  v_actor_can_operate boolean;
  v_acuerdo public.cob_acuerdos_pago_automatico%rowtype;
  v_cancelados int := 0;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  v_actor_can_operate := (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or security.current_user_role() = 'telemercadeo'
  );

  if not v_actor_can_operate then
    raise exception 'FORBIDDEN: rol sin permiso para pausar acuerdos';
  end if;

  if p_acuerdo_id is null then
    raise exception 'INVALID_PARAM: p_acuerdo_id es requerido';
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'INVALID_PARAM: p_motivo es obligatorio';
  end if;

  select * into v_acuerdo
  from public.cob_acuerdos_pago_automatico a
  where a.id = p_acuerdo_id
    and a.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'ACUERDO_NOT_FOUND_OR_FORBIDDEN: acuerdo no existe o no pertenece a la organización';
  end if;

  if v_acuerdo.estado <> 'activo' then
    raise exception 'INVALID_STATE: solo se puede pausar un acuerdo activo';
  end if;

  update public.cob_acuerdos_pago_automatico
  set estado = 'pausado',
      updated_by = v_actor_id,
      updated_at = now()
  where id = v_acuerdo.id;

  with cte as (
    update public.cob_cobros_programados cp
    set estado = 'cancelado',
        notas = concat_ws(' | ', cp.notas, 'cancelado_por_pausa: ' || p_motivo),
        updated_at = now()
    where cp.acuerdo_id = v_acuerdo.id
      and cp.org_id = v_actor_org_id
      and cp.estado in ('programado', 'recordatorio_enviado')
      and cp.fecha_programada >= current_date
    returning cp.id
  ), ins as (
    insert into public.cob_acuerdo_eventos (
      org_id,
      acuerdo_id,
      cobro_programado_id,
      tipo_evento,
      actor_user_id,
      motivo,
      metadata
    )
    select
      v_actor_org_id,
      v_acuerdo.id,
      cte.id,
      'cobro_cancelado',
      v_actor_id,
      p_motivo,
      jsonb_build_object('source', 'fn_cob_acuerdo_pausar')
    from cte
    returning 1
  )
  select count(*)::int into v_cancelados from cte;

  insert into public.cob_acuerdo_eventos (
    org_id,
    acuerdo_id,
    tipo_evento,
    actor_user_id,
    motivo,
    metadata
  )
  values (
    v_actor_org_id,
    v_acuerdo.id,
    'acuerdo_pausado',
    v_actor_id,
    p_motivo,
    jsonb_build_object('source', 'fn_cob_acuerdo_pausar', 'cobros_cancelados', v_cancelados)
  );

  return jsonb_build_object(
    'acuerdo_id', v_acuerdo.id,
    'estado', 'pausado',
    'cobros_cancelados', v_cancelados
  );
end;
$$;


ALTER FUNCTION "public"."fn_cob_acuerdo_pausar"("p_acuerdo_id" "uuid", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cob_acuerdo_pausar"("p_acuerdo_id" "uuid", "p_motivo" "text") IS 'Pausa acuerdo activo y cancela cobros futuros programados/recordatorio_enviado.';



CREATE OR REPLACE FUNCTION "public"."fn_cob_acuerdo_reactivar"("p_acuerdo_id" "uuid", "p_fecha_reactivacion" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_actor_id uuid;
  v_actor_org_id uuid;
  v_actor_can_operate boolean;
  v_acuerdo public.cob_acuerdos_pago_automatico%rowtype;
  v_fecha_proximo date;
  v_gen_result jsonb;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  v_actor_can_operate := (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or security.current_user_role() = 'telemercadeo'
  );

  if not v_actor_can_operate then
    raise exception 'FORBIDDEN: rol sin permiso para reactivar acuerdos';
  end if;

  if p_acuerdo_id is null then
    raise exception 'INVALID_PARAM: p_acuerdo_id es requerido';
  end if;

  if p_fecha_reactivacion is null then
    raise exception 'INVALID_PARAM: p_fecha_reactivacion es requerida';
  end if;

  select * into v_acuerdo
  from public.cob_acuerdos_pago_automatico a
  where a.id = p_acuerdo_id
    and a.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'ACUERDO_NOT_FOUND_OR_FORBIDDEN: acuerdo no existe o no pertenece a la organización';
  end if;

  if v_acuerdo.estado <> 'pausado' then
    raise exception 'INVALID_STATE: solo se puede reactivar un acuerdo en estado pausado';
  end if;

  v_fecha_proximo := public.fn_cob_acuerdo_calcular_proximo_cobro(
    p_fecha_reactivacion,
    v_acuerdo.dia_cobro_preferido
  );

  update public.cob_acuerdos_pago_automatico
  set estado = 'activo',
      fecha_proximo_cobro = v_fecha_proximo,
      updated_by = v_actor_id,
      updated_at = now()
  where id = v_acuerdo.id;

  insert into public.cob_acuerdo_eventos (
    org_id,
    acuerdo_id,
    tipo_evento,
    actor_user_id,
    payload_after,
    metadata
  )
  values (
    v_actor_org_id,
    v_acuerdo.id,
    'acuerdo_editado',
    v_actor_id,
    jsonb_build_object('estado', 'activo', 'fecha_proximo_cobro', v_fecha_proximo),
    jsonb_build_object('accion', 'reactivado', 'source', 'fn_cob_acuerdo_reactivar')
  );

  v_gen_result := public.fn_cob_acuerdo_generar_cobros(v_acuerdo.id, 3);

  return jsonb_build_object(
    'acuerdo_id', v_acuerdo.id,
    'estado', 'activo',
    'fecha_proximo_cobro', v_fecha_proximo,
    'cobros_generados', v_gen_result
  );
end;
$$;


ALTER FUNCTION "public"."fn_cob_acuerdo_reactivar"("p_acuerdo_id" "uuid", "p_fecha_reactivacion" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cob_acuerdo_reactivar"("p_acuerdo_id" "uuid", "p_fecha_reactivacion" "date") IS 'Reactiva acuerdo pausado, recalcula próximo cobro y genera agenda inicial.';



CREATE OR REPLACE FUNCTION "public"."fn_cob_cuotas_auto_vencido"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.estado = 'pendiente'
     and new.fecha_vencimiento < current_date then
    new.estado := 'vencida';
  end if;
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_cob_cuotas_auto_vencido"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cob_ptps_auto_vencido"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Auto-vencido: pendiente cuya fecha de compromiso ya pasó
  if new.estado = 'pendiente'
     and new.fecha_compromiso < current_date then
    new.estado := 'vencido';
  end if;

  -- Auto-timestamp de cumplimiento
  if new.estado = 'cumplido'
     and new.cumplido_at is null then
    new.cumplido_at := now();
    if new.fecha_cumplimiento is null then
      new.fecha_cumplimiento := current_date;
    end if;
  end if;

  -- Auto-timestamp de incumplimiento (incumplido o vencido)
  if new.estado in ('incumplido', 'vencido')
     and new.incumplido_at is null then
    new.incumplido_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_cob_ptps_auto_vencido"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cob_statement_generar"("p_revolving_account_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date" DEFAULT NULL::"date", "p_notas" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_actor_id               uuid;
  v_actor_org_id           uuid;
  v_account                record;
  v_fecha_corte            date;
  v_fecha_vencimiento      date;
  v_ytd_inicio             date;
  v_dias_ciclo             integer;

  v_balance_previo         numeric(12,2);
  v_balance_sujeto_int     numeric(12,2);
  v_pagos_periodo          numeric(12,2);
  v_otros_creditos         numeric(12,2);
  v_compras_periodo        numeric(12,2);
  v_cargos_interes         numeric(12,2);
  v_cargos_fees            numeric(12,2);
  v_nuevo_balance          numeric(12,2);
  v_ytd_fees               numeric(12,2);
  v_ytd_interes            numeric(12,2);
  v_tasa_diaria            numeric(12,10);

  v_existing_id            uuid;
  v_statement_id           uuid;
  v_now                    timestamptz := now();
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  if p_revolving_account_id is null then
    raise exception 'INVALID_PARAM: p_revolving_account_id es requerido';
  end if;
  if p_periodo_inicio is null or p_periodo_fin is null then
    raise exception 'INVALID_PARAM: p_periodo_inicio y p_periodo_fin son requeridos';
  end if;
  if p_periodo_inicio > p_periodo_fin then
    raise exception 'INVALID_PARAM: p_periodo_inicio (%) no puede ser posterior a p_periodo_fin (%)',
      p_periodo_inicio, p_periodo_fin;
  end if;

  v_fecha_corte := coalesce(p_fecha_corte, p_periodo_fin);

  if v_fecha_corte < p_periodo_inicio or v_fecha_corte > p_periodo_fin then
    raise exception 'INVALID_FECHA_CORTE: fecha_corte (%) debe estar entre % y %',
      v_fecha_corte, p_periodo_inicio, p_periodo_fin;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(
      p_revolving_account_id::text
      || '|' || p_periodo_inicio::text
      || '|' || p_periodo_fin::text
    )
  );

  select a.* into v_account
  from public.cob_revolving_accounts a
  where a.id     = p_revolving_account_id
    and a.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND_OR_FORBIDDEN: cuenta % no existe o no pertenece a la organización',
      p_revolving_account_id;
  end if;

  select s.id into v_existing_id
  from public.cob_statements s
  where s.revolving_account_id = p_revolving_account_id
    and s.org_id               = v_actor_org_id
    and s.periodo_inicio       = p_periodo_inicio
    and s.periodo_fin          = p_periodo_fin
  limit 1;

  if v_existing_id is not null then
    raise exception 'STATEMENT_EXISTS: ya existe statement % para el período % → %',
      v_existing_id, p_periodo_inicio, p_periodo_fin;
  end if;

  v_dias_ciclo  := (p_periodo_fin - p_periodo_inicio + 1)::integer;
  v_ytd_inicio  := make_date(extract(year from p_periodo_fin)::integer, 1, 1);
  v_tasa_diaria := round(v_account.apr_anual / 365.0, 10);

  v_fecha_vencimiento := public.fn_calcular_due_date(
    v_fecha_corte,
    v_account.min_days_statement_to_due,
    v_account.customer_preferred_payment_day
  );

  select coalesce(sum(
    case when debit_credit = 'debit' then amount else -amount end
  ), 0)::numeric(12,2)
  into v_balance_previo
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date < p_periodo_inicio;

  v_balance_previo := greatest(v_balance_previo, 0);

  select coalesce(sum(
    case
      when component_type = 'principal' and debit_credit = 'debit'  then  amount
      when component_type = 'principal' and debit_credit = 'credit' then -amount
      else 0
    end
  ), 0)::numeric(12,2)
  into v_balance_sujeto_int
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date < p_periodo_inicio;

  v_balance_sujeto_int := greatest(v_balance_sujeto_int, 0);

  select
    coalesce(sum(case
      when entry_type = 'payment_applied' and debit_credit = 'credit'
      then amount else 0 end), 0)::numeric(12,2),

    coalesce(sum(case
      when entry_type in ('adjustment', 'reversal') and debit_credit = 'credit'
      then amount else 0 end), 0)::numeric(12,2),

    -- FIX 0156: incluir principal_initial dentro de compras_periodo
    coalesce(sum(case
      when component_type = 'principal'
        and debit_credit = 'debit'
      then amount else 0 end), 0)::numeric(12,2),

    coalesce(sum(case
      when component_type = 'interest' and debit_credit = 'debit'
      then amount else 0 end), 0)::numeric(12,2),

    coalesce(sum(case
      when component_type = 'fee' and debit_credit = 'debit'
      then amount else 0 end), 0)::numeric(12,2)

  into
    v_pagos_periodo,
    v_otros_creditos,
    v_compras_periodo,
    v_cargos_interes,
    v_cargos_fees

  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date >= p_periodo_inicio
    and l.effective_date <= p_periodo_fin;

  select
    coalesce(sum(case
      when component_type = 'fee'      and debit_credit = 'debit' then amount else 0 end), 0)::numeric(12,2),
    coalesce(sum(case
      when component_type = 'interest' and debit_credit = 'debit' then amount else 0 end), 0)::numeric(12,2)
  into
    v_ytd_fees,
    v_ytd_interes
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date >= v_ytd_inicio
    and l.effective_date <= p_periodo_fin;

  v_nuevo_balance := round(
    v_balance_previo
    + v_compras_periodo
    + v_cargos_interes
    + v_cargos_fees
    - v_pagos_periodo
    - v_otros_creditos,
    2
  );
  v_nuevo_balance := greatest(v_nuevo_balance, 0);

  insert into public.cob_statements (
    org_id,
    cliente_id,
    case_id,
    revolving_account_id,
    periodo_inicio,
    periodo_fin,
    fecha_corte,
    fecha_vencimiento,
    dias_ciclo_facturacion,
    balance_previo,
    pagos_periodo,
    otros_creditos,
    compras_periodo,
    balance_atrasado,
    cargos_totales_periodo,
    apr_tae,
    tasa_diaria,
    balance_sujeto_interes,
    cargos_interes_periodo,
    nuevo_balance,
    pago_minimo,
    ytd_cargos_atraso,
    ytd_cargos_interes,
    mensaje_pago,
    status,
    generated_by,
    metadata,
    created_at,
    updated_at
  )
  values (
    v_actor_org_id,
    v_account.cliente_id,
    v_account.case_id,
    p_revolving_account_id,
    p_periodo_inicio,
    p_periodo_fin,
    v_fecha_corte,
    v_fecha_vencimiento,
    v_dias_ciclo,
    v_balance_previo,
    v_pagos_periodo,
    v_otros_creditos,
    v_compras_periodo,
    v_balance_previo,
    v_cargos_fees,
    v_account.apr_anual,
    v_tasa_diaria,
    v_balance_sujeto_int,
    v_cargos_interes,
    v_nuevo_balance,
    v_nuevo_balance,
    v_ytd_fees,
    v_ytd_interes,
    coalesce(
      p_notas,
      'Por favor realice su pago antes del '
        || to_char(v_fecha_vencimiento, 'DD/MM/YYYY')
        || ' para evitar cargos adicionales.'
    ),
    'draft',
    v_actor_id,
    jsonb_build_object(
      'account_apr',               v_account.apr_anual,
      'account_estado',            v_account.estado,
      'dias_ciclo',                v_dias_ciclo,
      'closing_day',               v_account.statement_closing_day,
      'preferred_payment_day',     v_account.customer_preferred_payment_day,
      'min_days_statement_to_due', v_account.min_days_statement_to_due,
      'fix_version',               '0156_principal_initial_in_header'
    ),
    v_now,
    v_now
  )
  returning id into v_statement_id;

  insert into public.cob_statement_lines (
    org_id,
    statement_id,
    revolving_account_id,
    ledger_entry_id,
    line_order,
    transaction_date,
    posting_date,
    entry_type,
    component_type,
    description,
    amount,
    metadata
  )
  select
    v_actor_org_id,
    v_statement_id,
    p_revolving_account_id,
    l.id,
    row_number() over (order by l.effective_date asc, l.created_at asc)::integer,
    l.effective_date,
    l.entry_date,
    l.entry_type,
    l.component_type,
    coalesce(l.description, l.entry_type),
    case when l.debit_credit = 'debit' then l.amount else -l.amount end,
    jsonb_build_object(
      'debit_credit',    l.debit_credit,
      'original_amount', l.amount
    )
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date >= p_periodo_inicio
    and l.effective_date <= p_periodo_fin
  order by l.effective_date asc, l.created_at asc;

  return v_statement_id;
end;
$$;


ALTER FUNCTION "public"."fn_cob_statement_generar"("p_revolving_account_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_notas" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cob_statement_generar"("p_revolving_account_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_notas" "text") IS '0156 fix: incluye principal_initial en compras_periodo para cuadrar header con líneas. Genera snapshot en cob_statements + cob_statement_lines sin mutar ledger.';



CREATE OR REPLACE FUNCTION "public"."fn_crear_revolving_account_cargo_vuelta"("p_case_id" "uuid", "p_apr" numeric, "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_actor_id        uuid;
  v_actor_org_id    uuid;
  v_case            record;
  v_existing_id     uuid;
  v_account_id      uuid;
  v_apr             numeric(6,5);
  v_principal       numeric(12,2);
  v_now             timestamptz := now();
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id
    into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  if p_apr is null then
    raise exception 'INVALID_APR: apr_anual es obligatorio y debe estar entre 0.10 y 0.24';
  end if;

  v_apr := round(p_apr::numeric, 5);

  if v_apr < 0.10 or v_apr > 0.24 then
    raise exception 'INVALID_APR: apr_anual debe estar entre 0.10 y 0.24 (0.10 = 10%%, 0.24 = 24%%). Recibido: %', v_apr;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_case_id::text));

  select c.*
    into v_case
  from public.cargo_vuelta_cases c
  where c.id = p_case_id
    and c.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'CASE_NOT_FOUND_OR_FORBIDDEN: caso % no existe o no pertenece a la organización', p_case_id;
  end if;

  if coalesce(v_case.monto_devuelto, 0) <= 0 then
    raise exception 'INVALID_MONTO_DEVUELTO: monto_devuelto debe ser mayor a 0 (caso: %)', p_case_id;
  end if;

  v_principal := round(v_case.monto_devuelto::numeric, 2);

  select a.id
    into v_existing_id
  from public.cob_revolving_accounts a
  where a.case_id = p_case_id
    and a.org_id  = v_actor_org_id
  limit 1;

  if v_existing_id is not null then
    raise exception 'REVOLVING_ACCOUNT_EXISTS: ya existe cuenta revolving % para el caso %',
      v_existing_id, p_case_id;
  end if;

  insert into public.cob_revolving_accounts (
    org_id,
    case_id,
    cliente_id,
    apr_anual,
    metodo_calculo_interes,
    fecha_inicio,
    fecha_ultimo_devengo,
    saldo_principal_inicial,
    saldo_principal_actual,
    saldo_interes_actual,
    saldo_fees_actual,
    estado,
    created_by,
    created_at,
    updated_at
  )
  values (
    v_actor_org_id,
    p_case_id,
    v_case.cliente_id,
    v_apr,
    'daily_simple_365',
    current_date,
    current_date,
    v_principal,
    v_principal,
    0,
    0,
    'activo',
    v_actor_id,
    v_now,
    v_now
  )
  returning id into v_account_id;

  insert into public.cob_financial_ledger (
    org_id,
    revolving_account_id,
    case_id,
    cliente_id,
    entry_date,
    effective_date,
    entry_type,
    component_type,
    debit_credit,
    amount,
    description,
    balance_principal_after,
    balance_interest_after,
    balance_fees_after,
    balance_total_after,
    metadata,
    created_by,
    created_at
  )
  values (
    v_actor_org_id,
    v_account_id,
    p_case_id,
    v_case.cliente_id,
    current_date,
    current_date,
    'principal_initial',
    'principal',
    'debit',
    v_principal,
    coalesce(p_notes, 'Cuenta DFP Revolving abierta desde Cargo de Vuelta'),
    v_principal,
    0,
    0,
    v_principal,
    jsonb_build_object(
      'case_id',        p_case_id,
      'apr_anual',      v_apr,
      'monto_devuelto', v_principal
    ),
    v_actor_id,
    v_now
  );

  return v_account_id;
end;
$$;


ALTER FUNCTION "public"."fn_crear_revolving_account_cargo_vuelta"("p_case_id" "uuid", "p_apr" numeric, "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_crear_revolving_account_cargo_vuelta"("p_case_id" "uuid", "p_apr" numeric, "p_notes" "text") IS 'Abre una cuenta revolving DFP desde un caso Cargo de Vuelta. Usa monto_devuelto como principal inicial. Crea ledger principal_initial. Valida org_id dentro de la función. apr_anual es obligatorio: decimal entre 0.10 (10%%) y 0.24 (24%%), alineado con constraint de 0118. Null, 0 y valores fuera de rango se rechazan.';



CREATE OR REPLACE FUNCTION "public"."fn_crear_venta_completa"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_org_id uuid;
  v_user_rol public.usuario_rol;

  v_owner_type text;
  v_cliente_id uuid;
  v_lead_id uuid;
  v_vendedor_id uuid;
  v_tipo_movimiento public.venta_tipo_movimiento;

  v_venta_id uuid;
  v_subtotal numeric(12,2);
  v_impuesto numeric(12,2);
  v_cargo_envio numeric(12,2);
  v_descuento numeric(12,2);
  v_total numeric(12,2);
  v_pago_inicial numeric(12,2);
  v_saldo_pendiente numeric(12,2);

  v_saldo_acumulado numeric(12,2) := 0;
  v_items_count integer := 0;
  v_transacciones_count integer := 0;

  v_lead_row record;
  v_item jsonb;

  v_item_cantidad integer;
  v_item_precio numeric(12,2);
BEGIN
  SELECT org_id, rol INTO v_user_org_id, v_user_rol
  FROM public.usuarios
  WHERE id = v_user_id;

  IF v_user_org_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado o no tiene org_id';
  END IF;

  v_vendedor_id := (NULLIF(TRIM(payload->>'vendedor_id'), ''))::uuid;
  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'El vendedor_id es requerido';
  END IF;

  IF v_user_rol = 'vendedor' THEN
    IF v_vendedor_id != v_user_id THEN
      RAISE EXCEPTION 'Un vendedor solo puede crear ventas para sí mismo';
    END IF;
  ELSIF v_user_rol = 'distribuidor' THEN
    IF v_vendedor_id != v_user_id AND NOT public.is_distribuidor_of(v_vendedor_id) THEN
      RAISE EXCEPTION 'No autorizado para asignar a este vendedor';
    END IF;
  ELSIF v_user_rol = 'admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_vendedor_id AND org_id = v_user_org_id) THEN
      RAISE EXCEPTION 'Vendedor no válido para esta organización';
    END IF;
  ELSE
    RAISE EXCEPTION 'Su rol no tiene permisos para crear ventas';
  END IF;

  v_owner_type := NULLIF(TRIM(payload->>'owner_type'), '');

  v_tipo_movimiento := (NULLIF(TRIM(payload->>'tipo_movimiento'), ''))::public.venta_tipo_movimiento;
  IF v_tipo_movimiento IS NULL THEN
    RAISE EXCEPTION 'tipo_movimiento es requerido';
  END IF;

  v_subtotal := COALESCE((NULLIF(TRIM(payload->>'subtotal'), ''))::numeric, 0);
  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'El subtotal (SALES PRICE) debe ser mayor a 0';
  END IF;

  v_impuesto    := COALESCE((NULLIF(TRIM(payload->>'impuesto'),    ''))::numeric, 0);
  v_cargo_envio := COALESCE((NULLIF(TRIM(payload->>'cargo_envio'), ''))::numeric, 0);
  v_descuento   := COALESCE((NULLIF(TRIM(payload->>'descuento'),   ''))::numeric, 0);
  v_pago_inicial := COALESCE((NULLIF(TRIM(payload->>'pago_inicial'),''))::numeric, 0);

  IF v_impuesto < 0 THEN
    RAISE EXCEPTION 'El impuesto no puede ser negativo';
  END IF;
  IF v_cargo_envio < 0 THEN
    RAISE EXCEPTION 'El cargo de envío no puede ser negativo';
  END IF;
  IF v_descuento < 0 THEN
    RAISE EXCEPTION 'El descuento no puede ser negativo';
  END IF;
  IF v_pago_inicial < 0 THEN
    RAISE EXCEPTION 'El pago inicial no puede ser negativo';
  END IF;

  IF payload->'items' IS NULL OR jsonb_typeof(payload->'items') != 'array' OR jsonb_array_length(payload->'items') = 0 THEN
    RAISE EXCEPTION 'La venta debe contener al menos un ítem válido';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_item_cantidad := (NULLIF(TRIM(v_item->>'cantidad'), ''))::integer;
    IF v_item_cantidad IS NULL OR v_item_cantidad <= 0 THEN
      RAISE EXCEPTION 'La cantidad del ítem debe ser un entero mayor a 0';
    END IF;
    v_item_precio := COALESCE(ROUND((NULLIF(TRIM(v_item->>'precio_unitario'), ''))::numeric, 2), 0);
    IF v_item_precio < 0 THEN
      RAISE EXCEPTION 'El precio unitario del ítem no puede ser negativo';
    END IF;
  END LOOP;

  v_total           := v_subtotal + v_impuesto + v_cargo_envio - v_descuento;
  v_saldo_pendiente := v_total - v_pago_inicial;

  IF v_saldo_pendiente < 0 THEN
    RAISE EXCEPTION 'El saldo pendiente no puede ser negativo (pago inicial supera el total)';
  END IF;

  IF (NULLIF(TRIM(payload->>'total'), ''))::numeric(12,2) != v_total THEN
    RAISE EXCEPTION 'El total enviado no coincide con el cálculo interno';
  END IF;
  IF (NULLIF(TRIM(payload->>'saldo_pendiente'), ''))::numeric(12,2) != v_saldo_pendiente THEN
    RAISE EXCEPTION 'El saldo_pendiente enviado no coincide con el cálculo interno';
  END IF;

  IF v_owner_type = 'lead' THEN
    v_lead_id := (NULLIF(TRIM(payload->>'lead_id'), ''))::uuid;
    IF v_lead_id IS NULL THEN
      RAISE EXCEPTION 'El lead_id es requerido';
    END IF;

    SELECT * INTO v_lead_row
    FROM public.leads
    WHERE id = v_lead_id AND org_id = v_user_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Prospecto no encontrado o no pertenece a su organización';
    END IF;

    IF v_lead_row.estado_pipeline::text = 'cierre'
       OR lower(coalesce(v_lead_row.next_action, '')) = 'convertido' THEN
      RAISE EXCEPTION 'El prospecto ya se encuentra cerrado o convertido';
    END IF;

    IF NULLIF(TRIM(payload->>'numero_cuenta_financiera'), '') IS NULL THEN
      RAISE EXCEPTION 'Se requiere un número de cuenta para crear el cliente desde prospecto';
    END IF;

    INSERT INTO public.clientes (
      org_id, nombre, apellido, email, telefono,
      numero_cuenta_financiera, vendedor_id, activo
    ) VALUES (
      v_user_org_id, v_lead_row.nombre, v_lead_row.apellido, v_lead_row.email, v_lead_row.telefono,
      TRIM(payload->>'numero_cuenta_financiera'), v_vendedor_id, true
    ) RETURNING id INTO v_cliente_id;

    UPDATE public.leads
    SET estado_pipeline = 'cierre', next_action = 'Convertido'
    WHERE id = v_lead_id;

  ELSIF v_owner_type = 'cliente' THEN
    v_cliente_id := (NULLIF(TRIM(payload->>'cliente_id'), ''))::uuid;
    IF v_cliente_id IS NULL THEN
      RAISE EXCEPTION 'El cliente_id es requerido';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = v_cliente_id AND org_id = v_user_org_id) THEN
      RAISE EXCEPTION 'Cliente no válido';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de owner_type (%) inválido. Debe ser lead o cliente', v_owner_type;
  END IF;

  INSERT INTO public.ventas (
    org_id, numero_nota_pedido, cliente_id, vendedor_id, tipo_movimiento,
    fecha_venta, estado, subtotal, impuesto, cargo_envio, descuento,
    total, pago_inicial, saldo_pendiente, notas
  ) VALUES (
    v_user_org_id,
    NULLIF(TRIM(payload->>'numero_nota_pedido'), ''),
    v_cliente_id,
    v_vendedor_id,
    v_tipo_movimiento,
    (NULLIF(TRIM(payload->>'fecha_venta'), ''))::date,
    NULLIF(TRIM(payload->>'estado'), ''),
    v_subtotal, v_impuesto, v_cargo_envio, v_descuento,
    v_total, v_pago_inicial, v_saldo_pendiente,
    NULLIF(TRIM(payload->>'notas'), '')
  ) RETURNING id INTO v_venta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    INSERT INTO public.venta_items (
      org_id, venta_id, linea, producto_id, codigo_articulo, descripcion, cantidad, precio_unitario
    ) VALUES (
      v_user_org_id,
      v_venta_id,
      (NULLIF(TRIM(v_item->>'linea'), ''))::integer,
      (NULLIF(TRIM(v_item->>'producto_id'), ''))::uuid,
      NULLIF(TRIM(v_item->>'codigo'), ''),
      NULLIF(TRIM(v_item->>'descripcion'), ''),
      (NULLIF(TRIM(v_item->>'cantidad'), ''))::integer,
      COALESCE(ROUND((NULLIF(TRIM(v_item->>'precio_unitario'), ''))::numeric, 2), 0)
    );
    v_items_count := v_items_count + 1;
  END LOOP;

  v_saldo_acumulado := v_saldo_acumulado + v_subtotal;
  INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
  VALUES (v_user_org_id, v_venta_id, 'SALES PRICE', v_subtotal, v_saldo_acumulado);
  v_transacciones_count := v_transacciones_count + 1;

  IF v_impuesto > 0 THEN
    v_saldo_acumulado := v_saldo_acumulado + v_impuesto;
    INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
    VALUES (v_user_org_id, v_venta_id, 'SALES TAX CHARGE', v_impuesto, v_saldo_acumulado);
    v_transacciones_count := v_transacciones_count + 1;
  END IF;

  IF v_cargo_envio > 0 THEN
    v_saldo_acumulado := v_saldo_acumulado + v_cargo_envio;
    INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
    VALUES (v_user_org_id, v_venta_id, 'SHIPPING / HANDLING', v_cargo_envio, v_saldo_acumulado);
    v_transacciones_count := v_transacciones_count + 1;
  END IF;

  IF v_descuento > 0 THEN
    v_saldo_acumulado := v_saldo_acumulado - v_descuento;
    INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
    VALUES (v_user_org_id, v_venta_id, 'DISCOUNT', -v_descuento, v_saldo_acumulado);
    v_transacciones_count := v_transacciones_count + 1;
  END IF;

  IF v_pago_inicial > 0 THEN
    v_saldo_acumulado := v_saldo_acumulado - v_pago_inicial;
    INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
    VALUES (v_user_org_id, v_venta_id, 'CONSUMER DOWN PAYMENT', -v_pago_inicial, v_saldo_acumulado);
    v_transacciones_count := v_transacciones_count + 1;
  END IF;

  IF v_saldo_acumulado != v_saldo_pendiente THEN
    RAISE EXCEPTION 'Discrepancia financiera: saldo acumulado (%) != saldo_pendiente (%)', v_saldo_acumulado, v_saldo_pendiente;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'venta_id', v_venta_id,
    'cliente_id', v_cliente_id,
    'lead_id', v_lead_id,
    'total', v_total,
    'saldo_pendiente', v_saldo_pendiente,
    'items_count', v_items_count,
    'transacciones_count', v_transacciones_count
  );
END;
$$;


ALTER FUNCTION "public"."fn_crear_venta_completa"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cv_resumen_generar"("p_case_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date" DEFAULT NULL::"date", "p_generated_by" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."fn_cv_resumen_generar"("p_case_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_generated_by" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cv_resumen_generar"("p_case_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_generated_by" "uuid") IS 'v2: guard rol (admin/distribuidor/supervisor_telemercadeo). fecha_corte = LEAST(periodo_fin, hoy). Filtra cob_pagos por cargo_vuelta_case_id (no case_id). proximo_pago: (1) cob_plan_cuotas, (2) cob_acuerdos_pago_automatico, (3) NULL. Genera snapshot draft; rechaza casos con revolving activo.';



CREATE OR REPLACE FUNCTION "public"."fn_devengar_interes_revolving"("p_account_id" "uuid", "p_accrual_date" "date" DEFAULT CURRENT_DATE, "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_actor_id              uuid;
  v_actor_org_id          uuid;
  v_account               record;
  v_accrual_from          date;
  v_days                  integer;
  v_interest              numeric(12,2);
  v_new_saldo_interes     numeric(12,2);
  v_new_saldo_total       numeric(12,2);
  v_ledger_id             uuid;
  v_now                   timestamptz := now();
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id
    into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  if p_accrual_date is null then
    raise exception 'INVALID_ACCRUAL_DATE: p_accrual_date no puede ser null';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_account_id::text));

  select a.*
    into v_account
  from public.cob_revolving_accounts a
  where a.id     = p_account_id
    and a.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND_OR_FORBIDDEN: cuenta % no existe o no pertenece a la organización', p_account_id;
  end if;

  if coalesce(v_account.saldo_principal_actual, 0) <= 0 then
    return null;
  end if;

  if coalesce(v_account.apr_anual, 0) <= 0 then
    return null;
  end if;

  if v_account.fecha_ultimo_devengo >= p_accrual_date then
    return null;
  end if;

  v_accrual_from := v_account.fecha_ultimo_devengo;
  v_days         := p_accrual_date - v_accrual_from;

  if v_days <= 0 then
    return null;
  end if;

  v_interest := round(
    (v_account.saldo_principal_actual::numeric
     * v_account.apr_anual::numeric
     / 365
     * v_days)::numeric,
    2
  );

  if v_interest <= 0 then
    update public.cob_revolving_accounts
       set fecha_ultimo_devengo = p_accrual_date,
           updated_at           = v_now
     where id     = p_account_id
       and org_id = v_actor_org_id;
    return null;
  end if;

  v_new_saldo_interes := round(v_account.saldo_interes_actual::numeric + v_interest, 2);

  v_new_saldo_total := round(
    v_account.saldo_principal_actual::numeric
    + v_new_saldo_interes
    + v_account.saldo_fees_actual::numeric,
    2
  );

  insert into public.cob_financial_ledger (
    org_id,
    revolving_account_id,
    case_id,
    cliente_id,
    entry_date,
    effective_date,
    entry_type,
    component_type,
    debit_credit,
    amount,
    description,
    accrual_from,
    accrual_to,
    balance_principal_after,
    balance_interest_after,
    balance_fees_after,
    balance_total_after,
    metadata,
    created_by,
    created_at
  )
  values (
    v_actor_org_id,
    p_account_id,
    v_account.case_id,
    v_account.cliente_id,
    current_date,
    p_accrual_date,
    'finance_charge_accrual',
    'interest',
    'debit',
    v_interest,
    coalesce(
      p_notes,
      'Devengo de interés DFP Revolving: '
        || v_accrual_from::text || ' → ' || p_accrual_date::text
        || ' (' || v_days::text || ' día(s))'
        || ' @ APR ' || (v_account.apr_anual * 100)::numeric(5,2)::text || '%'
    ),
    v_accrual_from,
    p_accrual_date,
    round(v_account.saldo_principal_actual::numeric, 2),
    v_new_saldo_interes,
    round(v_account.saldo_fees_actual::numeric, 2),
    v_new_saldo_total,
    jsonb_build_object(
      'apr_anual',       v_account.apr_anual,
      'dias_devengados', v_days,
      'accrual_from',    v_accrual_from,
      'accrual_to',      p_accrual_date,
      'principal_base',  v_account.saldo_principal_actual
    ),
    v_actor_id,
    v_now
  )
  returning id into v_ledger_id;

  update public.cob_revolving_accounts
     set saldo_interes_actual  = v_new_saldo_interes,
         fecha_ultimo_devengo  = p_accrual_date,
         updated_at            = v_now
   where id     = p_account_id
     and org_id = v_actor_org_id;

  return v_ledger_id;
end;
$$;


ALTER FUNCTION "public"."fn_devengar_interes_revolving"("p_account_id" "uuid", "p_accrual_date" "date", "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_devengar_interes_revolving"("p_account_id" "uuid", "p_accrual_date" "date", "p_notes" "text") IS 'Devenga interés interno de una cuenta revolving DFP. Calcula días desde fecha_ultimo_devengo hasta p_accrual_date. Fórmula: principal × apr_anual / 365 × días (APR en decimal, 0.18 = 18%). Persiste interés redondeado a 2 decimales en ledger finance_charge_accrual. Actualiza saldo_interes_actual y fecha_ultimo_devengo. Retorna null cuando no hay devengo aplicable (principal=0, APR=0, ya devengado, resultado=0).';



CREATE OR REPLACE FUNCTION "public"."fn_dispatch_campaign"("p_campaign_id" "uuid", "p_interval_ms" integer DEFAULT 1100) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_msg record;
  v_outbox_id uuid;
  v_count integer := 0;
begin
  perform 1 from public.mk_campaigns where id = p_campaign_id;
  if not found then
    return jsonb_build_object('error', 'campaign_not_found');
  end if;

  for v_msg in
    select id, canal, telefono, mensaje_texto, owner_id, contacto_tipo, contacto_id
    from public.mk_messages
    where campaign_id = p_campaign_id
      and status = 'pendiente'
      and outbox_message_id is null
      and telefono is not null
      and mensaje_texto is not null
    order by orden nulls last, created_at
  loop
    insert into public.outbox_messages (
      canal, destinatario, mensaje,
      scheduled_for, status, contexto_tipo,
      owner_id, contact_tipo, contact_id,
      dispatch_provider
    )
    values (
      v_msg.canal,
      v_msg.telefono,
      v_msg.mensaje_texto,
      now() + (v_count * p_interval_ms * interval '1 millisecond'),
      'programado',
      'campaign',
      v_msg.owner_id,
      v_msg.contacto_tipo,
      v_msg.contacto_id,
      'n8n'
    )
    returning id into v_outbox_id;

    update public.mk_messages
       set outbox_message_id = v_outbox_id,
           status = 'programado'
     where id = v_msg.id;

    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    update public.mk_campaigns
       set estado = 'activa',
           dispatched_at = now()
     where id = p_campaign_id;
  end if;

  return jsonb_build_object('dispatched', v_count, 'campaign_id', p_campaign_id);
end;
$$;


ALTER FUNCTION "public"."fn_dispatch_campaign"("p_campaign_id" "uuid", "p_interval_ms" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_dispatch_campaign"("p_campaign_id" "uuid", "p_interval_ms" integer) IS 'Despacha mk_messages pendientes de una campaña hacia outbox_messages con dispatch_provider=n8n.';



CREATE OR REPLACE FUNCTION "public"."fn_get_cargo_vuelta_campaign_targets"("p_org_id" "uuid", "p_today" "date" DEFAULT CURRENT_DATE, "p_max_auto_attempts" integer DEFAULT 7, "p_recent_payment_days" integer DEFAULT 7, "p_daily_cooldown_hours" integer DEFAULT 20, "p_mock" boolean DEFAULT true) RETURNS TABLE("case_id" "uuid", "org_id" "uuid", "cliente_id" "uuid", "owner_id" "uuid", "nombre" "text", "apellido" "text", "email" "text", "telefono" "text", "telefono_casa" "text", "fecha_cargo_vuelta" "date", "monto_cargo_vuelta" numeric, "dias_vencido" integer, "estado" "text", "cuenta_hycite" "text", "auto_attempt_count" integer, "last_message_at" timestamp with time zone, "days_since_case_opened" integer, "cadence_step" "text", "should_send_email" boolean, "should_send_whatsapp" boolean, "mock" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with case_base as (
    select
      cv.id as case_id,
      cv.org_id,
      cv.cliente_id,
      cv.fecha_apertura,
      cv.fecha_cargo_vuelta,
      cv.monto_devuelto,
      cv.dias_vencido,
      cv.estado,
      cv.acuerdo_tipo,
      cv.numero_cuenta_hycite,
      cv.numero_orden_hycite,
      c.nombre,
      c.apellido,
      c.email,
      c.telefono,
      c.telefono_casa,
      c.hycite_id,
      c.whatsapp_no_molestar,
      c.whatsapp_opt_in,
      c.whatsapp_ultimo_envio_at
    from public.cargo_vuelta_cases cv
    join public.clientes c
      on c.id = cv.cliente_id
     and c.org_id = cv.org_id
    where cv.org_id = p_org_id
      and cv.estado not in ('Cerrado', 'En Negociación', 'Acuerdo')
      and coalesce(cv.monto_devuelto, 0) > 0
      and (
        nullif(trim(coalesce(c.email, '')), '') is not null
        or nullif(trim(coalesce(c.telefono, c.telefono_casa, '')), '') is not null
      )
      and (
        cv.acuerdo_tipo is null
        or trim(cv.acuerdo_tipo) = ''
        or lower(trim(cv.acuerdo_tipo)) in ('ninguno', 'none', 'cancelado', 'cerrado')
      )
      and coalesce(c.whatsapp_no_molestar, false) = false
  ),
  message_stats as (
    select
      cb.case_id,
      count(om.id)::int as auto_attempt_count,
      max(coalesce(om.sent_at, om.created_at)) as last_message_at
    from case_base cb
    left join public.outbox_messages om
      on om.contact_tipo = 'cliente'
     and om.contact_id = cb.cliente_id
     and om.org_id = cb.org_id::text
     and om.contexto_tipo = 'cobranza'
     and om.canal in ('email', 'whatsapp', 'sms')
     and om.status in ('programado', 'en_proceso', 'enviado', 'retry_pending')
     and (
       om.dispatch_provider in ('n8n', 'n8n_mock')
       or om.provider in ('resend_mock', 'evolution_mock', 'whatsapp_cloud_mock', 'resend')
       or coalesce(om.asunto, '') ilike '%revision de cuenta royal prestige%'
       or coalesce(om.mensaje_resuelto, om.mensaje, '') ilike '%royal prestige / hy-cite%'
       or coalesce(om.mensaje_resuelto, om.mensaje, '') ilike '%cargo de vuelta%'
       or coalesce(om.mensaje_resuelto, om.mensaje, '') ilike '%dfp%'
     )
    group by cb.case_id
  ),
  eligible as (
    select
      cb.*,
      coalesce(ms.auto_attempt_count, 0) as auto_attempt_count,
      ms.last_message_at,
      greatest((p_today - cb.fecha_apertura::date), 0)::int as days_since_case_opened,
      case
        when coalesce(ms.auto_attempt_count, 0) = 0 then 'formal_amable'
        when coalesce(ms.auto_attempt_count, 0) = 1 then 'recordatorio_corto'
        when coalesce(ms.auto_attempt_count, 0) = 2 then 'revision_interna'
        when coalesce(ms.auto_attempt_count, 0) >= 3 then 'ultimo_aviso_legal'
        else null
      end as cadence_step
    from case_base cb
    left join message_stats ms
      on ms.case_id = cb.case_id
    where coalesce(ms.auto_attempt_count, 0) < p_max_auto_attempts
      and (
        ms.last_message_at is null
        or ms.last_message_at <= (
          ((p_today::timestamp + localtime) at time zone current_setting('timezone'))
          - make_interval(hours => p_daily_cooldown_hours)
        )
      )
      and not exists (
        select 1
        from public.cob_ptps ptp
        where ptp.org_id = cb.org_id
          and ptp.cliente_id = cb.cliente_id
          and (ptp.case_id = cb.case_id or ptp.case_id is null)
          and ptp.estado in ('pendiente')
      )
      and not exists (
        select 1
        from public.cob_plan_pagos plan
        where plan.org_id = cb.org_id
          and plan.cliente_id = cb.cliente_id
          and (plan.case_id = cb.case_id or plan.case_id is null)
          and plan.estado = 'activo'
      )
      and not exists (
        select 1
        from public.cob_pagos pago
        where pago.org_id = cb.org_id
          and pago.cliente_id = cb.cliente_id
          and (pago.cargo_vuelta_case_id = cb.case_id or pago.cargo_vuelta_case_id is null)
          and pago.fecha_pago >= (p_today - p_recent_payment_days)
      )
  )
  select
    e.case_id,
    e.org_id,
    e.cliente_id,
    null::uuid as owner_id,
    e.nombre,
    e.apellido,
    nullif(trim(coalesce(e.email, '')), '') as email,
    nullif(trim(coalesce(e.telefono, e.telefono_casa, '')), '') as telefono,
    e.telefono_casa,
    e.fecha_cargo_vuelta,
    e.monto_devuelto as monto_cargo_vuelta,
    e.dias_vencido,
    e.estado,
    coalesce(
      nullif(trim(coalesce(e.numero_cuenta_hycite, '')), ''),
      nullif(trim(coalesce(e.hycite_id, '')), ''),
      nullif(trim(coalesce(e.numero_orden_hycite, '')), '')
    ) as cuenta_hycite,
    e.auto_attempt_count,
    e.last_message_at,
    e.days_since_case_opened,
    e.cadence_step,
    nullif(trim(coalesce(e.email, '')), '') is not null as should_send_email,
    (
      nullif(trim(coalesce(e.telefono, e.telefono_casa, '')), '') is not null
      and coalesce(e.whatsapp_no_molestar, false) = false
    ) as should_send_whatsapp,
    p_mock as mock
  from eligible e
  where e.cadence_step is not null
    and (
      nullif(trim(coalesce(e.email, '')), '') is not null
      or (
        nullif(trim(coalesce(e.telefono, e.telefono_casa, '')), '') is not null
        and coalesce(e.whatsapp_no_molestar, false) = false
      )
    )
  order by e.days_since_case_opened desc, e.monto_devuelto desc, e.case_id;
$$;


ALTER FUNCTION "public"."fn_get_cargo_vuelta_campaign_targets"("p_org_id" "uuid", "p_today" "date", "p_max_auto_attempts" integer, "p_recent_payment_days" integer, "p_daily_cooldown_hours" integer, "p_mock" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_get_cargo_vuelta_campaign_targets"("p_org_id" "uuid", "p_today" "date", "p_max_auto_attempts" integer, "p_recent_payment_days" integer, "p_daily_cooldown_hours" integer, "p_mock" boolean) IS 'Selecciona casos Cargo de Vuelta / DFP elegibles para campana automatica n8n. Read-only: no inserta, no toca ledger, no registra pagos.';



CREATE OR REPLACE FUNCTION "public"."fn_import_izzy_leads_from_flow_royal_prestige_clientes"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
declare
  v_has_fecha boolean;
  v_has_agente boolean;
  v_has_cliente boolean;
  v_has_telefono boolean;
  v_has_direccion boolean;
  v_has_nota boolean;
  v_has_correo_cliente boolean;
  v_has_origen boolean;
  v_has_estado boolean;
  v_has_lead_status_code boolean;
  v_has_do_not_call boolean;
  v_insert_columns text[] := array[]::text[];
  v_select_columns text[] := array[]::text[];
  v_sql text;
  v_inserted_count integer := 0;
  v_pending_before integer := 0;
  v_pending_after integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('import_flow_royal_prestige_to_izzy_leads'));

  if to_regclass('public.clientes') is null then
    raise exception 'public.clientes does not exist';
  end if;

  if to_regclass('public.izzy_leads') is null then
    raise exception 'public.izzy_leads does not exist';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'fecha'
  ) into v_has_fecha;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'agente'
  ) into v_has_agente;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'cliente'
  ) into v_has_cliente;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'telefono'
  ) into v_has_telefono;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'direccion'
  ) into v_has_direccion;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'nota'
  ) into v_has_nota;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'correo_cliente'
  ) into v_has_correo_cliente;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'origen'
  ) into v_has_origen;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'estado'
  ) into v_has_estado;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'lead_status_code'
  ) into v_has_lead_status_code;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'izzy_leads' and column_name = 'do_not_call'
  ) into v_has_do_not_call;

  if not (v_has_fecha and v_has_agente and v_has_cliente and v_has_telefono and v_has_direccion and v_has_nota) then
    raise exception 'public.izzy_leads is missing one of the required base columns: fecha, agente, cliente, telefono, direccion, nota';
  end if;

  select count(*)
  into v_pending_before
  from public.v_izzy_flow_rp_clientes_import_eligible e
  where e.ya_existe_en_izzy = false;

  v_insert_columns := array_append(v_insert_columns, 'fecha');
  v_select_columns := array_append(v_select_columns, 'to_char(now() at time zone ''America/Los_Angeles'', ''MM/DD/YYYY'')');

  v_insert_columns := array_append(v_insert_columns, 'agente');
  v_select_columns := array_append(v_select_columns, '''IMPORTACION FLOW ROYAL PRESTIGE''');

  v_insert_columns := array_append(v_insert_columns, 'cliente');
  v_select_columns := array_append(v_select_columns, 'e.cliente');

  v_insert_columns := array_append(v_insert_columns, 'telefono');
  v_select_columns := array_append(v_select_columns, 'e.telefono');

  v_insert_columns := array_append(v_insert_columns, 'direccion');
  v_select_columns := array_append(v_select_columns, 'e.direccion');

  v_insert_columns := array_append(v_insert_columns, 'nota');
  v_select_columns := array_append(v_select_columns, '''Cliente anterior Royal Prestige importado desde Flow para campana de reactivacion.''');

  if v_has_correo_cliente then
    v_insert_columns := array_append(v_insert_columns, 'correo_cliente');
    v_select_columns := array_append(v_select_columns, 'e.correo_cliente');
  end if;

  if v_has_origen then
    v_insert_columns := array_append(v_insert_columns, 'origen');
    v_select_columns := array_append(v_select_columns, '''flow_royal_prestige_cliente''');
  end if;

  if v_has_estado then
    v_insert_columns := array_append(v_insert_columns, 'estado');
    v_select_columns := array_append(v_select_columns, '''Nuevo''');
  end if;

  if v_has_lead_status_code then
    v_insert_columns := array_append(v_insert_columns, 'lead_status_code');
    v_select_columns := array_append(v_select_columns, '''new''');
  end if;

  if v_has_do_not_call then
    v_insert_columns := array_append(v_insert_columns, 'do_not_call');
    v_select_columns := array_append(v_select_columns, 'false');
  end if;

  v_sql := format(
    'insert into public.izzy_leads (%1$s)
     select %2$s
     from public.v_izzy_flow_rp_clientes_import_eligible e
     where e.ya_existe_en_izzy = false
       and e.telefono_normalizado is not null
       and not exists (
         select 1
         from public.izzy_leads l
         where nullif(regexp_replace(coalesce(l.telefono, ''''), ''\D'', '''', ''g''), '''') = e.telefono_normalizado
       )',
    array_to_string(v_insert_columns, ', '),
    array_to_string(v_select_columns, ', ')
  );

  execute v_sql;
  get diagnostics v_inserted_count = row_count;

  select count(*)
  into v_pending_after
  from public.v_izzy_flow_rp_clientes_import_eligible e
  where e.ya_existe_en_izzy = false;

  return jsonb_build_object(
    'inserted', v_inserted_count,
    'pending_before', v_pending_before,
    'pending_after', v_pending_after,
    'summary_view', 'public.v_izzy_flow_rp_clientes_import_summary',
    'eligible_view', 'public.v_izzy_flow_rp_clientes_import_eligible'
  );
end;
$_$;


ALTER FUNCTION "public"."fn_import_izzy_leads_from_flow_royal_prestige_clientes"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_import_izzy_leads_from_flow_royal_prestige_clientes"() IS 'Importa clientes elegibles de public.clientes a public.izzy_leads para campanas de reactivacion Izzy, evitando duplicados por telefono normalizado.';



CREATE OR REPLACE FUNCTION "public"."fn_leads_sync_referidor_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if NEW.referidor_id is not null then
    -- ── Código nuevo → sincronizar hacia legacy ──────────────
    if NEW.referidor_tipo = 'embajador' then
      NEW.embajador_id            := NEW.referidor_id;
      NEW.referido_por_cliente_id := null;
    elsif NEW.referidor_tipo = 'cliente' then
      NEW.referido_por_cliente_id := NEW.referidor_id;
      NEW.embajador_id            := null;
    elsif NEW.referidor_tipo = 'lead' then
      -- Sin campo legacy para leads: limpiar ambos para consistencia
      NEW.embajador_id            := null;
      NEW.referido_por_cliente_id := null;
    end if;

  else
    -- ── Código legacy → sincronizar hacia canónico ───────────
    if NEW.embajador_id is not null then
      NEW.referidor_tipo          := 'embajador';
      NEW.referidor_id            := NEW.embajador_id;
      NEW.referido_por_cliente_id := null;   -- prevenir dualidad
    elsif NEW.referido_por_cliente_id is not null then
      NEW.referidor_tipo          := 'cliente';
      NEW.referidor_id            := NEW.referido_por_cliente_id;
      NEW.embajador_id            := null;   -- prevenir dualidad
    end if;
    -- Si ambos legacy son null: dejar canónico null (ya lo es)
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."fn_leads_sync_referidor_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_leads_sync_referidor_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_new_changed    boolean;
  v_legacy_changed boolean;
begin
  v_new_changed := (
    NEW.referidor_tipo is distinct from OLD.referidor_tipo or
    NEW.referidor_id   is distinct from OLD.referidor_id
  );
  v_legacy_changed := (
    NEW.embajador_id            is distinct from OLD.embajador_id or
    NEW.referido_por_cliente_id is distinct from OLD.referido_por_cliente_id
  );

  -- Nada cambió en ninguno de los dos lados → no-op
  if not v_new_changed and not v_legacy_changed then
    return NEW;
  end if;

  if v_new_changed then
    -- ── Canónico → legacy (nuevo gana, incluso si ambos cambiaron) ──
    if NEW.referidor_tipo = 'embajador' and NEW.referidor_id is not null then
      NEW.embajador_id            := NEW.referidor_id;
      NEW.referido_por_cliente_id := null;
    elsif NEW.referidor_tipo = 'cliente' and NEW.referidor_id is not null then
      NEW.referido_por_cliente_id := NEW.referidor_id;
      NEW.embajador_id            := null;
    elsif NEW.referidor_tipo = 'lead' and NEW.referidor_id is not null then
      -- Sin campo legacy para lead
      NEW.embajador_id            := null;
      NEW.referido_por_cliente_id := null;
    elsif NEW.referidor_tipo is null or NEW.referidor_id is null then
      -- Se limpió el lado canónico → limpiar legacy también
      NEW.embajador_id            := null;
      NEW.referido_por_cliente_id := null;
    end if;

  else
    -- ── Legacy → canónico (solo legacy cambió) ──────────────────
    if NEW.embajador_id is not null then
      NEW.referidor_tipo          := 'embajador';
      NEW.referidor_id            := NEW.embajador_id;
      NEW.referido_por_cliente_id := null;   -- limpiar otro campo legacy
    elsif NEW.referido_por_cliente_id is not null then
      NEW.referidor_tipo          := 'cliente';
      NEW.referidor_id            := NEW.referido_por_cliente_id;
      NEW.embajador_id            := null;   -- limpiar otro campo legacy
    else
      -- Ambos campos legacy vaciados → limpiar canónico
      NEW.referidor_tipo := null;
      NEW.referidor_id   := null;
    end if;
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."fn_leads_sync_referidor_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_log_outbox_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Solo creamos la actividad si el mensaje se marcó como enviado
    -- y no se había registrado previamente como tal.
    IF (NEW.status = 'enviado' AND (OLD.status IS NULL OR OLD.status != 'enviado')) THEN
        INSERT INTO public.contacto_actividades (
            contacto_tipo,
            contacto_id,
            tipo,
            resumen,
            contenido,
            autor_id,
            fecha_actividad,
            metadata
        ) VALUES (
            NEW.contact_tipo,
            NEW.contact_id,
            NEW.canal,
            'Mensaje enviado: ' || COALESCE(NEW.asunto, SUBSTRING(NEW.mensaje FROM 1 FOR 30) || '...'),
            NEW.mensaje_resuelto,
            NEW.owner_id,
            COALESCE(NEW.sent_at, NOW()),
            jsonb_build_object(
                'outbox_id', NEW.id,
                'canal', NEW.canal,
                'destinatario', NEW.destinatario,
                'attachment_count', ARRAY_LENGTH(NEW.attachment_urls, 1)
            )
        );
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_log_outbox_activity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_log_outbox_activity"() IS 'Registra automáticamente los mensajes enviados en el historial de actividades del contacto.';



CREATE OR REPLACE FUNCTION "public"."fn_outbox_log_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF (new.status IN ('enviado', 'programado')
      AND new.contact_tipo IS NOT NULL
      AND new.contact_id IS NOT NULL
      AND new.owner_id IS NOT NULL) THEN
    INSERT INTO public.contacto_actividades (
      contacto_tipo, contacto_id, tipo, resumen, contenido, metadata, autor_id, fecha_actividad
    ) VALUES (
      new.contact_tipo,
      new.contact_id,
      new.canal,
      CASE
        WHEN new.canal = 'email'    THEN 'Email enviado: ' || COALESCE(new.asunto, '(sin asunto)')
        WHEN new.canal = 'whatsapp' THEN 'WhatsApp enviado'
        ELSE initcap(new.canal) || ' enviado'
      END,
      new.mensaje_resuelto,
      jsonb_build_object(
        'outbox_id',        new.id,
        'canal',            new.canal,
        'destinatario',     new.destinatario,
        'attachment_count', array_length(new.attachment_urls, 1)
      ),
      new.owner_id,
      COALESCE(new.sent_at, new.created_at, now())
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_outbox_log_activity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_outbox_log_activity"() IS 'Logs outbox sends to contacto_actividades timeline. Skipped when owner_id is null (automated/n8n sends).';



CREATE OR REPLACE FUNCTION "public"."fn_proteger_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  caller_rol TEXT;
BEGIN
  IF (OLD.rol IS DISTINCT FROM NEW.rol) THEN

    -- Permitir desde SQL Editor / service role (auth.uid() es null)
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT rol::TEXT INTO caller_rol
    FROM public.usuarios
    WHERE id = auth.uid();

    IF caller_rol NOT IN ('admin', 'distribuidor') THEN
      RAISE EXCEPTION 'Operacion denegada: Solo un Administrador o Distribuidor puede modificar los roles del sistema.';
    END IF;

  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_proteger_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_registrar_pago"("p_org_id" "uuid", "p_cliente_id" "uuid", "p_case_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_metodo_pago" "text" DEFAULT NULL::"text", "p_referencia" "text" DEFAULT NULL::"text", "p_notas" "text" DEFAULT NULL::"text", "p_ptp_id" "uuid" DEFAULT NULL::"uuid", "p_cuota_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_user_org_id uuid;
  v_pago_id uuid;
  v_cuota_count integer := 0;
  v_updated_cuotas integer := 0;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select u.org_id
  into v_user_org_id
  from public.usuarios u
  where u.id = v_user_id
  limit 1;

  if v_user_org_id is null then
    raise exception 'Usuario sin org_id en public.usuarios';
  end if;

  if p_org_id is distinct from v_user_org_id then
    raise exception 'org_id invalido para el usuario actual';
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

  if not exists (
    select 1
    from public.clientes c
    where c.id = p_cliente_id
      and c.org_id = p_org_id
  ) then
    raise exception 'Cliente invalido para la organizacion';
  end if;

  if p_case_id is not null and not exists (
    select 1
    from public.cargo_vuelta_cases cv
    where cv.id = p_case_id
      and cv.org_id = p_org_id
      and cv.cliente_id = p_cliente_id
  ) then
    raise exception 'Caso invalido para el cliente y organizacion';
  end if;

  if p_ptp_id is not null and not exists (
    select 1
    from public.cob_ptps ptp
    where ptp.id = p_ptp_id
      and ptp.org_id = p_org_id
      and ptp.cliente_id = p_cliente_id
      and (p_case_id is null or ptp.case_id = p_case_id)
  ) then
    raise exception 'PTP invalido para el pago actual';
  end if;

  if p_cuota_ids is not null then
    select coalesce(array_length(p_cuota_ids, 1), 0)
    into v_cuota_count;

    if exists (
      select 1
      from public.cob_plan_cuotas cpc
      join public.cob_plan_pagos cpp on cpp.id = cpc.plan_id
      where cpc.id = any(p_cuota_ids)
        and (
          cpc.org_id <> p_org_id
          or cpp.cliente_id <> p_cliente_id
          or (p_case_id is not null and cpp.case_id is distinct from p_case_id)
          or cpc.estado not in ('pendiente', 'vencida')
          or cpc.pago_id is not null
        )
    ) then
      raise exception 'Una o mas cuotas no son validas para este pago';
    end if;

    if v_cuota_count > 0 and (
      select count(*)
      from public.cob_plan_cuotas cpc
      where cpc.id = any(p_cuota_ids)
    ) <> v_cuota_count then
      raise exception 'Una o mas cuotas seleccionadas no existen';
    end if;
  end if;

  insert into public.cob_pagos (
    org_id,
    cliente_id,
    case_id,
    ptp_id,
    monto,
    fecha_pago,
    metodo_pago,
    referencia,
    notas,
    creado_por
  ) values (
    p_org_id,
    p_cliente_id,
    p_case_id,
    p_ptp_id,
    p_monto,
    p_fecha_pago,
    p_metodo_pago,
    p_referencia,
    p_notas,
    v_user_id
  )
  returning id into v_pago_id;

  if p_ptp_id is not null then
    update public.cob_ptps
    set
      estado = 'cumplido',
      fecha_cumplimiento = p_fecha_pago,
      updated_by = v_user_id,
      updated_at = now()
    where id = p_ptp_id;
  end if;

  if p_cuota_ids is not null and v_cuota_count > 0 then
    update public.cob_plan_cuotas
    set
      pago_id = v_pago_id,
      estado = 'pagada',
      fecha_pago = p_fecha_pago,
      updated_at = now()
    where id = any(p_cuota_ids);

    get diagnostics v_updated_cuotas = row_count;

    if v_updated_cuotas <> v_cuota_count then
      raise exception 'No se pudieron actualizar todas las cuotas seleccionadas';
    end if;
  end if;

  return v_pago_id;
end;
$$;


ALTER FUNCTION "public"."fn_registrar_pago"("p_org_id" "uuid", "p_cliente_id" "uuid", "p_case_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_metodo_pago" "text", "p_referencia" "text", "p_notas" "text", "p_ptp_id" "uuid", "p_cuota_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_registrar_pago"("p_org_id" "uuid", "p_cliente_id" "uuid", "p_case_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_metodo_pago" "text", "p_referencia" "text", "p_notas" "text", "p_ptp_id" "uuid", "p_cuota_ids" "uuid"[]) IS 'Registra un pago de forma atomica: crea cob_pagos y actualiza opcionalmente PTP y cuotas asociadas en la misma transaccion.';



CREATE OR REPLACE FUNCTION "public"."fn_registrar_pago_revolving"("p_account_id" "uuid", "p_monto" numeric, "p_fecha" "date" DEFAULT CURRENT_DATE, "p_referencia" "text" DEFAULT NULL::"text", "p_notas" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_account      public.cob_revolving_accounts%rowtype;
  v_caller_org   uuid;
  v_batch_id     uuid    := gen_random_uuid();
  v_monto        numeric(14,2);

  v_aplicado_fees      numeric(14,2) := 0;
  v_aplicado_interes   numeric(14,2) := 0;
  v_aplicado_principal numeric(14,2) := 0;
  v_excedente          numeric(14,2) := 0;
  v_restante           numeric(14,2);

  v_bal_fees_post      numeric(14,2);
  v_bal_interes_post   numeric(14,2);
  v_bal_principal_post numeric(14,2);

  v_desc_suffix  text;
  v_estado_final text;
begin

  if p_monto is null or p_monto <= 0 then
    raise exception 'INVALID_AMOUNT: p_monto debe ser mayor a 0';
  end if;
  v_monto := round(p_monto, 2);

  select u.org_id into v_caller_org
  from public.usuarios u
  where u.id = auth.uid()
  limit 1;

  if v_caller_org is null then
    raise exception 'UNAUTHORIZED: usuario sin org_id';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_account_id::text));

  select * into v_account
  from public.cob_revolving_accounts
  where id      = p_account_id
    and org_id  = v_caller_org
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND: cuenta revolving no existe o pertenece a otra organización';
  end if;

  if v_account.estado in ('completado', 'cancelado', 'writeoff') then
    raise exception 'ACCOUNT_CLOSED: la cuenta está en estado "%" y no acepta pagos',
      v_account.estado;
  end if;

  if v_account.saldo_principal_actual = 0
     and v_account.saldo_interes_actual = 0
     and v_account.saldo_fees_actual    = 0
  then
    raise exception 'ZERO_BALANCE: la cuenta ya tiene saldo total en cero';
  end if;

  -- Waterfall estricto: fees → interest → principal
  v_restante := v_monto;

  v_aplicado_fees      := least(v_restante, v_account.saldo_fees_actual);
  v_restante           := v_restante - v_aplicado_fees;

  v_aplicado_interes   := least(v_restante, v_account.saldo_interes_actual);
  v_restante           := v_restante - v_aplicado_interes;

  v_aplicado_principal := least(v_restante, v_account.saldo_principal_actual);
  v_restante           := v_restante - v_aplicado_principal;

  v_excedente := v_restante;

  v_bal_fees_post      := v_account.saldo_fees_actual      - v_aplicado_fees;
  v_bal_interes_post   := v_account.saldo_interes_actual   - v_aplicado_interes;
  v_bal_principal_post := v_account.saldo_principal_actual - v_aplicado_principal;

  v_desc_suffix := case
    when p_referencia is not null then ' | ref: ' || p_referencia
    else ''
  end;

  -- Ledger: una fila por componente con monto > 0
  if v_aplicado_fees > 0 then
    insert into public.cob_financial_ledger (
      org_id, revolving_account_id, case_id, cliente_id,
      entry_date, effective_date,
      entry_type, component_type, debit_credit, amount,
      description,
      balance_principal_after, balance_interest_after,
      balance_fees_after,      balance_total_after,
      metadata, created_by
    ) values (
      v_account.org_id, v_account.id, v_account.case_id, v_account.cliente_id,
      current_date, p_fecha,
      'payment_applied', 'fee', 'credit', v_aplicado_fees,
      coalesce(p_notas, 'Pago — fee') || v_desc_suffix,
      v_account.saldo_principal_actual,
      v_account.saldo_interes_actual,
      v_bal_fees_post,
      v_account.saldo_principal_actual + v_account.saldo_interes_actual + v_bal_fees_post,
      jsonb_build_object('batch_id', v_batch_id, 'referencia', p_referencia, 'waterfall_step', 1, 'pago_id', null),
      auth.uid()
    );
  end if;

  if v_aplicado_interes > 0 then
    insert into public.cob_financial_ledger (
      org_id, revolving_account_id, case_id, cliente_id,
      entry_date, effective_date,
      entry_type, component_type, debit_credit, amount,
      description,
      balance_principal_after, balance_interest_after,
      balance_fees_after,      balance_total_after,
      metadata, created_by
    ) values (
      v_account.org_id, v_account.id, v_account.case_id, v_account.cliente_id,
      current_date, p_fecha,
      'payment_applied', 'interest', 'credit', v_aplicado_interes,
      coalesce(p_notas, 'Pago — interés') || v_desc_suffix,
      v_account.saldo_principal_actual,
      v_bal_interes_post,
      v_bal_fees_post,
      v_account.saldo_principal_actual + v_bal_interes_post + v_bal_fees_post,
      jsonb_build_object('batch_id', v_batch_id, 'referencia', p_referencia, 'waterfall_step', 2, 'pago_id', null),
      auth.uid()
    );
  end if;

  if v_aplicado_principal > 0 then
    insert into public.cob_financial_ledger (
      org_id, revolving_account_id, case_id, cliente_id,
      entry_date, effective_date,
      entry_type, component_type, debit_credit, amount,
      description,
      balance_principal_after, balance_interest_after,
      balance_fees_after,      balance_total_after,
      metadata, created_by
    ) values (
      v_account.org_id, v_account.id, v_account.case_id, v_account.cliente_id,
      current_date, p_fecha,
      'payment_applied', 'principal', 'credit', v_aplicado_principal,
      coalesce(p_notas, 'Pago — principal') || v_desc_suffix,
      v_bal_principal_post,
      v_bal_interes_post,
      v_bal_fees_post,
      v_bal_principal_post + v_bal_interes_post + v_bal_fees_post,
      jsonb_build_object('batch_id', v_batch_id, 'referencia', p_referencia, 'waterfall_step', 3, 'pago_id', null),
      auth.uid()
    );
  end if;

  -- Actualizar saldos — saldo_total_actual es GENERATED, no se toca
  v_estado_final := case
    when v_bal_principal_post = 0
     and v_bal_interes_post   = 0
     and v_bal_fees_post      = 0
    then 'completado'
    else v_account.estado
  end;

  update public.cob_revolving_accounts
  set
    saldo_principal_actual = v_bal_principal_post,
    saldo_interes_actual   = v_bal_interes_post,
    saldo_fees_actual      = v_bal_fees_post,
    estado                 = v_estado_final,
    updated_at             = now()
  where id = p_account_id;

  return jsonb_build_object(
    'account_id',            p_account_id,
    'batch_id',              v_batch_id,
    'fecha',                 p_fecha,
    'monto_recibido',        v_monto,
    'aplicado_fees',         v_aplicado_fees,
    'aplicado_interes',      v_aplicado_interes,
    'aplicado_principal',    v_aplicado_principal,
    'excedente',             v_excedente,
    'nuevo_saldo_fees',      v_bal_fees_post,
    'nuevo_saldo_interes',   v_bal_interes_post,
    'nuevo_saldo_principal', v_bal_principal_post,
    'nuevo_saldo_total',     v_bal_principal_post + v_bal_interes_post + v_bal_fees_post,
    'estado_cuenta',         v_estado_final
  );
end;
$$;


ALTER FUNCTION "public"."fn_registrar_pago_revolving"("p_account_id" "uuid", "p_monto" numeric, "p_fecha" "date", "p_referencia" "text", "p_notas" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_registrar_pago_revolving"("p_account_id" "uuid", "p_monto" numeric, "p_fecha" "date", "p_referencia" "text", "p_notas" "text") IS 'Registra un pago sobre una cuenta DFP Revolving con waterfall estricto fees→interest→principal. SECURITY DEFINER: valida org_id del llamador, lock de cuenta, inserta en ledger (payment_applied), actualiza saldos en cob_revolving_accounts, y transiciona a completado si saldo total = 0. Excedente: si p_monto > saldo_total, la diferencia se devuelve en JSONB sin aplicar. pago_id = null — tabla de pagos pendiente (hueco conocido, documentado). Sin excepciones al waterfall en esta versión (0125). Flujos especiales (ajuste manual, reasignación) van en funciones separadas (0126+).';



CREATE OR REPLACE FUNCTION "public"."fn_set_revolving_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_set_revolving_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_conversation_direction"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    -- client replied → reset follow-up counter so the cron doesn't re-send
    UPDATE public.conversations
    SET
      last_message_direction = 'inbound',
      follow_up_count        = 0,
      follow_up_sent_at      = NULL,
      updated_at             = NOW()
    WHERE id = NEW.conversation_id;
  ELSE
    UPDATE public.conversations
    SET
      last_message_direction = 'outbound',
      updated_at             = NOW()
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_sync_conversation_direction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_conversion_kpis"("p_user_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_range" "text" DEFAULT 'semana'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  range_key text := lower(coalesce(p_range, 'semana'));
  start_ts timestamptz;
  end_ts timestamptz;
  prev_start timestamptz;
  prev_end timestamptz;
  span interval;

  citas_programadas integer := 0;
  citas_completadas integer := 0;
  citas_no_show integer := 0;
  citas_venta integer := 0;
  citas_realizada integer := 0;
  citas_demo_venta integer := 0;

  prev_citas_programadas integer := 0;
  prev_citas_completadas integer := 0;
  prev_citas_no_show integer := 0;
  prev_citas_venta integer := 0;
  prev_citas_realizada integer := 0;
  prev_citas_demo_venta integer := 0;

  ventas_monto numeric := 0;
  ventas_count integer := 0;
  prev_ventas_monto numeric := 0;
  prev_ventas_count integer := 0;
begin
  if range_key = 'hoy' then
    start_ts := date_trunc('day', now());
    end_ts := start_ts + interval '1 day';
  elsif range_key = 'mes' then
    start_ts := date_trunc('month', now());
    end_ts := start_ts + interval '1 month';
  else
    start_ts := date_trunc('week', now());
    end_ts := start_ts + interval '1 week';
  end if;

  span := end_ts - start_ts;
  prev_start := start_ts - span;
  prev_end := start_ts;

  select count(*) into citas_programadas
  from public.citas c
  where c.start_at >= start_ts
    and c.start_at < end_ts
    and c.estado in ('programada', 'confirmada', 'en_camino')
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into citas_completadas
  from public.citas c
  where c.start_at >= start_ts
    and c.start_at < end_ts
    and c.estado = 'completada'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into citas_no_show
  from public.citas c
  where c.start_at >= start_ts
    and c.start_at < end_ts
    and c.estado = 'no_show'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into citas_venta
  from public.citas c
  where c.start_at >= start_ts
    and c.start_at < end_ts
    and c.resultado = 'venta'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into citas_realizada
  from public.citas c
  where c.start_at >= start_ts
    and c.start_at < end_ts
    and c.resultado = 'realizada'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into citas_demo_venta
  from public.citas c
  where c.start_at >= start_ts
    and c.start_at < end_ts
    and c.tipo = 'demo'
    and c.resultado = 'venta'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into prev_citas_programadas
  from public.citas c
  where c.start_at >= prev_start
    and c.start_at < prev_end
    and c.estado in ('programada', 'confirmada', 'en_camino')
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into prev_citas_completadas
  from public.citas c
  where c.start_at >= prev_start
    and c.start_at < prev_end
    and c.estado = 'completada'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into prev_citas_no_show
  from public.citas c
  where c.start_at >= prev_start
    and c.start_at < prev_end
    and c.estado = 'no_show'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into prev_citas_venta
  from public.citas c
  where c.start_at >= prev_start
    and c.start_at < prev_end
    and c.resultado = 'venta'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into prev_citas_realizada
  from public.citas c
  where c.start_at >= prev_start
    and c.start_at < prev_end
    and c.resultado = 'realizada'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select count(*) into prev_citas_demo_venta
  from public.citas c
  where c.start_at >= prev_start
    and c.start_at < prev_end
    and c.tipo = 'demo'
    and c.resultado = 'venta'
    and (
      p_user_ids is null
      or c.owner_id = any(p_user_ids)
      or c.assigned_to = any(p_user_ids)
    );

  select coalesce(sum(v.monto), 0), count(*) into ventas_monto, ventas_count
  from public.ventas v
  where v.fecha_venta >= start_ts::date
    and v.fecha_venta < end_ts::date
    and (
      p_user_ids is null
      or v.vendedor_id = any(p_user_ids)
    );

  select coalesce(sum(v.monto), 0), count(*) into prev_ventas_monto, prev_ventas_count
  from public.ventas v
  where v.fecha_venta >= prev_start::date
    and v.fecha_venta < prev_end::date
    and (
      p_user_ids is null
      or v.vendedor_id = any(p_user_ids)
    );

  return jsonb_build_object(
    'period', jsonb_build_object(
      'start', start_ts,
      'end', end_ts
    ),
    'previous', jsonb_build_object(
      'start', prev_start,
      'end', prev_end
    ),
    'citas', jsonb_build_object(
      'programadas', citas_programadas,
      'completadas', citas_completadas,
      'no_show', citas_no_show,
      'tasa_asistencia', case when (citas_completadas + citas_no_show) = 0 then 0
        else round((citas_completadas::numeric / (citas_completadas + citas_no_show)) * 100, 2) end
    ),
    'conversion', jsonb_build_object(
      'ventas', citas_venta,
      'realizadas', citas_realizada,
      'tasa_conversion', case when citas_completadas = 0 then 0
        else round((citas_venta::numeric / citas_completadas) * 100, 2) end,
      'demo_venta', citas_demo_venta
    ),
    'ventas', jsonb_build_object(
      'monto', ventas_monto,
      'count', ventas_count,
      'ticket_promedio', case when ventas_count = 0 then 0
        else round((ventas_monto / ventas_count), 2) end
    ),
    'prev', jsonb_build_object(
      'citas_programadas', prev_citas_programadas,
      'citas_completadas', prev_citas_completadas,
      'citas_no_show', prev_citas_no_show,
      'conversion_ventas', prev_citas_venta,
      'conversion_realizadas', prev_citas_realizada,
      'conversion_demo_venta', prev_citas_demo_venta,
      'ventas_monto', prev_ventas_monto,
      'ventas_count', prev_ventas_count
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_conversion_kpis"("p_user_ids" "uuid"[], "p_range" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_distributor_phone"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  _rol    public.usuario_rol;
  _tel    text;
  _dist   uuid;
begin
  select rol, telefono, distribuidor_padre_id
    into _rol, _tel, _dist
  from public.usuarios
  where id = auth.uid();

  if _rol in ('admin', 'distribuidor') then
    return coalesce(_tel, '');
  end if;

  if _dist is not null then
    select telefono into _tel
    from public.usuarios
    where id = _dist;
    return coalesce(_tel, '');
  end if;

  return coalesce(_tel, '');
end;
$$;


ALTER FUNCTION "public"."get_distributor_phone"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid() and rol = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_or_distribuidor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid()
      and rol in ('admin', 'distribuidor')
  );
$$;


ALTER FUNCTION "public"."is_admin_or_distribuidor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_distribuidor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid() and rol = 'distribuidor'
  );
$$;


ALTER FUNCTION "public"."is_distribuidor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_distribuidor_of"("vendor_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.usuarios u
    where u.id = vendor_id
      and u.distribuidor_padre_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_distribuidor_of"("vendor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_supervisor_tele"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid()
      and rol = 'supervisor_telemercadeo'
  );
$$;


ALTER FUNCTION "public"."is_supervisor_tele"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_vendedor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid()
      and rol in ('vendedor', 'telemercadeo')
  );
$$;


ALTER FUNCTION "public"."is_vendedor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lead_last_activity"("lead_ids" "uuid"[]) RETURNS TABLE("lead_id" "uuid", "last_activity_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    n.lead_id,
    max(n.created_at) as last_activity_at
  from public.lead_notas n
  where n.lead_id = any(lead_ids)
  group by n.lead_id
$$;


ALTER FUNCTION "public"."lead_last_activity"("lead_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_cliente_rp"("p_rp_id" "uuid", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_rp          public.clientes_rp%ROWTYPE;
  v_cliente_id  uuid;
  v_nombre_arr  text[];
BEGIN
  SELECT * INTO v_rp FROM public.clientes_rp WHERE id = p_rp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'clientes_rp id % no encontrado', p_rp_id; END IF;

  -- Separar nombre en nombre + apellido (primera palabra = nombre)
  v_nombre_arr := string_to_array(trim(v_rp.nombre), ' ');

  INSERT INTO public.clientes (
    nombre, apellido, email,
    telefono, telefono_casa,
    direccion, ciudad, estado_region, codigo_postal,
    tipo_cuenta_hycite, metodo_pago, pago_minimo_mensual,
    factor_ingresos, credito_disponible, saldo_actual,
    fecha_orden, fecha_cierre, ultima_fecha_pago, fecha_ultimo_pedido,
    estado_cuenta_raw, codigo_vendedor_hycite,
    vendedor_hycite_nombre,
    origen, fuente_import, import_file_name,
    activo, created_at, updated_at
  )
  VALUES (
    v_nombre_arr[1],
    CASE WHEN array_length(v_nombre_arr, 1) > 1
         THEN array_to_string(v_nombre_arr[2:], ' ') ELSE '' END,
    v_rp.email,
    COALESCE(NULLIF(v_rp.telefono_movil,''), NULLIF(v_rp.telefono_casa,'')),
    v_rp.telefono_casa,
    v_rp.direccion, v_rp.ciudad, v_rp.estado, v_rp.zip,
    v_rp.tipo_cuenta, v_rp.metodo_pago, v_rp.pago_minimo,
    v_rp.factor_ingresos, v_rp.credito_disponible, v_rp.saldo_actual,
    NULLIF(v_rp.fecha_orden,'')::date,
    NULLIF(v_rp.fecha_cierre,'')::date,
    NULLIF(v_rp.fecha_ultimo_pago,'')::date,
    NULLIF(v_rp.fecha_ultimo_pedido,'')::date,
    v_rp.estado_cuenta,
    v_rp.emprendedor_codigo,
    v_rp.emprendedor_nombre,
    'import_ocr_rp', 'ocr_drive', v_rp._source_file,
    true, now(), now()
  )
  RETURNING id INTO v_cliente_id;

  -- Marcar como mergeado
  UPDATE public.clientes_rp
  SET merge_status = 'mergeado',
      cliente_id   = v_cliente_id,
      merge_at     = now(),
      merge_by     = p_user_id
  WHERE id = p_rp_id;

  RETURN v_cliente_id;
END;
$$;


ALTER FUNCTION "public"."merge_cliente_rp"("p_rp_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_prospecto_rp"("p_rp_id" "uuid", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_rp        public.prospectos_rp%ROWTYPE;
  v_lead_id   uuid;
  v_nombre_arr text[];
BEGIN
  SELECT * INTO v_rp FROM public.prospectos_rp WHERE id = p_rp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'prospectos_rp id % no encontrado', p_rp_id; END IF;

  v_nombre_arr := string_to_array(trim(v_rp.nombre), ' ');

  INSERT INTO public.leads (
    nombre, apellido, email, telefono,
    telefono_trabajo,
    direccion, ciudad, estado_region, codigo_postal,
    fuente, fuente_import, import_file_name,
    notas_extraidas, confianza_ocr,
    owner_id,
    estado_pipeline, created_at, updated_at
  )
  VALUES (
    v_nombre_arr[1],
    CASE WHEN array_length(v_nombre_arr, 1) > 1
         THEN array_to_string(v_nombre_arr[2:], ' ') ELSE '' END,
    v_rp.email,
    COALESCE(NULLIF(v_rp.telefono_movil,''), NULLIF(v_rp.telefono_casa,'')),
    v_rp.telefono_trabajo,
    v_rp.direccion, v_rp.ciudad, v_rp.estado, v_rp.zip,
    'import_ocr_rp', 'ocr_drive', v_rp._source_file,
    v_rp.notas,
    CASE WHEN v_rp.confianza >= 80 THEN 'alta'
         WHEN v_rp.confianza >= 55 THEN 'media'
         ELSE 'baja' END,
    p_user_id,
    'nuevo', now(), now()
  )
  RETURNING id INTO v_lead_id;

  UPDATE public.prospectos_rp
  SET merge_status = 'mergeado',
      lead_id      = v_lead_id,
      merge_at     = now(),
      merge_by     = p_user_id
  WHERE id = p_rp_id;

  RETURN v_lead_id;
END;
$$;


ALTER FUNCTION "public"."merge_prospecto_rp"("p_rp_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mk_messages_sync_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- States managed by the outbox worker: never override.
  -- These are set explicitly by syncMkMessage() in process-outbox.
  if new.status in ('programado', 'en_proceso', 'fallido', 'cancelado') then
    return new;
  end if;

  -- For all other cases, derive status from timestamp columns.
  -- Use canonical (new) vocabulary: respondido / enviado / pendiente.
  if new.responded_at is not null then
    new.status := 'respondido';   -- was: 'responded'
  elsif new.sent_at is not null then
    new.status := 'enviado';      -- was: 'sent'
  else
    new.status := coalesce(new.status, 'pendiente');
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."mk_messages_sync_status"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mk_messages_sync_status"() IS 'BEFORE INSERT/UPDATE trigger on mk_messages. Respects outbox-managed statuses (programado, en_proceso, fallido, cancelado) without override. For other rows, derives status from timestamp columns using canonical vocabulary: respondido (responded_at IS NOT NULL), enviado (sent_at IS NOT NULL), pendiente (else).';



CREATE OR REPLACE FUNCTION "public"."normalizar_telefono"("p" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  select regexp_replace(p, '[^0-9]', '', 'g')
$$;


ALTER FUNCTION "public"."normalizar_telefono"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."product_images_sync_producto_foto_principal_tg"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_producto_foto_principal(old.product_id);
    return old;
  end if;

  perform public.sync_producto_foto_principal(new.product_id);

  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    perform public.sync_producto_foto_principal(old.product_id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."product_images_sync_producto_foto_principal_tg"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."productos_set_search_vector"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.search_vector := to_tsvector(
    'simple',
    lower(
      concat_ws(
        ' ',
        coalesce(new.codigo, ''),
        coalesce(new.legacy_code, ''),
        coalesce(new.nombre, ''),
        coalesce(new.categoria, ''),
        coalesce(new.categoria_principal, ''),
        coalesce(new.subcategoria, ''),
        coalesce(new.linea_producto, ''),
        coalesce(new.description_short, ''),
        coalesce(new.description_long, ''),
        array_to_string(coalesce(new.tags, '{}'::text[]), ' '),
        array_to_string(coalesce(new.benefits, '{}'::text[]), ' ')
      )
    )
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."productos_set_search_vector"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_venta_org_id"("p_vendedor_id" "uuid", "p_cliente_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_org_id uuid;
begin
  if p_vendedor_id is not null then
    select u.org_id
      into v_org_id
    from public.usuarios u
    where u.id = p_vendedor_id
    limit 1;
  end if;

  if v_org_id is null and p_cliente_id is not null then
    select c.org_id
      into v_org_id
    from public.clientes c
    where c.id = p_cliente_id
    limit 1;
  end if;

  return v_org_id;
end;
$$;


ALTER FUNCTION "public"."resolve_venta_org_id"("p_vendedor_id" "uuid", "p_cliente_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_crm_tareas_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_crm_tareas_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_llamadas_telemercadeo_org_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.org_id is null and new.cliente_id is not null then
    select c.org_id
    into new.org_id
    from public.clientes c
    where c.id = new.cliente_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_llamadas_telemercadeo_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_message_templates_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_message_templates_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_outbox_messages_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_outbox_messages_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_cliente_estado_operativo_from_contacto_actividades"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.contacto_tipo = 'cliente' then
    if new.resultado = 'promesa_pago' then
      update public.clientes
        set estado_operativo = 'recuperacion'
        where id = new.contacto_id
          and estado_operativo = 'en_riesgo';
    elsif new.resultado = 'pago_realizado' then
      update public.clientes
        set estado_operativo = 'activo'
        where id = new.contacto_id;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_cliente_estado_operativo_from_contacto_actividades"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_lead_estado_from_contacto_actividades"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.contacto_tipo = 'lead' then
    update public.leads
      set estado_pipeline = 'contactado'
      where id = new.contacto_id
        and estado_pipeline = 'nuevo';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_lead_estado_from_contacto_actividades"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_producto_foto_principal"("product_uuid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.productos p
  set foto_principal_url = coalesce(
    (
      select image.url
      from public.product_images image
      where image.product_id = product_uuid
      order by image.orden asc, image.created_at asc
      limit 1
    ),
    p.foto_url
  )
  where p.id = product_uuid;
end;
$$;


ALTER FUNCTION "public"."sync_producto_foto_principal"("product_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_whatsapp_ultimo_envio"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.canal = 'whatsapp'
     and new.status = 'enviado'
     and coalesce(old.status, '') is distinct from 'enviado'
     and new.contact_id is not null then
    if new.contact_tipo = 'cliente' then
      update public.clientes
         set whatsapp_ultimo_envio_at = coalesce(new.sent_at, now())
       where id = new.contact_id;
    elsif new.contact_tipo = 'lead' then
      update public.leads
         set whatsapp_ultimo_envio_at = coalesce(new.sent_at, now())
       where id = new.contact_id;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_whatsapp_ultimo_envio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_cliente_autolink_persona"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_telefono_norm text;
  v_org_id        uuid;
  v_persona_id    uuid;
begin

  if NEW.persona_id is not null then
    return NEW;
  end if;

  if NEW.telefono is null then
    return NEW;
  end if;

  v_telefono_norm := public.normalizar_telefono(NEW.telefono);
  if length(v_telefono_norm) < 7 then
    return NEW;
  end if;

  v_org_id := NEW.org_id;

  if v_org_id is null and NEW.distribuidor_id is not null then
    select u.distribuidor_padre_id
    into   v_org_id
    from   public.usuarios u
    where  u.id = NEW.distribuidor_id;

    if v_org_id is null then
      v_org_id := NEW.distribuidor_id;
    end if;
  end if;

  if v_org_id is null then
    return NEW;
  end if;

  select p.id
  into   v_persona_id
  from   public.personas p
  where  public.normalizar_telefono(p.telefono) = v_telefono_norm
    and  p.org_id = v_org_id
  limit  1;

  if v_persona_id is null then
    insert into public.personas
      (nombre, apellido, email, telefono, fecha_nacimiento, org_id)
    values
      (NEW.nombre, NEW.apellido, NEW.email, NEW.telefono, NEW.fecha_nacimiento, v_org_id)
    returning id into v_persona_id;
  end if;

  NEW.persona_id := v_persona_id;
  return NEW;

end $$;


ALTER FUNCTION "public"."trg_cliente_autolink_persona"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_embajador_autolink_persona"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_persona_id uuid;
begin

  if NEW.persona_id is not null then
    return NEW;
  end if;

  if NEW.lead_id is not null then
    select l.persona_id
    into   v_persona_id
    from   public.leads l
    where  l.id = NEW.lead_id;

  elsif NEW.cliente_id is not null then
    select c.persona_id
    into   v_persona_id
    from   public.clientes c
    where  c.id = NEW.cliente_id;
  end if;

  if v_persona_id is not null then
    NEW.persona_id := v_persona_id;
  end if;

  return NEW;

end $$;


ALTER FUNCTION "public"."trg_embajador_autolink_persona"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_lead_autolink_persona"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_telefono_norm text;
  v_org_id        uuid;
  v_persona_id    uuid;
begin

  if NEW.persona_id is not null then
    return NEW;
  end if;

  if NEW.telefono is null then
    return NEW;
  end if;

  v_telefono_norm := public.normalizar_telefono(NEW.telefono);
  if length(v_telefono_norm) < 7 then
    return NEW;
  end if;

  -- Resolver org: distribuidor_padre_id, o el owner mismo si es raíz
  select coalesce(u.distribuidor_padre_id, NEW.owner_id)
  into   v_org_id
  from   public.usuarios u
  where  u.id = NEW.owner_id;

  if v_org_id is null then
    return NEW;
  end if;

  select p.id
  into   v_persona_id
  from   public.personas p
  where  public.normalizar_telefono(p.telefono) = v_telefono_norm
    and  p.org_id = v_org_id
  limit  1;

  if v_persona_id is null then
    insert into public.personas
      (nombre, apellido, email, telefono, fecha_nacimiento, org_id)
    values
      (NEW.nombre, NEW.apellido, NEW.email, NEW.telefono, NEW.fecha_nacimiento, v_org_id)
    returning id into v_persona_id;
  end if;

  NEW.persona_id := v_persona_id;
  return NEW;

end $$;


ALTER FUNCTION "public"."trg_lead_autolink_persona"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_venta_child_org_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_parent_org_id uuid;
begin
  select v.org_id
    into v_parent_org_id
  from public.ventas v
  where v.id = new.venta_id;

  if v_parent_org_id is not null
     and new.org_id is not null
     and new.org_id is distinct from v_parent_org_id then
    raise exception 'org_id mismatch for venta_id %', new.venta_id;
  end if;

  new.org_id := coalesce(v_parent_org_id, new.org_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_venta_child_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_ventas_org_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if new.org_id is null then
    new.org_id := public.resolve_venta_org_id(new.vendedor_id, new.cliente_id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_ventas_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sync_ventas_children_org_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if tg_op = 'INSERT' or new.org_id is distinct from old.org_id then
    update public.venta_items
       set org_id = new.org_id
     where venta_id = new.id
       and org_id is distinct from new.org_id;

    update public.venta_transacciones
       set org_id = new.org_id
     where venta_id = new.id
       and org_id is distinct from new.org_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_sync_ventas_children_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_prioridad_top"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  total_top integer;
  representante uuid;
BEGIN

  -- Solo validar si prioridad_top es TRUE
  IF NEW.prioridad_top = true THEN

    -- Contar cuantos TOP ya existen en esa activación
    SELECT COUNT(*) INTO total_top
    FROM public.ci_referidos
    WHERE activacion_id = NEW.activacion_id
      AND prioridad_top = true
      AND id <> COALESCE(NEW.id, gen_random_uuid());

    IF total_top >= 4 THEN
      RAISE EXCEPTION 'Solo se permiten máximo 4 referidos TOP por activación';
    END IF;

    -- Asignar automáticamente al representante de la activación
    SELECT representante_id INTO representante
    FROM public.ci_activaciones
    WHERE id = NEW.activacion_id;

    NEW.asignado_a := representante;

  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_prioridad_top"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select u.rol
  from public.usuarios u
  where u.id = auth.uid()
$$;


ALTER FUNCTION "security"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."enforce_ci_activaciones_audit_and_reassign"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- Campos inmutables de auditoría/origen
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id no puede ser modificado';
  END IF;

  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
    RAISE EXCEPTION 'lead_id no puede ser modificado';
  END IF;

  IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id THEN
    RAISE EXCEPTION 'cliente_id no puede ser modificado';
  END IF;

  -- Reasignación operativa de representante_id
  IF NEW.representante_id IS DISTINCT FROM OLD.representante_id THEN
    IF COALESCE(OLD.estado, 'borrador') NOT IN ('borrador', 'activo') THEN
      RAISE EXCEPTION 'No se puede reasignar representante en activacion no editable';
    END IF;

    IF NOT (
      security.current_user_role() IN ('admin','distribuidor','supervisor_telemercadeo')
    ) THEN
      RAISE EXCEPTION 'No autorizado para reasignar representante';
    END IF;

    NEW.last_reassigned_by := auth.uid();
    NEW.last_reassigned_at := now();
  END IF;

  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "security"."enforce_ci_activaciones_audit_and_reassign"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."enforce_ci_referidos_audit_and_reassign"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- Campos inmutables de auditoría/origen
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id no puede ser modificado';
  END IF;

  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
    RAISE EXCEPTION 'lead_id no puede ser modificado';
  END IF;

  IF NEW.activacion_id IS DISTINCT FROM OLD.activacion_id THEN
    RAISE EXCEPTION 'activacion_id no puede ser modificado';
  END IF;

  -- Reasignación operativa de asignado_a
  IF NEW.asignado_a IS DISTINCT FROM OLD.asignado_a THEN
    IF COALESCE(OLD.estado, 'pendiente') NOT IN ('pendiente','activo') THEN
      RAISE EXCEPTION 'No se puede reasignar referido no activo';
    END IF;

    IF NOT (
      security.current_user_role() IN ('admin','distribuidor','supervisor_telemercadeo')
    ) THEN
      RAISE EXCEPTION 'No autorizado para reasignar referido';
    END IF;

    NEW.last_reassigned_by := auth.uid();
    NEW.last_reassigned_at := now();
  END IF;

  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "security"."enforce_ci_referidos_audit_and_reassign"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."enforce_ci_referidos_modo_gestion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  role text;
  is_admin boolean;
  is_distribuidor boolean;
  is_supervisor boolean;
  is_vendedor boolean;
  is_telemercadeo boolean;
  is_owner_vendedor boolean;
BEGIN
  role := security.current_user_role();
  is_admin := role = 'admin';
  is_distribuidor := role = 'distribuidor';
  is_supervisor := role = 'supervisor_telemercadeo';
  is_vendedor := role = 'vendedor';
  is_telemercadeo := role = 'telemercadeo';
  IF is_telemercadeo AND NEW.modo_gestion IS DISTINCT FROM OLD.modo_gestion THEN
    RAISE EXCEPTION 'Telemercadeo no puede cambiar modo_gestion';
  END IF;
  IF NEW.modo_gestion IS DISTINCT FROM OLD.modo_gestion THEN
    IF NEW.modo_gestion = 'vendedor_directo' THEN
      IF NOT is_vendedor THEN
        RAISE EXCEPTION 'Solo vendedor puede tomar referido';
      END IF;
      SELECT EXISTS (
        SELECT 1
        FROM public.ci_activaciones a
        WHERE a.id = NEW.activacion_id
          AND a.representante_id = auth.uid()
      ) INTO is_owner_vendedor;
      IF NOT (NEW.asignado_a = auth.uid() OR is_owner_vendedor) THEN
        RAISE EXCEPTION 'Vendedor no puede tomar referido no asignado';
      END IF;
      NEW.gestionado_por_usuario_id := auth.uid();
      NEW.tomado_por_vendedor_at := now();
      NEW.ultima_asignacion_por := auth.uid();
    END IF;
    IF NEW.modo_gestion = 'telemercadeo' THEN
      IF NOT (is_vendedor OR is_admin OR is_distribuidor OR is_supervisor) THEN
        RAISE EXCEPTION 'No autorizado para devolver a telemercadeo';
      END IF;
      NEW.gestionado_por_usuario_id := NULL;
      NEW.liberado_a_telemercadeo_at := now();
      NEW.ultima_asignacion_por := auth.uid();
    END IF;
  END IF;
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "security"."enforce_ci_referidos_modo_gestion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."enforce_leads_audit_and_reassign"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- owner_id inmutable
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id no puede ser modificado';
  END IF;

  -- Reasignación de vendedor_id solo roles altos y lead activo
  IF NEW.vendedor_id IS DISTINCT FROM OLD.vendedor_id THEN
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede reasignar vendedor en lead eliminado';
    END IF;

    IF NOT (
      security.current_user_role() IN ('admin','distribuidor','supervisor_telemercadeo')
    ) THEN
      RAISE EXCEPTION 'No autorizado para reasignar vendedor';
    END IF;

    NEW.last_reassigned_by := auth.uid();
    NEW.last_reassigned_at := now();
  END IF;

  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "security"."enforce_leads_audit_and_reassign"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."is_admin_or_distribuidor"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(
    (
      select u.rol in ('admin', 'distribuidor')
      from public.usuarios u
      where u.id = auth.uid()
    ),
    false
  )
$$;


ALTER FUNCTION "security"."is_admin_or_distribuidor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."is_marketing_manager"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'security'
    AS $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.rol in ('admin','distribuidor','supervisor_telemercadeo')
  );
$$;


ALTER FUNCTION "security"."is_marketing_manager"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."is_supervisor_tele"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT security.current_user_role() = 'supervisor_telemercadeo'
$$;


ALTER FUNCTION "security"."is_supervisor_tele"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."telemercadeo_vendedor_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT tva.vendedor_id
  FROM public.tele_vendedor_assignments tva
  WHERE tva.tele_id = auth.uid()
$$;


ALTER FUNCTION "security"."telemercadeo_vendedor_ids"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auto_reply_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "keyword" "text" NOT NULL,
    "reply_text" "text",
    "template_id" "uuid",
    "priority" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auto_reply_rules_reply_check" CHECK ((("reply_text" IS NOT NULL) OR ("template_id" IS NOT NULL)))
);


ALTER TABLE "public"."auto_reply_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bot_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "text" NOT NULL,
    "canal" "text" DEFAULT 'telegram'::"text" NOT NULL,
    "intent" "text",
    "step" "text" DEFAULT 'inicio'::"text" NOT NULL,
    "slots" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cita_id" "uuid",
    "lead_id" "uuid",
    "intentos" integer DEFAULT 0 NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '02:00:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bot_sessions_canal_check" CHECK (("canal" = ANY (ARRAY['telegram'::"text", 'whatsapp'::"text", 'webchat'::"text"]))),
    CONSTRAINT "bot_sessions_intent_check" CHECK (("intent" = ANY (ARRAY['citas'::"text", 'servicio_cliente'::"text", 'cartera'::"text", 'cumpleanos'::"text", 'otro'::"text"])))
);


ALTER TABLE "public"."bot_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cargo_vuelta_cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "factura_id" "uuid",
    "monto_total" numeric(12,2) NOT NULL,
    "dias_vencido" integer NOT NULL,
    "estado" "text" DEFAULT 'Abierto'::"text" NOT NULL,
    "acuerdo_tipo" "text",
    "acuerdo_detalles" "jsonb",
    "fecha_apertura" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha_cierre" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "tipo_caso" "text" DEFAULT 'cargo_vuelta'::"text" NOT NULL,
    "alias_operativo" "text",
    "fecha_cargo_vuelta" "date",
    "monto_devuelto" numeric(12,2),
    "numero_cuenta_hycite" "text",
    "numero_orden_hycite" "text",
    "orden_hycite_id" "uuid",
    "documento_hycite_id" "uuid",
    "origen_cargo_vuelta" "text" DEFAULT 'hycite'::"text" NOT NULL,
    "requiere_reconciliacion" boolean DEFAULT false NOT NULL,
    "en_proceso_legal" boolean DEFAULT false NOT NULL,
    CONSTRAINT "cargo_vuelta_cases_monto_devuelto_chk" CHECK ((("monto_devuelto" IS NULL) OR ("monto_devuelto" >= (0)::numeric))),
    CONSTRAINT "cargo_vuelta_cases_origen_cargo_vuelta_chk" CHECK (("origen_cargo_vuelta" = 'hycite'::"text")),
    CONSTRAINT "cargo_vuelta_cases_tipo_caso_chk" CHECK (("tipo_caso" = ANY (ARRAY['cargo_vuelta'::"text", 'dfp'::"text"])))
);


ALTER TABLE "public"."cargo_vuelta_cases" OWNER TO "postgres";


COMMENT ON TABLE "public"."cargo_vuelta_cases" IS 'Caso operativo Cargo de Vuelta / DFP. RLS restringido por org_id. Lectura: roles de cartera de la misma organización. INSERT/UPDATE: solo admin/distribuidor/supervisor_tele de la misma organización. DELETE no permitido por policy (sin policy = denegado). telemercadeo puede leer casos de su org pero no crear ni modificar.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."monto_total" IS 'Campo legacy mantenido por compatibilidad con código anterior a 0116. Para tipo_caso=cargo_vuelta la fuente correcta del principal operativo es monto_devuelto. UI label: no exponer directamente. Usar monto_devuelto.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."dias_vencido" IS 'Días vencidos informados por Hy-Cite al momento del cargo de vuelta. Snapshot histórico. No recalcular; la morosidad activa se gestiona desde cob_revolving_accounts.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."estado" IS 'Estado operativo del caso. Valores: Abierto | En negociación | En acuerdo | En seguimiento | Cerrado | Cancelado. Describe la situación operativa, no el saldo financiero. El saldo vive en cob_revolving_accounts y cob_financial_ledger.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."acuerdo_tipo" IS 'Tipo de acuerdo alcanzado con el cliente: PTP, Plan de Pagos, Descuento, etc. Campo libre. El acuerdo formal vive en cob_plan_pagos.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."acuerdo_detalles" IS 'JSONB libre con detalles del acuerdo. Complementario a cob_plan_pagos. No usar para saldos financieros.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."fecha_apertura" IS 'Fecha en que se registró el caso en FlowSuite. Puede diferir de fecha_cargo_vuelta (que es la fecha en que Hy-Cite devolvió la cuenta).';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."fecha_cierre" IS 'Fecha de cierre operativo del caso. Nulo mientras el caso está activo.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."updated_by" IS 'Ultimo usuario que actualizo el caso de cartera.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."tipo_caso" IS 'Tipo formal del caso. Valor único por ahora: cargo_vuelta. BD/técnico: cargo_vuelta. UI label: "Cuenta Recomprada / DFP".';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."alias_operativo" IS 'Alias libre usado por el equipo: Cargo de Vuelta, Cuenta Devuelta, Cuenta Recomprada, Recomprada, DFP, Distributor Finance Program u otro equivalente. No normalizar; es un campo operativo de referencia interna.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."fecha_cargo_vuelta" IS 'Fecha en que Hy-Cite devolvió la cuenta al distribuidor. UI label: "Fecha de Devolución" o "Fecha Cargo de Vuelta". Distinta de fecha_apertura (cuando se registró en FlowSuite).';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."monto_devuelto" IS 'Principal operativo inicial del caso DFP. UI label: "Monto Devuelto". Fuente: Hy-Cite al momento del cargo de vuelta. Este valor abre la cuenta revolving (cob_revolving_accounts.saldo_principal_inicial). No confundir con Saldo Hy-Cite (clientes.saldo_actual) ni con el Saldo Operativo Interno (calculado desde cob_financial_ledger). No editar una vez que la cuenta revolving está creada.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."numero_cuenta_hycite" IS 'Número de cuenta Hy-Cite asociado al caso devuelto. Usado para reconciliación y rastreo. No es el ID interno del cliente.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."numero_orden_hycite" IS 'Número de orden Hy-Cite relacionado al cargo de vuelta, cuando aplique.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."orden_hycite_id" IS 'UUID de referencia futura a tabla formal de órdenes Hy-Cite. Nulo hasta que esa tabla exista.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."documento_hycite_id" IS 'UUID de referencia futura a documento/importación/OCR que respalda el cargo de vuelta. Nulo si el caso fue creado manualmente.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."origen_cargo_vuelta" IS 'Origen del cargo de vuelta. Valor esperado: hycite. Extensible en el futuro para otros orígenes si se incorporan.';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."requiere_reconciliacion" IS 'Bandera operativa: true cuando el monto devuelto, los pagos o el soporte documental requieren revisión antes de considerar el caso confiable. UI label: "Pendiente de reconciliación".';



COMMENT ON COLUMN "public"."cargo_vuelta_cases"."en_proceso_legal" IS 'Indica que el caso escaló a proceso legal / demanda. Muestra ⚖️ al lado del nombre en Cartera.';



CREATE TABLE IF NOT EXISTS "public"."cartera_resumen_diario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fecha" "date" NOT NULL,
    "total_morosos" integer DEFAULT 0 NOT NULL,
    "total_monto" numeric(14,2) DEFAULT 0 NOT NULL,
    "count_0_30" integer DEFAULT 0 NOT NULL,
    "monto_0_30" numeric(14,2) DEFAULT 0 NOT NULL,
    "count_31_60" integer DEFAULT 0 NOT NULL,
    "monto_31_60" numeric(14,2) DEFAULT 0 NOT NULL,
    "count_61_90" integer DEFAULT 0 NOT NULL,
    "monto_61_90" numeric(14,2) DEFAULT 0 NOT NULL,
    "count_mas_90" integer DEFAULT 0 NOT NULL,
    "monto_mas_90" numeric(14,2) DEFAULT 0 NOT NULL,
    "mensajes_generados" integer DEFAULT 0 NOT NULL,
    "tareas_generadas" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cartera_resumen_diario" OWNER TO "postgres";


COMMENT ON TABLE "public"."cartera_resumen_diario" IS 'Snapshot diario de cartera morosa — alimentado por n8n FS-Alerta-Cobranza';



CREATE TABLE IF NOT EXISTS "public"."ci_activaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "representante_id" "uuid" NOT NULL,
    "cliente_id" "uuid",
    "lead_id" "uuid",
    "programa_id" "uuid",
    "cantidad_referidos" integer DEFAULT 0 NOT NULL,
    "regalo_id" "uuid",
    "regalo_nombre" "text",
    "foto_url" "text",
    "whatsapp_lista_creada_at" timestamp with time zone,
    "whatsapp_mensaje_enviado_at" timestamp with time zone,
    "whatsapp_mensaje_texto" "text",
    "estado" "text" DEFAULT 'activo'::"text",
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "regalo_visita_id" "uuid",
    "regalo_visita_cantidad" integer,
    "regalo_visita_entregado_at" timestamp with time zone,
    "regalo_premium_cantidad_parcial" "text",
    "regalo_premium_entregado_at" timestamp with time zone,
    "updated_by" "uuid",
    "last_reassigned_by" "uuid",
    "last_reassigned_at" timestamp with time zone,
    "vendedor_id" "uuid",
    CONSTRAINT "debe_tener_cliente_o_lead" CHECK ((("cliente_id" IS NOT NULL) OR ("lead_id" IS NOT NULL)))
);


ALTER TABLE "public"."ci_activaciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ci_referidos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activacion_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "telefono" "text" NOT NULL,
    "relacion" "text",
    "lead_id" "uuid",
    "estado" "text" DEFAULT 'pendiente'::"text",
    "contactado_at" timestamp with time zone,
    "cita_at" timestamp with time zone,
    "presentacion_at" timestamp with time zone,
    "regalo_entregado_at" timestamp with time zone,
    "notas" "text",
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "prioridad" boolean DEFAULT false,
    "prioridad_top" boolean DEFAULT false,
    "nivel_prioridad" integer DEFAULT 0,
    "motivo_calificacion" "text",
    "asignado_a" "uuid",
    "calificacion" smallint,
    "updated_by" "uuid",
    "last_reassigned_by" "uuid",
    "last_reassigned_at" timestamp with time zone,
    "modo_gestion" "text" DEFAULT 'vendedor_directo'::"text",
    "gestionado_por_usuario_id" "uuid",
    "tomado_por_vendedor_at" timestamp with time zone,
    "liberado_a_telemercadeo_at" timestamp with time zone,
    "ultima_asignacion_por" "uuid",
    "cita_id" "uuid",
    CONSTRAINT "ci_referidos_gestionado_por_required" CHECK (((("modo_gestion" = 'vendedor_directo'::"text") AND ("gestionado_por_usuario_id" IS NOT NULL)) OR ("modo_gestion" = 'telemercadeo'::"text"))),
    CONSTRAINT "ci_referidos_modo_gestion_check" CHECK (("modo_gestion" = ANY (ARRAY['telemercadeo'::"text", 'vendedor_directo'::"text"]))),
    CONSTRAINT "telefono_no_vacio" CHECK (("length"(TRIM(BOTH FROM "telefono")) > 0))
);


ALTER TABLE "public"."ci_referidos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."citas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "assigned_to" "uuid",
    "contacto_tipo" "text" NOT NULL,
    "contacto_id" "uuid" NOT NULL,
    "telefono" "text",
    "nombre" "text",
    "direccion" "text",
    "ciudad" "text",
    "estado_region" "text",
    "zip" "text",
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone DEFAULT ("now"() + '01:00:00'::interval) NOT NULL,
    "tipo" "text" DEFAULT 'servicio'::"text" NOT NULL,
    "estado" "text" DEFAULT 'programada'::"text" NOT NULL,
    "notas" "text",
    "campaign_id" "uuid",
    "message_id" "uuid",
    "response_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resultado" "text",
    "resultado_notas" "text",
    "apartamento" "text",
    "timezone" "text",
    CONSTRAINT "citas_contacto_tipo_check" CHECK (("contacto_tipo" = ANY (ARRAY['cliente'::"text", 'lead'::"text"]))),
    CONSTRAINT "citas_estado_check" CHECK (("estado" = ANY (ARRAY['programada'::"text", 'confirmada'::"text", 'en_camino'::"text", 'completada'::"text", 'cancelada'::"text", 'no_show'::"text"]))),
    CONSTRAINT "citas_resultado_check" CHECK (("resultado" = ANY (ARRAY['realizada'::"text", 'venta'::"text", 'no_contacto'::"text", 'reagendar'::"text", 'no_interes'::"text", 'otro'::"text"]))),
    CONSTRAINT "citas_time_order" CHECK (("end_at" > "start_at")),
    CONSTRAINT "citas_tipo_check" CHECK (("tipo" = ANY (ARRAY['servicio'::"text", 'demo'::"text", 'cobranza'::"text", 'reclutamiento'::"text", 'otro'::"text"])))
);


ALTER TABLE "public"."citas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "apellido" "text",
    "email" "text",
    "telefono" "text",
    "direccion" "text",
    "numero_cuenta_financiera" "text",
    "saldo_actual" numeric(12,2) DEFAULT 0 NOT NULL,
    "estado_morosidad" "public"."cliente_estado_morosidad",
    "vendedor_id" "uuid",
    "distribuidor_id" "uuid",
    "fecha_nacimiento" "date",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo_cliente" "text" DEFAULT 'HC'::"text",
    "estado_cuenta" "public"."cliente_estado" DEFAULT 'actual'::"public"."cliente_estado",
    "nivel" integer DEFAULT 1,
    "monto_moroso" numeric DEFAULT 0 NOT NULL,
    "fecha_ultimo_pedido" "date",
    "dias_atraso" integer DEFAULT 0 NOT NULL,
    "elegible_addon" boolean DEFAULT true,
    "origen" "public"."cliente_origen" DEFAULT 'manual'::"public"."cliente_origen",
    "hycite_id" "text",
    "telefono_casa" "text",
    "notas_internas" "text",
    "ultimo_contacto_at" timestamp with time zone,
    "codigo_vendedor_hycite" "text",
    "codigo_dist_hycite" "text",
    "ciudad" "text",
    "estado_region" "text",
    "codigo_postal" "text",
    "ultima_fecha_pago" "date",
    "next_action_date" "date",
    "next_action" "text",
    "lat" numeric,
    "lng" numeric,
    "org_id" "uuid",
    "persona_id" "uuid",
    "estado_operativo" "text",
    "telegram_chat_id" "text",
    "credito_disponible" numeric(12,2),
    "metodo_pago" "text",
    "fecha_orden" "date",
    "fecha_cierre" "date",
    "fuente_import" "text",
    "import_file_name" "text",
    "import_drive_url" "text",
    "apartamento" "text",
    "tipo_cuenta_hycite" "text",
    "pago_minimo_mensual" numeric(12,2),
    "factor_ingresos" numeric(12,2),
    "estado_cuenta_raw" "text",
    "vendedor_hycite_nombre" "text",
    "whatsapp_opt_in" boolean DEFAULT false NOT NULL,
    "whatsapp_no_molestar" boolean DEFAULT false NOT NULL,
    "whatsapp_ultimo_envio_at" timestamp with time zone,
    "whatsapp_consent_source" "text",
    "whatsapp_consented_at" timestamp with time zone,
    CONSTRAINT "clientes_estado_operativo_values" CHECK ((("estado_operativo" IS NULL) OR ("estado_operativo" = ANY (ARRAY['activo'::"text", 'en_riesgo'::"text", 'recuperacion'::"text", 'inactivo'::"text", 'cancelado'::"text"])))),
    CONSTRAINT "clientes_nivel_check" CHECK ((("nivel" >= 1) AND ("nivel" <= 9)))
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clientes"."saldo_actual" IS 'Saldo Hy-Cite Snapshot. Importado desde Hy-Cite; no refleja pagos internos registrados en FlowSuite. UI label: "Saldo Hy-Cite". No editable manualmente. No usar para calcular saldo operativo de casos DFP. Puede quedar en 0.00 incluso cuando hay saldo interno pendiente en cob_revolving_accounts.';



COMMENT ON COLUMN "public"."clientes"."estado_cuenta" IS 'Estado de cuenta normalizado desde Hy-Cite. Valores típicos derivados de estado_cuenta_raw. Snapshot externo; el estado operativo interno del caso DFP vive en cargo_vuelta_cases.estado.';



COMMENT ON COLUMN "public"."clientes"."monto_moroso" IS 'Monto moroso según Hy-Cite al último corte de importación. UI label: "Monto Moroso Hy-Cite". Snapshot externo — puede diferir del Saldo Operativo Interno del caso DFP.';



COMMENT ON COLUMN "public"."clientes"."dias_atraso" IS 'Días de atraso según Hy-Cite al último corte de importación. UI label: "Días de Atraso Hy-Cite". Snapshot externo — no lo usa el motor DFP Revolving para calcular intereses o late fees.';



COMMENT ON COLUMN "public"."clientes"."next_action_date" IS 'Fecha de la próxima acción o cita programada';



COMMENT ON COLUMN "public"."clientes"."next_action" IS 'Descripción de la próxima acción o cita';



COMMENT ON COLUMN "public"."clientes"."persona_id" IS 'FK al registro de persona física en public.personas. NULL en registros históricos sin persona vinculada.';



COMMENT ON COLUMN "public"."clientes"."estado_operativo" IS 'Estado operativo derivado/importado para filtros operativos del CRM. Valores permitidos: activo, inactivo, cancelado.';



COMMENT ON COLUMN "public"."clientes"."fuente_import" IS 'Canal de importación que creó el registro (e.g. import_imagen_gdrive, csv, manual).';



COMMENT ON COLUMN "public"."clientes"."import_file_name" IS 'Nombre del archivo de Drive del que proviene este registro.';



COMMENT ON COLUMN "public"."clientes"."import_drive_url" IS 'URL de Google Drive del archivo fuente (webViewLink).';



COMMENT ON COLUMN "public"."clientes"."apartamento" IS 'Apartamento o unidad de la dirección (extraído por OCR).';



COMMENT ON COLUMN "public"."clientes"."tipo_cuenta_hycite" IS 'Tipo de cuenta Hy-Cite (Quality of Life, etc.).';



COMMENT ON COLUMN "public"."clientes"."pago_minimo_mensual" IS 'Pago mínimo mensual Hy-Cite (extraído por OCR).';



COMMENT ON COLUMN "public"."clientes"."factor_ingresos" IS 'Factor de ingresos declarado (extraído por OCR).';



COMMENT ON COLUMN "public"."clientes"."estado_cuenta_raw" IS 'Estado de cuenta tal como llega en el archivo Hy-Cite, sin normalizar. Preservado para auditoría y reconciliación.';



COMMENT ON COLUMN "public"."clientes"."vendedor_hycite_nombre" IS 'Nombre del vendedor Hy-Cite en el documento.';



COMMENT ON COLUMN "public"."clientes"."whatsapp_opt_in" IS 'Consentimiento explicito para recibir campanas WhatsApp.';



COMMENT ON COLUMN "public"."clientes"."whatsapp_no_molestar" IS 'Bloquea campanas WhatsApp aunque exista opt-in.';



COMMENT ON COLUMN "public"."clientes"."whatsapp_ultimo_envio_at" IS 'Ultimo envio WhatsApp registrado desde outbox_messages.';



COMMENT ON COLUMN "public"."clientes"."whatsapp_consent_source" IS 'Fuente del consentimiento WhatsApp: formulario, manual, importacion, contrato, etc.';



COMMENT ON COLUMN "public"."clientes"."whatsapp_consented_at" IS 'Fecha/hora en que se registro el consentimiento WhatsApp.';



CREATE TABLE IF NOT EXISTS "public"."clientes_rp" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "direccion" "text",
    "ciudad" "text",
    "estado" "text",
    "zip" "text",
    "telefono_casa" "text",
    "telefono_movil" "text",
    "telefono_trabajo" "text",
    "email" "text",
    "tipo_cuenta" "text",
    "nivel_financiamiento" "text",
    "metodo_pago" "text",
    "pago_minimo" numeric DEFAULT 0,
    "fecha_orden" "text",
    "fecha_ultimo_pedido" "text",
    "fecha_ultimo_pago" "text",
    "fecha_cierre" "text",
    "saldo_actual" numeric DEFAULT 0,
    "credito_disponible" numeric DEFAULT 0,
    "factor_ingresos" numeric DEFAULT 0,
    "estado_cuenta" "text",
    "dias_atraso_categoria" "text",
    "emprendedor_codigo" "text",
    "emprendedor_nombre" "text",
    "tipo_cliente" "text" DEFAULT 'cliente_existente'::"text" NOT NULL,
    "origen" "text" DEFAULT 'import_ocr_rp'::"text" NOT NULL,
    "confianza" integer DEFAULT 0,
    "_source_file" "text",
    "_processed_at" timestamp with time zone DEFAULT "now"(),
    "cliente_id" "uuid",
    "merge_status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "merge_at" timestamp with time zone,
    "merge_by" "uuid",
    "merge_notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid",
    "source_id" "text",
    "file_id" "text",
    "run_id" "text",
    "apellido" "text",
    CONSTRAINT "clientes_rp_confianza_check" CHECK ((("confianza" >= 0) AND ("confianza" <= 100))),
    CONSTRAINT "clientes_rp_dias_atraso_categoria_check" CHECK (("dias_atraso_categoria" = ANY (ARRAY['0-30'::"text", '30-60'::"text", '60+'::"text", 'none'::"text", ''::"text"]))),
    CONSTRAINT "clientes_rp_estado_cuenta_check" CHECK (("estado_cuenta" = ANY (ARRAY['activo'::"text", 'atrasado'::"text", 'cerrado'::"text", ''::"text"]))),
    CONSTRAINT "clientes_rp_merge_status_check" CHECK (("merge_status" = ANY (ARRAY['pendiente'::"text", 'mergeado'::"text", 'descartado'::"text", 'duplicado'::"text"])))
);


ALTER TABLE "public"."clientes_rp" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clientes_rp"."org_id" IS 'Organización propietaria (de import_configs.org_id).';



COMMENT ON COLUMN "public"."clientes_rp"."source_id" IS 'Carpeta Drive de origen (import_configs.source_id).';



COMMENT ON COLUMN "public"."clientes_rp"."file_id" IS 'ID del archivo en Google Drive.';



COMMENT ON COLUMN "public"."clientes_rp"."run_id" IS 'ID de ejecución n8n (trazabilidad).';



COMMENT ON COLUMN "public"."clientes_rp"."apellido" IS 'Apellido(s) del cliente. Puede ser heurístico si el OCR entregó nombre completo en el campo nombre.';



CREATE TABLE IF NOT EXISTS "public"."cob_acuerdo_eventos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "acuerdo_id" "uuid" NOT NULL,
    "cobro_programado_id" "uuid",
    "tipo_evento" "text" NOT NULL,
    "actor_user_id" "uuid",
    "payload_before" "jsonb",
    "payload_after" "jsonb",
    "motivo" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_cob_acuerdo_evento_tipo" CHECK (("tipo_evento" = ANY (ARRAY['acuerdo_creado'::"text", 'acuerdo_editado'::"text", 'acuerdo_pausado'::"text", 'acuerdo_cancelado'::"text", 'acuerdo_completado'::"text", 'acuerdo_renegociado'::"text", 'monto_cambiado'::"text", 'metodo_cambiado'::"text", 'cobro_programado_creado'::"text", 'cobro_recordatorio_enviado'::"text", 'cobro_procesando'::"text", 'cobro_exitoso'::"text", 'cobro_fallido'::"text", 'cobro_vencido'::"text", 'cobro_cancelado'::"text"])))
);


ALTER TABLE "public"."cob_acuerdo_eventos" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_acuerdo_eventos" IS 'Auditoría técnica del ciclo de vida de acuerdos y cobros programados DFP.';



CREATE TABLE IF NOT EXISTS "public"."cob_acuerdos_pago_automatico" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "cargo_vuelta_case_id" "uuid" NOT NULL,
    "revolving_account_id" "uuid",
    "metodo_pago_id" "uuid",
    "monto_base_mensual" numeric(12,2) NOT NULL,
    "porcentaje_cargo_autorizado" numeric(5,2) DEFAULT 0 NOT NULL,
    "monto_total_cobro" numeric(12,2) NOT NULL,
    "frecuencia" "text" DEFAULT 'mensual'::"text" NOT NULL,
    "dia_cobro_preferido" integer NOT NULL,
    "fecha_primer_cobro" "date" NOT NULL,
    "fecha_proximo_cobro" "date",
    "fecha_ultimo_cobro" "date",
    "statement_automatico" boolean DEFAULT true NOT NULL,
    "recordatorio_automatico" boolean DEFAULT true NOT NULL,
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "autorizado_por_cliente" boolean DEFAULT false NOT NULL,
    "fecha_autorizacion" timestamp with time zone,
    "canal_autorizacion" "text",
    "notas" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_cob_acuerdo_autorizacion" CHECK ((("autorizado_por_cliente" = false) OR (("autorizado_por_cliente" = true) AND ("fecha_autorizacion" IS NOT NULL)))),
    CONSTRAINT "chk_cob_acuerdo_dia_cobro" CHECK ((("dia_cobro_preferido" >= 1) AND ("dia_cobro_preferido" <= 31))),
    CONSTRAINT "chk_cob_acuerdo_estado" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'activo'::"text", 'pausado'::"text", 'cancelado'::"text", 'completado'::"text"]))),
    CONSTRAINT "chk_cob_acuerdo_frecuencia" CHECK (("frecuencia" = 'mensual'::"text")),
    CONSTRAINT "chk_cob_acuerdo_monto_base" CHECK (("monto_base_mensual" > (0)::numeric)),
    CONSTRAINT "chk_cob_acuerdo_monto_total" CHECK (("monto_total_cobro" > (0)::numeric)),
    CONSTRAINT "chk_cob_acuerdo_porcentaje" CHECK ((("porcentaje_cargo_autorizado" >= (0)::numeric) AND ("porcentaje_cargo_autorizado" <= (100)::numeric)))
);


ALTER TABLE "public"."cob_acuerdos_pago_automatico" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_acuerdos_pago_automatico" IS 'Acuerdo de pago automático DFP: regla operativa recurrente por caso/cliente.';



COMMENT ON COLUMN "public"."cob_acuerdos_pago_automatico"."metadata" IS 'Metadatos operativos del acuerdo (no financieros).';



CREATE TABLE IF NOT EXISTS "public"."cob_cobros_programados" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "acuerdo_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "cargo_vuelta_case_id" "uuid" NOT NULL,
    "statement_id" "uuid",
    "pago_id" "uuid",
    "metodo_pago_id" "uuid",
    "fecha_programada" "date" NOT NULL,
    "monto_programado" numeric(12,2) NOT NULL,
    "estado" "text" DEFAULT 'programado'::"text" NOT NULL,
    "intento_numero" integer DEFAULT 0 NOT NULL,
    "provider" "text",
    "provider_reference" "text",
    "error_code" "text",
    "error_message" "text",
    "notas" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_cob_cobro_prog_estado" CHECK (("estado" = ANY (ARRAY['programado'::"text", 'recordatorio_enviado'::"text", 'procesando'::"text", 'pagado'::"text", 'fallido'::"text", 'vencido'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "chk_cob_cobro_prog_intento" CHECK (("intento_numero" >= 0)),
    CONSTRAINT "chk_cob_cobro_prog_monto" CHECK (("monto_programado" > (0)::numeric))
);


ALTER TABLE "public"."cob_cobros_programados" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_cobros_programados" IS 'Cobro programado DFP: intento futuro de cobro; no impacta ledger por sí solo.';



COMMENT ON COLUMN "public"."cob_cobros_programados"."metadata" IS 'Metadatos operativos del intento de cobro (provider, orquestación, etc.).';



CREATE TABLE IF NOT EXISTS "public"."cob_cv_balance_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "clase" "text" NOT NULL,
    "motivo" "text" NOT NULL,
    "monto_aplicado_balance" numeric(12,2) NOT NULL,
    "fecha_ajuste" "date" NOT NULL,
    "descripcion" "text",
    "soporte_url" "text",
    "status" "text" DEFAULT 'activo'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cob_cv_balance_adjustments_clase_check" CHECK (("clase" = ANY (ARRAY['credito'::"text", 'ajuste'::"text"]))),
    CONSTRAINT "cob_cv_balance_adjustments_monto_aplicado_balance_check" CHECK (("monto_aplicado_balance" >= (0)::numeric)),
    CONSTRAINT "cob_cv_balance_adjustments_motivo_check" CHECK (("motivo" = ANY (ARRAY['devolucion_parcial_mercancia'::"text", 'bonificacion_comercial'::"text", 'ajuste_manual'::"text", 'otro'::"text"]))),
    CONSTRAINT "cob_cv_balance_adjustments_status_check" CHECK (("status" = ANY (ARRAY['activo'::"text", 'anulado'::"text"])))
);


ALTER TABLE "public"."cob_cv_balance_adjustments" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_cv_balance_adjustments" IS 'Fuente operativa de créditos y ajustes que reducen balance en casos Cargo de Vuelta. Soporta devoluciones parciales de mercancía y ajustes auditados sin mezclar esta lógica con DFP.';



COMMENT ON COLUMN "public"."cob_cv_balance_adjustments"."clase" IS 'credito = reducción del balance por crédito otorgado; ajuste = reducción operativa/manual del balance.';



COMMENT ON COLUMN "public"."cob_cv_balance_adjustments"."monto_aplicado_balance" IS 'Monto que reduce directamente el balance operativo del caso. Siempre positivo en esta fase.';



CREATE TABLE IF NOT EXISTS "public"."cob_cv_resumen_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "resumen_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "line_number" integer NOT NULL,
    "line_type" "text" NOT NULL,
    "source_table" "text",
    "source_id" "uuid",
    "event_date" "date",
    "description" "text" NOT NULL,
    "monto_aplicado_balance" numeric(12,2) DEFAULT 0 NOT NULL,
    "fee_plataforma" numeric(12,2) DEFAULT 0 NOT NULL,
    "monto_total_cobrado_cliente" numeric(12,2) DEFAULT 0 NOT NULL,
    "running_balance_after" numeric(12,2),
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cob_cv_resumen_lines_amounts_chk" CHECK ((("monto_aplicado_balance" >= (0)::numeric) AND ("fee_plataforma" >= (0)::numeric) AND ("monto_total_cobrado_cliente" >= (0)::numeric))),
    CONSTRAINT "cob_cv_resumen_lines_line_number_check" CHECK (("line_number" > 0)),
    CONSTRAINT "cob_cv_resumen_lines_line_type_check" CHECK (("line_type" = ANY (ARRAY['saldo_apertura'::"text", 'pago'::"text", 'credito'::"text", 'ajuste'::"text", 'saldo_cierre'::"text", 'proximo_pago'::"text"])))
);


ALTER TABLE "public"."cob_cv_resumen_lines" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_cv_resumen_lines" IS 'Detalle histórico del resumen mensual de Cargo de Vuelta. Guarda eventos de apertura, pagos, créditos, ajustes, cierre y próximo pago esperado.';



COMMENT ON COLUMN "public"."cob_cv_resumen_lines"."running_balance_after" IS 'Saldo pendiente inmediatamente después de aplicar la línea dentro del documento.';



CREATE TABLE IF NOT EXISTS "public"."cob_cv_resumenes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "periodo_inicio" "date" NOT NULL,
    "periodo_fin" "date" NOT NULL,
    "fecha_corte" "date" NOT NULL,
    "monto_devuelto_snapshot" numeric(12,2),
    "monto_total_legacy_snapshot" numeric(12,2),
    "monto_original" numeric(12,2) NOT NULL,
    "monto_base_source" "text" NOT NULL,
    "requiere_reconciliacion_snapshot" boolean DEFAULT false NOT NULL,
    "saldo_apertura_periodo" numeric(12,2) NOT NULL,
    "pagos_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "pagos_acumulados" numeric(12,2) DEFAULT 0 NOT NULL,
    "fee_plataforma_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "fee_plataforma_acumulado" numeric(12,2) DEFAULT 0 NOT NULL,
    "monto_total_cobrado_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "monto_total_cobrado_acumulado" numeric(12,2) DEFAULT 0 NOT NULL,
    "creditos_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "creditos_acumulados" numeric(12,2) DEFAULT 0 NOT NULL,
    "ajustes_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "ajustes_acumulados" numeric(12,2) DEFAULT 0 NOT NULL,
    "saldo_pendiente_corte" numeric(12,2) NOT NULL,
    "proximo_pago_esperado" numeric(12,2),
    "fecha_proximo_pago" "date",
    "fuente_proximo_pago" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "outbox_message_id" "uuid",
    "generated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cob_cv_resumenes_ajustes_acumulados_check" CHECK (("ajustes_acumulados" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_ajustes_periodo_check" CHECK (("ajustes_periodo" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_creditos_acumulados_check" CHECK (("creditos_acumulados" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_creditos_periodo_check" CHECK (("creditos_periodo" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_fee_plataforma_acumulado_check" CHECK (("fee_plataforma_acumulado" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_fee_plataforma_periodo_check" CHECK (("fee_plataforma_periodo" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_monto_base_source_check" CHECK (("monto_base_source" = ANY (ARRAY['monto_devuelto'::"text", 'monto_total_legacy'::"text"]))),
    CONSTRAINT "cob_cv_resumenes_monto_original_check" CHECK (("monto_original" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_monto_total_cobrado_acumulado_check" CHECK (("monto_total_cobrado_acumulado" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_monto_total_cobrado_periodo_check" CHECK (("monto_total_cobrado_periodo" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_pagos_acumulados_check" CHECK (("pagos_acumulados" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_pagos_periodo_check" CHECK (("pagos_periodo" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_periodo_chk" CHECK ((("periodo_fin" >= "periodo_inicio") AND ("fecha_corte" >= "periodo_inicio") AND ("fecha_corte" <= "periodo_fin"))),
    CONSTRAINT "cob_cv_resumenes_saldo_apertura_periodo_check" CHECK (("saldo_apertura_periodo" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_saldo_pendiente_corte_check" CHECK (("saldo_pendiente_corte" >= (0)::numeric)),
    CONSTRAINT "cob_cv_resumenes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'enviado'::"text", 'anulado'::"text"])))
);


ALTER TABLE "public"."cob_cv_resumenes" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_cv_resumenes" IS 'Snapshot histórico mensual del balance recuperable de un caso Cargo de Vuelta. Cada fila representa un documento inmutable por período y siempre nace en draft en esta fase.';



COMMENT ON COLUMN "public"."cob_cv_resumenes"."monto_original" IS 'Monto base del caso para el snapshot. La fuente oficial esperada es cargo_vuelta_cases.monto_devuelto; se permite fallback a monto_total_legacy solo para compatibilidad mientras existan casos legacy.';



COMMENT ON COLUMN "public"."cob_cv_resumenes"."pagos_periodo" IS 'Monto aplicado al balance dentro del período. No incluye fee de plataforma.';



COMMENT ON COLUMN "public"."cob_cv_resumenes"."monto_total_cobrado_periodo" IS 'Monto total cobrado al cliente en el período: pagos_periodo + fee_plataforma_periodo.';



COMMENT ON COLUMN "public"."cob_cv_resumenes"."saldo_pendiente_corte" IS 'Saldo pendiente al corte calculado como monto_original - pagos_acumulados - creditos_acumulados - ajustes_acumulados.';



CREATE TABLE IF NOT EXISTS "public"."cob_document_generation_run_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "org_id" "uuid",
    "case_id" "uuid",
    "cliente_id" "uuid",
    "document_type" "text" NOT NULL,
    "period_start" "date",
    "period_end" "date",
    "result" "text" NOT NULL,
    "document_id" "uuid",
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cob_document_generation_run_items_document_type_check" CHECK (("document_type" = ANY (ARRAY['dfp_statement'::"text", 'cv_resumen'::"text"]))),
    CONSTRAINT "cob_document_generation_run_items_result_check" CHECK (("result" = ANY (ARRAY['generated'::"text", 'skipped_duplicate'::"text", 'skipped_not_eligible'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."cob_document_generation_run_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_document_generation_run_items" IS 'Detalle por caso de una corrida del job documental. Permite auditar duplicados evitados, no elegibles y errores sin enviar mensajes todavía.';



CREATE TABLE IF NOT EXISTS "public"."cob_document_generation_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "job_name" "text" NOT NULL,
    "run_date" "date" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "dfp_generated" integer DEFAULT 0 NOT NULL,
    "dfp_skipped" integer DEFAULT 0 NOT NULL,
    "cv_generated" integer DEFAULT 0 NOT NULL,
    "cv_skipped" integer DEFAULT 0 NOT NULL,
    "errors_count" integer DEFAULT 0 NOT NULL,
    "error_summary" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cob_document_generation_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'completed_with_errors'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."cob_document_generation_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_document_generation_runs" IS 'Auditoría de corridas del job diario de generación de statements/resúmenes. Preparado para futura orquestación automática sin activar cron en esta fase.';



CREATE TABLE IF NOT EXISTS "public"."cob_financial_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "revolving_account_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "plan_id" "uuid",
    "cuota_id" "uuid",
    "pago_id" "uuid",
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "effective_date" "date" NOT NULL,
    "entry_type" "text" NOT NULL,
    "component_type" "text" NOT NULL,
    "debit_credit" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text",
    "accrual_from" "date",
    "accrual_to" "date",
    "balance_principal_after" numeric(12,2),
    "balance_interest_after" numeric(12,2),
    "balance_fees_after" numeric(12,2),
    "balance_total_after" numeric(12,2),
    "reverses_ledger_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cob_financial_ledger_accrual_fechas_chk" CHECK ((("entry_type" <> 'finance_charge_accrual'::"text") OR (("accrual_from" IS NOT NULL) AND ("accrual_to" IS NOT NULL) AND ("accrual_to" > "accrual_from")))),
    CONSTRAINT "cob_financial_ledger_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "cob_financial_ledger_balance_fees_chk" CHECK ((("balance_fees_after" IS NULL) OR ("balance_fees_after" >= (0)::numeric))),
    CONSTRAINT "cob_financial_ledger_balance_interest_chk" CHECK ((("balance_interest_after" IS NULL) OR ("balance_interest_after" >= (0)::numeric))),
    CONSTRAINT "cob_financial_ledger_balance_principal_chk" CHECK ((("balance_principal_after" IS NULL) OR ("balance_principal_after" >= (0)::numeric))),
    CONSTRAINT "cob_financial_ledger_balance_total_after_chk" CHECK ((("balance_total_after" IS NULL) OR ("balance_total_after" >= (0)::numeric))),
    CONSTRAINT "cob_financial_ledger_component_type_check" CHECK (("component_type" = ANY (ARRAY['principal'::"text", 'interest'::"text", 'fee'::"text"]))),
    CONSTRAINT "cob_financial_ledger_debit_credit_check" CHECK (("debit_credit" = ANY (ARRAY['debit'::"text", 'credit'::"text"]))),
    CONSTRAINT "cob_financial_ledger_entry_type_check" CHECK (("entry_type" = ANY (ARRAY['principal_initial'::"text", 'finance_charge_accrual'::"text", 'late_fee_assessed'::"text", 'payment_applied'::"text", 'adjustment'::"text", 'writeoff'::"text", 'reversal'::"text"]))),
    CONSTRAINT "cob_financial_ledger_reversal_ref_chk" CHECK ((("entry_type" <> 'reversal'::"text") OR ("reverses_ledger_id" IS NOT NULL)))
);


ALTER TABLE "public"."cob_financial_ledger" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_financial_ledger" IS 'Ledger financiero DFP Revolving — append-only e inmutable. RLS restringido por org_id (0119/0120). Lectura: roles de cartera de la misma organización. INSERT directo bloqueado por policy WITH CHECK (false). UPDATE/DELETE denegados (sin policy permisiva). Movimientos financieros exclusivamente vía RPCs SECURITY DEFINER (0122+). anon sin grant directo desde 0124.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."revolving_account_id" IS 'FK a la cuenta revolving DFP (cob_revolving_accounts). Todos los entries de un caso se agrupan bajo la misma cuenta revolving.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."case_id" IS 'FK desnormalizada al caso de Cargo de Vuelta. Preservada para auditoría independiente: permite reconstruir el historial del caso incluso si la cuenta revolving fuera eliminada (no debería ocurrir por ON DELETE RESTRICT).';



COMMENT ON COLUMN "public"."cob_financial_ledger"."cliente_id" IS 'FK desnormalizada al cliente. Preservada para auditoría independiente.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."plan_id" IS 'FK opcional al plan de pagos (cob_plan_pagos). Presente cuando el pago responde a un plan.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."cuota_id" IS 'FK opcional a la cuota específica del plan (cob_plan_cuotas).';



COMMENT ON COLUMN "public"."cob_financial_ledger"."pago_id" IS 'FK opcional al registro de pago (cob_pagos) que originó este entry.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."entry_date" IS 'Fecha en que se registró el entry en FlowSuite (puede diferir de effective_date).';



COMMENT ON COLUMN "public"."cob_financial_ledger"."effective_date" IS 'Fecha financiera del evento. Para devengos: último día del rango de accrual. Para pagos: fecha real del pago recibido.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."entry_type" IS 'Tipo de movimiento financiero. Valores: principal_initial (apertura de cuenta), finance_charge_accrual (devengo de interés diario), late_fee_assessed (cargo de mora), payment_applied (pago recibido con waterfall fee→interés→principal), adjustment (ajuste manual auditado), writeoff (castigo contable de saldo residual), reversal (anulación de otro entry — requiere reverses_ledger_id).';



COMMENT ON COLUMN "public"."cob_financial_ledger"."component_type" IS 'Componente financiero afectado por este entry. principal: afecta saldo_principal. interest: afecta saldo_interes. fee: afecta saldo_fees.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."debit_credit" IS 'Dirección del movimiento. debit: aumenta el saldo del componente (cargo al cliente). credit: reduce el saldo del componente (pago o reverso a favor del cliente).';



COMMENT ON COLUMN "public"."cob_financial_ledger"."amount" IS 'Monto siempre positivo. La dirección la determina debit_credit.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."description" IS 'Descripción libre del entry para auditoría. Ejemplo: "Pago recibido en efectivo 2026-04-20", "Devengo interés 2026-04-01/2026-04-30".';



COMMENT ON COLUMN "public"."cob_financial_ledger"."accrual_from" IS 'Inicio del rango de devengo (inclusivo). Solo para entry_type=finance_charge_accrual.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."accrual_to" IS 'Fin del rango de devengo (exclusivo del día final). Solo para finance_charge_accrual. Unique parcial con accrual_from y revolving_account_id previene doble devengo.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."balance_principal_after" IS 'Saldo de principal de la cuenta revolving inmediatamente después de este entry. Snapshot del momento — permite reconstruir el estado exacto en cualquier punto del tiempo.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."balance_interest_after" IS 'Saldo de interés de la cuenta revolving inmediatamente después de este entry.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."balance_fees_after" IS 'Saldo de fees de la cuenta revolving inmediatamente después de este entry.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."balance_total_after" IS 'Saldo total (principal + interés + fees) inmediatamente después de este entry. Constraint: >= 0.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."reverses_ledger_id" IS 'FK al entry que este reverso anula. Obligatorio cuando entry_type=reversal. Unique parcial garantiza que cada entry solo puede ser revertido una vez.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."metadata" IS 'JSONB libre para contexto adicional: APR usado en el cálculo, días devengados, ID externo de referencia, usuario aprobador, canal de pago, etc.';



COMMENT ON COLUMN "public"."cob_financial_ledger"."created_by" IS 'Usuario de FlowSuite que originó este entry (via función SECURITY DEFINER). NULL si fue generado por un job automático sin sesión de usuario.';



CREATE TABLE IF NOT EXISTS "public"."cob_gestiones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "factura_id" "uuid",
    "tipo_gestion" "text" NOT NULL,
    "resultado" "text",
    "monto_comprometido" numeric(12,2),
    "fecha_compromiso" "date",
    "notas" "text",
    "gestionado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "case_id" "uuid",
    "ptp_id" "uuid"
);


ALTER TABLE "public"."cob_gestiones" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cob_gestiones"."case_id" IS 'FK opcional al caso central de cartera/cobranza (cargo_vuelta_cases).';



COMMENT ON COLUMN "public"."cob_gestiones"."ptp_id" IS 'PTP formal originado por esta gestión. FK inversa a cob_ptps(id). La relación canónica es cob_ptps.gestion_id; este campo es conveniencia de lectura.';



CREATE TABLE IF NOT EXISTS "public"."cob_metodos_pago" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "cargo_vuelta_case_id" "uuid",
    "provider" "text",
    "token_ref" "text" NOT NULL,
    "brand" "text",
    "last4" "text",
    "exp_month" integer,
    "exp_year" integer,
    "nombre_tarjeta" "text",
    "billing_zip" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "estado" "text" DEFAULT 'activo'::"text" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "notas" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display" "text",
    CONSTRAINT "chk_cob_metodos_pago_estado" CHECK (("estado" = ANY (ARRAY['activo'::"text", 'inactivo'::"text", 'expirado'::"text", 'reemplazado'::"text", 'fallido'::"text"]))),
    CONSTRAINT "chk_cob_metodos_pago_exp_month" CHECK ((("exp_month" IS NULL) OR (("exp_month" >= 1) AND ("exp_month" <= 12)))),
    CONSTRAINT "chk_cob_metodos_pago_exp_year" CHECK ((("exp_year" IS NULL) OR (("exp_year" >= 2020) AND ("exp_year" <= 2099)))),
    CONSTRAINT "chk_cob_metodos_pago_last4" CHECK ((("last4" IS NULL) OR (("length"("last4") <= 4) AND ("last4" ~ '^[0-9]{1,4}$'::"text")))),
    CONSTRAINT "chk_cob_metodos_pago_source" CHECK (("source" = ANY (ARRAY['manual'::"text", 'import'::"text", 'portal'::"text", 'n8n'::"text"])))
);


ALTER TABLE "public"."cob_metodos_pago" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_metodos_pago" IS 'Métodos de pago por cliente/caso. Solo tokens/referencias — nunca PAN ni CVV.';



COMMENT ON COLUMN "public"."cob_metodos_pago"."token_ref" IS 'Token o referencia del procesador. Nunca guardar número completo de tarjeta.';



COMMENT ON COLUMN "public"."cob_metodos_pago"."last4" IS 'Últimos 4 dígitos, solo para presentación.';



COMMENT ON COLUMN "public"."cob_metodos_pago"."is_default" IS 'Método de pago activo preferido del cliente en este org.';



COMMENT ON COLUMN "public"."cob_metodos_pago"."estado" IS 'activo | inactivo | expirado | reemplazado | fallido';



COMMENT ON COLUMN "public"."cob_metodos_pago"."source" IS 'manual | import | portal | n8n';



COMMENT ON COLUMN "public"."cob_metodos_pago"."display" IS 'Texto seguro de presentacion del metodo de pago. No debe contener PAN completo ni CVV.';



CREATE TABLE IF NOT EXISTS "public"."cob_pagos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "cargo_vuelta_case_id" "uuid",
    "ptp_id" "uuid",
    "monto" numeric(12,2) NOT NULL,
    "fecha_pago" "date" DEFAULT CURRENT_DATE NOT NULL,
    "metodo_pago" "text" DEFAULT 'otro'::"text" NOT NULL,
    "referencia" "text",
    "notas" "text",
    "creado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revolving_account_id" "uuid",
    "moneda" "text" DEFAULT 'USD'::"text" NOT NULL,
    "referencia_externa" "text",
    "comprobante_url" "text",
    "estado" "text" DEFAULT 'registrado'::"text" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "external_id" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_by" "uuid",
    "monto_aplicado_balance" numeric(12,2),
    "fee_plataforma" numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "cob_pagos_estado_check" CHECK (("estado" = ANY (ARRAY['registrado'::"text", 'validado'::"text", 'rechazado'::"text", 'reversado'::"text"]))),
    CONSTRAINT "cob_pagos_fee_plataforma_check" CHECK (("fee_plataforma" >= (0)::numeric)),
    CONSTRAINT "cob_pagos_metodo_pago_check" CHECK (("metodo_pago" = ANY (ARRAY['cash'::"text", 'check'::"text", 'zelle'::"text", 'ach'::"text", 'card'::"text", 'hycite'::"text", 'wire'::"text", 'otro'::"text"]))),
    CONSTRAINT "cob_pagos_monto_aplicado_balance_check" CHECK ((("monto_aplicado_balance" IS NULL) OR ("monto_aplicado_balance" >= (0)::numeric))),
    CONSTRAINT "cob_pagos_monto_check" CHECK (("monto" > (0)::numeric)),
    CONSTRAINT "cob_pagos_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'import'::"text", 'hycite'::"text", 'n8n'::"text", 'api'::"text"])))
);


ALTER TABLE "public"."cob_pagos" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_pagos" IS 'Pagos reales recibidos de clientes. Linkeable a PTP (cob_ptps) y/o cuota de plan (cob_plan_cuotas). Fuente de verdad operativa.';



COMMENT ON COLUMN "public"."cob_pagos"."monto" IS 'Campo legacy del monto recibido. Para resúmenes nuevos, el saldo del caso debe calcularse usando monto_aplicado_balance si existe; si es null, se asume que monto se aplicó completo al balance.';



COMMENT ON COLUMN "public"."cob_pagos"."monto_aplicado_balance" IS 'Monto del cobro que realmente reduce el balance del caso. Debe excluir fee de plataforma, recargos de procesador u otros montos que no reduzcan principal operativo.';



COMMENT ON COLUMN "public"."cob_pagos"."fee_plataforma" IS 'Fee cobrado al cliente por plataforma/pasarela/tarjeta. Nunca reduce el balance principal operativo del caso.';



CREATE TABLE IF NOT EXISTS "public"."cob_plan_cuotas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "pago_id" "uuid",
    "numero_cuota" integer NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "fecha_vencimiento" "date" NOT NULL,
    "fecha_pago" "date",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan_pago_id" "uuid" NOT NULL,
    "cargo_vuelta_case_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "monto_programado" numeric(12,2) NOT NULL,
    "principal_programado" numeric(12,2) DEFAULT 0 NOT NULL,
    "interes_programado" numeric(12,2) DEFAULT 0 NOT NULL,
    "fees_programados" numeric(12,2) DEFAULT 0 NOT NULL,
    "monto_pagado" numeric(12,2) DEFAULT 0 NOT NULL,
    "saldo_cuota" numeric(12,2) DEFAULT 0 NOT NULL,
    "cob_pago_id" "uuid",
    "paid_at" timestamp with time zone,
    CONSTRAINT "chk_cob_plan_cuotas_estado" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'programada'::"text", 'pagada'::"text", 'parcial'::"text", 'vencida'::"text", 'omitida'::"text", 'cancelada'::"text"]))),
    CONSTRAINT "chk_cob_plan_cuotas_montos_non_negative" CHECK ((("monto_programado" >= (0)::numeric) AND ("principal_programado" >= (0)::numeric) AND ("interes_programado" >= (0)::numeric) AND ("fees_programados" >= (0)::numeric) AND ("monto_pagado" >= (0)::numeric) AND ("saldo_cuota" >= (0)::numeric))),
    CONSTRAINT "chk_cob_plan_cuotas_numero_cuota" CHECK (("numero_cuota" > 0)),
    CONSTRAINT "cob_plan_cuotas_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'pagada'::"text", 'vencida'::"text", 'cancelada'::"text"]))),
    CONSTRAINT "cob_plan_cuotas_monto_check" CHECK (("monto" > (0)::numeric)),
    CONSTRAINT "cob_plan_cuotas_numero_cuota_check" CHECK (("numero_cuota" > 0))
);


ALTER TABLE "public"."cob_plan_cuotas" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_plan_cuotas" IS 'Cuotas individuales del plan de pagos. Una cuota pasa de pendiente a pagada cuando se registra un cob_pagos y se vincula via pago_id.';



COMMENT ON COLUMN "public"."cob_plan_cuotas"."pago_id" IS 'FK al pago que cubrió esta cuota. Un mismo pago puede cubrir varias cuotas.';



CREATE TABLE IF NOT EXISTS "public"."cob_plan_pagos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "monto_total" numeric(12,2) NOT NULL,
    "numero_cuotas" integer NOT NULL,
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "notas" "text",
    "creado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cargo_vuelta_case_id" "uuid",
    "metodo_pago_id" "uuid",
    "tipo_plan" "text" DEFAULT 'refinanciamiento'::"text" NOT NULL,
    "principal_original" numeric(12,2),
    "balance_inicial" numeric(12,2),
    "tasa_anual_pct" numeric(6,3),
    "tasa_mensual_pct" numeric(6,3),
    "monto_cuota" numeric(12,2),
    "dia_debito" integer,
    "fecha_inicio" "date",
    "fecha_primer_pago" "date",
    "fecha_fin_estimada" "date",
    "fee_setup" numeric(12,2) DEFAULT 0 NOT NULL,
    "fee_late" numeric(12,2) DEFAULT 0 NOT NULL,
    "moneda" "text" DEFAULT 'USD'::"text" NOT NULL,
    "acuerdo_generado_at" timestamp with time zone,
    "acuerdo_firmado_at" timestamp with time zone,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_by" "uuid",
    CONSTRAINT "chk_cob_plan_pagos_dia_debito" CHECK ((("dia_debito" IS NULL) OR (("dia_debito" >= 1) AND ("dia_debito" <= 31)))),
    CONSTRAINT "chk_cob_plan_pagos_estado" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'activo'::"text", 'pausado'::"text", 'cumplido'::"text", 'incumplido'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "chk_cob_plan_pagos_moneda" CHECK (("moneda" = 'USD'::"text")),
    CONSTRAINT "chk_cob_plan_pagos_montos_non_negative" CHECK (((("principal_original" IS NULL) OR ("principal_original" >= (0)::numeric)) AND (("balance_inicial" IS NULL) OR ("balance_inicial" >= (0)::numeric)) AND (("monto_cuota" IS NULL) OR ("monto_cuota" >= (0)::numeric)) AND ("fee_setup" >= (0)::numeric) AND ("fee_late" >= (0)::numeric))),
    CONSTRAINT "chk_cob_plan_pagos_numero_cuotas" CHECK ((("numero_cuotas" IS NULL) OR (("numero_cuotas" > 0) AND ("numero_cuotas" <= 120)))),
    CONSTRAINT "chk_cob_plan_pagos_tasa_anual_pct" CHECK ((("tasa_anual_pct" IS NULL) OR (("tasa_anual_pct" >= (0)::numeric) AND ("tasa_anual_pct" <= (36)::numeric)))),
    CONSTRAINT "chk_cob_plan_pagos_tasa_mensual_pct" CHECK ((("tasa_mensual_pct" IS NULL) OR (("tasa_mensual_pct" >= (0)::numeric) AND ("tasa_mensual_pct" <= (3)::numeric)))),
    CONSTRAINT "chk_cob_plan_pagos_tipo_plan" CHECK (("tipo_plan" = ANY (ARRAY['refinanciamiento'::"text", 'promesa_pago'::"text", 'settlement'::"text", 'manual'::"text"]))),
    CONSTRAINT "cob_plan_pagos_monto_total_check" CHECK (("monto_total" > (0)::numeric)),
    CONSTRAINT "cob_plan_pagos_numero_cuotas_check" CHECK (("numero_cuotas" > 0))
);


ALTER TABLE "public"."cob_plan_pagos" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_plan_pagos" IS 'Plan de pagos acordado con el cliente, compuesto por cuotas rastreadas en cob_plan_cuotas.';



CREATE TABLE IF NOT EXISTS "public"."cob_ptps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "case_id" "uuid",
    "gestion_id" "uuid",
    "creado_por" "uuid",
    "updated_by" "uuid",
    "monto" numeric(12,2) NOT NULL,
    "fecha_compromiso" "date" NOT NULL,
    "fecha_cumplimiento" "date",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "canal" "text",
    "cumplido_at" timestamp with time zone,
    "incumplido_at" timestamp with time zone,
    CONSTRAINT "cob_ptps_canal_check" CHECK ((("canal" IS NULL) OR ("canal" = ANY (ARRAY['telefono'::"text", 'whatsapp'::"text", 'email'::"text", 'sms'::"text", 'presencial'::"text", 'otro'::"text"])))),
    CONSTRAINT "cob_ptps_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'cumplido'::"text", 'incumplido'::"text", 'vencido'::"text", 'cancelado'::"text", 'renegociada'::"text"]))),
    CONSTRAINT "cob_ptps_monto_check" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."cob_ptps" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_ptps" IS 'Promesas de Pago formales. Un PTP nace de una gestión de cobranza y tiene ciclo de vida propio: pendiente → cumplido | incumplido | vencido | cancelado.';



COMMENT ON COLUMN "public"."cob_ptps"."gestion_id" IS 'Gestión de cobranza que originó este PTP. UNIQUE: una gestión genera un PTP a la vez.';



COMMENT ON COLUMN "public"."cob_ptps"."fecha_cumplimiento" IS 'Fecha en que el cliente efectivamente pagó. NULL si no cumplió.';



COMMENT ON COLUMN "public"."cob_ptps"."canal" IS 'Canal por el que se recibió el compromiso de pago: llamada, whatsapp, email, presencial.';



COMMENT ON COLUMN "public"."cob_ptps"."cumplido_at" IS 'Timestamp exacto en que se registró el cumplimiento. Complementa fecha_cumplimiento (date legacy) con precisión de hora.';



COMMENT ON COLUMN "public"."cob_ptps"."incumplido_at" IS 'Timestamp exacto en que se registró el incumplimiento o vencimiento del PTP.';



CREATE TABLE IF NOT EXISTS "public"."cob_revolving_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "apr_anual" numeric(6,5) NOT NULL,
    "metodo_calculo_interes" "text" DEFAULT 'daily_simple_365'::"text" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "fecha_ultimo_devengo" "date" NOT NULL,
    "saldo_principal_inicial" numeric(12,2) NOT NULL,
    "saldo_principal_actual" numeric(12,2) DEFAULT 0 NOT NULL,
    "saldo_interes_actual" numeric(12,2) DEFAULT 0 NOT NULL,
    "saldo_fees_actual" numeric(12,2) DEFAULT 0 NOT NULL,
    "saldo_total_actual" numeric(12,2) GENERATED ALWAYS AS ((("saldo_principal_actual" + "saldo_interes_actual") + "saldo_fees_actual")) STORED,
    "late_fee_fijo" numeric(12,2),
    "late_fee_porcentaje" numeric(6,5),
    "dias_gracia_late_fee" integer DEFAULT 0 NOT NULL,
    "capitaliza_interes" boolean DEFAULT false NOT NULL,
    "capitaliza_fees" boolean DEFAULT false NOT NULL,
    "estado" "text" DEFAULT 'activo'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "statement_closing_day" smallint,
    "customer_preferred_payment_day" smallint,
    "min_days_statement_to_due" smallint DEFAULT 21 NOT NULL,
    "agreement_date" "date",
    CONSTRAINT "chk_cob_rev_closing_day_requires_min_days" CHECK ((("statement_closing_day" IS NULL) OR ("min_days_statement_to_due" IS NOT NULL))),
    CONSTRAINT "cob_revolving_accounts_apr_anual_check" CHECK ((("apr_anual" >= 0.10) AND ("apr_anual" <= 0.24))),
    CONSTRAINT "cob_revolving_accounts_customer_preferred_payment_day_check" CHECK ((("customer_preferred_payment_day" >= 1) AND ("customer_preferred_payment_day" <= 28))),
    CONSTRAINT "cob_revolving_accounts_dias_gracia_late_fee_check" CHECK (("dias_gracia_late_fee" >= 0)),
    CONSTRAINT "cob_revolving_accounts_estado_check" CHECK (("estado" = ANY (ARRAY['activo'::"text", 'moroso'::"text", 'en_plan'::"text", 'reestructurado'::"text", 'completado'::"text", 'cancelado'::"text", 'writeoff'::"text"]))),
    CONSTRAINT "cob_revolving_accounts_late_fee_exclusivo_chk" CHECK ((("late_fee_fijo" IS NULL) OR ("late_fee_porcentaje" IS NULL))),
    CONSTRAINT "cob_revolving_accounts_late_fee_fijo_check" CHECK ((("late_fee_fijo" IS NULL) OR ("late_fee_fijo" >= (0)::numeric))),
    CONSTRAINT "cob_revolving_accounts_late_fee_porcentaje_check" CHECK ((("late_fee_porcentaje" IS NULL) OR (("late_fee_porcentaje" >= (0)::numeric) AND ("late_fee_porcentaje" <= (1)::numeric)))),
    CONSTRAINT "cob_revolving_accounts_metodo_calculo_interes_check" CHECK (("metodo_calculo_interes" = 'daily_simple_365'::"text")),
    CONSTRAINT "cob_revolving_accounts_min_days_statement_to_due_check" CHECK (("min_days_statement_to_due" >= 7)),
    CONSTRAINT "cob_revolving_accounts_saldo_fees_actual_check" CHECK (("saldo_fees_actual" >= (0)::numeric)),
    CONSTRAINT "cob_revolving_accounts_saldo_interes_actual_check" CHECK (("saldo_interes_actual" >= (0)::numeric)),
    CONSTRAINT "cob_revolving_accounts_saldo_principal_actual_check" CHECK (("saldo_principal_actual" >= (0)::numeric)),
    CONSTRAINT "cob_revolving_accounts_saldo_principal_inicial_check" CHECK (("saldo_principal_inicial" >= (0)::numeric)),
    CONSTRAINT "cob_revolving_accounts_statement_closing_day_check" CHECK ((("statement_closing_day" >= 1) AND ("statement_closing_day" <= 28)))
);


ALTER TABLE "public"."cob_revolving_accounts" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_revolving_accounts" IS 'Cuenta financiera interna DFP Revolving. RLS restringido por org_id (0118). Lectura: roles de cartera de la misma organización. Mutaciones financieras deben pasar por RPCs SECURITY DEFINER (0122+). anon sin grant directo desde 0124.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."case_id" IS 'FK al caso de Cargo de Vuelta (cargo_vuelta_cases). Uno a uno con el caso mientras la cuenta está en estado activo/moroso/en_plan/reestructurado.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."apr_anual" IS 'Tasa de interés anual en decimal. Rango operativo aprobado: 0.10 (10%) a 0.24 (24%). Usada por fn_devengar_interes_revolving con método daily_simple_365.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."metodo_calculo_interes" IS 'Método de cálculo de interés. daily_simple_365: APR/365 × días × saldo_principal_actual. Interés no capitaliza sobre sí mismo ni sobre fees salvo política explícita (capitaliza_interes).';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."fecha_inicio" IS 'Fecha de apertura de la cuenta revolving. Típicamente igual a fecha_cargo_vuelta del caso.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."fecha_ultimo_devengo" IS 'Última fecha hasta la que se devengó interés. fn_devengar_interes_revolving avanza este campo tras cada accrual. No modificar manualmente: riesgo de doble devengo o devengo saltado.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."saldo_principal_inicial" IS 'Monto Devuelto al abrir la cuenta. Fuente: cargo_vuelta_cases.monto_devuelto. Inmutable una vez creada la cuenta. Los pagos reducen saldo_principal_actual, no este campo.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."saldo_principal_actual" IS 'Saldo de principal pendiente. Reducido por pagos (waterfall: fee→interés→principal). UI label: parte del "Saldo Interno".';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."saldo_interes_actual" IS 'Saldo de interés devengado pendiente de pago. Incrementado por fn_devengar_interes_revolving. Reducido por pagos (waterfall).';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."saldo_fees_actual" IS 'Saldo de late fees pendientes de pago. Incrementado por fn_aplicar_late_fee_revolving. Reducido por pagos (waterfall, primer componente).';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."saldo_total_actual" IS 'Saldo Operativo Interno total. Columna generada (STORED): suma de principal + interés + fees. UI label: "Saldo Interno". No actualizar directamente — actualizar los tres componentes por separado vía funciones. No confundir con Saldo Hy-Cite (clientes.saldo_actual).';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."late_fee_fijo" IS 'Monto fijo de late fee en dólares, aplicado cuando se detecta mora. Excluyente con late_fee_porcentaje.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."late_fee_porcentaje" IS 'Late fee como porcentaje del saldo vencido (ej: 0.05 = 5%). Excluyente con late_fee_fijo.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."dias_gracia_late_fee" IS 'Días de gracia antes de aplicar late fee tras vencimiento. 0 = sin gracia.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."capitaliza_interes" IS 'Si true, el interés devengado se capitaliza al principal (interés compuesto). Política actual: false. Cambiar solo con aprobación explícita.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."capitaliza_fees" IS 'Si true, los fees se capitalizan al principal. Política actual: false.';



COMMENT ON COLUMN "public"."cob_revolving_accounts"."estado" IS 'Estado del ciclo de vida de la cuenta revolving. activo: cuenta viva sin acuerdo formal. moroso: mora activa o fee pendiente. en_plan: existe cob_plan_pagos activo vinculado. reestructurado: reemplazada por otra cuenta o acuerdo. completado: todos los saldos en cero — caso recuperado. cancelado: anulada administrativamente. writeoff: castigo contable interno — saldo irrecuperable.';



CREATE TABLE IF NOT EXISTS "public"."cob_statement_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "statement_id" "uuid" NOT NULL,
    "revolving_account_id" "uuid" NOT NULL,
    "ledger_entry_id" "uuid",
    "line_order" integer DEFAULT 1 NOT NULL,
    "transaction_date" "date",
    "posting_date" "date",
    "entry_type" "text",
    "component_type" "text",
    "description" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cob_statement_lines_line_order_positive" CHECK (("line_order" > 0))
);


ALTER TABLE "public"."cob_statement_lines" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_statement_lines" IS 'Líneas del statement mensual (snapshot documental). No representan contabilidad oficial; solo visualización derivada del ledger. La verdad monetaria está en cob_financial_ledger y el saldo operativo en cob_revolving_accounts.';



COMMENT ON COLUMN "public"."cob_statement_lines"."ledger_entry_id" IS 'Referencia opcional al asiento fuente en cob_financial_ledger.';



CREATE TABLE IF NOT EXISTS "public"."cob_statements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "revolving_account_id" "uuid" NOT NULL,
    "periodo_inicio" "date" NOT NULL,
    "periodo_fin" "date" NOT NULL,
    "fecha_corte" "date" NOT NULL,
    "fecha_vencimiento" "date",
    "dias_ciclo_facturacion" integer,
    "balance_previo" numeric(12,2) DEFAULT 0 NOT NULL,
    "pagos_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "otros_creditos" numeric(12,2) DEFAULT 0 NOT NULL,
    "compras_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "balance_atrasado" numeric(12,2) DEFAULT 0 NOT NULL,
    "cargos_totales_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "apr_tae" numeric(8,6),
    "balance_sujeto_interes" numeric(12,2) DEFAULT 0 NOT NULL,
    "cargos_interes_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "nuevo_balance" numeric(12,2) DEFAULT 0 NOT NULL,
    "pago_minimo" numeric(12,2) DEFAULT 0 NOT NULL,
    "credito_disponible" numeric(12,2),
    "ytd_cargos_atraso" numeric(12,2) DEFAULT 0 NOT NULL,
    "ytd_cargos_interes" numeric(12,2) DEFAULT 0 NOT NULL,
    "mensaje_pago" "text",
    "metodos_pago" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "pdf_url" "text",
    "enviado_at" timestamp with time zone,
    "outbox_message_id" "uuid",
    "generated_by" "uuid",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tasa_diaria" numeric(12,10),
    CONSTRAINT "chk_cob_statements_tasa_diaria_required" CHECK ((("cargos_interes_periodo" = (0)::numeric) OR ("tasa_diaria" IS NOT NULL))),
    CONSTRAINT "cob_statements_period_check" CHECK ((("periodo_inicio" <= "periodo_fin") AND ("fecha_corte" >= "periodo_inicio") AND ("fecha_corte" <= "periodo_fin"))),
    CONSTRAINT "cob_statements_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'final'::"text", 'enviado'::"text", 'anulado'::"text"]))),
    CONSTRAINT "cob_statements_tasa_diaria_check" CHECK ((("tasa_diaria" IS NULL) OR ("tasa_diaria" > (0)::numeric)))
);


ALTER TABLE "public"."cob_statements" OWNER TO "postgres";


COMMENT ON TABLE "public"."cob_statements" IS 'Snapshot documental del estado de cuenta. Generar mediante RPC (ej: fn_cob_statement_generar) desde ledger. Enviar mediante outbox_messages (ej: fn_cob_statement_enviar). NO muta saldos oficiales. Pagos, fees, intereses y ajustes se registran solo por RPC/ledger.';



COMMENT ON COLUMN "public"."cob_statements"."apr_tae" IS 'APR/TAE mostrado en statement para comunicación al cliente.';



COMMENT ON COLUMN "public"."cob_statements"."balance_sujeto_interes" IS 'Base de cálculo de interés para visualización del período.';



COMMENT ON COLUMN "public"."cob_statements"."outbox_message_id" IS 'Relación al envío generado en outbox_messages (si fue enviado).';



CREATE TABLE IF NOT EXISTS "public"."componentes_equipo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "equipo_instalado_id" "uuid",
    "nombre_componente" "text" NOT NULL,
    "tipo_componente" "text",
    "ciclo_meses" integer,
    "fecha_ultimo_cambio" "date",
    "fecha_proximo_cambio" "date",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."componentes_equipo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacto_actividades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contacto_tipo" "text" NOT NULL,
    "contacto_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "resumen" "text",
    "contenido" "text",
    "autor_id" "uuid" NOT NULL,
    "fecha_actividad" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cita_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resultado" "text",
    CONSTRAINT "contacto_actividades_contacto_tipo_check" CHECK (("contacto_tipo" = ANY (ARRAY['lead'::"text", 'cliente'::"text"]))),
    CONSTRAINT "contacto_actividades_tipo_check" CHECK (("tipo" = ANY (ARRAY['visita'::"text", 'llamada'::"text", 'nota'::"text", 'whatsapp'::"text", 'email'::"text", 'sms'::"text", 'telegram'::"text", 'cita_completada'::"text", 'referidos'::"text", 'venta'::"text", 'seguimiento'::"text", 'envio_material'::"text"])))
);


ALTER TABLE "public"."contacto_actividades" OWNER TO "postgres";


COMMENT ON COLUMN "public"."contacto_actividades"."cita_id" IS 'FK opcional a citas. Usado por CitaModal para vincular la actividad de cierre a la cita completada y releer el estado al reabrir.';



COMMENT ON COLUMN "public"."contacto_actividades"."resultado" IS 'Resultado de la actividad: promesa_pago, pago_realizado, no_contesto, etc. Usado por triggers de sincronización de estado operativo del cliente.';



CREATE OR REPLACE VIEW "public"."contactos_actividades" AS
 SELECT "id",
    "contacto_tipo",
    "contacto_id",
    "tipo",
    "resumen",
    "contenido",
    "autor_id",
    "fecha_actividad",
    "metadata",
    "cita_id",
    "created_at"
   FROM "public"."contacto_actividades";


ALTER VIEW "public"."contactos_actividades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "canal" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "contact_tipo" "text",
    "contact_id" "uuid",
    "phone_e164" "text",
    "wa_id" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "last_message_at" timestamp with time zone,
    "last_message_preview" "text",
    "unread_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pipeline_stage" "text" DEFAULT 'nuevo'::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "assigned_to" "uuid",
    "last_message_direction" "text",
    "follow_up_sent_at" timestamp with time zone,
    "follow_up_count" integer DEFAULT 0 NOT NULL,
    "auto_reply_sent_at" timestamp with time zone,
    CONSTRAINT "conversations_canal_check" CHECK (("canal" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'email'::"text"]))),
    CONSTRAINT "conversations_contact_tipo_check" CHECK (("contact_tipo" = ANY (ARRAY['cliente'::"text", 'lead'::"text", 'embajador'::"text"]))),
    CONSTRAINT "conversations_last_direction_check" CHECK (("last_message_direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "conversations_pipeline_stage_check" CHECK (("pipeline_stage" = ANY (ARRAY['nuevo'::"text", 'contacto'::"text", 'demo_agendada'::"text", 'cerrado_ganado'::"text", 'cerrado_perdido'::"text"]))),
    CONSTRAINT "conversations_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_tareas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contacto_tipo" "text" NOT NULL,
    "contacto_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "descripcion" "text",
    "asignado_a" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "fecha_vencimiento" "date" NOT NULL,
    "hora_vencimiento" time without time zone,
    "prioridad" "text" DEFAULT 'media'::"text" NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "completada_at" timestamp with time zone,
    "completada_por" "uuid",
    "cita_origen_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crm_tareas_contacto_tipo_check" CHECK (("contacto_tipo" = ANY (ARRAY['lead'::"text", 'cliente'::"text"]))),
    CONSTRAINT "crm_tareas_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'completada'::"text", 'cancelada'::"text"]))),
    CONSTRAINT "crm_tareas_prioridad_check" CHECK (("prioridad" = ANY (ARRAY['baja'::"text", 'media'::"text", 'alta'::"text"]))),
    CONSTRAINT "crm_tareas_tipo_check" CHECK (("tipo" = ANY (ARRAY['llamada'::"text", 'visita'::"text", 'enviar_material'::"text", 'reagendar_cita'::"text", 'seguimiento'::"text", 'cobro'::"text", 'otro'::"text"])))
);


ALTER TABLE "public"."crm_tareas" OWNER TO "postgres";


COMMENT ON TABLE "public"."crm_tareas" IS 'Tareas de seguimiento CRM. Creadas desde CitaModal (cierre de cita) u otras acciones comerciales.';



CREATE TABLE IF NOT EXISTS "public"."dfp_notification_events" (
    "notification_key" "text" NOT NULL,
    "org_id" "uuid",
    "cuota_id" "uuid",
    "notification_date" "date" NOT NULL,
    "target_date" "date",
    "channel" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dfp_notification_events_channel_check" CHECK (("channel" = ANY (ARRAY['email'::"text", 'telegram'::"text", 'whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "dfp_notification_events_scope_check" CHECK (("scope" = ANY (ARRAY['internal_summary'::"text", 'client_reminder'::"text"]))),
    CONSTRAINT "dfp_notification_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'queued'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."dfp_notification_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."dfp_notification_events" IS 'Eventos idempotentes de notificacion DFP diaria. No contiene PAN, CVV ni pagos reales.';



CREATE TABLE IF NOT EXISTS "public"."embajador_programas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "embajador_id" "uuid" NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "owner_id" "uuid",
    "nivel" "public"."embajador_nivel" DEFAULT 'silver'::"public"."embajador_nivel" NOT NULL,
    "total_conexiones_anual" integer DEFAULT 0 NOT NULL,
    "total_ventas_generadas_anual" numeric(14,2) DEFAULT 0 NOT NULL,
    "fecha_upgrade_gold" "date",
    "premio_entregado" boolean DEFAULT false NOT NULL,
    "fecha_premio" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid"
);


ALTER TABLE "public"."embajador_programas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."embajadores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "apellido" "text",
    "email" "text",
    "telefono" "text",
    "fecha_nacimiento" "date",
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid",
    "lead_id" "uuid",
    "cliente_id" "uuid",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "fecha_aceptacion" timestamp with time zone,
    "aceptado_por" "uuid",
    "notas_inscripcion" "text",
    "persona_id" "uuid",
    CONSTRAINT "embajador_origen_unico" CHECK ((NOT (("lead_id" IS NOT NULL) AND ("cliente_id" IS NOT NULL)))),
    CONSTRAINT "embajadores_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'activo'::"text", 'inactivo'::"text", 'rechazado'::"text"])))
);


ALTER TABLE "public"."embajadores" OWNER TO "postgres";


COMMENT ON COLUMN "public"."embajadores"."nombre" IS 'LEGACY CACHE: fuente canónica es leads o clientes via lead_id/cliente_id. Se mantiene para registros históricos sin origen vinculado.';



COMMENT ON COLUMN "public"."embajadores"."apellido" IS 'LEGACY CACHE: fuente canónica es leads o clientes via lead_id/cliente_id. Se mantiene para registros históricos sin origen vinculado.';



COMMENT ON COLUMN "public"."embajadores"."email" IS 'LEGACY CACHE: fuente canónica es leads o clientes via lead_id/cliente_id. Se mantiene para registros históricos sin origen vinculado.';



COMMENT ON COLUMN "public"."embajadores"."telefono" IS 'LEGACY CACHE: fuente canónica es leads o clientes via lead_id/cliente_id. Se mantiene para registros históricos sin origen vinculado.';



COMMENT ON COLUMN "public"."embajadores"."fecha_nacimiento" IS 'LEGACY CACHE: fuente canónica es leads o clientes via lead_id/cliente_id. Se mantiene para registros históricos sin origen vinculado.';



COMMENT ON COLUMN "public"."embajadores"."lead_id" IS 'FK al lead de origen. Exclusivo con cliente_id (constraint embajador_origen_unico). NULL en registros históricos sin origen vinculado.';



COMMENT ON COLUMN "public"."embajadores"."cliente_id" IS 'FK al cliente de origen. Exclusivo con lead_id (constraint embajador_origen_unico). NULL en registros históricos sin origen vinculado.';



COMMENT ON COLUMN "public"."embajadores"."estado" IS 'Estado de activación del embajador en el programa Conexiones Infinitas';



COMMENT ON COLUMN "public"."embajadores"."fecha_aceptacion" IS 'Marca cuándo el embajador fue aceptado en el programa';



COMMENT ON COLUMN "public"."embajadores"."aceptado_por" IS 'Usuario que validó la inscripción del embajador';



COMMENT ON COLUMN "public"."embajadores"."notas_inscripcion" IS 'Notas libres capturadas durante la inscripción';



COMMENT ON COLUMN "public"."embajadores"."persona_id" IS 'FK al registro de persona física en public.personas. NULL en registros históricos sin persona vinculada.';



CREATE TABLE IF NOT EXISTS "public"."equipos_instalados" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid",
    "producto_id" "uuid",
    "vendedor_id" "uuid",
    "numero_serie" "text",
    "fecha_instalacion" "date",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "intervalo_meses" integer DEFAULT 12 NOT NULL,
    "proxima_revision" "date",
    "ultimo_servicio" "date",
    "notas" "text",
    "intervalo_cambio_meses" integer,
    "proxima_cambio" "date"
);


ALTER TABLE "public"."equipos_instalados" OWNER TO "postgres";


COMMENT ON COLUMN "public"."equipos_instalados"."intervalo_meses" IS 'Intervalo de revisión en meses (default 6)';



COMMENT ON COLUMN "public"."equipos_instalados"."intervalo_cambio_meses" IS 'Intervalo de cambio de filtro en meses. NULL = mismo que intervalo_meses';



COMMENT ON COLUMN "public"."equipos_instalados"."proxima_cambio" IS 'Próxima fecha de cambio de filtro/repuesto';



CREATE TABLE IF NOT EXISTS "public"."import_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "source_id" "text" NOT NULL,
    "source_name" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."import_configs" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_configs" IS 'Mapeo de orígenes (carpetas de Drive) a organizaciones para multitenancy en n8n.';



CREATE TABLE IF NOT EXISTS "public"."import_processed_files" (
    "file_id" "text" NOT NULL,
    "run_id" "text",
    "destino" "text",
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    CONSTRAINT "import_processed_files_destino_check" CHECK (("destino" = ANY (ARRAY['cliente'::"text", 'lead'::"text", 'revision'::"text"])))
);


ALTER TABLE "public"."import_processed_files" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_processed_files" IS 'Registro de Drive file_ids ya procesados por el pipeline OCR de n8n. Permite skip de archivos ya procesados sin reprocesar en cada ejecución.';



CREATE TABLE IF NOT EXISTS "public"."import_revisiones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_name" "text",
    "file_id" "text",
    "drive_url" "text",
    "raw_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "motivo" "text" NOT NULL,
    "tipo_tentativo" "text",
    "confianza_ia" "text",
    "revisado" boolean DEFAULT false NOT NULL,
    "revisado_por" "uuid",
    "revisado_at" timestamp with time zone,
    "accion_tomada" "text" DEFAULT 'pendiente'::"text",
    "notas_revisor" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "run_id" "text",
    CONSTRAINT "import_revisiones_accion_tomada_check" CHECK (("accion_tomada" = ANY (ARRAY['creado_lead'::"text", 'creado_cliente'::"text", 'descartado'::"text", 'pendiente'::"text"]))),
    CONSTRAINT "import_revisiones_confianza_ia_check" CHECK (("confianza_ia" = ANY (ARRAY['alta'::"text", 'media'::"text", 'baja'::"text"]))),
    CONSTRAINT "import_revisiones_motivo_check" CHECK (("motivo" = ANY (ARRAY['parse_error'::"text", 'baja_confianza'::"text", 'fileid_vacio'::"text", 'error_leyendo_imagen'::"text", 'sin_datos_binarios'::"text", 'openai_api_error'::"text", 'sin_personas'::"text"]))),
    CONSTRAINT "import_revisiones_tipo_tentativo_check" CHECK (("tipo_tentativo" = ANY (ARRAY['lead'::"text", 'cliente'::"text"])))
);


ALTER TABLE "public"."import_revisiones" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_revisiones" IS 'Registros del workflow n8n de importación de imágenes (RFN0rJZlo86HNgRj) que requieren revisión manual: errores de parseo, baja confianza de Claude, o fileId vacío. Diferente de import_processed_files (que rastrea archivos ya procesados).';



COMMENT ON COLUMN "public"."import_revisiones"."run_id" IS 'ID de ejecución n8n que generó este registro (trazabilidad).';



CREATE TABLE IF NOT EXISTS "public"."import_runs" (
    "run_id" "text" NOT NULL,
    "org_id" "uuid",
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "total" integer DEFAULT 0 NOT NULL,
    "ok" integer DEFAULT 0 NOT NULL,
    "parcial" integer DEFAULT 0 NOT NULL,
    "en_revision" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "import_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'ok'::"text", 'partial'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."import_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_runs" IS 'Resumen por ejecución del workflow n8n OCR (run_id = n8n execution ID). status=partial significa que hubo inserts en clientes/leads pero Marcar C/L falló (Bad Request por file_id ya existente). Diferente de import_processed_files (por archivo) e import_revisiones (por dato).';



COMMENT ON COLUMN "public"."import_runs"."parcial" IS 'Registros donde el insert a clientes/leads fue OK pero el upsert a import_processed_files falló. Indica re-procesamiento parcial.';



CREATE TABLE IF NOT EXISTS "public"."importaciones_hycite" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "importado_por" "uuid" NOT NULL,
    "tipo_cuenta" "text" NOT NULL,
    "total_registros" integer DEFAULT 0 NOT NULL,
    "registros_nuevos" integer DEFAULT 0 NOT NULL,
    "registros_actualizados" integer DEFAULT 0 NOT NULL,
    "registros_error" integer DEFAULT 0 NOT NULL,
    "archivo_nombre" "text",
    "notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."importaciones_hycite" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbox_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "contact_id" "uuid",
    "contact_tipo" "text",
    "assigned_to" "uuid",
    "titulo" "text" NOT NULL,
    "notas" "text",
    "due_at" timestamp with time zone,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "completado_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_tasks_contact_tipo_check" CHECK (("contact_tipo" = ANY (ARRAY['cliente'::"text", 'lead'::"text", 'embajador'::"text"]))),
    CONSTRAINT "inbox_tasks_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."inbox_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."izzy_activity_rules" (
    "rank_code" "text" NOT NULL,
    "min_personal_installs_month" integer DEFAULT 0 NOT NULL,
    "min_active_agents" integer DEFAULT 0 NOT NULL,
    "min_active_supervisors" integer DEFAULT 0 NOT NULL,
    "min_org_installs_month" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."izzy_activity_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."izzy_agent_rank_history" (
    "id" bigint NOT NULL,
    "user_id" bigint NOT NULL,
    "previous_rank_code" "text",
    "new_rank_code" "text" NOT NULL,
    "reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "effective_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."izzy_agent_rank_history" OWNER TO "postgres";


ALTER TABLE "public"."izzy_agent_rank_history" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_agent_rank_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_ambassadors" (
    "id" bigint NOT NULL,
    "code" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "telefono" "text",
    "email" "text",
    "active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."izzy_ambassadors" OWNER TO "postgres";


ALTER TABLE "public"."izzy_ambassadors" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_ambassadors_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_carriers" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "service_type" "text" DEFAULT 'internet'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "internal_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "izzy_carriers_service_type_check" CHECK (("service_type" = ANY (ARRAY['internet'::"text", 'wireless'::"text", 'fiber'::"text", 'satellite'::"text", 'reseller'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."izzy_carriers" OWNER TO "postgres";


ALTER TABLE "public"."izzy_carriers" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_carriers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_commission_rates" (
    "id" bigint NOT NULL,
    "rank_code" "text" NOT NULL,
    "service_category_code" "text" NOT NULL,
    "sale_type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "izzy_commission_rates_sale_type_check" CHECK (("sale_type" = ANY (ARRAY['residential'::"text", 'commercial'::"text"])))
);


ALTER TABLE "public"."izzy_commission_rates" OWNER TO "postgres";


ALTER TABLE "public"."izzy_commission_rates" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_commission_rates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_commission_reserves" (
    "id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "carrier_name" "text",
    "reserve_days" integer DEFAULT 120 NOT NULL,
    "status" "text" DEFAULT 'reserve'::"text" NOT NULL,
    "reserve_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "release_at" timestamp with time zone,
    "released_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "izzy_commission_reserves_status_check" CHECK (("status" = ANY (ARRAY['reserve'::"text", 'released'::"text", 'chargeback'::"text"])))
);


ALTER TABLE "public"."izzy_commission_reserves" OWNER TO "postgres";


ALTER TABLE "public"."izzy_commission_reserves" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_commission_reserves_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_compensation_audit_log" (
    "id" bigint NOT NULL,
    "actor_name" "text",
    "actor_role" "text",
    "entity_type" "text" NOT NULL,
    "entity_key" "text" NOT NULL,
    "action" "text" NOT NULL,
    "before_value" "jsonb",
    "after_value" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text"
);


ALTER TABLE "public"."izzy_compensation_audit_log" OWNER TO "postgres";


ALTER TABLE "public"."izzy_compensation_audit_log" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_compensation_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_compensation_plans" (
    "id" bigint NOT NULL,
    "carrier_id" bigint NOT NULL,
    "plan_name" "text" NOT NULL,
    "service_category_code" "text" NOT NULL,
    "sale_type" "text" NOT NULL,
    "novice_commission" numeric(12,2) DEFAULT 0 NOT NULL,
    "agent_commission" numeric(12,2) DEFAULT 0 NOT NULL,
    "supervisor_commission" numeric(12,2) DEFAULT 0 NOT NULL,
    "director_commission" numeric(12,2) DEFAULT 0 NOT NULL,
    "director_bonus" numeric(12,2) DEFAULT 0 NOT NULL,
    "commercial_multiplier" numeric(12,2) DEFAULT 1 NOT NULL,
    "chargeback_days" integer DEFAULT 120 NOT NULL,
    "special_bonuses" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "temporary_promo_notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "izzy_compensation_plans_sale_type_check" CHECK (("sale_type" = ANY (ARRAY['residential'::"text", 'commercial'::"text"])))
);


ALTER TABLE "public"."izzy_compensation_plans" OWNER TO "postgres";


ALTER TABLE "public"."izzy_compensation_plans" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_compensation_plans_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_compensation_promotions" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "promotion_type" "text" DEFAULT 'special_bonus'::"text" NOT NULL,
    "carrier_id" bigint,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "izzy_compensation_promotions_type_check" CHECK (("promotion_type" = ANY (ARRAY['install_bonus'::"text", 'commercial_bonus'::"text", 'campaign_bonus'::"text", 'carrier_bonus'::"text", 'elite_bonus'::"text", 'special_bonus'::"text"])))
);


ALTER TABLE "public"."izzy_compensation_promotions" OWNER TO "postgres";


ALTER TABLE "public"."izzy_compensation_promotions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_compensation_promotions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_compensation_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."izzy_compensation_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."izzy_director_bonus_rates" (
    "id" bigint NOT NULL,
    "service_category_code" "text" NOT NULL,
    "sale_type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "izzy_director_bonus_rates_sale_type_check" CHECK (("sale_type" = ANY (ARRAY['residential'::"text", 'commercial'::"text"])))
);


ALTER TABLE "public"."izzy_director_bonus_rates" OWNER TO "postgres";


ALTER TABLE "public"."izzy_director_bonus_rates" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_director_bonus_rates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_leads" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "fecha" "text",
    "agente" "text",
    "cliente" "text" NOT NULL,
    "telefono" "text",
    "direccion" "text",
    "proveedor_internet" "text",
    "pago_internet" numeric,
    "proveedor_telefono" "text",
    "pago_telefono" numeric,
    "velocidad" "text",
    "lineas" "text",
    "nota" "text",
    "estado" "text" DEFAULT 'Nuevo'::"text" NOT NULL,
    "telefono_digits" "text" GENERATED ALWAYS AS ("regexp_replace"(COALESCE("telefono", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text")) STORED,
    "cotizacion_enviada" "text",
    "cotizacion_at" timestamp with time zone,
    "origen" "text",
    "correo_cliente" "text",
    "disposicion" "text",
    "nota_seguimiento" "text",
    "proximo_contacto" "text"
);

ALTER TABLE ONLY "public"."izzy_leads" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_leads" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."izzy_leads_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."izzy_leads_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."izzy_leads_id_seq" OWNED BY "public"."izzy_leads"."id";



CREATE TABLE IF NOT EXISTS "public"."izzy_orders" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha" "text",
    "agente" "text" NOT NULL,
    "cliente_nombre" "text" NOT NULL,
    "cliente_apellido" "text" DEFAULT ''::"text" NOT NULL,
    "telefono_primario" "text",
    "telefono_secundario" "text",
    "email" "text",
    "fecha_nacimiento" "text",
    "direccion" "text",
    "apartamento" "text",
    "ciudad" "text",
    "estado" "text",
    "zip" "text",
    "proveedor_servicio" "text",
    "proveedor_otro" "text",
    "velocidad_deseada" "text",
    "voice_service" boolean DEFAULT false NOT NULL,
    "notas_instalacion" "text",
    "autopay" boolean DEFAULT false NOT NULL,
    "monthly_price" numeric,
    "special_notes" "text",
    "order_number" "text",
    "btn" "text",
    "order_date" "text",
    "install_date" "date",
    "card_last4" "text",
    "signature_data" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "id_dl" "text",
    "installation_status" "text" DEFAULT 'submitted'::"text" NOT NULL,
    "scheduled_install_date" "date",
    "actual_install_date" "date",
    "satisfaction_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "commission_status" "text" DEFAULT 'not_earned'::"text" NOT NULL,
    "commission_earned_at" timestamp with time zone,
    "commission_amount" numeric,
    "satisfaction_confirmed_at" timestamp with time zone,
    "satisfaction_confirmed_by" "text",
    "satisfaction_notes" "text",
    "commission_paid_at" timestamp with time zone,
    "commission_paid_by" "text",
    "portal_user_id" bigint,
    "sale_type" "text" DEFAULT 'residential'::"text" NOT NULL,
    "service_category_code" "text",
    "carrier_name" "text",
    "compensation_status" "text" DEFAULT 'estimated'::"text" NOT NULL,
    "compensation_rank_code" "text",
    "compensation_estimated_amount" numeric(12,2),
    "compensation_approved_at" timestamp with time zone,
    "reserve_release_at" timestamp with time zone,
    "chargeback_at" timestamp with time zone,
    "chargeback_notes" "text",
    "ambassador_id" bigint,
    "renewal_date" "date",
    "client_notes" "text",
    CONSTRAINT "izzy_orders_commission_status_check" CHECK (("commission_status" = ANY (ARRAY['not_earned'::"text", 'earned'::"text", 'paid'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "izzy_orders_compensation_status_check" CHECK (("compensation_status" = ANY (ARRAY['estimated'::"text", 'approved'::"text", 'reserve'::"text", 'released'::"text", 'paid'::"text", 'chargeback'::"text"]))),
    CONSTRAINT "izzy_orders_installation_status_check" CHECK (("installation_status" = ANY (ARRAY['submitted'::"text", 'scheduled'::"text", 'installed_pending_confirmation'::"text", 'confirmed_satisfied'::"text", 'cancelled'::"text", 'failed_install'::"text"]))),
    CONSTRAINT "izzy_orders_sale_type_check" CHECK (("sale_type" = ANY (ARRAY['residential'::"text", 'commercial'::"text"]))),
    CONSTRAINT "izzy_orders_satisfaction_status_check" CHECK (("satisfaction_status" = ANY (ARRAY['pending'::"text", 'satisfied'::"text", 'issue'::"text", 'cancelled'::"text"])))
);

ALTER TABLE ONLY "public"."izzy_orders" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_orders" OWNER TO "postgres";


ALTER TABLE "public"."izzy_orders" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_orders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_password_reset_requests" (
    "id" bigint NOT NULL,
    "user_id" bigint,
    "pin_code" "text",
    "email" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "izzy_password_reset_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'resolved'::"text"])))
);

ALTER TABLE ONLY "public"."izzy_password_reset_requests" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_password_reset_requests" OWNER TO "postgres";


ALTER TABLE "public"."izzy_password_reset_requests" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_password_reset_requests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_password_reset_tokens" (
    "id" bigint NOT NULL,
    "user_id" bigint NOT NULL,
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."izzy_password_reset_tokens" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_password_reset_tokens" OWNER TO "postgres";


ALTER TABLE "public"."izzy_password_reset_tokens" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_password_reset_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_portal_users" (
    "id" bigint NOT NULL,
    "pin_code" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "rol" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "password_hash" "text",
    "password_salt" "text",
    "email" "text",
    "compensation_role" "text" DEFAULT 'novato'::"text" NOT NULL,
    "sponsor_user_id" bigint,
    "manager_user_id" bigint,
    CONSTRAINT "izzy_portal_users_compensation_role_check" CHECK (("compensation_role" = ANY (ARRAY['novato'::"text", 'agente'::"text", 'supervisor'::"text", 'director'::"text", 'embajador'::"text"]))),
    CONSTRAINT "izzy_portal_users_rol_check" CHECK (("rol" = ANY (ARRAY['admin'::"text", 'agente'::"text"])))
);

ALTER TABLE ONLY "public"."izzy_portal_users" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_portal_users" OWNER TO "postgres";


ALTER TABLE "public"."izzy_portal_users" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_portal_users_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_quoters" (
    "id" bigint NOT NULL,
    "code" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "telefono" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."izzy_quoters" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_quoters" OWNER TO "postgres";


ALTER TABLE "public"."izzy_quoters" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."izzy_quoters_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."izzy_rank_levels" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    "is_career" boolean DEFAULT true NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "izzy_rank_levels_code_check" CHECK (("code" = ANY (ARRAY['novato'::"text", 'agente'::"text", 'supervisor'::"text", 'director'::"text", 'embajador'::"text"])))
);


ALTER TABLE "public"."izzy_rank_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."izzy_rank_requirements" (
    "from_rank_code" "text" NOT NULL,
    "to_rank_code" "text" NOT NULL,
    "min_lifetime_personal_installs" integer DEFAULT 0 NOT NULL,
    "min_active_agents" integer DEFAULT 0 NOT NULL,
    "min_active_supervisors" integer DEFAULT 0 NOT NULL,
    "min_org_installs_month" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."izzy_rank_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."izzy_service_categories" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "visible_examples" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "izzy_service_categories_code_check" CHECK (("code" = ANY (ARRAY['basic'::"text", 'standard'::"text", 'premium'::"text"])))
);


ALTER TABLE "public"."izzy_service_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_notas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "nota" "text" NOT NULL,
    "tipo" "text" DEFAULT 'seguimiento'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "canal" "text",
    "tipo_mensaje" "text",
    "mensaje" "text"
);


ALTER TABLE "public"."lead_notas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "apellido" "text",
    "email" "text",
    "telefono" "text",
    "fuente" "text",
    "programa_id" "uuid",
    "embajador_id" "uuid",
    "owner_id" "uuid",
    "estado_pipeline" "public"."lead_estado_pipeline" DEFAULT 'nuevo'::"public"."lead_estado_pipeline" NOT NULL,
    "next_action" "text",
    "next_action_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estado_civil" "text",
    "nombre_conyuge" "text",
    "telefono_conyuge" "text",
    "situacion_laboral" "text",
    "ninos_en_casa" boolean DEFAULT false,
    "cantidad_ninos" integer,
    "tiene_productos_rp" boolean DEFAULT false,
    "tipo_vivienda" "text",
    "whatsapp_mensaje_enviado_at" timestamp with time zone,
    "vendedor_id" "uuid",
    "referido_por_cliente_id" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deleted_reason" "text",
    "updated_by" "uuid",
    "last_reassigned_by" "uuid",
    "last_reassigned_at" timestamp with time zone,
    "fecha_nacimiento" "date",
    "direccion" "text",
    "ciudad" "text",
    "estado_region" "text",
    "codigo_postal" "text",
    "apartamento" "text",
    "referidor_tipo" "text",
    "referidor_id" "uuid",
    "persona_id" "uuid",
    "run_id" "text",
    "file_id_origen" "text",
    "file_name_origen" "text",
    "confianza_ocr" "text",
    "fuente_import" "text",
    "import_file_name" "text",
    "import_drive_url" "text",
    "org_id" "uuid",
    "lugar_trabajo" "text",
    "telefono_trabajo" "text",
    "mejor_hora_llamar" "text",
    "notas_extraidas" "text",
    "whatsapp_opt_in" boolean DEFAULT false NOT NULL,
    "whatsapp_no_molestar" boolean DEFAULT false NOT NULL,
    "whatsapp_ultimo_envio_at" timestamp with time zone,
    "whatsapp_consent_source" "text",
    "whatsapp_consented_at" timestamp with time zone,
    CONSTRAINT "leads_deleted_reason_required" CHECK ((("deleted_at" IS NULL) OR (("deleted_reason" IS NOT NULL) AND ("length"(TRIM(BOTH FROM "deleted_reason")) > 0)))),
    CONSTRAINT "leads_referidor_nullity" CHECK ((("referidor_tipo" IS NULL) = ("referidor_id" IS NULL))),
    CONSTRAINT "leads_referidor_tipo_values" CHECK ((("referidor_tipo" IS NULL) OR ("referidor_tipo" = ANY (ARRAY['cliente'::"text", 'lead'::"text", 'embajador'::"text"]))))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


COMMENT ON COLUMN "public"."leads"."whatsapp_mensaje_enviado_at" IS 'Registra el momento del último contacto por canal digital (WA, SMS, Email).';



COMMENT ON COLUMN "public"."leads"."persona_id" IS 'FK al registro de persona física en public.personas. NULL en registros históricos sin persona vinculada. Exclusivo de uso con clientes.persona_id y embajadores.persona_id para el mismo individuo.';



COMMENT ON COLUMN "public"."leads"."fuente_import" IS 'Canal de importación que creó el registro (e.g. import_imagen_gdrive, csv, manual).';



COMMENT ON COLUMN "public"."leads"."import_file_name" IS 'Nombre del archivo de Drive del que proviene este registro.';



COMMENT ON COLUMN "public"."leads"."import_drive_url" IS 'URL de Google Drive del archivo fuente (webViewLink).';



COMMENT ON COLUMN "public"."leads"."lugar_trabajo" IS 'Empresa o lugar de trabajo del prospecto (extraído por OCR).';



COMMENT ON COLUMN "public"."leads"."telefono_trabajo" IS 'Teléfono del trabajo (extraído por OCR).';



COMMENT ON COLUMN "public"."leads"."mejor_hora_llamar" IS 'Hora preferida para ser contactado (extraído por OCR).';



COMMENT ON COLUMN "public"."leads"."notas_extraidas" IS 'Notas adicionales del OCR que no caben en otros campos.';



COMMENT ON COLUMN "public"."leads"."whatsapp_opt_in" IS 'Consentimiento explicito para recibir campanas WhatsApp.';



COMMENT ON COLUMN "public"."leads"."whatsapp_no_molestar" IS 'Bloquea campanas WhatsApp aunque exista opt-in.';



COMMENT ON COLUMN "public"."leads"."whatsapp_ultimo_envio_at" IS 'Ultimo envio WhatsApp registrado desde outbox_messages.';



COMMENT ON COLUMN "public"."leads"."whatsapp_consent_source" IS 'Fuente del consentimiento WhatsApp: formulario, manual, importacion, contrato, etc.';



COMMENT ON COLUMN "public"."leads"."whatsapp_consented_at" IS 'Fecha/hora en que se registro el consentimiento WhatsApp.';



CREATE TABLE IF NOT EXISTS "public"."llamadas_telemercadeo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid",
    "lead_id" "uuid",
    "telemercadista_id" "uuid" NOT NULL,
    "vendedor_asignado_id" "uuid",
    "resultado" "text" NOT NULL,
    "duracion_segundos" integer,
    "notas" "text",
    "fecha_llamada" timestamp with time zone DEFAULT "now"() NOT NULL,
    "requiere_followup" boolean DEFAULT false,
    "followup_fecha" "date",
    "followup_notas" "text",
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "followup_at" "date",
    "monto_prometido" numeric,
    "org_id" "uuid",
    CONSTRAINT "cliente_o_lead_requerido" CHECK ((("cliente_id" IS NOT NULL) OR ("lead_id" IS NOT NULL))),
    CONSTRAINT "llamadas_telemercadeo_has_target" CHECK ((("lead_id" IS NOT NULL) OR ("cliente_id" IS NOT NULL))),
    CONSTRAINT "llamadas_telemercadeo_resultado_check" CHECK (("resultado" = ANY (ARRAY['no_contesta'::"text", 'numero_equivocado'::"text", 'buzon_voz'::"text", 'cita_agendada'::"text", 'no_interesado'::"text", 'callback'::"text", 'pago_prometido'::"text", 'venta_directa'::"text", 'otro'::"text"])))
);


ALTER TABLE "public"."llamadas_telemercadeo" OWNER TO "postgres";


COMMENT ON COLUMN "public"."llamadas_telemercadeo"."org_id" IS 'Organizacion canonica del registro legacy, backfilled desde clientes.org_id.';



CREATE TABLE IF NOT EXISTS "public"."message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid",
    "org_id" "text",
    "canal" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "asunto" "text",
    "cuerpo" "text" NOT NULL,
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "scope" "text" DEFAULT 'personal'::"text" NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attachment_urls" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "message_templates_canal_check" CHECK (("canal" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'email'::"text", 'telegram'::"text", 'all'::"text"]))),
    CONSTRAINT "message_templates_scope_check" CHECK (("scope" = ANY (ARRAY['personal'::"text", 'shared'::"text"])))
);


ALTER TABLE "public"."message_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid",
    "direction" "text" NOT NULL,
    "message" "text",
    "provider_message_id" "text",
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "error_message" "text",
    "delivered_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attachment_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "messages_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'delivered'::"text", 'read'::"text", 'failed'::"text", 'received'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."messages"."status" IS 'Message delivery status. Outbound: pending→sent→delivered→read|failed. Inbound: received.';



COMMENT ON COLUMN "public"."messages"."attachment_urls" IS 'Public URLs of media/doc attachments associated to this message.';



CREATE TABLE IF NOT EXISTS "public"."mk_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "segmento_key" "text",
    "canal" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "template_key" "text",
    "owner_id" "uuid" NOT NULL,
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "total_contactos" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid",
    "segment_params" "jsonb" DEFAULT '{}'::"jsonb",
    "mensaje_base" "text",
    "dispatched_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "mk_campaigns_canal_check" CHECK (("canal" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "mk_campaigns_estado_check" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'activa'::"text", 'pausada'::"text", 'completada'::"text", 'archivada'::"text"])))
);


ALTER TABLE "public"."mk_campaigns" OWNER TO "postgres";


COMMENT ON COLUMN "public"."mk_campaigns"."dispatched_at" IS 'Timestamp when the campaign was bulk-dispatched into outbox_messages. NULL = not yet dispatched.';



COMMENT ON COLUMN "public"."mk_campaigns"."completed_at" IS 'Timestamp when all campaign messages reached a terminal status (enviado/fallido/cancelado). NULL = still in progress.';



CREATE TABLE IF NOT EXISTS "public"."mk_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "contacto_tipo" "text" NOT NULL,
    "contacto_id" "uuid" NOT NULL,
    "telefono" "text",
    "nombre" "text",
    "mensaje_texto" "text",
    "canal" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "orden" integer,
    "abierto_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "responded_at" timestamp with time zone,
    "response_id" "uuid",
    "scheduled_at" timestamp with time zone,
    "cita_id" "uuid",
    "outbox_message_id" "uuid",
    CONSTRAINT "mk_messages_contacto_tipo_check" CHECK (("contacto_tipo" = ANY (ARRAY['cliente'::"text", 'lead'::"text", 'ci_referido'::"text", '4en14_referido'::"text", 'usuario'::"text"]))),
    CONSTRAINT "mk_messages_status_check" CHECK (("status" = ANY (ARRAY['pendiente'::"text", 'programado'::"text", 'en_proceso'::"text", 'enviado'::"text", 'fallido'::"text", 'respondido'::"text", 'cancelado'::"text"])))
);


ALTER TABLE "public"."mk_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mk_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "resultado" "text" NOT NULL,
    "notas" "text",
    "followup_at" "date",
    "monto_prometido" numeric(12,2),
    "registrado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mk_responses_resultado_check" CHECK (("resultado" = ANY (ARRAY['sin_respuesta'::"text", 'buzon'::"text", 'cita_agendada'::"text", 'cita_servicio'::"text", 'pago_prometido'::"text", 'pago_realizado'::"text", 'ya_pago'::"text", 'reagendar'::"text", 'solicita_info'::"text", 'no_interesado'::"text", 'numero_incorrecto'::"text", 'disputa'::"text", 'demo_calificada'::"text", 'venta_cerrada'::"text"])))
);


ALTER TABLE "public"."mk_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notasrp" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "cliente_id" "uuid",
    "contenido" "text",
    "canal" "text",
    "tipo_mensaje" "text",
    "enviado_por" "uuid",
    "enviado_en" timestamp with time zone,
    "mensaje" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notasrp" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prospectos_rp" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "direccion" "text",
    "ciudad" "text",
    "estado" "text",
    "zip" "text",
    "telefono_casa" "text",
    "telefono_movil" "text",
    "telefono_trabajo" "text",
    "email" "text",
    "tipo_cuenta" "text" DEFAULT ''::"text",
    "nivel_financiamiento" "text" DEFAULT ''::"text",
    "metodo_pago" "text" DEFAULT ''::"text",
    "pago_minimo" numeric DEFAULT 0,
    "fecha_orden" "text" DEFAULT ''::"text",
    "fecha_ultimo_pedido" "text" DEFAULT ''::"text",
    "fecha_ultimo_pago" "text" DEFAULT ''::"text",
    "fecha_cierre" "text" DEFAULT ''::"text",
    "saldo_actual" numeric DEFAULT 0,
    "credito_disponible" numeric DEFAULT 0,
    "factor_ingresos" numeric DEFAULT 0,
    "estado_cuenta" "text" DEFAULT ''::"text",
    "dias_atraso_categoria" "text" DEFAULT 'none'::"text",
    "emprendedor_codigo" "text",
    "emprendedor_nombre" "text",
    "notas" "text",
    "tipo_cliente" "text" DEFAULT 'prospecto'::"text" NOT NULL,
    "origen" "text" DEFAULT 'import_ocr_rp'::"text" NOT NULL,
    "confianza" integer DEFAULT 0,
    "_source_file" "text",
    "_processed_at" timestamp with time zone DEFAULT "now"(),
    "lead_id" "uuid",
    "merge_status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "merge_at" timestamp with time zone,
    "merge_by" "uuid",
    "merge_notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prospectos_rp_confianza_check" CHECK ((("confianza" >= 0) AND ("confianza" <= 100))),
    CONSTRAINT "prospectos_rp_merge_status_check" CHECK (("merge_status" = ANY (ARRAY['pendiente'::"text", 'mergeado'::"text", 'descartado'::"text", 'duplicado'::"text"])))
);


ALTER TABLE "public"."prospectos_rp" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ocr_import_pendientes" AS
 SELECT "clientes_rp"."id",
    'cliente_existente'::"text" AS "tipo_importacion",
    "clientes_rp"."nombre",
    "clientes_rp"."telefono_movil",
    "clientes_rp"."email",
    "clientes_rp"."estado_cuenta",
    "clientes_rp"."emprendedor_codigo",
    "clientes_rp"."confianza",
    "clientes_rp"."merge_status",
    "clientes_rp"."_source_file",
    "clientes_rp"."_processed_at"
   FROM "public"."clientes_rp"
  WHERE ("clientes_rp"."merge_status" = 'pendiente'::"text")
UNION ALL
 SELECT "prospectos_rp"."id",
    'prospecto'::"text" AS "tipo_importacion",
    "prospectos_rp"."nombre",
    "prospectos_rp"."telefono_movil",
    "prospectos_rp"."email",
    ''::"text" AS "estado_cuenta",
    "prospectos_rp"."emprendedor_codigo",
    "prospectos_rp"."confianza",
    "prospectos_rp"."merge_status",
    "prospectos_rp"."_source_file",
    "prospectos_rp"."_processed_at"
   FROM "public"."prospectos_rp"
  WHERE ("prospectos_rp"."merge_status" = 'pendiente'::"text")
  ORDER BY 11 DESC;


ALTER VIEW "public"."ocr_import_pendientes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oportunidades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "lead_id" "uuid",
    "cliente_id" "uuid",
    "owner_id" "uuid",
    "etapa" "public"."oportunidad_etapa" DEFAULT 'nuevo'::"public"."oportunidad_etapa" NOT NULL,
    "valor" numeric(12,2) DEFAULT 0 NOT NULL,
    "probabilidad" integer,
    "notas" "text",
    "fecha_cierre_estimada" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."oportunidades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."outbox_delivery_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "outbox_message_id" "uuid" NOT NULL,
    "org_id" "text",
    "attempt_number" integer NOT NULL,
    "dispatcher" "text" NOT NULL,
    "status" "text" NOT NULL,
    "request_payload" "jsonb",
    "response_payload" "jsonb",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbox_delivery_attempts_status_check" CHECK (("status" = ANY (ARRAY['started'::"text", 'accepted'::"text", 'sent'::"text", 'retry_pending'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."outbox_delivery_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."outbox_delivery_attempts" IS 'Auditoria por intento de despacho de outbox_messages hacia workers/proveedores externos como n8n.';



COMMENT ON COLUMN "public"."outbox_delivery_attempts"."outbox_message_id" IS 'Mensaje de outbox asociado al intento.';



COMMENT ON COLUMN "public"."outbox_delivery_attempts"."org_id" IS 'Organizacion del mensaje. Text por compatibilidad con outbox_messages.org_id actual.';



COMMENT ON COLUMN "public"."outbox_delivery_attempts"."attempt_number" IS 'Numero de intento tomado desde outbox_messages.attempt_count.';



COMMENT ON COLUMN "public"."outbox_delivery_attempts"."dispatcher" IS 'Worker/dispatcher que intento procesar el mensaje.';



COMMENT ON COLUMN "public"."outbox_delivery_attempts"."status" IS 'Estado del intento individual: started, accepted, sent, retry_pending o failed.';



COMMENT ON COLUMN "public"."outbox_delivery_attempts"."request_payload" IS 'Payload enviado al dispatcher externo.';



COMMENT ON COLUMN "public"."outbox_delivery_attempts"."response_payload" IS 'Respuesta cruda recibida del dispatcher externo.';



COMMENT ON COLUMN "public"."outbox_delivery_attempts"."error_message" IS 'Mensaje de error asociado al intento, si aplica.';



CREATE TABLE IF NOT EXISTS "public"."periodos_programa" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "anio" integer NOT NULL,
    "fecha_inicio" "date",
    "fecha_fin" "date",
    "activo" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "periodos_programa_fechas_check" CHECK ((("fecha_fin" IS NULL) OR ("fecha_inicio" IS NULL) OR ("fecha_fin" >= "fecha_inicio")))
);


ALTER TABLE "public"."periodos_programa" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."personas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "apellido" "text",
    "email" "text",
    "telefono" "text",
    "fecha_nacimiento" "date",
    "org_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."personas" OWNER TO "postgres";


COMMENT ON TABLE "public"."personas" IS 'Ancla de identidad que unifica leads, clientes y embajadores bajo un mismo registro de persona física. Tabla de infraestructura interna: el frontend accede a identidad siempre vía JOIN desde las entidades.';



COMMENT ON COLUMN "public"."personas"."org_id" IS 'Organización propietaria del registro. uuid sin FK (public.organizations no existe en prod). FK se puede agregar en migración posterior.';



CREATE TABLE IF NOT EXISTS "public"."product_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "alt_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_payment_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "plazo_meses" integer NOT NULL,
    "cuota" numeric(12,2) NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_payment_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "public_price" numeric(12,2) NOT NULL,
    "down_payment_percent" numeric(5,2),
    "down_payment_amount" numeric(12,2),
    "monthly_24" numeric(12,2),
    "monthly_19" numeric(12,2),
    "monthly_16" numeric(12,2),
    "monthly_14" numeric(12,2),
    "monthly_12" numeric(12,2),
    "monthly_11" numeric(12,2),
    "shipping_amount" numeric(12,2),
    "handling_amount" numeric(12,2),
    "effective_from" "date" DEFAULT CURRENT_DATE,
    "effective_to" "date",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."productos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "categoria" "text",
    "precio" numeric(12,2) DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "foto_url" "text",
    "costo_n1" numeric DEFAULT 0,
    "costo_n2" numeric DEFAULT 0,
    "costo_n3" numeric DEFAULT 0,
    "costo_n4" numeric DEFAULT 0,
    "pvp_publico" numeric GENERATED ALWAYS AS (("costo_n3" * (6)::numeric)) STORED,
    "categoria_compra" "text",
    "subcategoria" "text",
    "recargo_arancelario" numeric DEFAULT 0,
    "categoria_principal" "text",
    "linea_producto" "text",
    "status" "text" DEFAULT 'active'::"text",
    "replacement_product_id" "uuid",
    "legacy_code" "text",
    "description_short" "text",
    "description_long" "text",
    "benefits" "text"[],
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "foto_principal_url" "text",
    "search_vector" "tsvector",
    "estado" "text" DEFAULT 'activo'::"text",
    "descripcion_corta" "text",
    "descripcion_larga" "text",
    "beneficios" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "reemplazado_por_id" "uuid",
    "visible_catalogo" boolean DEFAULT true NOT NULL,
    "cuota_minima" numeric,
    "con_financiamiento" boolean DEFAULT false NOT NULL,
    CONSTRAINT "productos_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'offer'::"text", 'discontinued'::"text", 'replaced'::"text", 'draft'::"text"])))
);


ALTER TABLE "public"."productos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."productos_sin_costo" AS
 SELECT "id",
    "codigo",
    "nombre",
    "categoria",
    "categoria_compra",
    "categoria_principal",
    "subcategoria",
    "linea_producto",
    "precio",
    "activo",
    "foto_url",
    "created_at"
   FROM "public"."productos";


ALTER VIEW "public"."productos_sin_costo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programa_4en14" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "propietario_tipo" "text",
    "propietario_id" "uuid",
    "propietario_tabla" "text",
    "vendedor_id" "uuid",
    "ciclo_numero" integer DEFAULT 1 NOT NULL,
    "meta_presentaciones" integer DEFAULT 4 NOT NULL,
    "presentaciones_logradas" integer DEFAULT 0 NOT NULL,
    "fecha_inicio" "date",
    "fecha_fin" "date",
    "estado" "public"."programa_4en14_estado" DEFAULT 'activo'::"public"."programa_4en14_estado" NOT NULL,
    "regalo_entregado" boolean DEFAULT false NOT NULL,
    "fecha_regalo" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "regalo_producto_id" "uuid",
    CONSTRAINT "programa_4en14_propietario_tipo_check" CHECK (("propietario_tipo" = ANY (ARRAY['cliente'::"text", 'embajador'::"text", 'lead'::"text", 'vendedor'::"text"])))
);


ALTER TABLE "public"."programa_4en14" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programa_4en14_referidos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "programa_id" "uuid",
    "nombre" "text",
    "telefono" "text",
    "email" "text",
    "estado_presentacion" "public"."programa_4en14_referido_estado" DEFAULT 'pendiente'::"public"."programa_4en14_referido_estado" NOT NULL,
    "fecha_demo" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trabajan_dos" boolean DEFAULT false,
    "hijos_menores" boolean DEFAULT false,
    "tiene_credito" boolean DEFAULT false,
    "conoce_royal" boolean DEFAULT false,
    "dueno_casa" boolean DEFAULT false,
    "prioridad" boolean DEFAULT false,
    "notas" "text",
    "lead_id" "uuid",
    "prioridad_top" boolean DEFAULT false,
    "notas_adicionales" "text",
    "hora_demo" time without time zone,
    "cita_id" "uuid"
);


ALTER TABLE "public"."programa_4en14_referidos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."programas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."servicio_componentes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "servicio_id" "uuid",
    "componente_equipo_id" "uuid",
    "accion" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "servicio_componentes_accion_check" CHECK (("accion" = ANY (ARRAY['cambiado'::"text", 'revisado'::"text", 'sin_cambio'::"text"])))
);


ALTER TABLE "public"."servicio_componentes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."servicios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid",
    "equipo_instalado_id" "uuid",
    "vendedor_id" "uuid",
    "fecha_servicio" "date" NOT NULL,
    "tipo_servicio" "text",
    "observaciones" "text",
    "venta_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo" "text" DEFAULT 'cambio_repuesto'::"text",
    "hora_cita" time without time zone,
    "proxima_revision" "date",
    "repuestos_notas" "text",
    "monto_servicio" numeric DEFAULT 0,
    CONSTRAINT "servicios_tipo_check" CHECK (("tipo_servicio" = ANY (ARRAY['cambio_repuesto'::"text", 'revision'::"text", 'garantia'::"text", 'queja'::"text"])))
);


ALTER TABLE "public"."servicios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tele_vendedor_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tele_id" "uuid" NOT NULL,
    "vendedor_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tele_vendedor_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timezone_city_state_map" (
    "ciudad" "text" NOT NULL,
    "estado_region" "text" NOT NULL,
    "timezone" "text" NOT NULL
);


ALTER TABLE "public"."timezone_city_state_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timezone_zip_map" (
    "zip5" "text" NOT NULL,
    "timezone" "text" NOT NULL
);


ALTER TABLE "public"."timezone_zip_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id" "uuid" NOT NULL,
    "codigo_vendedor" "text",
    "codigo_distribuidor" "text",
    "nombre" "text",
    "apellido" "text",
    "email" "text",
    "telefono" "text",
    "rol" "public"."usuario_rol" DEFAULT 'vendedor'::"public"."usuario_rol" NOT NULL,
    "distribuidor_padre_id" "uuid",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organizacion" "text",
    "reclutador_codigo" "text",
    "foto_url" "text",
    "ciudad" "text",
    "estado_region" "text",
    "timezone" "text" DEFAULT 'America/New_York'::"text",
    "pais" "text" DEFAULT 'US'::"text",
    "org_id" "uuid"
);


ALTER TABLE "public"."usuarios" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_agenda_hoy" AS
 SELECT "s"."id" AS "agenda_id",
    "s"."vendedor_id",
    "s"."fecha_servicio" AS "fecha",
    "s"."hora_cita" AS "hora",
    'servicio'::"text" AS "tipo",
    "s"."tipo_servicio" AS "subtipo",
    (("c"."nombre" || ' '::"text") || "c"."apellido") AS "cliente_nombre",
    "c"."telefono" AS "cliente_telefono",
    "c"."direccion",
    "c"."ciudad",
    "c"."estado_region",
    "s"."observaciones" AS "notas",
    (EXISTS ( SELECT 1
           FROM "public"."servicio_componentes" "sc"
          WHERE ("sc"."servicio_id" = "s"."id"))) AS "completado"
   FROM ("public"."servicios" "s"
     JOIN "public"."clientes" "c" ON (("s"."cliente_id" = "c"."id")))
UNION ALL
 SELECT "r"."id" AS "agenda_id",
    "p"."vendedor_id",
    "r"."fecha_demo" AS "fecha",
    "r"."hora_demo" AS "hora",
    'demo'::"text" AS "tipo",
    ("r"."estado_presentacion")::"text" AS "subtipo",
    "r"."nombre" AS "cliente_nombre",
    "r"."telefono" AS "cliente_telefono",
    NULL::"text" AS "direccion",
    NULL::"text" AS "ciudad",
    NULL::"text" AS "estado_region",
    "r"."notas",
    ("r"."estado_presentacion" = ANY (ARRAY['show'::"public"."programa_4en14_referido_estado", 'demo_calificada'::"public"."programa_4en14_referido_estado", 'venta'::"public"."programa_4en14_referido_estado"])) AS "completado"
   FROM ("public"."programa_4en14_referidos" "r"
     JOIN "public"."programa_4en14" "p" ON (("r"."programa_id" = "p"."id")));


ALTER VIEW "public"."v_agenda_hoy" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_cargo_vuelta_resumen" AS
 WITH "pagos" AS (
         SELECT "p_1"."cargo_vuelta_case_id" AS "case_id",
            ("sum"("p_1"."monto"))::numeric(12,2) AS "monto_recuperado",
            "max"("p_1"."fecha_pago") AS "ultimo_pago_fecha"
           FROM "public"."cob_pagos" "p_1"
          WHERE ("p_1"."cargo_vuelta_case_id" IS NOT NULL)
          GROUP BY "p_1"."cargo_vuelta_case_id"
        ), "gestiones" AS (
         SELECT "g_1"."case_id",
            "max"("g_1"."created_at") AS "ultimo_contacto"
           FROM "public"."cob_gestiones" "g_1"
          WHERE ("g_1"."case_id" IS NOT NULL)
          GROUP BY "g_1"."case_id"
        )
 SELECT "cvc"."id" AS "case_id",
    "cvc"."org_id",
    "cvc"."cliente_id",
    "cvc"."tipo_caso",
    "cvc"."alias_operativo",
    "cvc"."estado",
    "cvc"."fecha_apertura",
    "cvc"."fecha_cierre",
    "cvc"."fecha_cargo_vuelta",
    "cvc"."monto_total",
    "cvc"."monto_devuelto",
    (COALESCE("p"."monto_recuperado", (0)::numeric))::numeric(12,2) AS "monto_recuperado",
    (GREATEST((COALESCE("cvc"."monto_devuelto", "cvc"."monto_total", (0)::numeric) - COALESCE("p"."monto_recuperado", (0)::numeric)), (0)::numeric))::numeric(12,2) AS "saldo_operativo",
    "cvc"."numero_cuenta_hycite",
    "cvc"."numero_orden_hycite",
    "cvc"."origen_cargo_vuelta",
    "cvc"."requiere_reconciliacion",
    "cl"."nombre",
    "cl"."apellido",
    "cl"."hycite_id",
    "cl"."estado_cuenta",
    "cl"."estado_cuenta_raw",
    "cl"."saldo_actual" AS "saldo_hycite_snapshot",
    "cl"."telefono",
    "cl"."telefono_casa",
    "cl"."next_action" AS "proxima_accion",
    "cl"."next_action_date" AS "proxima_accion_fecha",
    "g"."ultimo_contacto",
    "p"."ultimo_pago_fecha"
   FROM ((("public"."cargo_vuelta_cases" "cvc"
     JOIN "public"."clientes" "cl" ON (("cl"."id" = "cvc"."cliente_id")))
     LEFT JOIN "pagos" "p" ON (("p"."case_id" = "cvc"."id")))
     LEFT JOIN "gestiones" "g" ON (("g"."case_id" = "cvc"."id")))
  WHERE ("cvc"."tipo_caso" = 'cargo_vuelta'::"text");


ALTER VIEW "public"."v_cargo_vuelta_resumen" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_cargo_vuelta_resumen" IS 'Resumen operativo de casos Cargo de Vuelta / Cuenta Recomprada / DFP. Expone Monto Devuelto (principal inicial), pagos internos acumulados, Saldo Operativo (monto_devuelto - pagos), y Saldo Hy-Cite como referencia externa. Solo muestra tipo_caso=cargo_vuelta. Sin auth.uid(): filtrar por org_id desde el llamador.';



CREATE OR REPLACE VIEW "public"."v_cartera_operativa" AS
 WITH "caso_activo" AS (
         SELECT DISTINCT ON ("cargo_vuelta_cases"."cliente_id") "cargo_vuelta_cases"."id" AS "case_id",
            "cargo_vuelta_cases"."org_id",
            "cargo_vuelta_cases"."cliente_id",
            "cargo_vuelta_cases"."estado" AS "estado_caso",
            "cargo_vuelta_cases"."tipo_caso",
            "cargo_vuelta_cases"."alias_operativo",
            "cargo_vuelta_cases"."fecha_cargo_vuelta",
            COALESCE("cargo_vuelta_cases"."monto_devuelto", "cargo_vuelta_cases"."monto_total") AS "monto_devuelto",
            "cargo_vuelta_cases"."fecha_apertura",
            "cargo_vuelta_cases"."fecha_cierre"
           FROM "public"."cargo_vuelta_cases"
          WHERE ("cargo_vuelta_cases"."estado" <> 'Cerrado'::"text")
          ORDER BY "cargo_vuelta_cases"."cliente_id", "cargo_vuelta_cases"."created_at" DESC
        ), "caso_cerrado_flag" AS (
         SELECT DISTINCT ON ("cargo_vuelta_cases"."cliente_id") "cargo_vuelta_cases"."cliente_id",
            true AS "tiene_caso_cerrado"
           FROM "public"."cargo_vuelta_cases"
          WHERE ("cargo_vuelta_cases"."estado" = 'Cerrado'::"text")
          ORDER BY "cargo_vuelta_cases"."cliente_id", "cargo_vuelta_cases"."updated_at" DESC
        ), "pagos_por_caso" AS (
         SELECT "cob_pagos"."cargo_vuelta_case_id" AS "case_id",
            ("sum"("cob_pagos"."monto"))::numeric(12,2) AS "monto_recuperado"
           FROM "public"."cob_pagos"
          WHERE ("cob_pagos"."cargo_vuelta_case_id" IS NOT NULL)
          GROUP BY "cob_pagos"."cargo_vuelta_case_id"
        ), "ultimo_contacto_por_cliente" AS (
         SELECT "cob_gestiones"."cliente_id",
            "max"("cob_gestiones"."created_at") AS "ultimo_contacto_gestion"
           FROM "public"."cob_gestiones"
          GROUP BY "cob_gestiones"."cliente_id"
        ), "ptps_hycite" AS (
         SELECT "cob_ptps"."cliente_id",
            ("count"(*) FILTER (WHERE (("cob_ptps"."estado" = 'pendiente'::"text") AND ("cob_ptps"."fecha_compromiso" >= CURRENT_DATE))))::integer AS "ptps_activas",
            ("count"(*) FILTER (WHERE (("cob_ptps"."estado" = ANY (ARRAY['pendiente'::"text", 'vencido'::"text"])) AND ("cob_ptps"."fecha_compromiso" < CURRENT_DATE))))::integer AS "ptps_vencidas"
           FROM "public"."cob_ptps"
          WHERE ("cob_ptps"."case_id" IS NULL)
          GROUP BY "cob_ptps"."cliente_id"
        ), "ptps_dfp" AS (
         SELECT "cob_ptps"."case_id",
            ("count"(*) FILTER (WHERE (("cob_ptps"."estado" = 'pendiente'::"text") AND ("cob_ptps"."fecha_compromiso" >= CURRENT_DATE))))::integer AS "ptps_activas",
            ("count"(*) FILTER (WHERE (("cob_ptps"."estado" = ANY (ARRAY['pendiente'::"text", 'vencido'::"text"])) AND ("cob_ptps"."fecha_compromiso" < CURRENT_DATE))))::integer AS "ptps_vencidas"
           FROM "public"."cob_ptps"
          WHERE ("cob_ptps"."case_id" IS NOT NULL)
          GROUP BY "cob_ptps"."case_id"
        ), "plan_activo_por_caso" AS (
         SELECT "cob_plan_pagos"."case_id",
            ("count"(*))::integer AS "planes_activos"
           FROM "public"."cob_plan_pagos"
          WHERE (("cob_plan_pagos"."estado" = 'activo'::"text") AND ("cob_plan_pagos"."case_id" IS NOT NULL))
          GROUP BY "cob_plan_pagos"."case_id"
        )
 SELECT "c"."id" AS "cliente_id",
    "c"."org_id",
    "c"."nombre",
    "c"."apellido",
    "c"."telefono",
    "c"."telefono_casa",
    "c"."email",
    "c"."hycite_id",
    "c"."numero_cuenta_financiera",
    "c"."saldo_actual" AS "saldo_hycite_snapshot",
    "c"."monto_moroso",
    "c"."dias_atraso",
    "c"."estado_cuenta",
    "c"."estado_cuenta_raw",
    "ca"."case_id",
    "ca"."estado_caso",
    "ca"."tipo_caso",
    "ca"."alias_operativo",
    "ca"."fecha_cargo_vuelta",
    "ca"."monto_devuelto",
    (COALESCE("pc"."monto_recuperado", (0)::numeric))::numeric(12,2) AS "monto_recuperado",
    (GREATEST((COALESCE("ca"."monto_devuelto", (0)::numeric) - COALESCE("pc"."monto_recuperado", (0)::numeric)), (0)::numeric))::numeric(12,2) AS "saldo_operativo",
        CASE
            WHEN ("ca"."case_id" IS NOT NULL) THEN COALESCE("pd"."ptps_activas", 0)
            ELSE COALESCE("ph"."ptps_activas", 0)
        END AS "ptps_activas_count",
        CASE
            WHEN ("ca"."case_id" IS NOT NULL) THEN COALESCE("pd"."ptps_vencidas", 0)
            ELSE COALESCE("ph"."ptps_vencidas", 0)
        END AS "ptps_vencidas_count",
    COALESCE("pp"."planes_activos", 0) AS "plan_activo_count",
    COALESCE("uc"."ultimo_contacto_gestion", "c"."ultimo_contacto_at") AS "ultimo_contacto",
    "c"."next_action" AS "proxima_accion",
    "c"."next_action_date" AS "proxima_accion_fecha",
        CASE
            WHEN ("ca"."case_id" IS NOT NULL) THEN 'cargo_vuelta'::"text"
            WHEN (("ca"."case_id" IS NULL) AND (COALESCE("ph"."ptps_vencidas", 0) > 0)) THEN 'ptp_vencida_hycite'::"text"
            WHEN (("ca"."case_id" IS NULL) AND (COALESCE("ph"."ptps_activas", 0) > 0)) THEN 'ptp_activa_hycite'::"text"
            WHEN ("c"."dias_atraso" > 0) THEN 'moroso_hycite'::"text"
            WHEN (("cf"."tiene_caso_cerrado" IS TRUE) AND (COALESCE("c"."dias_atraso", 0) = 0)) THEN 'caso_cerrado'::"text"
            ELSE 'al_dia'::"text"
        END AS "clasificacion_cartera"
   FROM ((((((("public"."clientes" "c"
     LEFT JOIN "caso_activo" "ca" ON (("ca"."cliente_id" = "c"."id")))
     LEFT JOIN "pagos_por_caso" "pc" ON (("pc"."case_id" = "ca"."case_id")))
     LEFT JOIN "ultimo_contacto_por_cliente" "uc" ON (("uc"."cliente_id" = "c"."id")))
     LEFT JOIN "ptps_hycite" "ph" ON (("ph"."cliente_id" = "c"."id")))
     LEFT JOIN "ptps_dfp" "pd" ON (("pd"."case_id" = "ca"."case_id")))
     LEFT JOIN "plan_activo_por_caso" "pp" ON (("pp"."case_id" = "ca"."case_id")))
     LEFT JOIN "caso_cerrado_flag" "cf" ON (("cf"."cliente_id" = "c"."id")))
  WHERE ("c"."activo" = true);


ALTER VIEW "public"."v_cartera_operativa" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_cartera_operativa" IS 'Vista unificada de cartera operativa. Momento 1 — Moroso Hy-Cite activo: saldo desde clientes (Saldo Hy-Cite Snapshot). Momento 2 — Cargo de Vuelta / DFP: saldo operativo desde cargo_vuelta_cases (Monto Devuelto - pagos internos). Clasificación: cargo_vuelta | ptp_vencida_hycite | ptp_activa_hycite | moroso_hycite | caso_cerrado | al_dia. Sin auth.uid(): siempre filtrar por org_id desde el frontend o un RPC. Fuente: clientes WHERE activo=true.';



CREATE OR REPLACE VIEW "public"."v_cartera_telemercadeo" AS
 SELECT "c"."id",
    "c"."hycite_id" AS "numero_cuenta_externo",
    "c"."numero_cuenta_financiera",
    "c"."tipo_cliente",
    "c"."nombre",
    "c"."apellido",
    "c"."email",
    "c"."telefono" AS "telefono_movil",
    "c"."telefono_casa",
    "c"."saldo_actual",
    "c"."monto_moroso",
    "c"."dias_atraso",
    "c"."nivel",
    "c"."estado_cuenta",
    "c"."elegible_addon",
    "c"."fecha_ultimo_pedido",
    "c"."ultimo_contacto_at",
    "c"."notas_internas",
    "c"."activo",
    "c"."vendedor_id",
    (("u_vendedor"."nombre" || ' '::"text") || "u_vendedor"."apellido") AS "vendedor_nombre",
    "u_vendedor"."codigo_vendedor",
    "c"."distribuidor_id",
    "u_dist"."codigo_distribuidor",
    "public"."fn_clasificar_atraso"("c"."monto_moroso", "c"."fecha_ultimo_pedido") AS "segmento_atraso",
    ( SELECT "max"("lt"."fecha_llamada") AS "max"
           FROM "public"."llamadas_telemercadeo" "lt"
          WHERE ("lt"."cliente_id" = "c"."id")) AS "ultima_llamada_at",
    ( SELECT "count"(*) AS "count"
           FROM "public"."llamadas_telemercadeo" "lt"
          WHERE ("lt"."cliente_id" = "c"."id")) AS "total_llamadas",
    "c"."created_at",
    "c"."updated_at"
   FROM (("public"."clientes" "c"
     LEFT JOIN "public"."usuarios" "u_vendedor" ON (("u_vendedor"."id" = "c"."vendedor_id")))
     LEFT JOIN "public"."usuarios" "u_dist" ON (("u_dist"."id" = "c"."distribuidor_id")));


ALTER VIEW "public"."v_cartera_telemercadeo" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_catalogo_vendedor" WITH ("security_invoker"='true') AS
 SELECT "p"."id",
    "p"."codigo",
    "p"."nombre",
    "p"."categoria",
    "p"."categoria_principal",
    "p"."subcategoria",
    "p"."linea_producto",
    "p"."precio" AS "precio_publico",
    "p"."foto_url" AS "foto_principal_url",
    "p"."activo",
    "p"."estado",
    "p"."descripcion_corta",
    "p"."descripcion_larga",
    "p"."beneficios",
    "p"."reemplazado_por_id",
    "r"."codigo" AS "reemplazado_por_codigo",
    "r"."nombre" AS "reemplazado_por_nombre",
    "p"."cuota_minima",
    "p"."con_financiamiento",
    "p"."visible_catalogo",
    NULL::"text" AS "foto_galeria_url"
   FROM ("public"."productos" "p"
     LEFT JOIN "public"."productos" "r" ON (("r"."id" = "p"."reemplazado_por_id")))
  WHERE ("p"."activo" = true);


ALTER VIEW "public"."v_catalogo_vendedor" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_componentes_vencidos" WITH ("security_invoker"='true') AS
 SELECT "c"."id" AS "cliente_id",
    "c"."nombre",
    "c"."apellido",
    "c"."telefono",
    "c"."vendedor_id",
    "c"."distribuidor_id",
    "e"."id" AS "equipo_id",
    "e"."numero_serie",
    "comp"."id" AS "componente_id",
    "comp"."nombre_componente",
    "comp"."tipo_componente",
    "comp"."ciclo_meses",
    "comp"."fecha_ultimo_cambio",
    "comp"."fecha_proximo_cambio"
   FROM (("public"."componentes_equipo" "comp"
     JOIN "public"."equipos_instalados" "e" ON (("e"."id" = "comp"."equipo_instalado_id")))
     JOIN "public"."clientes" "c" ON (("c"."id" = "e"."cliente_id")))
  WHERE (("comp"."activo" = true) AND ("comp"."fecha_proximo_cambio" IS NOT NULL) AND ("comp"."fecha_proximo_cambio" <= CURRENT_DATE));


ALTER VIEW "public"."v_componentes_vencidos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ledger_saldos_reconstruidos" AS
 SELECT "revolving_account_id",
    "org_id",
    ("sum"((
        CASE
            WHEN (("component_type" = 'principal'::"text") AND ("debit_credit" = 'debit'::"text")) THEN "amount"
            ELSE (0)::numeric
        END -
        CASE
            WHEN (("component_type" = 'principal'::"text") AND ("debit_credit" = 'credit'::"text")) THEN "amount"
            ELSE (0)::numeric
        END)))::numeric(12,2) AS "saldo_principal_reconstruido",
    ("sum"((
        CASE
            WHEN (("component_type" = 'interest'::"text") AND ("debit_credit" = 'debit'::"text")) THEN "amount"
            ELSE (0)::numeric
        END -
        CASE
            WHEN (("component_type" = 'interest'::"text") AND ("debit_credit" = 'credit'::"text")) THEN "amount"
            ELSE (0)::numeric
        END)))::numeric(12,2) AS "saldo_interes_reconstruido",
    ("sum"((
        CASE
            WHEN (("component_type" = 'fee'::"text") AND ("debit_credit" = 'debit'::"text")) THEN "amount"
            ELSE (0)::numeric
        END -
        CASE
            WHEN (("component_type" = 'fee'::"text") AND ("debit_credit" = 'credit'::"text")) THEN "amount"
            ELSE (0)::numeric
        END)))::numeric(12,2) AS "saldo_fees_reconstruido",
    ("sum"((
        CASE
            WHEN ("debit_credit" = 'debit'::"text") THEN "amount"
            ELSE (0)::numeric
        END -
        CASE
            WHEN ("debit_credit" = 'credit'::"text") THEN "amount"
            ELSE (0)::numeric
        END)))::numeric(12,2) AS "saldo_total_reconstruido",
    ("count"(*))::integer AS "total_entries",
    "max"("effective_date") AS "ultimo_effective_date"
   FROM "public"."cob_financial_ledger"
  GROUP BY "revolving_account_id", "org_id";


ALTER VIEW "public"."v_ledger_saldos_reconstruidos" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_ledger_saldos_reconstruidos" IS 'Saldos reconstruidos desde el Ledger Financiero Inmutable (cob_financial_ledger) desde cero. No usa saldos materializados de cob_revolving_accounts. Usar para auditoría o para detectar drift entre ledger y cob_revolving_accounts. Sin auth.uid(): filtrar por org_id desde el llamador.';



CREATE OR REPLACE VIEW "public"."v_dfp_caso_resumen" WITH ("security_invoker"='true') AS
 WITH "ultimo_ledger" AS (
         SELECT DISTINCT ON ("cob_financial_ledger"."revolving_account_id") "cob_financial_ledger"."revolving_account_id",
            "cob_financial_ledger"."id" AS "ultimo_ledger_id",
            "cob_financial_ledger"."entry_type" AS "ultimo_entry_type",
            "cob_financial_ledger"."component_type" AS "ultimo_component_type",
            "cob_financial_ledger"."amount" AS "ultimo_amount",
            "cob_financial_ledger"."effective_date" AS "ultimo_ledger_fecha"
           FROM "public"."cob_financial_ledger"
          ORDER BY "cob_financial_ledger"."revolving_account_id", "cob_financial_ledger"."effective_date" DESC, "cob_financial_ledger"."created_at" DESC
        ), "ledger_tiene_inicial" AS (
         SELECT "cob_financial_ledger"."revolving_account_id",
            true AS "tiene_principal_initial"
           FROM "public"."cob_financial_ledger"
          WHERE ("cob_financial_ledger"."entry_type" = 'principal_initial'::"text")
          GROUP BY "cob_financial_ledger"."revolving_account_id"
        )
 SELECT "c"."id" AS "case_id",
    "c"."org_id",
    "c"."cliente_id",
    "c"."tipo_caso",
    "c"."alias_operativo",
    "c"."estado" AS "estado_caso",
    "c"."fecha_apertura",
    "c"."fecha_cierre",
    "c"."fecha_cargo_vuelta",
    "c"."monto_devuelto",
    "c"."requiere_reconciliacion",
    "c"."numero_cuenta_hycite",
    "c"."numero_orden_hycite",
    "c"."origen_cargo_vuelta",
    "a"."id" AS "account_id",
    "a"."apr_anual",
    "a"."metodo_calculo_interes",
    "a"."fecha_inicio",
    "a"."fecha_ultimo_devengo",
    "a"."saldo_principal_inicial",
    "a"."saldo_principal_actual",
    "a"."saldo_interes_actual",
    "a"."saldo_fees_actual",
    "a"."saldo_total_actual" AS "saldo_operativo_interno",
    "a"."estado" AS "estado_cuenta",
    "ul"."ultimo_entry_type",
    "ul"."ultimo_component_type",
    "ul"."ultimo_ledger_fecha",
    "ul"."ultimo_amount" AS "ultimo_ledger_monto",
    "lr"."saldo_principal_reconstruido",
    "lr"."saldo_interes_reconstruido",
    "lr"."saldo_fees_reconstruido",
    "lr"."saldo_total_reconstruido",
    "lr"."total_entries" AS "ledger_total_entries",
        CASE
            WHEN (("a"."id" IS NOT NULL) AND ("lr"."revolving_account_id" IS NOT NULL)) THEN "round"((COALESCE("a"."saldo_total_actual", (0)::numeric) - COALESCE("lr"."saldo_total_reconstruido", (0)::numeric)), 2)
            ELSE NULL::numeric
        END AS "drift_saldo_total",
        CASE
            WHEN (("a"."id" IS NOT NULL) AND (COALESCE("li"."tiene_principal_initial", false) = false)) THEN true
            ELSE false
        END AS "requiere_configuracion",
        CASE
            WHEN (("a"."id" IS NOT NULL) AND ("lr"."revolving_account_id" IS NOT NULL) AND ("abs"((COALESCE("a"."saldo_total_actual", (0)::numeric) - COALESCE("lr"."saldo_total_reconstruido", (0)::numeric))) > 0.01)) THEN true
            ELSE false
        END AS "requiere_revision_saldos",
        CASE
            WHEN (("a"."id" IS NULL) AND (COALESCE("c"."monto_devuelto", (0)::numeric) > (0)::numeric) AND ("c"."tipo_caso" = 'cargo_vuelta'::"text") AND ("c"."estado" <> ALL (ARRAY['Cerrado'::"text", 'Cancelado'::"text"]))) THEN true
            ELSE false
        END AS "puede_crear_cuenta_revolving",
        CASE
            WHEN (("a"."id" IS NOT NULL) AND (("a"."apr_anual" >= 0.10) AND ("a"."apr_anual" <= 0.24)) AND (COALESCE("a"."saldo_principal_actual", (0)::numeric) > (0)::numeric) AND ("a"."fecha_ultimo_devengo" < CURRENT_DATE) AND ("a"."estado" = ANY (ARRAY['activo'::"text", 'moroso'::"text", 'en_plan'::"text"]))) THEN true
            ELSE false
        END AS "puede_devengar_interes"
   FROM (((("public"."cargo_vuelta_cases" "c"
     LEFT JOIN "public"."cob_revolving_accounts" "a" ON ((("a"."case_id" = "c"."id") AND ("a"."org_id" = "c"."org_id"))))
     LEFT JOIN "ultimo_ledger" "ul" ON (("ul"."revolving_account_id" = "a"."id")))
     LEFT JOIN "public"."v_ledger_saldos_reconstruidos" "lr" ON ((("lr"."revolving_account_id" = "a"."id") AND ("lr"."org_id" = "a"."org_id"))))
     LEFT JOIN "ledger_tiene_inicial" "li" ON (("li"."revolving_account_id" = "a"."id")))
  WHERE ("c"."tipo_caso" = 'cargo_vuelta'::"text");


ALTER VIEW "public"."v_dfp_caso_resumen" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_dfp_caso_resumen" IS 'Vista read-only de soporte UI para casos Cargo de Vuelta / DFP. Unifica cargo_vuelta_cases, cob_revolving_accounts, cob_financial_ledger y v_ledger_saldos_reconstruidos. SECURITY INVOKER: RLS de las tablas base se aplica al llamador. Sin auth.uid(): siempre filtrar por org_id desde el frontend o un RPC. Solo muestra tipo_caso=cargo_vuelta. Las banderas puede_* son informativas para UI; la autorización real vive en las RPCs.';



CREATE OR REPLACE VIEW "public"."v_izzy_flow_rp_clientes_import_eligible" AS
 WITH "base" AS (
         SELECT "c"."id" AS "cliente_id",
            "c"."nombre",
            "c"."apellido",
            "concat_ws"(' '::"text", NULLIF(TRIM(BOTH FROM "c"."nombre"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."apellido"), ''::"text")) AS "cliente",
            "lower"(NULLIF(TRIM(BOTH FROM "c"."email"), ''::"text")) AS "correo_cliente",
            "c"."telefono",
            NULLIF("regexp_replace"(COALESCE("c"."telefono", ''::"text"), '\D'::"text", ''::"text", 'g'::"text"), ''::"text") AS "telefono_normalizado",
            "c"."direccion",
            "c"."activo",
            "c"."whatsapp_opt_in",
            "c"."whatsapp_no_molestar",
            "c"."created_at",
            "c"."updated_at"
           FROM "public"."clientes" "c"
        )
 SELECT "cliente_id",
    "nombre",
    "apellido",
    "cliente",
    "correo_cliente",
    "telefono",
    "telefono_normalizado",
    "direccion",
    "activo",
    "whatsapp_opt_in",
    "whatsapp_no_molestar",
    "created_at",
    "updated_at",
    (EXISTS ( SELECT 1
           FROM "public"."izzy_leads" "l"
          WHERE (NULLIF("regexp_replace"(COALESCE("l"."telefono", ''::"text"), '\D'::"text", ''::"text", 'g'::"text"), ''::"text") = "b"."telefono_normalizado"))) AS "ya_existe_en_izzy"
   FROM "base" "b"
  WHERE (COALESCE("activo", true) AND (COALESCE("whatsapp_opt_in", false) = true) AND (COALESCE("whatsapp_no_molestar", false) = false) AND ("telefono_normalizado" IS NOT NULL));


ALTER VIEW "public"."v_izzy_flow_rp_clientes_import_eligible" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_izzy_flow_rp_clientes_import_eligible" IS 'Clientes Flow / Royal Prestige elegibles para reactivacion en Izzy, con telefono normalizado y bandera de duplicado contra public.izzy_leads.';



CREATE OR REPLACE VIEW "public"."v_izzy_flow_rp_clientes_import_summary" AS
 SELECT ( SELECT "count"(*) AS "count"
           FROM "public"."clientes") AS "total_clientes",
    ( SELECT "count"(*) AS "count"
           FROM "public"."clientes" "c"
          WHERE (COALESCE("c"."activo", true) AND (NULLIF("regexp_replace"(COALESCE("c"."telefono", ''::"text"), '\D'::"text", ''::"text", 'g'::"text"), ''::"text") IS NOT NULL))) AS "activos_con_telefono",
    ( SELECT "count"(*) AS "count"
           FROM "public"."v_izzy_flow_rp_clientes_import_eligible") AS "elegibles_whatsapp",
    ( SELECT "count"(*) AS "count"
           FROM "public"."v_izzy_flow_rp_clientes_import_eligible" "e"
          WHERE ("e"."ya_existe_en_izzy" = false)) AS "elegibles_pendientes_importar",
    ( SELECT "count"(*) AS "count"
           FROM "public"."v_izzy_flow_rp_clientes_import_eligible" "e"
          WHERE ("e"."ya_existe_en_izzy" = true)) AS "elegibles_ya_presentes_en_izzy";


ALTER VIEW "public"."v_izzy_flow_rp_clientes_import_summary" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_izzy_flow_rp_clientes_import_summary" IS 'Resumen para revisar clientes Flow / Royal Prestige totales, elegibles y pendientes de importar a public.izzy_leads.';



CREATE OR REPLACE VIEW "public"."v_lead_fuentes" WITH ("security_invoker"='true') AS
 SELECT DISTINCT "btrim"("fuente") AS "fuente_raw",
    "lower"("btrim"("fuente")) AS "fuente_norm"
   FROM "public"."leads"
  WHERE (("fuente" IS NOT NULL) AND ("btrim"("fuente") <> ''::"text"));


ALTER VIEW "public"."v_lead_fuentes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_lead_last_activity" WITH ("security_invoker"='true') AS
 SELECT "l"."id" AS "lead_id",
    GREATEST(COALESCE("max"("n"."created_at"), "l"."updated_at"), "l"."updated_at") AS "last_activity_at"
   FROM ("public"."leads" "l"
     LEFT JOIN "public"."lead_notas" "n" ON (("n"."lead_id" = "l"."id")))
  WHERE ("l"."deleted_at" IS NULL)
  GROUP BY "l"."id", "l"."updated_at";


ALTER VIEW "public"."v_lead_last_activity" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_mk_campaign_stats" AS
SELECT
    NULL::"uuid" AS "campaign_id",
    NULL::"text" AS "nombre",
    NULL::"text" AS "segmento_key",
    NULL::"text" AS "canal",
    NULL::"text" AS "estado",
    NULL::integer AS "total_contactos",
    NULL::"uuid" AS "owner_id",
    NULL::bigint AS "total_mensajes",
    NULL::bigint AS "total_abiertos",
    NULL::bigint AS "total_respondidos",
    NULL::bigint AS "total_pendientes",
    NULL::bigint AS "citas",
    NULL::bigint AS "pagos_prometidos",
    NULL::bigint AS "no_interesados",
    NULL::bigint AS "sin_respuesta",
    NULL::numeric AS "monto_comprometido",
    NULL::numeric AS "tasa_respuesta_pct",
    NULL::numeric AS "tasa_citas_pct";


ALTER VIEW "public"."v_mk_campaign_stats" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_product_catalog" AS
 SELECT "p"."id",
    "p"."codigo",
    "p"."legacy_code",
    "p"."nombre",
    "p"."categoria",
    "p"."categoria_principal",
    "p"."subcategoria",
    "p"."linea_producto",
    "p"."precio" AS "base_price",
    "p"."foto_url",
    "p"."activo",
    "p"."status",
    "p"."replacement_product_id",
    "p"."description_short",
    "p"."description_long",
    "p"."benefits",
    "pr"."public_price",
    "pr"."down_payment_percent",
    "pr"."down_payment_amount",
    "pr"."monthly_24",
    "pr"."monthly_19",
    "pr"."monthly_16",
    "pr"."monthly_14",
    "pr"."monthly_12",
    "pr"."monthly_11",
    "pr"."shipping_amount",
    "pr"."handling_amount",
    "pr"."is_active" AS "price_active"
   FROM ("public"."productos" "p"
     LEFT JOIN LATERAL ( SELECT "product_prices"."id",
            "product_prices"."product_id",
            "product_prices"."public_price",
            "product_prices"."down_payment_percent",
            "product_prices"."down_payment_amount",
            "product_prices"."monthly_24",
            "product_prices"."monthly_19",
            "product_prices"."monthly_16",
            "product_prices"."monthly_14",
            "product_prices"."monthly_12",
            "product_prices"."monthly_11",
            "product_prices"."shipping_amount",
            "product_prices"."handling_amount",
            "product_prices"."effective_from",
            "product_prices"."effective_to",
            "product_prices"."is_active",
            "product_prices"."created_at",
            "product_prices"."updated_at"
           FROM "public"."product_prices"
          WHERE (("product_prices"."product_id" = "p"."id") AND ("product_prices"."is_active" = true) AND (("product_prices"."effective_from" <= CURRENT_DATE) OR ("product_prices"."effective_from" IS NULL)) AND (("product_prices"."effective_to" >= CURRENT_DATE) OR ("product_prices"."effective_to" IS NULL)))
          ORDER BY "product_prices"."effective_from" DESC
         LIMIT 1) "pr" ON (true))
  WHERE ("p"."activo" = true);


ALTER VIEW "public"."v_product_catalog" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_productos_publicos" WITH ("security_invoker"='true') AS
 SELECT "id",
    "codigo",
    "nombre",
    "categoria",
    "categoria_compra",
    "categoria_principal",
    "subcategoria",
    "linea_producto",
    "precio",
    "activo",
    "foto_url",
    "visible_catalogo",
    "created_at"
   FROM "public"."productos"
  WHERE (("activo" = true) AND ("visible_catalogo" = true));


ALTER VIEW "public"."v_productos_publicos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendedor_telemercadeo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "telemercadista_id" "uuid",
    "vendedor_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendedor_telemercadeo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venta_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "venta_id" "uuid" NOT NULL,
    "linea" integer NOT NULL,
    "producto_id" "uuid",
    "codigo_articulo" "text",
    "descripcion" "text",
    "cantidad" integer DEFAULT 1 NOT NULL,
    "precio_unitario" numeric(12,2) DEFAULT 0 NOT NULL,
    "subtotal" numeric(12,2) GENERATED ALWAYS AS ((("cantidad")::numeric * "precio_unitario")) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."venta_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venta_transacciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "venta_id" "uuid" NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "descripcion" "text" NOT NULL,
    "cantidad" numeric(12,2) NOT NULL,
    "saldo" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."venta_transacciones" OWNER TO "postgres";


COMMENT ON COLUMN "public"."venta_transacciones"."cantidad" IS 'Legacy name. Monetary amount of the transaction line, stored as numeric(12,2); not a unit quantity.';



CREATE TABLE IF NOT EXISTS "public"."ventas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "numero_nota_pedido" "text",
    "cliente_id" "uuid",
    "vendedor_id" "uuid",
    "producto_id" "uuid",
    "tipo_movimiento" "public"."venta_tipo_movimiento" NOT NULL,
    "monto" numeric(12,2) DEFAULT 0 NOT NULL,
    "fecha_venta" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estado" "text" DEFAULT 'confirmada'::"text" NOT NULL,
    "subtotal" numeric(12,2),
    "impuesto" numeric(12,2) DEFAULT 0,
    "cargo_envio" numeric(12,2) DEFAULT 0,
    "descuento" numeric(12,2) DEFAULT 0,
    "total" numeric(12,2),
    "pago_inicial" numeric(12,2) DEFAULT 0,
    "saldo_pendiente" numeric(12,2),
    "dir_facturacion_nombre" "text",
    "dir_facturacion_direccion" "text",
    "dir_facturacion_ciudad" "text",
    "dir_facturacion_estado" "text",
    "dir_facturacion_zip" "text",
    "dir_facturacion_email" "text",
    "dir_envio_nombre" "text",
    "dir_envio_direccion" "text",
    "dir_envio_ciudad" "text",
    "dir_envio_estado" "text",
    "dir_envio_zip" "text",
    "dir_envio_igual_facturacion" boolean DEFAULT true,
    "notas" "text",
    "org_id" "uuid",
    CONSTRAINT "ventas_estado_check" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'confirmada'::"text", 'procesando'::"text", 'entregada'::"text", 'cancelada'::"text"]))),
    CONSTRAINT "ventas_monto_nonneg" CHECK (("monto" >= (0)::numeric))
);


ALTER TABLE "public"."ventas" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ventas"."org_id" IS 'Tenant owner organization. Backfilled from vendedor_id -> usuarios.org_id, then cliente_id -> clientes.org_id, with default org fallback only for unresolved legacy data.';



ALTER TABLE ONLY "public"."izzy_leads" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."izzy_leads_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."auto_reply_rules"
    ADD CONSTRAINT "auto_reply_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bot_sessions"
    ADD CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cargo_vuelta_cases"
    ADD CONSTRAINT "cargo_vuelta_cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cartera_resumen_diario"
    ADD CONSTRAINT "cartera_resumen_diario_fecha_key" UNIQUE ("fecha");



ALTER TABLE ONLY "public"."cartera_resumen_diario"
    ADD CONSTRAINT "cartera_resumen_diario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ci_referidos"
    ADD CONSTRAINT "ci_referidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."citas"
    ADD CONSTRAINT "citas_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."clientes"
    ADD CONSTRAINT "clientes_estado_operativo_check" CHECK ((("estado_operativo" IS NULL) OR ("estado_operativo" = ANY (ARRAY['activo'::"text", 'inactivo'::"text", 'cancelado'::"text"])))) NOT VALID;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_hycite_id_key" UNIQUE ("hycite_id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_numero_cuenta_financiera_key" UNIQUE ("numero_cuenta_financiera");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_org_telefono_uidx" UNIQUE ("org_id", "telefono");



COMMENT ON CONSTRAINT "clientes_org_telefono_uidx" ON "public"."clientes" IS 'Idempotencia OCR: un teléfono por organización. NULL excluido de unicidad.';



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes_rp"
    ADD CONSTRAINT "clientes_rp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_acuerdo_eventos"
    ADD CONSTRAINT "cob_acuerdo_eventos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_acuerdos_pago_automatico"
    ADD CONSTRAINT "cob_acuerdos_pago_automatico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_cobros_programados"
    ADD CONSTRAINT "cob_cobros_programados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_cv_balance_adjustments"
    ADD CONSTRAINT "cob_cv_balance_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_cv_resumen_lines"
    ADD CONSTRAINT "cob_cv_resumen_lines_line_uidx" UNIQUE ("resumen_id", "line_number");



ALTER TABLE ONLY "public"."cob_cv_resumen_lines"
    ADD CONSTRAINT "cob_cv_resumen_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_cv_resumenes"
    ADD CONSTRAINT "cob_cv_resumenes_case_periodo_uidx" UNIQUE ("case_id", "periodo_inicio", "periodo_fin");



ALTER TABLE ONLY "public"."cob_cv_resumenes"
    ADD CONSTRAINT "cob_cv_resumenes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_document_generation_run_items"
    ADD CONSTRAINT "cob_document_generation_run_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_document_generation_runs"
    ADD CONSTRAINT "cob_document_generation_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_gestiones"
    ADD CONSTRAINT "cob_gestiones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_metodos_pago"
    ADD CONSTRAINT "cob_metodos_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_pagos"
    ADD CONSTRAINT "cob_pagos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_plan_cuotas"
    ADD CONSTRAINT "cob_plan_cuotas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_plan_cuotas"
    ADD CONSTRAINT "cob_plan_cuotas_plan_numero_uidx" UNIQUE ("plan_id", "numero_cuota");



ALTER TABLE ONLY "public"."cob_plan_pagos"
    ADD CONSTRAINT "cob_plan_pagos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_ptps"
    ADD CONSTRAINT "cob_ptps_gestion_activo_uidx" UNIQUE ("gestion_id") DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."cob_ptps"
    ADD CONSTRAINT "cob_ptps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_revolving_accounts"
    ADD CONSTRAINT "cob_revolving_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_statement_lines"
    ADD CONSTRAINT "cob_statement_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_statements"
    ADD CONSTRAINT "cob_statements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cob_statements"
    ADD CONSTRAINT "cob_statements_unique_period" UNIQUE ("org_id", "revolving_account_id", "periodo_inicio", "periodo_fin");



ALTER TABLE ONLY "public"."componentes_equipo"
    ADD CONSTRAINT "componentes_equipo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacto_actividades"
    ADD CONSTRAINT "contacto_actividades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_tareas"
    ADD CONSTRAINT "crm_tareas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dfp_notification_events"
    ADD CONSTRAINT "dfp_notification_events_pkey" PRIMARY KEY ("notification_key");



ALTER TABLE ONLY "public"."embajador_programas"
    ADD CONSTRAINT "embajador_programas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."embajador_programas"
    ADD CONSTRAINT "embajador_programas_unique" UNIQUE ("embajador_id", "periodo_id");



ALTER TABLE ONLY "public"."embajadores"
    ADD CONSTRAINT "embajadores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipos_instalados"
    ADD CONSTRAINT "equipos_instalados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_configs"
    ADD CONSTRAINT "import_configs_org_id_source_id_key" UNIQUE ("org_id", "source_id");



ALTER TABLE ONLY "public"."import_configs"
    ADD CONSTRAINT "import_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_processed_files"
    ADD CONSTRAINT "import_processed_files_pkey" PRIMARY KEY ("org_id", "file_id");



ALTER TABLE ONLY "public"."import_revisiones"
    ADD CONSTRAINT "import_revisiones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_runs"
    ADD CONSTRAINT "import_runs_pkey" PRIMARY KEY ("run_id");



ALTER TABLE ONLY "public"."importaciones_hycite"
    ADD CONSTRAINT "importaciones_hycite_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbox_tasks"
    ADD CONSTRAINT "inbox_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_activity_rules"
    ADD CONSTRAINT "izzy_activity_rules_pkey" PRIMARY KEY ("rank_code");



ALTER TABLE ONLY "public"."izzy_agent_rank_history"
    ADD CONSTRAINT "izzy_agent_rank_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_ambassadors"
    ADD CONSTRAINT "izzy_ambassadors_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."izzy_ambassadors"
    ADD CONSTRAINT "izzy_ambassadors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_carriers"
    ADD CONSTRAINT "izzy_carriers_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."izzy_carriers"
    ADD CONSTRAINT "izzy_carriers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_commission_rates"
    ADD CONSTRAINT "izzy_commission_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_commission_rates"
    ADD CONSTRAINT "izzy_commission_rates_unique" UNIQUE ("rank_code", "service_category_code", "sale_type");



ALTER TABLE ONLY "public"."izzy_commission_reserves"
    ADD CONSTRAINT "izzy_commission_reserves_order_id_key" UNIQUE ("order_id");



ALTER TABLE ONLY "public"."izzy_commission_reserves"
    ADD CONSTRAINT "izzy_commission_reserves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_compensation_audit_log"
    ADD CONSTRAINT "izzy_compensation_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_compensation_plans"
    ADD CONSTRAINT "izzy_compensation_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_compensation_plans"
    ADD CONSTRAINT "izzy_compensation_plans_unique" UNIQUE ("carrier_id", "plan_name", "sale_type");



ALTER TABLE ONLY "public"."izzy_compensation_promotions"
    ADD CONSTRAINT "izzy_compensation_promotions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_compensation_settings"
    ADD CONSTRAINT "izzy_compensation_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."izzy_director_bonus_rates"
    ADD CONSTRAINT "izzy_director_bonus_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_director_bonus_rates"
    ADD CONSTRAINT "izzy_director_bonus_rates_unique" UNIQUE ("service_category_code", "sale_type");



ALTER TABLE ONLY "public"."izzy_leads"
    ADD CONSTRAINT "izzy_leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_orders"
    ADD CONSTRAINT "izzy_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_password_reset_requests"
    ADD CONSTRAINT "izzy_password_reset_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_password_reset_tokens"
    ADD CONSTRAINT "izzy_password_reset_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_password_reset_tokens"
    ADD CONSTRAINT "izzy_password_reset_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."izzy_portal_users"
    ADD CONSTRAINT "izzy_portal_users_pin_code_key" UNIQUE ("pin_code");



ALTER TABLE ONLY "public"."izzy_portal_users"
    ADD CONSTRAINT "izzy_portal_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_quoters"
    ADD CONSTRAINT "izzy_quoters_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."izzy_quoters"
    ADD CONSTRAINT "izzy_quoters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."izzy_rank_levels"
    ADD CONSTRAINT "izzy_rank_levels_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."izzy_rank_requirements"
    ADD CONSTRAINT "izzy_rank_requirements_pkey" PRIMARY KEY ("from_rank_code");



ALTER TABLE ONLY "public"."izzy_service_categories"
    ADD CONSTRAINT "izzy_service_categories_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."lead_notas"
    ADD CONSTRAINT "lead_notas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."llamadas_telemercadeo"
    ADD CONSTRAINT "llamadas_telemercadeo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mk_campaigns"
    ADD CONSTRAINT "mk_campaigns_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."mk_campaigns"
    ADD CONSTRAINT "mk_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mk_messages"
    ADD CONSTRAINT "mk_messages_campaign_telefono_key" UNIQUE ("campaign_id", "telefono");



ALTER TABLE ONLY "public"."mk_messages"
    ADD CONSTRAINT "mk_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mk_responses"
    ADD CONSTRAINT "mk_responses_message_id_key" UNIQUE ("message_id");



ALTER TABLE ONLY "public"."mk_responses"
    ADD CONSTRAINT "mk_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notasrp"
    ADD CONSTRAINT "notasrp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oportunidades"
    ADD CONSTRAINT "oportunidades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."outbox_delivery_attempts"
    ADD CONSTRAINT "outbox_delivery_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."outbox_messages"
    ADD CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."periodos_programa"
    ADD CONSTRAINT "periodos_programa_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."personas"
    ADD CONSTRAINT "personas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_payment_plans"
    ADD CONSTRAINT "product_payment_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_payment_plans"
    ADD CONSTRAINT "product_payment_plans_product_id_plazo_meses_key" UNIQUE ("product_id", "plazo_meses");



ALTER TABLE ONLY "public"."product_prices"
    ADD CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_prices"
    ADD CONSTRAINT "product_prices_product_id_is_active_effective_from_key" UNIQUE ("product_id", "is_active", "effective_from");



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."programa_4en14"
    ADD CONSTRAINT "programa_4en14_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."programa_4en14_referidos"
    ADD CONSTRAINT "programa_4en14_referidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."programas"
    ADD CONSTRAINT "programas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prospectos_rp"
    ADD CONSTRAINT "prospectos_rp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."servicio_componentes"
    ADD CONSTRAINT "servicio_componentes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tele_vendedor_assignments"
    ADD CONSTRAINT "tele_vendedor_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tele_vendedor_assignments"
    ADD CONSTRAINT "tele_vendedor_assignments_tele_id_vendedor_id_key" UNIQUE ("tele_id", "vendedor_id");



ALTER TABLE ONLY "public"."tele_vendedor_assignments"
    ADD CONSTRAINT "tele_vendedor_assignments_unique" UNIQUE ("tele_id", "vendedor_id");



ALTER TABLE ONLY "public"."timezone_city_state_map"
    ADD CONSTRAINT "timezone_city_state_map_pkey" PRIMARY KEY ("ciudad", "estado_region");



ALTER TABLE ONLY "public"."timezone_zip_map"
    ADD CONSTRAINT "timezone_zip_map_pkey" PRIMARY KEY ("zip5");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_codigo_vendedor_key" UNIQUE ("codigo_vendedor");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendedor_telemercadeo"
    ADD CONSTRAINT "vendedor_telemercadeo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendedor_telemercadeo"
    ADD CONSTRAINT "vendedor_telemercadeo_telemercadista_id_vendedor_id_key" UNIQUE ("telemercadista_id", "vendedor_id");



ALTER TABLE ONLY "public"."venta_items"
    ADD CONSTRAINT "venta_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venta_transacciones"
    ADD CONSTRAINT "venta_transacciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_numero_nota_pedido_key" UNIQUE ("numero_nota_pedido");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_pkey" PRIMARY KEY ("id");



CREATE INDEX "auto_reply_rules_org_active_idx" ON "public"."auto_reply_rules" USING "btree" ("org_id", "priority" DESC) WHERE ("active" = true);



CREATE UNIQUE INDEX "auto_reply_rules_org_keyword_uidx" ON "public"."auto_reply_rules" USING "btree" ("org_id", "lower"("keyword"));



CREATE UNIQUE INDEX "bot_sessions_active_chat_idx" ON "public"."bot_sessions" USING "btree" ("chat_id", "canal") WHERE ("activa" = true);



CREATE INDEX "bot_sessions_expires_idx" ON "public"."bot_sessions" USING "btree" ("expires_at") WHERE ("activa" = true);



CREATE INDEX "cargo_vuelta_cases_cliente_id_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("cliente_id");



CREATE INDEX "cargo_vuelta_cases_estado_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("estado");



CREATE INDEX "cargo_vuelta_cases_fecha_cargo_vuelta_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("org_id", "fecha_cargo_vuelta" DESC) WHERE ("fecha_cargo_vuelta" IS NOT NULL);



CREATE INDEX "cargo_vuelta_cases_numero_cuenta_hycite_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("org_id", "numero_cuenta_hycite") WHERE ("numero_cuenta_hycite" IS NOT NULL);



CREATE INDEX "cargo_vuelta_cases_org_cliente_estado_updated_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("org_id", "cliente_id", "estado", "updated_at" DESC);



CREATE INDEX "cargo_vuelta_cases_org_id_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("org_id");



CREATE INDEX "cargo_vuelta_cases_proceso_legal_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("org_id", "en_proceso_legal") WHERE ("en_proceso_legal" = true);



CREATE INDEX "cargo_vuelta_cases_requiere_reconciliacion_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("org_id", "requiere_reconciliacion") WHERE ("requiere_reconciliacion" = true);



CREATE INDEX "cargo_vuelta_cases_tipo_caso_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("org_id", "tipo_caso");



CREATE INDEX "cargo_vuelta_cases_updated_by_idx" ON "public"."cargo_vuelta_cases" USING "btree" ("updated_by");



CREATE INDEX "ci_referidos_cita_id_idx" ON "public"."ci_referidos" USING "btree" ("cita_id") WHERE ("cita_id" IS NOT NULL);



CREATE INDEX "citas_assigned_to_start_idx" ON "public"."citas" USING "btree" ("assigned_to", "start_at");



CREATE INDEX "citas_campaign_idx" ON "public"."citas" USING "btree" ("campaign_id") WHERE ("campaign_id" IS NOT NULL);



CREATE INDEX "citas_contacto_idx" ON "public"."citas" USING "btree" ("contacto_tipo", "contacto_id");



CREATE INDEX "citas_owner_idx" ON "public"."citas" USING "btree" ("owner_id");



CREATE INDEX "citas_start_estado_idx" ON "public"."citas" USING "btree" ("start_at", "estado") WHERE ("estado" = ANY (ARRAY['completada'::"text", 'no_show'::"text", 'cancelada'::"text"]));



CREATE INDEX "citas_start_resultado_idx" ON "public"."citas" USING "btree" ("start_at", "resultado") WHERE ("resultado" IS NOT NULL);



CREATE INDEX "clientes_distribuidor_idx" ON "public"."clientes" USING "btree" ("distribuidor_id");



CREATE INDEX "clientes_estado_operativo_idx" ON "public"."clientes" USING "btree" ("estado_operativo");



CREATE INDEX "clientes_fecha_nacimiento_idx" ON "public"."clientes" USING "btree" ("fecha_nacimiento");



CREATE UNIQUE INDEX "clientes_hycite_id_uidx" ON "public"."clientes" USING "btree" ("hycite_id") WHERE ("hycite_id" IS NOT NULL);



CREATE INDEX "clientes_persona_id_idx" ON "public"."clientes" USING "btree" ("persona_id") WHERE ("persona_id" IS NOT NULL);



CREATE INDEX "clientes_telegram_chat_id_idx" ON "public"."clientes" USING "btree" ("telegram_chat_id") WHERE ("telegram_chat_id" IS NOT NULL);



CREATE INDEX "clientes_vendedor_idx" ON "public"."clientes" USING "btree" ("vendedor_id");



CREATE INDEX "clientes_whatsapp_campaign_eligible_idx" ON "public"."clientes" USING "btree" ("whatsapp_opt_in", "whatsapp_no_molestar", "whatsapp_ultimo_envio_at") WHERE ("telefono" IS NOT NULL);



CREATE INDEX "cob_cv_balance_adjustments_case_fecha_idx" ON "public"."cob_cv_balance_adjustments" USING "btree" ("case_id", "fecha_ajuste" DESC);



CREATE INDEX "cob_cv_balance_adjustments_org_status_idx" ON "public"."cob_cv_balance_adjustments" USING "btree" ("org_id", "status");



CREATE INDEX "cob_cv_resumen_lines_resumen_idx" ON "public"."cob_cv_resumen_lines" USING "btree" ("resumen_id", "line_number");



CREATE INDEX "cob_cv_resumenes_case_status_idx" ON "public"."cob_cv_resumenes" USING "btree" ("case_id", "status", "created_at" DESC);



CREATE INDEX "cob_cv_resumenes_org_periodo_idx" ON "public"."cob_cv_resumenes" USING "btree" ("org_id", "periodo_fin" DESC, "created_at" DESC);



CREATE INDEX "cob_document_generation_run_items_run_idx" ON "public"."cob_document_generation_run_items" USING "btree" ("run_id", "created_at");



CREATE INDEX "cob_document_generation_runs_job_date_idx" ON "public"."cob_document_generation_runs" USING "btree" ("job_name", "run_date" DESC, "created_at" DESC);



CREATE INDEX "cob_financial_ledger_account_date_idx" ON "public"."cob_financial_ledger" USING "btree" ("revolving_account_id", "effective_date", "created_at");



CREATE UNIQUE INDEX "cob_financial_ledger_accrual_uidx" ON "public"."cob_financial_ledger" USING "btree" ("revolving_account_id", "accrual_from", "accrual_to") WHERE ("entry_type" = 'finance_charge_accrual'::"text");



CREATE INDEX "cob_financial_ledger_case_date_idx" ON "public"."cob_financial_ledger" USING "btree" ("org_id", "case_id", "effective_date" DESC);



CREATE INDEX "cob_financial_ledger_org_type_date_idx" ON "public"."cob_financial_ledger" USING "btree" ("org_id", "entry_type", "effective_date" DESC);



CREATE INDEX "cob_financial_ledger_pago_id_idx" ON "public"."cob_financial_ledger" USING "btree" ("pago_id") WHERE ("pago_id" IS NOT NULL);



CREATE INDEX "cob_financial_ledger_plan_id_idx" ON "public"."cob_financial_ledger" USING "btree" ("plan_id") WHERE ("plan_id" IS NOT NULL);



CREATE UNIQUE INDEX "cob_financial_ledger_reversal_uidx" ON "public"."cob_financial_ledger" USING "btree" ("reverses_ledger_id") WHERE ("entry_type" = 'reversal'::"text");



CREATE INDEX "cob_gestiones_case_id_idx" ON "public"."cob_gestiones" USING "btree" ("case_id");



CREATE INDEX "cob_gestiones_cliente_id_idx" ON "public"."cob_gestiones" USING "btree" ("cliente_id");



CREATE INDEX "cob_gestiones_created_at_idx" ON "public"."cob_gestiones" USING "btree" ("created_at");



CREATE INDEX "cob_gestiones_org_case_created_at_idx" ON "public"."cob_gestiones" USING "btree" ("org_id", "case_id", "created_at" DESC) WHERE ("case_id" IS NOT NULL);



CREATE INDEX "cob_gestiones_org_id_idx" ON "public"."cob_gestiones" USING "btree" ("org_id");



CREATE INDEX "cob_gestiones_ptp_id_idx" ON "public"."cob_gestiones" USING "btree" ("ptp_id") WHERE ("ptp_id" IS NOT NULL);



CREATE INDEX "cob_pagos_case_id_idx" ON "public"."cob_pagos" USING "btree" ("cargo_vuelta_case_id") WHERE ("cargo_vuelta_case_id" IS NOT NULL);



CREATE INDEX "cob_pagos_cliente_id_idx" ON "public"."cob_pagos" USING "btree" ("cliente_id");



CREATE INDEX "cob_pagos_cv_case_fecha_balance_idx" ON "public"."cob_pagos" USING "btree" ("cargo_vuelta_case_id", "fecha_pago" DESC) WHERE ("cargo_vuelta_case_id" IS NOT NULL);



CREATE INDEX "cob_pagos_fecha_pago_idx" ON "public"."cob_pagos" USING "btree" ("org_id", "fecha_pago" DESC);



CREATE INDEX "cob_pagos_org_id_idx" ON "public"."cob_pagos" USING "btree" ("org_id");



CREATE INDEX "cob_pagos_ptp_id_idx" ON "public"."cob_pagos" USING "btree" ("ptp_id") WHERE ("ptp_id" IS NOT NULL);



CREATE INDEX "cob_plan_cuotas_org_estado_idx" ON "public"."cob_plan_cuotas" USING "btree" ("org_id", "estado", "fecha_vencimiento");



CREATE INDEX "cob_plan_cuotas_pago_id_idx" ON "public"."cob_plan_cuotas" USING "btree" ("pago_id") WHERE ("pago_id" IS NOT NULL);



CREATE INDEX "cob_plan_cuotas_pendientes_vencimiento_idx" ON "public"."cob_plan_cuotas" USING "btree" ("org_id", "fecha_vencimiento") WHERE ("estado" = 'pendiente'::"text");



CREATE INDEX "cob_plan_cuotas_plan_id_idx" ON "public"."cob_plan_cuotas" USING "btree" ("plan_id");



CREATE INDEX "cob_plan_pagos_case_id_idx" ON "public"."cob_plan_pagos" USING "btree" ("case_id") WHERE ("case_id" IS NOT NULL);



CREATE INDEX "cob_plan_pagos_cliente_id_idx" ON "public"."cob_plan_pagos" USING "btree" ("cliente_id");



CREATE INDEX "cob_plan_pagos_org_estado_idx" ON "public"."cob_plan_pagos" USING "btree" ("org_id", "estado");



CREATE INDEX "cob_plan_pagos_org_id_idx" ON "public"."cob_plan_pagos" USING "btree" ("org_id");



CREATE INDEX "cob_ptps_case_id_idx" ON "public"."cob_ptps" USING "btree" ("case_id") WHERE ("case_id" IS NOT NULL);



CREATE INDEX "cob_ptps_cliente_id_idx" ON "public"."cob_ptps" USING "btree" ("cliente_id");



CREATE INDEX "cob_ptps_creado_por_pendientes_idx" ON "public"."cob_ptps" USING "btree" ("creado_por", "fecha_compromiso") WHERE ("estado" = 'pendiente'::"text");



CREATE INDEX "cob_ptps_gestion_id_idx" ON "public"."cob_ptps" USING "btree" ("gestion_id") WHERE ("gestion_id" IS NOT NULL);



CREATE INDEX "cob_ptps_org_estado_idx" ON "public"."cob_ptps" USING "btree" ("org_id", "estado");



CREATE INDEX "cob_ptps_org_id_idx" ON "public"."cob_ptps" USING "btree" ("org_id");



CREATE INDEX "cob_ptps_pendientes_vencimiento_idx" ON "public"."cob_ptps" USING "btree" ("org_id", "fecha_compromiso") WHERE ("estado" = 'pendiente'::"text");



CREATE UNIQUE INDEX "cob_revolving_accounts_case_activa_uidx" ON "public"."cob_revolving_accounts" USING "btree" ("case_id") WHERE ("estado" = ANY (ARRAY['activo'::"text", 'moroso'::"text", 'en_plan'::"text", 'reestructurado'::"text"]));



CREATE INDEX "cob_revolving_accounts_case_id_idx" ON "public"."cob_revolving_accounts" USING "btree" ("case_id");



CREATE INDEX "cob_revolving_accounts_cliente_id_idx" ON "public"."cob_revolving_accounts" USING "btree" ("cliente_id");



CREATE INDEX "cob_revolving_accounts_org_devengo_idx" ON "public"."cob_revolving_accounts" USING "btree" ("org_id", "fecha_ultimo_devengo") WHERE ("estado" = ANY (ARRAY['activo'::"text", 'moroso'::"text", 'en_plan'::"text"]));



CREATE INDEX "cob_revolving_accounts_org_estado_idx" ON "public"."cob_revolving_accounts" USING "btree" ("org_id", "estado");



CREATE INDEX "cob_revolving_accounts_org_id_idx" ON "public"."cob_revolving_accounts" USING "btree" ("org_id");



CREATE INDEX "cob_statement_lines_ledger_entry_idx" ON "public"."cob_statement_lines" USING "btree" ("ledger_entry_id") WHERE ("ledger_entry_id" IS NOT NULL);



CREATE INDEX "cob_statement_lines_org_date_idx" ON "public"."cob_statement_lines" USING "btree" ("org_id", "transaction_date" DESC);



CREATE INDEX "cob_statement_lines_statement_order_idx" ON "public"."cob_statement_lines" USING "btree" ("statement_id", "line_order");



CREATE INDEX "cob_statements_case_id_idx" ON "public"."cob_statements" USING "btree" ("case_id");



CREATE INDEX "cob_statements_due_date_idx" ON "public"."cob_statements" USING "btree" ("org_id", "fecha_vencimiento") WHERE ("fecha_vencimiento" IS NOT NULL);



CREATE UNIQUE INDEX "cob_statements_id_org_uidx" ON "public"."cob_statements" USING "btree" ("id", "org_id");



CREATE INDEX "cob_statements_org_id_idx" ON "public"."cob_statements" USING "btree" ("org_id");



CREATE INDEX "cob_statements_revolving_period_idx" ON "public"."cob_statements" USING "btree" ("revolving_account_id", "periodo_inicio" DESC, "periodo_fin" DESC);



CREATE INDEX "cob_statements_status_idx" ON "public"."cob_statements" USING "btree" ("org_id", "status");



CREATE INDEX "componentes_equipo_activo_idx" ON "public"."componentes_equipo" USING "btree" ("activo");



CREATE INDEX "componentes_equipo_proximo_idx" ON "public"."componentes_equipo" USING "btree" ("fecha_proximo_cambio");



CREATE INDEX "contacto_actividades_autor_id_idx" ON "public"."contacto_actividades" USING "btree" ("autor_id");



CREATE INDEX "contacto_actividades_autor_id_idx1" ON "public"."contacto_actividades" USING "btree" ("autor_id");



CREATE INDEX "contacto_actividades_cita_id_idx" ON "public"."contacto_actividades" USING "btree" ("cita_id") WHERE ("cita_id" IS NOT NULL);



CREATE UNIQUE INDEX "contacto_actividades_cita_id_idx1" ON "public"."contacto_actividades" USING "btree" ("cita_id") WHERE (("cita_id" IS NOT NULL) AND ("tipo" = 'cita_completada'::"text"));



CREATE INDEX "contacto_actividades_cita_id_idx2" ON "public"."contacto_actividades" USING "btree" ("cita_id") WHERE ("cita_id" IS NOT NULL);



CREATE UNIQUE INDEX "contacto_actividades_cita_id_idx3" ON "public"."contacto_actividades" USING "btree" ("cita_id") WHERE (("cita_id" IS NOT NULL) AND ("tipo" = 'cita_completada'::"text"));



CREATE INDEX "contacto_actividades_contacto_tipo_contacto_id_fecha_activ_idx1" ON "public"."contacto_actividades" USING "btree" ("contacto_tipo", "contacto_id", "fecha_actividad" DESC);



CREATE INDEX "contacto_actividades_contacto_tipo_contacto_id_fecha_activi_idx" ON "public"."contacto_actividades" USING "btree" ("contacto_tipo", "contacto_id", "fecha_actividad" DESC);



CREATE INDEX "contacto_actividades_tipo_idx" ON "public"."contacto_actividades" USING "btree" ("tipo");



CREATE INDEX "contacto_actividades_tipo_idx1" ON "public"."contacto_actividades" USING "btree" ("tipo");



CREATE INDEX "conversations_last_message_at_idx" ON "public"."conversations" USING "btree" ("last_message_at" DESC);



CREATE INDEX "conversations_org_id_idx" ON "public"."conversations" USING "btree" ("org_id");



CREATE INDEX "conversations_phone_e164_idx" ON "public"."conversations" USING "btree" ("phone_e164") WHERE ("phone_e164" IS NOT NULL);



CREATE INDEX "conversations_wa_id_idx" ON "public"."conversations" USING "btree" ("wa_id") WHERE ("wa_id" IS NOT NULL);



CREATE INDEX "crm_tareas_asignado_a_fecha_vencimiento_estado_idx" ON "public"."crm_tareas" USING "btree" ("asignado_a", "fecha_vencimiento", "estado");



CREATE INDEX "crm_tareas_asignado_a_fecha_vencimiento_estado_idx1" ON "public"."crm_tareas" USING "btree" ("asignado_a", "fecha_vencimiento", "estado");



CREATE INDEX "crm_tareas_asignado_a_idx" ON "public"."crm_tareas" USING "btree" ("asignado_a") WHERE ("estado" = 'pendiente'::"text");



CREATE INDEX "crm_tareas_cita_origen_id_idx" ON "public"."crm_tareas" USING "btree" ("cita_origen_id") WHERE ("cita_origen_id" IS NOT NULL);



CREATE INDEX "crm_tareas_cita_origen_id_idx1" ON "public"."crm_tareas" USING "btree" ("cita_origen_id") WHERE ("cita_origen_id" IS NOT NULL);



CREATE INDEX "crm_tareas_cita_origen_idx" ON "public"."crm_tareas" USING "btree" ("cita_origen_id") WHERE ("cita_origen_id" IS NOT NULL);



CREATE INDEX "crm_tareas_contacto_idx" ON "public"."crm_tareas" USING "btree" ("contacto_tipo", "contacto_id");



CREATE INDEX "crm_tareas_contacto_tipo_contacto_id_estado_idx" ON "public"."crm_tareas" USING "btree" ("contacto_tipo", "contacto_id", "estado");



CREATE INDEX "crm_tareas_contacto_tipo_contacto_id_estado_idx1" ON "public"."crm_tareas" USING "btree" ("contacto_tipo", "contacto_id", "estado");



CREATE INDEX "crm_tareas_created_by_idx" ON "public"."crm_tareas" USING "btree" ("created_by");



CREATE INDEX "crm_tareas_created_by_idx1" ON "public"."crm_tareas" USING "btree" ("created_by");



CREATE INDEX "crm_tareas_fecha_vencimiento_estado_idx" ON "public"."crm_tareas" USING "btree" ("fecha_vencimiento", "estado");



CREATE INDEX "crm_tareas_fecha_vencimiento_estado_idx1" ON "public"."crm_tareas" USING "btree" ("fecha_vencimiento", "estado");



CREATE INDEX "embajador_programas_org_id_idx" ON "public"."embajador_programas" USING "btree" ("org_id");



CREATE INDEX "embajador_programas_periodo_idx" ON "public"."embajador_programas" USING "btree" ("periodo_id");



CREATE INDEX "embajador_programas_periodo_nivel_idx" ON "public"."embajador_programas" USING "btree" ("periodo_id", "nivel");



CREATE INDEX "embajadores_cliente_id_idx" ON "public"."embajadores" USING "btree" ("cliente_id") WHERE ("cliente_id" IS NOT NULL);



CREATE INDEX "embajadores_estado_idx" ON "public"."embajadores" USING "btree" ("estado");



CREATE INDEX "embajadores_fecha_nacimiento_idx" ON "public"."embajadores" USING "btree" ("fecha_nacimiento");



CREATE INDEX "embajadores_lead_id_idx" ON "public"."embajadores" USING "btree" ("lead_id") WHERE ("lead_id" IS NOT NULL);



CREATE INDEX "embajadores_org_id_idx" ON "public"."embajadores" USING "btree" ("org_id");



CREATE INDEX "embajadores_owner_idx" ON "public"."embajadores" USING "btree" ("owner_id");



CREATE INDEX "embajadores_persona_id_idx" ON "public"."embajadores" USING "btree" ("persona_id") WHERE ("persona_id" IS NOT NULL);



CREATE INDEX "equipos_instalados_cliente_idx" ON "public"."equipos_instalados" USING "btree" ("cliente_id");



CREATE INDEX "idx_ci_activaciones_owner_created" ON "public"."ci_activaciones" USING "btree" ("owner_id", "created_at");



CREATE INDEX "idx_ci_activaciones_representante_estado_created" ON "public"."ci_activaciones" USING "btree" ("representante_id", "estado", "created_at");



CREATE INDEX "idx_ci_referidos_activacion_estado_created" ON "public"."ci_referidos" USING "btree" ("activacion_id", "estado", "created_at");



CREATE INDEX "idx_clientes_dias_atraso" ON "public"."clientes" USING "btree" ("dias_atraso");



CREATE INDEX "idx_clientes_distribuidor_id" ON "public"."clientes" USING "btree" ("distribuidor_id");



CREATE INDEX "idx_clientes_estado_cuenta" ON "public"."clientes" USING "btree" ("estado_cuenta");



CREATE INDEX "idx_clientes_fecha_ultimo_pedido" ON "public"."clientes" USING "btree" ("fecha_ultimo_pedido");



CREATE INDEX "idx_clientes_hycite_id" ON "public"."clientes" USING "btree" ("hycite_id");



CREATE INDEX "idx_clientes_rp_email" ON "public"."clientes_rp" USING "btree" ("email") WHERE (("email" IS NOT NULL) AND ("email" <> ''::"text"));



CREATE INDEX "idx_clientes_rp_emprendedor" ON "public"."clientes_rp" USING "btree" ("emprendedor_codigo");



CREATE INDEX "idx_clientes_rp_estado_cuenta" ON "public"."clientes_rp" USING "btree" ("estado_cuenta");



CREATE INDEX "idx_clientes_rp_merge_status" ON "public"."clientes_rp" USING "btree" ("merge_status");



CREATE INDEX "idx_clientes_rp_source_file" ON "public"."clientes_rp" USING "btree" ("_source_file");



CREATE INDEX "idx_clientes_rp_telefono_movil" ON "public"."clientes_rp" USING "btree" ("telefono_movil") WHERE (("telefono_movil" IS NOT NULL) AND ("telefono_movil" <> ''::"text"));



CREATE INDEX "idx_clientes_vendedor_id" ON "public"."clientes" USING "btree" ("vendedor_id");



CREATE INDEX "idx_cob_acuerdo_eventos_acuerdo" ON "public"."cob_acuerdo_eventos" USING "btree" ("acuerdo_id", "created_at" DESC);



CREATE INDEX "idx_cob_acuerdo_eventos_cobro" ON "public"."cob_acuerdo_eventos" USING "btree" ("cobro_programado_id") WHERE ("cobro_programado_id" IS NOT NULL);



CREATE INDEX "idx_cob_acuerdo_eventos_org" ON "public"."cob_acuerdo_eventos" USING "btree" ("org_id");



CREATE INDEX "idx_cob_acuerdo_eventos_tipo" ON "public"."cob_acuerdo_eventos" USING "btree" ("org_id", "tipo_evento", "created_at" DESC);



CREATE INDEX "idx_cob_acuerdos_case" ON "public"."cob_acuerdos_pago_automatico" USING "btree" ("org_id", "cargo_vuelta_case_id");



CREATE INDEX "idx_cob_acuerdos_cliente" ON "public"."cob_acuerdos_pago_automatico" USING "btree" ("org_id", "cliente_id");



CREATE INDEX "idx_cob_acuerdos_estado" ON "public"."cob_acuerdos_pago_automatico" USING "btree" ("org_id", "estado");



CREATE INDEX "idx_cob_acuerdos_org" ON "public"."cob_acuerdos_pago_automatico" USING "btree" ("org_id");



CREATE INDEX "idx_cob_acuerdos_proximo_cobro" ON "public"."cob_acuerdos_pago_automatico" USING "btree" ("org_id", "fecha_proximo_cobro") WHERE ("fecha_proximo_cobro" IS NOT NULL);



CREATE INDEX "idx_cob_cobros_prog_acuerdo" ON "public"."cob_cobros_programados" USING "btree" ("acuerdo_id");



CREATE INDEX "idx_cob_cobros_prog_case" ON "public"."cob_cobros_programados" USING "btree" ("org_id", "cargo_vuelta_case_id");



CREATE INDEX "idx_cob_cobros_prog_estado_fecha" ON "public"."cob_cobros_programados" USING "btree" ("org_id", "estado", "fecha_programada");



CREATE INDEX "idx_cob_cobros_prog_org" ON "public"."cob_cobros_programados" USING "btree" ("org_id");



CREATE INDEX "idx_cob_metodos_pago_case_id" ON "public"."cob_metodos_pago" USING "btree" ("cargo_vuelta_case_id") WHERE ("cargo_vuelta_case_id" IS NOT NULL);



CREATE INDEX "idx_cob_metodos_pago_cliente_id" ON "public"."cob_metodos_pago" USING "btree" ("org_id", "cliente_id");



CREATE INDEX "idx_cob_metodos_pago_estado" ON "public"."cob_metodos_pago" USING "btree" ("org_id", "estado");



CREATE INDEX "idx_cob_metodos_pago_org_id" ON "public"."cob_metodos_pago" USING "btree" ("org_id");



CREATE INDEX "idx_cob_pagos_case_fecha" ON "public"."cob_pagos" USING "btree" ("cargo_vuelta_case_id", "fecha_pago" DESC);



CREATE INDEX "idx_cob_pagos_estado" ON "public"."cob_pagos" USING "btree" ("org_id", "estado");



CREATE INDEX "idx_cob_pagos_org_cliente_fecha" ON "public"."cob_pagos" USING "btree" ("org_id", "cliente_id", "fecha_pago" DESC);



CREATE INDEX "idx_cob_pagos_ptp_id" ON "public"."cob_pagos" USING "btree" ("ptp_id");



CREATE INDEX "idx_cob_plan_cuotas_case_id" ON "public"."cob_plan_cuotas" USING "btree" ("cargo_vuelta_case_id");



CREATE INDEX "idx_cob_plan_cuotas_cliente_id" ON "public"."cob_plan_cuotas" USING "btree" ("cliente_id");



CREATE INDEX "idx_cob_plan_cuotas_estado" ON "public"."cob_plan_cuotas" USING "btree" ("org_id", "estado");



CREATE INDEX "idx_cob_plan_cuotas_fecha_vencimiento" ON "public"."cob_plan_cuotas" USING "btree" ("org_id", "fecha_vencimiento");



CREATE INDEX "idx_cob_plan_cuotas_org_id" ON "public"."cob_plan_cuotas" USING "btree" ("org_id");



CREATE INDEX "idx_cob_plan_cuotas_plan_pago_id" ON "public"."cob_plan_cuotas" USING "btree" ("plan_pago_id");



CREATE INDEX "idx_cob_plan_pagos_case_id" ON "public"."cob_plan_pagos" USING "btree" ("cargo_vuelta_case_id");



CREATE INDEX "idx_cob_plan_pagos_cliente_id" ON "public"."cob_plan_pagos" USING "btree" ("cliente_id");



CREATE INDEX "idx_cob_plan_pagos_estado" ON "public"."cob_plan_pagos" USING "btree" ("org_id", "estado");



CREATE INDEX "idx_cob_plan_pagos_metodo_pago_id" ON "public"."cob_plan_pagos" USING "btree" ("metodo_pago_id");



CREATE INDEX "idx_cob_plan_pagos_org_id" ON "public"."cob_plan_pagos" USING "btree" ("org_id");



CREATE INDEX "idx_cob_revolving_accounts_closing_day" ON "public"."cob_revolving_accounts" USING "btree" ("statement_closing_day", "estado") WHERE (("statement_closing_day" IS NOT NULL) AND ("estado" = ANY (ARRAY['activo'::"text", 'moroso'::"text", 'en_plan'::"text"])));



CREATE INDEX "idx_cob_revolving_accounts_preferred_day" ON "public"."cob_revolving_accounts" USING "btree" ("customer_preferred_payment_day") WHERE ("customer_preferred_payment_day" IS NOT NULL);



CREATE INDEX "idx_dfp_notification_events_cuota" ON "public"."dfp_notification_events" USING "btree" ("cuota_id") WHERE ("cuota_id" IS NOT NULL);



CREATE INDEX "idx_dfp_notification_events_date_channel" ON "public"."dfp_notification_events" USING "btree" ("notification_date", "channel", "scope");



CREATE INDEX "idx_lead_notas_lead_fecha" ON "public"."lead_notas" USING "btree" ("lead_id", "created_at" DESC);



CREATE INDEX "idx_lead_notas_usuario_fecha" ON "public"."lead_notas" USING "btree" ("usuario_id", "created_at" DESC);



CREATE INDEX "idx_leads_referidor" ON "public"."leads" USING "btree" ("referidor_tipo", "referidor_id") WHERE ("referidor_id" IS NOT NULL);



CREATE INDEX "idx_llamadas_cliente_id" ON "public"."llamadas_telemercadeo" USING "btree" ("cliente_id");



CREATE INDEX "idx_llamadas_fecha" ON "public"."llamadas_telemercadeo" USING "btree" ("fecha_llamada");



CREATE INDEX "idx_llamadas_telemercadista_id" ON "public"."llamadas_telemercadeo" USING "btree" ("telemercadista_id");



CREATE INDEX "idx_mk_messages_campaign_id" ON "public"."mk_messages" USING "btree" ("campaign_id");



CREATE INDEX "idx_mk_messages_cita_id" ON "public"."mk_messages" USING "btree" ("cita_id");



CREATE INDEX "idx_mk_messages_sent_at" ON "public"."mk_messages" USING "btree" ("sent_at");



CREATE INDEX "idx_mk_messages_status" ON "public"."mk_messages" USING "btree" ("status");



CREATE INDEX "idx_outbox_messages_dfp_notification_date" ON "public"."outbox_messages" USING "btree" ("dfp_notification_date") WHERE ("dfp_notification_date" IS NOT NULL);



CREATE INDEX "idx_personas_telefono_norm" ON "public"."personas" USING "btree" ("public"."normalizar_telefono"("telefono")) WHERE ("telefono" IS NOT NULL);



CREATE INDEX "idx_product_images_product_id" ON "public"."product_images" USING "btree" ("product_id");



CREATE INDEX "idx_productos_visible_catalogo" ON "public"."productos" USING "btree" ("id") WHERE ("visible_catalogo" = true);



CREATE INDEX "idx_prospectos_rp_email" ON "public"."prospectos_rp" USING "btree" ("email") WHERE (("email" IS NOT NULL) AND ("email" <> ''::"text"));



CREATE INDEX "idx_prospectos_rp_merge_status" ON "public"."prospectos_rp" USING "btree" ("merge_status");



CREATE INDEX "idx_prospectos_rp_source_file" ON "public"."prospectos_rp" USING "btree" ("_source_file");



CREATE INDEX "idx_prospectos_rp_telefono_movil" ON "public"."prospectos_rp" USING "btree" ("telefono_movil") WHERE (("telefono_movil" IS NOT NULL) AND ("telefono_movil" <> ''::"text"));



CREATE INDEX "idx_usuarios_distribuidor_padre" ON "public"."usuarios" USING "btree" ("distribuidor_padre_id");



CREATE INDEX "import_revisiones_created_idx" ON "public"."import_revisiones" USING "btree" ("created_at" DESC);



CREATE INDEX "import_revisiones_motivo_idx" ON "public"."import_revisiones" USING "btree" ("motivo");



CREATE INDEX "import_revisiones_revisado_idx" ON "public"."import_revisiones" USING "btree" ("revisado") WHERE ("revisado" = false);



CREATE INDEX "import_runs_org_created_idx" ON "public"."import_runs" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "import_runs_status_idx" ON "public"."import_runs" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['partial'::"text", 'error'::"text"]));



CREATE INDEX "inbox_tasks_assigned_due_idx" ON "public"."inbox_tasks" USING "btree" ("assigned_to", "due_at") WHERE ("status" = 'open'::"text");



CREATE INDEX "inbox_tasks_conversation_id_idx" ON "public"."inbox_tasks" USING "btree" ("conversation_id");



CREATE INDEX "inbox_tasks_org_status_idx" ON "public"."inbox_tasks" USING "btree" ("org_id", "status");



CREATE INDEX "izzy_compensation_plans_carrier_idx" ON "public"."izzy_compensation_plans" USING "btree" ("carrier_id", "active");



CREATE INDEX "izzy_compensation_promotions_active_idx" ON "public"."izzy_compensation_promotions" USING "btree" ("active", "start_date", "end_date");



CREATE UNIQUE INDEX "izzy_leads_telefono_digits_unique" ON "public"."izzy_leads" USING "btree" ("telefono_digits") WHERE (("telefono_digits" IS NOT NULL) AND ("length"("telefono_digits") >= 7));



CREATE INDEX "izzy_orders_actual_install_date_idx" ON "public"."izzy_orders" USING "btree" ("actual_install_date");



CREATE INDEX "izzy_orders_compensation_status_idx" ON "public"."izzy_orders" USING "btree" ("compensation_status");



CREATE INDEX "izzy_orders_portal_user_id_idx" ON "public"."izzy_orders" USING "btree" ("portal_user_id");



CREATE INDEX "izzy_password_reset_tokens_active_idx" ON "public"."izzy_password_reset_tokens" USING "btree" ("expires_at") WHERE ("used_at" IS NULL);



CREATE INDEX "izzy_password_reset_tokens_user_idx" ON "public"."izzy_password_reset_tokens" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "izzy_portal_users_comp_role_idx" ON "public"."izzy_portal_users" USING "btree" ("compensation_role");



CREATE UNIQUE INDEX "izzy_portal_users_email_idx" ON "public"."izzy_portal_users" USING "btree" ("lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "izzy_portal_users_manager_idx" ON "public"."izzy_portal_users" USING "btree" ("manager_user_id");



CREATE INDEX "lead_notas_lead_id_created_at_idx" ON "public"."lead_notas" USING "btree" ("lead_id", "created_at" DESC);



CREATE INDEX "leads_active_idx" ON "public"."leads" USING "btree" ("id", "updated_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "leads_created_at_idx" ON "public"."leads" USING "btree" ("created_at");



CREATE INDEX "leads_deleted_at_idx" ON "public"."leads" USING "btree" ("deleted_at");



CREATE INDEX "leads_estado_pipeline_idx" ON "public"."leads" USING "btree" ("estado_pipeline");



CREATE UNIQUE INDEX "leads_normalized_phone_org_idx" ON "public"."leads" USING "btree" ("org_id", "regexp_replace"("telefono", '\D'::"text", ''::"text", 'g'::"text")) WHERE (("org_id" IS NOT NULL) AND ("telefono" IS NOT NULL) AND ("length"("regexp_replace"("telefono", '\D'::"text", ''::"text", 'g'::"text")) >= 7));



COMMENT ON INDEX "public"."leads_normalized_phone_org_idx" IS 'Idempotencia OCR: un teléfono normalizado por organización, ignorando formato.';



CREATE INDEX "leads_org_id_idx" ON "public"."leads" USING "btree" ("org_id");



CREATE INDEX "leads_owner_idx" ON "public"."leads" USING "btree" ("owner_id");



CREATE INDEX "leads_persona_id_idx" ON "public"."leads" USING "btree" ("persona_id") WHERE ("persona_id" IS NOT NULL);



CREATE UNIQUE INDEX "leads_telefono_uidx" ON "public"."leads" USING "btree" ("telefono") WHERE (("telefono" IS NOT NULL) AND ("deleted_at" IS NULL));



COMMENT ON INDEX "public"."leads_telefono_uidx" IS 'Permite PostgREST upsert con resolution=merge-duplicates usando telefono como clave de deduplicación OCR.';



CREATE UNIQUE INDEX "leads_telefono_unique" ON "public"."leads" USING "btree" ("telefono") WHERE ("telefono" IS NOT NULL);



CREATE INDEX "leads_vendedor_active_idx" ON "public"."leads" USING "btree" ("vendedor_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "leads_vendedor_deleted_idx" ON "public"."leads" USING "btree" ("vendedor_id", "deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "leads_vendedor_idx" ON "public"."leads" USING "btree" ("vendedor_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "leads_whatsapp_campaign_eligible_idx" ON "public"."leads" USING "btree" ("whatsapp_opt_in", "whatsapp_no_molestar", "whatsapp_ultimo_envio_at") WHERE ("telefono" IS NOT NULL);



CREATE INDEX "llamadas_telemercadeo_org_cliente_idx" ON "public"."llamadas_telemercadeo" USING "btree" ("org_id", "cliente_id");



CREATE INDEX "llamadas_telemercadeo_org_followup_idx" ON "public"."llamadas_telemercadeo" USING "btree" ("org_id", "followup_at") WHERE ("followup_at" IS NOT NULL);



CREATE INDEX "llamadas_telemercadeo_org_id_idx" ON "public"."llamadas_telemercadeo" USING "btree" ("org_id");



CREATE INDEX "llamadas_telemercadeo_telemercadista_idx" ON "public"."llamadas_telemercadeo" USING "btree" ("telemercadista_id");



CREATE INDEX "message_templates_org_shared_idx" ON "public"."message_templates" USING "btree" ("org_id", "scope") WHERE ("scope" = 'shared'::"text");



CREATE INDEX "message_templates_owner_idx" ON "public"."message_templates" USING "btree" ("owner_id");



CREATE INDEX "messages_conversation_id_idx" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "messages_created_at_idx" ON "public"."messages" USING "btree" ("created_at" DESC);



CREATE INDEX "messages_direction_idx" ON "public"."messages" USING "btree" ("conversation_id", "direction");



CREATE INDEX "mk_campaigns_owner_estado_idx" ON "public"."mk_campaigns" USING "btree" ("owner_id", "estado");



CREATE INDEX "mk_campaigns_segmento_idx" ON "public"."mk_campaigns" USING "btree" ("segmento_key");



CREATE INDEX "mk_messages_campaign_abierto_idx" ON "public"."mk_messages" USING "btree" ("campaign_id", "abierto_at");



CREATE INDEX "mk_messages_campaign_orden_idx" ON "public"."mk_messages" USING "btree" ("campaign_id", "orden");



CREATE UNIQUE INDEX "mk_messages_campaign_phone_unique" ON "public"."mk_messages" USING "btree" ("campaign_id", "telefono");



CREATE INDEX "mk_messages_cita_id_idx" ON "public"."mk_messages" USING "btree" ("cita_id") WHERE ("cita_id" IS NOT NULL);



CREATE UNIQUE INDEX "mk_messages_cita_telefono_ventana_unique" ON "public"."mk_messages" USING "btree" ("cita_id", "telefono") WHERE ("cita_id" IS NOT NULL);



CREATE INDEX "mk_messages_contacto_idx" ON "public"."mk_messages" USING "btree" ("contacto_tipo", "contacto_id");



CREATE INDEX "mk_messages_outbox_message_id_idx" ON "public"."mk_messages" USING "btree" ("outbox_message_id") WHERE ("outbox_message_id" IS NOT NULL);



CREATE INDEX "mk_messages_owner_idx" ON "public"."mk_messages" USING "btree" ("owner_id");



CREATE INDEX "mk_messages_scheduled_pending_idx" ON "public"."mk_messages" USING "btree" ("scheduled_at") WHERE ("status" = 'pendiente'::"text");



CREATE INDEX "mk_messages_status_idx" ON "public"."mk_messages" USING "btree" ("campaign_id", "status");



CREATE INDEX "mk_responses_followup_idx" ON "public"."mk_responses" USING "btree" ("followup_at") WHERE ("followup_at" IS NOT NULL);



CREATE INDEX "mk_responses_resultado_idx" ON "public"."mk_responses" USING "btree" ("resultado");



CREATE INDEX "notasrp_cliente_id_enviado_en_idx" ON "public"."notasrp" USING "btree" ("cliente_id", "enviado_en" DESC NULLS LAST);



CREATE INDEX "notasrp_org_id_idx" ON "public"."notasrp" USING "btree" ("org_id");



CREATE INDEX "oportunidades_etapa_idx" ON "public"."oportunidades" USING "btree" ("etapa");



CREATE INDEX "oportunidades_owner_idx" ON "public"."oportunidades" USING "btree" ("owner_id");



CREATE INDEX "outbox_delivery_attempts_message_idx" ON "public"."outbox_delivery_attempts" USING "btree" ("outbox_message_id", "attempt_number" DESC);



CREATE INDEX "outbox_delivery_attempts_org_created_idx" ON "public"."outbox_delivery_attempts" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "outbox_messages_contact_idx" ON "public"."outbox_messages" USING "btree" ("contact_tipo", "contact_id");



CREATE INDEX "outbox_messages_n8n_dispatch_idx" ON "public"."outbox_messages" USING "btree" ("scheduled_for") WHERE (("status" = ANY (ARRAY['programado'::"text", 'retry_pending'::"text"])) AND ("dispatch_provider" = 'n8n'::"text"));



CREATE INDEX "outbox_messages_orphan_idx" ON "public"."outbox_messages" USING "btree" ("locked_at") WHERE ("status" = 'en_proceso'::"text");



CREATE INDEX "outbox_messages_owner_idx" ON "public"."outbox_messages" USING "btree" ("owner_id");



CREATE INDEX "outbox_messages_retry_idx" ON "public"."outbox_messages" USING "btree" ("retry_after") WHERE ("status" = 'retry_pending'::"text");



CREATE INDEX "outbox_messages_scheduled_pending_v2" ON "public"."outbox_messages" USING "btree" ("scheduled_for") WHERE ("status" = ANY (ARRAY['programado'::"text", 'retry_pending'::"text"]));



CREATE UNIQUE INDEX "periodos_programa_one_active_idx" ON "public"."periodos_programa" USING "btree" ("activo") WHERE "activo";



CREATE INDEX "personas_email_idx" ON "public"."personas" USING "btree" ("email") WHERE ("email" IS NOT NULL);



CREATE INDEX "personas_org_id_idx" ON "public"."personas" USING "btree" ("org_id");



CREATE INDEX "personas_telefono_idx" ON "public"."personas" USING "btree" ("telefono") WHERE ("telefono" IS NOT NULL);



CREATE INDEX "product_images_product_orden_idx" ON "public"."product_images" USING "btree" ("product_id", "orden");



CREATE INDEX "product_payment_plans_lookup_idx" ON "public"."product_payment_plans" USING "btree" ("product_id", "activo", "plazo_meses");



CREATE INDEX "productos_codigo_trgm_idx" ON "public"."productos" USING "gin" ("lower"("codigo") "public"."gin_trgm_ops");



CREATE INDEX "productos_legacy_code_trgm_idx" ON "public"."productos" USING "gin" ("lower"("legacy_code") "public"."gin_trgm_ops");



CREATE INDEX "productos_nombre_trgm_idx" ON "public"."productos" USING "gin" ("lower"("nombre") "public"."gin_trgm_ops");



CREATE INDEX "productos_search_vector_idx" ON "public"."productos" USING "gin" ("search_vector");



CREATE INDEX "programa_4en14_estado_idx" ON "public"."programa_4en14" USING "btree" ("estado");



CREATE INDEX "programa_4en14_referidos_estado_idx" ON "public"."programa_4en14_referidos" USING "btree" ("estado_presentacion");



CREATE INDEX "programa_4en14_vendedor_idx" ON "public"."programa_4en14" USING "btree" ("vendedor_id");



CREATE INDEX "servicios_cliente_idx" ON "public"."servicios" USING "btree" ("cliente_id");



CREATE INDEX "servicios_vendedor_idx" ON "public"."servicios" USING "btree" ("vendedor_id");



CREATE UNIQUE INDEX "uq_cob_acuerdo_activo_pausado_por_caso" ON "public"."cob_acuerdos_pago_automatico" USING "btree" ("org_id", "cargo_vuelta_case_id") WHERE ("estado" = ANY (ARRAY['activo'::"text", 'pausado'::"text"]));



CREATE UNIQUE INDEX "uq_cob_cobro_prog_acuerdo_fecha" ON "public"."cob_cobros_programados" USING "btree" ("acuerdo_id", "fecha_programada");



CREATE UNIQUE INDEX "uq_cob_metodos_pago_default_activo" ON "public"."cob_metodos_pago" USING "btree" ("org_id", "cliente_id") WHERE (("is_default" = true) AND ("estado" = 'activo'::"text"));



CREATE UNIQUE INDEX "uq_cob_pagos_source_external_id" ON "public"."cob_pagos" USING "btree" ("org_id", "source", "external_id") WHERE ("external_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_cob_plan_cuotas_plan_numero" ON "public"."cob_plan_cuotas" USING "btree" ("plan_pago_id", "numero_cuota");



CREATE UNIQUE INDEX "uq_outbox_messages_dfp_notification_key" ON "public"."outbox_messages" USING "btree" ("dfp_notification_key") WHERE ("dfp_notification_key" IS NOT NULL);



CREATE INDEX "usuarios_distribuidor_padre_idx" ON "public"."usuarios" USING "btree" ("distribuidor_padre_id");



CREATE UNIQUE INDEX "usuarios_email_unique" ON "public"."usuarios" USING "btree" ("email");



CREATE INDEX "usuarios_org_id_idx" ON "public"."usuarios" USING "btree" ("org_id");



CREATE INDEX "usuarios_rol_idx" ON "public"."usuarios" USING "btree" ("rol");



CREATE INDEX "venta_items_org_id_idx" ON "public"."venta_items" USING "btree" ("org_id");



CREATE INDEX "venta_items_org_id_venta_id_idx" ON "public"."venta_items" USING "btree" ("org_id", "venta_id");



CREATE INDEX "venta_items_venta_id_idx" ON "public"."venta_items" USING "btree" ("venta_id");



CREATE INDEX "venta_transacciones_org_id_idx" ON "public"."venta_transacciones" USING "btree" ("org_id");



CREATE INDEX "venta_transacciones_org_id_venta_id_idx" ON "public"."venta_transacciones" USING "btree" ("org_id", "venta_id");



CREATE INDEX "venta_transacciones_venta_id_idx" ON "public"."venta_transacciones" USING "btree" ("venta_id", "fecha");



CREATE INDEX "ventas_cliente_fecha_idx" ON "public"."ventas" USING "btree" ("cliente_id", "fecha_venta");



CREATE INDEX "ventas_estado_fecha_idx" ON "public"."ventas" USING "btree" ("estado", "fecha_venta");



CREATE INDEX "ventas_fecha_venta_idx" ON "public"."ventas" USING "btree" ("fecha_venta");



CREATE INDEX "ventas_org_id_idx" ON "public"."ventas" USING "btree" ("org_id");



CREATE INDEX "ventas_org_id_vendedor_id_idx" ON "public"."ventas" USING "btree" ("org_id", "vendedor_id");



CREATE INDEX "ventas_vendedor_fecha_idx" ON "public"."ventas" USING "btree" ("vendedor_id", "fecha_venta");



CREATE INDEX "ventas_vendedor_idx" ON "public"."ventas" USING "btree" ("vendedor_id");



CREATE OR REPLACE VIEW "public"."v_mk_campaign_stats" WITH ("security_invoker"='true') AS
 SELECT "c"."id" AS "campaign_id",
    "c"."nombre",
    "c"."segmento_key",
    "c"."canal",
    "c"."estado",
    "c"."total_contactos",
    "c"."owner_id",
    "count"("m"."id") AS "total_mensajes",
    "count"("m"."id") FILTER (WHERE ("m"."abierto_at" IS NOT NULL)) AS "total_abiertos",
    "count"("r"."id") AS "total_respondidos",
    "count"("m"."id") FILTER (WHERE ("r"."id" IS NULL)) AS "total_pendientes",
    "count"("r"."id") FILTER (WHERE ("r"."resultado" = 'cita_agendada'::"text")) AS "citas",
    "count"("r"."id") FILTER (WHERE ("r"."resultado" = 'pago_prometido'::"text")) AS "pagos_prometidos",
    "count"("r"."id") FILTER (WHERE ("r"."resultado" = 'no_interesado'::"text")) AS "no_interesados",
    "count"("r"."id") FILTER (WHERE ("r"."resultado" = 'sin_respuesta'::"text")) AS "sin_respuesta",
    COALESCE("sum"("r"."monto_prometido"), (0)::numeric) AS "monto_comprometido",
        CASE
            WHEN ("count"("m"."id") > 0) THEN "round"(((("count"("r"."id"))::numeric / ("count"("m"."id"))::numeric) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS "tasa_respuesta_pct",
        CASE
            WHEN ("count"("m"."id") > 0) THEN "round"(((("count"("r"."id") FILTER (WHERE ("r"."resultado" = 'cita_agendada'::"text")))::numeric / ("count"("m"."id"))::numeric) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS "tasa_citas_pct"
   FROM (("public"."mk_campaigns" "c"
     LEFT JOIN "public"."mk_messages" "m" ON (("m"."campaign_id" = "c"."id")))
     LEFT JOIN "public"."mk_responses" "r" ON (("r"."message_id" = "m"."id")))
  GROUP BY "c"."id";



CREATE OR REPLACE TRIGGER "bot_sessions_set_updated_at" BEFORE UPDATE ON "public"."bot_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "ci_activaciones_audit_reassign" BEFORE UPDATE ON "public"."ci_activaciones" FOR EACH ROW EXECUTE FUNCTION "security"."enforce_ci_activaciones_audit_and_reassign"();



CREATE OR REPLACE TRIGGER "ci_activaciones_create_leads" AFTER INSERT OR UPDATE OF "whatsapp_mensaje_enviado_at" ON "public"."ci_activaciones" FOR EACH ROW EXECUTE FUNCTION "public"."ci_create_leads_for_activation"();



CREATE OR REPLACE TRIGGER "ci_referidos_audit_reassign" BEFORE UPDATE ON "public"."ci_referidos" FOR EACH ROW EXECUTE FUNCTION "security"."enforce_ci_referidos_audit_and_reassign"();



CREATE OR REPLACE TRIGGER "ci_referidos_modo_gestion" BEFORE UPDATE ON "public"."ci_referidos" FOR EACH ROW EXECUTE FUNCTION "security"."enforce_ci_referidos_modo_gestion"();



CREATE OR REPLACE TRIGGER "citas_set_updated_at" BEFORE UPDATE ON "public"."citas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "crm_tareas_updated_at" BEFORE UPDATE ON "public"."crm_tareas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "leads_audit_reassign" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "security"."enforce_leads_audit_and_reassign"();



CREATE OR REPLACE TRIGGER "mk_campaigns_updated_at" BEFORE UPDATE ON "public"."mk_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "mk_responses_updated_at" BEFORE UPDATE ON "public"."mk_responses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "product_images_sync_producto_foto_principal_tg" AFTER INSERT OR DELETE OR UPDATE OF "product_id", "url", "orden" ON "public"."product_images" FOR EACH ROW EXECUTE FUNCTION "public"."product_images_sync_producto_foto_principal_tg"();



CREATE OR REPLACE TRIGGER "productos_set_search_vector_tg" BEFORE INSERT OR UPDATE OF "codigo", "legacy_code", "nombre", "categoria", "categoria_principal", "subcategoria", "linea_producto", "description_short", "description_long", "tags", "benefits" ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."productos_set_search_vector"();



CREATE OR REPLACE TRIGGER "set_izzy_carriers_updated_at" BEFORE UPDATE ON "public"."izzy_carriers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_izzy_compensation_plans_updated_at" BEFORE UPDATE ON "public"."izzy_compensation_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_izzy_compensation_promotions_updated_at" BEFORE UPDATE ON "public"."izzy_compensation_promotions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_izzy_portal_users_updated_at" BEFORE UPDATE ON "public"."izzy_portal_users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_izzy_quoters_updated_at" BEFORE UPDATE ON "public"."izzy_quoters" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_clientes" BEFORE UPDATE ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_componentes_equipo" BEFORE UPDATE ON "public"."componentes_equipo" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_embajador_programas" BEFORE UPDATE ON "public"."embajador_programas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_embajadores" BEFORE UPDATE ON "public"."embajadores" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_equipos_instalados" BEFORE UPDATE ON "public"."equipos_instalados" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_leads" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_oportunidades" BEFORE UPDATE ON "public"."oportunidades" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_periodos_programa" BEFORE UPDATE ON "public"."periodos_programa" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_productos" BEFORE UPDATE ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_programa_4en14" BEFORE UPDATE ON "public"."programa_4en14" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_programa_4en14_referidos" BEFORE UPDATE ON "public"."programa_4en14_referidos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_programas" BEFORE UPDATE ON "public"."programas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_servicio_componentes" BEFORE UPDATE ON "public"."servicio_componentes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_servicios" BEFORE UPDATE ON "public"."servicios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_usuarios" BEFORE UPDATE ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_ventas" BEFORE UPDATE ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_venta_items_org_id" BEFORE INSERT OR UPDATE OF "org_id", "venta_id" ON "public"."venta_items" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_venta_child_org_id"();



CREATE OR REPLACE TRIGGER "set_venta_transacciones_org_id" BEFORE INSERT OR UPDATE OF "org_id", "venta_id" ON "public"."venta_transacciones" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_venta_child_org_id"();



CREATE OR REPLACE TRIGGER "set_ventas_org_id" BEFORE INSERT OR UPDATE OF "org_id", "vendedor_id", "cliente_id" ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_ventas_org_id"();



CREATE OR REPLACE TRIGGER "sync_ventas_children_org_id" AFTER INSERT OR UPDATE OF "org_id" ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sync_ventas_children_org_id"();



CREATE OR REPLACE TRIGGER "tg_mk_messages_sync_status" BEFORE INSERT OR UPDATE ON "public"."mk_messages" FOR EACH ROW EXECUTE FUNCTION "public"."mk_messages_sync_status"();



CREATE OR REPLACE TRIGGER "tr_clientes_phone_fallback" BEFORE INSERT OR UPDATE ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_clientes_phone_fallback"();



CREATE OR REPLACE TRIGGER "tr_usuarios_proteger_roles" BEFORE UPDATE ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."fn_proteger_roles"();



CREATE OR REPLACE TRIGGER "trg_ci_activaciones_set_updated_at" BEFORE UPDATE ON "public"."ci_activaciones" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_ci_referidos_set_updated_at" BEFORE UPDATE ON "public"."ci_referidos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cliente_autolink_persona" BEFORE INSERT OR UPDATE OF "telefono", "org_id", "distribuidor_id", "persona_id" ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."trg_cliente_autolink_persona"();



CREATE OR REPLACE TRIGGER "trg_clientes_rp_updated_at" BEFORE UPDATE ON "public"."clientes_rp" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_acuerdos_pago_automatico_updated_at" BEFORE UPDATE ON "public"."cob_acuerdos_pago_automatico" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_cobros_programados_updated_at" BEFORE UPDATE ON "public"."cob_cobros_programados" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_cuotas_auto_vencido" BEFORE INSERT OR UPDATE ON "public"."cob_plan_cuotas" FOR EACH ROW EXECUTE FUNCTION "public"."fn_cob_cuotas_auto_vencido"();



CREATE OR REPLACE TRIGGER "trg_cob_cv_balance_adjustments_updated_at" BEFORE UPDATE ON "public"."cob_cv_balance_adjustments" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_cv_resumenes_updated_at" BEFORE UPDATE ON "public"."cob_cv_resumenes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_metodos_pago_updated_at" BEFORE UPDATE ON "public"."cob_metodos_pago" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_pagos_updated_at" BEFORE UPDATE ON "public"."cob_pagos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_plan_cuotas_updated_at" BEFORE UPDATE ON "public"."cob_plan_cuotas" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_plan_pagos_updated_at" BEFORE UPDATE ON "public"."cob_plan_pagos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_ptps_auto_vencido" BEFORE INSERT OR UPDATE ON "public"."cob_ptps" FOR EACH ROW EXECUTE FUNCTION "public"."fn_cob_ptps_auto_vencido"();



CREATE OR REPLACE TRIGGER "trg_cob_revolving_accounts_updated_at" BEFORE UPDATE ON "public"."cob_revolving_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_revolving_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cob_statements_updated_at" BEFORE UPDATE ON "public"."cob_statements" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_crm_tareas_updated_at" BEFORE UPDATE ON "public"."crm_tareas" FOR EACH ROW EXECUTE FUNCTION "public"."set_crm_tareas_updated_at"();



CREATE OR REPLACE TRIGGER "trg_dfp_notification_events_updated_at" BEFORE UPDATE ON "public"."dfp_notification_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_embajador_autolink_persona" BEFORE INSERT OR UPDATE OF "lead_id", "cliente_id", "persona_id" ON "public"."embajadores" FOR EACH ROW EXECUTE FUNCTION "public"."trg_embajador_autolink_persona"();



CREATE OR REPLACE TRIGGER "trg_lead_autolink_persona" BEFORE INSERT OR UPDATE OF "telefono", "owner_id", "persona_id" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."trg_lead_autolink_persona"();



CREATE OR REPLACE TRIGGER "trg_leads_sync_referidor_insert" BEFORE INSERT ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."fn_leads_sync_referidor_insert"();



CREATE OR REPLACE TRIGGER "trg_leads_sync_referidor_update" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."fn_leads_sync_referidor_update"();



CREATE OR REPLACE TRIGGER "trg_message_templates_updated_at" BEFORE UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_message_templates_updated_at"();



CREATE OR REPLACE TRIGGER "trg_mk_campaigns_owner_check" BEFORE INSERT OR UPDATE OF "owner_id" ON "public"."mk_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."fn_check_mk_owner_exists"();



CREATE OR REPLACE TRIGGER "trg_mk_messages_owner_check" BEFORE INSERT OR UPDATE OF "owner_id" ON "public"."mk_messages" FOR EACH ROW EXECUTE FUNCTION "public"."fn_check_mk_owner_exists"();



CREATE OR REPLACE TRIGGER "trg_outbox_log_activity" AFTER INSERT OR UPDATE OF "status" ON "public"."outbox_messages" FOR EACH ROW EXECUTE FUNCTION "public"."fn_outbox_log_activity"();



CREATE OR REPLACE TRIGGER "trg_outbox_messages_updated_at" BEFORE UPDATE ON "public"."outbox_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_outbox_messages_updated_at"();



CREATE OR REPLACE TRIGGER "trg_prospectos_rp_updated_at" BEFORE UPDATE ON "public"."prospectos_rp" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_llamadas_telemercadeo_org_id" BEFORE INSERT OR UPDATE OF "cliente_id", "org_id" ON "public"."llamadas_telemercadeo" FOR EACH ROW EXECUTE FUNCTION "public"."set_llamadas_telemercadeo_org_id"();



CREATE OR REPLACE TRIGGER "trg_sync_cliente_estado_operativo_from_contacto_actividades" AFTER INSERT ON "public"."contacto_actividades" FOR EACH ROW EXECUTE FUNCTION "public"."sync_cliente_estado_operativo_from_contacto_actividades"();



CREATE OR REPLACE TRIGGER "trg_sync_conversation_direction" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_conversation_direction"();



CREATE OR REPLACE TRIGGER "trg_sync_lead_estado_from_contacto_actividades" AFTER INSERT ON "public"."contacto_actividades" FOR EACH ROW EXECUTE FUNCTION "public"."sync_lead_estado_from_contacto_actividades"();



CREATE OR REPLACE TRIGGER "trg_sync_whatsapp_ultimo_envio" AFTER UPDATE OF "status" ON "public"."outbox_messages" FOR EACH ROW EXECUTE FUNCTION "public"."sync_whatsapp_ultimo_envio"();



CREATE OR REPLACE TRIGGER "trigger_validar_prioridad_top" BEFORE INSERT OR UPDATE ON "public"."ci_referidos" FOR EACH ROW EXECUTE FUNCTION "public"."validar_prioridad_top"();



ALTER TABLE ONLY "public"."auto_reply_rules"
    ADD CONSTRAINT "auto_reply_rules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bot_sessions"
    ADD CONSTRAINT "bot_sessions_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "public"."citas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bot_sessions"
    ADD CONSTRAINT "bot_sessions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cargo_vuelta_cases"
    ADD CONSTRAINT "cargo_vuelta_cases_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT NOT VALID;



ALTER TABLE ONLY "public"."cargo_vuelta_cases"
    ADD CONSTRAINT "cargo_vuelta_cases_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id");



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_programa_id_fkey" FOREIGN KEY ("programa_id") REFERENCES "public"."programas"("id");



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_regalo_id_fkey" FOREIGN KEY ("regalo_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_regalo_visita_id_fkey" FOREIGN KEY ("regalo_visita_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_representante_id_fkey" FOREIGN KEY ("representante_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ci_activaciones"
    ADD CONSTRAINT "ci_activaciones_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ci_referidos"
    ADD CONSTRAINT "ci_referidos_activacion_id_fkey" FOREIGN KEY ("activacion_id") REFERENCES "public"."ci_activaciones"("id");



ALTER TABLE ONLY "public"."ci_referidos"
    ADD CONSTRAINT "ci_referidos_asignado_a_fkey" FOREIGN KEY ("asignado_a") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ci_referidos"
    ADD CONSTRAINT "ci_referidos_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "public"."citas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ci_referidos"
    ADD CONSTRAINT "ci_referidos_gestionado_por_fkey" FOREIGN KEY ("gestionado_por_usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ci_referidos"
    ADD CONSTRAINT "ci_referidos_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id");



ALTER TABLE ONLY "public"."ci_referidos"
    ADD CONSTRAINT "ci_referidos_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ci_referidos"
    ADD CONSTRAINT "ci_referidos_ultima_asignacion_por_fkey" FOREIGN KEY ("ultima_asignacion_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."citas"
    ADD CONSTRAINT "citas_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."citas"
    ADD CONSTRAINT "citas_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."mk_campaigns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."citas"
    ADD CONSTRAINT "citas_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."mk_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."citas"
    ADD CONSTRAINT "citas_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."citas"
    ADD CONSTRAINT "citas_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."mk_responses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_distribuidor_id_fkey" FOREIGN KEY ("distribuidor_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clientes_rp"
    ADD CONSTRAINT "clientes_rp_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clientes_rp"
    ADD CONSTRAINT "clientes_rp_merge_by_fkey" FOREIGN KEY ("merge_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_acuerdo_eventos"
    ADD CONSTRAINT "cob_acuerdo_eventos_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cob_acuerdo_eventos"
    ADD CONSTRAINT "cob_acuerdo_eventos_acuerdo_id_fkey" FOREIGN KEY ("acuerdo_id") REFERENCES "public"."cob_acuerdos_pago_automatico"("id");



ALTER TABLE ONLY "public"."cob_acuerdo_eventos"
    ADD CONSTRAINT "cob_acuerdo_eventos_cobro_programado_id_fkey" FOREIGN KEY ("cobro_programado_id") REFERENCES "public"."cob_cobros_programados"("id");



ALTER TABLE ONLY "public"."cob_acuerdos_pago_automatico"
    ADD CONSTRAINT "cob_acuerdos_pago_automatico_cargo_vuelta_case_id_fkey" FOREIGN KEY ("cargo_vuelta_case_id") REFERENCES "public"."cargo_vuelta_cases"("id");



ALTER TABLE ONLY "public"."cob_acuerdos_pago_automatico"
    ADD CONSTRAINT "cob_acuerdos_pago_automatico_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."cob_acuerdos_pago_automatico"
    ADD CONSTRAINT "cob_acuerdos_pago_automatico_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cob_acuerdos_pago_automatico"
    ADD CONSTRAINT "cob_acuerdos_pago_automatico_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "public"."cob_metodos_pago"("id");



ALTER TABLE ONLY "public"."cob_acuerdos_pago_automatico"
    ADD CONSTRAINT "cob_acuerdos_pago_automatico_revolving_account_id_fkey" FOREIGN KEY ("revolving_account_id") REFERENCES "public"."cob_revolving_accounts"("id");



ALTER TABLE ONLY "public"."cob_acuerdos_pago_automatico"
    ADD CONSTRAINT "cob_acuerdos_pago_automatico_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cob_cobros_programados"
    ADD CONSTRAINT "cob_cobros_programados_acuerdo_id_fkey" FOREIGN KEY ("acuerdo_id") REFERENCES "public"."cob_acuerdos_pago_automatico"("id");



ALTER TABLE ONLY "public"."cob_cobros_programados"
    ADD CONSTRAINT "cob_cobros_programados_cargo_vuelta_case_id_fkey" FOREIGN KEY ("cargo_vuelta_case_id") REFERENCES "public"."cargo_vuelta_cases"("id");



ALTER TABLE ONLY "public"."cob_cobros_programados"
    ADD CONSTRAINT "cob_cobros_programados_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."cob_cobros_programados"
    ADD CONSTRAINT "cob_cobros_programados_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "public"."cob_metodos_pago"("id");



ALTER TABLE ONLY "public"."cob_cobros_programados"
    ADD CONSTRAINT "cob_cobros_programados_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "public"."cob_pagos"("id");



ALTER TABLE ONLY "public"."cob_cobros_programados"
    ADD CONSTRAINT "cob_cobros_programados_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "public"."cob_statements"("id");



ALTER TABLE ONLY "public"."cob_cv_balance_adjustments"
    ADD CONSTRAINT "cob_cv_balance_adjustments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_cv_balance_adjustments"
    ADD CONSTRAINT "cob_cv_balance_adjustments_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_cv_balance_adjustments"
    ADD CONSTRAINT "cob_cv_balance_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_cv_resumen_lines"
    ADD CONSTRAINT "cob_cv_resumen_lines_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_cv_resumen_lines"
    ADD CONSTRAINT "cob_cv_resumen_lines_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_cv_resumen_lines"
    ADD CONSTRAINT "cob_cv_resumen_lines_resumen_id_fkey" FOREIGN KEY ("resumen_id") REFERENCES "public"."cob_cv_resumenes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_cv_resumenes"
    ADD CONSTRAINT "cob_cv_resumenes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_cv_resumenes"
    ADD CONSTRAINT "cob_cv_resumenes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_cv_resumenes"
    ADD CONSTRAINT "cob_cv_resumenes_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_cv_resumenes"
    ADD CONSTRAINT "cob_cv_resumenes_outbox_message_id_fkey" FOREIGN KEY ("outbox_message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_document_generation_run_items"
    ADD CONSTRAINT "cob_document_generation_run_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_document_generation_run_items"
    ADD CONSTRAINT "cob_document_generation_run_items_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_document_generation_run_items"
    ADD CONSTRAINT "cob_document_generation_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."cob_document_generation_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_document_generation_runs"
    ADD CONSTRAINT "cob_document_generation_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_cuota_id_fkey" FOREIGN KEY ("cuota_id") REFERENCES "public"."cob_plan_cuotas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "public"."cob_pagos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."cob_plan_pagos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_reverses_ledger_id_fkey" FOREIGN KEY ("reverses_ledger_id") REFERENCES "public"."cob_financial_ledger"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_financial_ledger"
    ADD CONSTRAINT "cob_financial_ledger_revolving_account_id_fkey" FOREIGN KEY ("revolving_account_id") REFERENCES "public"."cob_revolving_accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_gestiones"
    ADD CONSTRAINT "cob_gestiones_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_gestiones"
    ADD CONSTRAINT "cob_gestiones_ptp_id_fkey" FOREIGN KEY ("ptp_id") REFERENCES "public"."cob_ptps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_metodos_pago"
    ADD CONSTRAINT "cob_metodos_pago_cargo_vuelta_case_id_fkey" FOREIGN KEY ("cargo_vuelta_case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_metodos_pago"
    ADD CONSTRAINT "cob_metodos_pago_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_metodos_pago"
    ADD CONSTRAINT "cob_metodos_pago_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_metodos_pago"
    ADD CONSTRAINT "cob_metodos_pago_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_pagos"
    ADD CONSTRAINT "cob_pagos_cargo_vuelta_case_id_fkey" FOREIGN KEY ("cargo_vuelta_case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_pagos"
    ADD CONSTRAINT "cob_pagos_case_id_fkey" FOREIGN KEY ("cargo_vuelta_case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_pagos"
    ADD CONSTRAINT "cob_pagos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."cob_pagos"
    ADD CONSTRAINT "cob_pagos_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_pagos"
    ADD CONSTRAINT "cob_pagos_ptp_id_fkey" FOREIGN KEY ("ptp_id") REFERENCES "public"."cob_ptps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_pagos"
    ADD CONSTRAINT "cob_pagos_revolving_account_id_fkey" FOREIGN KEY ("revolving_account_id") REFERENCES "public"."cob_revolving_accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_plan_cuotas"
    ADD CONSTRAINT "cob_plan_cuotas_cargo_vuelta_case_id_fkey" FOREIGN KEY ("cargo_vuelta_case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_plan_cuotas"
    ADD CONSTRAINT "cob_plan_cuotas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_plan_cuotas"
    ADD CONSTRAINT "cob_plan_cuotas_cob_pago_id_fkey" FOREIGN KEY ("cob_pago_id") REFERENCES "public"."cob_pagos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_plan_cuotas"
    ADD CONSTRAINT "cob_plan_cuotas_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "public"."cob_pagos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_plan_cuotas"
    ADD CONSTRAINT "cob_plan_cuotas_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."cob_plan_pagos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_plan_cuotas"
    ADD CONSTRAINT "cob_plan_cuotas_plan_pago_id_fkey" FOREIGN KEY ("plan_pago_id") REFERENCES "public"."cob_plan_pagos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_plan_pagos"
    ADD CONSTRAINT "cob_plan_pagos_cargo_vuelta_case_id_fkey" FOREIGN KEY ("cargo_vuelta_case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_plan_pagos"
    ADD CONSTRAINT "cob_plan_pagos_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_plan_pagos"
    ADD CONSTRAINT "cob_plan_pagos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_plan_pagos"
    ADD CONSTRAINT "cob_plan_pagos_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_plan_pagos"
    ADD CONSTRAINT "cob_plan_pagos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_plan_pagos"
    ADD CONSTRAINT "cob_plan_pagos_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "public"."cob_metodos_pago"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_plan_pagos"
    ADD CONSTRAINT "cob_plan_pagos_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_ptps"
    ADD CONSTRAINT "cob_ptps_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_ptps"
    ADD CONSTRAINT "cob_ptps_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_ptps"
    ADD CONSTRAINT "cob_ptps_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_ptps"
    ADD CONSTRAINT "cob_ptps_gestion_id_fkey" FOREIGN KEY ("gestion_id") REFERENCES "public"."cob_gestiones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_ptps"
    ADD CONSTRAINT "cob_ptps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_revolving_accounts"
    ADD CONSTRAINT "cob_revolving_accounts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_revolving_accounts"
    ADD CONSTRAINT "cob_revolving_accounts_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_revolving_accounts"
    ADD CONSTRAINT "cob_revolving_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_statement_lines"
    ADD CONSTRAINT "cob_statement_lines_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."cob_financial_ledger"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_statement_lines"
    ADD CONSTRAINT "cob_statement_lines_revolving_account_id_fkey" FOREIGN KEY ("revolving_account_id") REFERENCES "public"."cob_revolving_accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_statement_lines"
    ADD CONSTRAINT "cob_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "public"."cob_statements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_statement_lines"
    ADD CONSTRAINT "cob_statement_lines_statement_org_fk" FOREIGN KEY ("statement_id", "org_id") REFERENCES "public"."cob_statements"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cob_statements"
    ADD CONSTRAINT "cob_statements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cargo_vuelta_cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_statements"
    ADD CONSTRAINT "cob_statements_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cob_statements"
    ADD CONSTRAINT "cob_statements_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_statements"
    ADD CONSTRAINT "cob_statements_outbox_message_id_fkey" FOREIGN KEY ("outbox_message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cob_statements"
    ADD CONSTRAINT "cob_statements_revolving_account_id_fkey" FOREIGN KEY ("revolving_account_id") REFERENCES "public"."cob_revolving_accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."componentes_equipo"
    ADD CONSTRAINT "componentes_equipo_equipo_instalado_id_fkey" FOREIGN KEY ("equipo_instalado_id") REFERENCES "public"."equipos_instalados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacto_actividades"
    ADD CONSTRAINT "contacto_actividades_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contacto_actividades"
    ADD CONSTRAINT "contacto_actividades_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "public"."citas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_tareas"
    ADD CONSTRAINT "crm_tareas_asignado_a_fkey" FOREIGN KEY ("asignado_a") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."crm_tareas"
    ADD CONSTRAINT "crm_tareas_cita_origen_id_fkey" FOREIGN KEY ("cita_origen_id") REFERENCES "public"."citas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_tareas"
    ADD CONSTRAINT "crm_tareas_completada_por_fkey" FOREIGN KEY ("completada_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_tareas"
    ADD CONSTRAINT "crm_tareas_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."dfp_notification_events"
    ADD CONSTRAINT "dfp_notification_events_cuota_id_fkey" FOREIGN KEY ("cuota_id") REFERENCES "public"."cob_plan_cuotas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."embajador_programas"
    ADD CONSTRAINT "embajador_programas_embajador_id_fkey" FOREIGN KEY ("embajador_id") REFERENCES "public"."embajadores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."embajador_programas"
    ADD CONSTRAINT "embajador_programas_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."embajador_programas"
    ADD CONSTRAINT "embajador_programas_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."periodos_programa"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."embajadores"
    ADD CONSTRAINT "embajadores_aceptado_por_fkey" FOREIGN KEY ("aceptado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."embajadores"
    ADD CONSTRAINT "embajadores_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."embajadores"
    ADD CONSTRAINT "embajadores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."embajadores"
    ADD CONSTRAINT "embajadores_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."embajadores"
    ADD CONSTRAINT "embajadores_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipos_instalados"
    ADD CONSTRAINT "equipos_instalados_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipos_instalados"
    ADD CONSTRAINT "equipos_instalados_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipos_instalados"
    ADD CONSTRAINT "equipos_instalados_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_revisiones"
    ADD CONSTRAINT "import_revisiones_revisado_por_fkey" FOREIGN KEY ("revisado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."importaciones_hycite"
    ADD CONSTRAINT "importaciones_hycite_importado_por_fkey" FOREIGN KEY ("importado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."inbox_tasks"
    ADD CONSTRAINT "inbox_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inbox_tasks"
    ADD CONSTRAINT "inbox_tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_activity_rules"
    ADD CONSTRAINT "izzy_activity_rules_rank_code_fkey" FOREIGN KEY ("rank_code") REFERENCES "public"."izzy_rank_levels"("code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_agent_rank_history"
    ADD CONSTRAINT "izzy_agent_rank_history_new_rank_code_fkey" FOREIGN KEY ("new_rank_code") REFERENCES "public"."izzy_rank_levels"("code");



ALTER TABLE ONLY "public"."izzy_agent_rank_history"
    ADD CONSTRAINT "izzy_agent_rank_history_previous_rank_code_fkey" FOREIGN KEY ("previous_rank_code") REFERENCES "public"."izzy_rank_levels"("code");



ALTER TABLE ONLY "public"."izzy_agent_rank_history"
    ADD CONSTRAINT "izzy_agent_rank_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."izzy_portal_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_commission_rates"
    ADD CONSTRAINT "izzy_commission_rates_rank_code_fkey" FOREIGN KEY ("rank_code") REFERENCES "public"."izzy_rank_levels"("code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_commission_rates"
    ADD CONSTRAINT "izzy_commission_rates_service_category_code_fkey" FOREIGN KEY ("service_category_code") REFERENCES "public"."izzy_service_categories"("code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_commission_reserves"
    ADD CONSTRAINT "izzy_commission_reserves_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."izzy_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_compensation_plans"
    ADD CONSTRAINT "izzy_compensation_plans_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "public"."izzy_carriers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_compensation_plans"
    ADD CONSTRAINT "izzy_compensation_plans_service_category_code_fkey" FOREIGN KEY ("service_category_code") REFERENCES "public"."izzy_service_categories"("code") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."izzy_compensation_promotions"
    ADD CONSTRAINT "izzy_compensation_promotions_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "public"."izzy_carriers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."izzy_director_bonus_rates"
    ADD CONSTRAINT "izzy_director_bonus_rates_service_category_code_fkey" FOREIGN KEY ("service_category_code") REFERENCES "public"."izzy_service_categories"("code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_orders"
    ADD CONSTRAINT "izzy_orders_ambassador_id_fkey" FOREIGN KEY ("ambassador_id") REFERENCES "public"."izzy_ambassadors"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."izzy_orders"
    ADD CONSTRAINT "izzy_orders_compensation_rank_code_fkey" FOREIGN KEY ("compensation_rank_code") REFERENCES "public"."izzy_rank_levels"("code") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."izzy_orders"
    ADD CONSTRAINT "izzy_orders_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "public"."izzy_portal_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."izzy_orders"
    ADD CONSTRAINT "izzy_orders_service_category_code_fkey" FOREIGN KEY ("service_category_code") REFERENCES "public"."izzy_service_categories"("code") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."izzy_password_reset_requests"
    ADD CONSTRAINT "izzy_password_reset_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."izzy_portal_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."izzy_password_reset_tokens"
    ADD CONSTRAINT "izzy_password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."izzy_portal_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_portal_users"
    ADD CONSTRAINT "izzy_portal_users_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "public"."izzy_portal_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."izzy_portal_users"
    ADD CONSTRAINT "izzy_portal_users_sponsor_user_id_fkey" FOREIGN KEY ("sponsor_user_id") REFERENCES "public"."izzy_portal_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."izzy_rank_requirements"
    ADD CONSTRAINT "izzy_rank_requirements_from_rank_code_fkey" FOREIGN KEY ("from_rank_code") REFERENCES "public"."izzy_rank_levels"("code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."izzy_rank_requirements"
    ADD CONSTRAINT "izzy_rank_requirements_to_rank_code_fkey" FOREIGN KEY ("to_rank_code") REFERENCES "public"."izzy_rank_levels"("code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_notas"
    ADD CONSTRAINT "lead_notas_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_notas"
    ADD CONSTRAINT "lead_notas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_embajador_id_fkey" FOREIGN KEY ("embajador_id") REFERENCES "public"."embajadores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_programa_id_fkey" FOREIGN KEY ("programa_id") REFERENCES "public"."programas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_referido_por_cliente_id_fkey" FOREIGN KEY ("referido_por_cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."llamadas_telemercadeo"
    ADD CONSTRAINT "llamadas_telemercadeo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."llamadas_telemercadeo"
    ADD CONSTRAINT "llamadas_telemercadeo_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id");



ALTER TABLE ONLY "public"."llamadas_telemercadeo"
    ADD CONSTRAINT "llamadas_telemercadeo_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."llamadas_telemercadeo"
    ADD CONSTRAINT "llamadas_telemercadeo_telemercadista_id_fkey" FOREIGN KEY ("telemercadista_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."llamadas_telemercadeo"
    ADD CONSTRAINT "llamadas_telemercadeo_vendedor_asignado_id_fkey" FOREIGN KEY ("vendedor_asignado_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mk_campaigns"
    ADD CONSTRAINT "mk_campaigns_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mk_messages"
    ADD CONSTRAINT "mk_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."mk_campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mk_messages"
    ADD CONSTRAINT "mk_messages_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "public"."citas"("id");



ALTER TABLE ONLY "public"."mk_messages"
    ADD CONSTRAINT "mk_messages_outbox_message_id_fkey" FOREIGN KEY ("outbox_message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mk_messages"
    ADD CONSTRAINT "mk_messages_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mk_responses"
    ADD CONSTRAINT "mk_responses_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."mk_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mk_responses"
    ADD CONSTRAINT "mk_responses_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notasrp"
    ADD CONSTRAINT "notasrp_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notasrp"
    ADD CONSTRAINT "notasrp_enviado_por_fkey" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."oportunidades"
    ADD CONSTRAINT "oportunidades_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."oportunidades"
    ADD CONSTRAINT "oportunidades_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."oportunidades"
    ADD CONSTRAINT "oportunidades_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."outbox_delivery_attempts"
    ADD CONSTRAINT "outbox_delivery_attempts_outbox_message_id_fkey" FOREIGN KEY ("outbox_message_id") REFERENCES "public"."outbox_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outbox_messages"
    ADD CONSTRAINT "outbox_messages_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."outbox_messages"
    ADD CONSTRAINT "outbox_messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_payment_plans"
    ADD CONSTRAINT "product_payment_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_prices"
    ADD CONSTRAINT "product_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_reemplazado_por_id_fkey" FOREIGN KEY ("reemplazado_por_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_replacement_product_id_fkey" FOREIGN KEY ("replacement_product_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."programa_4en14_referidos"
    ADD CONSTRAINT "programa_4en14_referidos_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "public"."citas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."programa_4en14_referidos"
    ADD CONSTRAINT "programa_4en14_referidos_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id");



ALTER TABLE ONLY "public"."programa_4en14_referidos"
    ADD CONSTRAINT "programa_4en14_referidos_programa_id_fkey" FOREIGN KEY ("programa_id") REFERENCES "public"."programa_4en14"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."programa_4en14"
    ADD CONSTRAINT "programa_4en14_regalo_producto_id_fkey" FOREIGN KEY ("regalo_producto_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."programa_4en14"
    ADD CONSTRAINT "programa_4en14_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prospectos_rp"
    ADD CONSTRAINT "prospectos_rp_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prospectos_rp"
    ADD CONSTRAINT "prospectos_rp_merge_by_fkey" FOREIGN KEY ("merge_by") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."servicio_componentes"
    ADD CONSTRAINT "servicio_componentes_componente_equipo_id_fkey" FOREIGN KEY ("componente_equipo_id") REFERENCES "public"."componentes_equipo"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."servicio_componentes"
    ADD CONSTRAINT "servicio_componentes_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "public"."servicios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_equipo_instalado_id_fkey" FOREIGN KEY ("equipo_instalado_id") REFERENCES "public"."equipos_instalados"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."servicios"
    ADD CONSTRAINT "servicios_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tele_vendedor_assignments"
    ADD CONSTRAINT "tele_vendedor_assignments_tele_id_fkey" FOREIGN KEY ("tele_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tele_vendedor_assignments"
    ADD CONSTRAINT "tele_vendedor_assignments_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_distribuidor_padre_id_fkey" FOREIGN KEY ("distribuidor_padre_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendedor_telemercadeo"
    ADD CONSTRAINT "vendedor_telemercadeo_telemercadista_id_fkey" FOREIGN KEY ("telemercadista_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendedor_telemercadeo"
    ADD CONSTRAINT "vendedor_telemercadeo_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venta_items"
    ADD CONSTRAINT "venta_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."venta_items"
    ADD CONSTRAINT "venta_items_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venta_transacciones"
    ADD CONSTRAINT "venta_transacciones_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



CREATE POLICY "Distributors can update leads" ON "public"."leads" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))) OR ("owner_id" = "auth"."uid"()) OR ("vendedor_id" = "auth"."uid"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))) OR ("owner_id" = "auth"."uid"()) OR ("vendedor_id" = "auth"."uid"())));



CREATE POLICY "Insertar por usuarios" ON "public"."contacto_actividades" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Lectura de asignaciones para usuarios autenticados" ON "public"."vendedor_telemercadeo" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Visible para todos" ON "public"."contacto_actividades" FOR SELECT USING (true);



CREATE POLICY "admin_all" ON "public"."usuarios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_all_import_configs" ON "public"."import_configs" USING ("public"."is_admin"());



CREATE POLICY "admin_all_import_runs" ON "public"."import_runs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_all_revisiones" ON "public"."import_revisiones" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_full" ON "public"."cartera_resumen_diario" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



ALTER TABLE "public"."auto_reply_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auto_reply_rules_org" ON "public"."auto_reply_rules" USING (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1))) WITH CHECK (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)));



ALTER TABLE "public"."bot_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bot_sessions_service_all" ON "public"."bot_sessions" USING (true) WITH CHECK (true);



CREATE POLICY "ca_admin_all" ON "public"."contacto_actividades" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "ca_distribuidor_all" ON "public"."contacto_actividades" TO "authenticated" USING ("public"."is_distribuidor"()) WITH CHECK ("public"."is_distribuidor"());



CREATE POLICY "ca_insert_own" ON "public"."contacto_actividades" FOR INSERT TO "authenticated" WITH CHECK (("autor_id" = "auth"."uid"()));



CREATE POLICY "ca_select_authored" ON "public"."contacto_actividades" FOR SELECT TO "authenticated" USING (("autor_id" = "auth"."uid"()));



CREATE POLICY "ca_select_cliente_scope" ON "public"."contacto_actividades" FOR SELECT TO "authenticated" USING ((("contacto_tipo" = 'cliente'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "contacto_actividades"."contacto_id") AND ("c"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ca_select_lead_scope" ON "public"."contacto_actividades" FOR SELECT TO "authenticated" USING ((("contacto_tipo" = 'lead'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."leads" "l"
  WHERE (("l"."id" = "contacto_actividades"."contacto_id") AND (("l"."vendedor_id" = "auth"."uid"()) OR ("l"."owner_id" = "auth"."uid"())) AND ("l"."deleted_at" IS NULL))))));



CREATE POLICY "ca_supervisor_tele_read" ON "public"."contacto_actividades" FOR SELECT TO "authenticated" USING ("public"."is_supervisor_tele"());



ALTER TABLE "public"."cargo_vuelta_cases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cargo_vuelta_cases_cartera_insert" ON "public"."cargo_vuelta_cases" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"())));



CREATE POLICY "cargo_vuelta_cases_cartera_select" ON "public"."cargo_vuelta_cases" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'telemercadeo'::"public"."usuario_rol")))))));



CREATE POLICY "cargo_vuelta_cases_cartera_update" ON "public"."cargo_vuelta_cases" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"()))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"())));



ALTER TABLE "public"."cartera_resumen_diario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ci_activaciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ci_activaciones_delete" ON "public"."ci_activaciones" FOR DELETE TO "authenticated" USING (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor"));



CREATE POLICY "ci_activaciones_insert" ON "public"."ci_activaciones" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = "auth"."uid"()) OR ("representante_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'supervisor_telemercadeo'::"public"."usuario_rol", 'telemercadeo'::"public"."usuario_rol"])))))));



CREATE POLICY "ci_activaciones_select" ON "public"."ci_activaciones" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR ("representante_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'admin'::"public"."usuario_rol")))) OR (EXISTS ( SELECT 1
   FROM ("public"."usuarios" "u"
     JOIN "public"."usuarios" "r" ON (("r"."id" = "ci_activaciones"."representante_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'distribuidor'::"public"."usuario_rol") AND ((("u"."codigo_distribuidor" IS NOT NULL) AND ("r"."codigo_distribuidor" = "u"."codigo_distribuidor")) OR ("r"."distribuidor_padre_id" = "u"."id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'supervisor_telemercadeo'::"public"."usuario_rol")))) OR (EXISTS ( SELECT 1
   FROM "public"."tele_vendedor_assignments" "tva"
  WHERE (("tva"."tele_id" = "auth"."uid"()) AND ("tva"."vendedor_id" = "ci_activaciones"."representante_id"))))));



CREATE POLICY "ci_activaciones_update" ON "public"."ci_activaciones" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR ("representante_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol", 'supervisor_telemercadeo'::"public"."usuario_rol"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."tele_vendedor_assignments" "tva"
  WHERE (("tva"."tele_id" = "auth"."uid"()) AND ("tva"."vendedor_id" = "ci_activaciones"."representante_id")))))) WITH CHECK ((("owner_id" = "auth"."uid"()) OR ("representante_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol", 'supervisor_telemercadeo'::"public"."usuario_rol"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."tele_vendedor_assignments" "tva"
  WHERE (("tva"."tele_id" = "auth"."uid"()) AND ("tva"."vendedor_id" = "ci_activaciones"."representante_id"))))));



CREATE POLICY "ci_activaciones_update_supervisor" ON "public"."ci_activaciones" FOR UPDATE TO "authenticated" USING (( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele")) WITH CHECK (( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele"));



ALTER TABLE "public"."ci_referidos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ci_referidos_delete" ON "public"."ci_referidos" FOR DELETE TO "authenticated" USING (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor"));



CREATE POLICY "ci_referidos_insert" ON "public"."ci_referidos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."ci_activaciones" "a"
  WHERE (("a"."id" = "ci_referidos"."activacion_id") AND (("a"."owner_id" = "auth"."uid"()) OR ("a"."representante_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."usuarios" "u"
          WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'supervisor_telemercadeo'::"public"."usuario_rol", 'telemercadeo'::"public"."usuario_rol"]))))) OR (EXISTS ( SELECT 1
           FROM ("public"."usuarios" "u"
             JOIN "public"."usuarios" "r" ON (("r"."id" = "a"."representante_id")))
          WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'distribuidor'::"public"."usuario_rol") AND ((("u"."codigo_distribuidor" IS NOT NULL) AND ("r"."codigo_distribuidor" = "u"."codigo_distribuidor")) OR ("r"."distribuidor_padre_id" = "u"."id"))))) OR (EXISTS ( SELECT 1
           FROM "public"."tele_vendedor_assignments" "tva"
          WHERE (("tva"."tele_id" = "auth"."uid"()) AND ("tva"."vendedor_id" = "a"."representante_id")))))))));



CREATE POLICY "ci_referidos_select" ON "public"."ci_referidos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."ci_activaciones" "a"
  WHERE (("a"."id" = "ci_referidos"."activacion_id") AND (("a"."owner_id" = "auth"."uid"()) OR ("a"."representante_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."usuarios" "u"
          WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'supervisor_telemercadeo'::"public"."usuario_rol"]))))) OR (EXISTS ( SELECT 1
           FROM ("public"."usuarios" "u"
             JOIN "public"."usuarios" "r" ON (("r"."id" = "a"."representante_id")))
          WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'distribuidor'::"public"."usuario_rol") AND ((("u"."codigo_distribuidor" IS NOT NULL) AND ("r"."codigo_distribuidor" = "u"."codigo_distribuidor")) OR ("r"."distribuidor_padre_id" = "u"."id"))))) OR (EXISTS ( SELECT 1
           FROM "public"."tele_vendedor_assignments" "tva"
          WHERE (("tva"."tele_id" = "auth"."uid"()) AND ("tva"."vendedor_id" = "a"."representante_id")))))))));



CREATE POLICY "ci_referidos_update" ON "public"."ci_referidos" FOR UPDATE TO "authenticated" USING (((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ("owner_id" = "auth"."uid"()) OR ("asignado_a" = "auth"."uid"()) OR (("lead_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."leads" "l"
  WHERE (("l"."id" = "ci_referidos"."lead_id") AND ("l"."deleted_at" IS NULL) AND (("l"."vendedor_id" = "auth"."uid"()) OR ("l"."owner_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND (("l"."vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")) OR ("l"."owner_id" = "auth"."uid"())))))))) OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele")) AND ((( SELECT "security"."current_user_role"() AS "current_user_role") <> 'telemercadeo'::"text") OR ("modo_gestion" = 'telemercadeo'::"text")))) WITH CHECK (((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ("owner_id" = "auth"."uid"()) OR ("asignado_a" = "auth"."uid"()) OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele")) AND ((( SELECT "security"."current_user_role"() AS "current_user_role") <> 'telemercadeo'::"text") OR ("modo_gestion" = 'telemercadeo'::"text"))));



CREATE POLICY "ci_referidos_update_supervisor" ON "public"."ci_referidos" FOR UPDATE TO "authenticated" USING (( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele")) WITH CHECK (( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele"));



ALTER TABLE "public"."citas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "citas_delete" ON "public"."citas" FOR DELETE TO "authenticated" USING ("public"."is_admin_or_distribuidor"());



CREATE POLICY "citas_insert" ON "public"."citas" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "citas_select" ON "public"."citas" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR ("assigned_to" = "auth"."uid"()) OR "public"."is_admin_or_distribuidor"()));



CREATE POLICY "citas_supervisor_tele_read" ON "public"."citas" FOR SELECT TO "authenticated" USING ("public"."is_supervisor_tele"());



CREATE POLICY "citas_tele_read" ON "public"."citas" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'telemercadeo'::"public"."usuario_rol")))) AND (EXISTS ( SELECT 1
   FROM "public"."tele_vendedor_assignments" "tva"
  WHERE (("tva"."tele_id" = "auth"."uid"()) AND (("tva"."vendedor_id" = "citas"."owner_id") OR ("tva"."vendedor_id" = "citas"."assigned_to")))))));



CREATE POLICY "citas_update" ON "public"."citas" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR ("assigned_to" = "auth"."uid"()) OR "public"."is_admin_or_distribuidor"())) WITH CHECK ((("owner_id" = "auth"."uid"()) OR ("assigned_to" = "auth"."uid"()) OR "public"."is_admin_or_distribuidor"()));



ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_admin_all" ON "public"."clientes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "clientes_delete" ON "public"."clientes" FOR DELETE USING ("security"."is_admin_or_distribuidor"());



CREATE POLICY "clientes_distribuidor_all" ON "public"."clientes" TO "authenticated" USING ("public"."is_distribuidor"()) WITH CHECK ("public"."is_distribuidor"());



CREATE POLICY "clientes_insert" ON "public"."clientes" FOR INSERT WITH CHECK ("security"."is_admin_or_distribuidor"());



ALTER TABLE "public"."clientes_rp" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_rp_admin_dist" ON "public"."clientes_rp" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "clientes_rp_vendedor" ON "public"."clientes_rp" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'vendedor'::"public"."usuario_rol") AND ("clientes_rp"."emprendedor_codigo" = "u"."codigo_vendedor")))));



CREATE POLICY "clientes_select" ON "public"."clientes" FOR SELECT USING (("security"."is_admin_or_distribuidor"() OR "security"."is_supervisor_tele"() OR ("vendedor_id" = "auth"."uid"()) OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND ("vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")))));



CREATE POLICY "clientes_supervisor_tele_update" ON "public"."clientes" FOR UPDATE TO "authenticated" USING ("public"."is_supervisor_tele"()) WITH CHECK ("public"."is_supervisor_tele"());



CREATE POLICY "clientes_supervisor_telemercadeo_read" ON "public"."clientes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'supervisor_telemercadeo'::"public"."usuario_rol")))));



CREATE POLICY "clientes_telemercadeo_read" ON "public"."clientes" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'telemercadeo'::"public"."usuario_rol")))) AND (EXISTS ( SELECT 1
   FROM "public"."tele_vendedor_assignments" "t"
  WHERE (("t"."tele_id" = "auth"."uid"()) AND (("t"."vendedor_id" = "clientes"."vendedor_id") OR ("t"."vendedor_id" = "clientes"."distribuidor_id")))))));



CREATE POLICY "clientes_update" ON "public"."clientes" FOR UPDATE USING ("security"."is_admin_or_distribuidor"()) WITH CHECK ("security"."is_admin_or_distribuidor"());



CREATE POLICY "clientes_vendedor_read" ON "public"."clientes" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'vendedor'::"public"."usuario_rol")))) AND ("vendedor_id" = "auth"."uid"())));



ALTER TABLE "public"."cob_acuerdo_eventos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_acuerdo_eventos_insert_cartera" ON "public"."cob_acuerdo_eventos" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_acuerdo_eventos_select_cartera" ON "public"."cob_acuerdo_eventos" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



ALTER TABLE "public"."cob_acuerdos_pago_automatico" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_acuerdos_pago_automatico_insert_cartera" ON "public"."cob_acuerdos_pago_automatico" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))))));



CREATE POLICY "cob_acuerdos_pago_automatico_select_cartera" ON "public"."cob_acuerdos_pago_automatico" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_acuerdos_pago_automatico_update_cartera" ON "public"."cob_acuerdos_pago_automatico" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))))));



ALTER TABLE "public"."cob_cobros_programados" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_cobros_programados_insert_cartera" ON "public"."cob_cobros_programados" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_cobros_programados_select_cartera" ON "public"."cob_cobros_programados" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_cobros_programados_update_cartera" ON "public"."cob_cobros_programados" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



ALTER TABLE "public"."cob_cv_balance_adjustments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_cv_balance_adjustments_cartera_role" ON "public"."cob_cv_balance_adjustments" TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"())));



ALTER TABLE "public"."cob_cv_resumen_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_cv_resumen_lines_cartera_role" ON "public"."cob_cv_resumen_lines" TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"())));



ALTER TABLE "public"."cob_cv_resumenes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_cv_resumenes_cartera_role" ON "public"."cob_cv_resumenes" TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"())));



ALTER TABLE "public"."cob_document_generation_run_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_document_generation_run_items_cartera_role" ON "public"."cob_document_generation_run_items" TO "authenticated" USING ((("org_id" IS NULL) OR (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))))) WITH CHECK ((("org_id" IS NULL) OR (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"()))));



ALTER TABLE "public"."cob_document_generation_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_document_generation_runs_cartera_role" ON "public"."cob_document_generation_runs" TO "authenticated" USING ((("org_id" IS NULL) OR (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))))) WITH CHECK ((("org_id" IS NULL) OR (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"()))));



ALTER TABLE "public"."cob_financial_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_financial_ledger_no_direct_write" ON "public"."cob_financial_ledger" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "cob_financial_ledger_read" ON "public"."cob_financial_ledger" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



ALTER TABLE "public"."cob_gestiones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_gestiones_cartera_role" ON "public"."cob_gestiones" TO "authenticated" USING (("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))) WITH CHECK (("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("gestionado_por" IS NULL) OR ("gestionado_por" = "auth"."uid"())))));



ALTER TABLE "public"."cob_metodos_pago" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_metodos_pago_insert_cartera" ON "public"."cob_metodos_pago" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))))));



CREATE POLICY "cob_metodos_pago_select_cartera" ON "public"."cob_metodos_pago" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_metodos_pago_update_cartera" ON "public"."cob_metodos_pago" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))))));



ALTER TABLE "public"."cob_pagos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_pagos_insert_cartera" ON "public"."cob_pagos" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))))));



CREATE POLICY "cob_pagos_select_cartera" ON "public"."cob_pagos" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_pagos_update_cartera" ON "public"."cob_pagos" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))))));



ALTER TABLE "public"."cob_plan_cuotas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_plan_cuotas_insert_cartera" ON "public"."cob_plan_cuotas" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_plan_cuotas_select_cartera" ON "public"."cob_plan_cuotas" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_plan_cuotas_update_cartera" ON "public"."cob_plan_cuotas" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



ALTER TABLE "public"."cob_plan_pagos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_plan_pagos_insert_cartera" ON "public"."cob_plan_pagos" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))))));



CREATE POLICY "cob_plan_pagos_select_cartera" ON "public"."cob_plan_pagos" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_plan_pagos_update_cartera" ON "public"."cob_plan_pagos" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("created_by" IS NULL) OR ("created_by" = "auth"."uid"()))))));



ALTER TABLE "public"."cob_ptps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_ptps_insert_cartera_role" ON "public"."cob_ptps" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("creado_por" IS NULL) OR ("creado_por" = "auth"."uid"()))))));



CREATE POLICY "cob_ptps_select_cartera_role" ON "public"."cob_ptps" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "cob_ptps_update_cartera_role" ON "public"."cob_ptps" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("creado_por" IS NULL) OR ("creado_por" = "auth"."uid"()))))));



ALTER TABLE "public"."cob_revolving_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_revolving_accounts_cartera_role" ON "public"."cob_revolving_accounts" TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"())));



ALTER TABLE "public"."cob_statement_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_statement_lines_org_member_select" ON "public"."cob_statement_lines" FOR SELECT TO "authenticated" USING (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)));



ALTER TABLE "public"."cob_statements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cob_statements_org_member_select" ON "public"."cob_statements" FOR SELECT TO "authenticated" USING (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)));



ALTER TABLE "public"."componentes_equipo" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "componentes_equipo_admin_all" ON "public"."componentes_equipo" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "componentes_equipo_distribuidor" ON "public"."componentes_equipo" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM ("public"."equipos_instalados" "e"
     JOIN "public"."clientes" "c" ON (("c"."id" = "e"."cliente_id")))
  WHERE (("e"."id" = "componentes_equipo"."equipo_instalado_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("c"."vendedor_id")))))));



CREATE POLICY "componentes_equipo_distribuidor_read" ON "public"."componentes_equipo" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM ("public"."equipos_instalados" "e"
     JOIN "public"."clientes" "c" ON (("c"."id" = "e"."cliente_id")))
  WHERE (("e"."id" = "componentes_equipo"."equipo_instalado_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("c"."vendedor_id")))))));



CREATE POLICY "componentes_equipo_telemercadeo_read" ON "public"."componentes_equipo" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'telemercadeo'::"public"."usuario_rol")))) OR (EXISTS ( SELECT 1
   FROM (("public"."equipos_instalados" "e"
     JOIN "public"."clientes" "c" ON (("c"."id" = "e"."cliente_id")))
     JOIN "public"."tele_vendedor_assignments" "t" ON (("t"."tele_id" = "auth"."uid"())))
  WHERE (("e"."id" = "componentes_equipo"."equipo_instalado_id") AND (("t"."vendedor_id" = "c"."vendedor_id") OR ("t"."vendedor_id" = "c"."distribuidor_id")))))));



CREATE POLICY "componentes_equipo_vendedor_all" ON "public"."componentes_equipo" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."equipos_instalados" "e"
     JOIN "public"."clientes" "c" ON (("c"."id" = "e"."cliente_id")))
  WHERE (("e"."id" = "componentes_equipo"."equipo_instalado_id") AND ("c"."vendedor_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."equipos_instalados" "e"
     JOIN "public"."clientes" "c" ON (("c"."id" = "e"."cliente_id")))
  WHERE (("e"."id" = "componentes_equipo"."equipo_instalado_id") AND ("c"."vendedor_id" = "auth"."uid"())))));



ALTER TABLE "public"."contacto_actividades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversations_org" ON "public"."conversations" TO "authenticated" USING (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1))) WITH CHECK (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)));



ALTER TABLE "public"."crm_tareas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "crm_tareas_auth_read" ON "public"."crm_tareas" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "crm_tareas_auth_write" ON "public"."crm_tareas" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "ct_admin_all" ON "public"."crm_tareas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "ct_distribuidor_all" ON "public"."crm_tareas" TO "authenticated" USING ("public"."is_distribuidor"()) WITH CHECK ("public"."is_distribuidor"());



CREATE POLICY "ct_insert_own" ON "public"."crm_tareas" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "ct_select_own" ON "public"."crm_tareas" FOR SELECT TO "authenticated" USING ((("asignado_a" = "auth"."uid"()) OR ("created_by" = "auth"."uid"())));



CREATE POLICY "ct_supervisor_tele_select" ON "public"."crm_tareas" FOR SELECT TO "authenticated" USING ("public"."is_supervisor_tele"());



CREATE POLICY "ct_update_own" ON "public"."crm_tareas" FOR UPDATE TO "authenticated" USING ((("asignado_a" = "auth"."uid"()) OR ("created_by" = "auth"."uid"()))) WITH CHECK ((("asignado_a" = "auth"."uid"()) OR ("created_by" = "auth"."uid"())));



ALTER TABLE "public"."dfp_notification_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dfp_notification_events_read_cartera" ON "public"."dfp_notification_events" FOR SELECT TO "authenticated" USING ((("org_id" IS NULL) OR ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1))));



CREATE POLICY "dist_select_revisiones_scoped" ON "public"."import_revisiones" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND ("org_id" = ( SELECT "usuarios"."org_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"())
 LIMIT 1))));



CREATE POLICY "dist_team_insert" ON "public"."usuarios" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_distribuidor"() AND ("distribuidor_padre_id" = "auth"."uid"()) AND ("rol" = ANY (ARRAY['vendedor'::"public"."usuario_rol", 'telemercadeo'::"public"."usuario_rol", 'embajador'::"public"."usuario_rol"]))));



CREATE POLICY "dist_team_select" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (("id" = "auth"."uid"()) OR ("distribuidor_padre_id" = "auth"."uid"()))));



CREATE POLICY "dist_team_update" ON "public"."usuarios" FOR UPDATE TO "authenticated" USING (("public"."is_distribuidor"() AND (("id" = "auth"."uid"()) OR ("distribuidor_padre_id" = "auth"."uid"())))) WITH CHECK (("public"."is_distribuidor"() AND (("id" = "auth"."uid"()) OR ("distribuidor_padre_id" = "auth"."uid"()))));



CREATE POLICY "dist_update_revisiones_scoped" ON "public"."import_revisiones" FOR UPDATE TO "authenticated" USING (("public"."is_distribuidor"() AND ("org_id" = ( SELECT "usuarios"."org_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"())
 LIMIT 1)))) WITH CHECK (("public"."is_distribuidor"() AND ("org_id" = ( SELECT "usuarios"."org_id"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"())
 LIMIT 1))));



ALTER TABLE "public"."embajador_programas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "embajador_programas_admin_all" ON "public"."embajador_programas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "embajador_programas_distribuidor_read" ON "public"."embajador_programas" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("owner_id")));



CREATE POLICY "embajador_programas_vendedor_all" ON "public"."embajador_programas" TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."embajadores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "embajadores_admin_all" ON "public"."embajadores" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "embajadores_distribuidor_read" ON "public"."embajadores" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("owner_id")));



CREATE POLICY "embajadores_vendedor_all" ON "public"."embajadores" TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."equipos_instalados" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipos_instalados_admin_all" ON "public"."equipos_instalados" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "equipos_instalados_distribuidor" ON "public"."equipos_instalados" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "equipos_instalados"."cliente_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("c"."vendedor_id")))))));



CREATE POLICY "equipos_instalados_distribuidor_read" ON "public"."equipos_instalados" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "equipos_instalados"."cliente_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("c"."vendedor_id")))))));



CREATE POLICY "equipos_instalados_telemercadeo_read" ON "public"."equipos_instalados" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'telemercadeo'::"public"."usuario_rol")))) OR (EXISTS ( SELECT 1
   FROM ("public"."clientes" "c"
     JOIN "public"."tele_vendedor_assignments" "t" ON (("t"."tele_id" = "auth"."uid"())))
  WHERE (("c"."id" = "equipos_instalados"."cliente_id") AND (("t"."vendedor_id" = "c"."vendedor_id") OR ("t"."vendedor_id" = "c"."distribuidor_id")))))));



CREATE POLICY "equipos_instalados_vendedor_all" ON "public"."equipos_instalados" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "equipos_instalados"."cliente_id") AND ("c"."vendedor_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "equipos_instalados"."cliente_id") AND ("c"."vendedor_id" = "auth"."uid"())))));



ALTER TABLE "public"."import_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_processed_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_revisiones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."importaciones_hycite" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "importaciones_hycite_insert" ON "public"."importaciones_hycite" FOR INSERT TO "authenticated" WITH CHECK (("importado_por" = "auth"."uid"()));



CREATE POLICY "importaciones_hycite_select" ON "public"."importaciones_hycite" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



ALTER TABLE "public"."inbox_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inbox_tasks_org" ON "public"."inbox_tasks" USING (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1))) WITH CHECK (("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)));



ALTER TABLE "public"."izzy_leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_password_reset_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_password_reset_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_portal_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."izzy_quoters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_notas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_notas_delete" ON "public"."lead_notas" FOR DELETE TO "authenticated" USING ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ("usuario_id" = "auth"."uid"())));



CREATE POLICY "lead_notas_insert" ON "public"."lead_notas" FOR INSERT TO "authenticated" WITH CHECK ((("usuario_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."leads" "l"
  WHERE (("l"."id" = "lead_notas"."lead_id") AND ("l"."deleted_at" IS NULL) AND (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("l"."vendedor_id" = "auth"."uid"()) OR ("l"."owner_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND (("l"."vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")) OR ("l"."owner_id" = "auth"."uid"())))))))));



CREATE POLICY "lead_notas_select" ON "public"."lead_notas" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."leads" "l"
  WHERE (("l"."id" = "lead_notas"."lead_id") AND ("l"."deleted_at" IS NULL) AND (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("l"."vendedor_id" = "auth"."uid"()) OR ("l"."owner_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND (("l"."vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")) OR ("l"."owner_id" = "auth"."uid"()))))))));



CREATE POLICY "lead_notas_update" ON "public"."lead_notas" FOR UPDATE TO "authenticated" USING ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ("usuario_id" = "auth"."uid"()))) WITH CHECK ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ("usuario_id" = "auth"."uid"())));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_admin_read" ON "public"."leads" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "leads_delete" ON "public"."leads" FOR DELETE TO "authenticated" USING (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor"));



CREATE POLICY "leads_distribuidor_read" ON "public"."leads" FOR SELECT TO "authenticated" USING ("public"."is_distribuidor"());



CREATE POLICY "leads_distribuidor_select" ON "public"."leads" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND ("deleted_at" IS NULL)));



CREATE POLICY "leads_insert" ON "public"."leads" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR (( SELECT "security"."current_user_role"() AS "current_user_role") = ANY (ARRAY['vendedor'::"text", 'telemercadeo'::"text"]))) AND ("owner_id" = "auth"."uid"())));



CREATE POLICY "leads_select" ON "public"."leads" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("vendedor_id" = "auth"."uid"()) OR ("owner_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND (("vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")) OR ("owner_id" = "auth"."uid"()))))));



CREATE POLICY "leads_supervisor_tele_read" ON "public"."leads" FOR SELECT TO "authenticated" USING ("public"."is_supervisor_tele"());



CREATE POLICY "leads_supervisor_tele_update" ON "public"."leads" FOR UPDATE TO "authenticated" USING (("public"."is_supervisor_tele"() AND ("deleted_at" IS NULL))) WITH CHECK ("public"."is_supervisor_tele"());



CREATE POLICY "leads_update" ON "public"."leads" FOR UPDATE TO "authenticated" USING (((("deleted_at" IS NULL) AND (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("vendedor_id" = "auth"."uid"()) OR ("owner_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND (("vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")) OR ("owner_id" = "auth"."uid"()))))) OR (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") AND ("deleted_at" IS NOT NULL)))) WITH CHECK (((("deleted_at" IS NULL) AND (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("vendedor_id" = "auth"."uid"()) OR ("owner_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND (("vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")) OR ("owner_id" = "auth"."uid"()))))) OR (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") AND ("deleted_at" IS NOT NULL))));



CREATE POLICY "llamadas_delete" ON "public"."llamadas_telemercadeo" FOR DELETE TO "authenticated" USING (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor"));



CREATE POLICY "llamadas_insert" ON "public"."llamadas_telemercadeo" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND ("telemercadista_id" = "auth"."uid"()))));



CREATE POLICY "llamadas_select" ON "public"."llamadas_telemercadeo" FOR SELECT TO "authenticated" USING ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("telemercadista_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND ("vendedor_asignado_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")))));



ALTER TABLE "public"."llamadas_telemercadeo" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "llamadas_telemercadeo_org_delete" ON "public"."llamadas_telemercadeo" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "llamadas_telemercadeo_org_insert" ON "public"."llamadas_telemercadeo" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("telemercadista_id" IS NULL) OR ("telemercadista_id" = "auth"."uid"()))))));



CREATE POLICY "llamadas_telemercadeo_org_select" ON "public"."llamadas_telemercadeo" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text"))));



CREATE POLICY "llamadas_telemercadeo_org_update" ON "public"."llamadas_telemercadeo" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR ("security"."current_user_role"() = 'telemercadeo'::"text")))) WITH CHECK ((("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())
 LIMIT 1)) AND ("public"."is_admin_or_distribuidor"() OR "public"."is_supervisor_tele"() OR (("security"."current_user_role"() = 'telemercadeo'::"text") AND (("telemercadista_id" IS NULL) OR ("telemercadista_id" = "auth"."uid"()))))));



CREATE POLICY "llamadas_update" ON "public"."llamadas_telemercadeo" FOR UPDATE TO "authenticated" USING ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("telemercadista_id" = "auth"."uid"()))) WITH CHECK ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("telemercadista_id" = "auth"."uid"())));



ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "message_templates_delete" ON "public"."message_templates" FOR DELETE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "message_templates_insert" ON "public"."message_templates" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "message_templates_select" ON "public"."message_templates" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR (("scope" = 'shared'::"text") AND ("org_id" = ( SELECT "usuarios"."organizacion"
   FROM "public"."usuarios"
  WHERE ("usuarios"."id" = "auth"."uid"())
 LIMIT 1)))));



CREATE POLICY "message_templates_update" ON "public"."message_templates" FOR UPDATE USING (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_via_conversation" ON "public"."messages" TO "authenticated" USING (("conversation_id" IN ( SELECT "conversations"."id"
   FROM "public"."conversations"
  WHERE ("conversations"."org_id" = ( SELECT "u"."org_id"
           FROM "public"."usuarios" "u"
          WHERE ("u"."id" = "auth"."uid"())
         LIMIT 1)))));



ALTER TABLE "public"."mk_campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mk_campaigns_admin_all" ON "public"."mk_campaigns" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "mk_campaigns_distribuidor_read" ON "public"."mk_campaigns" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("owner_id")));



CREATE POLICY "mk_campaigns_distribuidor_update" ON "public"."mk_campaigns" FOR UPDATE TO "authenticated" USING (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("owner_id"))) WITH CHECK (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("owner_id")));



CREATE POLICY "mk_campaigns_owner_delete" ON "public"."mk_campaigns" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "mk_campaigns_owner_insert" ON "public"."mk_campaigns" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "mk_campaigns_owner_select" ON "public"."mk_campaigns" FOR SELECT TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "mk_campaigns_owner_update" ON "public"."mk_campaigns" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "mk_campaigns_select_marketing_manager" ON "public"."mk_campaigns" FOR SELECT USING (("security"."is_marketing_manager"() OR ("owner_id" = "auth"."uid"())));



ALTER TABLE "public"."mk_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mk_messages_admin_all" ON "public"."mk_messages" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "mk_messages_distribuidor_read" ON "public"."mk_messages" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("owner_id")));



CREATE POLICY "mk_messages_distribuidor_update" ON "public"."mk_messages" FOR UPDATE TO "authenticated" USING (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("owner_id"))) WITH CHECK (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("owner_id")));



CREATE POLICY "mk_messages_insert_own_campaign" ON "public"."mk_messages" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."mk_campaigns" "c"
  WHERE (("c"."id" = "mk_messages"."campaign_id") AND ("c"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "mk_messages_owner_delete" ON "public"."mk_messages" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "mk_messages_owner_insert" ON "public"."mk_messages" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "mk_messages_owner_select" ON "public"."mk_messages" FOR SELECT TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "mk_messages_owner_update" ON "public"."mk_messages" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "mk_messages_select_marketing_manager" ON "public"."mk_messages" FOR SELECT USING (("security"."is_marketing_manager"() OR ("owner_id" = "auth"."uid"())));



ALTER TABLE "public"."mk_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mk_responses_admin_all" ON "public"."mk_responses" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "mk_responses_distribuidor_insert" ON "public"."mk_responses" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM "public"."mk_messages" "m"
  WHERE (("m"."id" = "mk_responses"."message_id") AND "public"."is_distribuidor_of"("m"."owner_id"))))));



CREATE POLICY "mk_responses_distribuidor_read" ON "public"."mk_responses" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM "public"."mk_messages" "m"
  WHERE (("m"."id" = "mk_responses"."message_id") AND "public"."is_distribuidor_of"("m"."owner_id"))))));



CREATE POLICY "mk_responses_distribuidor_update" ON "public"."mk_responses" FOR UPDATE TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM "public"."mk_messages" "m"
  WHERE (("m"."id" = "mk_responses"."message_id") AND "public"."is_distribuidor_of"("m"."owner_id")))))) WITH CHECK (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM "public"."mk_messages" "m"
  WHERE (("m"."id" = "mk_responses"."message_id") AND "public"."is_distribuidor_of"("m"."owner_id"))))));



CREATE POLICY "mk_responses_message_owner_insert" ON "public"."mk_responses" FOR INSERT TO "authenticated" WITH CHECK (((("registrado_por" = "auth"."uid"()) OR ("registrado_por" IS NULL)) AND (EXISTS ( SELECT 1
   FROM "public"."mk_messages" "m"
  WHERE (("m"."id" = "mk_responses"."message_id") AND ("m"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "mk_responses_message_owner_read" ON "public"."mk_responses" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."mk_messages" "m"
  WHERE (("m"."id" = "mk_responses"."message_id") AND ("m"."owner_id" = "auth"."uid"())))));



CREATE POLICY "mk_responses_owner_update" ON "public"."mk_responses" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."mk_messages" "m"
  WHERE (("m"."id" = "mk_responses"."message_id") AND ("m"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."mk_messages" "m"
  WHERE (("m"."id" = "mk_responses"."message_id") AND ("m"."owner_id" = "auth"."uid"())))));



CREATE POLICY "mk_responses_registrado_por" ON "public"."mk_responses" TO "authenticated" USING (("registrado_por" = "auth"."uid"())) WITH CHECK ((("registrado_por" = "auth"."uid"()) OR ("registrado_por" IS NULL)));



ALTER TABLE "public"."notasrp" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notasrp_admin_all" ON "public"."notasrp" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "notasrp_distribuidor" ON "public"."notasrp" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "notasrp"."cliente_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("c"."vendedor_id")))))));



CREATE POLICY "notasrp_insert_authenticated" ON "public"."notasrp" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "notasrp_telemercadeo_insert" ON "public"."notasrp" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['telemercadeo'::"public"."usuario_rol", 'supervisor_telemercadeo'::"public"."usuario_rol"]))))) OR (EXISTS ( SELECT 1
   FROM ("public"."clientes" "c"
     JOIN "public"."tele_vendedor_assignments" "t" ON (("t"."tele_id" = "auth"."uid"())))
  WHERE (("c"."id" = "notasrp"."cliente_id") AND (("t"."vendedor_id" = "c"."vendedor_id") OR ("t"."vendedor_id" = "c"."distribuidor_id")))))));



CREATE POLICY "notasrp_telemercadeo_read" ON "public"."notasrp" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['telemercadeo'::"public"."usuario_rol", 'supervisor_telemercadeo'::"public"."usuario_rol"]))))) OR (EXISTS ( SELECT 1
   FROM ("public"."clientes" "c"
     JOIN "public"."tele_vendedor_assignments" "t" ON (("t"."tele_id" = "auth"."uid"())))
  WHERE (("c"."id" = "notasrp"."cliente_id") AND (("t"."vendedor_id" = "c"."vendedor_id") OR ("t"."vendedor_id" = "c"."distribuidor_id")))))));



CREATE POLICY "notasrp_vendedor" ON "public"."notasrp" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "notasrp"."cliente_id") AND ("c"."vendedor_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "notasrp"."cliente_id") AND ("c"."vendedor_id" = "auth"."uid"())))));



ALTER TABLE "public"."oportunidades" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "oportunidades_delete" ON "public"."oportunidades" FOR DELETE TO "authenticated" USING (( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor"));



CREATE POLICY "oportunidades_insert" ON "public"."oportunidades" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "oportunidades_select" ON "public"."oportunidades" FOR SELECT TO "authenticated" USING ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele") OR ("owner_id" = "auth"."uid"()) OR (("lead_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."leads" "l"
  WHERE (("l"."id" = "oportunidades"."lead_id") AND ("l"."deleted_at" IS NULL) AND (("l"."vendedor_id" = "auth"."uid"()) OR ("l"."owner_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND (("l"."vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids")) OR ("l"."owner_id" = "auth"."uid"())))))))) OR (("cliente_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "oportunidades"."cliente_id") AND (("c"."vendedor_id" = "auth"."uid"()) OR ((( SELECT "security"."current_user_role"() AS "current_user_role") = 'telemercadeo'::"text") AND ("c"."vendedor_id" IN ( SELECT "security"."telemercadeo_vendedor_ids"() AS "telemercadeo_vendedor_ids"))))))))));



CREATE POLICY "oportunidades_update" ON "public"."oportunidades" FOR UPDATE TO "authenticated" USING ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ("owner_id" = "auth"."uid"()))) WITH CHECK ((( SELECT "security"."is_admin_or_distribuidor"() AS "is_admin_or_distribuidor") OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "oportunidades_update_supervisor" ON "public"."oportunidades" FOR UPDATE TO "authenticated" USING (( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele")) WITH CHECK (( SELECT "security"."is_supervisor_tele"() AS "is_supervisor_tele"));



ALTER TABLE "public"."outbox_delivery_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "outbox_delivery_attempts_owner_read" ON "public"."outbox_delivery_attempts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."outbox_messages" "om"
  WHERE (("om"."id" = "outbox_delivery_attempts"."outbox_message_id") AND ("om"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."outbox_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "outbox_messages_delete" ON "public"."outbox_messages" FOR DELETE USING ((("owner_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['borrador'::"text", 'cancelado'::"text"]))));



CREATE POLICY "outbox_messages_insert" ON "public"."outbox_messages" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "outbox_messages_select" ON "public"."outbox_messages" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "outbox_messages_update" ON "public"."outbox_messages" FOR UPDATE USING (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."periodos_programa" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "periodos_programa_admin_all" ON "public"."periodos_programa" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "periodos_programa_read_authenticated" ON "public"."periodos_programa" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."personas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "personas_admin_all" ON "public"."personas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "personas_distribuidor_all" ON "public"."personas" TO "authenticated" USING ("public"."is_distribuidor"()) WITH CHECK ("public"."is_distribuidor"());



CREATE POLICY "personas_vendedor_select" ON "public"."personas" FOR SELECT TO "authenticated" USING (("public"."is_vendedor"() AND ((EXISTS ( SELECT 1
   FROM "public"."leads" "l"
  WHERE (("l"."persona_id" = "personas"."id") AND ("l"."deleted_at" IS NULL) AND (("l"."owner_id" = "auth"."uid"()) OR ("l"."vendedor_id" = "auth"."uid"()))))) OR (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."persona_id" = "personas"."id") AND ("c"."vendedor_id" = "auth"."uid"())))))));



ALTER TABLE "public"."product_images" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_images_admin_delete" ON "public"."product_images" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "product_images_admin_insert" ON "public"."product_images" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "product_images_admin_update" ON "public"."product_images" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "product_images_authenticated_read" ON "public"."product_images" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."productos" "p"
  WHERE (("p"."id" = "product_images"."product_id") AND ("p"."activo" = true) AND (COALESCE("p"."status", 'active'::"text") <> 'draft'::"text")))));



CREATE POLICY "product_images_select" ON "public"."product_images" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."product_payment_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_payment_plans_authenticated_read" ON "public"."product_payment_plans" FOR SELECT TO "authenticated" USING ((("activo" = true) AND (EXISTS ( SELECT 1
   FROM "public"."productos" "p"
  WHERE (("p"."id" = "product_payment_plans"."product_id") AND ("p"."activo" = true) AND (COALESCE("p"."status", 'active'::"text") <> 'draft'::"text"))))));



ALTER TABLE "public"."product_prices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_prices_read_all" ON "public"."product_prices" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



ALTER TABLE "public"."productos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "productos_admin_all" ON "public"."productos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "productos_admin_distribuidor_delete" ON "public"."productos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "productos_admin_distribuidor_insert" ON "public"."productos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "productos_admin_distribuidor_select" ON "public"."productos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "productos_admin_distribuidor_update" ON "public"."productos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "productos_read_authenticated" ON "public"."productos" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "productos_select_auth" ON "public"."productos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "productos_supervisor_tele_select" ON "public"."productos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'supervisor_telemercadeo'::"public"."usuario_rol")))));



CREATE POLICY "productos_telemercadeo_select" ON "public"."productos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'telemercadeo'::"public"."usuario_rol")))));



CREATE POLICY "productos_vendedor_select" ON "public"."productos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."id" = "auth"."uid"()) AND ("usuarios"."rol" = 'vendedor'::"public"."usuario_rol")))));



ALTER TABLE "public"."programa_4en14" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "programa_4en14_admin_all" ON "public"."programa_4en14" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "programa_4en14_distribuidor_read" ON "public"."programa_4en14" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND "public"."is_distribuidor_of"("vendedor_id")));



ALTER TABLE "public"."programa_4en14_referidos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "programa_4en14_referidos_admin_all" ON "public"."programa_4en14_referidos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "programa_4en14_referidos_distribuidor_read" ON "public"."programa_4en14_referidos" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM "public"."programa_4en14" "p"
  WHERE (("p"."id" = "programa_4en14_referidos"."programa_id") AND "public"."is_distribuidor_of"("p"."vendedor_id"))))));



CREATE POLICY "programa_4en14_referidos_vendedor_all" ON "public"."programa_4en14_referidos" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."programa_4en14" "p"
  WHERE (("p"."id" = "programa_4en14_referidos"."programa_id") AND ("p"."vendedor_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."programa_4en14" "p"
  WHERE (("p"."id" = "programa_4en14_referidos"."programa_id") AND ("p"."vendedor_id" = "auth"."uid"())))));



CREATE POLICY "programa_4en14_vendedor_all" ON "public"."programa_4en14" TO "authenticated" USING (("vendedor_id" = "auth"."uid"())) WITH CHECK (("vendedor_id" = "auth"."uid"()));



ALTER TABLE "public"."programas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "programas_admin_all" ON "public"."programas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "programas_read_authenticated" ON "public"."programas" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "programas_select_auth" ON "public"."programas" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."prospectos_rp" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prospectos_rp_admin_dist" ON "public"."prospectos_rp" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol"]))))));



CREATE POLICY "prospectos_rp_vendedor" ON "public"."prospectos_rp" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'vendedor'::"public"."usuario_rol") AND ("prospectos_rp"."emprendedor_codigo" = "u"."codigo_vendedor")))));



ALTER TABLE "public"."servicio_componentes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "servicio_componentes_admin_all" ON "public"."servicio_componentes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "servicio_componentes_distribuidor_read" ON "public"."servicio_componentes" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (EXISTS ( SELECT 1
   FROM ("public"."servicios" "s"
     LEFT JOIN "public"."clientes" "c" ON (("c"."id" = "s"."cliente_id")))
  WHERE (("s"."id" = "servicio_componentes"."servicio_id") AND ((("c"."id" IS NOT NULL) AND (("c"."distribuidor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("c"."vendedor_id"))) OR "public"."is_distribuidor_of"("s"."vendedor_id")))))));



CREATE POLICY "servicio_componentes_vendedor_all" ON "public"."servicio_componentes" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."servicios" "s"
     LEFT JOIN "public"."clientes" "c" ON (("c"."id" = "s"."cliente_id")))
  WHERE (("s"."id" = "servicio_componentes"."servicio_id") AND (("s"."vendedor_id" = "auth"."uid"()) OR ("c"."vendedor_id" = "auth"."uid"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."servicios" "s"
  WHERE (("s"."id" = "servicio_componentes"."servicio_id") AND ("s"."vendedor_id" = "auth"."uid"())))));



ALTER TABLE "public"."servicios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "servicios_admin_all" ON "public"."servicios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "servicios_delete_admin_distribuidor" ON "public"."servicios" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_distribuidor"()));



CREATE POLICY "servicios_distribuidor_all" ON "public"."servicios" TO "authenticated" USING (("public"."is_distribuidor"() AND (("vendedor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("vendedor_id") OR (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "servicios"."cliente_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR ("c"."distribuidor_id" IS NULL) OR "public"."is_distribuidor_of"("c"."vendedor_id")))))))) WITH CHECK (("public"."is_distribuidor"() AND (("vendedor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("vendedor_id") OR (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "servicios"."cliente_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR ("c"."distribuidor_id" IS NULL) OR "public"."is_distribuidor_of"("c"."vendedor_id"))))))));



CREATE POLICY "servicios_insert_access" ON "public"."servicios" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['admin'::"public"."usuario_rol", 'distribuidor'::"public"."usuario_rol", 'vendedor'::"public"."usuario_rol", 'telemercadeo'::"public"."usuario_rol", 'supervisor_telemercadeo'::"public"."usuario_rol"]))))));



CREATE POLICY "servicios_supervisor_tele_read" ON "public"."servicios" FOR SELECT TO "authenticated" USING ("public"."is_supervisor_tele"());



CREATE POLICY "servicios_vendedor_all" ON "public"."servicios" TO "authenticated" USING ((("vendedor_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "servicios"."cliente_id") AND (("c"."vendedor_id" = "auth"."uid"()) OR ("c"."vendedor_id" IS NULL))))))) WITH CHECK (("vendedor_id" = "auth"."uid"()));



CREATE POLICY "solo_admin_importa" ON "public"."importaciones_hycite" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = ANY (ARRAY['distribuidor'::"public"."usuario_rol", 'admin'::"public"."usuario_rol"]))))));



CREATE POLICY "tele_assignments_delete" ON "public"."tele_vendedor_assignments" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_distribuidor"()));



CREATE POLICY "tele_assignments_insert" ON "public"."tele_vendedor_assignments" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_distribuidor"()));



CREATE POLICY "tele_assignments_read" ON "public"."tele_vendedor_assignments" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_distribuidor"() OR (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'supervisor_telemercadeo'::"public"."usuario_rol")))) OR ("tele_id" = "auth"."uid"())));



CREATE POLICY "tele_assignments_update" ON "public"."tele_vendedor_assignments" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_distribuidor"())) WITH CHECK (("public"."is_admin"() OR "public"."is_distribuidor"()));



ALTER TABLE "public"."tele_vendedor_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_self_select" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "user_self_update" ON "public"."usuarios" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_admin_all" ON "public"."usuarios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "usuarios_distribuidor_read" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("public"."is_distribuidor"() AND (("id" = "auth"."uid"()) OR ("distribuidor_padre_id" = "auth"."uid"()))));



CREATE POLICY "usuarios_org_read" ON "public"."usuarios" FOR SELECT TO "authenticated" USING ("public"."current_user_is_not_tele"());



CREATE POLICY "usuarios_read_all" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "usuarios_self_read" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "usuarios_supervisor_tele_read" ON "public"."usuarios" FOR SELECT TO "authenticated" USING ("public"."is_supervisor_tele"());



CREATE POLICY "usuarios_telemercadeo_read" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."vendedor_telemercadeo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venta_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venta_items_inherit_ventas" ON "public"."venta_items" TO "authenticated" USING ((("org_id" IS NOT NULL) AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "venta_items"."venta_id") AND ("v"."org_id" = "venta_items"."org_id")))))) WITH CHECK ((("org_id" IS NOT NULL) AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "venta_items"."venta_id") AND ("v"."org_id" = "venta_items"."org_id"))))));



ALTER TABLE "public"."venta_transacciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venta_transacciones_inherit_ventas" ON "public"."venta_transacciones" TO "authenticated" USING ((("org_id" IS NOT NULL) AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "venta_transacciones"."venta_id") AND ("v"."org_id" = "venta_transacciones"."org_id")))))) WITH CHECK ((("org_id" IS NOT NULL) AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "venta_transacciones"."venta_id") AND ("v"."org_id" = "venta_transacciones"."org_id"))))));



ALTER TABLE "public"."ventas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_admin_all" ON "public"."ventas" TO "authenticated" USING (("public"."is_admin"() AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))))) WITH CHECK (("public"."is_admin"() AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())))));



CREATE POLICY "ventas_distribuidor_all" ON "public"."ventas" TO "authenticated" USING (("public"."is_distribuidor"() AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))) AND (("vendedor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("vendedor_id") OR (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "ventas"."cliente_id") AND ("c"."org_id" = "ventas"."org_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR ("c"."vendedor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("c"."vendedor_id")))))))) WITH CHECK (("public"."is_distribuidor"() AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))) AND (("vendedor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("vendedor_id") OR (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "ventas"."cliente_id") AND ("c"."org_id" = "ventas"."org_id") AND (("c"."distribuidor_id" = "auth"."uid"()) OR ("c"."vendedor_id" = "auth"."uid"()) OR "public"."is_distribuidor_of"("c"."vendedor_id"))))))));



CREATE POLICY "ventas_supervisor_tele_read" ON "public"."ventas" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'supervisor_telemercadeo'::"public"."usuario_rol")))) AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())))));



CREATE POLICY "ventas_tele_read" ON "public"."ventas" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'telemercadeo'::"public"."usuario_rol")))) AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM ("public"."clientes" "c"
     JOIN "public"."tele_vendedor_assignments" "t" ON (("t"."tele_id" = "auth"."uid"())))
  WHERE (("c"."id" = "ventas"."cliente_id") AND ("c"."org_id" = "ventas"."org_id") AND (("t"."vendedor_id" = "c"."vendedor_id") OR ("t"."vendedor_id" = "c"."distribuidor_id")))))));



CREATE POLICY "ventas_vendedor_all" ON "public"."ventas" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'vendedor'::"public"."usuario_rol")))) AND ("vendedor_id" = "auth"."uid"()) AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"()))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."rol" = 'vendedor'::"public"."usuario_rol")))) AND ("vendedor_id" = "auth"."uid"()) AND ("org_id" = ( SELECT "u"."org_id"
   FROM "public"."usuarios" "u"
  WHERE ("u"."id" = "auth"."uid"())))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT USAGE ON SCHEMA "security" TO "authenticated";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."ci_create_leads_for_activation"() TO "anon";
GRANT ALL ON FUNCTION "public"."ci_create_leads_for_activation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ci_create_leads_for_activation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_bot_sessions"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_bot_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_bot_sessions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_is_not_tele"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_is_not_tele"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_not_tele"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_abrir_o_actualizar_cargo_vuelta_case"("p_cliente_id" "uuid", "p_monto_cargo_vuelta" numeric, "p_fecha_cargo_vuelta" "date", "p_dias_vencido" integer, "p_numero_cuenta_hycite" "text", "p_numero_orden_hycite" "text", "p_notas" "text", "p_tipo_caso" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_abrir_o_actualizar_cargo_vuelta_case"("p_cliente_id" "uuid", "p_monto_cargo_vuelta" numeric, "p_fecha_cargo_vuelta" "date", "p_dias_vencido" integer, "p_numero_cuenta_hycite" "text", "p_numero_orden_hycite" "text", "p_notas" "text", "p_tipo_caso" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_abrir_o_actualizar_cargo_vuelta_case"("p_cliente_id" "uuid", "p_monto_cargo_vuelta" numeric, "p_fecha_cargo_vuelta" "date", "p_dias_vencido" integer, "p_numero_cuenta_hycite" "text", "p_numero_orden_hycite" "text", "p_notas" "text", "p_tipo_caso" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_abrir_o_recuperar_caso_cartera"("p_cliente_id" "uuid", "p_monto_total" numeric, "p_dias_vencido" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_abrir_o_recuperar_caso_cartera"("p_cliente_id" "uuid", "p_monto_total" numeric, "p_dias_vencido" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_abrir_o_recuperar_caso_cartera"("p_cliente_id" "uuid", "p_monto_total" numeric, "p_dias_vencido" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_calcular_due_date"("p_fecha_corte" "date", "p_min_days" smallint, "p_preferred_day" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_calcular_due_date"("p_fecha_corte" "date", "p_min_days" smallint, "p_preferred_day" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_calcular_due_date"("p_fecha_corte" "date", "p_min_days" smallint, "p_preferred_day" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_case_next_step_agreement"("p_case_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_case_next_step_agreement"("p_case_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_case_next_step_agreement"("p_case_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_cerrar_cargo_vuelta_case"("p_case_id" "uuid", "p_nota" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cerrar_cargo_vuelta_case"("p_case_id" "uuid", "p_nota" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cerrar_cargo_vuelta_case"("p_case_id" "uuid", "p_nota" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_mk_owner_exists"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_mk_owner_exists"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_mk_owner_exists"() TO "service_role";



GRANT ALL ON TABLE "public"."outbox_messages" TO "anon";
GRANT ALL ON TABLE "public"."outbox_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."outbox_messages" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_claim_outbox_messages_for_n8n"("batch_size" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_claim_outbox_messages_for_n8n"("batch_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_claim_outbox_messages_for_n8n"("batch_size" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_clasificar_atraso"("p_monto_moroso" numeric, "p_fecha_ultimo_pedido" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_clasificar_atraso"("p_monto_moroso" numeric, "p_fecha_ultimo_pedido" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_clasificar_atraso"("p_monto_moroso" numeric, "p_fecha_ultimo_pedido" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_clientes_phone_fallback"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_clientes_phone_fallback"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_clientes_phone_fallback"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cob_acuerdo_calcular_fecha_mensual"("p_anio" integer, "p_mes" integer, "p_dia" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_calcular_fecha_mensual"("p_anio" integer, "p_mes" integer, "p_dia" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_calcular_fecha_mensual"("p_anio" integer, "p_mes" integer, "p_dia" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_calcular_fecha_mensual"("p_anio" integer, "p_mes" integer, "p_dia" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cob_acuerdo_calcular_proximo_cobro"("p_fecha_base" "date", "p_dia" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_calcular_proximo_cobro"("p_fecha_base" "date", "p_dia" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_calcular_proximo_cobro"("p_fecha_base" "date", "p_dia" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_calcular_proximo_cobro"("p_fecha_base" "date", "p_dia" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cob_acuerdo_cancelar"("p_acuerdo_id" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_cancelar"("p_acuerdo_id" "uuid", "p_motivo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_cancelar"("p_acuerdo_id" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_cancelar"("p_acuerdo_id" "uuid", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cob_acuerdo_crear"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_crear"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_crear"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_crear"("p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cob_acuerdo_generar_cobros"("p_acuerdo_id" "uuid", "p_meses_a_generar" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_generar_cobros"("p_acuerdo_id" "uuid", "p_meses_a_generar" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_generar_cobros"("p_acuerdo_id" "uuid", "p_meses_a_generar" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_generar_cobros"("p_acuerdo_id" "uuid", "p_meses_a_generar" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cob_acuerdo_pausar"("p_acuerdo_id" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_pausar"("p_acuerdo_id" "uuid", "p_motivo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_pausar"("p_acuerdo_id" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_pausar"("p_acuerdo_id" "uuid", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cob_acuerdo_reactivar"("p_acuerdo_id" "uuid", "p_fecha_reactivacion" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_reactivar"("p_acuerdo_id" "uuid", "p_fecha_reactivacion" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_reactivar"("p_acuerdo_id" "uuid", "p_fecha_reactivacion" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_acuerdo_reactivar"("p_acuerdo_id" "uuid", "p_fecha_reactivacion" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_cob_cuotas_auto_vencido"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_cuotas_auto_vencido"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_cuotas_auto_vencido"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_cob_ptps_auto_vencido"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cob_ptps_auto_vencido"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_ptps_auto_vencido"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cob_statement_generar"("p_revolving_account_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_notas" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cob_statement_generar"("p_revolving_account_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_notas" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cob_statement_generar"("p_revolving_account_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_notas" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_crear_revolving_account_cargo_vuelta"("p_case_id" "uuid", "p_apr" numeric, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_crear_revolving_account_cargo_vuelta"("p_case_id" "uuid", "p_apr" numeric, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_crear_revolving_account_cargo_vuelta"("p_case_id" "uuid", "p_apr" numeric, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_crear_venta_completa"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_crear_venta_completa"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_crear_venta_completa"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cv_resumen_generar"("p_case_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_generated_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cv_resumen_generar"("p_case_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_generated_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cv_resumen_generar"("p_case_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fin" "date", "p_fecha_corte" "date", "p_generated_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_devengar_interes_revolving"("p_account_id" "uuid", "p_accrual_date" "date", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_devengar_interes_revolving"("p_account_id" "uuid", "p_accrual_date" "date", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_devengar_interes_revolving"("p_account_id" "uuid", "p_accrual_date" "date", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_dispatch_campaign"("p_campaign_id" "uuid", "p_interval_ms" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_dispatch_campaign"("p_campaign_id" "uuid", "p_interval_ms" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_dispatch_campaign"("p_campaign_id" "uuid", "p_interval_ms" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_get_cargo_vuelta_campaign_targets"("p_org_id" "uuid", "p_today" "date", "p_max_auto_attempts" integer, "p_recent_payment_days" integer, "p_daily_cooldown_hours" integer, "p_mock" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_get_cargo_vuelta_campaign_targets"("p_org_id" "uuid", "p_today" "date", "p_max_auto_attempts" integer, "p_recent_payment_days" integer, "p_daily_cooldown_hours" integer, "p_mock" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_cargo_vuelta_campaign_targets"("p_org_id" "uuid", "p_today" "date", "p_max_auto_attempts" integer, "p_recent_payment_days" integer, "p_daily_cooldown_hours" integer, "p_mock" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_import_izzy_leads_from_flow_royal_prestige_clientes"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_import_izzy_leads_from_flow_royal_prestige_clientes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_import_izzy_leads_from_flow_royal_prestige_clientes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_leads_sync_referidor_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_leads_sync_referidor_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_leads_sync_referidor_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_leads_sync_referidor_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_leads_sync_referidor_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_leads_sync_referidor_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_log_outbox_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_log_outbox_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_log_outbox_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_outbox_log_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_outbox_log_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_outbox_log_activity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_proteger_roles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_proteger_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_proteger_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_proteger_roles"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_registrar_pago"("p_org_id" "uuid", "p_cliente_id" "uuid", "p_case_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_metodo_pago" "text", "p_referencia" "text", "p_notas" "text", "p_ptp_id" "uuid", "p_cuota_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_registrar_pago"("p_org_id" "uuid", "p_cliente_id" "uuid", "p_case_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_metodo_pago" "text", "p_referencia" "text", "p_notas" "text", "p_ptp_id" "uuid", "p_cuota_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_registrar_pago"("p_org_id" "uuid", "p_cliente_id" "uuid", "p_case_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_metodo_pago" "text", "p_referencia" "text", "p_notas" "text", "p_ptp_id" "uuid", "p_cuota_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_registrar_pago_revolving"("p_account_id" "uuid", "p_monto" numeric, "p_fecha" "date", "p_referencia" "text", "p_notas" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_registrar_pago_revolving"("p_account_id" "uuid", "p_monto" numeric, "p_fecha" "date", "p_referencia" "text", "p_notas" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_registrar_pago_revolving"("p_account_id" "uuid", "p_monto" numeric, "p_fecha" "date", "p_referencia" "text", "p_notas" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_revolving_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_revolving_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_revolving_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_sync_conversation_direction"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_conversation_direction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_conversation_direction"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_conversion_kpis"("p_user_ids" "uuid"[], "p_range" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_conversion_kpis"("p_user_ids" "uuid"[], "p_range" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_conversion_kpis"("p_user_ids" "uuid"[], "p_range" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_distributor_phone"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_distributor_phone"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_distributor_phone"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_or_distribuidor"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_or_distribuidor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_or_distribuidor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_distribuidor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_distribuidor"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_distribuidor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_distribuidor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_distribuidor_of"("vendor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_distribuidor_of"("vendor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_distribuidor_of"("vendor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_supervisor_tele"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_supervisor_tele"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_supervisor_tele"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_vendedor"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_vendedor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_vendedor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."lead_last_activity"("lead_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."lead_last_activity"("lead_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lead_last_activity"("lead_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_cliente_rp"("p_rp_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_cliente_rp"("p_rp_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_cliente_rp"("p_rp_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_prospecto_rp"("p_rp_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_prospecto_rp"("p_rp_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_prospecto_rp"("p_rp_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mk_messages_sync_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."mk_messages_sync_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mk_messages_sync_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalizar_telefono"("p" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalizar_telefono"("p" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalizar_telefono"("p" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."product_images_sync_producto_foto_principal_tg"() TO "anon";
GRANT ALL ON FUNCTION "public"."product_images_sync_producto_foto_principal_tg"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."product_images_sync_producto_foto_principal_tg"() TO "service_role";



GRANT ALL ON FUNCTION "public"."productos_set_search_vector"() TO "anon";
GRANT ALL ON FUNCTION "public"."productos_set_search_vector"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."productos_set_search_vector"() TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_venta_org_id"("p_vendedor_id" "uuid", "p_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_venta_org_id"("p_vendedor_id" "uuid", "p_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_venta_org_id"("p_vendedor_id" "uuid", "p_cliente_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_crm_tareas_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_crm_tareas_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_crm_tareas_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_llamadas_telemercadeo_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_llamadas_telemercadeo_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_llamadas_telemercadeo_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_message_templates_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_message_templates_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_message_templates_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_outbox_messages_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_outbox_messages_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_outbox_messages_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_cliente_estado_operativo_from_contacto_actividades"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_cliente_estado_operativo_from_contacto_actividades"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_cliente_estado_operativo_from_contacto_actividades"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_lead_estado_from_contacto_actividades"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_lead_estado_from_contacto_actividades"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_lead_estado_from_contacto_actividades"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_producto_foto_principal"("product_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_producto_foto_principal"("product_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_producto_foto_principal"("product_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_whatsapp_ultimo_envio"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_whatsapp_ultimo_envio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_whatsapp_ultimo_envio"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_cliente_autolink_persona"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_cliente_autolink_persona"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_cliente_autolink_persona"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_embajador_autolink_persona"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_embajador_autolink_persona"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_embajador_autolink_persona"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_lead_autolink_persona"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_lead_autolink_persona"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_lead_autolink_persona"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_venta_child_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_venta_child_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_venta_child_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_ventas_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_ventas_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_ventas_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_sync_ventas_children_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_sync_ventas_children_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_sync_ventas_children_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_prioridad_top"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_prioridad_top"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_prioridad_top"() TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "security"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."current_user_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "security"."is_admin_or_distribuidor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."is_admin_or_distribuidor"() TO "authenticated";



REVOKE ALL ON FUNCTION "security"."is_supervisor_tele"() FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."is_supervisor_tele"() TO "authenticated";



REVOKE ALL ON FUNCTION "security"."telemercadeo_vendedor_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."telemercadeo_vendedor_ids"() TO "authenticated";


















GRANT ALL ON TABLE "public"."auto_reply_rules" TO "anon";
GRANT ALL ON TABLE "public"."auto_reply_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."auto_reply_rules" TO "service_role";



GRANT ALL ON TABLE "public"."bot_sessions" TO "anon";
GRANT ALL ON TABLE "public"."bot_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."cargo_vuelta_cases" TO "authenticated";
GRANT ALL ON TABLE "public"."cargo_vuelta_cases" TO "service_role";



GRANT ALL ON TABLE "public"."cartera_resumen_diario" TO "anon";
GRANT ALL ON TABLE "public"."cartera_resumen_diario" TO "authenticated";
GRANT ALL ON TABLE "public"."cartera_resumen_diario" TO "service_role";



GRANT ALL ON TABLE "public"."ci_activaciones" TO "anon";
GRANT ALL ON TABLE "public"."ci_activaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."ci_activaciones" TO "service_role";



GRANT ALL ON TABLE "public"."ci_referidos" TO "anon";
GRANT ALL ON TABLE "public"."ci_referidos" TO "authenticated";
GRANT ALL ON TABLE "public"."ci_referidos" TO "service_role";



GRANT ALL ON TABLE "public"."citas" TO "anon";
GRANT ALL ON TABLE "public"."citas" TO "authenticated";
GRANT ALL ON TABLE "public"."citas" TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "anon";
GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON TABLE "public"."clientes_rp" TO "anon";
GRANT ALL ON TABLE "public"."clientes_rp" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes_rp" TO "service_role";



GRANT ALL ON TABLE "public"."cob_acuerdo_eventos" TO "anon";
GRANT ALL ON TABLE "public"."cob_acuerdo_eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_acuerdo_eventos" TO "service_role";



GRANT ALL ON TABLE "public"."cob_acuerdos_pago_automatico" TO "anon";
GRANT ALL ON TABLE "public"."cob_acuerdos_pago_automatico" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_acuerdos_pago_automatico" TO "service_role";



GRANT ALL ON TABLE "public"."cob_cobros_programados" TO "anon";
GRANT ALL ON TABLE "public"."cob_cobros_programados" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_cobros_programados" TO "service_role";



GRANT ALL ON TABLE "public"."cob_cv_balance_adjustments" TO "anon";
GRANT ALL ON TABLE "public"."cob_cv_balance_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_cv_balance_adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."cob_cv_resumen_lines" TO "anon";
GRANT ALL ON TABLE "public"."cob_cv_resumen_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_cv_resumen_lines" TO "service_role";



GRANT ALL ON TABLE "public"."cob_cv_resumenes" TO "anon";
GRANT ALL ON TABLE "public"."cob_cv_resumenes" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_cv_resumenes" TO "service_role";



GRANT ALL ON TABLE "public"."cob_document_generation_run_items" TO "anon";
GRANT ALL ON TABLE "public"."cob_document_generation_run_items" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_document_generation_run_items" TO "service_role";



GRANT ALL ON TABLE "public"."cob_document_generation_runs" TO "anon";
GRANT ALL ON TABLE "public"."cob_document_generation_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_document_generation_runs" TO "service_role";



GRANT ALL ON TABLE "public"."cob_financial_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_financial_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."cob_gestiones" TO "anon";
GRANT ALL ON TABLE "public"."cob_gestiones" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_gestiones" TO "service_role";



GRANT ALL ON TABLE "public"."cob_metodos_pago" TO "anon";
GRANT ALL ON TABLE "public"."cob_metodos_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_metodos_pago" TO "service_role";



GRANT ALL ON TABLE "public"."cob_pagos" TO "anon";
GRANT ALL ON TABLE "public"."cob_pagos" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_pagos" TO "service_role";



GRANT ALL ON TABLE "public"."cob_plan_cuotas" TO "anon";
GRANT ALL ON TABLE "public"."cob_plan_cuotas" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_plan_cuotas" TO "service_role";



GRANT ALL ON TABLE "public"."cob_plan_pagos" TO "anon";
GRANT ALL ON TABLE "public"."cob_plan_pagos" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_plan_pagos" TO "service_role";



GRANT ALL ON TABLE "public"."cob_ptps" TO "anon";
GRANT ALL ON TABLE "public"."cob_ptps" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_ptps" TO "service_role";



GRANT ALL ON TABLE "public"."cob_revolving_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_revolving_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."cob_statement_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_statement_lines" TO "service_role";



GRANT ALL ON TABLE "public"."cob_statements" TO "authenticated";
GRANT ALL ON TABLE "public"."cob_statements" TO "service_role";



GRANT ALL ON TABLE "public"."componentes_equipo" TO "anon";
GRANT ALL ON TABLE "public"."componentes_equipo" TO "authenticated";
GRANT ALL ON TABLE "public"."componentes_equipo" TO "service_role";



GRANT ALL ON TABLE "public"."contacto_actividades" TO "anon";
GRANT ALL ON TABLE "public"."contacto_actividades" TO "authenticated";
GRANT ALL ON TABLE "public"."contacto_actividades" TO "service_role";



GRANT ALL ON TABLE "public"."contactos_actividades" TO "anon";
GRANT ALL ON TABLE "public"."contactos_actividades" TO "authenticated";
GRANT ALL ON TABLE "public"."contactos_actividades" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."crm_tareas" TO "anon";
GRANT ALL ON TABLE "public"."crm_tareas" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_tareas" TO "service_role";



GRANT ALL ON TABLE "public"."dfp_notification_events" TO "anon";
GRANT ALL ON TABLE "public"."dfp_notification_events" TO "authenticated";
GRANT ALL ON TABLE "public"."dfp_notification_events" TO "service_role";



GRANT ALL ON TABLE "public"."embajador_programas" TO "anon";
GRANT ALL ON TABLE "public"."embajador_programas" TO "authenticated";
GRANT ALL ON TABLE "public"."embajador_programas" TO "service_role";



GRANT ALL ON TABLE "public"."embajadores" TO "anon";
GRANT ALL ON TABLE "public"."embajadores" TO "authenticated";
GRANT ALL ON TABLE "public"."embajadores" TO "service_role";



GRANT ALL ON TABLE "public"."equipos_instalados" TO "anon";
GRANT ALL ON TABLE "public"."equipos_instalados" TO "authenticated";
GRANT ALL ON TABLE "public"."equipos_instalados" TO "service_role";



GRANT ALL ON TABLE "public"."import_configs" TO "anon";
GRANT ALL ON TABLE "public"."import_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_configs" TO "service_role";



GRANT ALL ON TABLE "public"."import_processed_files" TO "anon";
GRANT ALL ON TABLE "public"."import_processed_files" TO "authenticated";
GRANT ALL ON TABLE "public"."import_processed_files" TO "service_role";



GRANT ALL ON TABLE "public"."import_revisiones" TO "anon";
GRANT ALL ON TABLE "public"."import_revisiones" TO "authenticated";
GRANT ALL ON TABLE "public"."import_revisiones" TO "service_role";



GRANT ALL ON TABLE "public"."import_runs" TO "anon";
GRANT ALL ON TABLE "public"."import_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_runs" TO "service_role";



GRANT ALL ON TABLE "public"."importaciones_hycite" TO "anon";
GRANT ALL ON TABLE "public"."importaciones_hycite" TO "authenticated";
GRANT ALL ON TABLE "public"."importaciones_hycite" TO "service_role";



GRANT ALL ON TABLE "public"."inbox_tasks" TO "anon";
GRANT ALL ON TABLE "public"."inbox_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."inbox_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_activity_rules" TO "anon";
GRANT ALL ON TABLE "public"."izzy_activity_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_activity_rules" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_agent_rank_history" TO "anon";
GRANT ALL ON TABLE "public"."izzy_agent_rank_history" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_agent_rank_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_agent_rank_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_agent_rank_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_agent_rank_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_ambassadors" TO "anon";
GRANT ALL ON TABLE "public"."izzy_ambassadors" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_ambassadors" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_ambassadors_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_ambassadors_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_ambassadors_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_carriers" TO "anon";
GRANT ALL ON TABLE "public"."izzy_carriers" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_carriers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_carriers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_carriers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_carriers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_commission_rates" TO "anon";
GRANT ALL ON TABLE "public"."izzy_commission_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_commission_rates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_commission_rates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_commission_rates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_commission_rates_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_commission_reserves" TO "anon";
GRANT ALL ON TABLE "public"."izzy_commission_reserves" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_commission_reserves" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_commission_reserves_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_commission_reserves_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_commission_reserves_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_compensation_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."izzy_compensation_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_compensation_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_compensation_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_compensation_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_compensation_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_compensation_plans" TO "anon";
GRANT ALL ON TABLE "public"."izzy_compensation_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_compensation_plans" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_compensation_plans_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_compensation_plans_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_compensation_plans_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_compensation_promotions" TO "anon";
GRANT ALL ON TABLE "public"."izzy_compensation_promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_compensation_promotions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_compensation_promotions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_compensation_promotions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_compensation_promotions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_compensation_settings" TO "anon";
GRANT ALL ON TABLE "public"."izzy_compensation_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_compensation_settings" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_director_bonus_rates" TO "anon";
GRANT ALL ON TABLE "public"."izzy_director_bonus_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_director_bonus_rates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_director_bonus_rates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_director_bonus_rates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_director_bonus_rates_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_leads" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_leads_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_leads_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_leads_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_orders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_password_reset_requests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_password_reset_requests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_password_reset_requests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_password_reset_requests_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_password_reset_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_password_reset_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_password_reset_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_password_reset_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_portal_users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_portal_users_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_portal_users_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_portal_users_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_quoters" TO "service_role";



GRANT ALL ON SEQUENCE "public"."izzy_quoters_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."izzy_quoters_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."izzy_quoters_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_rank_levels" TO "anon";
GRANT ALL ON TABLE "public"."izzy_rank_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_rank_levels" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_rank_requirements" TO "anon";
GRANT ALL ON TABLE "public"."izzy_rank_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_rank_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."izzy_service_categories" TO "anon";
GRANT ALL ON TABLE "public"."izzy_service_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."izzy_service_categories" TO "service_role";



GRANT ALL ON TABLE "public"."lead_notas" TO "anon";
GRANT ALL ON TABLE "public"."lead_notas" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_notas" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."llamadas_telemercadeo" TO "anon";
GRANT ALL ON TABLE "public"."llamadas_telemercadeo" TO "authenticated";
GRANT ALL ON TABLE "public"."llamadas_telemercadeo" TO "service_role";



GRANT ALL ON TABLE "public"."message_templates" TO "anon";
GRANT ALL ON TABLE "public"."message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."mk_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."mk_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."mk_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."mk_messages" TO "anon";
GRANT ALL ON TABLE "public"."mk_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."mk_messages" TO "service_role";



GRANT ALL ON TABLE "public"."mk_responses" TO "anon";
GRANT ALL ON TABLE "public"."mk_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."mk_responses" TO "service_role";



GRANT ALL ON TABLE "public"."notasrp" TO "anon";
GRANT ALL ON TABLE "public"."notasrp" TO "authenticated";
GRANT ALL ON TABLE "public"."notasrp" TO "service_role";



GRANT ALL ON TABLE "public"."prospectos_rp" TO "anon";
GRANT ALL ON TABLE "public"."prospectos_rp" TO "authenticated";
GRANT ALL ON TABLE "public"."prospectos_rp" TO "service_role";



GRANT ALL ON TABLE "public"."ocr_import_pendientes" TO "anon";
GRANT ALL ON TABLE "public"."ocr_import_pendientes" TO "authenticated";
GRANT ALL ON TABLE "public"."ocr_import_pendientes" TO "service_role";



GRANT ALL ON TABLE "public"."oportunidades" TO "anon";
GRANT ALL ON TABLE "public"."oportunidades" TO "authenticated";
GRANT ALL ON TABLE "public"."oportunidades" TO "service_role";



GRANT ALL ON TABLE "public"."outbox_delivery_attempts" TO "anon";
GRANT ALL ON TABLE "public"."outbox_delivery_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."outbox_delivery_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."periodos_programa" TO "anon";
GRANT ALL ON TABLE "public"."periodos_programa" TO "authenticated";
GRANT ALL ON TABLE "public"."periodos_programa" TO "service_role";



GRANT ALL ON TABLE "public"."personas" TO "anon";
GRANT ALL ON TABLE "public"."personas" TO "authenticated";
GRANT ALL ON TABLE "public"."personas" TO "service_role";



GRANT ALL ON TABLE "public"."product_images" TO "anon";
GRANT ALL ON TABLE "public"."product_images" TO "authenticated";
GRANT ALL ON TABLE "public"."product_images" TO "service_role";



GRANT ALL ON TABLE "public"."product_payment_plans" TO "anon";
GRANT ALL ON TABLE "public"."product_payment_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."product_payment_plans" TO "service_role";



GRANT ALL ON TABLE "public"."product_prices" TO "anon";
GRANT ALL ON TABLE "public"."product_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."product_prices" TO "service_role";



GRANT ALL ON TABLE "public"."productos" TO "anon";
GRANT ALL ON TABLE "public"."productos" TO "authenticated";
GRANT ALL ON TABLE "public"."productos" TO "service_role";



GRANT ALL ON TABLE "public"."productos_sin_costo" TO "anon";
GRANT ALL ON TABLE "public"."productos_sin_costo" TO "authenticated";
GRANT ALL ON TABLE "public"."productos_sin_costo" TO "service_role";



GRANT ALL ON TABLE "public"."programa_4en14" TO "anon";
GRANT ALL ON TABLE "public"."programa_4en14" TO "authenticated";
GRANT ALL ON TABLE "public"."programa_4en14" TO "service_role";



GRANT ALL ON TABLE "public"."programa_4en14_referidos" TO "anon";
GRANT ALL ON TABLE "public"."programa_4en14_referidos" TO "authenticated";
GRANT ALL ON TABLE "public"."programa_4en14_referidos" TO "service_role";



GRANT ALL ON TABLE "public"."programas" TO "anon";
GRANT ALL ON TABLE "public"."programas" TO "authenticated";
GRANT ALL ON TABLE "public"."programas" TO "service_role";



GRANT ALL ON TABLE "public"."servicio_componentes" TO "anon";
GRANT ALL ON TABLE "public"."servicio_componentes" TO "authenticated";
GRANT ALL ON TABLE "public"."servicio_componentes" TO "service_role";



GRANT ALL ON TABLE "public"."servicios" TO "anon";
GRANT ALL ON TABLE "public"."servicios" TO "authenticated";
GRANT ALL ON TABLE "public"."servicios" TO "service_role";



GRANT ALL ON TABLE "public"."tele_vendedor_assignments" TO "anon";
GRANT ALL ON TABLE "public"."tele_vendedor_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."tele_vendedor_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."timezone_city_state_map" TO "anon";
GRANT ALL ON TABLE "public"."timezone_city_state_map" TO "authenticated";
GRANT ALL ON TABLE "public"."timezone_city_state_map" TO "service_role";



GRANT ALL ON TABLE "public"."timezone_zip_map" TO "anon";
GRANT ALL ON TABLE "public"."timezone_zip_map" TO "authenticated";
GRANT ALL ON TABLE "public"."timezone_zip_map" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios" TO "anon";
GRANT ALL ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."v_agenda_hoy" TO "anon";
GRANT ALL ON TABLE "public"."v_agenda_hoy" TO "authenticated";
GRANT ALL ON TABLE "public"."v_agenda_hoy" TO "service_role";



GRANT ALL ON TABLE "public"."v_cargo_vuelta_resumen" TO "anon";
GRANT ALL ON TABLE "public"."v_cargo_vuelta_resumen" TO "authenticated";
GRANT ALL ON TABLE "public"."v_cargo_vuelta_resumen" TO "service_role";



GRANT ALL ON TABLE "public"."v_cartera_operativa" TO "anon";
GRANT ALL ON TABLE "public"."v_cartera_operativa" TO "authenticated";
GRANT ALL ON TABLE "public"."v_cartera_operativa" TO "service_role";



GRANT ALL ON TABLE "public"."v_cartera_telemercadeo" TO "anon";
GRANT ALL ON TABLE "public"."v_cartera_telemercadeo" TO "authenticated";
GRANT ALL ON TABLE "public"."v_cartera_telemercadeo" TO "service_role";



GRANT ALL ON TABLE "public"."v_catalogo_vendedor" TO "anon";
GRANT ALL ON TABLE "public"."v_catalogo_vendedor" TO "authenticated";
GRANT ALL ON TABLE "public"."v_catalogo_vendedor" TO "service_role";



GRANT ALL ON TABLE "public"."v_componentes_vencidos" TO "anon";
GRANT ALL ON TABLE "public"."v_componentes_vencidos" TO "authenticated";
GRANT ALL ON TABLE "public"."v_componentes_vencidos" TO "service_role";



GRANT ALL ON TABLE "public"."v_ledger_saldos_reconstruidos" TO "anon";
GRANT ALL ON TABLE "public"."v_ledger_saldos_reconstruidos" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ledger_saldos_reconstruidos" TO "service_role";



GRANT ALL ON TABLE "public"."v_dfp_caso_resumen" TO "authenticated";
GRANT ALL ON TABLE "public"."v_dfp_caso_resumen" TO "service_role";



GRANT ALL ON TABLE "public"."v_izzy_flow_rp_clientes_import_eligible" TO "anon";
GRANT ALL ON TABLE "public"."v_izzy_flow_rp_clientes_import_eligible" TO "authenticated";
GRANT ALL ON TABLE "public"."v_izzy_flow_rp_clientes_import_eligible" TO "service_role";



GRANT ALL ON TABLE "public"."v_izzy_flow_rp_clientes_import_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_izzy_flow_rp_clientes_import_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_izzy_flow_rp_clientes_import_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_lead_fuentes" TO "anon";
GRANT ALL ON TABLE "public"."v_lead_fuentes" TO "authenticated";
GRANT ALL ON TABLE "public"."v_lead_fuentes" TO "service_role";



GRANT ALL ON TABLE "public"."v_lead_last_activity" TO "anon";
GRANT ALL ON TABLE "public"."v_lead_last_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."v_lead_last_activity" TO "service_role";



GRANT ALL ON TABLE "public"."v_mk_campaign_stats" TO "anon";
GRANT ALL ON TABLE "public"."v_mk_campaign_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."v_mk_campaign_stats" TO "service_role";



GRANT ALL ON TABLE "public"."v_product_catalog" TO "anon";
GRANT ALL ON TABLE "public"."v_product_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."v_product_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."v_productos_publicos" TO "anon";
GRANT ALL ON TABLE "public"."v_productos_publicos" TO "authenticated";
GRANT ALL ON TABLE "public"."v_productos_publicos" TO "service_role";



GRANT ALL ON TABLE "public"."vendedor_telemercadeo" TO "anon";
GRANT ALL ON TABLE "public"."vendedor_telemercadeo" TO "authenticated";
GRANT ALL ON TABLE "public"."vendedor_telemercadeo" TO "service_role";



GRANT ALL ON TABLE "public"."venta_items" TO "anon";
GRANT ALL ON TABLE "public"."venta_items" TO "authenticated";
GRANT ALL ON TABLE "public"."venta_items" TO "service_role";



GRANT ALL ON TABLE "public"."venta_transacciones" TO "anon";
GRANT ALL ON TABLE "public"."venta_transacciones" TO "authenticated";
GRANT ALL ON TABLE "public"."venta_transacciones" TO "service_role";



GRANT ALL ON TABLE "public"."ventas" TO "anon";
GRANT ALL ON TABLE "public"."ventas" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































