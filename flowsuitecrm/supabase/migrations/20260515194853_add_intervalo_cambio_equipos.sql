begin;

-- Reconciliación de migración aplicada remotamente el 2026-05-15.
-- Añade columnas para el módulo de servicio de cambio de filtros/repuestos.
-- Este archivo existe para alinear el historial local con Supabase remoto.
-- Todas las sentencias son idempotentes.

alter table public.equipos_instalados
  add column if not exists intervalo_cambio_meses integer,
  add column if not exists proxima_cambio date;

alter table public.servicios
  add column if not exists proxima_revision date,
  add column if not exists repuestos_notas text,
  add column if not exists monto_servicio numeric default 0;

commit;
