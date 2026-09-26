-- RP postventa fase 1. No crea citas ni servicios automáticos.
begin;

-- 1. RLS de tareas antes de exponer referencias postventa.
drop policy if exists crm_tareas_auth_read on public.crm_tareas;
drop policy if exists crm_tareas_auth_write on public.crm_tareas;
drop policy if exists ct_admin_all on public.crm_tareas;
drop policy if exists ct_distribuidor_all on public.crm_tareas;
drop policy if exists ct_insert_own on public.crm_tareas;
drop policy if exists ct_select_own on public.crm_tareas;
drop policy if exists ct_supervisor_tele_select on public.crm_tareas;
drop policy if exists ct_update_own on public.crm_tareas;

alter table public.crm_tareas enable row level security;

-- 2. Hechos externos y columnas postventa. No se backfillean vínculos.
alter table public.ventas
  add column estado_royal_one text,
  add column fecha_pedido_royal_one date,
  add column estado_royal_one_updated_at timestamptz,
  add column decision_financiera_externa text,
  add column decision_financiera_externa_at timestamptz,
  add column fuente_externa text,
  add constraint ventas_estado_royal_one_check check (estado_royal_one is null or estado_royal_one in ('draft','e_signature','invoiced','canceled')),
  add constraint ventas_decision_financiera_externa_check check (decision_financiera_externa is null or decision_financiera_externa in ('pendiente','aprobada','rechazada')),
  add constraint ventas_fuente_externa_check check (fuente_externa is null or fuente_externa in ('manual','royal_one_sync'));

alter table public.cliente_ordenes_hycite
  add column venta_id uuid references public.ventas(id),
  add column estado_entrega text not null default 'pendiente',
  add constraint cliente_ordenes_hycite_estado_entrega_check check (estado_entrega in ('pendiente','parcial','completa','legacy_no_derivable'));
create index cliente_ordenes_hycite_venta_id_idx on public.cliente_ordenes_hycite (venta_id) where venta_id is not null;

alter table public.crm_tareas
  alter column created_by drop not null,
  add column created_source text not null default 'user',
  add column created_source_ref text,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.usuarios(id),
  add column orden_hycite_id uuid references public.cliente_ordenes_hycite(id),
  add column venta_id uuid references public.ventas(id),
  add constraint crm_tareas_created_source_check check (created_source in ('user','system_sync')),
  add constraint crm_tareas_created_source_actor_check check ((created_source = 'user' and created_by is not null and created_source_ref is null) or (created_source = 'system_sync' and created_by is null and created_source_ref is not null)),
  add constraint crm_tareas_soft_delete_actor_check check ((deleted_at is null and deleted_by is null) or (deleted_at is not null and deleted_by is not null)),
  add constraint crm_tareas_servicio_pendiente_row_check check (tipo <> 'servicio_pendiente' or (contacto_tipo = 'cliente' and orden_hycite_id is not null));

-- El catálogo final conserva los tipos de seguros ya existentes, las opciones
-- humanas vigentes del frontend y servicio_pendiente.
do $$
begin
  if exists (
    select 1
    from public.crm_tareas
    where tipo not in ('llamada','visita','enviar_material','reagendar_cita','seguimiento','cobro','renovacion_poliza','recordatorio_pago','otro','servicio_pendiente')
  ) then
    raise exception 'crm_tareas contiene tipos fuera del catálogo final';
  end if;
end;
$$;

alter table public.crm_tareas
  drop constraint if exists crm_tareas_tipo_check;

alter table public.crm_tareas
  add constraint crm_tareas_tipo_check check (tipo in ('llamada','visita','enviar_material','reagendar_cita','seguimiento','cobro','renovacion_poliza','recordatorio_pago','otro','servicio_pendiente'));
create index crm_tareas_org_active_idx on public.crm_tareas (org_id, asignado_a, fecha_vencimiento) where deleted_at is null;
create unique index crm_tareas_servicio_pendiente_orden_uq on public.crm_tareas (orden_hycite_id) where tipo = 'servicio_pendiente';

