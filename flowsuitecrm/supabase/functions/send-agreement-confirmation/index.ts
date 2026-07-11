import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

const WORKER_SECRET = 'c93f0788596c831e23020e23971924b84d91b1fe4ade27c0bb8a2cb4243bd1ea'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Royal Prestige <cobranza@flowiadigital.com>'

const supabase = createClient(supabaseUrl, serviceRoleKey)

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]

const PRIVILEGED_ROLES = new Set([
  'admin',
  'distribuidor',
  'telemercadeo',
  'supervisor_tele',
  'supervisor_telemercadeo',
])

type UserProfile = {
  id: string
  org_id: string | null
  rol: string | null
}

type AuthorizedRequester =
  | { mode: 'worker' }
  | { mode: 'user'; userId: string; orgId: string; role: string }

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info, x-worker-secret',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  })
}

function normalizeToken(header: string | null): string | null {
  if (!header) return null
  return header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim()
}

async function authorizeRequest(req: Request): Promise<AuthorizedRequester | Response> {
  const secretHeader = req.headers.get('x-worker-secret') ?? ''
  if (secretHeader === WORKER_SECRET) return { mode: 'worker' }

  const token = normalizeToken(req.headers.get('Authorization'))
  if (!token) {
    return jsonResponse(req, { error: 'Missing authorization' }, 401)
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse(req, { error: 'Invalid token' }, 401)
  }

  const { data: profileData, error: profileError } = await supabase
    .from('usuarios')
    .select('id, org_id, rol')
    .eq('id', user.id)
    .maybeSingle()

  const profile = (profileData as UserProfile | null) ?? null
  if (profileError || !profile?.org_id || !profile?.rol) {
    return jsonResponse(req, { error: 'User profile not found' }, 403)
  }

  if (!PRIVILEGED_ROLES.has(profile.rol)) {
    return jsonResponse(req, { error: 'Forbidden' }, 403)
  }

  return {
    mode: 'user',
    userId: user.id,
    orgId: profile.org_id,
    role: profile.rol,
  }
}

