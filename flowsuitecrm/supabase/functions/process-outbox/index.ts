import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type OutboxMessage = {
  id: string
  canal: 'whatsapp' | 'sms' | 'email' | 'telegram'
  destinatario: string | null
  asunto: string | null
  mensaje: string
  mensaje_resuelto: string | null
  attachment_urls: string[] | null
  scheduled_for: string | null
  retry_after: string | null
  locked_at: string | null
  locked_by: string | null
  status: 'borrador' | 'programado' | 'en_proceso' | 'enviado' | 'fallido' | 'retry_pending' | 'cancelado'
  from_email: string | null
  from_name: string | null
  reply_to: string | null
  sender_name: string | null
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

// Meta Cloud API — takes priority over Evolution API when both vars are set
const metaToken = Deno.env.get('META_WHATSAPP_TOKEN') ?? ''
const metaPhoneNumberId = Deno.env.get('META_PHONE_NUMBER_ID') ?? ''

const telegramToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''

const supabase = createClient(supabaseUrl, serviceRoleKey)

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]

const workerId = Deno.env.get('WORKER_ID') ?? `process-outbox:${crypto.randomUUID()}`
const LOCK_STALE_MS = 10 * 60 * 1000
const RETRY_DELAY_MS = 5 * 60 * 1000

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info',
    'Access-Control-Max-Age': '86400',
  }
}

function asProviderError(message: string, retryable: boolean) {
  const err = new Error(message)
  ;(err as Error & { retryable?: boolean }).retryable = retryable
  return err
}

function isRetryableError(err: unknown) {
  if (err instanceof Error && (err as Error & { retryable?: boolean }).retryable) {
    return true
  }
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
    || msg.includes('5xx')
    || msg.includes('503')
    || msg.includes('502')
    || msg.includes('504')
  )
}

function nextRetryAfter() {
  return new Date(Date.now() + RETRY_DELAY_MS).toISOString()
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

function sanitizePhone(raw: string) {
  const digits = raw.replace(/\D/g, '').trim()
  if (digits.length >= 11) return digits
  if (digits.length === 10) return '1' + digits
  if (phonePrefix && !digits.startsWith(phonePrefix)) return phonePrefix + digits
  return digits
}

function getMimeType(url: string) {
  const ext = url.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'pdf': return 'application/pdf'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'mp4': return 'video/mp4'
    default: return 'application/octet-stream'
  }
}

function getMediaType(mime: string) {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url)
}

function buildEmailHtml(message: string, attachments?: string[] | null, senderName?: string | null, campaignLabel?: string | null): string {
  // Detect if message already contains HTML tags (from editor Bold/Italic/List buttons)
  const hasHtmlTags = /<(b|i|ul|ol|li|br|p|strong|em)[^>]*>/i.test(message)

  let linkedMessage: string
  if (hasHtmlTags) {
    linkedMessage = message
      .replace(/\n/g, '<br>')
      .replace(/(?<![="])( )(https?:\/\/[^\s<"]+)/g, '$1<a href="$2" style="color:#2563eb;">$2</a>')
  } else {
    const safeMessage = escapeHtml(message)
    linkedMessage = safeMessage
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb;">$1</a>')
  }

  // Inline images block — rendered after the message text
  const imageAttachments = (attachments ?? []).filter(isImageUrl)
  const nonImageAttachments = (attachments ?? []).filter(u => !isImageUrl(u))

  const inlineImagesHtml = imageAttachments.length > 0
    ? imageAttachments.map(url => `
      <div style="margin-top:16px;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <img src="${url}" alt="adjunto" width="100%" style="width:100%;max-width:100%;display:block;background:#f8fafc;" />
      </div>`).join('')
    : ''

  const nonImageHtml = nonImageAttachments.length > 0
    ? `<div style="margin-top:16px;">` +
      nonImageAttachments.map(url => {
        const name = url.split('/').pop()?.split('?')[0] || 'archivo'
        return `<a href="${url}" target="_blank" style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;text-decoration:none;color:#374151;font-size:13px;margin-right:8px;margin-bottom:8px;">📎 ${escapeHtml(name)}</a>`
      }).join('') +
      `</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- HEADER -->
        <tr>
          <td style="background:#1e293b;padding:24px 32px;text-align:center;">
            <img src="https://rxiarmbosgivaplygqug.supabase.co/storage/v1/object/public/messaging_attachments/88b848b8-99d4-41f4-a64d-d7a3f56879a4.png"
              alt="Connection Worldwide Group"
              width="80" height="83"
              style="display:inline-block;border:0;outline:none;text-decoration:none;" />
            <p style="margin:8px 0 0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">
              Connection Worldwide Group
            </p>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Distribuidor Autorizado · Royal Prestige</p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:32px;">
            ${inlineImagesHtml}
            <div style="color:#374151;font-size:15px;line-height:1.8;${imageAttachments.length > 0 ? 'margin-top:16px;' : ''}">${linkedMessage}</div>
            ${nonImageHtml}
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"></td></tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:24px 32px;background:#f8fafc;">
            ${senderName ? `<p style="margin:0 0 2px;color:#374151;font-size:13px;font-weight:600;">${escapeHtml(senderName)}</p>` : ''}
            ${campaignLabel ? `<p style="margin:0 0 2px;color:#6b7280;font-size:12px;">${escapeHtml(campaignLabel)}</p>` : ''}
            <p style="margin:0 0 16px;color:#6b7280;font-size:12px;">Distribuidor Autorizado · Royal Prestige</p>
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

async function syncMkMessage(outboxId: string, payload: { status: string; sent_at?: string | null }) {
  await supabase
    .from('mk_messages')
    .update(payload)
    .eq('outbox_message_id', outboxId)
    .neq('status', 'respondido')
    .neq('status', 'cancelado')
}

async function sendMetaWhatsapp(destinatario: string, message: string) {
  if (!metaToken || !metaPhoneNumberId) {
    throw new Error('Missing Meta WhatsApp configuration')
  }
  const cleanedPhone = sanitizePhone(destinatario)
  if (!cleanedPhone) throw new Error('Phone is required')

  const res = await fetch(
    `https://graph.facebook.com/v25.0/${metaPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${metaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanedPhone,
        type: 'text',
        text: { body: message },
      }),
    }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? 'Meta API error'
    const retryable = res.status === 429 || res.status >= 500
    throw asProviderError(`Meta WhatsApp error (${res.status}): ${msg}`, retryable)
  }
}

