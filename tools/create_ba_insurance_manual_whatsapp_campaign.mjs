import { createClient } from '@supabase/supabase-js'
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const LOG_DIR = path.join(ROOT, 'outputs')
const LOG_FILE = path.join(LOG_DIR, 'ba_insurance_manual_whatsapp_campaign.log')

const SUPABASE_URL = 'https://rxiarmbosgivaplygqug.supabase.co'
const SERVICE_KEY = readFileSync(path.join(ROOT, '.supabase-service-key'), 'utf8').trim()
const OWNER_ID = 'df37164a-0306-4183-85cf-38074059afec'
const ORG_ID = 'Connection Worldwide Group'
const CAMPAIGN_NAME = 'BA Insurance - Invitacion evento finanzas miercoles (manual WhatsApp)'
const TEMPLATE_NAME = 'BA Insurance - Invitacion evento finanzas'
const SEGMENTO_KEY = 'ba_insurance_manual'
const EXECUTE = process.argv.includes('--execute')
const DRY_RUN = !EXECUTE

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function log(message, data = undefined) {
  mkdirSync(LOG_DIR, { recursive: true })
  const line = `${new Date().toISOString()} ${message}${data === undefined ? '' : ` ${JSON.stringify(data)} `}\n`
  appendFileSync(LOG_FILE, line)
  console.log(line.trim())
}

function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits.length >= 10 ? digits : null
}

function firstName(row) {
  return String(row.nombre ?? '').trim().split(/\s+/)[0] || 'amigo/a'
}

function messageFor(row) {
  return `Hola ${firstName(row)}, BA Insurance, tu oficina de seguros, te invita a nuestro proximo evento:

Aprende a hacer crecer tu dinero

Será este miércoles a las 7:00 p. m. en:
20832 Roscoe Boulevard, Suite 103
Winnetka, CA 91306

Trae tu invitación. Cupos limitados.

Separa tu cupo: 786-614-6546
Responde STOP si no deseas recibir más mensajes.`
}

const templateBody = `Hola {nombre}, BA Insurance, tu oficina de seguros, te invita a nuestro proximo evento:

Aprende a hacer crecer tu dinero

Será este miércoles a las 7:00 p. m. en:
20832 Roscoe Boulevard, Suite 103
Winnetka, CA 91306

Trae tu invitación. Cupos limitados.

Separa tu cupo: 786-614-6546
Responde STOP si no deseas recibir más mensajes.`

