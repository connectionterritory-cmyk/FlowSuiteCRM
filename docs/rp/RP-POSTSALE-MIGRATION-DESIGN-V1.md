# RP Post-sale migration design V1 (no ejecutar)

## Alcance

Diseño para reflejar hechos Royal One/Hy-Cite, paquetes, entrega derivada y
una tarea idempotente de servicio pendiente. FlowSuiteCRM no origina pedidos,
no simula decisiones financieras y no crea citas ni servicios automáticamente.

Este documento es especificación DDL/RLS; no es una migración ejecutable ni
autoriza cambios en la DB.

## A. DDL propuesto

Usar columnas `text` con `check`, no `ALTER TYPE`, para aislar el riesgo de
estados operativos nuevos.

```sql
-- 1. Contexto externo de la venta CRM.
alter table public.ventas
  add column estado_royal_one text,
  add column fecha_pedido_royal_one date,
  add column estado_royal_one_updated_at timestamptz,
  add column decision_financiera_externa text,
  add column decision_financiera_externa_at timestamptz,
  add column fuente_externa text;

alter table public.ventas
  add constraint ventas_estado_royal_one_check check (
    estado_royal_one is null or estado_royal_one in
      ('draft', 'e_signature', 'invoiced', 'canceled')
  ),
  add constraint ventas_decision_financiera_externa_check check (
    decision_financiera_externa is null or decision_financiera_externa in
      ('pendiente', 'aprobada', 'rechazada')
  ),
  add constraint ventas_fuente_externa_check check (
    fuente_externa is null or fuente_externa in ('manual', 'royal_one_sync')
  );

-- 2. Orden Hy-Cite: vínculo humano y cache de fulfillment.
alter table public.cliente_ordenes_hycite
  add column venta_id uuid references public.ventas(id),
  add column estado_entrega text not null default 'pendiente';

alter table public.cliente_ordenes_hycite
  add constraint cliente_ordenes_hycite_estado_entrega_check check (
    estado_entrega in ('pendiente', 'parcial', 'completa', 'legacy_no_derivable')
  );

create index cliente_ordenes_hycite_venta_id_idx
  on public.cliente_ordenes_hycite (venta_id)
  where venta_id is not null;

-- 3. Paquetes: fuente de verdad de tracking y entrega.
create table public.cliente_orden_hycite_paquetes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  orden_id uuid not null references public.cliente_ordenes_hycite(id) on delete cascade,
  numero_paquete text not null,
  numero_seguimiento text,
  carrier text,
  estado_paquete text not null default 'pendiente',
  fecha_envio timestamptz,
  fecha_entrega timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cliente_orden_hycite_paquetes_numero_uq unique (orden_id, numero_paquete),
  constraint cliente_orden_hycite_paquetes_estado_check check (
    estado_paquete in ('pendiente', 'preparando', 'enviado', 'en_transito',
      'entregado', 'incidencia', 'devuelto', 'cancelado')
  ),
  constraint cliente_orden_hycite_paquetes_numero_check check (
    btrim(numero_paquete) ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'
  ),
  constraint cliente_orden_hycite_paquetes_tracking_check check (
    numero_seguimiento is null or
    btrim(numero_seguimiento) ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
  )
);

create index cliente_orden_hycite_paquetes_orden_id_idx
  on public.cliente_orden_hycite_paquetes (orden_id);

-- 4. Tareas: aislamiento org, origen explícito y soft-delete.
alter table public.crm_tareas
  alter column created_by drop not null,
  add column org_id uuid,
  add column created_source text not null default 'user',
  add column created_source_ref text,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.usuarios(id),
  add column orden_hycite_id uuid references public.cliente_ordenes_hycite(id),
  add column venta_id uuid references public.ventas(id);

alter table public.crm_tareas
  add constraint crm_tareas_created_source_check check (
    created_source in ('user', 'system_sync')
  ),
  add constraint crm_tareas_created_source_actor_check check (
    (created_source = 'user' and created_by is not null and created_source_ref is null)
    or
    (created_source = 'system_sync' and created_by is null and created_source_ref is not null)
  ),
  add constraint crm_tareas_soft_delete_actor_check check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null and deleted_by is not null)
  ),
  add constraint crm_tareas_servicio_pendiente_row_check check (
    tipo <> 'servicio_pendiente'
    or (contacto_tipo = 'cliente' and orden_hycite_id is not null)
  );

-- El modelo de provenance requiere que este orden se respete: primero
-- DROP NOT NULL de created_by y después crm_tareas_created_source_actor_check.
-- Para created_source = 'user', created_by sigue siendo obligatorio; para
-- system_sync, created_by debe ser null y created_source_ref no puede ser null.

-- REEMPLAZAR CHECK EN crm_tareas.tipo conservando el catálogo existente:
-- Valores históricos observados: 'llamada', 'seguimiento'.
-- Catálogo final confirmado: tipos actuales de producción, todas las opciones
-- humanas vigentes del frontend y 'servicio_pendiente'. Validar que no haya
-- filas fuera de esta lista antes de instalar o reemplazar el CHECK.
-- SELECT DISTINCT tipo FROM public.crm_tareas ORDER BY 1;
-- ALTER TABLE public.crm_tareas
--   DROP CONSTRAINT IF EXISTS crm_tareas_tipo_check;
-- ALTER TABLE public.crm_tareas
--   ADD CONSTRAINT crm_tareas_tipo_check CHECK (
--     tipo IN ('llamada', 'seguimiento', 'visita', 'enviar_material',
--              'reagendar_cita', 'cobro', 'renovacion_poliza',
--              'recordatorio_pago', 'otro', 'servicio_pendiente')
--   );

create index crm_tareas_org_active_idx
  on public.crm_tareas (org_id, asignado_a, fecha_vencimiento)
  where deleted_at is null;

-- Una sola tarea para toda la vida de una orden, incluso si ya fue completada.
create unique index crm_tareas_servicio_pendiente_orden_uq
  on public.crm_tareas (orden_hycite_id)
  where tipo = 'servicio_pendiente';
```

