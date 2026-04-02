-- ============================================================
-- 0072_embajadores_estado.sql
--
-- Objetivo:
--   Agregar las columnas de ciclo de vida del embajador que
--   quedaron fuera de 0071: estado, fecha_aceptacion,
--   aceptado_por, notas_inscripcion.
--
-- Contexto:
--   El frontend (useConexiones.ts / ConexionesInfinitasPage.tsx)
--   ya referencia estas columnas en SELECT, INSERT y UPDATE.
--   Sin esta migración cualquier escritura que incluya estos
--   campos falla con error de columna inexistente.
--
-- Decisiones de diseño:
--   • estado: text NOT NULL DEFAULT 'pendiente' con CHECK.
--     No se usa ENUM para mantener consistencia con el patrón
--     del proyecto (ver citas.estado, servicios.estado, etc.).
--     Valores válidos: pendiente | activo | inactivo | rechazado
--     (espejea EmbajadorEstado del frontend).
--   • fecha_aceptacion: timestamptz nullable. Se registra cuando
--     estado cambia a 'activo'. NULL es válido para pendientes.
--   • aceptado_por: uuid nullable FK → public.usuarios(id).
--     ON DELETE SET NULL para no perder el registro si el usuario
--     que aceptó es eliminado.
--   • notas_inscripcion: text nullable. Campo libre de auditoría
--     para el operador que inscribió al embajador.
--
-- Fase: ADITIVA
--   • No elimina ni modifica columnas existentes.
--   • Backfill: registros existentes quedan con estado='pendiente'
--     y el resto en NULL — correcto, son registros históricos
--     que no pasaron por el flujo de aceptación.
--
-- Tablas afectadas:
--   public.embajadores
--
-- ROLLBACK al final del archivo.
-- ============================================================

begin;

-- ── 1. estado ─────────────────────────────────────────────────
--
-- NOT NULL con DEFAULT garantiza que todos los registros
-- existentes (backfill implícito) queden como 'pendiente'.

alter table public.embajadores
  add column if not exists estado text not null default 'pendiente';

-- CHECK constraint idempotente

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where  conrelid = 'public.embajadores'::regclass
      and  conname  = 'embajadores_estado_values'
  ) then
    alter table public.embajadores
      add constraint embajadores_estado_values
      check (estado in ('pendiente', 'activo', 'inactivo', 'rechazado'));
  end if;
end $$;

-- ── 2. fecha_aceptacion ───────────────────────────────────────

alter table public.embajadores
  add column if not exists fecha_aceptacion timestamptz;

-- ── 3. aceptado_por ───────────────────────────────────────────
--
-- FK a public.usuarios (no a auth.users) — consistente con
-- owner_id y demás referencias de usuario en esta tabla.
-- ON DELETE SET NULL: si el usuario que aceptó es eliminado,
-- el embajador no se pierde.

alter table public.embajadores
  add column if not exists aceptado_por uuid
    references public.usuarios(id) on delete set null;

-- ── 4. notas_inscripcion ──────────────────────────────────────

alter table public.embajadores
  add column if not exists notas_inscripcion text;

-- ── 5. Índice por estado ──────────────────────────────────────
--
-- Soporta el filtro filtroEstado del frontend y futuras
-- queries de gestión de embajadores por estado.

create index if not exists embajadores_estado_idx
  on public.embajadores (estado);

-- ── 6. Documentar columnas ───────────────────────────────────

comment on column public.embajadores.estado is
  'Ciclo de vida del embajador: pendiente (por defecto) → activo | inactivo | rechazado.';

comment on column public.embajadores.fecha_aceptacion is
  'Timestamp de cuando el embajador fue aceptado (estado pasó a activo). NULL si aún no aceptado.';

comment on column public.embajadores.aceptado_por is
  'FK al usuario (admin o distribuidor) que aceptó la inscripción. NULL si no aceptado aún.';

comment on column public.embajadores.notas_inscripcion is
  'Notas libres del operador al momento de inscribir al embajador.';

commit;

-- ============================================================
-- AUDIT QUERIES (ejecutar DESPUÉS de aplicar)
-- ============================================================
--
-- Verificar que la columna estado fue creada y backfilled:
--
-- select estado, count(*) as total
-- from public.embajadores
-- group by estado;
-- → debe mostrar todos los registros bajo 'pendiente'
--
-- Verificar constraint:
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.embajadores'::regclass
--   and conname in ('embajadores_estado_values', 'embajador_origen_unico');
--
-- Verificar FK de aceptado_por:
--
-- select
--   tc.constraint_name,
--   kcu.column_name,
--   ccu.table_name as ref_table,
--   ccu.column_name as ref_column
-- from information_schema.table_constraints tc
-- join information_schema.key_column_usage kcu
--   on tc.constraint_name = kcu.constraint_name
-- join information_schema.constraint_column_usage ccu
--   on tc.constraint_name = ccu.constraint_name
-- where tc.table_name = 'embajadores'
--   and tc.constraint_type = 'FOREIGN KEY';
--
-- ============================================================
-- ROLLBACK
-- ============================================================
-- begin;
--
-- drop index if exists public.embajadores_estado_idx;
--
-- alter table public.embajadores
--   drop constraint if exists embajadores_estado_values;
--
-- alter table public.embajadores
--   drop column if exists estado,
--   drop column if exists fecha_aceptacion,
--   drop column if exists aceptado_por,
--   drop column if exists notas_inscripcion;
--
-- commit;
-- ============================================================
