import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const outboxWorkerSecret = Deno.env.get('OUTBOX_WORKER_SECRET') ?? ''

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const isAllowed = ALLOWED_ORIGINS.includes(origin) ||
                    origin.startsWith('http://localhost:') ||
                    origin === 'http://localhost'
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info, X-FlowSuite-Worker-Secret',
    'Access-Control-Max-Age': '86400',
  }
}

function json(body: Record<string, unknown>, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(req ? getCorsHeaders(req) : {}) },
  })
}

async function isAuthorizedForCampaign(
  supabase: ReturnType<typeof createClient>,
  authenticatedUserId: string,
  campaignOwnerId: string | null,
): Promise<boolean> {
  if (campaignOwnerId && campaignOwnerId === authenticatedUserId) {
    return true
  }

  const { data: caller } = await supabase
    .from('usuarios')
    .select('rol, organizacion')
    .eq('id', authenticatedUserId)
    .maybeSingle()

  if (!caller) return false
  if (caller.rol === 'admin') return true

  if (caller.rol === 'distribuidor' && campaignOwnerId) {
    const { data: owner } = await supabase
      .from('usuarios')
      .select('organizacion')
      .eq('id', campaignOwnerId)
      .maybeSingle()
    if (owner && owner.organizacion && owner.organizacion === caller.organizacion) {
      return true
    }
  }

  return false
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing server configuration' }, 500, req)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Two valid callers: (1) a trusted internal worker presenting the shared
  // secret; (2) an authenticated app user, who may only dispatch a campaign
  // they own (or one owned by a vendedor in their org, if distribuidor/admin).
  const incomingWorkerSecret = req.headers.get('X-FlowSuite-Worker-Secret') ?? ''
  const isWorkerRequest = Boolean(outboxWorkerSecret) && incomingWorkerSecret === outboxWorkerSecret

  let authenticatedUserId: string | null = null
  if (!isWorkerRequest) {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return json({ error: 'Missing authorization' }, 401, req)
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return json({ error: 'Invalid token' }, 401, req)
    }
    authenticatedUserId = user.id
  }

  let body: { campaign_id?: string; interval_ms?: number }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req)
  }

  const { campaign_id, interval_ms } = body

  if (!campaign_id) {
    return json({ error: 'campaign_id is required' }, 400, req)
  }

  if (!isWorkerRequest) {
    const { data: campaignRow, error: campaignError } = await supabase
      .from('mk_campaigns')
      .select('id, owner_id')
      .eq('id', campaign_id)
      .maybeSingle()

    if (campaignError) {
      return json({ error: campaignError.message }, 500, req)
    }
    if (!campaignRow) {
      return json({ error: 'campaign_not_found' }, 404, req)
    }
    const authorized = await isAuthorizedForCampaign(supabase, authenticatedUserId as string, campaignRow.owner_id)
    if (!authorized) {
      return json({ error: 'Forbidden' }, 403, req)
    }
  }

  const { data, error } = await supabase.rpc('fn_dispatch_campaign', {
    p_campaign_id: campaign_id,
    p_interval_ms: interval_ms ?? 1100,
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