`ventas.numero_nota_pedido` y `cliente_ordenes_hycite.numero_orden_hycite`
mantienen su tipo actual. La validación de formato se aplica en RPC/importador,
no como `check` retroactivo, para preservar los datos legacy.

## B. Constraints, FKs, checks e índices adicionales

Una función trigger común debe rechazar en servidor:

1. paquete cuyo `org_id` difiera del de su orden;
2. `venta_id` cuyo `org_id` o `cliente_id` difiera de la orden;
3. tarea `servicio_pendiente` cuyo `org_id`, `contacto_id`, `venta_id` u orden
   no coincidan entre sí;
4. identificadores externos de automatización que sean nulos, vacíos, `TEST-*`,
   `HY-CITE-*` o fuera de patrón;
5. soft-delete por usuario distinto de admin de la misma organización.

Las igualdades entre tablas no se implementan con `CHECK`; se validan mediante
función trigger transaccional. `created_source = 'system_sync'` permite
`created_by = null` y exige, por ejemplo, `created_source_ref = 'hycite'`.

### Función trigger de validación cruzada

```sql
create or replace function public.fn_validar_integridad_postventa_rp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden record;
  v_venta record;
  v_cliente record;
  v_actor_org uuid;
begin
  -- Validación según tabla afectada
  case TG_TABLE_NAME
  when 'cliente_orden_hycite_paquetes' then
    -- 1. paquete.org_id = orden.org_id
    select * into v_orden from public.cliente_ordenes_hycite
    where id = NEW.orden_id
    for update;  -- bloqueo para concurrencia
    if v_orden.org_id <> NEW.org_id then
      raise exception 'paquete.org_id difiere de orden.org_id';
    end if;

  when 'cliente_ordenes_hycite' then
    -- 2. venta_id.org_id = orden.org_id y venta_id.cliente_id = orden.cliente_id
    if NEW.venta_id is not null then
      select * into v_venta from public.ventas where id = NEW.venta_id;
      if v_venta.org_id <> NEW.org_id then
        raise exception 'venta.org_id difiere de orden.org_id';
      end if;
      if v_venta.cliente_id <> NEW.cliente_id then
        raise exception 'venta.cliente_id difiere de orden.cliente_id';
      end if;
    end if;

  when 'crm_tareas' then
    -- En INSERT humano, este BEFORE ROW deriva org_id antes de que RLS
    -- WITH CHECK evalúe ct_user_insert.
    if TG_OP = 'INSERT' and NEW.created_source = 'user' and NEW.org_id is null then
      select org_id into v_actor_org
      from public.usuarios
      where id = auth.uid() and activo is true;
      if v_actor_org is null then
        raise exception 'tarea user requiere org_id resoluble desde el usuario autenticado';
      end if;
      NEW.org_id := v_actor_org;
    end if;
    if TG_OP = 'INSERT' and NEW.created_source = 'user' and NEW.org_id is null then
      raise exception 'tarea user requiere org_id';
    end if;

    -- 3. tarea servicio_pendiente: integridad org, contacto, venta, orden
    if NEW.tipo = 'servicio_pendiente' then
      if NEW.contacto_tipo <> 'cliente' then
        raise exception 'servicio_pendiente requiere contacto_tipo = cliente';
      end if;
      if NEW.orden_hycite_id is null then
        raise exception 'servicio_pendiente requiere orden_hycite_id';
      end if;
      select * into v_orden from public.cliente_ordenes_hycite
      where id = NEW.orden_hycite_id;
      if v_orden.org_id <> NEW.org_id then
        raise exception 'tarea.org_id difiere de orden.org_id';
      end if;
      if v_orden.cliente_id <> NEW.contacto_id then
        raise exception 'tarea.contacto_id difiere de orden.cliente_id';
      end if;
      if NEW.venta_id is not null then
        select * into v_venta from public.ventas where id = NEW.venta_id;
        if v_venta.id <> v_orden.venta_id then
          raise exception 'tarea.venta_id no coincide con orden.venta_id';
        end if;
      end if;
    end if;

    -- 4. identificadores externos en automatización
    if NEW.created_source = 'system_sync' then
      if NEW.created_source_ref is null or NEW.created_source_ref = '' then
        raise exception 'system_sync requiere created_source_ref';
      end if;
      if NEW.created_by is not null then
        raise exception 'system_sync no permite created_by';
      end if;
      -- Validar patrón de número externo si aplica
      if NEW.tipo = 'servicio_pendiente' and NEW.descripcion is not null then
        -- La validación de patrón de número de orden/paquete se hace en RPC de importación
        null;
      end if;
    end if;

    -- 5. soft-delete solo admin misma org
    if NEW.deleted_at is not null and OLD.deleted_at is null then
      if not public.is_admin() then
        raise exception 'soft-delete requiere admin';
      end if;
      if NEW.org_id <> (select org_id from public.usuarios where id = auth.uid() and activo is true) then
        raise exception 'soft-delete solo admin de misma org';
      end if;
      NEW.deleted_by := auth.uid();
    end if;
  end case;

  return NEW;
end;
$$;

-- Triggers de validación
create trigger trg_validar_paquetes_cross
  before insert or update on public.cliente_orden_hycite_paquetes
  for each row execute function public.fn_validar_integridad_postventa_rp();

create trigger trg_validar_ordenes_cross
  before insert or update on public.cliente_ordenes_hycite
  for each row execute function public.fn_validar_integridad_postventa_rp();

create trigger trg_validar_tareas_cross
  before insert or update on public.crm_tareas
  for each row execute function public.fn_validar_integridad_postventa_rp();
```