create policy ct_admin_org_all on public.crm_tareas for all to authenticated using (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin()) with check (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin());
create policy ct_distribuidor_org_read on public.crm_tareas for select to authenticated using (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_distribuidor() and deleted_at is null and (asignado_a = auth.uid() or created_by = auth.uid() or exists (select 1 from public.clientes c where contacto_tipo = 'cliente' and c.id = contacto_id and c.org_id = crm_tareas.org_id and (c.distribuidor_id = auth.uid() or c.vendedor_id = auth.uid() or public.is_distribuidor_of(c.vendedor_id)))));
create policy ct_distribuidor_org_update on public.crm_tareas for update to authenticated using (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_distribuidor() and deleted_at is null) with check (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_distribuidor());
create policy ct_owner_read on public.crm_tareas for select to authenticated using (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and deleted_at is null and (asignado_a = auth.uid() or created_by = auth.uid()));
create policy ct_owner_update on public.crm_tareas for update to authenticated using (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and deleted_at is null and (asignado_a = auth.uid() or created_by = auth.uid())) with check (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and (asignado_a = auth.uid() or created_by = auth.uid()));
create policy ct_user_insert on public.crm_tareas for insert to authenticated with check (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and created_source = 'user' and created_by = auth.uid());
create policy ct_supervisor_org_read on public.crm_tareas for select to authenticated using (org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_supervisor_tele() and deleted_at is null);

create table public.cliente_orden_hycite_paquetes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  orden_id uuid not null references public.cliente_ordenes_hycite(id) on delete cascade,
  numero_paquete text not null, numero_seguimiento text, carrier text,
  estado_paquete text not null default 'pendiente', fecha_envio timestamptz, fecha_entrega timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint cliente_orden_hycite_paquetes_numero_uq unique (orden_id, numero_paquete),
  constraint cliente_orden_hycite_paquetes_estado_check check (estado_paquete in ('pendiente','preparando','enviado','en_transito','entregado','incidencia','devuelto','cancelado')),
  constraint cliente_orden_hycite_paquetes_numero_check check (btrim(numero_paquete) ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  constraint cliente_orden_hycite_paquetes_tracking_check check (numero_seguimiento is null or btrim(numero_seguimiento) ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$')
);
create index cliente_orden_hycite_paquetes_orden_id_idx on public.cliente_orden_hycite_paquetes (orden_id);
alter table public.cliente_orden_hycite_paquetes enable row level security;

-- Sustituir RLS permisiva de órdenes/ítems; paquetes heredan visibilidad del padre.
drop policy if exists cliente_ordenes_hycite_select on public.cliente_ordenes_hycite;
drop policy if exists cliente_ordenes_hycite_admin_write on public.cliente_ordenes_hycite;
drop policy if exists cliente_orden_hycite_items_select on public.cliente_orden_hycite_items;
drop policy if exists cliente_orden_hycite_items_admin_write on public.cliente_orden_hycite_items;
create policy coh_select_visible_client on public.cliente_ordenes_hycite for select to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and exists (select 1 from public.clientes c where c.id = cliente_ordenes_hycite.cliente_id and c.org_id = cliente_ordenes_hycite.org_id)
);
create policy coh_admin_distribuidor_write on public.cliente_ordenes_hycite for all to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin_or_distribuidor()
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin_or_distribuidor()
  and exists (select 1 from public.clientes c where c.id = cliente_ordenes_hycite.cliente_id and c.org_id = cliente_ordenes_hycite.org_id)
);
create policy cohi_select_via_parent on public.cliente_orden_hycite_items for select to authenticated using (
  exists (select 1 from public.cliente_ordenes_hycite o where o.id = cliente_orden_hycite_items.orden_id and o.org_id = cliente_orden_hycite_items.org_id)
);
create policy cohi_admin_distribuidor_write on public.cliente_orden_hycite_items for all to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin_or_distribuidor()
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin_or_distribuidor()
  and exists (select 1 from public.cliente_ordenes_hycite o where o.id = cliente_orden_hycite_items.orden_id and o.org_id = cliente_orden_hycite_items.org_id)
);
create policy cohp_select_via_parent on public.cliente_orden_hycite_paquetes for select to authenticated using (
  exists (select 1 from public.cliente_ordenes_hycite o where o.id = cliente_orden_hycite_paquetes.orden_id and o.org_id = cliente_orden_hycite_paquetes.org_id)
);
create policy cohp_admin_distribuidor_write on public.cliente_orden_hycite_paquetes for all to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin_or_distribuidor()
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin_or_distribuidor()
  and exists (select 1 from public.cliente_ordenes_hycite o where o.id = cliente_orden_hycite_paquetes.orden_id and o.org_id = cliente_orden_hycite_paquetes.org_id)
);

