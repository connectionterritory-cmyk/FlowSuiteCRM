import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type OutboxStatus =
  | 'borrador'
  | 'programado'
  | 'en_proceso'
  | 'enviado'
  | 'fallido'
  | 'retry_pending'
  | 'cancelado'

type OutboxMessage = {
  id: string
  org_id: string | null
  canal: 'whatsapp' | 'sms' | 'email' | 'telegram'
  destinatario: string | null
  asunto: string | null
  mensaje: string | null
  mensaje_resuelto: string | null
  attachment_urls: string[] | null
  scheduled_for: string | null
  retry_after: string | null
  locked_at: string | null
  locked_by: string | null
  status: OutboxStatus
  from_email: string | null
  from_name: string | null
  reply_to: string | null
  sender_name: string | null
  cc_emails: string[] | null
  tipo_envio?: 'text' | 'template' | null
  template_name?: string | null
  template_params?: unknown
  provider?: string | null
  provider_message_id?: string | null
  error_message?: string | null
  attempt_count?: number | null
  dispatch_provider?: string | null
}

type AttemptStatus = 'started' | 'accepted' | 'sent' | 'retry_pending' | 'failed'

type DeliveryResult = {
  providerMessageId: string | null
  requestPayload: Record<string, unknown>
  responsePayload: unknown
}

type ProcessResult = {
  ok: boolean
  outbox_id: string
  status: OutboxStatus
  provider: string | null
  provider_message_id: string | null
  error_message: string | null
  attempt_count: number
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL') ?? 'cobranza@flowiadigital.com'
const resendFromName = Deno.env.get('RESEND_FROM_NAME') ?? 'Royal Prestige'

// Meta Cloud API
// Preferred vars: META_ACCESS_TOKEN + META_PHONE_NUMBER_ID
// Backward compatibility: META_WHATSAPP_TOKEN
const metaAccessToken = Deno.env.get('META_ACCESS_TOKEN') ?? Deno.env.get('META_WHATSAPP_TOKEN') ?? ''
const metaPhoneNumberId = Deno.env.get('META_PHONE_NUMBER_ID') ?? ''
const metaApiVersion = Deno.env.get('META_API_VERSION') ?? 'v25.0'

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

function toJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value }
}

function sanitizeMetaPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const type = typeof payload.type === 'string' ? payload.type : null
  const template = toJsonObject(payload.template)
  return {
    messaging_product: payload.messaging_product,
    to: payload.to,
    type,
    template_name: type === 'template' ? template.name ?? null : null,
    media_link_present: Boolean(type && ['image', 'video', 'audio', 'document'].includes(type)),
    text_present: type === 'text',
  }
}

