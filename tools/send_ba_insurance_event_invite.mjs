import { createClient } from '@supabase/supabase-js'
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const LOG_DIR = path.join(ROOT, 'outputs')
const LOG_FILE = path.join(LOG_DIR, 'ba_insurance_event_invite_dispatch.log')

const SUPABASE_URL = 'https://rxiarmbosgivaplygqug.supabase.co'
const SERVICE_KEY = readFileSync(path.join(ROOT, '.supabase-service-key'), 'utf8').trim()
const OUTBOX_WORKER_SECRET = process.env.OUTBOX_WORKER_SECRET ?? ''
const FLYER_PATH = '/Users/moisescaicedo/Downloads/Invitacion a Evento Miercoles Ffinazas ahorros.PNG'
const FLYER_STORAGE_PATH = 'ba-insurance-evento-miercoles-finanzas-ahorros.png'
const SUBJECT = 'Invitacion especial de BA Insurance: cupos limitados'
const FROM_NAME = 'BA Insurance'
const REPLY_TO = 'connectionterritory@gmail.com'
const SEND_DELAY_MS = 1400

// Real sends require the explicit --execute flag. Without it, the script only
// reports what it would do — no storage upload, no outbox rows, no dispatch.
const EXECUTE = process.argv.includes('--execute')
const DRY_RUN = !EXECUTE

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function redact(text) {
  return SERVICE_KEY ? text.split(SERVICE_KEY).join('[REDACTED]') : text
}

function log(message, data = undefined) {
  mkdirSync(LOG_DIR, { recursive: true })
  const serialized = data === undefined ? '' : ` ${redact(JSON.stringify(data))}`
  const line = `${new Date().toISOString()} ${message}${serialized}\n`
  appendFileSync(LOG_FILE, line)
  console.log(line.trim())
}