create or replace function public.fn_validar_integridad_postventa_rp() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_orden record; v_venta record; v_actor_org uuid;
begin
  if TG_TABLE_NAME = 'cliente_ordenes_hycite' and TG_OP = 'DELETE' then raise exception 'las órdenes Hy-Cite no admiten hard delete'; end if;
  if TG_TABLE_NAME = 'cliente_orden_hycite_paquetes' then
    select * into v_orden from public.cliente_ordenes_hycite where id = NEW.orden_id for update;
    if not found or v_orden.org_id <> NEW.org_id then raise exception 'paquete.org_id difiere de orden.org_id'; end if;
  elsif TG_TABLE_NAME = 'cliente_ordenes_hycite' and NEW.venta_id is not null then
    if current_user in ('authenticated', 'anon') and (TG_OP = 'INSERT' or OLD.venta_id is distinct from NEW.venta_id) then raise exception 'use fn_vincular_venta_orden_hycite para vincular una venta'; end if;
    select * into v_venta from public.ventas where id = NEW.venta_id for update;
    if not found or v_venta.org_id is distinct from NEW.org_id or v_venta.cliente_id is distinct from NEW.cliente_id then raise exception 'venta no coincide con organización o cliente de orden'; end if;
    if TG_OP = 'UPDATE' and OLD.venta_id is not null and OLD.venta_id is distinct from NEW.venta_id then raise exception 'orden ya vinculada: desvinculación/corrección requiere acción explícita'; end if;
  elsif TG_TABLE_NAME = 'crm_tareas' then
    -- BEFORE ROW se ejecuta antes de RLS WITH CHECK: completar el tenant de
    -- una tarea humana antes de que ct_user_insert compare org_id.
    if TG_OP = 'INSERT' and NEW.created_source = 'user' and NEW.org_id is null then
      select org_id into v_actor_org from public.usuarios where id = auth.uid() and activo is true;
      if v_actor_org is null then raise exception 'tarea user requiere org_id resoluble desde el usuario autenticado'; end if;
      NEW.org_id := v_actor_org;
    end if;
    if TG_OP = 'INSERT' and NEW.created_source = 'user' and NEW.org_id is null then
      raise exception 'tarea user requiere org_id';
    end if;
    if NEW.tipo = 'servicio_pendiente' then
      select * into v_orden from public.cliente_ordenes_hycite where id = NEW.orden_hycite_id for update;
      if NEW.contacto_tipo <> 'cliente' or not found or NEW.org_id is distinct from v_orden.org_id or NEW.contacto_id is distinct from v_orden.cliente_id or (NEW.venta_id is not null and NEW.venta_id is distinct from v_orden.venta_id) then raise exception 'tarea servicio_pendiente inconsistente con orden'; end if;
    end if;
    if TG_OP = 'UPDATE' and NEW.deleted_at is not null and OLD.deleted_at is null then
      select org_id into v_actor_org from public.usuarios where id = auth.uid() and activo is true;
      if not public.is_admin() or v_actor_org is distinct from NEW.org_id then raise exception 'soft-delete requiere admin de misma org'; end if;
      NEW.deleted_by := auth.uid();
    end if;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end; $$;

create trigger trg_validar_paquetes_cross before insert or update on public.cliente_orden_hycite_paquetes for each row execute function public.fn_validar_integridad_postventa_rp();
create trigger trg_validar_ordenes_cross before insert or update or delete on public.cliente_ordenes_hycite for each row execute function public.fn_validar_integridad_postventa_rp();
create trigger trg_validar_tareas_cross before insert or update on public.crm_tareas for each row execute function public.fn_validar_integridad_postventa_rp();

