import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type OutboxMessage = {
  id: string
  canal: 'whatsapp' | 'sms' | 'email' | 'telegram'
  destinatario: string | null
  asunto: string | null
  mensaje: string
  mensaje_resuelto: string | null
  scheduled_for: string | null
  status: 'borrador' | 'programado' | 'enviado' | 'fallido' | 'cancelado'
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL') ?? 'cobranza@flowiadigital.com'
const resendFromName = Deno.env.get('RESEND_FROM_NAME') ?? 'Royal Prestige'

const evolutionUrl = Deno.env.get('EVOLUTION_API_URL') ?? ''
const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY') ?? ''
const evolutionInstance = Deno.env.get('EVOLUTION_INSTANCE') ?? ''
const phonePrefix = Deno.env.get('EVOLUTION_PHONE_PREFIX') ?? ''

const supabase = createClient(supabaseUrl, serviceRoleKey)

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sanitizePhone(raw: string) {
  const digits = raw.replace(/\D/g, '').trim()
  if (digits.length >= 11) return digits
  if (digits.length === 10) return '1' + digits
  if (phonePrefix && !digits.startsWith(phonePrefix)) return phonePrefix + digits
  return digits
}

function buildEmailHtml(message: string): string {
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>')

  const linked = safe.replace(
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
        <tr>
          <td style="background:#1e293b;padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">
              Connection Worldwide Group
            </p>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Distribuidores Autorizados Royal Prestige</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <div style="color:#374151;font-size:15px;line-height:1.8;white-space:pre-line;">${linked}</div>
          </td>
        </tr>
        <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"></td></tr>
        <tr>
          <td style="padding:24px 32px;background:#f8fafc;">
            <p style="margin:0 0 16px;color:#6b7280;font-size:12px;">Distribuidor Autorizado Royal Prestige</p>
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

async function sendWhatsapp(destinatario: string, message: string) {
  if (!evolutionUrl || !evolutionApiKey || !evolutionInstance) {
    throw new Error('Missing Evolution API configuration')
  }
  const cleanedPhone = sanitizePhone(destinatario)
  if (!cleanedPhone) throw new Error('Phone is required')
  const url = `${evolutionUrl.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(evolutionInstance)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': evolutionApiKey,
      'bypass-tunnel-reminder': 'true',
    },
    body: JSON.stringify({ number: cleanedPhone, text: message }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Evolution API error: ${text}`)
  }
}

async function sendEmail(destinatario: string, subject: string, message: string) {
  if (!resendApiKey) throw new Error('Missing Resend API key')
  const html = buildEmailHtml(message)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${resendFromName} <${resendFromEmail}>`,
      to: [destinatario],
      subject,
      html,
      text: message,
    }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (data as { message?: string } | null)?.message ?? 'Resend error'
    throw new Error(msg)
  }
}

serve(async (_req) => {
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing service role configuration' }, 500)
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('outbox_messages')
    .select('id, canal, destinatario, asunto, mensaje, mensaje_resuelto, scheduled_for, status')
    .eq('status', 'programado')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(50)

  if (error) {
    return jsonResponse({ error: error.message }, 500)
  }

  const rows = (data as OutboxMessage[] | null) ?? []
  let sent = 0
  let failed = 0
  const failures: { id: string; error: string }[] = []

  for (const row of rows) {
    const message = (row.mensaje_resuelto ?? row.mensaje ?? '').trim()
    const destinatario = row.destinatario?.trim() ?? ''
    const sentAt = new Date().toISOString()
    if (!destinatario || !message) {
      await supabase.from('outbox_messages').update({
        status: 'fallido',
        failed_at: sentAt,
        error_message: 'Missing destinatario or mensaje',
      }).eq('id', row.id).eq('status', 'programado')
      failed += 1
      failures.push({ id: row.id, error: 'Missing destinatario or mensaje' })
      continue
    }

    try {
      if (row.canal === 'whatsapp') {
        await sendWhatsapp(destinatario, message)
      } else if (row.canal === 'email') {
        await sendEmail(destinatario, row.asunto?.trim() || 'Mensaje', message)
      } else if (row.canal === 'sms') {
        throw new Error('SMS requiere envio manual (app nativa)')
      } else if (row.canal === 'telegram') {
        throw new Error('Telegram no habilitado')
      }

      await supabase.from('outbox_messages').update({
        status: 'enviado',
        sent_at: sentAt,
        error_message: null,
      }).eq('id', row.id).eq('status', 'programado')
      sent += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error enviando'
      await supabase.from('outbox_messages').update({
        status: 'fallido',
        failed_at: sentAt,
        error_message: message,
      }).eq('id', row.id).eq('status', 'programado')
      failed += 1
      failures.push({ id: row.id, error: message })
    }
  }

  return jsonResponse({
    ok: true,
    processed: rows.length,
    sent,
    failed,
    failures,
  })
})
