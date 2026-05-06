begin;

-- 0149_cob_metodos_pago_operational_table
-- Tabla operativa de métodos de pago para cartera.
-- Seguridad: nunca almacenar PAN completo ni CVV.
-- No toca cob_financial_ledger.

create table if not exists public.cob_metodos_pago (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  cliente_id           uuid not null references public.clientes(id),
  cargo_vuelta_case_id uuid references public.cargo_vuelta_cases(id) on delete set null,
  provider             text,
  token_ref            text not null,
  brand                text,
  last4                text,
  exp_month            integer,
  exp_year             integer,
  nombre_tarjeta       text,
  billing_zip          text,
  is_default           boolean not null default false,
  estado               text not null default 'activo',
  source               text not null default 'manual',
  notas                text,
  created_by           uuid references public.usuarios(id) on delete set null,
  updated_by           uuid references public.usuarios(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint cob_metodos_pago_token_ref_not_blank
    check (length(btrim(token_ref)) > 0),
  constraint cob_metodos_pago_last4_check
    check (last4 is null or last4 ~ '^[0-9]{1,4}$'),
  constraint cob_metodos_pago_exp_month_check
    check (exp_month is null or exp_month between 1 and 12),
  constraint cob_metodos_pago_exp_year_check
    check (exp_year is null or exp_year between 2000 and 2100),
  constraint cob_metodos_pago_estado_check
    check (estado in ('activo', 'inactivo', 'expirado', 'reemplazado', 'fallido')),
  constraint cob_metodos_pago_source_check
    check (source in ('manual', 'import', 'portal', 'n8n'))
);

comment on table public.cob_metodos_pago is
  'Métodos de pago operativos por cliente/caso. No almacena PAN completo ni CVV.';

comment on column public.cob_metodos_pago.token_ref is
  'Referencia segura/token del método de pago. Nunca guardar PAN ni CVV.';

comment on column public.cob_metodos_pago.last4 is
  'Últimos 4 dígitos del instrumento, si aplica.';

create index if not exists idx_cob_metodos_pago_org_id
  on public.cob_metodos_pago (org_id);

create index if not exists idx_cob_metodos_pago_cliente_id
  on public.cob_metodos_pago (cliente_id);

create index if not exists idx_cob_metodos_pago_case_id
  on public.cob_metodos_pago (cargo_vuelta_case_id);

create index if not exists idx_cob_metodos_pago_estado
  on public.cob_metodos_pago (org_id, estado);

create index if not exists idx_cob_metodos_pago_is_default
  on public.cob_metodos_pago (org_id, cliente_id, is_default);

-- Solo un método default activo por cliente/org.
create unique index if not exists uq_cob_metodos_pago_single_default_activo
  on public.cob_metodos_pago (org_id, cliente_id)
  where is_default = true and estado = 'activo';

-- Trigger updated_at (reusable estándar del proyecto).
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_cob_metodos_pago_updated_at on public.cob_metodos_pago;
create trigger trg_cob_metodos_pago_updated_at
  before update on public.cob_metodos_pago
  for each row execute function public.fn_set_updated_at();

-- RLS
alter table public.cob_metodos_pago enable row level security;

drop policy if exists cob_metodos_pago_select_cartera on public.cob_metodos_pago;
drop policy if exists cob_metodos_pago_insert_cartera on public.cob_metodos_pago;
drop policy if exists cob_metodos_pago_update_cartera on public.cob_metodos_pago;
drop policy if exists cob_metodos_pago_delete_cartera on public.cob_metodos_pago;

create policy cob_metodos_pago_select_cartera
  on public.cob_metodos_pago
  for select to authenticated
  using (
    org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() limit 1)
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
      or security.current_user_role() in ('telemercadeo', 'manager', 'gerente')
    )
  );

create policy cob_metodos_pago_insert_cartera
  on public.cob_metodos_pago
  for insert to authenticated
  with check (
    org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() limit 1)
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
      or security.current_user_role() in ('telemercadeo', 'manager', 'gerente')
    )
  );

create policy cob_metodos_pago_update_cartera
  on public.cob_metodos_pago
  for update to authenticated
  using (
    org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() limit 1)
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
      or security.current_user_role() in ('telemercadeo', 'manager', 'gerente')
    )
  )
  with check (
    org_id = (select u.org_id from public.usuarios u where u.id = auth.uid() limit 1)
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
      or security.current_user_role() in ('telemercadeo', 'manager', 'gerente')
    )
  );

-- Sin delete directo: desactivación por estado.

commit;
