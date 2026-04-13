import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

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

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing server configuration' }, 500, req)
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

  const supabase = createClient(supabaseUrl, serviceRoleKey)

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