## C. RLS exacta propuesta

Utilizar helpers `public.*` confirmados y versionados. No crear ni depender de
`security.current_org_id()`, `security.current_user_role()` ni otros helpers
no versionados en migraciones. Derivar `org_id` del usuario autenticado mediante
consulta directa a `public.usuarios` (id = auth.uid()).

### Órdenes e ítems

Eliminar las políticas actuales de `cliente_ordenes_hycite` y de
`cliente_orden_hycite_items`. Crear:

```sql
create policy coh_select_visible_client on public.cliente_ordenes_hycite
for select to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and exists (
    select 1 from public.clientes c
    where c.id = cliente_ordenes_hycite.cliente_id
      and c.org_id = cliente_ordenes_hycite.org_id
  )
);

create policy coh_admin_distribuidor_write on public.cliente_ordenes_hycite
for all to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and public.is_admin_or_distribuidor()
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and public.is_admin_or_distribuidor()
  and exists (
    select 1 from public.clientes c
    where c.id = cliente_ordenes_hycite.cliente_id
      and c.org_id = cliente_ordenes_hycite.org_id
  )
);

create policy cohi_select_via_parent on public.cliente_orden_hycite_items
for select to authenticated using (
  exists (
    select 1 from public.cliente_ordenes_hycite o
    where o.id = cliente_orden_hycite_items.orden_id
      and o.org_id = cliente_orden_hycite_items.org_id
  )
);

create policy cohi_admin_distribuidor_write on public.cliente_orden_hycite_items
for all to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and public.is_admin_or_distribuidor()
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and public.is_admin_or_distribuidor()
  and exists (
    select 1 from public.cliente_ordenes_hycite o
    where o.id = cliente_orden_hycite_items.orden_id and o.org_id = cliente_orden_hycite_items.org_id
  )
);
```

The parent subquery is evaluated under the caller's RLS, so it inherits client
visibility. The write trigger remains required because a policy alone cannot
prove cross-table integrity on all mutation paths.

### Paquetes

```sql
alter table public.cliente_orden_hycite_paquetes enable row level security;

create policy cohp_select_via_parent on public.cliente_orden_hycite_paquetes
for select to authenticated using (
  exists (
    select 1 from public.cliente_ordenes_hycite o
    where o.id = cliente_orden_hycite_paquetes.orden_id
      and o.org_id = cliente_orden_hycite_paquetes.org_id
  )
);

create policy cohp_admin_distribuidor_write on public.cliente_orden_hycite_paquetes
for all to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and public.is_admin_or_distribuidor()
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and public.is_admin_or_distribuidor()
  and exists (
    select 1 from public.cliente_ordenes_hycite o
    where o.id = cliente_orden_hycite_paquetes.orden_id
      and o.org_id = cliente_orden_hycite_paquetes.org_id
  )
);
```

### CRM tareas

Eliminar todas las políticas actuales, en particular las dos políticas
`USING (true)`. Las tareas con `org_id is null` no satisfacen ninguna política
normal y quedan invisibles hasta revisión manual.

```sql
create policy ct_admin_org_all on public.crm_tareas
for all to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin()
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_admin()
);

create policy ct_distribuidor_org_read_update on public.crm_tareas
for select to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and public.is_distribuidor()
  and deleted_at is null
  and (asignado_a = auth.uid() or created_by = auth.uid()
    or exists (
      select 1 from public.clientes c
      where contacto_tipo = 'cliente' and c.id = contacto_id and c.org_id = crm_tareas.org_id
        and (c.distribuidor_id = auth.uid() or c.vendedor_id = auth.uid() or public.is_distribuidor_of(c.vendedor_id))
    ))
);

create policy ct_distribuidor_org_update on public.crm_tareas
for update to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_distribuidor()
  and deleted_at is null
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_distribuidor()
);

create policy ct_owner_read on public.crm_tareas
for select to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and deleted_at is null
  and (asignado_a = auth.uid() or created_by = auth.uid())
);

create policy ct_owner_update on public.crm_tareas
for update to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and deleted_at is null
  and (asignado_a = auth.uid() or created_by = auth.uid())
) with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and (asignado_a = auth.uid() or created_by = auth.uid())
);

create policy ct_user_insert on public.crm_tareas
for insert to authenticated with check (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true)
  and created_source = 'user' and created_by = auth.uid()
);

create policy ct_supervisor_org_read on public.crm_tareas
for select to authenticated using (
  org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() and u.activo is true) and public.is_supervisor_tele() and deleted_at is null
);
```

No crear policy `DELETE`. El soft-delete se realiza solo en una RPC que exige
admin de misma org, escribe `deleted_at`, `deleted_by = auth.uid()` y conserva
la fila. La creación `system_sync`, los triggers y el vínculo humano son RPCs
privadas; no se exponen mediante una policy directa al cliente.

**Nota**: Se usan helpers canónicos `public.is_admin_or_distribuidor()`,
`public.is_supervisor_tele()`, `public.is_distribuidor_of()` (ya existentes en
producción). No se usan `security.*` ni helpers no versionados en migraciones.
El `org_id` se deriva mediante consulta directa a `public.usuarios` (id = auth.uid() and activo is true).

