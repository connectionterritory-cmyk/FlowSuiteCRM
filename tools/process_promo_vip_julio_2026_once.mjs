import { createClient } from '@supabase/supabase-js'
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const LOG_DIR = path.join(ROOT, 'outputs')
const LOG_FILE = path.join(LOG_DIR, 'promo_vip_julio_2026_dispatch.log')

const SUPABASE_URL = 'https://rxiarmbosgivaplygqug.supabase.co'
const SERVICE_KEY = readFileSync(path.join(ROOT, '.supabase-service-key'), 'utf8').trim()
const OUTBOX_WORKER_SECRET = process.env.OUTBOX_WORKER_SECRET ?? ''
const SUBJECT = 'Promoción VIP de Julio: regalo valorado en $500'
const DAILY_SAFE_LIMIT = 95
const BATCH_LIMIT = 2
const EXECUTE = process.argv.includes('--execute')
const DRY_RUN = !EXECUTE

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function log(message, data = undefined) {
  mkdirSync(LOG_DIR, { recursive: true })
  const line = `${new Date().toISOString()} ${message}${data === undefined ? '' : ` ${JSON.stringify(data)}`}\n`
  appendFileSync(LOG_FILE, line)
  console.log(line.trim())
}

async function main() {
  log('mode', {
    dryRun: DRY_RUN,
    note: DRY_RUN ? 'No procesa mensajes. Usa --execute para invocar process-outbox.' : 'EJECUCIÓN REAL',
  })

  if (!DRY_RUN && !OUTBOX_WORKER_SECRET) {
    throw new Error('OUTBOX_WORKER_SECRET is required for --execute; refusing to process outbox messages.')
  }

  const now = new Date().toISOString()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: sentLast24h, error: sentCountError } = await supabase
    .from('outbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('asunto', SUBJECT)
    .eq('status', 'enviado')
    .gte('sent_at', since24h)

  if (sentCountError) throw sentCountError

  const remainingQuota = DAILY_SAFE_LIMIT - (sentLast24h ?? 0)
  if (remainingQuota <= 0) {
    log('daily_quota_guard', { sentLast24h, limit: DAILY_SAFE_LIMIT })
    return
  }

  const batchLimit = Math.min(BATCH_LIMIT, remainingQuota)
  const { data: rows, error } = await supabase
    .from('outbox_messages')
    .select('id,destinatario,scheduled_for')
    .eq('asunto', SUBJECT)
    .eq('status', 'programado')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(batchLimit)

  if (error) throw error

  if (!rows || rows.length === 0) {
    log('no_due_messages')
    return
  }

  if (DRY_RUN) {
    log('dry_run_due_messages', rows.map((row) => ({
      id: row.id,
      to: row.destinatario,
      scheduled_for: row.scheduled_for,
    })))
    return
  }

  const results = []
  for (const row of rows) {
    const { data, error: invokeError } = await supabase.functions.invoke('process-outbox', {
      body: { outbox_id: row.id },
      headers: { 'X-FlowSuite-Worker-Secret': OUTBOX_WORKER_SECRET },
    })
    results.push({
      id: row.id,
      to: row.destinatario,
      ok: Boolean(data?.ok),
      status: data?.status ?? null,
      provider: data?.provider ?? null,
      error: invokeError?.message ?? data?.error_message ?? null,
    })
  }

  log('processed_due_messages', results)
}

main().catch((error) => {
  log('runner_error', { message: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
