-- ============================================================
-- 0130_contacto_actividades_org_id_compat.sql
-- Asegura org_id en contacto_actividades y recarga schema cache.
--
-- Contexto:
--   Telemercadeo registra la gestion canónica en cob_gestiones y
--   después loguea una actividad en contacto_actividades. En producción,
--   algunas bases tienen contacto_actividades sin org_id o PostgREST con
--   schema cache viejo, causando:
--   "Could not find the 'org_id' column of 'contacto_actividades'"
-- ============================================================

begin;

alter table public.contacto_actividades
  add column if not exists org_id uuid;

create index if not exists contacto_actividades_org_id_idx
  on public.contacto_actividades (org_id);

comment on column public.contacto_actividades.org_id is
  'Tenant owner organization for activity timeline entries. Nullable for legacy compatibility.';

commit;

notify pgrst, 'reload schema';
