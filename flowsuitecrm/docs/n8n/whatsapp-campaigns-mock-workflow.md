# Workflow n8n: Campañas WhatsApp (Modo MOCK)

Procesa la cola `outbox_messages` para campañas WhatsApp en modo de prueba, sin enviar mensajes reales.

## Propósito

Validar el flujo completo CRM → outbox → n8n → "enviado", incluyendo registro de intentos y anti-duplicado, antes de conectar un proveedor real (Twilio, Meta, Whapi, etc.).

## Estructura del Workflow

```
Manual Trigger
  → Claim Messages        (RPC fn_claim_outbox_messages_for_n8n)
    → Insert Attempt      (outbox_delivery_attempts, status='sent')
      → Update Outbox     (outbox_messages → enviado, libera lock)
        → Sync MK Message (mk_messages → enviado)
```

Si el RPC retorna 0 filas, los nodos siguientes no ejecutan — comportamiento correcto de n8n.

## Credencial requerida: Postgres (no Supabase API)

Los nodos usan `n8n-nodes-base.postgres` porque ejecutan SQL arbitrario (RPC + UPDATE).
El nodo Supabase de n8n solo soporta CRUD en tablas individuales, no RPCs ni SQL libre.

En n8n → Credentials → New → **Postgres**:

| Campo    | Valor                                                      |
|----------|------------------------------------------------------------|
| Host     | `aws-0-{region}.pooler.supabase.com` o `db.{ref}.supabase.co` |
| Port     | `5432` (o `6543` para el pooler de Supabase)               |
| Database | `postgres`                                                 |
| User     | `postgres` (o el usuario de tu proyecto)                   |
| Password | La contraseña del proyecto en Supabase → Settings → Database |
| SSL      | Require                                                    |

Después de crear la credencial, edita cada nodo en el workflow importado y selecciónala.

## Cómo importar

1. En n8n → **Workflows** → botón `+` → **Import from File**.
2. Selecciona `whatsapp-campaigns-mock-workflow.json`.
3. Abre el workflow importado.
4. En cada nodo Postgres, en **Credential**, selecciona la credencial Supabase Postgres que configuraste.
5. Guarda.

## Notas técnicas

- **Anti-duplicado**: `fn_claim_outbox_messages_for_n8n` usa `FOR UPDATE SKIP LOCKED`. Dos ejecuciones paralelas no procesan el mismo mensaje.
- **`outbox_delivery_attempts.status`**: acepta `'sent'`, no `'success'` (constraint de tabla).
- **`mk_messages`**: no tiene columna `updated_at`. El UPDATE en ese nodo no la incluye.
- **`outbox_messages.updated_at`**: sí existe y se actualiza a `NOW()`.
- **Expresiones dinámicas**: los queries con `=` al inicio son evaluados por n8n antes de enviar a Postgres. Así `{{ $json.id }}` se sustituye por el UUID real de cada fila.

## Prueba de anti-duplicado

1. Ejecutar el workflow → debe procesar los mensajes pendientes.
2. Ejecutar el workflow por segunda vez → debe retornar 0 filas del RPC (nodos siguientes no ejecutan).

## Smoke test SQL (verificar resultados)

```sql
-- Mensajes enviados por el mock
SELECT id, status, provider, provider_message_id, sent_at
FROM public.outbox_messages
WHERE provider = 'mock_whatsapp'
ORDER BY sent_at DESC
LIMIT 10;

-- Intentos auditados
SELECT a.outbox_message_id, a.dispatcher, a.status, a.attempt_number, a.created_at
FROM public.outbox_delivery_attempts a
WHERE a.dispatcher = 'n8n'
ORDER BY a.created_at DESC
LIMIT 10;

-- mk_messages sincronizados
SELECT id, status, outbox_message_id
FROM public.mk_messages
WHERE status = 'enviado'
ORDER BY updated_at DESC
LIMIT 10;
```

## Próximos pasos (post-validación)

1. Reemplazar el Mock por proveedor real (HTTP Request a Evolution API / Twilio / Meta).
2. Agregar nodo de manejo de errores (retry_pending / fallido).
3. Cambiar el trigger a Schedule (cada 1-5 minutos) o Webhook.
4. Agregar actualización de `whatsapp_ultimo_envio_at` en `clientes` y `leads`.