function escapeHtml(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '$0.00'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatApr(apr: number | null | undefined): string {
  if (apr === null || apr === undefined) return 'N/A'
  return `${(apr * 100).toFixed(2)}%`
}

function ordinalDay(day: number): string {
  return String(day)
}

type ConfirmationData = {
  case_id: string
  org_id: string
  cliente_id: string
  cliente_nombre: string
  cliente_email: string | null
  monto_mensual: number
  dia_cobro: number
  apr: number | null
}

function buildEmailHtml(data: ConfirmationData): string {
  const nombre = escapeHtml(data.cliente_nombre || 'Cliente')
  const monto = escapeHtml(formatMoney(data.monto_mensual))
  const dia = escapeHtml(ordinalDay(data.dia_cobro))
  const apr = escapeHtml(formatApr(data.apr))

  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1f2937;background:#f8fafc">
      <div style="background:linear-gradient(135deg,#0f2044 0%,#1d4ed8 100%);padding:24px 28px;border-radius:18px 18px 0 0;color:#ffffff">
        <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85">Connection Worldwide Group</div>
        <h1 style="margin:10px 0 6px;font-size:26px;line-height:1.1">Acuerdo de pago confirmado / Payment agreement confirmed</h1>
        <div style="font-size:14px;opacity:0.92">Royal Prestige - Connection Worldwide Group</div>
      </div>
      <div style="background:#ffffff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 18px 18px">
        <p style="margin:0 0 14px;font-size:16px;color:#0f172a">Hola ${nombre},</p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.75">
          Tu acuerdo de pago mensual quedó formalizado. Este es un resumen de las condiciones acordadas:
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 18px">
          <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Pago mensual acordado</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px;color:#0f172a">${monto}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Día de pago</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px;color:#0f172a">${dia}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Tasa anual (APR)</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px;color:#0f172a">${apr}</td></tr>
        </table>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.75">
          Gracias por formalizar tu acuerdo. Si tienes preguntas, contáctanos al 786-291-3042 o info@connectionworldwidegroup.com.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0" />
        <p style="margin:0 0 14px;font-size:16px;color:#0f172a">Hello ${nombre},</p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.75">
          Your monthly payment agreement has been formalized. Here is a summary of the agreed terms:
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 18px">
          <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Agreed monthly payment</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px;color:#0f172a">${monto}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Payment day</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px;color:#0f172a">${dia}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Annual rate (APR)</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px;color:#0f172a">${apr}</td></tr>
        </table>
        <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.75">
          Thank you for formalizing your agreement. If you have any questions, contact us at 786-291-3042 or info@connectionworldwidegroup.com.
        </p>
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

function buildTextBody(data: ConfirmationData): string {
  return (
    `Hola ${data.cliente_nombre},\n\n` +
    `Tu acuerdo de pago mensual quedó formalizado.\n` +
    `Pago mensual acordado: ${formatMoney(data.monto_mensual)}\n` +
    `Día de pago: ${ordinalDay(data.dia_cobro)}\n` +
    `Tasa anual (APR): ${formatApr(data.apr)}\n\n` +
    `Gracias por formalizar tu acuerdo. Contáctanos al 786-291-3042 o info@connectionworldwidegroup.com.\n\n` +
    `---\n\n` +
    `Hello ${data.cliente_nombre},\n\n` +
    `Your monthly payment agreement has been formalized.\n` +
    `Agreed monthly payment: ${formatMoney(data.monto_mensual)}\n` +
    `Payment day: ${ordinalDay(data.dia_cobro)}\n` +
    `Annual rate (APR): ${formatApr(data.apr)}\n\n` +
    `Thank you for formalizing your agreement. Contact us at 786-291-3042 or info@connectionworldwidegroup.com.\n\n` +
    `Connection Worldwide Group`
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405)

  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(req, { error: 'Missing service role configuration' }, 500)
  if (!resendKey) return jsonResponse(req, { error: 'Missing Resend API key' }, 500)

  const requester = await authorizeRequest(req)
  if (requester instanceof Response) return requester

  let payload: {
    case_id?: string
    monto_mensual?: number
    dia_cobro?: number
    apr?: number | null
    test_email_override?: string
  }
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON body' }, 400)
  }

  const caseId = payload.case_id?.trim()
  if (!caseId) return jsonResponse(req, { error: 'case_id is required' }, 400)
  if (!Number.isFinite(payload.monto_mensual) || (payload.monto_mensual ?? 0) <= 0) {
    return jsonResponse(req, { error: 'monto_mensual is required and must be > 0' }, 400)
  }
  if (!Number.isInteger(payload.dia_cobro) || (payload.dia_cobro ?? 0) < 1 || (payload.dia_cobro ?? 0) > 31) {
    return jsonResponse(req, { error: 'dia_cobro must be an integer between 1 and 31' }, 400)
  }

  const testOverride = payload.test_email_override?.trim() || null
  const isTestMode = !!testOverride

  const { data: caseRow, error: caseError } = await supabase
    .from('cargo_vuelta_cases')
    .select('id, org_id, cliente_id')
    .eq('id', caseId)
    .single()

  if (caseError || !caseRow) {
    return jsonResponse(req, { error: 'Caso no encontrado', details: caseError?.message }, 404)
  }

  if (requester.mode === 'user' && caseRow.org_id !== requester.orgId) {
    return jsonResponse(req, { error: 'Forbidden for this organization' }, 403)
  }

  const { data: clienteRow, error: clienteError } = await supabase
    .from('clientes')
    .select('nombre, apellido, email')
    .eq('id', caseRow.cliente_id)
    .single()

  if (clienteError || !clienteRow) {
    return jsonResponse(req, { error: 'No se pudo obtener datos del cliente', details: clienteError?.message }, 500)
  }

  const nombre = [clienteRow.nombre, clienteRow.apellido].filter(Boolean).join(' ') || 'Cliente'
  const data: ConfirmationData = {
    case_id: caseId,
    org_id: caseRow.org_id,
    cliente_id: caseRow.cliente_id,
    cliente_nombre: nombre,
    cliente_email: clienteRow.email,
    monto_mensual: Number(payload.monto_mensual),
    dia_cobro: Number(payload.dia_cobro),
    apr: payload.apr ?? null,
  }

  const emailTo = testOverride || data.cliente_email

  if (!emailTo) {
    const { error: logError } = await supabase.from('statement_delivery_logs').insert({
      org_id: data.org_id,
      document_type: 'acuerdo_confirmacion',
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
    if (logError) console.error('Fallo al escribir statement_delivery_logs:', logError)
    return jsonResponse(req, { ok: false, error: 'Cliente sin email registrado' }, 200)
  }

  const resendPayload = {
    from: resendFrom,
    to: emailTo,
    subject: 'Tu acuerdo de pago quedó confirmado / Your payment agreement is confirmed',
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
  const deliveryStatus = ok ? (isTestMode ? 'test_sent' : 'sent') : 'failed'

  const { error: logError } = await supabase.from('statement_delivery_logs').insert({
    org_id: data.org_id,
    document_type: 'acuerdo_confirmacion',
    document_id: data.case_id,
    case_id: data.case_id,
    cliente_id: data.cliente_id,
    email_to: emailTo,
    email_status: deliveryStatus,
    email_sent_at: ok ? new Date().toISOString() : null,
    email_error: ok ? null : responseText,
    delivery_attempt_count: 1,
    last_delivery_attempt_at: new Date().toISOString(),
    metadata: { ...data, test_mode: isTestMode, test_email_override: testOverride },
  })

  if (logError) console.error('Fallo al escribir statement_delivery_logs:', logError)

  if (!ok) {
    return jsonResponse(req, {
      ok: false,
      error: 'Resend API error',
      details: responseText,
      test_mode: isTestMode,
      warning: logError ? 'Ademas fallo el log de idempotencia' : undefined,
    }, 502)
  }

  return jsonResponse(req, {
    ok: true,
    email_to: emailTo,
    test_mode: isTestMode,
    requested_by: requester.mode === 'user' ? requester.userId : 'worker',
    warning: logError ? 'Email enviado pero el log de auditoria no se pudo escribir' : undefined,
  })
})
