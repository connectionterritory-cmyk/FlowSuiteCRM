# Diagnóstico DFP / outbox - 2026-07-04

## Aclaración `43 vs 10`

La discrepancia entre `43` y `10` no fue por ambiente equivocado sino por parámetros distintos al invocar la RPC `fn_get_cargo_vuelta_campaign_targets`.

- Proyecto consultado: producción `rxiarmbosgivaplygqug`
- Corrida inicial que devolvió `10`: `p_max_auto_attempts=7`, `p_recent_payment_days=7`, `p_daily_cooldown_hours=20`
- Corrida correcta para comparar con el reporte diario, ejecutada el `2026-07-04`:

```json
{
  "p_org_id": "00000000-0000-0000-0000-000000000001",
  "p_today": "2026-07-04",
  "p_max_auto_attempts": 10,
  "p_recent_payment_days": 3,
  "p_daily_cooldown_hours": 20,
  "p_mock": false
}
```

Con esos argumentos exactos, la RPC devuelve `43` elegibles. Dentro de ese pool de `43`, sí aparecen `4` de los `7 contact_id` reciclados entre `2026-06-25` y `2026-07-04`.

Conclusión corregida: el problema ya no es "los reciclados no están en la RPC", sino que el comportamiento observado en producción sigue siendo anómalo incluso dentro del pool correcto de `43`, porque solo se re-encolan `7` contactos únicos durante `10` días y siempre en tandas exactas de `3` filas por día.

## Hallazgo 1 - generador desalineado / recorte no identificado

El snapshot esperado del workflow DFP sí usa la RPC `fn_get_cargo_vuelta_campaign_targets` en `Get Campaign Targets` y luego inserta en `outbox_messages` con `on_conflict=cobranza_automation_key` en [cargo_vuelta_recordatorio_diario.json](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/docs/n8n/cargo_vuelta_recordatorio_diario.json:50) y [cargo_vuelta_recordatorio_diario.json](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/docs/n8n/cargo_vuelta_recordatorio_diario.json:133).

Pero en producción hay una desalineación importante:

- La ejecución observable en datos no se comporta como un barrido amplio del pool real de `43`.
- Entre `2026-06-25` y `2026-07-04` se generan exactamente `30` filas, siempre `3` por día.
- Esas `30` filas corresponden a solo `7 contact_id` únicos, reciclados durante varios días.
- Producción no tiene la columna `cobranza_automation_key`, por lo que el snapshot endurecido del `2026-07-02` no puede ser el flujo que está corriendo tal cual hoy.

Diagnóstico: el generador activo está desalineado respecto al snapshot esperado. Las posibilidades abiertas siguen siendo:

- workflow viejo o paralelo publicado en n8n
- nodo fuente que no usa la RPC esperada
- filtro/recorte posterior que reduce el lote antes de insertar
- dataset alterno de prueba, whitelist o query vieja

Pendiente de verificación manual en n8n: identificar el workflow realmente activo, el nodo fuente exacto y el punto donde el lote se reduce a `3`, si ese recorte ocurre dentro del flujo.

## Hallazgo 2 - `dispatch-outbox-n8n` sin consumo desde 2026-06-30

La evidencia de producción separa este problema del hallazgo del generador.

Entre `2026-06-25` y `2026-07-04` las filas DFP afectadas en `outbox_messages` tienen este patrón:

- `30` filas exactas
- `7 contact_id` únicos
- `3` filas por día
- `canal='email'`
- `dispatch_provider='n8n'`
- `status='programado'` o `retry_pending`
- `attempt_count=0`
- `locked_at=null`
- `locked_by=null`
- `n8n_execution_id=null`
- `dispatched_to_n8n_at=null`

Eso demuestra que esas filas se insertan, pero no están siendo reclamadas por el consumidor de n8n.

El código local lo respalda:

- `process-outbox` excluye explícitamente `dispatch_provider='n8n'` en [process-outbox/index.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/supabase/functions/process-outbox/index.ts:759)
- `dispatch-outbox-message` también deja esos registros solo en cola en [dispatch-outbox-message/index.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/supabase/functions/dispatch-outbox-message/index.ts:238)
- el consumidor previsto es `dispatch-outbox-n8n`, que hace el claim de pendientes en [dispatch-outbox-n8n/index.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/supabase/functions/dispatch-outbox-n8n/index.ts:233)

Diagnóstico: el dispatcher de n8n no está consumiendo estas filas desde al menos `2026-06-30`, y la serie observada sugiere que tampoco las venía reclamando en los días previos de esa misma ventana.

## Checklist manual de 12 puntos

Usar el dominio correcto: `https://n8n-n8n.fatnhd.easypanel.net/`

1. Iniciar sesión en la instancia n8n y buscar workflows por `cargo`, `dfp`, `cobranza`, `outbox`, `royal` e `hycite`.
2. Identificar cuál workflow DFP/cobranza está `Active` hoy y revisar si hay más de uno activo en paralelo.
3. Abrir el workflow candidato y ubicar el nodo fuente de destinatarios.
4. Confirmar si ese nodo llama a `fn_get_cargo_vuelta_campaign_targets`, o si usa otra query, tabla, vista, lista fija o nodo `Code`.
5. Si sí llama a la RPC, validar los parámetros exactos que usa: `p_org_id`, `p_today`, `p_max_auto_attempts`, `p_recent_payment_days`, `p_daily_cooldown_hours`, `p_mock`.
6. Revisar inmediatamente después del nodo fuente si hay `Limit`, `Split in Batches`, `IF`, `Filter`, `Code`, `Set` o cualquier otro nodo que reduzca el lote.
7. Abrir la ejecución del `2026-07-04` y comparar cuántas filas salen del nodo fuente contra cuántas llegan al nodo que inserta en `outbox_messages`.
8. Revisar el nodo que inserta en `outbox_messages` y confirmar si usa `on_conflict=cobranza_automation_key`; si lo usa, ese snapshot no puede estar funcionando tal cual contra esta producción.
9. Buscar en n8n cualquier workflow que invoque `dispatch-outbox-n8n`, sea por URL, por nombre, o por headers como `X-FlowSuite-Worker-Secret`.
10. Revisar el historial de ejecuciones de ese trigger desde `2026-06-30` para detectar si se desactivó, dejó de correr, empezó a fallar con `401`, o perdió secretos.
11. Si el trigger no está en n8n, revisar el scheduler externo real: EasyPanel, Supabase cron, Vercel Cron o GitHub Actions.
12. Guardar evidencia mínima para el fix: nombre del workflow activo, captura del nodo fuente, captura del nodo de inserción, captura de la ejecución del `2026-07-04` y captura del trigger que dispara `dispatch-outbox-n8n`.

## Estado: pendiente de verificación manual en n8n

Resultados de la checklist: completar después de revisar n8n.
