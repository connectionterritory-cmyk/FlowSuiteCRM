-- ============================================================
-- 0073_citas_timezone.sql
-- Add per-cita timezone for accurate reminders
-- ============================================================

begin;

alter table public.citas
  add column if not exists timezone text;

commit;