async function sendWhatsapp(destinatario: string, message: string, attachments: string[] | null) {
  if (!evolutionUrl || !evolutionApiKey || !evolutionInstance) {
    throw new Error('Missing Evolution API configuration')
  }
  const cleanedPhone = sanitizePhone(destinatario)
  if (!cleanedPhone) throw new Error('Phone is required')

  if (attachments && attachments.length > 0) {
    const mediaUrl = attachments[0]
    const mime = getMimeType(mediaUrl)
    const mediaType = getMediaType(mime)
    const fileName = mediaUrl.split('/').pop() || 'file'

    const url = `${evolutionUrl.replace(/\/+$/, '')}/message/sendMedia/${encodeURIComponent(evolutionInstance)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey,
        'bypass-tunnel-reminder': 'true',
      },
      body: JSON.stringify({
        number: cleanedPhone,
        mediatype: mediaType,
        mimetype: mime,
        caption: message,
        media: mediaUrl,
        fileName: fileName,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      const retryable = res.status === 429 || res.status >= 500
      throw asProviderError(`Evolution Media API error (${res.status}): ${text}`, retryable)
    }

    // Adjuntos adicionales sin caption
    for (let i = 1; i < attachments.length; i++) {
      const nextMedia = attachments[i]
      const nextMime = getMimeType(nextMedia)
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': evolutionApiKey,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          number: cleanedPhone,
          mediatype: getMediaType(nextMime),
          mimetype: nextMime,
          media: nextMedia,
          fileName: nextMedia.split('/').pop() || 'file',
        }),
      })
    }
  } else {
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
    if (!res.ok) {
      const text = await res.text()
      const retryable = res.status === 429 || res.status >= 500
      throw asProviderError(`Evolution Text API error (${res.status}): ${text}`, retryable)
    }
  }
}

// Returns the Resend message ID for tracking
async function sendEmail(
  destinatario: string,
  subject: string,
  message: string,
  attachments: string[] | null,
  fromEmail?: string | null,
  fromName?: string | null,
  replyTo?: string | null,
  senderName?: string | null,
): Promise<string | null> {
  if (!resendApiKey) throw new Error('Missing Resend API key')

  const html = buildEmailHtml(message, attachments, senderName, fromName)
  // Images are inlined in the HTML body — only send non-image files as attachments
  const resendAttachments = (attachments ?? [])
    .filter(url => !isImageUrl(url))
    .map(url => ({
      path: url,
      filename: url.split('/').pop()?.split('?')[0] || 'attachment',
    }))

  const effectiveFromEmail = fromEmail || resendFromEmail
  const effectiveFromName = fromName || resendFromName

  const body: Record<string, unknown> = {
    from: `${effectiveFromName} <${effectiveFromEmail}>`,
    to: [destinatario],
    subject,
    html,
    text: message,
    attachments: resendAttachments.length > 0 ? resendAttachments : undefined,
  }
  if (replyTo && replyTo.includes('@')) {
    body.reply_to = replyTo
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (data as { message?: string } | null)?.message ?? 'Resend error'
    const retryable = res.status === 429 || res.status >= 500
    throw asProviderError(`Resend error (${res.status}): ${msg}`, retryable)
  }
  return (data as { id?: string } | null)?.id ?? null
}

async function sendTelegram(chatId: string, message: string) {
  if (!telegramToken) throw new Error('Missing Telegram Bot Token')
  const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    const retryable = res.status === 429 || res.status >= 500
    throw asProviderError(`Telegram API error (${res.status}): ${text}`, retryable)
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing service role configuration' }, 500, req)
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
    .lt('locked_at', staleLockIso)
    .select('id')

  if (reclaimError) {
    console.error('process-outbox: failed to reclaim stale locks', reclaimError)
  } else if (reclaimed && reclaimed.length > 0) {
    console.log('process-outbox: reclaimed stale locks', reclaimed.map(r => r.id))
    // Sync each recovered row back to 'programado' in mk_messages so the
    // campaign UI shows "Pendiente" rather than "en_proceso" stuck state.
    // mk_messages CHECK does not include 'retry_pending', so 'programado' is
    // the correct canonical status for "queued for retry".
    for (const r of reclaimed) {
      await syncMkMessage(r.id, { status: 'programado' })
    }
  }

  const { data, error } = await supabase
    .from('outbox_messages')
    .select('id, canal, destinatario, asunto, mensaje, mensaje_resuelto, attachment_urls, scheduled_for, retry_after, locked_at, locked_by, status, from_email, from_name, reply_to, sender_name')
    .or(
      [
        `and(status.eq.programado,scheduled_for.lte.${nowIso})`,
        `and(status.eq.retry_pending,retry_after.lte.${nowIso})`,
        `and(status.eq.retry_pending,retry_after.is.null)`
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
  const failures: { id: string; error: string }[] = []

  for (const row of rows) {
    const sentAt = new Date().toISOString()
    const { data: lockRows } = await supabase
      .from('outbox_messages')
      .update({
        status: 'en_proceso',
        locked_at: sentAt,
        locked_by: workerId,
      })
      .eq('id', row.id)
      .in('status', ['programado', 'retry_pending'])
      .select('id')

    if (!lockRows || lockRows.length === 0) {
      continue
    }

    console.log('process-outbox: locked message', row.id, 'by', workerId)
    await syncMkMessage(row.id, { status: 'en_proceso' })

    const message = (row.mensaje_resuelto ?? row.mensaje ?? '').trim()
    const destinatario = row.destinatario?.trim() ?? ''
    const attachments = row.attachment_urls

    if (!destinatario || !message) {
      await supabase.from('outbox_messages').update({
        status: 'fallido',
        failed_at: sentAt,
        error_message: 'Missing destinatario or mensaje',
        locked_at: null,
        locked_by: null,
      }).eq('id', row.id).eq('status', 'en_proceso')
      await syncMkMessage(row.id, { status: 'fallido' })
      failed += 1
      console.warn('process-outbox: permanent failure (missing destinatario/mensaje)', row.id)
      failures.push({ id: row.id, error: 'Missing destinatario or mensaje' })
      continue
    }

    try {
      let providerMessageId: string | null = null

      if (row.canal === 'whatsapp') {
        if (metaToken && metaPhoneNumberId) {
          await sendMetaWhatsapp(destinatario, message)
        } else {
          await sendWhatsapp(destinatario, message, attachments)
        }
      } else if (row.canal === 'email') {
        providerMessageId = await sendEmail(
          destinatario,
          row.asunto?.trim() || 'Mensaje',
          message,
          attachments,
          row.from_email,
          row.from_name,
          row.reply_to,
          row.sender_name,
        )
      } else if (row.canal === 'sms') {
        throw new Error('SMS requiere envio manual (app nativa)')
      } else if (row.canal === 'telegram') {
        await sendTelegram(destinatario, message)
      }

      await supabase.from('outbox_messages').update({
        status: 'enviado',
        sent_at: sentAt,
        error_message: null,
        ...(providerMessageId ? { provider_message_id: providerMessageId } : {}),
        locked_at: null,
        locked_by: null,
      }).eq('id', row.id).eq('status', 'en_proceso')
      await syncMkMessage(row.id, { status: 'enviado', sent_at: sentAt })
      sent += 1
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Error enviando'
      const retryable = isRetryableError(err)
      if (retryable) {
        const retryAfter = nextRetryAfter()
        await supabase.from('outbox_messages').update({
          status: 'retry_pending',
          retry_after: retryAfter,
          error_message: errorMsg,
          locked_at: null,
          locked_by: null,
        }).eq('id', row.id).eq('status', 'en_proceso')
        // Sync back to 'programado' in mk_messages: the message is still pending,
        // not stuck. 'retry_pending' is not in the mk_messages CHECK constraint.
        await syncMkMessage(row.id, { status: 'programado' })
        console.warn('process-outbox: retry_pending', row.id, 'after', retryAfter, errorMsg)
        failures.push({ id: row.id, error: `retry_pending: ${errorMsg}` })
      } else {
        await supabase.from('outbox_messages').update({
          status: 'fallido',
          failed_at: sentAt,
          error_message: errorMsg,
          locked_at: null,
          locked_by: null,
        }).eq('id', row.id).eq('status', 'en_proceso')
        await syncMkMessage(row.id, { status: 'fallido' })
        failed += 1
        console.warn('process-outbox: permanent failure', row.id, errorMsg)
        failures.push({ id: row.id, error: errorMsg })
      }
    }
  }

  return jsonResponse({
    ok: true,
    processed: rows.length,
    sent,
    failed,
    failures,
  }, 200, req)
})