create or replace function public.fn_derivar_entrega_y_servicio_paquetes() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_orden record; v_total int; v_entregados int; v_nuevo text; v_anterior text; v_responsable uuid; v_timezone text; v_fecha date; v_completion_at timestamptz := now();
begin
  select * into v_orden from public.cliente_ordenes_hycite where id = case when TG_OP = 'DELETE' then OLD.orden_id else NEW.orden_id end for update;
  if not found then return null; end if;
  select count(*), count(*) filter (where estado_paquete = 'entregado') into v_total, v_entregados from public.cliente_orden_hycite_paquetes where orden_id = v_orden.id;
  if v_total = 0 or v_entregados = 0 then v_nuevo := 'pendiente'; elsif v_entregados = v_total then v_nuevo := 'completa'; else v_nuevo := 'parcial'; end if;
  v_anterior := v_orden.estado_entrega;
  if v_nuevo is distinct from v_anterior then update public.cliente_ordenes_hycite set estado_entrega = v_nuevo, updated_at = now() where id = v_orden.id; end if;
  if v_anterior is distinct from 'completa' and v_nuevo = 'completa' then
    select u.id into v_responsable from public.ventas v join public.usuarios u on u.id = v.vendedor_id and u.org_id = v_orden.org_id and u.activo where v.id = v_orden.venta_id;
    if v_responsable is null then select u.id into v_responsable from public.clientes c join public.usuarios u on u.id = c.vendedor_id and u.org_id = v_orden.org_id and u.activo where c.id = v_orden.cliente_id; end if;
    if v_responsable is null then select u.id into v_responsable from public.clientes c join public.usuarios u on u.id = c.distribuidor_id and u.org_id = v_orden.org_id and u.activo where c.id = v_orden.cliente_id; end if;
    if v_responsable is null then select id into v_responsable from public.usuarios where org_id = v_orden.org_id and activo and rol = 'admin' order by created_at, id limit 1; end if;
    if v_responsable is null then update public.clientes set next_action = 'Asignar responsable para servicio', next_action_date = current_date, updated_at = now() where id = v_orden.cliente_id;
    else
      select coalesce(timezone, 'UTC') into v_timezone from public.usuarios where id = v_responsable;
      v_fecha := ((v_completion_at at time zone v_timezone) + interval '2 days')::date;
      begin
        insert into public.crm_tareas (org_id,tipo,contacto_tipo,contacto_id,orden_hycite_id,venta_id,asignado_a,estado,fecha_vencimiento,hora_vencimiento,descripcion,created_by,created_source,created_source_ref,created_at,updated_at)
        values (v_orden.org_id,'servicio_pendiente','cliente',v_orden.cliente_id,v_orden.id,v_orden.venta_id,v_responsable,'pendiente',v_fecha,null,'Entrega completa confirmada para orden Hy-Cite ' || v_orden.numero_orden_hycite || '. Contactar para coordinar servicio.',null,'system_sync','hycite',now(),now());
        update public.clientes set next_action = 'Contactar para coordinar servicio', next_action_date = v_fecha, updated_at = now() where id = v_orden.cliente_id;
      exception when unique_violation then null;
      end;
    end if;
  end if;
  return null;
end; $$;
create trigger trg_derivar_entrega_servicio_paquetes after insert or update or delete on public.cliente_orden_hycite_paquetes for each row execute function public.fn_derivar_entrega_y_servicio_paquetes();

