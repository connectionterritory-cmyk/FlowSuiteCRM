-- ============================================================
-- 0123: v_dfp_caso_resumen — Vista de soporte UI para casos DFP
--
-- Objetivo:
--   Vista read-only que expone el resumen operativo completo de un
--   caso Cargo de Vuelta / DFP para el frontend, unificando:
--     - cargo_vuelta_cases (operativo)
--     - cob_revolving_accounts (financiero interno)
--     - cob_financial_ledger (último movimiento)
--     - v_ledger_saldos_reconstruidos (auditoría de drift)
--
-- Principios de diseño:
--   - SECURITY INVOKER: RLS de las tablas base se aplica al llamador.
--     La vista no eleva privilegios; el acceso real lo controlan las
--     policies de cargo_vuelta_cases y cob_revolving_accounts.
--   - Sin auth.uid(): siempre filtrar por org_id desde el frontend o RPC.
--   - Solo crea vista. Sin funciones, triggers, datos, ni RLS nueva.
--   - Columnas de saldo: usa nombres reales del schema, confirmados por
--     preflight. No recalcula saldo_total_actual (ya es columna GENERATED).
--
-- Correcciones vs diseño propuesto (alineadas con preflight):
--   - saldo_principal_actual / saldo_interes_actual / saldo_fees_actual /
--     saldo_total_actual (no principal_balance / interest_balance / etc.)
--   - v_ledger_saldos_reconstruidos expone: saldo_principal_reconstruido,
--     saldo_interes_reconstruido, saldo_fees_reconstruido, saldo_total_reconstruido,
--     total_entries, ultimo_effective_date
--   - requiere_configuracion: no depende de apr_anual null (NOT NULL en 0118);
--     detecta cuenta sin ledger principal_initial
--   - puede_crear_cuenta_revolving: valida tipo_caso = 'cargo_vuelta' (columna real)
--     y estado not in ('Cerrado', 'Cancelado') (valores con mayúscula inicial)
--   - puede_devengar_interes: estado in ('activo','moroso','en_plan') (minúsculas)
--     — bandera informativa, no de autorización
--
-- ROLLBACK:
--   drop view if exists public.v_dfp_caso_resumen;
-- ============================================================

begin;

create or replace view public.v_dfp_caso_resumen
  with (security_invoker = true)
as

with

-- ── Último movimiento en ledger por cuenta revolving ─────────────
ultimo_ledger as (
  select distinct on (revolving_account_id)
    revolving_account_id,
    id             as ultimo_ledger_id,
    entry_type     as ultimo_entry_type,
    component_type as ultimo_component_type,
    amount         as ultimo_amount,
    effective_date as ultimo_ledger_fecha
  from public.cob_financial_ledger
  order by revolving_account_id, effective_date desc, created_at desc
),

-- ── ¿Existe ledger principal_initial para la cuenta? ─────────────
-- Bandera para requiere_configuracion: si la cuenta existe pero no
-- tiene entry_type=principal_initial, el motor financiero está incompleto.
ledger_tiene_inicial as (
  select
    revolving_account_id,
    true as tiene_principal_initial
  from public.cob_financial_ledger
  where entry_type = 'principal_initial'
  group by revolving_account_id
)

