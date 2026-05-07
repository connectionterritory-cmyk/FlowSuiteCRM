-- ============================================================
-- QA 0154 + 0155 — fn_calcular_due_date + fn_cob_statement_generar
--
-- Ejecutar en Supabase SQL Editor (como authenticated con rol admin/distribuidor).
-- NO es una migración. No aplicar a producción sin smoke test previo.
--
-- Pasos:
--   1. Validar fn_calcular_due_date con casos edge
--   2. Encontrar una cuenta revolving existente con ledger
--   3. Generar statement de prueba
--   4. Verificar campos del statement generado
--   5. Verificar statement_lines
--   6. Verificar idempotencia (segundo intento debe fallar)
--   7. Cleanup (borrar statement de prueba)
-- ============================================================

-- ── Paso 1: Unit tests de fn_calcular_due_date ──────────────────────────────
-- Caso A: sin preferred_day → retorna fecha_corte + min_days exacto
select
  'A: sin preferred_day'                                       as caso,
  public.fn_calcular_due_date('2026-05-06'::date, 21, null)   as resultado,
  '2026-05-27'::date                                           as esperado,
  public.fn_calcular_due_date('2026-05-06'::date, 21, null)
    = '2026-05-27'::date                                       as ok;

-- Caso B: preferred_day=28, min_due=27 mayo → candidato 28 mayo ≥ 27 mayo ✓
select
  'B: preferred_day=28, pasa en el mismo mes'                  as caso,
  public.fn_calcular_due_date('2026-05-06'::date, 21, 28)     as resultado,
  '2026-05-28'::date                                           as esperado,
  public.fn_calcular_due_date('2026-05-06'::date, 21, 28)
    = '2026-05-28'::date                                       as ok;

-- Caso C: preferred_day=10, min_due=27 mayo → candidato 10 mayo < 27 → avanza a 10 jun
select
  'C: preferred_day=10, adelantado → pasa a junio'            as caso,
  public.fn_calcular_due_date('2026-05-06'::date, 21, 10)    as resultado,
  '2026-06-10'::date                                          as esperado,
  public.fn_calcular_due_date('2026-05-06'::date, 21, 10)
    = '2026-06-10'::date                                      as ok;

-- Caso D: cierre en diciembre → avanza a enero del año siguiente
select
  'D: preferred_day=10, min_due en dic → pasa a enero'        as caso,
  public.fn_calcular_due_date('2026-11-30'::date, 21, 10)    as resultado,
  '2027-01-10'::date                                          as esperado,
  public.fn_calcular_due_date('2026-11-30'::date, 21, 10)
    = '2027-01-10'::date                                      as ok;

-- Caso E: fecha_corte null → debe retornar null
select
  'E: fecha_corte null → null'                                 as caso,
  public.fn_calcular_due_date(null, 21, 15)                   as resultado,
  null::date                                                   as esperado,
  public.fn_calcular_due_date(null, 21, 15) is null           as ok;

-- ── Paso 2: Encontrar cuenta revolving con ledger ────────────────────────────
-- Usar este bloque para obtener un account_id válido con historial de ledger.
select
  a.id                                   as revolving_account_id,
  a.case_id,
  a.cliente_id,
  a.apr_anual,
  a.estado,
  a.statement_closing_day,
  a.customer_preferred_payment_day,
  a.min_days_statement_to_due,
  count(l.id)                            as ledger_entries,
  min(l.effective_date)                  as primer_entry,
  max(l.effective_date)                  as ultimo_entry
from public.cob_revolving_accounts a
join public.cob_financial_ledger   l on l.revolving_account_id = a.id
group by a.id, a.case_id, a.cliente_id, a.apr_anual, a.estado,
         a.statement_closing_day, a.customer_preferred_payment_day,
         a.min_days_statement_to_due
order by ledger_entries desc
limit 5;

-- ── Paso 3: Generar statement ────────────────────────────────────────────────
-- Sustituir <REVOLVING_ACCOUNT_ID> con el UUID obtenido arriba.
-- Ajustar período según el rango de effective_date del ledger.
--
-- Ejemplo (período del mes de abril 2026):
/*
select public.fn_cob_statement_generar(
  '<REVOLVING_ACCOUNT_ID>'::uuid,
  '2026-04-01'::date,   -- periodo_inicio
  '2026-04-30'::date,   -- periodo_fin
  '2026-04-30'::date,   -- fecha_corte (= periodo_fin)
  'Estado de cuenta QA — Abril 2026'
);
*/

-- ── Paso 4: Verificar header del statement ───────────────────────────────────
-- Ejecutar después del paso 3.
select
  s.id,
  s.periodo_inicio,
  s.periodo_fin,
  s.fecha_corte,
  s.fecha_vencimiento,
  s.dias_ciclo_facturacion,
  s.balance_previo,
  s.pagos_periodo,
  s.otros_creditos,
  s.compras_periodo,
  s.balance_atrasado,
  s.cargos_totales_periodo,
  s.apr_tae,
  s.tasa_diaria,
  s.balance_sujeto_interes,
  s.cargos_interes_periodo,
  s.nuevo_balance,
  s.pago_minimo,
  s.ytd_cargos_atraso,
  s.ytd_cargos_interes,
  s.mensaje_pago,
  s.status,
  s.metadata
from public.cob_statements s
where s.revolving_account_id = '<REVOLVING_ACCOUNT_ID>'::uuid
order by s.created_at desc
limit 1;

-- ── Paso 5: Verificar líneas del statement ───────────────────────────────────
select
  sl.line_order,
  sl.transaction_date,
  sl.posting_date,
  sl.entry_type,
  sl.component_type,
  sl.description,
  sl.amount,
  sl.ledger_entry_id
from public.cob_statement_lines sl
join public.cob_statements s on s.id = sl.statement_id
where s.revolving_account_id = '<REVOLVING_ACCOUNT_ID>'::uuid
order by sl.line_order;

-- Verificar que la suma de líneas sea consistente con nuevo_balance:
select
  sum(case when amount > 0 then amount else 0 end)::numeric(12,2) as total_cargos,
  sum(case when amount < 0 then amount else 0 end)::numeric(12,2) as total_creditos,
  sum(amount)::numeric(12,2)                                       as neto_periodo
from public.cob_statement_lines sl
join public.cob_statements s on s.id = sl.statement_id
where s.revolving_account_id = '<REVOLVING_ACCOUNT_ID>'::uuid;

-- ── Paso 6: Verificar idempotencia — debe fallar con STATEMENT_EXISTS ────────
/*
select public.fn_cob_statement_generar(
  '<REVOLVING_ACCOUNT_ID>'::uuid,
  '2026-04-01'::date,
  '2026-04-30'::date,
  '2026-04-30'::date,
  'Intento duplicado — debe fallar'
);
*/
-- Esperado: ERROR: STATEMENT_EXISTS: ya existe statement ...

-- ── Paso 7: Cleanup ───────────────────────────────────────────────────────────
-- Solo si el statement fue generado en error. Las líneas se borran en cascade.
/*
delete from public.cob_statements
where revolving_account_id = '<REVOLVING_ACCOUNT_ID>'::uuid
  and status = 'draft'
  and periodo_inicio = '2026-04-01'
  and periodo_fin    = '2026-04-30';
*/
