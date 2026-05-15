import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type CuotaRow = {
  id: string
  org_id: string
  plan_pago_id: string | null
  cargo_vuelta_case_id: string | null
  cliente_id: string
  numero_cuota: number | null
  fecha_vencimiento: string
  monto: number | string | null
  monto_programado: number | string | null
  saldo_cuota: number | string | null
  estado: string
}

type ClienteRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  telefono_casa: string | null
  email: string | null
}

type PlanRow = {
  id: string
  metodo_pago_id: string | null
  estado: string | null
}

type CaseRow = {
  id: string
  tipo_caso: 'cargo_vuelta' | 'dfp' | null
}

type MetodoPagoRow = {
  id: string
  org_id: string
  cliente_id: string
  cargo_vuelta_case_id: string | null
  display: string | null
  brand: string | null
  last4: string | null
  is_default: boolean | null
  estado: string | null
}

type Reminder = {
  cuota: CuotaRow
  cliente: ClienteRow | null
  metodo: MetodoPagoRow | null
  daysUntilDue: 0 | 1 | 2
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const telegramToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const telegramChatId = Deno.env.get('TELEGRAM_OPERATOR_CHAT_ID') ?? ''
const operatorEmailTo = Deno.env.get('OPERATOR_EMAIL_TO') ?? 'patrospi@hotmail.com'
const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Royal Prestige <cobranza@flowiadigital.com>'
const workerSecret = Deno.env.get('DFP_DAILY_WORKER_SECRET') ?? ''

const supabase = createClient(supabaseUrl, serviceRoleKey)

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function nyDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function money(value: number | string | null) {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

function normalizeName(cliente: ClienteRow | null) {
  const fullName = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ').trim()
  return fullName || 'cliente'
}

function sanitizePhone(raw: string | null) {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length === 10) return `1${digits}`
  if (digits.length >= 11) return digits
  return ''
}

function titleCaseBrand(raw: string | null) {
  const brand = (raw ?? '').trim()
  if (!brand) return ''
  return brand.slice(0, 1).toUpperCase() + brand.slice(1).toLowerCase()
}

function safeCardDisplay(metodo: MetodoPagoRow | null) {
  const display = (metodo?.display ?? '').trim()
  if (display && !/\d{8,}/.test(display)) {
    return display.toLowerCase().startsWith('tu ') ? display : `tu tarjeta ${display}`
  }

  const brand = titleCaseBrand(metodo?.brand)
  const last4 = (metodo?.last4 ?? '').replace(/\D/g, '').slice(-4)
  if (brand && last4) return `tu tarjeta ${brand} terminada en ${last4}`
  if (last4) return `tu tarjeta terminada en ${last4}`
  return 'tu método de pago registrado'
}

function amountForCuota(cuota: CuotaRow) {
  const saldo = Number(cuota.saldo_cuota ?? 0)
  if (Number.isFinite(saldo) && saldo > 0) return saldo
  const programado = Number(cuota.monto_programado ?? 0)
  if (Number.isFinite(programado) && programado > 0) return programado
  const legacy = Number(cuota.monto ?? 0)
  return Number.isFinite(legacy) ? legacy : 0
}

function buildClientMessage(reminder: Reminder) {
  const nombre = normalizeName(reminder.cliente)
  const monto = money(amountForCuota(reminder.cuota))
  const tarjeta = safeCardDisplay(reminder.metodo)
  if (reminder.daysUntilDue === 1) {
    return `Hola ${nombre}, te recordamos que mañana se debitará ${monto} de ${tarjeta}. Gracias.`
  }
  return `Hola ${nombre}, te recordamos que en 2 días se debitará ${monto} de ${tarjeta}. Gracias.`
}

function buildInternalSummary(reminders: Reminder[], today: string) {
  const dueToday = reminders.filter((reminder) => reminder.daysUntilDue === 0)
  const total = dueToday.reduce((sum, reminder) => sum + amountForCuota(reminder.cuota), 0)
  const lines = [
    `Resumen DFP cuotas que vencen hoy (${today})`,
    `Total cuotas: ${dueToday.length}`,
    `Monto programado: ${money(total)}`,
    '',
    ...dueToday.slice(0, 40).map((reminder) => {
      const cuota = reminder.cuota
      const cliente = normalizeName(reminder.cliente)
      return `- ${cliente} | cuota ${cuota.numero_cuota ?? '-'} | ${money(amountForCuota(cuota))} | ${safeCardDisplay(reminder.metodo)} | cuota_id ${cuota.id}`
    }),
  ]
  if (dueToday.length > 40) lines.push(`... ${dueToday.length - 40} cuotas adicionales`)
  return lines.join('\n')
}

async function sendTelegram(text: string) {
  if (!telegramToken || !telegramChatId) return { ok: false, skipped: true, reason: 'missing_telegram_config' }
  const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: telegramChatId, text }),
  })
  if (!res.ok) throw new Error(`Telegram API error ${res.status}: ${await res.text()}`)
  return { ok: true }
}