## Orden de migración para provenance de tareas

Antes de agregar `crm_tareas_created_source_actor_check`, ejecutar
`ALTER TABLE public.crm_tareas ALTER COLUMN created_by DROP NOT NULL`.
Así se preserva el contrato: tareas `user` requieren `created_by`, mientras
que tareas `system_sync` requieren `created_by = null` y
`created_source_ref` no nulo.

## D. Backfill seguro de `crm_tareas.org_id`

1. Clasificar en una tabla temporal de auditoría, sin escribir producción:
   `deterministic`, `ambiguous`, `conflict`.
2. `deterministic`: exactamente una organización coincidente entre asignado,
   creador y contacto existente; actualizar solo estas filas.
3. `ambiguous`: creador/contacto ausente, más de una organización posible o
   evidencia incompleta; dejar `org_id = null`.
4. `conflict`: fuentes existentes indican organizaciones distintas; dejar
   `org_id = null`, no escoger una.
5. Publicar listado de revisión manual con `id`, evidencia disponible y
   candidato; la corrección se hace mediante una acción administrativa
   auditada.
6. Tras revisión total, evaluar `alter column org_id set not null` en una
   migración posterior y separada.

## E. RPC de vínculo humano venta–orden

`public.fn_vincular_venta_orden_hycite(p_orden_id uuid, p_venta_id uuid)`:

1. Exige usuario autenticado y autorización de escritura de orden/venta.
2. Bloquea las dos filas (`FOR UPDATE`).
3. Valida org y cliente iguales, y que identificadores externos sean válidos.
4. Nunca deriva el vínculo del número: la UI debe enviar ambos IDs luego de
   confirmación humana.
5. **RE-LINK**: si `orden.venta_id` ya apunta a otra venta distinta: `ERROR`.
   No overwrite silencioso. Corrección/desvinculación requiere acción explícita separada.
6. Escribe solo `cliente_ordenes_hycite.venta_id` y un evento de auditoría con
   actor, instante y los dos valores previos/nuevos.
7. No crea tareas, paquetes, citas, servicios ni cambia decisiones externas.

### Definición de la RPC

```sql
create or replace function public.fn_vincular_venta_orden_hycite(
  p_orden_id uuid,
  p_venta_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden record;
  v_venta record;
  v_usuario_id uuid := auth.uid();
  v_org_id uuid;
  v_venta_id_anterior uuid;
begin
  -- 1. Usuario autenticado
  if v_usuario_id is null then
    raise exception 'usuario no autenticado';
  end if;

  -- 2. Bloquear filas
  select * into v_orden
  from public.cliente_ordenes_hycite
  where id = p_orden_id
  for update;

  select * into v_venta
  from public.ventas
  where id = p_venta_id
  for update;

  if v_orden is null or v_venta is null then
    raise exception 'orden o venta no encontrada';
  end if;

  -- 3. Validar org y cliente iguales
  v_org_id := (select org_id from public.usuarios where id = v_usuario_id and activo is true);
  if v_org_id is null then
    raise exception 'usuario sin organización activa';
  end if;

  if v_orden.org_id <> v_org_id or v_venta.org_id <> v_org_id then
    raise exception 'orden o venta no pertenecen a la organización del usuario';
  end if;

  if v_orden.cliente_id <> v_venta.cliente_id then
    raise exception 'orden y venta tienen cliente_id distinto';
  end if;

  if v_orden.cliente_id is null or v_venta.cliente_id is null then
    raise exception 'orden o venta sin cliente_id';
  end if;

  -- Validar identificadores externos (no TEST-*, no HY-CITE-*, no vacíos)
  if v_venta.numero_nota_pedido is not null then
    if upper(trim(v_venta.numero_nota_pedido)) like 'TEST-%'
       or upper(trim(v_venta.numero_nota_pedido)) = 'HY-CITE-001'
       or trim(v_venta.numero_nota_pedido) = '' then
      raise exception 'numero_nota_pedido inválido para vínculo';
    end if;
  end if;

  if v_orden.numero_orden_hycite is not null then
    if upper(trim(v_orden.numero_orden_hycite)) like 'TEST-%'
       or upper(trim(v_orden.numero_orden_hycite)) = 'HY-CITE-001'
       or trim(v_orden.numero_orden_hycite) = '' then
      raise exception 'numero_orden_hycite inválido para vínculo';
    end if;
  end if;

  -- 4. RE-LINK: si ya existe vínculo a otra venta, error
  if v_orden.venta_id is not null and v_orden.venta_id <> p_venta_id then
    raise exception 'orden ya vinculada a otra venta (%s). Desvincule primero si corresponde.', v_orden.venta_id;
  end if;

  -- 5. Verificar autorización de escritura (usando helper canónico public.is_admin_or_distribuidor)
  if not exists (
    select 1 from public.clientes c
    where c.id = v_orden.cliente_id and c.org_id = v_org_id
      and (c.distribuidor_id = v_usuario_id or c.vendedor_id = v_usuario_id or public.is_admin_or_distribuidor())
  ) then
    raise exception 'usuario sin autorización para vincular esta orden/venta';
  end if;

  -- 6. Escribir vínculo y auditoría
  v_venta_id_anterior := v_orden.venta_id;

  update public.cliente_ordenes_hycite
  set venta_id = p_venta_id,
      updated_at = now()
  where id = p_orden_id;

  -- Auditoría: usar campos de auditoría propios en la tabla (created_by/updated_by)
  -- No hay tabla central auditoriaacciones confirmada en migraciones.
  -- Si se requiere log estructurado, crear tabla versionada explícita en DDL antes de esta RPC.

  -- 7. No crea tareas, paquetes, citas, servicios ni cambia decisiones externas
  -- (Por diseño: esta RPC solo vincula)
end;
$$;
```