function errorDetails(error) {
  if (!error) return null
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return error
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function firstName(row) {
  return String(row.nombre ?? '').trim().split(/\s+/)[0] || 'amigo/a'
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

function emailBody(row) {
  const nombre = firstName(row)
  return `Hola ${nombre},

BA Insurance, tu oficina de seguros, te invita a nuestro proximo evento:

Aprende a hacer crecer tu dinero

Descubre estrategias financieras que pueden cambiar tu futuro y el de tu familia.

En este taller aprenderas:
- Como hacer crecer tu dinero
- Estrategias para proteger tu patrimonio
- Como emprender y construir un negocio
- Como prepararte para el retiro y asegurar tu futuro
- Estrategias financieras con ventajas fiscales

Fecha: miercoles
Hora: 7:00 p. m.
Lugar: 20832 Roscoe Boulevard, Suite 103, Winnetka, CA 91306

Trae tu invitacion. Cupos limitados.

Separa tu cupo: 786-614-6546`
}

async function uploadFlyer() {
  const file = readFileSync(FLYER_PATH)
  const { error } = await supabase.storage
    .from('messaging_attachments')
    .upload(FLYER_STORAGE_PATH, file, {
      contentType: 'image/png',
      upsert: true,
    })

  if (error) throw error

  const { data } = supabase.storage
    .from('messaging_attachments')
    .getPublicUrl(FLYER_STORAGE_PATH)

  return data.publicUrl
}

async function loadEmailTargets() {
  const { data, error } = await supabase
    .from('leads')
    .select('id,nombre,apellido,email,telefono,fuente,owner_id,vendedor_id')
    .ilike('fuente', '%BA%')
    .not('email', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) throw error

  return (data ?? []).filter((row) => String(row.email ?? '').includes('@'))
}

async function existingOutboxTargets() {
  const { data, error } = await supabase
    .from('outbox_messages')
    .select('contact_id, destinatario')
    .eq('contact_tipo', 'lead')
    .eq('canal', 'email')
    .eq('asunto', SUBJECT)
    .in('status', ['programado', 'en_proceso', 'enviado', 'retry_pending'])

  if (error) throw error
  const rows = data ?? []
  return {
    leadIds: new Set(rows.map((row) => row.contact_id)),
    emails: new Set(rows.map((row) => normalizeEmail(row.destinatario))),
  }
}

async function enqueueEmails(targets, flyerUrl, existing) {
  const inserted = []
  const skipped = []
  const seenEmails = new Set()
  const now = new Date()

  for (const [index, lead] of targets.entries()) {
    const normalizedEmail = normalizeEmail(lead.email)
    if (
      existing.leadIds.has(lead.id)
      || existing.emails.has(normalizedEmail)
      || seenEmails.has(normalizedEmail)
    ) {
      skipped.push(lead.id)
      continue
    }
    seenEmails.add(normalizedEmail)

    const scheduledFor = new Date(now.getTime() + index * SEND_DELAY_MS).toISOString()
    const payload = {
      owner_id: lead.owner_id ?? lead.vendedor_id,
      org_id: 'Connection Worldwide Group',
      contact_tipo: 'lead',
      contact_id: lead.id,
      contexto_tipo: 'ad_hoc',
      canal: 'email',
      destinatario: normalizedEmail,
      asunto: SUBJECT,
      mensaje: emailBody(lead),
      mensaje_resuelto: emailBody(lead),
      attachment_urls: [flyerUrl],
      from_name: FROM_NAME,
      reply_to: REPLY_TO,
      sender_name: FROM_NAME,
      status: 'programado',
      scheduled_for: scheduledFor,
      sent_at: null,
    }

    const { data, error } = await supabase
      .from('outbox_messages')
      .insert(payload)
      .select('id,destinatario,scheduled_for')
      .single()

    if (error) {
      log('enqueue_error', { lead_id: lead.id, email: lead.email, error })
      throw new Error(JSON.stringify(error))
    }
    inserted.push(data)
  }

  return { inserted, skipped }
}

async function processEmails(rows) {
  const results = []

  for (const row of rows) {
    const scheduledAt = new Date(row.scheduled_for).getTime()
    const delay = scheduledAt - Date.now()
    if (delay > 0) await wait(delay)

    const { data, error } = await supabase.functions.invoke('process-outbox', {
      body: { outbox_id: row.id },
      headers: OUTBOX_WORKER_SECRET ? { 'X-FlowSuite-Worker-Secret': OUTBOX_WORKER_SECRET } : undefined,
    })

    const result = {
      id: row.id,
      to: row.destinatario,
      ok: Boolean(data?.ok),
      status: data?.status ?? null,
      provider: data?.provider ?? null,
      error: error?.message ?? data?.error_message ?? null,
    }
    results.push(result)
    log('processed_email', result)
  }

  return results
}

async function main() {
  log('mode', { dryRun: DRY_RUN, note: DRY_RUN ? 'No se sube flyer, no se encola ni despacha nada. Usa --execute para el envío real.' : 'EJECUCIÓN REAL' })

  if (!DRY_RUN && !OUTBOX_WORKER_SECRET) {
    throw new Error('OUTBOX_WORKER_SECRET is required for --execute; refusing to enqueue/process emails that cannot dispatch.')
  }

  const targets = await loadEmailTargets()
  const existing = await existingOutboxTargets()
  log('targets_loaded', { totalEmailTargets: targets.length, existingLeads: existing.leadIds.size, existingEmails: existing.emails.size })

  if (DRY_RUN) {
    const seenEmails = new Set()
    const wouldSend = targets.filter((lead) => {
      const email = normalizeEmail(lead.email)
      if (existing.leadIds.has(lead.id) || existing.emails.has(email) || seenEmails.has(email)) return false
      seenEmails.add(email)
      return true
    })
    log('dry_run_summary', { wouldEnqueue: wouldSend.length, wouldSkip: targets.length - wouldSend.length })
    return
  }

  const flyerUrl = await uploadFlyer()
  log('flyer_uploaded', { flyerUrl })

  const { inserted, skipped } = await enqueueEmails(targets, flyerUrl, existing)
  log('emails_enqueued', { inserted: inserted.length, skipped: skipped.length })

  const results = await processEmails(inserted)
  const summary = results.reduce((acc, row) => {
    const key = row.status ?? 'unknown'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  log('email_dispatch_summary', summary)
  log('whatsapp_not_sent_no_opt_in', {
    reason: 'BA Insurance leads currently have whatsapp_opt_in=false',
  })
}

main().catch((error) => {
  log('runner_error', errorDetails(error))
  process.exit(1)
})
