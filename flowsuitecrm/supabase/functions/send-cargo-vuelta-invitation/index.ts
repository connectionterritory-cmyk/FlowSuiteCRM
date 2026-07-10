import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

const WORKER_SECRET = 'c93f0788596c831e23020e23971924b84d91b1fe4ade27c0bb8a2cb4243bd1ea'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Royal Prestige <cobranza@flowiadigital.com>'

const supabase = createClient(supabaseUrl, serviceRoleKey)

type InvitationData = {
  case_id: string
  cliente_id: string
  cliente_nombre: string
  cliente_email: string | null
  monto_devuelto: number
  org_id: string
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function escapeHtml(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '$0.00'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function buildEmailHtml(data: InvitationData): string {
  const nombre = escapeHtml(data.cliente_nombre || 'Cliente')
  const amount = escapeHtml(formatMoney(data.monto_devuelto))

  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1f2937;background:#f8fafc">
      <div style="background:linear-gradient(135deg,#0f2044 0%,#1d4ed8 100%);padding:24px 28px;border-radius:18px 18px 0 0;color:#ffffff">
        <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85">Connection Worldwide Group</div>
        <h1 style="margin:10px 0 6px;font-size:28px;line-height:1.1">⚖️ Formalice un acuerdo de pago / Set up a payment agreement</h1>
        <div style="font-size:14px;opacity:0.92">Royal Prestige - Connection Worldwide Group</div>
      </div>
      <div style="background:#ffffff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 18px 18px">
        <p style="margin:0 0 14px;font-size:16px;color:#0f172a">Hola ${nombre},</p>
        <p style="margin:0 0 14px;color:#475569;font-size:14px;line-height:1.75">
          Te escribimos de Connection Worldwide Group, distribuidor autorizado de Royal Prestige, en relacion a tu cuenta con balance pendiente de <strong>${amount}</strong>.
        </p>
        <p style="margin:0 0 14px;color:#475569;font-size:14px;line-height:1.75">
          Queremos ofrecerte la oportunidad de formalizar un acuerdo de pago mensual comodo, adaptado a tu situacion, antes de una posible remision de tu cuenta a nuestro <strong>⚖️ departamento legal</strong>. En vez de un pago unico, puedes distribuir tu balance en cuotas mensuales que definimos juntos.
        </p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.75">
          Contactanos hoy mismo para conversar sobre las opciones disponibles:<br />
          Tel: 786-291-3042<br />
          Email: info@connectionworldwidegroup.com<br />
          Horario: Lunes a Sabado, 9:00 AM - 8:00 PM
        </p>
        <p style="margin:0 0 24px;color:#0f172a;font-size:14px;line-height:1.75">
          Llama hoy mismo. En muchos casos podemos encontrar una solucion antes de que el proceso continue.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0" />
        <p style="margin:0 0 14px;font-size:16px;color:#0f172a">Hello ${nombre},</p>
        <p style="margin:0 0 14px;color:#475569;font-size:14px;line-height:1.75">
          We're reaching out from Connection Worldwide Group, authorized Royal Prestige distributor, regarding your account with a pending balance of <strong>${amount}</strong>.
        </p>
        <p style="margin:0 0 14px;color:#475569;font-size:14px;line-height:1.75">
          We'd like to offer you the opportunity to set up a comfortable monthly payment agreement, adapted to your situation, before a possible referral of your account to our <strong>⚖️ legal department</strong>. Instead of a single payment, you can spread your balance into monthly installments that we define together.
        </p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.75">
          Contact us today to discuss your options:<br />
          Tel: 786-291-3042<br />
          Email: info@connectionworldwidegroup.com<br />
          Hours: Monday to Saturday, 9:00 AM - 8:00 PM
        </p>
        <p style="margin:0 0 24px;color:#0f172a;font-size:14px;line-height:1.75">
          Call us today. In many cases, we can help you find a solution before the process moves forward.
        </p>
        <p style="margin:0 0 18px;color:#0f172a;font-size:14px">Best regards,<br />Connection Worldwide Group</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0" />
        <p style="color:#6b7280;font-size:12px;line-height:1.6;text-align:center;margin:0">
          Connection Worldwide Group<br />
          Distribuidor autorizado de Royal Prestige<br />
          Tel: 786-291-3042
        </p>
      </div>
    </div>
  `
}

function buildTextBody(data: InvitationData): string {
  const amount = formatMoney(data.monto_devuelto)
  return (
    `Hola ${data.cliente_nombre},\n\n` +
    `Te escribimos de Connection Worldwide Group, distribuidor autorizado de Royal Prestige, en relacion a tu cuenta con balance pendiente de ${amount}.\n\n` +
    `Queremos ofrecerte la oportunidad de formalizar un acuerdo de pago mensual comodo, adaptado a tu situacion, antes de una posible remision de tu cuenta a nuestro departamento legal. En vez de un pago unico, puedes distribuir tu balance en cuotas mensuales que definimos juntos.\n\n` +
    `Contactanos hoy mismo para conversar sobre las opciones disponibles:\n` +
    `Tel: 786-291-3042\nEmail: info@connectionworldwidegroup.com\nHorario: Lunes a Sabado, 9:00 AM - 8:00 PM\n\n` +
    `Llama hoy mismo. En muchos casos podemos encontrar una solucion antes de que el proceso continue.\n\n` +
    `Atentamente,\nConnection Worldwide Group\n\n` +
    `---\n\n` +
    `Hello ${data.cliente_nombre},\n\n` +
    `We're reaching out from Connection Worldwide Group, authorized Royal Prestige distributor, regarding your account with a pending balance of ${amount}.\n\n` +
    `We'd like to offer you the opportunity to set up a comfortable monthly payment agreement, adapted to your situation, before a possible referral of your account to our legal department. Instead of a single payment, you can spread your balance into monthly installments that we define together.\n\n` +
    `Contact us today to discuss your options:\n` +
    `Tel: 786-291-3042\nEmail: info@connectionworldwidegroup.com\nHours: Monday to Saturday, 9:00 AM - 8:00 PM\n\n` +
    `Call us today. In many cases, we can help you find a solution before the process moves forward.\n\n` +
    `Best regards,\nConnection Worldwide Group`
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const secretHeader = req.headers.get('x-worker-secret') ?? ''
  if (secretHeader !== WORKER_SECRET) return jsonResponse({ error: 'Unauthorized' }, 401)

  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Missing service role configuration' }, 500)
  if (!resendKey) return jsonResponse({ error: 'Missing Resend API key' }, 500)

  let payload: { case_id?: string; test_email_override?: string }
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const caseId = payload.case_id?.trim()
  const testOverride = payload.test_email_override?.trim() || null
  const isTestMode = !!testOverride

  if (!caseId) return jsonResponse({ error: 'case_id is required' }, 400)

  if (!isTestMode) {
    const { data: existingLog } = await supabase
      .from('statement_delivery_logs')
      .select('id, email_status')
      .eq('document_type', 'invitacion_acuerdo')
      .eq('document_id', caseId)
      .eq('email_status', 'sent')
      .maybeSingle()

    if (existingLog) return jsonResponse({ ok: true, skipped: true, reason: 'already_sent' })
  }

  const { data: invitationData, error: invitationError } = await supabase.rpc('fn_cob_get_invitacion_data', { p_case_id: caseId })

  if (invitationError || !invitationData) {
    return jsonResponse({ error: 'No se pudo obtener datos de la invitacion', details: invitationError?.message }, 404)
  }

  const data = invitationData as InvitationData
  const emailTo = testOverride || data.cliente_email

  if (!emailTo) {
    const { error: logError } = await supabase.from('statement_delivery_logs').insert({
      org_id: data.org_id,
      document_type: 'invitacion_acuerdo',
      document_id: data.case_id,
      case_id: data.case_id,
      cliente_id: data.cliente_id,
      email_to: null,
      email_status: 'failed',
      email_error: 'Cliente sin email registrado',
      delivery_attempt_count: 1,
      last_delivery_attempt_at: new Date().toISOString(),
      metadata: data,
    })

    if (logError) {
      console.error('Fallo al escribir statement_delivery_logs:', logError)
      return jsonResponse({
        ok: false,
        error: 'Cliente sin email registrado',
        warning: 'No se pudo escribir el log de idempotencia',
        log_error: logError.message,
      }, 200)
    }

    return jsonResponse({ ok: false, error: 'Cliente sin email registrado' }, 200)
  }

  const resendPayload = {
    from: resendFrom,
    to: emailTo,
    subject:
      '⚖️ Su cuenta Royal Prestige podria ser remitida al departamento legal. Formalice un acuerdo de pago hoy. / Your Royal Prestige account may be referred to our legal department - Set up a payment agreement today.',
    html: buildEmailHtml(data),
    text: buildTextBody(data),
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify(resendPayload),
  })

  const ok = res.ok
  const responseText = await res.text()

  if (!ok) {
    return jsonResponse({
      ok: false,
      error: 'Resend API error',
      details: responseText,
      test_mode: isTestMode,
    }, 502)
  }

  if (isTestMode) {
    return jsonResponse({
      ok: true,
      email_to: emailTo,
      test_mode: true,
      skipped_log_write: true,
    })
  }

  const { error: logError } = await supabase.from('statement_delivery_logs').insert({
    org_id: data.org_id,
    document_type: 'invitacion_acuerdo',
    document_id: data.case_id,
    case_id: data.case_id,
    cliente_id: data.cliente_id,
    email_to: emailTo,
    email_status: 'sent',
    email_sent_at: new Date().toISOString(),
    delivery_attempt_count: 1,
    last_delivery_attempt_at: new Date().toISOString(),
    metadata: data,
  })

  if (logError) {
    console.error('Fallo al escribir statement_delivery_logs:', logError)
    return jsonResponse({
      ok: true,
      email_to: emailTo,
      warning: 'Email enviado pero el log de auditoria no se pudo escribir',
      log_error: logError.message,
    }, 200)
  }

  return jsonResponse({
    ok: true,
    email_to: emailTo,
    test_mode: false,
  })
})