### Regla de matching (candidato de vínculo)

El candidato de vínculo puede sugerirse solo si se cumple exactamente:

```
org_id + cliente_id + ventas.numero_nota_pedido = cliente_ordenes_hycite.numero_orden_hycite
```

La sugerencia no escribe `venta_id`, no cambia estados y no crea tarea. Se
excluye cualquier dato de prueba o inválido según la política de este contrato
(prefijo `TEST-`, valor exacto `HY-CITE-001`, vacío, nulo, o fuera de patrón
aprobado por operación).

La UI presenta el candidato con número, cliente, ítems y total como evidencia;
el usuario confirma la acción de forma explícita invocando esta RPC.

## F y G. Derivación de entrega y edge transition

El trigger `after insert or update or delete` de paquetes ejecuta una función
transaccional por orden:

1. **Bloquea la orden padre (`FOR UPDATE`)** antes de contar/derivar para evitar
   race conditions entre eventos concurrentes de paquetes.
2. Cuenta paquetes y paquetes con `estado_paquete = 'entregado'`.
   - `devuelto`, `cancelado`, `incidencia` **NO cuentan como entregado**.
   - Si impiden que todos estén entregados, el estado queda `pendiente` o `parcial`
     según exista al menos un paquete entregado.
   - Estos estados terminales no entregados marcan la orden como
     **requiere revisión operativa** (bandera o log) para acción humana posterior.
3. Cero paquetes o ninguno entregado: `pendiente`.
4. Algunos entregados, pero no todos: `parcial`.
5. Todos entregados y al menos uno: `completa`.
6. Solo si el valor anterior de orden era distinto de `completa` y el nuevo es
   `completa`, intenta insertar la única tarea `servicio_pendiente`.

El responsable se elige en este orden, siempre activo y misma org: venta
vinculada `vendedor_id`; cliente `vendedor_id`; cliente `distribuidor_id`;
admin activo más antiguo por `created_at, id`.

**Decisión de producto**: si entrega llega a `completa` pero NO existe responsable
válido: **NO abortar** actualización del paquete/entrega. Persistir fulfillment.
Registrar condición operativa pendiente de asignación mediante `next_action` en
cliente con valor especial `'Asignar responsable para servicio'` y
`next_action_date = CURRENT_DATE`.

La fecha de vencimiento son dos días calendario después de `completion_at` en la
zona horaria del responsable. `completion_at` es el instante de esta primera
transición, no una fecha legacy. La conversión interpreta la hora local usando
la zona del responsable, cubriendo DST.

El modelo de vencimiento existente usa `fecha_vencimiento DATE` + `hora_vencimiento
TIME`. `fecha_vencimiento` representa la fecha calendario local del responsable.
Para tareas creadas por sistema, `hora_vencimiento` se deja NULL (coherente con
tareas existentes en producción)

La tarea de sistema usa `created_by = null`, `created_source = 'system_sync'`,
`created_source_ref = 'hycite'`, cliente, orden y venta si existe. No crea cita
ni servicio. Actualiza `clientes.next_action` como resumen operativo.

### Función trigger de derivación de entrega y tarea de servicio

