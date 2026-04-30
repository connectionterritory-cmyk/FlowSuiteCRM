# Campanas WhatsApp con n8n

## Diagnostico actual

- `mk_campaigns` guarda la campana: nombre, segmento, canal, plantilla, mensaje base, owner y estado.
- `mk_messages` guarda un mensaje materializado por contacto y se enlaza con `outbox_messages.outbox_message_id`.
- `outbox_messages` es la cola operativa. Para campanas WhatsApp debe quedar con `canal = 'whatsapp'`, `status = 'programado'`, `contexto_tipo = 'campaign'` y `dispatch_provider = 'n8n'`.
- `outbox_delivery_attempts` audita los intentos del dispatcher n8n.
- `clientes`, `leads` y `contactos` ahora tienen consentimiento minimo: `whatsapp_opt_in`, `whatsapp_no_molestar`, `whatsapp_ultimo_envio_at`, `whatsapp_consent_source`, `whatsapp_consented_at`.

## Auditoria de tablas

### `mk_campaigns`

- PK: `id uuid`.
- Guarda metadata de campana: `nombre`, `descripcion`, `segmento_key`, `canal`, `template_key`, `owner_id`, `estado`, `total_contactos`.
- Campos posteriores usados por el flujo: `mensaje_base`, `segment_params`, `dispatched_at`, `completed_at`.

### `mk_messages`

- PK: `id uuid`.
- FK: `campaign_id -> mk_campaigns.id`.
- Mensaje materializado por contacto: `contacto_tipo`, `contacto_id`, `telefono`, `nombre`, `mensaje_texto`, `canal`, `status`.
- FK operativa: `outbox_message_id -> outbox_messages.id`.

### `outbox_messages`

- PK real: `id uuid`.
- No usa `outbox_message_id` como PK. Ese nombre solo existe en `mk_messages.outbox_message_id` para referenciar `outbox_messages.id`.
- Cola real del worker: `canal`, `destinatario`, `mensaje`, `mensaje_resuelto`, `status`, `scheduled_for`, `retry_after`, `locked_at`, `locked_by`, `attempt_count`.
- Para n8n: `dispatch_provider = 'n8n'`, `n8n_execution_id`, `dispatched_to_n8n_at`, `provider`, `provider_message_id`, `provider_response`.

### `outbox_delivery_attempts`

- PK: `id uuid`.
- FK: `outbox_message_id -> outbox_messages.id`.
- Audita cada intento: `attempt_number`, `dispatcher`, `status`, `request_payload`, `response_payload`, `error_message`.

### `clientes`, `leads`, `contactos`

- Fuente de elegibilidad WhatsApp:
  - `whatsapp_opt_in = true`
  - `whatsapp_no_molestar = false`
  - telefono no nulo/no vacio y valido en UI
- `whatsapp_ultimo_envio_at` se actualiza cuando `outbox_messages.status` pasa a `enviado`.

## Plan tecnico minimo

1. El CRM crea la campana WhatsApp en `mk_campaigns`.
2. El CRM selecciona el segmento y filtra contactos con telefono valido, `whatsapp_opt_in = true` y `whatsapp_no_molestar = false`.
3. El CRM materializa una fila por contacto en `mk_messages`.
4. Al programar, el CRM inserta una fila por contacto en `outbox_messages` con `status = 'programado'` y `dispatch_provider = 'n8n'`.
5. n8n procesa solo mensajes elegibles de `outbox_messages`; no debe leer `mk_messages` como cola primaria.
6. El proveedor WhatsApp queda detras del workflow n8n. Si no hay credenciales, el nodo HTTP Request queda preparado pero deshabilitado o apuntando a un mock.

## Workflow n8n

### 1. Trigger

Usar un Schedule Trigger cada 1-5 minutos, o un Webhook interno llamado por cron.

### 2. Reclamar mensajes programados

Usar el RPC atomico:

```sql
select *
from public.fn_claim_outbox_messages_for_n8n(50);
```

El RPC:

- Filtra `dispatch_provider = 'n8n'`.
- Filtra `canal = 'whatsapp'`.
- Toma `status in ('programado', 'retry_pending')`.
- Respeta `retry_after` y `scheduled_for` vencidos.
- Usa `FOR UPDATE SKIP LOCKED`.
- Cambia a `status = 'en_proceso'`.
- Setea `locked_at`, `locked_by = 'n8n'`.
- Incrementa `attempt_count`.
- Retorna los mensajes reclamados.

### 3. Split In Batches

Procesar cada fila reclamada de forma individual. Usar `id` como idempotency key base.

### 4. Enviar al proveedor WhatsApp

Nodo HTTP Request preparado. Si no hay credenciales, dejar provider mock:

- Method: `POST`
- URL: variable n8n `WHATSAPP_PROVIDER_URL`
- Headers: `Authorization`, `Content-Type: application/json`, `Idempotency-Key: outbox:{id}:{attempt_count}`
- Body minimo:

```json
{
  "to": "{{$json.destinatario}}",
  "message": "{{$json.mensaje_resuelto || $json.mensaje}}",
  "metadata": {
    "outbox_message_id": "{{$json.id}}",
    "contact_tipo": "{{$json.contact_tipo}}",
    "contact_id": "{{$json.contact_id}}",
    "campaign": true
  }
}
```

