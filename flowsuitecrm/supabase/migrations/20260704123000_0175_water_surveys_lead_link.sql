begin;

-- ============================================================
-- 0175 — water_surveys.lead_id
-- Enlaza una encuesta de agua con el lead comercial creado o
-- reutilizado a partir de sus datos (nombre/telefono/direccion).
-- El lead sigue siendo la entidad comercial; la encuesta solo
-- guarda la referencia una vez que el vendedor confirma
-- "Crear/enlazar lead" desde la UI.
-- ============================================================

alter table public.water_surveys
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

create index if not exists idx_water_surveys_lead_id
  on public.water_surveys (lead_id);

comment on column public.water_surveys.lead_id is
  'Lead comercial creado o reutilizado a partir de esta encuesta. Null hasta que el vendedor confirma "Crear/enlazar lead" en la UI.';

commit;

-- Rollback reference:
--   drop index if exists public.idx_water_surveys_lead_id;
--   alter table public.water_surveys drop column if exists lead_id;