```sql
create or replace function public.fn_derivar_entrega_y_servicio_paquetes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden record;
  v_total_paquetes int;
  v_entregados int;
  v_nuevo_estado_entrega text;
  v_estado_anterior_entrega text;
  v_responsable_id uuid;
  v_fecha_vencimiento date;
  v_completion_at timestamptz := now();
  v_timezone text;
  v_tarea_id uuid;
  v_requiere_asignacion boolean := false;
begin
  -- 1. Obtener y BLOQUEAR orden padre FOR UPDATE (concurrencia)
  if TG_OP = 'DELETE' then
    select * into v_orden from public.cliente_ordenes_hycite
    where id = OLD.orden_id
    for update;
  else
    select * into v_orden from public.cliente_ordenes_hycite
    where id = NEW.orden_id
    for update;
  end if;

  if v_orden is null then
    return null;
  end if;

  -- 2. Contar paquetes (excluyendo estados terminales no-entregados)
  select count(*) into v_total_paquetes
  from public.cliente_orden_hycite_paquetes
  where orden_id = v_orden.id;

  select count(*) into v_entregados
  from public.cliente_orden_hycite_paquetes
  where orden_id = v_orden.id
    and estado_paquete = 'entregado';

  -- 3. Derivar estado_entrega
  if v_total_paquetes = 0 then
    v_nuevo_estado_entrega := 'pendiente';
  elsif v_entregados = v_total_paquetes then
    v_nuevo_estado_entrega := 'completa';
  elsif v_entregados > 0 then
    v_nuevo_estado_entrega := 'parcial';
  else
    v_nuevo_estado_entrega := 'pendiente';
  end if;

  v_estado_anterior_entrega := v_orden.estado_entrega;

  -- 4. Actualizar orden si cambió
  if v_nuevo_estado_entrega <> v_estado_anterior_entrega then
    update public.cliente_ordenes_hycite
    set estado_entrega = v_nuevo_estado_entrega,
        updated_at = now()
    where id = v_orden.id;
  end if;

  -- 5. Edge transition: solo si pasa a 'completa' por primera vez
  if v_estado_anterior_entrega <> 'completa' and v_nuevo_estado_entrega = 'completa' then
    -- Elegir responsable: venta.vendedor_id > cliente.vendedor_id > cliente.distribuidor_id > admin antiguo
    if v_orden.venta_id is not null then
      select v.vendedor_id into v_responsable_id
      from public.ventas v
      where v.id = v_orden.venta_id;
    end if;

    if v_responsable_id is null then
      select c.vendedor_id into v_responsable_id
      from public.clientes c
      where c.id = v_orden.cliente_id;
    end if;

    if v_responsable_id is null then
      select c.distribuidor_id into v_responsable_id
      from public.clientes c
      where c.id = v_orden.cliente_id;
    end if;

    if v_responsable_id is null then
      select u.id into v_responsable_id
      from public.usuarios u
      where u.org_id = v_orden.org_id and u.activo is true and u.rol = 'admin'
      order by u.created_at, u.id
      limit 1;
    end if;

    -- Decisión de producto: si no hay responsable válido, NO abortar.
    -- Persistir fulfillment, registrar pendiente de asignación.
    if v_responsable_id is null then
      v_requiere_asignacion := true;
      -- Zona horaria fallback UTC para cálculo de vencimiento teórico
      v_fecha_vencimiento := (v_completion_at + interval '2 days')::date;
    else
      -- Zona horaria del responsable (fallback UTC). Columna real: usuarios.timezone
      select u.timezone into v_timezone
      from public.usuarios u
      where u.id = v_responsable_id;
      if v_timezone is null then
        v_timezone := 'UTC';
      end if;

      -- Vencimiento: 2 días calendario después de completion_at en zona horaria del responsable.
      -- Convertir completion_at (timestamptz) a timestamp local en v_timezone,
      -- sumar 2 días calendarmente, extraer DATE.
      -- Ejemplo: completion_at = 2026-09-25 23:30 UTC, timezone = America/New_York
      --   → local = 2026-09-25 19:30 → +2 días = 2026-09-27 19:30 → DATE = 2026-09-27
      -- Esto respeta correctamente el inicio/destino de horario de verano (DST)
      -- porque AT TIME ZONE aplica las reglas de la zona horaria.
      v_fecha_vencimiento := ((v_completion_at at time zone v_timezone) + interval '2 days')::date;
    end if;

    -- Intentar insertar tarea (idempotente por índice único parcial)
    -- Solo si hay responsable; si no, registrar pendiente en next_action
    if not v_requiere_asignacion then
      begin
        insert into public.crm_tareas (
          org_id, tipo, contacto_tipo, contacto_id, orden_hycite_id, venta_id,
          asignado_a, estado, fecha_vencimiento, hora_vencimiento, descripcion,
          created_source, created_source_ref, created_at, updated_at
        ) values (
          v_orden.org_id,
          'servicio_pendiente',
          'cliente',
          v_orden.cliente_id,
          v_orden.id,
          v_orden.venta_id,
          v_responsable_id,
          'pendiente',
          v_fecha_vencimiento,
          null,
          'Entrega completa confirmada para orden Hy-Cite ' || v_orden.numero_orden_hycite || '. Contactar para coordinar servicio.',
          'system_sync',
          'hycite',
          now(),
          now()
        )
        returning id into v_tarea_id;

        -- Actualizar next_action en cliente
        update public.clientes
        set next_action = 'Contactar para coordinar servicio',
            next_action_date = v_fecha_vencimiento,
            updated_at = now()
        where id = v_orden.cliente_id;

      exception when unique_violation then
        -- Conflicto de índice único parcial = reintento idempotente
        -- No cambia responsable, vencimiento ni tarea existente
        null;
      end;
    else
      -- Sin responsable: registrar condición operativa pendiente
      update public.clientes
      set next_action = 'Asignar responsable para servicio',
          next_action_date = current_date,
          updated_at = now()
      where id = v_orden.cliente_id;
    end if;
  end if;

  return null;
end;
$$;

-- Trigger en paquetes
create trigger trg_derivar_entrega_servicio_paquetes
  after insert or update or delete on public.cliente_orden_hycite_paquetes
  for each row execute function public.fn_derivar_entrega_y_servicio_paquetes();
```

### RPC de importación/actualización de paquetes (idempotente)

