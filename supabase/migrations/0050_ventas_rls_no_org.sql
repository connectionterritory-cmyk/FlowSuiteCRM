-- ============================================================
-- 0046_ventas_rls_no_org.sql
-- Ventas RLS correction (ventas has no org_id column)
-- ============================================================

begin;

drop policy if exists ventas_admin_all on public.ventas;
drop policy if exists ventas_distribuidor_all on public.ventas;
drop policy if exists ventas_vendedor_all on public.ventas;
drop policy if exists ventas_supervisor_tele_read on public.ventas;
drop policy if exists ventas_tele_read on public.ventas;

create policy ventas_admin_all on public.ventas
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy ventas_distribuidor_all on public.ventas
  for all to authenticated
  using (public.is_distribuidor())
  with check (public.is_distribuidor());

create policy ventas_vendedor_all on public.ventas
  for all to authenticated
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.rol = 'vendedor'
    )
    and vendedor_id = auth.uid()
  )
  with check (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.rol = 'vendedor'
    )
    and vendedor_id = auth.uid()
  );

create policy ventas_supervisor_tele_read on public.ventas
  for select to authenticated
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.rol = 'supervisor_telemercadeo'
    )
  );

create policy ventas_tele_read on public.ventas
  for select to authenticated
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.rol = 'telemercadeo'
    )
    and exists (
      select 1
      from public.clientes c
      join public.tele_vendedor_assignments t on t.tele_id = auth.uid()
      where c.id = ventas.cliente_id
        and (t.vendedor_id = c.vendedor_id or t.vendedor_id = c.distribuidor_id)
    )
  );

commit;
