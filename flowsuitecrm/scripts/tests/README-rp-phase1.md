# Fase 1 RP: validación local

`rp-phase1.mjs` ejecuta la migración nueva en Postgres WASM (PGlite), con datos
sintéticos. No utiliza credenciales ni conexiones de Supabase.

```sh
npm install --prefix /tmp/rp-phase1-test @electric-sql/pglite@0.5.8
PGLITE_MODULE=/tmp/rp-phase1-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/tests/rp-phase1.mjs
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
```

La fixture conserva tipos de columnas relevantes, políticas de ventas y la
implementación de conversión consultadas en producción el 20 de septiembre de
2026. No es un dump completo: no simula todas las constraints, triggers o RLS de
usuarios/clientes/leads. La concurrencia entre conexiones requiere validación
posterior en un Postgres completo; aquí se prueban reintentos secuenciales,
índice único, transacciones, rollback, permisos y RLS de ventas y sus hijos.

## Decisiones y revisión antes de un futuro despliegue

- Admin aprueba/rechaza dentro de su org; distribuidor dentro de su org y ámbito
  de vendedor/lead propio o de su equipo. Vendedor y telemercadeo no deciden.
- Repetir la misma decisión devuelve el resultado existente. Cambiar una decisión
  final o cambiar la cuenta de una aprobación existente produce error. Se permite
  crear otra orden después de un rechazo, pero solo una pendiente por lead.
- Una sola implementación canónica en `public.fn_convertir_lead_a_cliente`,
  reconciliada con `pg_get_functiondef` de producción (FOR UPDATE y
  lead_not_active incluidos). CREATE OR REPLACE conserva firma y OID; no hay
  schema privado, traslado, fachada ni overload adicional. Se ignora p_actor_id
  del cliente y se obtiene el actor con auth.uid().
- La aprobación escribe `decision_aprobacion_por = auth.uid()` y
  `decision_aprobacion_at = now()` bajo locks antes de llamar a la conversión
  pública. Esta exige la marca protegida en la orden pendiente y vuelve a validar
  organización/rol/ámbito. El trigger prohíbe insertar/falsificar/cambiar auditoría
  desde los roles API. No hay flags de bypass ni GUC controlables por el cliente.
  La marca intermedia solo existe dentro de esa transacción: el resultado final
  aprobado o el rollback se confirma atómicamente, sin pendiente auditada parcial.
  El rechazo también registra actor/fecha; los reintentos no los sobrescriben.
- Consumidores revisados con git grep en TS/TSX/JS/MJS: las únicas llamadas
  frontend a venta_items/venta_transacciones son SELECT en VentasPage.tsx.
  Sus políticas ahora son FOR SELECT y se revocan INSERT/UPDATE/DELETE a anon y
  authenticated; la creación conserva las escrituras mediante RPC SECURITY DEFINER.
  Las pruebas niegan DML por permisos y, restaurando grants solo en la fixture,
  comprueban que RLS por sí sola también impide escrituras de los lectores.
- `LeadConversionAction.tsx` permanece intacto: puede seguir mostrando el botón,
  pero para leads con órdenes RP recibirá el error explícito de aprobación requerida.
- No se introducen estados de pipeline. Crear/rechazar no mueve el lead;
  convertir al aprobar utiliza el `cierre` que ya establece la función existente.
- Las órdenes RP no se eliminan por DML; se conserva la decisión y el vínculo
  para evitar borrar una orden rechazada y eludir la aprobación manualmente.
- No ejecutar el backfill untracked `20260919012125`: su cuerpo no coincide con
  producción. Esta migración compara el MD5 del cuerpo instalado con la versión
  leída de producción: d7e46a5c18298d9dc3ee8593bd6ed08b. Ante cualquier drift,
  falla antes de reemplazar la función. Antes de un despliegue, resolver ese
  archivo por separado; no incluirlo tal como está ni ejecutar su backfill.
