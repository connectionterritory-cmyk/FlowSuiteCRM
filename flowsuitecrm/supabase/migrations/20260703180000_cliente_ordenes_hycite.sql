-- Historial de ordenes de Hy-Cite por cliente (ficha maestra, NO cartera/cobranza).
-- Distinto del modulo `ventas` (pipeline interno de ventas del CRM): esto es un
-- espejo de lo que Hy-Cite reporta que el cliente pidio/recibio, con tracking UPS.

create table public.cliente_ordenes_hycite (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  cliente_id uuid not null references public.clientes(id),
  numero_orden_hycite text not null,
  fecha_orden date,
  metodo_entrega text,
  fecha_envio date,
  fecha_entrega date,
  numero_seguimiento text,
  estado_envio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, numero_orden_hycite)
);
create index cliente_ordenes_hycite_org_id_idx on public.cliente_ordenes_hycite (org_id);
create index cliente_ordenes_hycite_cliente_id_idx on public.cliente_ordenes_hycite (cliente_id);

create table public.cliente_orden_hycite_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  orden_id uuid not null references public.cliente_ordenes_hycite(id) on delete cascade,
  linea int,
  codigo_articulo text,
  descripcion text,
  cantidad_solicitada int,
  cantidad_enviada int,
  created_at timestamptz not null default now()
);
create index cliente_orden_hycite_items_orden_id_idx on public.cliente_orden_hycite_items (orden_id);
create index cliente_orden_hycite_items_org_id_idx on public.cliente_orden_hycite_items (org_id);

comment on table public.cliente_ordenes_hycite is
  'Espejo del historial de ordenes de Hy-Cite por cliente (ficha maestra, no cartera). Distinto del modulo ventas (pipeline interno de ventas del CRM).';
comment on table public.cliente_orden_hycite_items is
  'Lineas de articulo de cada orden en cliente_ordenes_hycite.';

alter table public.cliente_ordenes_hycite enable row level security;
alter table public.cliente_orden_hycite_items enable row level security;

-- Visibilidad: hereda el acceso que ya tiene el usuario sobre el cliente padre via RLS de clientes.
create policy cliente_ordenes_hycite_select on public.cliente_ordenes_hycite
  for select
  using (exists (select 1 from public.clientes c where c.id = cliente_ordenes_hycite.cliente_id));

create policy cliente_ordenes_hycite_admin_write on public.cliente_ordenes_hycite
  for all
  using (security.is_admin_or_distribuidor())
  with check (security.is_admin_or_distribuidor());

create policy cliente_orden_hycite_items_select on public.cliente_orden_hycite_items
  for select
  using (exists (
    select 1 from public.cliente_ordenes_hycite o
    join public.clientes c on c.id = o.cliente_id
    where o.id = cliente_orden_hycite_items.orden_id
  ));

create policy cliente_orden_hycite_items_admin_write on public.cliente_orden_hycite_items
  for all
  using (security.is_admin_or_distribuidor())
  with check (security.is_admin_or_distribuidor());