Respuesta mock minima si no hay proveedor:

```json
{
  "ok": true,
  "provider": "mock_whatsapp",
  "provider_message_id": "mock_{{$json.id}}"
}
```

### 5. Auditar intento

Insertar en `outbox_delivery_attempts` por cada mensaje procesado:

```sql
insert into public.outbox_delivery_attempts (
  outbox_message_id,
  org_id,
  attempt_number,
  dispatcher,
  status,
  request_payload,
  response_payload,
  error_message
)
values (
  :message_id,
  :org_id,
  :attempt_count,
  'n8n',
  :attempt_status,
  :request_payload,
  :response_payload,
  :error_message
);
```

### 6. Actualizar status

Exito:

```sql
update public.outbox_messages
set status = 'enviado',
    sent_at = now(),
    provider = coalesce(:provider, 'mock_whatsapp'),
    provider_message_id = :provider_message_id,
    provider_response = :raw_response,
    dispatched_to_n8n_at = now(),
    locked_at = null,
    locked_by = null,
    error_message = null
where id = :message_id;
```

Falla retryable:

```sql
update public.outbox_messages
set status = 'retry_pending',
    retry_after = now() + interval '5 minutes',
    error_message = :error_message,
    provider_response = :raw_response,
    locked_at = null,
    locked_by = null
where id = :message_id;
```

Falla final:

```sql
update public.outbox_messages
set status = 'fallido',
    failed_at = now(),
    error_message = :error_message,
    provider_response = :raw_response,
    locked_at = null,
    locked_by = null
where id = :message_id;
```

## Smoke test manual

1. Marcar un cliente o lead con `whatsapp_opt_in = true` y `whatsapp_no_molestar = false`.
2. Crear una campana WhatsApp desde Marketing Flow.
3. Elegir segmento, plantilla y fecha.
4. Confirmar programacion.
5. Verificar:

```sql
select canal, status, dispatch_provider, contexto_tipo, count(*)
from public.outbox_messages
where contexto_tipo = 'campaign'
group by 1, 2, 3, 4;
```

Debe aparecer `whatsapp / programado / n8n / campaign`.

## Smoke test SQL

### Mensajes programados

```sql
select id, canal, status, contexto_tipo, dispatch_provider, scheduled_for, destinatario
from public.outbox_messages
where contexto_tipo = 'campaign'
  and dispatch_provider = 'n8n'
order by created_at desc
limit 20;
```

### Claim RPC cambia a en proceso

```sql
select id, status, locked_by, locked_at, attempt_count
from public.fn_claim_outbox_messages_for_n8n(5);
```

Debe retornar filas con `status = 'en_proceso'`, `locked_by = 'n8n'` y `attempt_count >= 1`.

### Simular envio exitoso

```sql
update public.outbox_messages
set status = 'enviado',
    sent_at = now(),
    provider = 'mock_whatsapp',
    provider_message_id = 'mock_' || id::text,
    provider_response = jsonb_build_object('ok', true, 'provider', 'mock_whatsapp'),
    locked_at = null,
    locked_by = null,
    error_message = null
where dispatch_provider = 'n8n'
  and canal = 'whatsapp'
  and status = 'en_proceso'
returning id, status, provider, provider_message_id, sent_at;
```

### Auditar intento

```sql
insert into public.outbox_delivery_attempts (
  outbox_message_id,
  org_id,
  attempt_number,
  dispatcher,
  status,
  request_payload,
  response_payload
)
select id,
       org_id,
       attempt_count,
       'n8n',
       'sent',
       jsonb_build_object('to', destinatario, 'message', coalesce(mensaje_resuelto, mensaje)),
       jsonb_build_object('ok', true, 'provider', 'mock_whatsapp')
from public.outbox_messages
where dispatch_provider = 'n8n'
  and canal = 'whatsapp'
  and status = 'enviado'
order by sent_at desc
limit 5;
```

### Verificar intentos auditados

```sql
select a.outbox_message_id,
       a.dispatcher,
       a.status,
       a.attempt_number,
       a.created_at
from public.outbox_delivery_attempts a
join public.outbox_messages om on om.id = a.outbox_message_id
where om.dispatch_provider = 'n8n'
order by a.created_at desc
limit 20;
```

### Verificar que no entran contactos sin opt-in o con no molestar

```sql
select om.id,
       om.contact_tipo,
       om.contact_id,
       coalesce(c.whatsapp_opt_in, l.whatsapp_opt_in) as whatsapp_opt_in,
       coalesce(c.whatsapp_no_molestar, l.whatsapp_no_molestar) as whatsapp_no_molestar
from public.outbox_messages om
left join public.clientes c
  on om.contact_tipo = 'cliente'
 and om.contact_id = c.id
left join public.leads l
  on om.contact_tipo = 'lead'
 and om.contact_id = l.id
where om.contexto_tipo = 'campaign'
  and om.dispatch_provider = 'n8n'
  and (
    coalesce(c.whatsapp_opt_in, l.whatsapp_opt_in, false) is not true
    or coalesce(c.whatsapp_no_molestar, l.whatsapp_no_molestar, false) is true
  );
```

Debe retornar 0 filas.
