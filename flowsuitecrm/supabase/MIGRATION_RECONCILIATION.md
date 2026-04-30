# Supabase Migration Reconciliation

Fecha de revision: 2026-04-29

## Decision Canonica

`flowsuitecrm/supabase` es la carpeta Supabase canonica operativa.

`supabase/` en la raiz del repo queda como carpeta legacy/bootstrap hasta una decision posterior. No debe borrarse, moverse ni usarse como fuente de verdad sin una reconciliacion explicita.

## Estado Actual

El MCP de Supabase esta sano y opera en modo read-only real contra el proyecto remoto `rxiarmbosgivaplygqug`.

Las migraciones `0126` a `0129` estan en HOLD. No deben pasar a preflight ni aplicarse hasta cerrar esta reconciliacion.

Reglas actuales:

- No aplicar `0126` a `0129`.
- No ejecutar `supabase migration repair` sin plan explicito.
- No borrar ni mover migraciones.
- No cambiar SQL historico durante esta etapa.
- No usar `DROP VIEW CASCADE` a ciegas.
- Ejecutar preflight + GATE 8 solo despues de cerrar la reconciliacion.

## Tabla de Reconciliacion

| Version remota | Nombre remoto | Archivo canonico equivalente | Archivo legacy equivalente | Riesgo | Accion recomendada |
| --- | --- | --- | --- | --- | --- |
| `0073` | `personas_anchor` | No equivalente. Colisiona con `flowsuitecrm/supabase/migrations/0073_citas_timezone.sql`. | `supabase/migrations/0073_personas_anchor.sql` | Alto. La misma version remota/local representa SQL distinto. | Documentar como migracion legacy ya aplicada en remoto. No renumerar ni reparar sin plan. |
| `0074` | `personas_autolink` | No equivalente. Colisiona con `flowsuitecrm/supabase/migrations/0074_message_templates.sql`. | `supabase/migrations/0074_personas_autolink.sql` | Alto. Colision historica por version. | Documentar equivalencia remota a legacy. Mantener HOLD. |
| `0075` | `personas_autolink_lead_fallback` | No equivalente. Colisiona con `flowsuitecrm/supabase/migrations/0075_outbox_messages.sql`. | `supabase/migrations/0075_personas_autolink_lead_fallback.sql` | Alto. Colision historica por version. | Documentar equivalencia remota a legacy. Mantener HOLD. |
| `0076` | `personas_rls` | No equivalente. Colisiona con `flowsuitecrm/supabase/migrations/0076_fix_actividades_naming.sql`. | `supabase/migrations/0076_personas_rls.sql` | Alto. Colision historica por version. | Documentar equivalencia remota a legacy. Mantener HOLD. |
| `0109` | `backfill_gestiones_from_llamadas` | No encontrado. | No encontrado. | Alto. El remoto tiene una migracion aplicada que el repo no puede reproducir. | Recuperar el SQL desde backup, autor, dashboard, historial externo o evidencia suficiente antes de avanzar. |
| `0114` | `cartera_case_opening_core` | No exacto. Existe `flowsuitecrm/supabase/migrations/0114_rpc_ventas_subtotal_desde_payload.sql`. | No encontrado. | Medio/alto. Nombre remoto y archivo canonico no corresponden. | Confirmar SQL real aplicado y mapear contra `0115_cartera_case_opening_core.sql`. |
| `0115` | `cartera_case_opening_core` | `flowsuitecrm/supabase/migrations/0115_cartera_case_opening_core.sql` | No encontrado. | Medio. El remoto muestra `0114` y `0115` relacionados con cartera. | Verificar si `0114` fue un nombre remoto incorrecto, duplicado o reparacion historica. |
| `20260426232649` | `0112_rpc_ventas_completas` | `flowsuitecrm/supabase/migrations/20260426232649_remote_history_alignment.sql` | No encontrado. | Medio. Archivo canonico es un no-op intencional, no el SQL funcional. | Mantener como bridge/no-op y documentar que existe para alinear una version ya presente en remoto. |
| `20260427163925` | `0121_cob_dfp_terminologia_comments` | `flowsuitecrm/supabase/migrations/0121_cob_dfp_terminologia_comments.sql` | No encontrado. | Bajo/medio. Version remota timestamped con archivo local numerado. | Aceptar equivalencia documentada. |
| `20260427170307` | `0122_cob_revolving_security_definer_functions` | `flowsuitecrm/supabase/migrations/0122_cob_revolving_security_definer_functions.sql` | No encontrado. | Bajo/medio. Version remota timestamped con archivo local numerado. | Aceptar equivalencia documentada. |
| `20260427180143` | `0123_v_dfp_caso_resumen` | `flowsuitecrm/supabase/migrations/0123_v_dfp_caso_resumen.sql` | No encontrado. | Bajo/medio. Version remota timestamped con archivo local numerado. | Aceptar equivalencia documentada. |
| `20260427224918` | `0124_cob_dfp_rls_hardening` | `flowsuitecrm/supabase/migrations/0124_cob_dfp_rls_hardening.sql` | No encontrado. | Bajo/medio. Version remota timestamped con archivo local numerado. | Aceptar equivalencia documentada. |
| `20260427235627` | `0125_fn_registrar_pago_revolving` | `flowsuitecrm/supabase/migrations/0125_fn_registrar_pago_revolving.sql` | No encontrado. | Bajo/medio. Version remota timestamped con archivo local numerado. | Aceptar equivalencia documentada. |