async function sendEmail(subject: string, text: string) {
  if (!resendKey) return { ok: false, skipped: true, reason: 'missing_resend_config' }
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: resendFrom,
      to: operatorEmailTo,
      subject,
      text,
      html,
    }),
  })
  if (!res.ok) throw new Error(`Resend API error ${res.status}: ${await res.text()}`)
  return { ok: true }
}

async function claimEvent(
  notificationKey: string,
  eventColumns: {
    org_id: string | null
    cuota_id: string | null
    notification_date: string
    target_date: string | null
    channel: 'email' | 'telegram' | 'whatsapp' | 'sms'
    scope: 'internal_summary' | 'client_reminder'
  },
  payload: Record<string, unknown>,
) {
  const { data: existing, error: readError } = await supabase
    .from('dfp_notification_events')
    .select('notification_key,status')
    .eq('notification_key', notificationKey)
    .maybeSingle()

  if (readError) throw readError
  if (existing?.status === 'sent' || existing?.status === 'queued') return false

  const { error } = await supabase
    .from('dfp_notification_events')
    .upsert({
      notification_key: notificationKey,
      ...eventColumns,
      status: 'pending',
      payload,
      error_message: null,
    }, { onConflict: 'notification_key' })

  if (error) throw error
  return true
}

async function markEvent(notificationKey: string, status: 'sent' | 'failed' | 'queued' | 'skipped', errorMessage?: string) {
  const { error } = await supabase
    .from('dfp_notification_events')
    .update({
      status,
      error_message: errorMessage ?? null,
      sent_at: status === 'sent' || status === 'queued' ? new Date().toISOString() : null,
    })
    .eq('notification_key', notificationKey)
  if (error) throw error
}

