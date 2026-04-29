-- Migración: Catálogo de Productos - Precios Públicos
-- Ejecutar en Supabase SQL Editor

-- Tabla de precios públicos con mensualidades
create table if not exists public.product_prices (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid references public.productos(id) on delete cascade not null,
  public_price        numeric(12,2) not null,
  down_payment_percent numeric(5,2),
  down_payment_amount numeric(12,2),
  monthly_24          numeric(12,2),
  monthly_19          numeric(12,2),
  monthly_16          numeric(12,2),
  monthly_14          numeric(12,2),
  monthly_12          numeric(12,2),
  monthly_11          numeric(12,2),
  shipping_amount     numeric(12,2),
  handling_amount     numeric(12,2),
  effective_from      date default current_date,
  effective_to        date,
  is_active           boolean default true,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique(product_id, is_active, effective_from)
);

-- RLS
alter table public.product_prices enable row level security;

-- Políticas de lectura
create policy "product_prices_read_all" on public.product_prices
  for select to anon, authenticated using (is_active = true);

-- Grant
grant select on public.product_prices to anon;
grant select on public.product_prices to authenticated;

-- Agregar campos de status a productos si no existen
-- status: active | discontinued | replaced
alter table public.productos add column if not exists status text default 'active';
alter table public.productos add column if not exists replacement_product_id uuid references public.productos(id);
alter table public.productos add column if not exists legacy_code text;
alter table public.productos add column if not exists description_short text;
alter table public.productos add column if not exists description_long text;
alter table public.productos add column if not exists benefits text[];

-- Actualizar productos existentes con status basado en activo
update public.productos set status = case when activo = true then 'active' else 'discontinued' end where status is null or status = 'active';

-- View pública para catálogo (productos + precios)
create or replace view public.v_product_catalog as
select 
  p.id,
  p.codigo,
  p.legacy_code,
  p.nombre,
  p.categoria,
  p.categoria_principal,
  p.subcategoria,
  p.linea_producto,
  p.precio as base_price,
  p.foto_url,
  p.activo,
  p.status,
  p.replacement_product_id,
  p.description_short,
  p.description_long,
  p.benefits,
  pr.public_price,
  pr.down_payment_percent,
  pr.down_payment_amount,
  pr.monthly_24,
  pr.monthly_19,
  pr.monthly_16,
  pr.monthly_14,
  pr.monthly_12,
  pr.monthly_11,
  pr.shipping_amount,
  pr.handling_amount,
  pr.is_active as price_active
from public.productos p
left join lateral (
  select * from public.product_prices 
  where product_id = p.id and is_active = true 
  and (effective_from <= current_date or effective_from is null)
  and (effective_to >= current_date or effective_to is null)
  order by effective_from desc
  limit 1
) pr on true
where p.activo = true;

-- Grant para vista
grant select on public.v_product_catalog to anon;
grant select on public.v_product_catalog to authenticated;