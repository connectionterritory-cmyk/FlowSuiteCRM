# Nota operativa - envio extra de recibo durante validacion del trigger

**Fecha:** 2026-07-04

## Que paso

Durante la validacion manual del trigger `trg_cob_pagos_recibo_automatico` activado el `2026-07-04`, se uso por error el `pago_id = 6864f763-7ab4-4bd7-ba92-c98f96b4d4cf` como caso de prueba de idempotencia.

Ese pago corresponde a un pago de `$100` de Martha Ocon con fecha `2026-06-20`. Se asumio incorrectamente que ya tenia un envio exitoso registrado. En realidad, ese pago no tenia una fila `sent` en `statement_delivery_logs` porque su primer envio ocurrio antes del fix del constraint `document_type`, cuando el log fallaba en silencio.

Por eso la prueba no fue idempotente y se disparo un tercer correo real para ese mismo pago.

## Impacto

- Ningun impacto financiero
- Ningun cambio de balance
- Ninguna duplicacion del registro del pago
- Ninguna afectacion a la cuenta revolving
- Solo un correo de confirmacion repetido

Resultado total para ese pago especifico: Martha recibio `3` correos de confirmacion en vez de `1`.

## Estado actual

Ese `pago_id` ya tiene una fila `sent` correctamente registrada en `statement_delivery_logs` desde el `2026-07-04 23:53 UTC`.

Se confirmo despues con una llamada adicional que la idempotencia ya protege ese pago:

```json
{"ok":true,"skipped":true,"reason":"already_sent"}
```

## Decision

No contactar a Martha proactivamente.

Criterio:

- el contenido del correo era correcto
- no hubo cobro duplicado
- no hubo cambio de balance
- abrir el tema sin que ella lo mencione podria llamar mas atencion a un ruido menor ya corregido

## Mensaje de contingencia

Usar solo si Martha pregunta o se queja por los correos repetidos:

> Martha, gracias por avisarnos. Hubo una duplicacion del correo de confirmacion de pago, pero tu pago y tu balance no se vieron afectados. La confirmacion correcta es la misma que recibiste; el correo repetido fue solo un duplicado de notificacion. Disculpa la molestia.

## Estado del trigger automatico

El trigger `trg_cob_pagos_recibo_automatico` esta activo desde `2026-07-04`, con guarda:

```sql
WHEN (NEW.estado = 'registrado')
```

Tambien quedaron confirmadas:

- conectividad `pg_net -> send-payment-receipt`
- validacion de secreto del worker
- idempotencia funcionando correctamente para pagos nuevos
