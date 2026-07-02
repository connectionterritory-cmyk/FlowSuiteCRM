begin;

alter table public.oportunidades
  add column if not exists org_id uuid,
  add column if not exists persona_id uuid,
  add column if not exists producto_recomendado text,
  add column if not exists categoria_producto text,
  add column if not exists estado text,
  add column if not exists source text,
  add column if not exists canal text,
  add column if not exists next_action text,
  add column if not exists next_action_date date,
  add column if not exists blocked_by_cartera boolean not null default false,
  add column if not exists motivo_bloqueo text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'oportunidades_persona_id_fkey'
      and conrelid = 'public.oportunidades'::regclass
  ) then
    alter table public.oportunidades
      add constraint oportunidades_persona_id_fkey
      foreign key (persona_id)
      references public.personas(id)
      on delete set null;
  end if;
end $$;

update public.oportunidades o
set org_id = coalesce(
  (select c.org_id from public.clientes c where c.id = o.cliente_id),
  (select l.org_id from public.leads l where l.id = o.lead_id),
  (select u.org_id from public.usuarios u where u.id = o.owner_id),
  o.org_id
)
where o.org_id is null;

update public.oportunidades o
set persona_id = coalesce(
  (select c.persona_id from public.clientes c where c.id = o.cliente_id),
  (select l.persona_id from public.leads l where l.id = o.lead_id),
  o.persona_id
)
where o.persona_id is null;

update public.oportunidades
set estado = case
  when etapa in ('cerrado_ganado', 'cerrado') then 'ganada'
  when etapa = 'cerrado_perdido' then 'perdida'
  else 'abierta'
end
where estado is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'oportunidades_estado_chk'
      and conrelid = 'public.oportunidades'::regclass
  ) then
    alter table public.oportunidades
      add constraint oportunidades_estado_chk
      check (
        estado in (
          'abierta',
          'en_seguimiento',
          'bloqueada',
          'ganada',
          'perdida',
          'pospuesta',
          'cerrada'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'oportunidades_source_chk'
      and conrelid = 'public.oportunidades'::regclass
  ) then
    alter table public.oportunidades
      add constraint oportunidades_source_chk
      check (
        source is null or source in (
          'cliente_existente',
          'cliente_recuperado',
          'cross_sell',
          'referido_cliente',
          'postventa',
          'campana'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'oportunidades_canal_chk'
      and conrelid = 'public.oportunidades'::regclass
  ) then
    alter table public.oportunidades
      add constraint oportunidades_canal_chk
      check (
        canal is null or canal in (
          'llamada',
          'whatsapp',
          'cita',
          'servicio',
          'cartera_handoff',
          'manual'
        )
      );
  end if;
end $$;

create index if not exists oportunidades_cliente_idx
  on public.oportunidades (cliente_id);

create index if not exists oportunidades_org_idx
  on public.oportunidades (org_id);

create index if not exists oportunidades_persona_idx
  on public.oportunidades (persona_id);

create index if not exists oportunidades_source_idx
  on public.oportunidades (source);

create index if not exists oportunidades_next_action_date_idx
  on public.oportunidades (next_action_date);

create index if not exists oportunidades_cliente_categoria_estado_idx
  on public.oportunidades (cliente_id, categoria_producto, estado);

do $$
begin
  if exists (
    select 1
    from public.oportunidades o
    where o.cliente_id is not null
      and coalesce(o.estado, 'abierta') in ('abierta', 'en_seguimiento', 'bloqueada', 'pospuesta')
    group by
      o.cliente_id,
      lower(coalesce(nullif(trim(o.categoria_producto), ''), 'sin_categoria'))
    having count(*) > 1
  ) then
    raise notice 'Skipped uq_oportunidades_cliente_categoria_abierta due to existing duplicate active opportunities.';
  else
    execute '
      create unique index if not exists uq_oportunidades_cliente_categoria_abierta
        on public.oportunidades (
          cliente_id,
          lower(coalesce(nullif(trim(categoria_producto), ''''), ''sin_categoria''))
        )
        where cliente_id is not null
          and coalesce(estado, ''abierta'') in (''abierta'', ''en_seguimiento'', ''bloqueada'', ''pospuesta'')
    ';
  end if;
end $$;

comment on column public.oportunidades.org_id is
  'Organización propietaria de la oportunidad. Backfill desde cliente, lead u owner cuando existe.';

comment on column public.oportunidades.persona_id is
  'Continuidad de identidad entre lead, cliente y programas/referidos.';

comment on column public.oportunidades.producto_recomendado is
  'Producto o solución recomendada al cliente existente.';

comment on column public.oportunidades.categoria_producto is
  'Categoría comercial para dedupe operativo y filtros de conversión.';

comment on column public.oportunidades.estado is
  'Estado operativo de la oportunidad. Complementa etapa sin reemplazar el embudo comercial.';

comment on column public.oportunidades.source is
  'Origen de la oportunidad de cliente: cliente_existente, cliente_recuperado, cross_sell, referido_cliente, postventa o campana.';

comment on column public.oportunidades.canal is
  'Canal operativo principal de seguimiento.';

comment on column public.oportunidades.next_action is
  'Próxima acción comercial específica de la oportunidad.';

comment on column public.oportunidades.next_action_date is
  'Fecha objetivo de la próxima acción comercial.';

comment on column public.oportunidades.blocked_by_cartera is
  'Flag de guard comercial: true cuando la oportunidad debe resolverse primero con cartera.';

comment on column public.oportunidades.motivo_bloqueo is
  'Motivo legible del bloqueo comercial relacionado con cartera.';

commit;
