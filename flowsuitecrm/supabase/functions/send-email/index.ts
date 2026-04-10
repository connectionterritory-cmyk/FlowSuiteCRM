import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type SendEmailPayload = {
  to: string | null
  subject?: string | null
  message: string | null
  replyTo?: string | null
  senderName?: string | null
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Royal Prestige <cobranza@flowiadigital.com>'

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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function isValidEmail(email: string) {
  return email.includes('@')
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
  if (!resendKey) {
    return jsonResponse({ error: 'Missing Resend API key' }, 500, req)
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

  const payload = (await req.json()) as SendEmailPayload
  const to = payload.to?.trim() ?? ''
  if (!to || !isValidEmail(to)) {
    return jsonResponse({ error: 'Valid recipient email is required' }, 400, req)
  }
  const message = payload.message?.trim() ?? ''
  if (!message) {
    return jsonResponse({ error: 'Message is required' }, 400, req)
  }

  const subject = payload.subject?.trim() || 'Mensaje de Royal Prestige'
  const replyTo = payload.replyTo?.trim() || ''
  const senderName = payload.senderName?.trim() || ''

  const escaped = escapeHtml(message).replace(/\n/g, '<br />')
  const html = senderName
    ? `<p>${escaped}</p><p style="margin-top:16px;color:#6b7280;font-size:12px">Enviado por ${escapeHtml(senderName)}</p>`
    : `<p>${escaped}</p>`

  const resendPayload: Record<string, unknown> = {
    from: resendFrom,
    to,
    subject,
    html,
    text: message,
  }
  if (replyTo && isValidEmail(replyTo)) {
    resendPayload.reply_to = replyTo
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendKey}`,
    },
    body: JSON.stringify(resendPayload),
  })

  const responseText = await res.text()
  let responseBody: unknown = responseText
  try {
    responseBody = responseText ? JSON.parse(responseText) : null
  } catch {
    responseBody = responseText
  }

  if (!res.ok) {
    return jsonResponse({ error: 'Resend API error', status: res.status, details: responseBody }, 502, req)
  }

  return jsonResponse({ ok: true, data: responseBody }, 200, req)
})
