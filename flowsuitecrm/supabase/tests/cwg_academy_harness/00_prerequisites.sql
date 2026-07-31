begin;

create extension if not exists "pgcrypto";

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'usuario_rol') then
    create type public.usuario_rol as enum (
      'admin',
      'distribuidor',
      'vendedor',
      'telemercadeo',
      'embajador',
      'supervisor_telemercadeo'
    );
  end if;
end
$$;

create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  codigo_vendedor text,
  codigo_distribuidor text,
  nombre text,
  apellido text,
  email text,
  telefono text,
  rol public.usuario_rol not null default 'vendedor',
  distribuidor_padre_id uuid,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  org_id uuid
);

create index if not exists usuarios_org_id_idx
  on public.usuarios (org_id);

create table if not exists public.plan_limits (
  plan text primary key,
  max_users integer not null default 3,
  max_storage_mb integer not null default 1024,
  max_records integer not null default 5000,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.plan_limits (plan, max_users, max_storage_mb, max_records, features)
values
  ('Free', 3, 1024, 5000, '{"branding": true, "reports": false, "dfp": false}'),
  ('Basico', 10, 5120, 25000, '{"branding": true, "reports": true, "dfp": false}'),
  ('Pro', 30, 20480, 100000, '{"branding": true, "reports": true, "dfp": true}'),
  ('Elite', 100, 102400, 500000, '{"branding": true, "reports": true, "dfp": true}')
on conflict (plan) do nothing;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  plan text not null default 'Free' references public.plan_limits(plan),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

create unique index if not exists memberships_org_user_idx
  on public.memberships (org_id, user_id);

create index if not exists memberships_user_idx
  on public.memberships (user_id);

create or replace function public.is_org_member(check_org uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = check_org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(check_org uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = check_org
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

commit;
