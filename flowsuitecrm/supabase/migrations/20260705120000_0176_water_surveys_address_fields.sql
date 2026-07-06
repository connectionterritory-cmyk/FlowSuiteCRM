begin;

-- ============================================================
-- 0176 — water_surveys: campos de dirección separados
-- Permite capturar apartamento/ciudad/estado/zip por separado
-- en vez de un solo texto libre en `direccion`, para poder
-- mapearlos 1:1 a las columnas equivalentes ya existentes en
-- `leads` (apartamento, ciudad, estado_region, codigo_postal)
-- y precargar CitaModal sin datos inventados.
-- ============================================================

alter table public.water_surveys
  add column if not exists apartamento    text,
  add column if not exists ciudad         text,
  add column if not exists estado_region  text,
  add column if not exists codigo_postal  text;

comment on column public.water_surveys.apartamento is
  'Apt/Suite capturado en la encuesta, opcional.';
comment on column public.water_surveys.ciudad is
  'Ciudad capturada en la encuesta, opcional.';
comment on column public.water_surveys.estado_region is
  'Estado/región capturado en la encuesta, opcional.';
comment on column public.water_surveys.codigo_postal is
  'Codigo postal capturado en la encuesta, opcional.';

commit;

-- Rollback reference:
--   alter table public.water_surveys
--     drop column if exists apartamento,
--     drop column if exists ciudad,
--     drop column if exists estado_region,
--     drop column if exists codigo_postal;