## Hallazgos Clave

### Colisiones `0073` a `0076`

El remoto registra:

- `0073 personas_anchor`
- `0074 personas_autolink`
- `0075 personas_autolink_lead_fallback`
- `0076 personas_rls`

La carpeta canonica actual usa esas mismas versiones para otros cambios:

- `0073_citas_timezone.sql`
- `0074_message_templates.sql`
- `0075_outbox_messages.sql`
- `0076_fix_actividades_naming.sql`

Los archivos `personas_*` existen en `supabase/migrations`, que queda clasificada como legacy. Esta es una colision historica fuerte y no debe resolverse con `migration repair` sin un plan explicito.

### Faltante Critico `0109`

El remoto registra `0109_backfill_gestiones_from_llamadas`.

No se encontro archivo equivalente en:

- `flowsuitecrm/supabase/migrations`
- `supabase/migrations`
- historial git local por nombre

Este es el hueco mas serio: la base remota tiene una migracion aplicada que el repo no puede reproducir.

### Desalineacion `0114` y `0115`

El remoto registra:

- `0114 cartera_case_opening_core`
- `0115 cartera_case_opening_core`

La carpeta canonica contiene:

- `0114_rpc_ventas_subtotal_desde_payload.sql`
- `0115_cartera_case_opening_core.sql`

Antes de cualquier preflight se debe confirmar cual SQL real corresponde a `0114` remoto y si fue una desalineacion de nombre, una reparacion historica o una migracion duplicada.

### Bloque Timestamped `0121` a `0125`

El remoto registra `0121` a `0125` con versiones timestamped:

- `20260427163925 0121_cob_dfp_terminologia_comments`
- `20260427170307 0122_cob_revolving_security_definer_functions`
- `20260427180143 0123_v_dfp_caso_resumen`
- `20260427224918 0124_cob_dfp_rls_hardening`
- `20260427235627 0125_fn_registrar_pago_revolving`

La carpeta canonica contiene archivos numerados equivalentes `0121` a `0125`. Esta equivalencia se considera aceptable, pero debe permanecer documentada porque las versiones remotas no son los numeros humanos del archivo local.

### Bridge `20260426232649`

`flowsuitecrm/supabase/migrations/20260426232649_remote_history_alignment.sql` es un no-op intencional:

```sql
BEGIN;
SELECT 1;
COMMIT;
```

Su proposito documentado es alinear una version ya presente en remoto y evitar reparar historial sin contexto adicional.

## Criterios Para Liberar `0126` a `0129`

`0126` a `0129` pueden pasar a preflight solo cuando se cumpla todo lo siguiente:

- `0109_backfill_gestiones_from_llamadas` este recuperada o documentada con evidencia suficiente.
- Las colisiones `0073` a `0076` esten aceptadas formalmente como legacy aplicado remoto vs canonico operativo local.
- La desalineacion `0114`/`0115` tenga una explicacion verificable.
- El bloque timestamped `0121` a `0125` este aceptado como equivalencia remota/local.
- Se confirme que `flowsuitecrm/supabase` representa fielmente el estado remoto para efectos operativos.

Despues de cerrar estos puntos, el orden permitido es:

1. Ejecutar preflight.
2. Ejecutar GATE 8.
3. Si GATE 8 esta vacio, aplicar `0126` a `0129`.
4. Ejecutar post-check.
5. Probar Catalogo, Importaciones y Ventas.
