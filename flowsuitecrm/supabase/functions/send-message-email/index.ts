import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type SendMessageEmailPayload = {
  to?: string | null
  subject?: string | null
  message?: string | null
  contactName?: string | null
  replyTo?: string | null
  senderName?: string | null
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL') ?? 'cobranza@flowiadigital.com'
const resendFromName = Deno.env.get('RESEND_FROM_NAME') ?? 'Royal Prestige'

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

const jsonResponse = (req: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  })

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildHtml(params: {
  safeMessage: string
  senderName: string
}): string {
  const { safeMessage, senderName } = params

  // Convert plain URLs to clickable links
  const linkedMessage = safeMessage.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb;">$1</a>'
  )

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- HEADER -->
        <tr>
          <td style="background:#1e293b;padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">
              Connection Worldwide Group
            </p>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Distribuidores Autorizados Royal Prestige</p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:32px;">
            <div style="color:#374151;font-size:15px;line-height:1.8;white-space:pre-line;">${linkedMessage}</div>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"></td></tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:24px 32px;background:#f8fafc;">
            ${senderName ? `<p style="margin:0 0 4px;color:#374151;font-size:13px;font-weight:600;">${senderName}</p>` : ''}
            <p style="margin:0 0 16px;color:#6b7280;font-size:12px;">Distribuidor Autorizado Royal Prestige</p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:12px;padding-bottom:8px;">
                  <a href="https://www.connectionworldwidegroup.com" target="_blank"
                    style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;font-size:12px;font-weight:600;padding:8px 16px;border-radius:6px;">
                    🌐 Nuestro sitio web
                  </a>
                </td>
                <td style="padding-bottom:8px;">
                  <a href="https://www.connectionworldwidegroup.com/emprende-con-nosotros/" target="_blank"
                    style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:12px;font-weight:600;padding:8px 16px;border-radius:6px;">
                    💼 Emprende con nosotros
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;color:#9ca3af;font-size:11px;">
              Connection Worldwide Group ·
              <a href="https://www.connectionworldwidegroup.com" style="color:#9ca3af;text-decoration:none;">
                connectionworldwidegroup.com
              </a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

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

  if (!resendApiKey) {
    return jsonResponse(req, 500, { error: 'Missing Resend API key' })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse(req, 401, { error: 'Missing authorization' })
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse(req, 401, { error: 'Invalid token' })
  }

  const payload = (await req.json()) as SendMessageEmailPayload
  const to = payload.to?.trim() ?? ''
  const subject = payload.subject?.trim() || 'Mensaje de Royal Prestige'
  const message = payload.message?.trim() ?? ''
  const contactName = payload.contactName?.trim() ?? ''
  const replyTo = payload.replyTo?.trim() ?? ''
  const senderName = payload.senderName?.trim() ?? ''

  if (!to || !to.includes('@')) {
    return jsonResponse(req, 400, { error: 'Valid recipient email is required' })
  }
  if (!message) {
    return jsonResponse(req, 400, { error: 'message is required' })
  }

  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>')
  const html = buildHtml({ safeMessage, senderName: escapeHtml(senderName) })

  const textBody = `${contactName ? `Hola ${contactName},\n\n` : ''}${message}${senderName ? `\n\n${senderName}` : ''}\n\nConnection Worldwide Group\nhttps://www.connectionworldwidegroup.com`

  const resendBody: Record<string, unknown> = {
    from: `${resendFromName} <${resendFromEmail}>`,
    to: [to],
    subject,
    html,
    text: textBody,
  }
  if (replyTo && replyTo.includes('@')) {
    resendBody.reply_to = replyTo
  }

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resendBody),
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
