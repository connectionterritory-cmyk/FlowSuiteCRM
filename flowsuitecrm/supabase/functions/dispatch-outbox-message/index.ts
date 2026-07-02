import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type DispatchOutboxMessagePayload = {
  outbox_id?: string | null
}

type UserProfile = {
  id: string
  rol: string | null
  org_id: string | null
  organizacion: string | null
}

type OutboxRow = {
  id: string
  owner_id: string | null
  org_id: string | null
  status: 'borrador' | 'programado' | 'en_proceso' | 'enviado' | 'fallido' | 'retry_pending' | 'cancelado'
  dispatch_provider: string | null
}

type ProcessOutboxResponse = {
  ok?: boolean
  outbox_id?: string
  status?: string
  provider?: string | null
  provider_message_id?: string | null
  error_message?: string | null
  attempt_count?: number
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const workerSecret = Deno.env.get('OUTBOX_WORKER_SECRET') ?? ''

const supabase = createClient(supabaseUrl, serviceRoleKey)

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]

const PRIVILEGED_ROLES = new Set(['admin', 'distribuidor', 'supervisor_telemercadeo'])
const PROCESSABLE_STATUSES = new Set(['programado', 'retry_pending'])

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(req),
    },
  })
}

function normalizeToken(authHeader: string | null) {
  if (!authHeader) return ''
  return authHeader.replace('Bearer ', '').trim()
}

function getOrgTokens(profile: UserProfile) {
  return new Set(
    [profile.org_id, profile.organizacion]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim())
  )
}

function isN8nDispatched(row: OutboxRow) {
  return row.dispatch_provider === 'n8n' || row.dispatch_provider === 'n8n_mock'
}

async function invokeInternalProcessOutbox(outboxId: string) {
  const res = await fetch(`${supabaseUrl}/functions/v1/process-outbox`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    body: JSON.stringify({ outbox_id: outboxId }),
  })

  const text = await res.text()
  let body: Record<string, unknown> | null = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text ? { raw: text } : null
  }

  return { res, body }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, 405, {
      ok: false,
      error_code: 'method_not_allowed',
      message: 'Method not allowed',
    })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(req, 500, {
      ok: false,
      error_code: 'server_misconfigured',
      message: 'Missing service role configuration',
    })
  }

  if (!workerSecret) {
    return jsonResponse(req, 500, {
      ok: false,
      error_code: 'worker_secret_missing',
      message: 'Missing OUTBOX_WORKER_SECRET configuration',
    })
  }

  const token = normalizeToken(req.headers.get('Authorization'))
  if (!token) {
    return jsonResponse(req, 401, {
      ok: false,
      error_code: 'unauthorized',
      message: 'Missing authorization',
    })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse(req, 401, {
      ok: false,
      error_code: 'invalid_token',
      message: 'Invalid token',
    })
  }

  const { data: profileData, error: profileError } = await supabase
    .from('usuarios')
    .select('id, rol, org_id, organizacion')
    .eq('id', user.id)
    .maybeSingle()

  const profile = (profileData as UserProfile | null) ?? null
  if (profileError || !profile) {
    return jsonResponse(req, 403, {
      ok: false,
      error_code: 'profile_not_found',
      message: 'User profile not found',
    })
  }

  let payload: DispatchOutboxMessagePayload
  try {
    payload = (await req.json()) as DispatchOutboxMessagePayload
  } catch {
    return jsonResponse(req, 400, {
      ok: false,
      error_code: 'invalid_json',
      message: 'Invalid JSON body',
    })
  }

  const outboxId = payload.outbox_id?.trim() ?? ''
  if (!outboxId) {
    return jsonResponse(req, 400, {
      ok: false,
      error_code: 'outbox_id_required',
      message: 'outbox_id is required',
    })
  }

  const { data: rowData, error: rowError } = await supabase
    .from('outbox_messages')
    .select('id, owner_id, org_id, status, dispatch_provider')
    .eq('id', outboxId)
    .maybeSingle()

  const row = (rowData as OutboxRow | null) ?? null
  if (rowError) {
    return jsonResponse(req, 500, {
      ok: false,
      error_code: 'outbox_lookup_failed',
      message: rowError.message,
    })
  }

  if (!row) {
    return jsonResponse(req, 404, {
      ok: false,
      error_code: 'outbox_not_found',
      message: 'Mensaje no encontrado',
    })
  }

  const isOwner = row.owner_id === user.id
  const privileged = PRIVILEGED_ROLES.has(profile.rol ?? '')
  const orgTokens = getOrgTokens(profile)
  const sameOrg = !row.org_id || orgTokens.has(row.org_id.trim())

  if (!isOwner && !(privileged && sameOrg)) {
    return jsonResponse(req, 403, {
      ok: false,
      error_code: 'forbidden',
      message: 'No autorizado para despachar este mensaje',
    })
  }

  if (!PROCESSABLE_STATUSES.has(row.status)) {
    return jsonResponse(req, 409, {
      ok: false,
      error_code: 'message_not_processable',
      message: row.status === 'enviado'
        ? 'El mensaje ya fue enviado'
        : 'El mensaje no está en un estado procesable',
      outbox_id: row.id,
      status: row.status,
    })
  }

  if (isN8nDispatched(row)) {
    return jsonResponse(req, 200, {
      ok: true,
      queued: true,
      outbox_id: row.id,
      status: row.status,
      dispatch_provider: row.dispatch_provider,
      message: 'Mensaje en cola para dispatcher n8n',
    })
  }

  try {
    const { res, body } = await invokeInternalProcessOutbox(row.id)
    const processBody = (body ?? {}) as ProcessOutboxResponse & { error?: string }

    if (!res.ok) {
      return jsonResponse(req, 502, {
        ok: false,
        error_code: 'process_outbox_failed',
        message: processBody.error_message ?? processBody.error ?? 'Error invoking process-outbox',
        outbox_id: row.id,
        details: body,
      })
    }

    return jsonResponse(req, 200, {
      ok: processBody.ok ?? true,
      outbox_id: processBody.outbox_id ?? row.id,
      status: processBody.status ?? row.status,
      provider: processBody.provider ?? null,
      provider_message_id: processBody.provider_message_id ?? null,
      error_message: processBody.error_message ?? null,
      attempt_count: processBody.attempt_count ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal dispatch error'
    return jsonResponse(req, 500, {
      ok: false,
      error_code: 'internal_dispatch_error',
      message,
      outbox_id: row.id,
    })
  }
})
