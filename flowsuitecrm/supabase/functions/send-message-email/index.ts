import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type SendMessageEmailPayload = {
  to?: string | null
  subject?: string | null
  message?: string | null
  contactName?: string | null
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL') ?? ''
const resendFromName = Deno.env.get('RESEND_FROM_NAME') ?? 'Royal Prestige'

const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

const jsonResponse = (req: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(req),
    },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, 405, { error: 'Method not allowed' })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(req, 500, { error: 'Missing service role configuration' })
  }

  if (!resendApiKey || !resendFromEmail) {
    return jsonResponse(req, 500, { error: 'Missing Resend configuration' })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse(req, 401, { error: 'Missing authorization' })
  }

  const token = authHeader.replace('Bearer ', '')
  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser(token)

  if (authError || !user) {
    return jsonResponse(req, 401, { error: 'Invalid token' })
  }

  const payload = (await req.json()) as SendMessageEmailPayload
  const to = payload.to?.trim() ?? ''
  const subject = payload.subject?.trim() ?? ''
  const message = payload.message?.trim() ?? ''
  const contactName = payload.contactName?.trim() ?? ''

  if (!to || !subject || !message) {
    return jsonResponse(req, 400, { error: 'to, subject and message are required' })
  }

  const sender = `${resendFromName} <${resendFromEmail}>`
  const safeMessage = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br />')

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <p>${contactName ? `Hola ${contactName},` : 'Hola,'}</p>
      <p>${safeMessage}</p>
    </div>
  `

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: [to],
      subject,
      html,
      text: `${contactName ? `Hola ${contactName},\n\n` : ''}${message}`,
    }),
  })

  const resendData = await resendResponse.json().catch(() => null)

  if (!resendResponse.ok) {
    return jsonResponse(req, 502, {
      error: (resendData as { message?: string } | null)?.message ?? 'Resend error',
      details: resendData,
    })
  }

  return jsonResponse(req, 200, {
    id: (resendData as { id?: string } | null)?.id ?? null,
    success: true,
  })
})
