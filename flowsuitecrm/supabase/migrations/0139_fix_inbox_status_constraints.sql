-- ============================================================
-- 0139: Fix messages.status CHECK — add 'received' for inbound
--
-- Problem:
--   messages.status CHECK in 0103 allows:
--     ('pending','sent','delivered','read','failed')
--   Inbound workflow (inbox_auto_reply.json) inserts with
--   status='received', which violates the constraint.
--
-- Fix:
--   Drop the existing CHECK on messages.status (found
--   dynamically in case auto-name differs from 'messages_status_check')
--   and recreate it adding 'received'.
--   Existing outbound statuses are preserved unchanged.
--
-- No data changes. No other tables touched.
--
-- ROLLBACK:
--   ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_status_check;
--   ALTER TABLE public.messages
--     ADD CONSTRAINT messages_status_check
--     CHECK (status IN ('pending','sent','delivered','read','failed'));
-- ============================================================

begin;

-- Drop existing CHECK constraint on messages.status, whatever Postgres named it
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.messages'::regclass
      AND contype = 'c'
      AND conname LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS %I', r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;
END;
$$;

-- Recreate with 'received' added for inbound messages
ALTER TABLE public.messages
  ADD CONSTRAINT messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'received'));

comment on column public.messages.status is
  'Message delivery status. Outbound: pending→sent→delivered→read|failed. Inbound: received.';

commit;