```sql
create or replace function public.fn_upsert_paquete_hycite(
  p_orden_id uuid,
  p_numero_paquete text,
  p_estado_paquete text,
  p_numero_seguimiento text default null,
  p_carrier text default null,
  p_fecha_envio timestamptz default null,
  p_fecha_entrega timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden record;
  v_paquete_id uuid;
  v_usuario_id uuid := auth.uid();
  v_org_id uuid;
begin
  -- Validar usuario y org
  if v_usuario_id is null then
    raise exception 'usuario no autenticado';
  end if;

  v_org_id := (select org_id from public.usuarios where id = v_usuario_id and activo is true);
  if v_org_id is null then
    raise exception 'usuario sin organización activa';
  end if;

  -- Validar patrón de identificadores externos
  if p_numero_paquete is null or trim(p_numero_paquete) = '' then
    raise exception 'numero_paquete requerido';
  end if;
  if upper(trim(p_numero_paquete)) like 'TEST-%'
     or upper(trim(p_numero_paquete)) = 'HY-CITE-001' then
    raise exception 'numero_paquete inválido (datos de prueba)';
  end if;
  if p_numero_seguimiento is not null and trim(p_numero_seguimiento) <> '' then
    if upper(trim(p_numero_seguimiento)) like 'TEST-%'
       or upper(trim(p_numero_seguimiento)) = 'HY-CITE-001' then
      raise exception 'numero_seguimiento inválido (datos de prueba)';
    end if;
  end if;

  -- Obtener y bloquear orden
  select * into v_orden
  from public.cliente_ordenes_hycite
  where id = p_orden_id
  for update;

  if v_orden is null then
    raise exception 'orden no encontrada';
  end if;

  if v_orden.org_id <> v_org_id then
    raise exception 'orden no pertenece a la organización del usuario';
  end if;

  -- Verificar autorización (admin o distribuidor de la org) - helper canónico
  if not public.is_admin_or_distribuidor() then
    raise exception 'usuario sin autorización para importar paquetes';
  end if;

  -- Upsert idempotente por (orden_id, numero_paquete)
  insert into public.cliente_orden_hycite_paquetes (
    org_id, orden_id, numero_paquete, numero_seguimiento, carrier,
    estado_paquete, fecha_envio, fecha_entrega, created_at, updated_at
  ) values (
    v_orden.org_id, p_orden_id, trim(p_numero_paquete),
    nullif(trim(p_numero_seguimiento), ''),
    nullif(trim(p_carrier), ''),
    p_estado_paquete, p_fecha_envio, p_fecha_entrega, now(), now()
  )
  on conflict (orden_id, numero_paquete) do update set
    numero_seguimiento = excluded.numero_seguimiento,
    carrier = excluded.carrier,
    estado_paquete = excluded.estado_paquete,
    fecha_envio = excluded.fecha_envio,
    fecha_entrega = excluded.fecha_entrega,
    updated_at = now()
  returning id into v_paquete_id;

  return v_paquete_id;
end;
$$;
```

## H. Idempotencia

La garantía central es el índice único parcial
`crm_tareas_servicio_pendiente_orden_uq`. El trigger captura conflicto único
como reintento idempotente: no cambia responsable, vencimiento ni tarea ya
existente. El upsert de paquetes es idempotente por `(orden_id, numero_paquete)`.

## I. Rollback

- Separar el cambio RLS de tablas nuevas y de triggers para aislar riesgo.
- Antes de cada cambio de policy, guardar definición actual en artefacto de
  rollback y probar con usuarios representativos.
- Rollback de RLS: restaurar políticas previas solo como medida de emergencia;
  no reintroducir `USING (true)` como solución permanente.
- Rollback de schema: remover triggers/RPC/policies nuevos antes de columnas;
  no borrar paquetes, vínculos ni tareas creadas sin export/auditoría previa.
- Rollback de entrega: deshabilitar trigger; no borrar la tarea idempotente ni
  revertir manualmente `next_action` sin evaluación operativa.

## K. Estrategia legacy (órdenes existentes sin paquetes)

Las 31 órdenes actuales no tienen paquetes. No se crean paquetes sintéticos ni
se marca entrega completa por ausencia de paquetes.

- Conservar `numero_seguimiento`, `estado_envio`, `fecha_envio` y
  `fecha_entrega` actuales en `cliente_ordenes_hycite` como snapshot legacy
  visible.
- Inicializar o clasificar estas órdenes como `legacy_no_derivable`, no como
  `completa`, cuando no exista detalle de paquete verificable.
- No generar tareas de servicio desde campos legacy.
- Un backfill futuro será manual y controlado: solo crea paquetes cuando una
  fuente Hy-Cite verificable aporte número de paquete/tracking/estado/fechas.
- El estado `legacy_no_derivable` es terminal para derivación automática;
  cualquier corrección requiere operación humana explícita y creación de paquetes
  verificables vía RPC `fn_upsert_paquete_hycite`.
- **Mantener legacy fuera de automatización**: ninguna RPC, trigger o matching
  automático procesa órdenes en estado `legacy_no_derivable`.

## L. Política de datos de prueba

Excluir de toda sugerencia automática, vínculo candidato, importación
automática y generación de tareas números que, tras `trim` y normalización a
mayúsculas, cumplan:

- prefijo `TEST-`;
- valor exacto `HY-CITE-001`;
- valor vacío, nulo o marcador documentado;
- formatos que no satisfagan el patrón de número externo aprobado por
  operación.

La exclusión es defensiva en servidor (RPCs y triggers validan) y en UI. Los
datos quedan visibles para auditoría, pero solo pueden corregirse mediante
operación humana explícita.

Validaciones en servidor:
- `fn_vincular_venta_orden_hycite`: rechaza `numero_nota_pedido` y
  `numero_orden_hycite` con patrones de prueba.
- `fn_upsert_paquete_hycite`: rechaza `numero_paquete` y `numero_seguimiento`
  con patrones de prueba.
- Trigger `fn_validar_integridad_postventa_rp`: valida `created_source_ref` en
  automatización.

## M. Orden de migración

1. Auditar y reemplazar RLS de órdenes/items; corregir RLS de tareas antes de
   exponer IDs externos en ellas.
2. Agregar campos externos a `ventas` y `venta_id`/`estado_entrega` a órdenes,
   sin backfill automático.
3. Crear tabla de paquetes, constraints, índices y RLS heredado por padre.
4. Agregar referencias de tarea, checks e índice único parcial de idempotencia.
   **Validar los tipos actuales y reemplazar atómicamente el CHECK existente de
   `crm_tareas.tipo` para permitir `'servicio_pendiente'` sin excluir los tipos
   de seguros vigentes.**
5. Implementar RPC transaccional de vínculo humano y la operación de
   importación/actualización de paquete con derivación de entrega.