select

  -- ── Identificadores ──────────────────────────────────────────
  c.id            as case_id,
  c.org_id,
  c.cliente_id,

  -- ── Caso operativo (cargo_vuelta_cases) ──────────────────────
  c.tipo_caso,
  c.alias_operativo,
  c.estado                                as estado_caso,
  c.fecha_apertura,
  c.fecha_cierre,
  c.fecha_cargo_vuelta,
  c.monto_devuelto,
  c.requiere_reconciliacion,
  c.numero_cuenta_hycite,
  c.numero_orden_hycite,
  c.origen_cargo_vuelta,

  -- ── Cuenta revolving DFP (null si aún no creada) ─────────────
  a.id                                    as account_id,
  a.apr_anual,
  a.metodo_calculo_interes,
  a.fecha_inicio,
  a.fecha_ultimo_devengo,
  a.saldo_principal_inicial,
  a.saldo_principal_actual,
  a.saldo_interes_actual,
  a.saldo_fees_actual,
  a.saldo_total_actual                    as saldo_operativo_interno,
  a.estado                                as estado_cuenta,

  -- ── Último movimiento en ledger ───────────────────────────────
  ul.ultimo_entry_type,
  ul.ultimo_component_type,
  ul.ultimo_ledger_fecha,
  ul.ultimo_amount                        as ultimo_ledger_monto,

  -- ── Saldos reconstruidos desde ledger (auditoría) ────────────
  -- Fuente: v_ledger_saldos_reconstruidos (sin materialización)
  -- Nombres reales confirmados por preflight 2026-04-27.
  lr.saldo_principal_reconstruido,
  lr.saldo_interes_reconstruido,
  lr.saldo_fees_reconstruido,
  lr.saldo_total_reconstruido,
  lr.total_entries                        as ledger_total_entries,

  -- ── Drift: diferencia entre saldo materializado y reconstruido ─
  -- NULL si la cuenta no existe o el ledger no tiene entradas.
  -- Positivo = cuenta tiene más saldo que el ledger (inconsistencia grave).
  -- Negativo = ledger tiene más saldo que la cuenta (inconsistencia grave).
  case
    when a.id is not null and lr.revolving_account_id is not null
    then round(
      coalesce(a.saldo_total_actual, 0) - coalesce(lr.saldo_total_reconstruido, 0),
      2
    )
    else null
  end                                     as drift_saldo_total,

  -- ── Banderas UI ──────────────────────────────────────────────

  -- requiere_configuracion: cuenta revolving creada pero sin ledger
  -- principal_initial. El motor financiero está incompleto.
  -- No puede haber devengo ni pagos hasta resolver.
  case
    when a.id is not null
     and coalesce(li.tiene_principal_initial, false) = false
    then true
    else false
  end                                     as requiere_configuracion,

  -- requiere_revision_saldos: drift > $0.01 entre saldo materializado
  -- y saldo reconstruido desde ledger. Señal de inconsistencia contable.
  case
    when a.id is not null
     and lr.revolving_account_id is not null
     and abs(
       coalesce(a.saldo_total_actual, 0) - coalesce(lr.saldo_total_reconstruido, 0)
     ) > 0.01
    then true
    else false
  end                                     as requiere_revision_saldos,

  -- puede_crear_cuenta_revolving: caso sin cuenta revolving aún,
  -- con monto devuelto y en estado activo (no Cerrado ni Cancelado).
  -- tipo_caso = 'cargo_vuelta' es el único valor permitido hoy.
  case
    when a.id is null
     and coalesce(c.monto_devuelto, 0) > 0
     and c.tipo_caso = 'cargo_vuelta'
     and c.estado not in ('Cerrado', 'Cancelado')
    then true
    else false
  end                                     as puede_crear_cuenta_revolving,

  -- puede_devengar_interes: bandera informativa para UI.
  -- IMPORTANTE: esta columna NO autoriza el devengo ni lo ejecuta.
  -- La autorización real, el lock y la protección contra doble devengo
  -- viven en fn_devengar_interes_revolving (0122).
  -- Esta bandera solo indica si el botón de devengo debe mostrarse activo.
  case
    when a.id is not null
     and a.apr_anual between 0.10 and 0.24
     and coalesce(a.saldo_principal_actual, 0) > 0
     and a.fecha_ultimo_devengo < current_date
     and a.estado in ('activo', 'moroso', 'en_plan')
    then true
    else false
  end                                     as puede_devengar_interes

from public.cargo_vuelta_cases c

left join public.cob_revolving_accounts a
  on  a.case_id = c.id
  and a.org_id  = c.org_id

left join ultimo_ledger ul
  on ul.revolving_account_id = a.id

left join public.v_ledger_saldos_reconstruidos lr
  on  lr.revolving_account_id = a.id
  and lr.org_id               = a.org_id

left join ledger_tiene_inicial li
  on li.revolving_account_id = a.id

where c.tipo_caso = 'cargo_vuelta';


comment on view public.v_dfp_caso_resumen is
  'Vista read-only de soporte UI para casos Cargo de Vuelta / DFP. '
  'Unifica cargo_vuelta_cases, cob_revolving_accounts, cob_financial_ledger '
  'y v_ledger_saldos_reconstruidos. '
  'SECURITY INVOKER: RLS de las tablas base se aplica al llamador. '
  'Sin auth.uid(): siempre filtrar por org_id desde el frontend o un RPC. '
  'Solo muestra tipo_caso=cargo_vuelta. '
  'Las banderas puede_* son informativas para UI; la autorización real vive en las RPCs.';

commit;
