# Notificaciones diarias de cuotas DFP

## Funcion

`dfp-daily-cuota-notifications` se ejecuta una vez al dia y calcula la fecha actual en `America/New_York`.

El flujo:

1. Busca cuotas en `cob_plan_cuotas` con `fecha_vencimiento` hoy, manana y en 2 dias.
2. Para cuotas que vencen hoy, envia un resumen interno al operador:
   - Email: `OPERATOR_EMAIL_TO` (default `patrospi@hotmail.com`)
   - Telegram: `TELEGRAM_OPERATOR_CHAT_ID`
3. Para cuotas que vencen manana o en 2 dias, crea filas en `outbox_messages`:
   - `canal = 'whatsapp'`
   - `status = 'programado'`
   - `dispatch_provider = 'n8n'`
   - `contexto_tipo = 'cobranza'`

La funcion no envia WhatsApp ni SMS directamente. n8n debe reclamar las filas de `outbox_messages` y hacer el envio real.

## Variables

Requeridas:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OPERATOR_CHAT_ID`

Opcionales segun proveedor existente:

- `OPERATOR_EMAIL_TO=patrospi@hotmail.com`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `DFP_DAILY_WORKER_SECRET`

## Idempotencia

Los recordatorios de cliente usan:

```text
dfp_cuota_reminder:{cuota_id}:{fecha_notificacion}:{canal}
```

Esa llave queda en `outbox_messages.dfp_notification_key` con indice unico parcial. Si la funcion corre dos veces el mismo dia, no se crea otro mensaje para la misma cuota/canal/fecha.

Los resumenes internos quedan en `dfp_notification_events` con llave:

```text
dfp_cuota_summary:{fecha_notificacion}:{canal}
```

## Datos de tarjeta

El texto de tarjeta se arma desde `cob_metodos_pago.display`, `brand` y `last4`.

Ejemplo seguro:

```text
tu tarjeta Visa terminada en 1234
```

No se debe escribir PAN completo, CVV ni datos sensibles. Este flujo no crea `nota_tarjeta` en `clientes`.

## QA manual

1. Crear o seleccionar un cliente QA con telefono de prueba y un metodo de pago en `cob_metodos_pago`:

```sql
insert into public.cob_metodos_pago (
  org_id, cliente_id, cargo_vuelta_case_id, provider, token_ref,
  display, brand, last4, is_default, estado, source
) values (
  '<org_id>', '<cliente_id>', '<case_id>', 'manual', 'qa-token-no-pan',
  'tu tarjeta Visa terminada en 1234', 'visa', '1234', true, 'activo', 'manual'
);
```

2. Crear un plan DFP activo y tres cuotas QA: una con `fecha_vencimiento = current_date`, una con `current_date + 1` y una con `current_date + 2`.

3. Invocar la funcion:

```bash
supabase functions invoke dfp-daily-cuota-notifications --project-ref <ref> --no-verify-jwt
```

Si `DFP_DAILY_WORKER_SECRET` esta configurado, enviar el header `X-FlowSuite-Worker-Secret`.

4. Validar:

```sql
select dfp_notification_key, canal, status, dispatch_provider, mensaje_resuelto
from public.outbox_messages
where dfp_notification_key like 'dfp_cuota_reminder:%'
order by created_at desc;

select notification_key, channel, scope, status, error_message
from public.dfp_notification_events
where notification_key like 'dfp_cuota_summary:%'
order by created_at desc;
```

5. Ejecutar la funcion una segunda vez y confirmar que el conteo de filas con la misma `dfp_notification_key` sigue en 1.

Confirmaciones de seguridad:

- No hay escrituras en `cob_financial_ledger`.
- No se registran pagos reales.
- No se debitan tarjetas.
- No se envia WhatsApp real desde Supabase en QA; solo se crean filas para n8n.
