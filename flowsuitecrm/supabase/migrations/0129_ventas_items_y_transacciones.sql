-- 0064_ventas_items_y_transacciones
-- Extiende la tabla ventas con campos financieros y crea tablas relacionadas

-- ============================================
-- CAMPOS NUEVOS EN LA TABLA VENTAS
-- ============================================

alter table public.ventas
  add column if not exists estado text default 'borrador',
  add column if not exists subtotal numeric(12,2) default 0,
  add column if not exists impuesto numeric(12,2) default 0,
  add column if not exists cargo_envio numeric(12,2) default 0,
  add column if not exists descuento numeric(12,2) default 0,
  add column if not exists total numeric(12,2) default 0,
  add column if not exists pago_inicial numeric(12,2) default 0,
  add column if not exists saldo_pendiente numeric(12,2) default 0,
  add column if not exists dir_facturacion_calle text,
  add column if not exists dir_facturacion_ciudad text,
  add column if not exists dir_facturacion_estado text,
  add column if not exists dir_facturacion_codigo_postal text,
  add column if not exists dir_facturacion_pais text default 'México',
  add column if not exists dir_envio_calle text,
  add column if not exists dir_envio_ciudad text,
  add column if not exists dir_envio_estado text,
  add column if not exists dir_envio_codigo_postal text,
  add column if not exists dir_envio_pais text default 'México',
  add column if not exists notas text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ventas_estado_check'
  ) then
    alter table public.ventas
      add constraint ventas_estado_check
      check (estado in ('borrador', 'confirmada', 'procesando', 'entregada', 'cancelada'));
  end if;
end $$;

-- ============================================
-- TABLA VENTA_ITEMS (LÍNEAS DE LA ORDEN)
-- ============================================

create table if not exists public.venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas(id) on delete cascade,
  linea int not null,
  producto_id uuid references public.productos(id) on delete set null,
  codigo_articulo text,
  descripcion text,
  cantidad numeric(10,2) not null default 1,
  precio_unitario numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists venta_items_venta_id_idx on public.venta_items (venta_id);
create index if not exists venta_items_linea_idx on public.venta_items (venta_id, linea);

-- ============================================
-- TABLA VENTA_TRANSACCIONES (HISTORIAL)
-- ============================================

create table if not exists public.venta_transacciones (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas(id) on delete cascade,
  fecha timestamptz not null default now(),
  descripcion text not null,
  cantidad numeric(12,2) not null,
  saldo numeric(12,2) default 0,
  created_at timestamptz not null default now()
);

create index if not exists venta_transacciones_venta_id_idx on public.venta_transacciones (venta_id);
create index if not exists venta_transacciones_fecha_idx on public.venta_transacciones (fecha);

-- ============================================
-- RLS PARA NUEVAS TABLAS
-- ============================================

alter table public.venta_items enable row level security;
alter table public.venta_transacciones enable row level security;

-- Heredar políticas de ventas
drop policy if exists venta_items_vendedor_access on public.venta_items;
create policy venta_items_vendedor_access on public.venta_items
  for all
  to authenticated
  using (
    exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id
        and (
          v.vendedor_id = auth.uid()
          or exists (
            select 1 from public.usuarios u
            where u.user_id = auth.uid()
              and u.rol in ('admin', 'supervisor', 'coordinador')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id
        and (
          v.vendedor_id = auth.uid()
          or exists (
            select 1 from public.usuarios u
            where u.user_id = auth.uid()
              and u.rol in ('admin', 'supervisor', 'coordinador')
          )
        )
    )
  );

drop policy if exists venta_transacciones_vendedor_access on public.venta_transacciones;
create policy venta_transacciones_vendedor_access on public.venta_transacciones
  for all
  to authenticated
  using (
    exists (
      select 1 from public.ventas v
      where v.id = venta_transacciones.venta_id
        and (
          v.vendedor_id = auth.uid()
          or exists (
            select 1 from public.usuarios u
            where u.user_id = auth.uid()
              and u.rol in ('admin', 'supervisor', 'coordinador')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.ventas v
      where v.id = venta_transacciones.venta_id
        and (
          v.vendedor_id = auth.uid()
          or exists (
            select 1 from public.usuarios u
            where u.user_id = auth.uid()
              and u.rol in ('admin', 'supervisor', 'coordinador')
          )
        )
    )
  );

-- ============================================
-- FUNCIONES UTILITARIAS
-- ============================================

-- Recalcular totales de una venta
create or replace function public.recalcular_venta_totales(p_venta_id uuid)
returns void
language plpgsql
as $$
declare
  v_subtotal numeric(12,2);
begin
  select coalesce(sum(subtotal), 0) into v_subtotal
  from public.venta_items
  where venta_id = p_venta_id;

  update public.ventas
  set subtotal = v_subtotal,
      total = v_subtotal + coalesce(impuesto, 0) + coalesce(cargo_envio, 0) - coalesce(descuento, 0),
      saldo_pendiente = (v_subtotal + coalesce(impuesto, 0) + coalesce(cargo_envio, 0) - coalesce(descuento, 0)) - coalesce(pago_inicial, 0),
      updated_at = now()
  where id = p_venta_id;
end;
$$;

-- Trigger para recalcular totales al modificar items
create or replace function public.venta_items_after_change_tg()
returns trigger
language plpgsql
as $$
begin
  perform public.recalcular_venta_totales(
    case when tg_op = 'DELETE' then old.venta_id else new.venta_id end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists venta_items_after_change_tg on public.venta_items;
create trigger venta_items_after_change_tg
after insert or update or delete
on public.venta_items
for each row
execute function public.venta_items_after_change_tg();

-- ============================================
-- ACTUALIZAR VENTAS EXISTENTES
-- ============================================

-- Migrar monto existente a subtotal y total para ventas sin items
update public.ventas
set subtotal = coalesce(monto, 0),
    total = coalesce(monto, 0),
    saldo_pendiente = coalesce(monto, 0)
where subtotal = 0 and total = 0;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

grant select, insert, update, delete on public.venta_items to authenticated;
grant select, insert, update, delete on public.venta_transacciones to authenticated;
grant usage on all sequences in schema public to authenticated;
