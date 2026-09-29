-- Migrate fn_cob_trigger_recibo_pago's worker secret from a hardcoded
-- literal (removed from the trigger body by this migration) to a runtime
-- lookup against Supabase Vault.
--
-- This migration does NOT create or populate any Vault secret and does NOT
-- contain any real secret value. Before this trigger can send authenticated
-- requests again, an authorized operator must create the Vault entry:
--
--   select vault.create_secret('<the current worker secret value>', 'outbox_worker_secret');
--
-- using the SAME value already provisioned as the Edge Functions'
-- OUTBOX_WORKER_SECRET, so this database producer and the Edge Function
-- consumers stay in sync during rotation (see LOOP #32 design: the database
-- producer does not need dual-secret current/previous logic — it simply
-- reads whichever value is currently stored under 'outbox_worker_secret' in
-- Vault, mirroring OUTBOX_WORKER_SECRET's current value at all times).
--
-- Fail-closed behavior: if the Vault secret is absent, empty, or present
-- more than once (an invalid configuration state — vault.secrets has no
-- UNIQUE constraint on name, so duplicate rows are physically possible and
-- must never be resolved by arbitrarily picking one), this function does
-- NOT call net.http_post with an empty/default/ambiguous secret — it skips
-- sending the request entirely and raises a WARNING (not an exception), so
-- a Vault misconfiguration cannot block real payment registration on
-- public.cob_pagos. The payment row is still inserted normally; only the
-- receipt-email side effect is skipped, exactly as if net.http_post itself
-- had silently failed (its prior behavior had no error handling either).
-- The warning text never includes the secret value itself.
--
-- Cardinality and value are read from a single aggregate query (one
-- statement, one consistent snapshot) rather than a COUNT followed by a
-- separate SELECT, so a concurrent Vault write between two statements
-- cannot invalidate the cardinality decision (TOCTOU). max(decrypted_secret)
-- is only ever used when count(*) = 1, in which case it is that one row's
-- value and nothing is "arbitrarily chosen" among duplicates; whenever
-- count(*) <> 1 the aggregated value is discarded unread.
--
-- All other behavior is preserved unchanged: signature, SECURITY DEFINER,
-- search_path, trigger semantics (AFTER INSERT on public.cob_pagos WHEN
-- new.estado = 'registrado', unchanged, not redefined here since the
-- function signature and name are unchanged), endpoint URL, header names,
-- and payload shape.

create or replace function public.fn_cob_trigger_recibo_pago()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker_secret text;
  v_match_count int;
begin
  select count(*), max(decrypted_secret)
    into v_match_count, v_worker_secret
    from vault.decrypted_secrets
    where name = 'outbox_worker_secret';

  if v_match_count <> 1 then
    raise warning 'fn_cob_trigger_recibo_pago: expected exactly 1 Vault entry named outbox_worker_secret, found %, skipping receipt notification for pago_id=%', v_match_count, new.id;
    return new;
  end if;

  if v_worker_secret is null or v_worker_secret = '' then
    raise warning 'fn_cob_trigger_recibo_pago: outbox_worker_secret is empty in Vault, skipping receipt notification for pago_id=%', new.id;
    return new;
  end if;

  perform net.http_post(
    url := 'https://rxiarmbosgivaplygqug.supabase.co/functions/v1/send-payment-receipt',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_worker_secret
    ),
    body := jsonb_build_object('pago_id', new.id)
  );

  return new;
end;
$$;