async function loadReminders(today: string, tomorrow: string, inTwoDays: string) {
  const targetDates = [today, tomorrow, inTwoDays]
  const { data: cuotas, error: cuotasError } = await supabase
    .from('cob_plan_cuotas')
    .select('id,org_id,plan_pago_id,cargo_vuelta_case_id,cliente_id,numero_cuota,fecha_vencimiento,monto,monto_programado,saldo_cuota,estado')
    .in('fecha_vencimiento', targetDates)
    .in('estado', ['pendiente', 'programada', 'parcial'])

  if (cuotasError) throw cuotasError
  const allCuotaRows = (cuotas ?? []) as CuotaRow[]
  const caseIds = [...new Set(allCuotaRows.map((row) => row.cargo_vuelta_case_id).filter(Boolean))] as string[]

  const casesResult = caseIds.length
    ? await supabase.from('cargo_vuelta_cases').select('id,tipo_caso').in('id', caseIds)
    : { data: [], error: null }
  if (casesResult.error) throw casesResult.error

  const dfpCaseIds = new Set(((casesResult.data ?? []) as CaseRow[])
    .filter((row) => row.tipo_caso === 'dfp')
    .map((row) => row.id))
  const cuotaRows = allCuotaRows.filter((row) => row.cargo_vuelta_case_id && dfpCaseIds.has(row.cargo_vuelta_case_id))

  const clienteIds = [...new Set(cuotaRows.map((row) => row.cliente_id).filter(Boolean))]
  const planIds = [...new Set(cuotaRows.map((row) => row.plan_pago_id).filter(Boolean))] as string[]

  const [clientesResult, planesResult] = await Promise.all([
    clienteIds.length
      ? supabase.from('clientes').select('id,nombre,apellido,telefono,telefono_casa,email').in('id', clienteIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? supabase.from('cob_plan_pagos').select('id,metodo_pago_id,estado').in('id', planIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (clientesResult.error) throw clientesResult.error
  if (planesResult.error) throw planesResult.error

  const clientesById = new Map(((clientesResult.data ?? []) as ClienteRow[]).map((row) => [row.id, row]))
  const planesById = new Map(((planesResult.data ?? []) as PlanRow[]).map((row) => [row.id, row]))
  const metodoIdsFromPlans = [...new Set(((planesResult.data ?? []) as PlanRow[]).map((row) => row.metodo_pago_id).filter(Boolean))] as string[]

  const metodosById = new Map<string, MetodoPagoRow>()
  const metodosByCliente = new Map<string, MetodoPagoRow>()

  if (metodoIdsFromPlans.length) {
    const { data, error } = await supabase
      .from('cob_metodos_pago')
      .select('id,org_id,cliente_id,cargo_vuelta_case_id,display,brand,last4,is_default,estado')
      .in('id', metodoIdsFromPlans)
    if (error) throw error
    for (const metodo of (data ?? []) as MetodoPagoRow[]) metodosById.set(metodo.id, metodo)
  }

  if (clienteIds.length) {
    const { data, error } = await supabase
      .from('cob_metodos_pago')
      .select('id,org_id,cliente_id,cargo_vuelta_case_id,display,brand,last4,is_default,estado')
      .in('cliente_id', clienteIds)
      .eq('estado', 'activo')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    for (const metodo of (data ?? []) as MetodoPagoRow[]) {
      if (!metodosByCliente.has(metodo.cliente_id)) metodosByCliente.set(metodo.cliente_id, metodo)
    }
  }

  return cuotaRows.map((cuota): Reminder => {
    const plan = cuota.plan_pago_id ? planesById.get(cuota.plan_pago_id) : null
    const metodo = (plan?.metodo_pago_id ? metodosById.get(plan.metodo_pago_id) : null) ?? metodosByCliente.get(cuota.cliente_id) ?? null
    const daysUntilDue = cuota.fecha_vencimiento === today ? 0 : cuota.fecha_vencimiento === tomorrow ? 1 : 2
    return {
      cuota,
      cliente: clientesById.get(cuota.cliente_id) ?? null,
      metodo,
      daysUntilDue,
    }
  })
}

async function queueClientReminder(reminder: Reminder, notificationDate: string) {
  const canal = 'whatsapp'
  const key = `dfp_cuota_reminder:${reminder.cuota.id}:${notificationDate}:${canal}`
  const destinatario = sanitizePhone(reminder.cliente?.telefono) || sanitizePhone(reminder.cliente?.telefono_casa)
  const mensaje = buildClientMessage(reminder)

  const { data: existing, error: existingError } = await supabase
    .from('outbox_messages')
    .select('id')
    .eq('dfp_notification_key', key)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) return { queued: false, skipped: true, reason: 'duplicate', key }

  const eventPayload = {
    org_id: reminder.cuota.org_id,
    cuota_id: reminder.cuota.id,
    notification_date: notificationDate,
    target_date: reminder.cuota.fecha_vencimiento,
    channel: canal,
    scope: 'client_reminder',
  }

  const { error: eventError } = await supabase
    .from('dfp_notification_events')
    .upsert({ notification_key: key, status: 'queued', ...eventPayload, payload: { destinatario, mensaje } }, { onConflict: 'notification_key' })
  if (eventError) throw eventError

  const { error } = await supabase
    .from('outbox_messages')
    .insert({
      org_id: reminder.cuota.org_id,
      contact_tipo: 'cliente',
      contact_id: reminder.cuota.cliente_id,
      contexto_tipo: 'cobranza',
      canal,
      destinatario,
      mensaje,
      mensaje_resuelto: mensaje,
      status: 'programado',
      scheduled_for: new Date().toISOString(),
      dispatch_provider: 'n8n',
      tipo_envio: 'text',
      dfp_notification_key: key,
      dfp_notification_date: notificationDate,
    })

  if (error) {
    if (error.code === '23505') return { queued: false, skipped: true, reason: 'duplicate', key }
    throw error
  }

  return { queued: true, skipped: false, key }
}

serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing Supabase service role configuration' }, 500)
  }

  if (workerSecret) {
    const provided = req.headers.get('X-FlowSuite-Worker-Secret') ?? ''
    if (provided !== workerSecret) return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const today = nyDate(0)
  const tomorrow = nyDate(1)
  const inTwoDays = nyDate(2)

  try {
    const reminders = await loadReminders(today, tomorrow, inTwoDays)
    const dueToday = reminders.filter((reminder) => reminder.daysUntilDue === 0)
    const clientReminders = reminders.filter((reminder) => reminder.daysUntilDue === 1 || reminder.daysUntilDue === 2)

    const summary = buildInternalSummary(reminders, today)
    const internalResults: Record<string, unknown> = {}

    for (const channel of ['telegram', 'email'] as const) {
      const key = `dfp_cuota_summary:${today}:${channel}`
      const baseEvent = {
        org_id: null,
        cuota_id: null,
        notification_date: today,
        target_date: today,
        channel,
        scope: 'internal_summary',
      } as const
      const claimed = await claimEvent(key, baseEvent, { total_cuotas: dueToday.length })
      if (!claimed) {
        internalResults[channel] = { skipped: true, reason: 'already_processed' }
        continue
      }

      try {
        const result = channel === 'telegram'
          ? await sendTelegram(summary)
          : await sendEmail(`DFP cuotas que vencen hoy - ${today}`, summary)
        await markEvent(key, 'skipped' in result && result.skipped ? 'skipped' : 'sent')
        internalResults[channel] = result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await markEvent(key, 'failed', message)
        internalResults[channel] = { ok: false, error: message }
      }
    }

    const queuedResults = []
    for (const reminder of clientReminders) {
      queuedResults.push(await queueClientReminder(reminder, today))
    }

    return jsonResponse({
      ok: true,
      today,
      counts: {
        due_today: dueToday.length,
        due_tomorrow: reminders.filter((reminder) => reminder.daysUntilDue === 1).length,
        due_in_two_days: reminders.filter((reminder) => reminder.daysUntilDue === 2).length,
        queued_client_messages: queuedResults.filter((result) => result.queued).length,
        skipped_client_messages: queuedResults.filter((result) => result.skipped).length,
      },
      internal: internalResults,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dfp-daily-cuota-notifications failed', message)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
