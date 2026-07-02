# Cargo de Vuelta / DFP - Cobranza Automatica

Snapshot local del workflow `jRJAhjnBcXBjBwFE`.

## Cambios locales preparados

- La cadencia ya no se recalcula en n8n. El workflow consume `cadence_step` devuelto por `fn_get_cargo_vuelta_campaign_targets`.
- Se agrega `cobranza_automation_key` por canal con formato:
  `case_id:campaign_type:cadence_step:local_date:channel`
- Las inserciones en `outbox_messages` usan `on_conflict=cobranza_automation_key` y `resolution=ignore-duplicates`.
- Si la insercion no devuelve fila nueva, el workflow no continua a la rama de envio.

## Cadencia canonica esperada

- `formal_amable`
- `recordatorio_corto`
- `revision_interna`
- `ultimo_aviso_legal`

Si `cadence_step` llega vacio o con un valor fuera de ese set, el item se omite. El workflow no inventa etapas locales.

## Trazabilidad actual

- `outbox_messages`: cola operativa e idempotencia por envio/canal.
- `outbox_delivery_attempts`: auditoria tecnica por intento del dispatcher.
- `cob_gestiones`: el snapshot sigue registrando una gestion operativa por item preparado.

## Riesgo pendiente documentado

La gestion operativa del snapshot no tiene aun una llave idempotente propia. En esta iteracion el bloqueo fuerte queda en `outbox_messages`; una version posterior puede mover la escritura operativa a un RPC idempotente ligado al caso.

## QA local sugerido

1. Confirmar que el JSON siga parseando:
   `node -e "JSON.parse(require('fs').readFileSync('docs/n8n/cargo_vuelta_recordatorio_diario.json','utf8')); console.log('ok')"`
2. Verificar que el snapshot ya use `cadence_step`:
   `rg -n "cadence_step|cobranza_automation_key|ignore-duplicates|IF Email Outbox Inserted|IF WhatsApp Outbox Inserted" docs/n8n/cargo_vuelta_recordatorio_diario.json`
3. Revisar que no queden referencias a `dia_1|dia_2|dia_3|dia_4|dia_8_plus`:
   `rg -n "dia_1|dia_2|dia_3|dia_4|dia_8_plus" docs/n8n/cargo_vuelta_recordatorio_diario.json`
