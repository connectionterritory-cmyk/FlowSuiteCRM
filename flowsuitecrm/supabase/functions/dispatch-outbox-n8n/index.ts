import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type OutboxStatus =
  | 'borrador'
  | 'programado'
  | 'en_proceso'
  | 'enviado'
  | 'fallido'
  | 'retry_pending'
  | 'cancelado'

type OutboxMessage = {
  id: string
  owner_id: string | null
  org_id: string | null
  contact_tipo: 'cliente' | 'lead' | 'embajador' | null
  contact_id: string | null
  canal: 'whatsapp' | 'sms' | 'email' | 'telegram'
  destinatario: string | null
  asunto: string | null
  mensaje: string | null
  mensaje_resuelto: string | null
  template_id: string | null
  attachment_urls: string[] | null
  scheduled_for: string | null
  retry_after: string | null
  locked_at: string | null
  locked_by: string | null
  status: OutboxStatus
  contexto_tipo?: string | null
  tipo_envio?: 'text' | 'template' | null
  template_name?: string | null
  template_params?: unknown
  created_at: string
  attempt_count: number | null
  dispatch_provider: string | null
}

type N8nResponse = {
  ok?: boolean
  execution_id?: string | null
  provider?: string | null
  provider_message_id?: string | null
  status?: 'sent' | 'failed' | string | null
  error_message?: string | null
  raw_response?: unknown
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const workerSecret = Deno.env.get('OUTBOX_N8N_WORKER_SECRET') ?? ''
const n8nWebhookUrl = Deno.env.get('N8N_OUTBOX_WEBHOOK_URL') ?? ''
const n8nSecret = Deno.env.get('N8N_OUTBOX_SECRET') ?? ''

const supabase = createClient(supabaseUrl, serviceRoleKey)

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]

const workerId = Deno.env.get('WORKER_ID') ?? `dispatch-outbox-n8n:${crypto.randomUUID()}`
const LOCK_STALE_MS = 10 * 60 * 1000
const RETRY_DELAY_MS = 5 * 60 * 1000

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info, X-FlowSuite-Worker-Secret',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(req ? getCorsHeaders(req) : {}),
    },
  })
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function isRetryableError(err: unknown) {
  const text = err instanceof Error ? err.message : String(err ?? '')
  const msg = text.toLowerCase()
  return (
    msg.includes('timeout')
    || msg.includes('timed out')
    || msg.includes('etimedout')
    || msg.includes('econnreset')
    || msg.includes('econnrefused')
    || msg.includes('enotfound')
    || msg.includes('eai_again')
    || msg.includes('rate limit')
    || msg.includes('too many requests')
    || msg.includes('429')
    || msg.includes('503')
    || msg.includes('502')
    || msg.includes('504')
  )
}

function nextRetryAfter() {
  return new Date(Date.now() + RETRY_DELAY_MS).toISOString()
}

function buildN8nPayload(row: OutboxMessage, attemptNumber: number) {
  const body = (row.mensaje_resuelto ?? row.mensaje ?? '').trim()
  return {
    message_id: row.id,
    org_id: row.org_id,
    channel: row.canal,
    to: row.destinatario,
    body,
    subject: row.asunto,
    template_id: row.template_id,
    metadata: {
      owner_id: row.owner_id,
      contact_tipo: row.contact_tipo,
      contact_id: row.contact_id,
      contexto_tipo: row.contexto_tipo ?? 'ad_hoc',
      attachments: row.attachment_urls ?? [],
      tipo_envio: row.tipo_envio ?? 'text',
      template_name: row.template_name ?? null,
      template_params: row.template_params ?? [],
      scheduled_for: row.scheduled_for,
    },
    idempotency_key: `outbox:${row.id}:${attemptNumber}`,
    created_at: row.created_at,
  }
}

async function insertAttempt(input: {
  outboxMessageId: string
  orgId: string | null
  attemptNumber: number
  status: 'started' | 'accepted' | 'sent' | 'retry_pending' | 'failed'
  requestPayload?: unknown
  responsePayload?: unknown
  errorMessage?: string | null
}) {
  const { error } = await supabase.from('outbox_delivery_attempts').insert({
    outbox_message_id: input.outboxMessageId,
    org_id: input.orgId,
    attempt_number: input.attemptNumber,
    dispatcher: 'n8n',
    status: input.status,
    request_payload: input.requestPayload ?? null,
    response_payload: input.responsePayload ?? null,
    error_message: input.errorMessage ?? null,
  })

  if (error) {
    console.warn('dispatch-outbox-n8n: failed to insert attempt log', error)
  }
}