- Aplicar la migración antes del frontend en un futuro despliegue coordinado:
  la consulta de ventas solicita las dos columnas nuevas. No hay nueva pantalla
  de aprobación; la operación queda disponible mediante RPC.
- La CLI local de Supabase terminó con código 139; por eso el archivo nuevo se
  creó manualmente con timestamp UTC. No se aplicó a Supabase ni producción.

## Rollback manual de Fase 1

Procedimiento para deshacer `20260920162342_rp_lead_order_approval_phase1.sql`.
Es documentación: no se ha ejecutado este rollback ni se ha aplicado la migración
a producción. El rollback de una llamada fallida a la RPC, probado en PGlite,
no equivale a probar esta reversión de schema.

### 1. Preparar las definiciones inmediatamente anteriores

Antes de aplicar Fase 1, guardar un respaldo de schema y estos resultados de
solo lectura del entorno destino. Las definiciones/ACL deben corresponder al
instante inmediatamente anterior, no a un archivo histórico supuesto equivalente.
Si Fase 1 ya se aplicó y no se dispone del respaldo, detener la reversión hasta
recuperarlo; no reconstruir permisos ni funciones por aproximación.

```sql
SELECT p.oid::regprocedure AS firma, pg_get_functiondef(p.oid) AS definicion,
       md5(p.prosrc) AS source_md5, p.proacl,
       pg_get_userbyid(p.proowner) AS propietario
FROM pg_proc p
WHERE p.oid IN (
  'public.fn_crear_venta_completa(jsonb)'::regprocedure,
  'public.fn_convertir_lead_a_cliente(uuid,uuid)'::regprocedure
);

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ventas', 'venta_items', 'venta_transacciones')
ORDER BY tablename, policyname;

SELECT c.oid::regclass AS tabla, c.relacl,
       pg_get_userbyid(c.relowner) AS propietario
FROM pg_class c
WHERE c.oid IN ('public.venta_items'::regclass,
               'public.venta_transacciones'::regclass);

SELECT attnotnull AS cliente_id_era_not_null
FROM pg_attribute
WHERE attrelid = 'public.ventas'::regclass AND attname = 'cliente_id'
  AND NOT attisdropped;
```

Con ese respaldo, preparar y revisar tres archivos SQL externos al procedimiento:

- `rollback-before/01_functions.sql`: las dos salidas completas de
  `pg_get_functiondef`, terminadas en `;`, conservando firmas, defaults,
  SECURITY DEFINER y search_path originales. Restaurar ambas mediante
  CREATE OR REPLACE, sin DROP, para conservar su identidad/dependencias.
- `rollback-before/02_policies_acl.sql`: recrear las políticas anteriores
  `venta_items_inherit_ventas` y `venta_transacciones_inherit_ventas`, y las
  políticas `venta_items_vendedor_access` / `venta_transacciones_vendedor_access`
  únicamente si existían en el respaldo. Restaurar exactamente las ACL anteriores
  de ambas tablas y ambas RPC reemplazadas: revocar los grants introducidos y
  reponer los revocados, incluidos PUBLIC/anon/authenticated y grant options.
  No basta con añadir GRANT a authenticated. Si una política no existía antes,
  debe quedar ausente. No alterar las otras políticas de ventas.
- `rollback-before/03_cliente_nullability.sql`: una sentencia
  `ALTER TABLE public.ventas ALTER COLUMN cliente_id SET NOT NULL;` si el valor
  anterior era true, o `... DROP NOT NULL;` si era false. Si se requiere SET
  NOT NULL y existen clientes nulos, detenerse y reconciliar los datos antes.

La conversión previa consultada tiene MD5 de cuerpo
`d7e46a5c18298d9dc3ee8593bd6ed08b`, FOR UPDATE y `lead_not_active`.
**Nunca usar `20260919012125_create_fn_convertir_lead_a_cliente.sql` para
restaurarla:** ese backfill omite ambas protecciones. La definición de creación
de venta debe salir del respaldo inmediatamente anterior; no ejecutar toda 0114
ni otras migraciones históricas como sustituto del respaldo.

