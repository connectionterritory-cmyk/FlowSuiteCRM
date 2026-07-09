import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

// Secreto compartido: solo lo conocen este archivo y la funcion SQL/trigger que lo invoca.
// No es env var porque no hubo tooling disponible para provisionarla remotamente en esta sesion.
// Si se rota, actualizar tambien en la base de datos (setting app.receipt_worker_secret).
const WORKER_SECRET = 'c93f0788596c831e23020e23971924b84d91b1fe4ade27c0bb8a2cb4243bd1ea'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Royal Prestige <cobranza@flowiadigital.com>'

const supabase = createClient(supabaseUrl, serviceRoleKey)

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

function formatDate(d: string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('es-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

const METODO_LABELS: Record<string, string> = {
  cash: 'Efectivo', check: 'Cheque', zelle: 'Zelle', ach: 'ACH', card: 'Tarjeta', hycite: 'Hy-Cite', wire: 'Transferencia', otro: 'Otro',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const secretHeader = req.headers.get('x-worker-secret') ?? ''
  if (secretHeader !== WORKER_SECRET) return jsonResponse({ error: 'Unauthorized' }, 401)

  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Missing service role configuration' }, 500)
  if (!resendKey) return jsonResponse({ error: 'Missing Resend API key' }, 500)

  let payload: { pago_id?: string }
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const pagoId = payload.pago_id
  if (!pagoId) return jsonResponse({ error: 'pago_id is required' }, 400)

  // Idempotencia: si ya se envio exitosamente un recibo para este pago, no reenviar.
  const { data: existingLog } = await supabase
    .from('statement_delivery_logs')
    .select('id, email_status')
    .eq('document_type', 'recibo_pago')
    .eq('document_id', pagoId)
    .eq('email_status', 'sent')
    .maybeSingle()

  if (existingLog) return jsonResponse({ ok: true, skipped: true, reason: 'already_sent' })

  const { data: recibo, error: reciboError } = await supabase.rpc('fn_cob_get_recibo_data', { p_pago_id: pagoId })

  if (reciboError || !recibo) {
    return jsonResponse({ error: 'No se pudo obtener datos del recibo', details: reciboError?.message }, 404)
  }

  const emailTo = recibo.cliente_email as string | null

  if (!emailTo) {
    const { error: logError } = await supabase.from('statement_delivery_logs').insert({
      org_id: recibo.org_id, document_type: 'recibo_pago', document_id: pagoId, case_id: recibo.case_id, cliente_id: recibo.cliente_id,
      email_to: null, email_status: 'failed', email_error: 'Cliente sin email registrado',
      delivery_attempt_count: 1, last_delivery_attempt_at: new Date().toISOString(), metadata: recibo,
    })
    if (logError) {
      console.error('Fallo al escribir statement_delivery_logs (cliente sin email):', logError)
      return jsonResponse({
        ok: false,
        error: 'Cliente sin email registrado',
        warning: 'No se pudo escribir el log de idempotencia',
        log_error: logError.message,
      }, 200)
    }
    return jsonResponse({ ok: false, error: 'Cliente sin email registrado' }, 200)
  }

  const nombre = escapeHtml((recibo.cliente_nombre as string) || 'Cliente')
  const monto = formatMoney(recibo.monto as number)
  const fecha = formatDate(recibo.fecha_pago as string)
  const metodo = METODO_LABELS[(recibo.metodo_pago as string) || 'otro'] || 'Otro'
  const referencia = recibo.referencia ? escapeHtml(recibo.referencia as string) : null
  const tieneRevolving = !!recibo.revolving_account_id
  const balanceTotal = tieneRevolving ? formatMoney(recibo.revolving_balance_total as number) : null

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
      <h2 style="color:#111827">Recibo de pago</h2>
      <p>Hola ${nombre},</p>
      <p>Confirmamos la recepcion de tu pago con los siguientes detalles:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#6b7280">Monto recibido</td><td style="padding:6px 0;text-align:right;font-weight:bold">${monto}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Fecha de pago</td><td style="padding:6px 0;text-align:right">${fecha}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Metodo</td><td style="padding:6px 0;text-align:right">${metodo}</td></tr>
        ${referencia ? `<tr><td style="padding:6px 0;color:#6b7280">Referencia</td><td style="padding:6px 0;text-align:right">${referencia}</td></tr>` : ''}
        ${balanceTotal ? `<tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">Balance restante</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #e5e7eb">${balanceTotal}</td></tr>` : ''}
      </table>
      <p style="color:#6b7280;font-size:13px">Gracias por tu pago. Si tienes alguna pregunta sobre tu cuenta, contacta a nuestro equipo de cobranza.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
      <p style="color:#6b7280;font-size:12px;line-height:1.5;text-align:center">
        Connection Worldwide Group<br />
        Distribuidor autorizado de Royal Prestige<br />
        Tel: 786-291-3042
      </p>
    </div>
  `

  const resendPayload = {
    from: resendFrom,
    to: emailTo,
    subject: `Recibo de pago - ${monto}`,
    html,
    text: `Recibo de pago. Monto: ${monto}. Fecha: ${fecha}. Metodo: ${metodo}.\n\nConnection Worldwide Group\nDistribuidor autorizado de Royal Prestige\nTel: 786-291-3042.`,
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify(resendPayload),
  })

  const ok = res.ok
  const responseText = await res.text()

  const { error: logError } = await supabase.from('statement_delivery_logs').insert({
    org_id: recibo.org_id, document_type: 'recibo_pago', document_id: pagoId, case_id: recibo.case_id, cliente_id: recibo.cliente_id,
    email_to: emailTo, email_status: ok ? 'sent' : 'failed', email_sent_at: ok ? new Date().toISOString() : null,
    email_error: ok ? null : responseText, delivery_attempt_count: 1, last_delivery_attempt_at: new Date().toISOString(), metadata: recibo,
  })
  if (logError) {
    console.error('Fallo al escribir statement_delivery_logs:', logError)
    return jsonResponse({
      ok,
      email_to: emailTo,
      warning: 'Email enviado pero el log de idempotencia no se pudo escribir',
      log_error: logError.message,
    }, ok ? 200 : 502)
  }

  if (!ok) return jsonResponse({ ok: false, error: 'Resend API error', details: responseText }, 502)

  return jsonResponse({ ok: true, email_to: emailTo })
})
