import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type SendWhatsappPayload = {
  phone: string | null
  message: string | null
  instance?: string | null
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const evolutionUrl = Deno.env.get('EVOLUTION_API_URL') ?? ''
const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY') ?? ''
const evolutionInstance = Deno.env.get('EVOLUTION_INSTANCE') ?? ''
const phonePrefix = Deno.env.get('EVOLUTION_PHONE_PREFIX') ?? ''

const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

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
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(req ? getCorsHeaders(req) : {}) },
  })
}

function sanitizePhone(raw: string) {
  const digits = raw.replace(/\D/g, '').trim()

  // Already has country code (11+ digits starting with 1 for US)
  if (digits.length >= 11) return digits

  // 10-digit US number → prepend 1
  if (digits.length === 10) return '1' + digits

  // Fallback: use configured prefix
  if (phonePrefix && !digits.startsWith(phonePrefix)) return phonePrefix + digits

  return digits
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing service role configuration' }, 500, req)
  }

  if (!evolutionUrl || !evolutionApiKey) {
    return jsonResponse({ error: 'Missing Evolution API configuration' }, 500, req)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization' }, 401, req)
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

  if (authError || !user) {
    return jsonResponse({ error: 'Invalid token' }, 401, req)
  }

  const payload = (await req.json()) as SendWhatsappPayload

  const rawPhone = payload.phone?.trim() ?? ''
  const cleanedPhone = sanitizePhone(rawPhone)
  if (!cleanedPhone) {
    return jsonResponse({ error: 'Phone is required' }, 400, req)
  }

  const message = payload.message?.trim() ?? ''
  if (!message) {
    return jsonResponse({ error: 'Message is required' }, 400, req)
  }

  const instance = (payload.instance ?? '').trim() || evolutionInstance
  if (!instance) {
    return jsonResponse({ error: 'Missing Evolution instance' }, 500, req)
  }

  const baseUrl = evolutionUrl.replace(/\/+$/, '')
  const url = `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`

  const evolutionResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': evolutionApiKey,
      'bypass-tunnel-reminder': 'true',
    },
    body: JSON.stringify({
      number: cleanedPhone,
      text: message,
    }),
  })

  const responseText = await evolutionResponse.text()
  let responseBody: unknown = responseText
  try {
    responseBody = responseText ? JSON.parse(responseText) : null
  } catch {
    responseBody = responseText
  }

  if (!evolutionResponse.ok) {
    return jsonResponse({
      error: 'Evolution API error',
      status: evolutionResponse.status,
      details: responseBody,
    }, 502, req)
  }

  return jsonResponse({ ok: true, data: responseBody }, 200, req)
})