### 2. Detener escrituras y comprobar los datos

Poner la aplicación y workers en mantenimiento y detener creación, conversión y
decisiones antes de iniciar. Preparar el frontend anterior, que no consulta las
columnas nuevas; reactivarlo solo después de completar y verificar el rollback.
Guardar también un respaldo de datos actual.

Este procedimiento está permitido **solo si no existen órdenes RP del nuevo
modelo**. Comprobación preliminar de solo lectura:

```sql
SELECT estado_aprobacion, count(*) AS ordenes
FROM public.ventas
WHERE lead_id IS NOT NULL OR estado_aprobacion <> 'no_aplica'
   OR decision_aprobacion_por IS NOT NULL OR decision_aprobacion_at IS NOT NULL
GROUP BY estado_aprobacion;
```

Debe devolver cero filas. Si hay pendientes, rechazadas o aprobadas, **no continuar
ni borrar registros/columnas para forzar la condición**. Mantener el schema y
preparar un plan separado, revisado, de migración de datos que preserve ventas,
items, transacciones, vínculo al lead, clientes convertidos y auditoría. Este
documento no autoriza eliminar órdenes ni desconvertir clientes. Tampoco basta
con exportar un CSV o poner todos los estados en no_aplica.

### 3. Ejecutar la reversión en este orden, en una sola transacción

El bloque siguiente es para una sesión futura de psql con los tres archivos
revisados en `rollback-before/`, relativos al script de rollback. ON_ERROR_STOP
debe permanecer activo. No ejecutar fragmentos independientes ni usar CASCADE.
Si falta un archivo, hay una dependencia inesperada o falla una sentencia,
abortar y ejecutar ROLLBACK; no continuar hasta COMMIT. Mantener todas las
escrituras externas detenidas durante la operación.

```sql
\set ON_ERROR_STOP on
BEGIN;
LOCK TABLE public.leads, public.ventas, public.venta_items,
           public.venta_transacciones IN ACCESS EXCLUSIVE MODE;

-- Revalidar bajo locks; la consulta preliminar no basta ante concurrencia.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ventas
    WHERE lead_id IS NOT NULL OR estado_aprobacion <> 'no_aplica'
       OR decision_aprobacion_por IS NOT NULL OR decision_aprobacion_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Rollback bloqueado: existen órdenes RP o auditoría que preservar';
  END IF;
END;
$$;

-- 3.1 Retirar las políticas nuevas/reemplazadas antes de quitar sus columnas.
DROP POLICY ventas_lead_owner_read ON public.ventas;
DROP POLICY venta_items_inherit_ventas ON public.venta_items;
DROP POLICY venta_transacciones_inherit_ventas ON public.venta_transacciones;

-- 3.2 Retirar primero el trigger, después su función y la RPC de decisión.
DROP TRIGGER guard_venta_aprobacion ON public.ventas;
DROP FUNCTION public.guard_venta_aprobacion();
DROP FUNCTION public.fn_aprobar_rechazar_venta(uuid, text, text);

-- 3.3 Restaurar ambas funciones públicas inmediatamente anteriores.
\ir rollback-before/01_functions.sql

-- 3.4 Restaurar políticas y privilegios inmediatamente anteriores.
\ir rollback-before/02_policies_acl.sql

-- 3.5 Eliminar exactamente los tres índices añadidos.
DROP INDEX public.ventas_lead_pendiente_unique;
DROP INDEX public.ventas_org_aprobacion_idx;
DROP INDEX public.ventas_lead_id_idx;

-- 3.6 Eliminar checks y FKs nuevos (incluidos los nombres implícitos de PG).
ALTER TABLE public.ventas
  DROP CONSTRAINT ventas_lead_aprobacion_check,
  DROP CONSTRAINT ventas_decision_auditoria_check,
  DROP CONSTRAINT ventas_estado_aprobacion_check,
  DROP CONSTRAINT ventas_lead_id_fkey,
  DROP CONSTRAINT ventas_decision_aprobacion_por_fkey;

-- 3.7 Eliminar las cuatro columnas nuevas y restaurar nulabilidad previa.
ALTER TABLE public.ventas
  DROP COLUMN decision_aprobacion_por,
  DROP COLUMN decision_aprobacion_at,
  DROP COLUMN estado_aprobacion,
  DROP COLUMN lead_id;
\ir rollback-before/03_cliente_nullability.sql

-- Ejecutar aquí las consultas de verificación de la sección 4.
-- Comparar con el respaldo ANTES de confirmar. Ante diferencias: ROLLBACK.
-- Solo si todo coincide:
COMMIT;
```

