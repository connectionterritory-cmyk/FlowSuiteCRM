begin;

alter table public.cob_revolving_accounts
  add column if not exists jurisdiction_state text;

alter table public.cob_revolving_accounts
  drop constraint if exists cob_revolving_accounts_jurisdiction_state_chk;

alter table public.cob_revolving_accounts
  add constraint cob_revolving_accounts_jurisdiction_state_chk
  check (jurisdiction_state is null or jurisdiction_state ~ '^[A-Z]{2}$');

-- La RPC fn_abrir_izzy_finance_cargo_vuelta se define en 20261017040000_izzy_finance_manual_terms.sql
-- (APR y late fee manuales). La version inicial con APR fijo por estado (FL/CA) fue retirada.

commit;
