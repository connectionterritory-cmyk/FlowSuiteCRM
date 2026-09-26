-- Reconciliación de drift: refleja únicamente columnas verificadas en producción.
-- No recrea crm_tareas ni elimina registros, índices, triggers o políticas existentes.
-- La única escritura de filas es el backfill determinístico y nullable de org_id.

begin;

-- Producción ya contiene valores; si una base aún no tiene la columna, se crea
-- sin default ni backfill para preservar todos los valores existentes.
alter table public.usuarios
  add column if not exists timezone text;

-- Producción tiene crm_tareas sin esta columna. Mantenerla nullable porque las
-- filas con evidencia ambigua o incompleta requieren revisión manual.
alter table public.crm_tareas
  add column if not exists org_id uuid;

-- Clasificación temporal de auditoría del backfill aprobado. Las fuentes son:
-- usuario asignado, usuario creador y contacto existente (cliente o lead).
-- Solo una única organización distinta entre la evidencia disponible permite
-- actualizar una fila; conflictos y ausencia de evidencia permanecen en NULL.
create temporary table rp_crm_tareas_org_backfill_audit
on commit drop
as
with candidate_orgs as (
  select t.id as tarea_id, u.org_id
  from public.crm_tareas t
  join public.usuarios u on u.id = t.asignado_a
  where u.org_id is not null

  union all

  select t.id as tarea_id, u.org_id
  from public.crm_tareas t
  join public.usuarios u on u.id = t.created_by
  where u.org_id is not null

  union all

  select t.id as tarea_id, c.org_id
  from public.crm_tareas t
  join public.clientes c
    on t.contacto_tipo = 'cliente'
   and c.id = t.contacto_id
  where c.org_id is not null

  union all

  select t.id as tarea_id, l.org_id
  from public.crm_tareas t
  join public.leads l
    on t.contacto_tipo = 'lead'
   and l.id = t.contacto_id
  where l.org_id is not null
), classified as (
  select
    tarea_id,
    (array_agg(distinct org_id))[1] as org_id,
    count(distinct org_id) as org_count
  from candidate_orgs
  group by tarea_id
)
select
  t.id as tarea_id,
  c.org_id,
  case
    when c.tarea_id is null then 'ambiguous'
    when c.org_count = 1 then 'deterministic'
    else 'conflict'
  end as classification
from public.crm_tareas t
left join classified c on c.tarea_id = t.id;

update public.crm_tareas t
set org_id = a.org_id
from rp_crm_tareas_org_backfill_audit a
where t.id = a.tarea_id
  and t.org_id is null
  and a.classification = 'deterministic';

commit;