6. Implementar UI de candidato, confirmación humana y cola de tareas; luego
   pruebas de concurrencia, RLS, legado y no-creación de citas automáticas.

## J. Plan de pruebas

1. RLS: admin, distribuidor, vendedor y supervisor de una org; usuario de otra
   org; tareas `org_id null`; tareas soft-deleted.
2. Cross-org: rechazar orden/paquete/venta/tarea con org o cliente distinto.
3. Concurrencia: dos eventos finales de paquete a la vez producen una sola
   tarea.
4. Legacy: las 31 órdenes sin paquetes siguen `legacy_no_derivable`, sin tarea.
5. Envío parcial: uno de varios paquetes entregado da `parcial`, sin tarea.
6. Envío completo: último paquete entregado da `completa` y una sola tarea.
7. Evento duplicado: no altera responsable ni vencimiento de tarea existente.
8. Vínculo manual: candidato no escribe; confirmación válida enlaza; cliente u
   org distintos fallan.
9. IDs: rechazar `TEST-*`, `HY-CITE-*`, vacíos y caracteres fuera de patrón en
   automatización; aceptar valores alfanuméricos válidos.
10. Soft-delete: solo admin de misma org puede marcar; no hay delete físico.
11. Matching rule: sugerencia aparece solo con org+cliente+numero_nota_pedido
    = numero_orden_hycite exacto; no escribe venta_id.
12. Datos de prueba: TEST-*, HY-CITE-001, vacíos excluidos de matching, upsert
    y vínculo; visibles en UI para auditoría.
13. Responsable fallback: venta.vendedor_id → cliente.vendedor_id →
    cliente.distribuidor_id → admin antiguo; todos activos y misma org.
14. Vencimiento: 2 días calendario tras completion_at (DATE) en zona horaria
    responsable. Hora_vencimiento = NULL en tareas de sistema.
    **Cobertura DST: verificar transición horario verano/invierno.**
15. next_action: actualizado en cliente al crear tarea servicio_pendiente.
16. No creación automática: ni citas ni servicios creados por trigger/RPC.
17. **Upsert no autorizado**: RPC `fn_upsert_paquete_hycite` rechaza sin rol
    admin/distribuidor.
18. **RPC + direct table concurrent writes**: trigger derivación + upsert directo
    concurrente no produce tareas duplicadas ni estados inconsistentes.
19. **Re-link distinto**: orden ya vinculada a venta A, intento vincular a venta B
    → ERROR (no overwrite silencioso).
20. **servicio_pendiente CHECK**: `crm_tareas.tipo` acepta nuevo valor tras
    ADD CONSTRAINT; INSERT con tipo inválido falla.
21. **DST/timezone**: fecha_vencimiento calculada correctamente en transición
    DST (zona horaria responsable con/sin DST).
22. **DELETE con paquetes/tarea**: hard DELETE de orden con paquetes/tarea
    falla por FK/trigger; soft-delete vía RPC admin.
23. **INSERT orden con venta_id inválido**: FK + trigger cross-validation rechaza
    venta de otra org/cliente.
24. **Entrega completa sin responsable**: estado orden = `completa` persistido,
    next_action = 'Asignar responsable para servicio', sin tarea creada.
25. **Paquete terminal requiere revisión**: estado_paquete `devuelto`/`cancelado`/
    `incidencia` no cuenta como entregado; orden queda `parcial`/`pendiente` y
    se registra condición operativa para revisión humana.
26. **Admin fallback por rol**: usuario no-admin inserta/actualiza paquete que
    completa orden; fallback encuentra correctamente admin activo de la org
    mediante `u.rol = 'admin'` (no `public.is_admin()`), ordenado por created_at/id.
26. **Admin fallback por rol**: usuario no-admin inserta/actualiza paquete que
    completa orden; fallback selecciona admin activo por `u.rol = 'admin'`
    (no `public.is_admin()`), misma org, ordenado por created_at/id.

## Open risks y gate de revisión

- El RLS de `crm_tareas` actual es una corrección transversal y requiere prueba
  regresiva de todos sus consumidores antes de activar nuevas policies.
- Backfill deja tareas ambiguas invisibles hasta revisión manual, por diseño.
- La propuesta usa una RPC/triggers privados para creación de sistema; validar
  el patrón de privilegios y auditoría con la configuración real de Supabase.
- Confirmar con operación que el fallback al admin más antiguo es aceptable.
- No implementar si la operación no confirma el formato válido de número
  externo, el responsable fallback o la fecha de vencimiento de la tarea.
- No asumir que toda orden Royal One/Hy-Cite mantiene relación 1:1 sin muestras
  de cancelación, reemisión y envío dividido.
- No escribir estados externos desde flujos CRM internos.
- El estado `completa` solo puede venir de paquetes verificables, nunca de un
  tracking legacy agregado.
- **DELETE operativo de `cliente_ordenes_hycite`**: prohibir hard DELETE por
  cascade destructivo. Definir política/RLS: solo soft-delete vía RPC admin
  (borrado lógico con `deleted_at`/`deleted_by`). El hard DELETE requiere
  export/auditoría previa y aprobación explícita.
- **RLS SELECT de órdenes**: reevaluar política `coh_select_visible_client` para
  alinearla con visibilidad efectiva de `ventas` y `clientes`. Diferencia
  intencional documentada: órdenes legibles si cliente visible, aunque venta no
  lo sea (reflejo de hecho externo).

Con estas aprobaciones, el diseño está listo para revisión de implementación,
no para ejecución directa.
