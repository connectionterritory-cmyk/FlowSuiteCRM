# Bot de Citas Telegram — Arquitectura

## Objetivo
Habilitar un flujo de citas por Telegram usando `bot_sessions` como máquina de estados y creando `leads` + `citas` vía `service_role`.

## Componentes
1. **Edge Function** `bot-telegram` (webhook handler).
2. **Tabla** `bot_sessions` (ya creada en `0080_bot_sessions.sql`).
3. **Cleanup**: ejecutar `cleanup_bot_sessions()` cada cierto tiempo (cron externo o n8n).

## Variables de entorno requeridas
- `CUSTOM_SUPABASE_URL`
- `SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `BOT_DEFAULT_OWNER_ID`

## Variables opcionales
- `TELEGRAM_WEBHOOK_SECRET` (header `X-Telegram-Bot-Api-Secret-Token`)
- `BOT_DEFAULT_ASSIGNED_TO`
- `BOT_DEFAULT_ORG_ID` (se guarda en `slots.org_id`)
- `BOT_DEFAULT_INTENT` (default `citas`)
- `BOT_TIMEZONE` (default `America/New_York`)
- `BOT_TZ_OFFSET` (default `-04:00`)
- `BOT_DEFAULT_DURATION_MINUTES` (default `60`)

## Flujo conversacional (steps)
`ask_nombre → ask_telefono → ask_motivo → ask_fecha → ask_hora → confirmar → done`

## Inserción de datos
- **Lead**: se busca por `telefono`; si no existe se crea con `owner_id` y `fuente = 'telegram'`.
- **Cita**: se crea con `contacto_tipo = 'lead'`, `contacto_id = leadId`, `owner_id` obligatorio y `assigned_to` opcional.

## Cleanup
Programar un job externo para ejecutar:
```
select public.cleanup_bot_sessions();
```
Frecuencia sugerida: cada 15–30 minutos.