create or replace function public.fn_vincular_venta_orden_hycite(p_orden_id uuid, p_venta_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_orden record; v_venta record; v_actor uuid := auth.uid(); v_org uuid;
begin
  if v_actor is null then raise exception 'usuario no autenticado'; end if;
  select * into v_orden from public.cliente_ordenes_hycite where id = p_orden_id for update;
  select * into v_venta from public.ventas where id = p_venta_id for update;
  select org_id into v_org from public.usuarios where id = v_actor and activo;
  if not found or v_orden.org_id is distinct from v_org or v_venta.org_id is distinct from v_org or v_orden.cliente_id is distinct from v_venta.cliente_id or v_orden.cliente_id is null then raise exception 'orden/venta no autorizada o inconsistente'; end if;
  if v_orden.venta_id is not null and v_orden.venta_id is distinct from p_venta_id then raise exception 'orden ya vinculada a otra venta'; end if;
  if coalesce(trim(v_orden.numero_orden_hycite),'') = '' or coalesce(trim(v_venta.numero_nota_pedido),'') = '' or upper(trim(v_orden.numero_orden_hycite)) like 'TEST-%' or upper(trim(v_venta.numero_nota_pedido)) like 'TEST-%' or upper(trim(v_orden.numero_orden_hycite)) = 'HY-CITE-001' or upper(trim(v_venta.numero_nota_pedido)) = 'HY-CITE-001' then raise exception 'identificador externo inválido'; end if;
  if not exists (select 1 from public.clientes c where c.id = v_orden.cliente_id and c.org_id = v_org and (c.distribuidor_id = v_actor or c.vendedor_id = v_actor or public.is_admin_or_distribuidor())) then raise exception 'sin autorización'; end if;
  update public.cliente_ordenes_hycite set venta_id = p_venta_id, updated_at = now() where id = p_orden_id;
end; $$;

create or replace function public.fn_upsert_paquete_hycite(p_orden_id uuid, p_numero_paquete text, p_estado_paquete text, p_numero_seguimiento text default null, p_carrier text default null, p_fecha_envio timestamptz default null, p_fecha_entrega timestamptz default null) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_orden record; v_id uuid; v_actor uuid := auth.uid(); v_org uuid;
begin
  select org_id into v_org from public.usuarios where id = v_actor and activo;
  if v_actor is null or v_org is null or not public.is_admin_or_distribuidor() then raise exception 'sin autorización'; end if;
  if p_numero_paquete is null or trim(p_numero_paquete) = '' or trim(p_numero_paquete) !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' or upper(trim(p_numero_paquete)) like 'TEST-%' or upper(trim(p_numero_paquete)) = 'HY-CITE-001' then raise exception 'numero_paquete inválido'; end if;
  if p_numero_seguimiento is not null and (trim(p_numero_seguimiento) !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$' or upper(trim(p_numero_seguimiento)) like 'TEST-%' or upper(trim(p_numero_seguimiento)) = 'HY-CITE-001') then raise exception 'numero_seguimiento inválido'; end if;
  select * into v_orden from public.cliente_ordenes_hycite where id = p_orden_id for update;
  if not found or v_orden.org_id is distinct from v_org then raise exception 'orden no autorizada'; end if;
  insert into public.cliente_orden_hycite_paquetes (org_id,orden_id,numero_paquete,numero_seguimiento,carrier,estado_paquete,fecha_envio,fecha_entrega) values (v_orden.org_id,p_orden_id,trim(p_numero_paquete),nullif(trim(p_numero_seguimiento),''),nullif(trim(p_carrier),''),p_estado_paquete,p_fecha_envio,p_fecha_entrega)
  on conflict (orden_id,numero_paquete) do update set numero_seguimiento=excluded.numero_seguimiento, carrier=excluded.carrier, estado_paquete=excluded.estado_paquete, fecha_envio=excluded.fecha_envio, fecha_entrega=excluded.fecha_entrega, updated_at=now() returning id into v_id;
  return v_id;
end; $$;

-- Las órdenes existentes son snapshots legacy: no se inventan paquetes ni tareas.
update public.cliente_ordenes_hycite o set estado_entrega = 'legacy_no_derivable' where not exists (select 1 from public.cliente_orden_hycite_paquetes p where p.orden_id = o.id);

revoke all on function public.fn_vincular_venta_orden_hycite(uuid,uuid) from public, anon;
revoke all on function public.fn_upsert_paquete_hycite(uuid,text,text,text,text,timestamptz,timestamptz) from public, anon;
grant execute on function public.fn_vincular_venta_orden_hycite(uuid,uuid) to authenticated;
grant execute on function public.fn_upsert_paquete_hycite(uuid,text,text,text,text,timestamptz,timestamptz) to authenticated;
commit;
