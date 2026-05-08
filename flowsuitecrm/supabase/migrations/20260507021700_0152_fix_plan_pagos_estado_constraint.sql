-- Migration already applied remotely.
-- Recovered into repository to align local migration history with Supabase remote.
-- Do not re-run manually without review.
--
-- Source: RECOVERED — identical SQL to 20260506220000_0152_fix_plan_pagos_estado_constraint.sql
-- Reason: Re-run on 2026-05-07 to ensure the constraint fix applied cleanly on remote.
--         The 2026-05-06 run had left the old auto-named constraint in place on some
--         environments; this run ensures idempotent clean state.
--
-- Objects affected:
--   - public.cob_plan_pagos: drops cob_plan_pagos_estado_check (auto-named legacy)
--   - public.cob_plan_pagos: re-adds chk_cob_plan_pagos_estado with full value set
-- Verified in Supabase: chk_cob_plan_pagos_estado exists with
--   ('borrador','activo','pausado','cumplido','incumplido','cancelado')

alter table public.cob_plan_pagos
  drop constraint if exists cob_plan_pagos_estado_check;

alter table public.cob_plan_pagos
  drop constraint if exists chk_cob_plan_pagos_estado;

alter table public.cob_plan_pagos
  add constraint chk_cob_plan_pagos_estado
  check (estado in ('borrador', 'activo', 'pausado', 'cumplido', 'incumplido', 'cancelado'));