async function updateOutbox(id: string, payload: Record<string, unknown>) {
  const { error } = await supabase
    .from('outbox_messages')
    .update(payload)
    .eq('id', id)
    .eq('status', 'en_proceso')
    .eq('dispatch_provider', 'n8n')

  if (error) throw error
}

async function syncMkMessage(outboxId: string, payload: { status: string; sent_at?: string | null }) {
  await supabase
    .from('mk_messages')
    .update(payload)
    .eq('outbox_message_id', outboxId)
    .neq('status', 'respondido')
    .neq('status', 'cancelado')
}

async function callN8n(payload: Record<string, unknown>) {
  const idempotencyKey = String(payload.idempotency_key ?? '')
  const res = await fetch(n8nWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-FlowSuite-Secret': n8nSecret,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!res.ok) {
    const retryable = isRetryableStatus(res.status)
    const err = new Error(`n8n webhook error (${res.status})`)
    ;(err as Error & { retryable?: boolean; responseBody?: unknown }).retryable = retryable
    ;(err as Error & { retryable?: boolean; responseBody?: unknown }).responseBody = body
    throw err
  }

  return body as N8nResponse
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing service role configuration' }, 500, req)
  }

  if (!workerSecret) {
    return jsonResponse({ error: 'Missing OUTBOX_N8N_WORKER_SECRET configuration' }, 500, req)
  }

  if (req.headers.get('X-FlowSuite-Worker-Secret') !== workerSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401, req)
  }

  if (!n8nWebhookUrl || !n8nSecret) {
    return jsonResponse({ error: 'Missing n8n webhook configuration' }, 500, req)
  }

  const nowIso = new Date().toISOString()
  const staleLockIso = new Date(Date.now() - LOCK_STALE_MS).toISOString()

  const { data: reclaimed, error: reclaimError } = await supabase
    .from('outbox_messages')
    .update({
      status: 'retry_pending',
      retry_after: nowIso,
      locked_at: null,
      locked_by: null,
    })
    .eq('status', 'en_proceso')
    .eq('dispatch_provider', 'n8n')
    .lt('locked_at', staleLockIso)
    .select('id')

  if (reclaimError) {
    console.error('dispatch-outbox-n8n: failed to reclaim stale locks', reclaimError)
  } else if (reclaimed && reclaimed.length > 0) {
    console.log('dispatch-outbox-n8n: reclaimed stale locks', reclaimed.map(r => r.id))
    for (const r of reclaimed) {
      await syncMkMessage(r.id, { status: 'programado' })
    }
  }

  const { data, error } = await supabase
    .from('outbox_messages')
    .select('*')
    .eq('dispatch_provider', 'n8n')
    .or(
      [
        `and(status.eq.programado,scheduled_for.lte.${nowIso})`,
        `and(status.eq.retry_pending,retry_after.lte.${nowIso})`,
        `and(status.eq.retry_pending,retry_after.is.null)`,
      ].join(',')
    )
    .order('scheduled_for', { ascending: true })
    .limit(50)

  if (error) {
    return jsonResponse({ error: error.message }, 500, req)
  }

  const rows = (data as OutboxMessage[] | null) ?? []
  let sent = 0
  let failed = 0
  let retryPending = 0
  const failures: { id: string; error: string }[] = []

  for (const row of rows) {
    const attemptNumber = (row.attempt_count ?? 0) + 1
    const lockedAt = new Date().toISOString()
    const { data: lockRows, error: lockError } = await supabase
      .from('outbox_messages')
      .update({
        status: 'en_proceso',
        locked_at: lockedAt,
        locked_by: workerId,
        attempt_count: attemptNumber,
      })
      .eq('id', row.id)
      .eq('dispatch_provider', 'n8n')
      .in('status', ['programado', 'retry_pending'])
      .select('id')

    if (lockError) {
      failures.push({ id: row.id, error: lockError.message })
      continue
    }

    if (!lockRows || lockRows.length === 0) {
      continue
    }

    await syncMkMessage(row.id, { status: 'en_proceso' })

    const requestPayload = buildN8nPayload(row, attemptNumber)
    await insertAttempt({
      outboxMessageId: row.id,
      orgId: row.org_id,
      attemptNumber,
      status: 'started',
      requestPayload,
    })

    try {
      if (!row.destinatario?.trim()) {
        throw new Error('Missing destinatario')
      }

      if (!String(requestPayload.body ?? '').trim() && (!row.attachment_urls || row.attachment_urls.length === 0)) {
        throw new Error('Missing message body and attachments')
      }

      const response = await callN8n(requestPayload)
      const responseStatus = response.status === 'sent' ? 'sent' : response.status === 'failed' ? 'failed' : null

      if (!response.ok || responseStatus === 'failed') {
        const errorMsg = response.error_message ?? 'n8n returned failed status'
        const failedAt = new Date().toISOString()
        await updateOutbox(row.id, {
          status: 'fallido',
          failed_at: failedAt,
          error_message: errorMsg,
          n8n_execution_id: response.execution_id ?? null,
          provider: response.provider ?? 'n8n',
          provider_message_id: response.provider_message_id ?? null,
          provider_response: response.raw_response ?? response,
          dispatched_to_n8n_at: failedAt,
          locked_at: null,
          locked_by: null,
        })
        await syncMkMessage(row.id, { status: 'fallido' })
        await insertAttempt({
          outboxMessageId: row.id,
          orgId: row.org_id,
          attemptNumber,
          status: 'failed',
          requestPayload,
          responsePayload: response,
          errorMessage: errorMsg,
        })
        failed += 1
        failures.push({ id: row.id, error: errorMsg })
        continue
      }

      if (responseStatus !== 'sent') {
        const errorMsg = `Unexpected n8n status: ${String(response.status ?? 'missing')}`
        throw new Error(errorMsg)
      }

      const sentAt = new Date().toISOString()
      await updateOutbox(row.id, {
        status: 'enviado',
        sent_at: sentAt,
        error_message: null,
        n8n_execution_id: response.execution_id ?? null,
        provider: response.provider ?? 'n8n',
        provider_message_id: response.provider_message_id ?? null,
        provider_response: response.raw_response ?? response,
        dispatched_to_n8n_at: sentAt,
        locked_at: null,
        locked_by: null,
      })
      await syncMkMessage(row.id, { status: 'enviado', sent_at: sentAt })
      await insertAttempt({
        outboxMessageId: row.id,
        orgId: row.org_id,
        attemptNumber,
        status: 'sent',
        requestPayload,
        responsePayload: response,
      })
      sent += 1
    } catch (err) {
      const maybeProviderError = err as Error & { retryable?: boolean; responseBody?: unknown }
      const errorMsg = err instanceof Error ? err.message : 'Error dispatching to n8n'
      const retryable = maybeProviderError.retryable === true || isRetryableError(err)

      if (retryable) {
        const retryAfter = nextRetryAfter()
        await updateOutbox(row.id, {
          status: 'retry_pending',
          retry_after: retryAfter,
          error_message: errorMsg,
          provider_response: maybeProviderError.responseBody ?? null,
          locked_at: null,
          locked_by: null,
        })
        await syncMkMessage(row.id, { status: 'programado' })
        await insertAttempt({
          outboxMessageId: row.id,
          orgId: row.org_id,
          attemptNumber,
          status: 'retry_pending',
          requestPayload,
          responsePayload: maybeProviderError.responseBody ?? null,
          errorMessage: errorMsg,
        })
        retryPending += 1
        failures.push({ id: row.id, error: `retry_pending: ${errorMsg}` })
      } else {
        const failedAt = new Date().toISOString()
        await updateOutbox(row.id, {
          status: 'fallido',
          failed_at: failedAt,
          error_message: errorMsg,
          provider_response: maybeProviderError.responseBody ?? null,
          locked_at: null,
          locked_by: null,
        })
        await syncMkMessage(row.id, { status: 'fallido' })
        await insertAttempt({
          outboxMessageId: row.id,
          orgId: row.org_id,
          attemptNumber,
          status: 'failed',
          requestPayload,
          responsePayload: maybeProviderError.responseBody ?? null,
          errorMessage: errorMsg,
        })
        failed += 1
        failures.push({ id: row.id, error: errorMsg })
      }
    }
  }

  return jsonResponse({
    ok: true,
    processed: rows.length,
    sent,
    failed,
    retry_pending: retryPending,
    failures,
  }, 200, req)
})