function rowResult(row: OutboxMessage, ok: boolean): ProcessResult {
  return {
    ok,
    outbox_id: row.id,
    status: row.status,
    provider: row.provider ?? null,
    provider_message_id: row.provider_message_id ?? null,
    error_message: row.error_message ?? null,
    attempt_count: row.attempt_count ?? 0,
  }
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

function normalizePhone(phone: string): string {
  const raw = String(phone ?? '').trim()
  if (!raw) throw new Error('Phone is required')

  let digits = raw.replace(/\D/g, '')

  // Handle international prefix 00xxxx
  if (digits.startsWith('00')) {
    digits = digits.slice(2)
  }

  // Default USA when only 10 digits are provided
  if (digits.length === 10) {
    digits = `1${digits}`
  }

  // Minimal validity check for E.164-like payload without plus sign
  if (digits.length < 11) {
    throw new Error(`Invalid phone length after normalization: ${digits.length}`)
  }

  return digits
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

function inferMetaMediaType(url: string): 'image' | 'video' | 'audio' | 'document' {
  const clean = url.split('?')[0].toLowerCase()
  if (/\.(jpg|jpeg|png|webp|gif)$/.test(clean)) return 'image'
  if (/\.(mp4|mov|webm|mkv)$/.test(clean)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(clean)) return 'audio'
  return 'document'
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

// After a successful WhatsApp send, write the outbound message into the
// conversations/messages tables so the inbox thread stays in sync and
// the direction trigger fires correctly for the follow-up cron.
async function syncConversationOutbound(opts: {
  destinatario: string
  messageText: string
  providerMessageId: string | null
  attachmentUrls?: string[] | null
}) {
  try {
    let phoneDigits = opts.destinatario.replace(/\D/g, '')
    if (phoneDigits.startsWith('00')) phoneDigits = phoneDigits.slice(2)
    if (phoneDigits.length === 10) phoneDigits = `1${phoneDigits}`
    const phoneE164 = `+${phoneDigits}`

    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .or(`wa_id.eq.${phoneDigits},phone_e164.eq.${phoneE164}`)
      .maybeSingle()

    if (!conv?.id) return

    await supabase.from('messages').insert({
      conversation_id: conv.id,
      direction: 'outbound',
      message: opts.messageText || null,
      provider_message_id: opts.providerMessageId,
      status: 'sent',
      attachment_urls: opts.attachmentUrls ?? [],
    })

    // last_message_at + last_message_direction updated by trigger, but
    // preview and at are set here in case the trigger is not yet deployed
    await supabase.from('conversations').update({
      last_message_at: new Date().toISOString(),
      last_message_preview: opts.messageText ? opts.messageText.substring(0, 120) : '(adjunto)',
      updated_at: new Date().toISOString(),
    }).eq('id', conv.id)
  } catch (e) {
    console.warn('process-outbox: syncConversationOutbound failed (non-fatal)', e)
  }
}

async function updateOutbox(id: string, payload: Record<string, unknown>) {
  let { error } = await supabase
    .from('outbox_messages')
    .update(payload)
    .eq('id', id)
    .eq('status', 'en_proceso')

  if (error && /column .* does not exist/i.test(error.message)) {
    const fallbackPayload = { ...payload }
    delete fallbackPayload.provider

    const retry = await supabase
      .from('outbox_messages')
      .update(fallbackPayload)
      .eq('id', id)
      .eq('status', 'en_proceso')

    error = retry.error
  }

  if (error) {
    throw error
  }
}

async function fetchOutboxResult(id: string, ok: boolean): Promise<ProcessResult> {
  const { data, error } = await supabase
    .from('outbox_messages')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    return {
      ok: false,
      outbox_id: id,
      status: 'fallido',
      provider: null,
      provider_message_id: null,
      error_message: error?.message ?? 'Outbox message not found',
      attempt_count: 0,
    }
  }

  return rowResult(data as OutboxMessage, ok && (data as OutboxMessage).status === 'enviado')
}

async function insertAttempt(opts: {
  row: OutboxMessage
  attemptNumber: number
  provider: string | null
  status: AttemptStatus
  requestPayload?: Record<string, unknown> | null
  responsePayload?: unknown
  errorMessage?: string | null
}) {
  const payload = {
    provider: opts.provider,
    ...(opts.requestPayload ?? {}),
  }

  const { error } = await supabase.from('outbox_delivery_attempts').insert({
    outbox_message_id: opts.row.id,
    org_id: opts.row.org_id,
    attempt_number: opts.attemptNumber,
    dispatcher: 'process-outbox',
    status: opts.status,
    request_payload: payload,
    response_payload: opts.responsePayload === undefined ? null : toJsonObject(opts.responsePayload),
    error_message: opts.errorMessage ?? null,
  })

  if (error) {
    console.warn('process-outbox: failed to insert delivery attempt', opts.row.id, error.message)
  }
}

async function sendMetaRequest(body: Record<string, unknown>) {
  if (!metaAccessToken || !metaPhoneNumberId) {
    throw new Error('Missing Meta Cloud API configuration')
  }

  const res = await fetch(`https://graph.facebook.com/${metaApiVersion}/${metaPhoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${metaAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? 'Meta API error'
    const retryable = res.status === 429 || res.status >= 500
    throw asProviderError(`Meta WhatsApp error (${res.status}): ${msg}`, retryable)
  }

  return data as { messages?: Array<{ id?: string }> } | null
}

function parseTemplateParams(raw: unknown): string[] {
  if (!raw) return []
  if (!Array.isArray(raw)) return []
  return raw
    .map((value) => {
      if (value === null || value === undefined) return ''
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
      if (typeof value === 'object') {
        const text = (value as { text?: unknown }).text
        if (text === null || text === undefined) return ''
        return String(text)
      }
      return ''
    })
    .filter((v) => v.trim() !== '')
}

async function sendWhatsAppText(destinatario: string, message: string, attachments?: string[] | null): Promise<DeliveryResult> {
  const to = normalizePhone(destinatario)
  let providerMessageId: string | null = null
  const requests: Record<string, unknown>[] = []
  const responses: unknown[] = []

  const trimmed = String(message ?? '').trim()
  if (trimmed) {
    const request = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: trimmed },
    }
    requests.push(sanitizeMetaPayload(request))
    const data = await sendMetaRequest(request)
    responses.push(data)
    providerMessageId = data?.messages?.[0]?.id ?? providerMessageId
  }

  for (const mediaUrl of attachments ?? []) {
    const mediaType = inferMetaMediaType(mediaUrl)
    const mediaPayload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: mediaType,
      [mediaType]: {
        link: mediaUrl,
      },
    }

    requests.push(sanitizeMetaPayload(mediaPayload))
    const mediaResult = await sendMetaRequest(mediaPayload)
    responses.push(mediaResult)
    providerMessageId = providerMessageId ?? mediaResult?.messages?.[0]?.id ?? null
  }

  if (!providerMessageId && !trimmed && (!attachments || attachments.length === 0)) {
    throw new Error('Missing WhatsApp content (text/template/media)')
  }

  return {
    providerMessageId,
    requestPayload: { provider: 'meta', requests },
    responsePayload: { responses },
  }
}

async function sendWhatsAppTemplate(destinatario: string, templateName: string, templateParams: unknown): Promise<DeliveryResult> {
  const to = normalizePhone(destinatario)
  const name = String(templateName ?? '').trim()
  if (!name) {
    throw new Error('template_name is required when tipo_envio=template')
  }

  const params = parseTemplateParams(templateParams)

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: {
        code: 'en_US',
      },
      components: params.length > 0
        ? [
          {
            type: 'body',
            parameters: params.map((text) => ({
              type: 'text',
              text,
            })),
          },
        ]
        : undefined,
    },
  }

  const result = await sendMetaRequest(payload)
  return {
    providerMessageId: result?.messages?.[0]?.id ?? null,
    requestPayload: { provider: 'meta', request: sanitizeMetaPayload(payload) },
    responsePayload: result,
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
  ccEmails?: string[] | null,
): Promise<DeliveryResult> {
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
  if (ccEmails && ccEmails.length > 0) {
    body.cc = ccEmails.filter(e => e.includes('@'))
  }

  const requestPayload = {
    provider: 'resend',
    from: body.from,
    to: body.to,
    subject: body.subject,
    reply_to: body.reply_to ?? null,
    cc: body.cc ?? null,
    attachment_count: resendAttachments.length,
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
  return {
    providerMessageId: (data as { id?: string } | null)?.id ?? null,
    requestPayload,
    responsePayload: data,
  }
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

async function processOutboxRow(row: OutboxMessage, nowIso: string): Promise<ProcessResult> {
  // n8n-dispatched rows must not be processed by this worker
  if (row.dispatch_provider === 'n8n' || row.dispatch_provider === 'n8n_mock') {
    console.log('process-outbox: skipping n8n-dispatched row', row.id, row.dispatch_provider)
    return rowResult(row, true)
  }

  const scheduledAt = row.scheduled_for ? Date.parse(row.scheduled_for) : NaN
  if (row.status === 'programado' && Number.isFinite(scheduledAt) && scheduledAt > Date.now()) {
    return rowResult(row, true)
  }

  if (!['programado', 'retry_pending'].includes(row.status)) {
    return rowResult(row, row.status === 'enviado')
  }

  const { data: lockRows } = await supabase
    .from('outbox_messages')
    .update({
      status: 'en_proceso',
      locked_at: nowIso,
      locked_by: workerId,
      attempt_count: (row.attempt_count ?? 0) + 1,
    })
    .eq('id', row.id)
    .in('status', ['programado', 'retry_pending'])
    .select('*')

  if (!lockRows || lockRows.length === 0) {
    return fetchOutboxResult(row.id, false)
  }

  const lockedRow = lockRows[0] as OutboxMessage
  const attemptNumber = lockedRow.attempt_count ?? ((row.attempt_count ?? 0) + 1)
  console.log('process-outbox: locked message', row.id, 'by', workerId)
  await syncMkMessage(row.id, { status: 'en_proceso' })

  const message = (lockedRow.mensaje_resuelto ?? lockedRow.mensaje ?? '').trim()
  const destinatario = lockedRow.destinatario?.trim() ?? ''
  const attachments = lockedRow.attachment_urls
  const tipoEnvio = lockedRow.tipo_envio === 'template' ? 'template' : 'text'

  if (!destinatario) {
    await insertAttempt({
      row: lockedRow,
      attemptNumber,
      provider: null,
      status: 'failed',
      requestPayload: { canal: lockedRow.canal },
      responsePayload: { ok: false, validation: 'Missing destinatario' },
      errorMessage: 'Missing destinatario',
    })
    await updateOutbox(row.id, {
      status: 'fallido',
      failed_at: nowIso,
      error_message: 'Missing destinatario',
      locked_at: null,
      locked_by: null,
    })
    await syncMkMessage(row.id, { status: 'fallido' })
    console.warn('process-outbox: permanent failure (missing destinatario)', row.id)
    return fetchOutboxResult(row.id, false)
  }

  if (lockedRow.canal !== 'whatsapp' && !message) {
    await insertAttempt({
      row: lockedRow,
      attemptNumber,
      provider: null,
      status: 'failed',
      requestPayload: { canal: lockedRow.canal, destinatario },
      responsePayload: { ok: false, validation: 'Missing mensaje' },
      errorMessage: 'Missing mensaje',
    })
    await updateOutbox(row.id, {
      status: 'fallido',
      failed_at: nowIso,
      error_message: 'Missing mensaje',
      locked_at: null,
      locked_by: null,
    })
    await syncMkMessage(row.id, { status: 'fallido' })
    console.warn('process-outbox: permanent failure (missing mensaje)', row.id)
    return fetchOutboxResult(row.id, false)
  }

  try {
    let delivery: DeliveryResult | null = null
    let provider: string | null = null

    if (lockedRow.canal === 'whatsapp') {
      provider = 'meta'
      if (tipoEnvio === 'template') {
        delivery = await sendWhatsAppTemplate(destinatario, lockedRow.template_name ?? '', lockedRow.template_params)
        if (attachments && attachments.length > 0) {
          const mediaDelivery = await sendWhatsAppText(destinatario, '', attachments)
          delivery = {
            providerMessageId: delivery.providerMessageId ?? mediaDelivery.providerMessageId,
            requestPayload: {
              provider,
              requests: [delivery.requestPayload, mediaDelivery.requestPayload],
            },
            responsePayload: {
              responses: [delivery.responsePayload, mediaDelivery.responsePayload],
            },
          }
        }
      } else {
        delivery = await sendWhatsAppText(destinatario, message, attachments)
      }
    } else if (lockedRow.canal === 'email') {
      provider = 'resend'
      delivery = await sendEmail(
        destinatario,
        lockedRow.asunto?.trim() || 'Mensaje',
        message,
        attachments,
        lockedRow.from_email,
        lockedRow.from_name,
        lockedRow.reply_to,
        lockedRow.sender_name,
        lockedRow.cc_emails,
      )
    } else if (lockedRow.canal === 'sms') {
      throw new Error('SMS requiere envio manual (app nativa)')
    } else if (lockedRow.canal === 'telegram') {
      provider = 'telegram'
      await sendTelegram(destinatario, message)
      delivery = {
        providerMessageId: null,
        requestPayload: { provider, chat_id: destinatario },
        responsePayload: { ok: true },
      }
    }

    await insertAttempt({
      row: lockedRow,
      attemptNumber,
      provider,
      status: 'sent',
      requestPayload: delivery?.requestPayload ?? { canal: lockedRow.canal, destinatario },
      responsePayload: delivery?.responsePayload ?? { ok: true },
    })

    await updateOutbox(row.id, {
      status: 'enviado',
      sent_at: nowIso,
      error_message: null,
      provider,
      provider_message_id: delivery?.providerMessageId ?? null,
      provider_response: delivery?.responsePayload ?? null,
      locked_at: null,
      locked_by: null,
    })
    await syncMkMessage(row.id, { status: 'enviado', sent_at: nowIso })

    if (lockedRow.canal === 'whatsapp') {
      await syncConversationOutbound({
        destinatario,
        messageText: message,
        providerMessageId: delivery?.providerMessageId ?? null,
        attachmentUrls: attachments,
      })
    }

    return fetchOutboxResult(row.id, true)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Error enviando'
    const provider = lockedRow.canal === 'whatsapp' ? 'meta' : lockedRow.canal === 'email' ? 'resend' : lockedRow.canal

    if (lockedRow.canal === 'whatsapp') {
      await insertAttempt({
        row: lockedRow,
        attemptNumber,
        provider,
        status: 'failed',
        requestPayload: { canal: lockedRow.canal, destinatario, tipo_envio: tipoEnvio },
        responsePayload: { ok: false },
        errorMessage: errorMsg,
      })
      await updateOutbox(row.id, {
        status: 'fallido',
        failed_at: nowIso,
        error_message: errorMsg,
        provider,
        locked_at: null,
        locked_by: null,
      })
      await syncMkMessage(row.id, { status: 'fallido' })
      console.warn('process-outbox: whatsapp meta permanent failure', row.id, errorMsg)
      return fetchOutboxResult(row.id, false)
    }

    const retryable = isRetryableError(err)
    if (retryable) {
      const retryAfter = nextRetryAfter()
      await insertAttempt({
        row: lockedRow,
        attemptNumber,
        provider,
        status: 'retry_pending',
        requestPayload: { canal: lockedRow.canal, destinatario },
        responsePayload: { ok: false, retry_after: retryAfter },
        errorMessage: errorMsg,
      })
      await updateOutbox(row.id, {
        status: 'retry_pending',
        retry_after: retryAfter,
        error_message: errorMsg,
        provider,
        locked_at: null,
        locked_by: null,
      })
      await syncMkMessage(row.id, { status: 'programado' })
      console.warn('process-outbox: retry_pending', row.id, 'after', retryAfter, errorMsg)
    } else {
      await insertAttempt({
        row: lockedRow,
        attemptNumber,
        provider,
        status: 'failed',
        requestPayload: { canal: lockedRow.canal, destinatario },
        responsePayload: { ok: false },
        errorMessage: errorMsg,
      })
      await updateOutbox(row.id, {
        status: 'fallido',
        failed_at: nowIso,
        error_message: errorMsg,
        provider,
        locked_at: null,
        locked_by: null,
      })
      await syncMkMessage(row.id, { status: 'fallido' })
      console.warn('process-outbox: permanent failure', row.id, errorMsg)
    }

    return fetchOutboxResult(row.id, false)
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

  let requestedOutboxId: string | null = null
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => null) : null
    requestedOutboxId = typeof body?.outbox_id === 'string' && body.outbox_id.trim()
      ? body.outbox_id.trim()
      : null
  } catch {
    requestedOutboxId = null
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
    for (const r of reclaimed) {
      await syncMkMessage(r.id, { status: 'programado' })
    }
  }

  if (requestedOutboxId) {
    const { data, error } = await supabase
      .from('outbox_messages')
      .select('*')
      .eq('id', requestedOutboxId)
      .maybeSingle()

    if (error) {
      return jsonResponse({
        ok: false,
        outbox_id: requestedOutboxId,
        status: 'fallido',
        provider: null,
        provider_message_id: null,
        error_message: error.message,
        attempt_count: 0,
      }, 500, req)
    }

    if (!data) {
      return jsonResponse({
        ok: false,
        outbox_id: requestedOutboxId,
        status: 'fallido',
        provider: null,
        provider_message_id: null,
        error_message: 'Outbox message not found',
        attempt_count: 0,
      }, 404, req)
    }

    const result = await processOutboxRow(data as OutboxMessage, nowIso)
    return jsonResponse(result as unknown as Record<string, unknown>, 200, req)
  }

  const { data, error } = await supabase
    .from('outbox_messages')
    .select('*')
    .or(
      [
        `and(status.eq.programado,scheduled_for.lte.${nowIso})`,
        `and(status.eq.retry_pending,retry_after.lte.${nowIso})`,
        `and(status.eq.retry_pending,retry_after.is.null)`
      ].join(',')
    )
    // Exclude rows delegated to n8n — those are processed by the n8n workflow, not here
    .or('dispatch_provider.is.null,dispatch_provider.not.in.(n8n,n8n_mock)')
    .order('scheduled_for', { ascending: true })
    .limit(50)

  if (error) {
    return jsonResponse({ error: error.message }, 500, req)
  }

  const rows = (data as OutboxMessage[] | null) ?? []
  const results: ProcessResult[] = []

  for (const row of rows) {
    results.push(await processOutboxRow(row, new Date().toISOString()))
  }

  return jsonResponse({
    ok: true,
    processed: rows.length,
    sent: results.filter(r => r.status === 'enviado').length,
    failed: results.filter(r => r.status === 'fallido').length,
    failures: results
      .filter(r => r.error_message)
      .map(r => ({ id: r.outbox_id, error: r.error_message })),
  }, 200, req)
})