async function ensureTemplate() {
  if (DRY_RUN) {
    return 'dry-run-template-id'
  }

  const { data: existing, error: findError } = await supabase
    .from('message_templates')
    .select('id')
    .eq('owner_id', OWNER_ID)
    .eq('canal', 'whatsapp')
    .eq('nombre', TEMPLATE_NAME)
    .maybeSingle()

  if (findError) throw findError
  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('message_templates')
    .insert({
      owner_id: OWNER_ID,
      org_id: ORG_ID,
      canal: 'whatsapp',
      nombre: TEMPLATE_NAME,
      cuerpo: templateBody,
      category: 'evento',
      scope: 'shared',
      is_system: false,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

async function ensureCampaign() {
  if (DRY_RUN) {
    return { id: 'dry-run-campaign-id', total_contactos: 0, estado: 'pausada' }
  }

  const { data: existing, error: findError } = await supabase
    .from('mk_campaigns')
    .select('id,total_contactos,estado')
    .eq('nombre', CAMPAIGN_NAME)
    .maybeSingle()

  if (findError) throw findError
  if (existing?.id) {
    if (existing.estado !== 'pausada') {
      const { error: pauseError } = await supabase
        .from('mk_campaigns')
        .update({ estado: 'pausada', dispatched_at: null })
        .eq('id', existing.id)
      if (pauseError) throw pauseError
    }
    return { ...existing, estado: 'pausada' }
  }

  const { data, error } = await supabase
    .from('mk_campaigns')
    .insert({
      nombre: CAMPAIGN_NAME,
      descripcion: 'Campaña preparada para enviar WhatsApp manualmente uno a uno a leads de BA Insurance. No despachar masivamente.',
      segmento_key: SEGMENTO_KEY,
      canal: 'whatsapp',
      template_key: TEMPLATE_NAME,
      owner_id: OWNER_ID,
      // 'pausada' — this campaign is prepared for manual one-by-one WhatsApp
      // sends, not for the bulk "Dispatch" button in EnviosPage.
      estado: 'pausada',
      total_contactos: 0,
      mensaje_base: templateBody,
      segment_params: {
        audiencia: 'leads',
        fuente: 'BA Insurance',
        mode: 'manual_one_by_one',
        whatsapp_opt_in_at_creation: false,
      },
    })
    .select('id,total_contactos,estado')
    .single()

  if (error) throw error
  return data
}

async function loadTargets() {
  const { data, error } = await supabase
    .from('leads')
    .select('id,nombre,apellido,telefono,fuente,owner_id,vendedor_id')
    .ilike('fuente', '%BA%')
    .not('telefono', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) throw error

  const byPhone = new Map()
  for (const row of data ?? []) {
    const phone = normalizePhone(row.telefono)
    if (!phone || byPhone.has(phone)) continue
    byPhone.set(phone, { ...row, telefono: phone })
  }

  return Array.from(byPhone.values())
}

async function existingPhones(campaignId) {
  const { data, error } = await supabase
    .from('mk_messages')
    .select('telefono')
    .eq('campaign_id', campaignId)

  if (error) throw error
  return new Set((data ?? []).map((row) => normalizePhone(row.telefono)).filter(Boolean))
}

async function main() {
  log('mode', {
    dryRun: DRY_RUN,
    note: DRY_RUN
      ? 'Dry run only. No crea plantilla/campaña/mensajes. Usa --execute para preparar la campaña manual.'
      : 'Preparación manual: crea plantilla/campaña/mensajes en estado pendiente. No despacha WhatsApp ni invoca dispatch-campaign/process-outbox.',
  })

  const templateId = await ensureTemplate()
  log('template_ready', { templateId })

  const campaign = await ensureCampaign()
  log('campaign_ready', campaign)

  const targets = await loadTargets()
  const existing = await existingPhones(campaign.id)
  const messages = targets
    .filter((target) => !existing.has(target.telefono))
    .map((target, index) => ({
      campaign_id: campaign.id,
      owner_id: target.owner_id ?? target.vendedor_id ?? OWNER_ID,
      contacto_tipo: 'lead',
      contacto_id: target.id,
      telefono: target.telefono,
      nombre: [target.nombre, target.apellido].filter(Boolean).join(' ').trim() || target.nombre || 'Contacto',
      mensaje_texto: messageFor(target),
      canal: 'whatsapp',
      orden: existing.size + index + 1,
      status: 'pendiente',
    }))

  let inserted = []
  if (DRY_RUN) {
    log('dry_run_summary', {
      campaignId: campaign.id,
      templateId,
      targets: targets.length,
      wouldInsert: messages.length,
      alreadyPresent: existing.size,
    })
    return
  }

  if (messages.length > 0) {
    const { data, error } = await supabase
      .from('mk_messages')
      .insert(messages)
      .select('id')

    if (error) throw error
    inserted = data ?? []
  }

  const totalContactos = existing.size + inserted.length
  const { error: updateError } = await supabase
    .from('mk_campaigns')
    .update({
      estado: 'pausada',
      dispatched_at: null,
      total_contactos: totalContactos,
    })
    .eq('id', campaign.id)

  if (updateError) throw updateError

  log('manual_campaign_summary', {
    campaignId: campaign.id,
    templateId,
    targets: targets.length,
    inserted: inserted.length,
    alreadyPresent: existing.size,
    totalContactos,
  })
}

main().catch((error) => {
  log('runner_error', {
    message: error instanceof Error ? error.message : String(error),
    details: error,
  })
  process.exit(1)
})
