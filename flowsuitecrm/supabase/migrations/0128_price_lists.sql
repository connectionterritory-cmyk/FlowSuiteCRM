-- Migración: Lista de Precios Pública
-- Ejecutar en Supabase SQL Editor

-- 1. Tabla de listas de precios versionadas
create table if not exists public.price_lists (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  vigente_desde   date not null,
  vigente_hasta   date,
  activo          boolean default true,
  created_at      timestamptz default now()
);

-- 2. Precios por lista (permite múltiples listas activas)
create table if not exists public.price_list_items (
  id              uuid primary key default gen_random_uuid(),
  price_list_id   uuid references public.price_lists(id) on delete cascade,
  producto_id     uuid references public.productos(id) on delete cascade,
  precio          numeric(12,2) not null,
  precio_promo    numeric(12,2),
  nota            text,
  unique(price_list_id, producto_id)
);

-- 3. RLS
alter table public.price_lists enable row level security;
alter table public.price_list_items enable row level security;

-- Políticas de lectura pública
create policy "price_lists_public_read" on public.price_lists
  for select to anon, authenticated using (activo = true);

create policy "price_list_items_public_read" on public.price_list_items
  for select to anon, authenticated using (true);

-- 4. Grant para anon
grant select on public.price_lists to anon;
grant select on public.price_list_items to anon;

-- 5. View pública de productos (ya existe v_productos_publicos)
-- Grant si no existe
-- grant select on public.v_productos_publicos to anon;