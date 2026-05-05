-- 0140: backfill pago_prometido desde llamadas_telemercadeo hacia cob_gestiones
--
-- Contexto:
--   La migración 0109 usó un filtro por cliente (NOT EXISTS a nivel cliente_id).
--   Clientes que ya tenían al menos una gestión en cob_gestiones antes de correr 0109
--   tuvieron TODAS sus llamadas saltadas, incluyendo las de resultado='pago_prometido'
--   que representan gestiones reales de cobranza con notas y montos comprometidos.
--
--   Esta migración complementa 0109 con un filtro per-row usando el id de la llamada
--   embebido en notas, migrando SOLO los registros con resultado='pago_prometido'
--   que aún no tienen su id referenciado en cob_gestiones.
--
-- Criterio de selección:
--   - resultado = 'pago_prometido'
--   - org_id IS NOT NULL
--   - el id de la llamada NO aparece en ninguna cob_gestiones.notas con el tag
--
-- Idempotencia:
--   Usa NOT EXISTS con el id de la llamada en el tag de notas.
--   Seguro correrla más de una vez.
--
-- Rollback:
--   Identifica y elimina SOLO las filas insertadas por esta migración usando el tag.
--   created_at NO es confiable aquí porque se preserva la fecha original de la llamada.
--
--   -- Verificar antes de borrar:
--   select id, cliente_id, notas, created_at
--   from public.cob_gestiones
--   where resultado = 'pago_prometido'
--     and tipo_gestion = 'Llamada'
--     and notas like '%[migrado desde llamadas_telemercadeo%'
--     and not exists (
--       select 1 from public.cob_gestiones cg2
--       where cg2.id != public.cob_gestiones.id
--         and cg2.cliente_id = public.cob_gestiones.cliente_id
--         and cg2.notas like '%[migrado desde llamadas_telemercadeo%'
--     );
--
--   -- Borrar (reemplaza <id1>, <id2>... con los IDs confirmados arriba):
--   delete from public.cob_gestiones
--   where resultado = 'pago_prometido'
--     and tipo_gestion = 'Llamada'
--     and notas ~ '\[migrado desde llamadas_telemercadeo [0-9a-f-]{36}\]$';
--
-- Validación previa (debe retornar 16 filas antes de aplicar):
--   select count(*) from public.llamadas_telemercadeo lt
--   where lt.resultado = 'pago_prometido'
--     and lt.org_id is not null
--     and not exists (
--       select 1 from public.cob_gestiones cg
--       where cg.notas like '%[migrado desde llamadas_telemercadeo ' || lt.id::text || '%'
--     );
--
-- Validación posterior (debe retornar 0 filas después de aplicar):
--   select count(*) from public.llamadas_telemercadeo lt
--   where lt.resultado = 'pago_prometido'
--     and lt.org_id is not null
--     and not exists (
--       select 1 from public.cob_gestiones cg
--       where cg.notas like '%[migrado desde llamadas_telemercadeo ' || lt.id::text || '%'
--     );

insert into public.cob_gestiones (
  org_id,
  cliente_id,
  tipo_gestion,
  resultado,
  monto_comprometido,
  fecha_compromiso,
  notas,
  gestionado_por,
  created_at
)
select
  lt.org_id,
  lt.cliente_id,
  'Llamada'                                                                           as tipo_gestion,
  lt.resultado,
  lt.monto_prometido                                                                  as monto_comprometido,
  coalesce(lt.followup_at, lt.followup_fecha)                                         as fecha_compromiso,
  coalesce(lt.notas, '') || ' [migrado desde llamadas_telemercadeo ' || lt.id::text || ']' as notas,
  lt.telemercadista_id                                                                as gestionado_por,
  lt.created_at
from public.llamadas_telemercadeo lt
where lt.resultado = 'pago_prometido'
  and lt.org_id is not null
  and not exists (
    select 1
    from public.cob_gestiones cg
    where cg.notas like '%[migrado desde llamadas_telemercadeo ' || lt.id::text || '%'
  );
