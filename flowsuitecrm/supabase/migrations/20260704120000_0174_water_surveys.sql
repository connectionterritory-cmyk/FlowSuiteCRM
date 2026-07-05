begin;

-- ============================================================
-- 0174 — water_surveys
-- Encuestas de calidad del agua capturadas en campo (mobile).
-- Score + temperatura calculados en frontend antes del insert.
-- ============================================================

create table if not exists public.water_surveys (
  id                   uuid        primary key default gen_random_uuid(),

  -- Agente
  created_by           uuid        references public.usuarios(id) on delete set null,
  assigned_to          uuid        references public.usuarios(id) on delete set null,

  -- Contacto
  nombre               text,
  telefono             text,
  direccion            text,
  idioma_preferido     text        check (idioma_preferido in ('espanol', 'ingles')),

  -- Hogar
  tipo_vivienda        text        check (tipo_vivienda in ('casa', 'apartamento', 'negocio')),
  propiedad            text        check (propiedad in ('dueno', 'renta', 'no_sabe')),
  personas_hogar       text        check (personas_hogar in ('1_2', '3_4', '5_plus')),
  hay_ninos            boolean,
  decisor              text        check (decisor in ('yo', 'pareja', 'ambos', 'otro')),
  decisor_presente     boolean,

  -- Agua
  fuente_agua          text        check (fuente_agua in ('llave', 'botellitas', 'botellon', 'filtro_nevera', 'filtro_instalado', 'otro')),
  preocupaciones       text[],
  gasto_mensual_agua   text        check (gasto_mensual_agua in ('0', '20_40', '40_80', '80_120', '120_plus')),

  -- Interés
  interes_revision     text        check (interes_revision in ('hoy', 'otro_dia', 'tal_vez', 'no')),
  notas                text,

  -- Scoring (calculado en frontend)
  score                integer     not null default 0,
  temperatura          text        check (temperatura in ('frio', 'tibio', 'caliente')),

  -- Estado
  status               text        not null default 'encuesta_completada'
                                   check (status in ('encuesta_completada', 'seguimiento', 'demo_agendada', 'no_interesado', 'vendido')),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Índices
create index if not exists water_surveys_created_by_idx  on public.water_surveys (created_by);
create index if not exists water_surveys_assigned_to_idx on public.water_surveys (assigned_to);
create index if not exists water_surveys_temperatura_idx on public.water_surveys (temperatura);
create index if not exists water_surveys_status_idx      on public.water_surveys (status);
create index if not exists water_surveys_created_at_idx  on public.water_surveys (created_at desc);

-- updated_at automático (set_updated_at ya existe desde migración 0001)
create trigger water_surveys_set_updated_at
  before update on public.water_surveys
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.water_surveys enable row level security;

-- SELECT: el agente ve sus propias encuestas; admin/distribuidor ve todo
create policy water_surveys_select on public.water_surveys
  for select to authenticated
  using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or public.is_admin_or_distribuidor()
  );

-- INSERT: cualquier agente autenticado, created_by = self
create policy water_surveys_insert on public.water_surveys
  for insert to authenticated
  with check (created_by = auth.uid());

-- UPDATE: dueño o admin
create policy water_surveys_update on public.water_surveys
  for update to authenticated
  using (
    created_by = auth.uid()
    or public.is_admin_or_distribuidor()
  )
  with check (
    created_by = auth.uid()
    or public.is_admin_or_distribuidor()
  );

-- DELETE: solo admin
create policy water_surveys_delete on public.water_surveys
  for delete to authenticated
  using (public.is_admin_or_distribuidor());

commit;

-- Rollback reference:
--   drop table if exists public.water_surveys cascade;