### 4. Verificación post-rollback: consultas de solo lectura

Ejecutar antes de COMMIT y repetir después. La primera consulta debe devolver
cero filas; las siguientes deben coincidir con el respaldo inmediatamente previo.
No utilizar una creación de venta real como comprobación.

```sql
SELECT 'columna' AS tipo, attname AS nombre
FROM pg_attribute
WHERE attrelid = 'public.ventas'::regclass AND NOT attisdropped
  AND attname IN ('lead_id', 'estado_aprobacion',
                  'decision_aprobacion_por', 'decision_aprobacion_at')
UNION ALL
SELECT 'constraint', conname FROM pg_constraint
WHERE conrelid = 'public.ventas'::regclass
  AND conname IN ('ventas_lead_aprobacion_check', 'ventas_decision_auditoria_check',
                  'ventas_estado_aprobacion_check', 'ventas_lead_id_fkey',
                  'ventas_decision_aprobacion_por_fkey')
UNION ALL
SELECT 'indice', indexname FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'ventas'
  AND indexname IN ('ventas_lead_pendiente_unique', 'ventas_org_aprobacion_idx',
                    'ventas_lead_id_idx')
UNION ALL
SELECT 'trigger', tgname FROM pg_trigger
WHERE tgrelid = 'public.ventas'::regclass AND tgname = 'guard_venta_aprobacion'
UNION ALL
SELECT 'funcion', p.proname FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('guard_venta_aprobacion', 'fn_aprobar_rechazar_venta')
UNION ALL
SELECT 'politica', policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'ventas'
  AND policyname = 'ventas_lead_owner_read';

SELECT p.oid::regprocedure AS firma, md5(p.prosrc) AS source_md5,
       pg_get_functiondef(p.oid) AS definicion, p.proacl,
       pg_get_userbyid(p.proowner) AS propietario
FROM pg_proc p
WHERE p.oid IN (
  'public.fn_crear_venta_completa(jsonb)'::regprocedure,
  'public.fn_convertir_lead_a_cliente(uuid,uuid)'::regprocedure
);

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ventas', 'venta_items', 'venta_transacciones')
ORDER BY tablename, policyname;

SELECT c.oid::regclass AS tabla, c.relacl,
       pg_get_userbyid(c.relowner) AS propietario
FROM pg_class c
WHERE c.oid IN ('public.venta_items'::regclass,
               'public.venta_transacciones'::regclass);

SELECT attnotnull AS cliente_id_es_not_null
FROM pg_attribute
WHERE attrelid = 'public.ventas'::regclass AND attname = 'cliente_id'
  AND NOT attisdropped;
```

Tras verificar, reactivar el frontend anterior. Si hubo un despliegue real,
registrar la reversión como un cambio correctivo revisado en el historial del
entorno; no borrar manualmente filas de `supabase_migrations.schema_migrations`
ni editar migraciones históricas para ocultar lo ocurrido.
