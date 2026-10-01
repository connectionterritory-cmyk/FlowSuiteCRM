import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''

// Rango permitido para el espaciado entre mensajes encolados (ms). Default = comportamiento histórico.
const DEFAULT_INTERVAL_MS = 1100
const MIN_INTERVAL_MS = 500
const MAX_INTERVAL_MS = 60000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Clave pública (anon/publishable) para validar el JWT del usuario y leer con RLS.
function getPublicKey(): string {
  const publishableJson = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (publishableJson) {
    try {
      const parsed = JSON.parse(publishableJson) as Record<string, unknown>
      if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default
    } catch {
      // cae al fallback legacy
    }
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? ''
}

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info',
    'Access-Control-Max-Age': '86400',
  }
}

function json(body: Record<string, unknown>, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(req ? getCorsHeaders(req) : {}) },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, req)
  }

  const publicKey = getPublicKey()
  if (!supabaseUrl || !publicKey) {
    return json({ error: 'Missing server configuration' }, 500, req)
  }

  // 1) Autenticación: JWT de usuario válido (CORS no es autenticación).
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')
  if (!match) {
    return json({ error: 'Missing or malformed Authorization' }, 401, req)
  }
  const token = match[1]

  const authClient = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !userData?.user) {
    return json({ error: 'Invalid token' }, 401, req)
  }

  let body: { campaign_id?: unknown; interval_ms?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req)
  }

  const { campaign_id, interval_ms } = body ?? {}

  if (typeof campaign_id !== 'string' || !UUID_RE.test(campaign_id)) {
    return json({ error: 'campaign_id is required and must be a UUID' }, 400, req)
  }

  let intervalMs = DEFAULT_INTERVAL_MS
  if (interval_ms !== undefined) {
    if (
      typeof interval_ms !== 'number' ||
      !Number.isInteger(interval_ms) ||
      interval_ms < MIN_INTERVAL_MS ||
      interval_ms > MAX_INTERVAL_MS
    ) {
      return json({ error: `interval_ms must be an integer between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS}` }, 400, req)
    }
    intervalMs = interval_ms
  }

  // 2) Autorización: RLS de mk_campaigns (owner / admin / distribuidor) decide si el usuario ve la campaña.
  const userClient = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: campaign, error: campaignError } = await userClient
    .from('mk_campaigns')
    .select('id')
    .eq('id', campaign_id)
    .maybeSingle()

  if (campaignError) {
    console.error('dispatch-campaign: campaign lookup error', campaignError)
    return json({ error: 'Campaign lookup failed' }, 500, req)
  }
  if (!campaign) {
    return json({ error: 'campaign_not_found' }, 404, req)
  }

  // 3) Solo tras autorizar se usa service_role, y únicamente para el RPC.
  let serviceRoleKey: string
  try {
    serviceRoleKey = getSupabaseAdminKey()
  } catch (err) {
    console.error('dispatch-campaign: admin key unavailable', err)
    return json({ error: 'Missing server configuration' }, 500, req)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data, error } = await supabase.rpc('fn_dispatch_campaign', {
    p_campaign_id: campaign_id,
    p_interval_ms: intervalMs,
  })

  if (error) {
    console.error('dispatch-campaign: rpc error', error)
    return json({ error: error.message }, 500, req)
  }

  const result = data as { dispatched?: number; error?: string; estado?: string; campaign_id?: string }

  if (result?.error) {
    const status = result.error === 'campaign_not_found' ? 404 : 409
    return json({ error: result.error, estado: result.estado }, status, req)
  }

  console.log('dispatch-campaign: dispatched', result?.dispatched, 'messages for campaign', campaign_id)
  return json({ ok: true, dispatched: result?.dispatched ?? 0, campaign_id }, 200, req)
})
