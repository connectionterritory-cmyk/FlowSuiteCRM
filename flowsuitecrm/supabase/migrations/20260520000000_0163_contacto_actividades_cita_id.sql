-- ============================================================
-- 0163: Add cita_id to contacto_actividades
--
-- Problem:
--   CitaModal writes cierre data (resumen, demo_realizada,
--   muestra_entregada, referidos_obtenidos, productos_interes)
--   to contacto_actividades with a cita_id reference.
--   The column did not exist → INSERT failed silently (console.warn)
--   → cierre fields appeared blank when reopening a completed cita.
--
-- Fix:
--   Add nullable cita_id FK column + index so CitaModal can
--   correctly save and reload the cierre actividad.
--
-- Rollback:
--   alter table public.contacto_actividades drop column if exists cita_id;
--   drop index if exists contacto_actividades_cita_id_idx;
-- ============================================================

begin;

alter table public.contacto_actividades
  add column if not exists cita_id uuid
    references public.citas(id) on delete set null;

create index if not exists contacto_actividades_cita_id_idx
  on public.contacto_actividades (cita_id)
  where cita_id is not null;

comment on column public.contacto_actividades.cita_id is
  'FK opcional a citas. Usado por CitaModal para vincular la actividad de cierre a la cita completada y releer el estado al reabrir.';

commit;
