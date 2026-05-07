-- QA 0156 - principal_initial must affect statement header totals
-- Preconditions:
-- - 0154 + 0155 + 0156 applied
-- - Cuenta QA con principal_initial en el periodo

-- 1) Baseline counts
select
  (select count(*) from public.cob_financial_ledger) as ledger_count_before,
  (select count(*) from public.cob_pagos) as pagos_count_before,
  (select count(*) from public.cob_statements) as statements_count_before,
  (select count(*) from public.cob_statement_lines) as statement_lines_count_before;

-- 2) Generate statement QA (replace auth sub if needed)
select set_config('request.jwt.claim.sub', '952140d3-4f83-4952-a0ae-9e9857a37f31', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.fn_cob_statement_generar(
  'cb57cafc-df1c-4910-88fc-c0272badddf2'::uuid,
  '2026-05-01'::date,
  '2026-05-31'::date,
  '2026-05-31'::date,
  'QA 0156 principal_initial'
) as statement_id;

-- 3) Header + line parity when balance_previo = 0
with s as (
  select * from public.cob_statements
  where revolving_account_id = 'cb57cafc-df1c-4910-88fc-c0272badddf2'::uuid
    and periodo_inicio = '2026-05-01'::date
    and periodo_fin = '2026-05-31'::date
  order by created_at desc
  limit 1
), t as (
  select coalesce(sum(sl.amount),0)::numeric(12,2) as net_lines
  from public.cob_statement_lines sl
  join s on s.id = sl.statement_id
)
select
  s.id,
  s.balance_previo,
  s.compras_periodo,
  s.cargos_interes_periodo,
  s.cargos_totales_periodo,
  s.pagos_periodo,
  s.otros_creditos,
  s.nuevo_balance,
  t.net_lines,
  (s.balance_previo = 0 and s.nuevo_balance = t.net_lines) as header_matches_lines_when_zero_prev
from s, t;

-- 4) Verify principal_initial line exists
with s as (
  select id from public.cob_statements
  where revolving_account_id = 'cb57cafc-df1c-4910-88fc-c0272badddf2'::uuid
    and periodo_inicio = '2026-05-01'::date
    and periodo_fin = '2026-05-31'::date
  order by created_at desc
  limit 1
)
select
  count(*) as principal_initial_lines
from public.cob_statement_lines sl
join s on s.id = sl.statement_id
where sl.entry_type = 'principal_initial';

-- 5) Idempotency guard should fail with STATEMENT_EXISTS
-- select public.fn_cob_statement_generar(
--   'cb57cafc-df1c-4910-88fc-c0272badddf2'::uuid,
--   '2026-05-01'::date,
--   '2026-05-31'::date,
--   '2026-05-31'::date,
--   'Duplicate should fail'
-- );

-- 6) Cleanup
with deleted as (
  delete from public.cob_statements
  where revolving_account_id = 'cb57cafc-df1c-4910-88fc-c0272badddf2'::uuid
    and periodo_inicio = '2026-05-01'::date
    and periodo_fin = '2026-05-31'::date
    and status = 'draft'
  returning id
)
select count(*) as statements_deleted from deleted;

-- 7) Final counts
select
  (select count(*) from public.cob_financial_ledger) as ledger_count_after,
  (select count(*) from public.cob_pagos) as pagos_count_after,
  (select count(*) from public.cob_statements) as statements_count_after,
  (select count(*) from public.cob_statement_lines) as statement_lines_count_after;
