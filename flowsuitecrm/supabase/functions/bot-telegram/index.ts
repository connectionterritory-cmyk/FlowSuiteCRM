import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type TelegramUpdate = {
  message?: {
    message_id: number
    text?: string
    chat: { id: number }
    from?: { first_name?: string; last_name?: string }
  }
}

type BotSession = {
  id: string
  chat_id: string
  canal: string
  intent: string | null
  step: string
  slots: Record<string, unknown>
  intentos: number
  activa: boolean
  expires_at: string
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const telegramToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const telegramSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''

const defaultOwnerId = Deno.env.get('BOT_DEFAULT_OWNER_ID') ?? ''
const defaultAssignedTo = Deno.env.get('BOT_DEFAULT_ASSIGNED_TO') ?? ''
const defaultOrgId = Deno.env.get('BOT_DEFAULT_ORG_ID') ?? ''
const defaultIntent = Deno.env.get('BOT_DEFAULT_INTENT') ?? 'citas'
const tz = Deno.env.get('BOT_TIMEZONE') ?? 'America/New_York'
const tzOffset = Deno.env.get('BOT_TZ_OFFSET') ?? '-04:00'
const defaultDurationMinutes = Number.parseInt(
  Deno.env.get('BOT_DEFAULT_DURATION_MINUTES') ?? '60',
  10
)

const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

const YES_WORDS = new Set(['si', 'sí', 's', 'confirmo', 'confirmar', 'ok', 'vale'])
const NO_WORDS = new Set(['no', 'nel', 'nope', 'cancelar'])

const START_TEXT = [
  'Hola, soy el bot de citas de FlowSuite.',
  'Voy a ayudarte a agendar una cita.',
  'Para empezar, ¿cómo te llamas? (nombre y apellido)',
].join('\n')

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getTodayString(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}

function addDays(dateStr: string, days: number) {
  const [year, month, day] = dateStr.split('-').map((value) => Number(value))
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  const iso = date.toISOString().slice(0, 10)
  return iso
}

function parseDateInput(raw: string, timeZone: string) {
  const text = raw.trim().toLowerCase()
  if (text === 'hoy') return getTodayString(timeZone)
  if (text === 'manana' || text === 'mañana') return addDays(getTodayString(timeZone), 1)

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }

  const latMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (latMatch) {
    return `${latMatch[3]}-${latMatch[2]}-${latMatch[1]}`
  }

  return null
}

function parseTimeInput(raw: string) {
  const text = raw.trim().toLowerCase()
  const ampmMatch = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (ampmMatch) {
    let hour = Number(ampmMatch[1])
    const minute = Number(ampmMatch[2] ?? '00')
    if (hour < 1 || hour > 12 || minute > 59) return null
    if (ampmMatch[3] === 'pm' && hour !== 12) hour += 12
    if (ampmMatch[3] === 'am' && hour === 12) hour = 0
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
  }

  const twentyFour = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!twentyFour) return null
  const hour = Number(twentyFour[1])
  const minute = Number(twentyFour[2])
  if (hour > 23 || minute > 59) return null
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

function buildDateTimeIso(dateStr: string, timeStr: string, offset: string) {
  const iso = `${dateStr}T${timeStr}:00${offset}`
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  const nombre = parts.shift() ?? null
  const apellido = parts.length > 0 ? parts.join(' ') : null
  return { nombre, apellido }
}

function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits
}

async function sendTelegramMessage(chatId: number | string, text: string) {
  if (!telegramToken) return
  await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

async function getActiveSession(chatId: string, canal: string) {
  const { data, error } = await supabaseClient
    .from('bot_sessions')
    .select('*')
    .eq('chat_id', chatId)
    .eq('canal', canal)
    .eq('activa', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as BotSession | null
}

async function deactivateSessions(chatId: string, canal: string) {
  await supabaseClient
    .from('bot_sessions')
    .update({ activa: false })
    .eq('chat_id', chatId)
    .eq('canal', canal)
    .eq('activa', true)
}

async function createSession(chatId: string, canal: string, step: string) {
  const slots: Record<string, unknown> = {}
  if (defaultOrgId) slots.org_id = defaultOrgId
  const { data, error } = await supabaseClient
    .from('bot_sessions')
    .insert({
      chat_id: chatId,
      canal,
      intent: defaultIntent,
      step,
      slots,
      activa: true,
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    })
    .select('*')
    .single()

  if (error) throw error
  return data as BotSession
}

async function updateSession(id: string, patch: Partial<BotSession>) {
  const { error } = await supabaseClient.from('bot_sessions').update(patch).eq('id', id)
  if (error) throw error
}

async function ensureSession(chatId: string, canal: string) {
  let session = await getActiveSession(chatId, canal)
  if (!session) {
    session = await createSession(chatId, canal, 'ask_nombre')
  }
  return session
}

async function createLeadAndCita(slots: Record<string, unknown>) {
  if (!defaultOwnerId) {
    throw new Error('BOT_DEFAULT_OWNER_ID no configurado')
  }

  const nombreCompleto = (slots.nombre as string | undefined) ?? ''
  const telefono = (slots.telefono as string | undefined) ?? ''
  const motivo = (slots.motivo as string | undefined) ?? ''
  const fecha = (slots.fecha as string | undefined) ?? ''
  const hora = (slots.hora as string | undefined) ?? ''

  const { nombre, apellido } = splitName(nombreCompleto)

  const { data: existingLead } = await supabaseClient
    .from('leads')
    .select('id')
    .eq('telefono', telefono)
    .limit(1)
    .maybeSingle()

  let leadId = existingLead?.id as string | undefined
  if (!leadId) {
    const { data: newLead, error: leadError } = await supabaseClient
      .from('leads')
      .insert({
        nombre,
        apellido,
        telefono,
        fuente: 'telegram',
        owner_id: defaultOwnerId,
      })
      .select('id')
      .single()

    if (leadError) throw leadError
    leadId = newLead.id as string
  }

  const startAtIso = buildDateTimeIso(fecha, hora, tzOffset)
  if (!startAtIso) {
    throw new Error('Fecha u hora inválida')
  }
  const endAt = new Date(startAtIso)
  endAt.setUTCMinutes(endAt.getUTCMinutes() + defaultDurationMinutes)

  const { data: cita, error: citaError } = await supabaseClient
    .from('citas')
    .insert({
      owner_id: defaultOwnerId,
      assigned_to: defaultAssignedTo || null,
      contacto_tipo: 'lead',
      contacto_id: leadId,
      telefono,
      nombre: nombreCompleto || null,
      start_at: startAtIso,
      end_at: endAt.toISOString(),
      tipo: 'servicio',
      notas: motivo || null,
    })
    .select('id')
    .single()

  if (citaError) throw citaError
  return { leadId, citaId: cita.id as string }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: true })
  }

  if (!supabaseUrl || !serviceRoleKey || !telegramToken) {
    return jsonResponse({ error: 'Missing configuration' }, 500)
  }

  if (telegramSecret) {
    const secretHeader = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
    if (secretHeader !== telegramSecret) {
      return jsonResponse({ error: 'Forbidden' }, 403)
    }
  }

  const update = (await req.json()) as TelegramUpdate
  const message = update.message
  if (!message?.text) return jsonResponse({ ok: true })

  const chatId = String(message.chat.id)
  const canal = 'telegram'
  const text = message.text.trim()
  const lower = text.toLowerCase()

  if (lower.startsWith('/start') || lower.startsWith('/cancelar') || lower.startsWith('/cancel')) {
    await deactivateSessions(chatId, canal)
    await createSession(chatId, canal, 'ask_nombre')
    await sendTelegramMessage(message.chat.id, START_TEXT)
    return jsonResponse({ ok: true })
  }

  if (lower.startsWith('/help')) {
    await sendTelegramMessage(
      message.chat.id,
      'Puedes escribir /start para iniciar una cita o /cancel para reiniciar.'
    )
    return jsonResponse({ ok: true })
  }

  const session = await ensureSession(chatId, canal)
  const slots = { ...(session.slots ?? {}) } as Record<string, unknown>

  const refreshPayload = {
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  }

  switch (session.step) {
    case 'ask_nombre': {
      if (text.length < 2) {
        await sendTelegramMessage(message.chat.id, 'Por favor dime tu nombre y apellido.')
        return jsonResponse({ ok: true })
      }
      slots.nombre = text
      await updateSession(session.id, { step: 'ask_telefono', slots, ...refreshPayload })
      await sendTelegramMessage(message.chat.id, 'Gracias. ¿Cuál es tu teléfono de contacto?')
      return jsonResponse({ ok: true })
    }
    case 'ask_telefono': {
      const phone = normalizePhone(text)
      if (!phone) {
        await sendTelegramMessage(message.chat.id, 'Ese teléfono no parece válido. Intenta otra vez.')
        return jsonResponse({ ok: true })
      }
      slots.telefono = phone
      await updateSession(session.id, { step: 'ask_motivo', slots, ...refreshPayload })
      await sendTelegramMessage(message.chat.id, '¿Cuál es el motivo de la cita?')
      return jsonResponse({ ok: true })
    }
    case 'ask_motivo': {
      slots.motivo = text
      await updateSession(session.id, { step: 'ask_fecha', slots, ...refreshPayload })
      await sendTelegramMessage(
        message.chat.id,
        '¿Qué fecha prefieres? (YYYY-MM-DD, o escribe hoy / mañana)'
      )
      return jsonResponse({ ok: true })
    }
    case 'ask_fecha': {
      const dateStr = parseDateInput(text, tz)
      if (!dateStr) {
        await sendTelegramMessage(message.chat.id, 'No entendí la fecha. Usa YYYY-MM-DD.')
        return jsonResponse({ ok: true })
      }
      const today = getTodayString(tz)
      if (dateStr < today) {
        await sendTelegramMessage(message.chat.id, 'La fecha no puede estar en el pasado.')
        return jsonResponse({ ok: true })
      }
      slots.fecha = dateStr
      await updateSession(session.id, { step: 'ask_hora', slots, ...refreshPayload })
      await sendTelegramMessage(message.chat.id, '¿A qué hora? (HH:MM en formato 24h)')
      return jsonResponse({ ok: true })
    }
    case 'ask_hora': {
      const timeStr = parseTimeInput(text)
      if (!timeStr) {
        await sendTelegramMessage(message.chat.id, 'No entendí la hora. Usa HH:MM.')
        return jsonResponse({ ok: true })
      }
      slots.hora = timeStr
      await updateSession(session.id, { step: 'confirmar', slots, ...refreshPayload })
      const summary = [
        'Perfecto, confirma tu cita:',
        `Nombre: ${slots.nombre}`,
        `Teléfono: ${slots.telefono}`,
        `Motivo: ${slots.motivo}`,
        `Fecha: ${slots.fecha}`,
        `Hora: ${slots.hora}`,
        'Responde "si" para confirmar o "no" para cambiar la fecha.',
      ].join('\n')
      await sendTelegramMessage(message.chat.id, summary)
      return jsonResponse({ ok: true })
    }
    case 'confirmar': {
      if (YES_WORDS.has(lower)) {
        try {
          const { leadId, citaId } = await createLeadAndCita(slots)
          await updateSession(session.id, {
            step: 'done',
            activa: false,
            lead_id: leadId,
            cita_id: citaId,
            slots,
            ...refreshPayload,
          })
          await sendTelegramMessage(
            message.chat.id,
            `¡Listo! Tu cita quedó agendada para ${slots.fecha} a las ${slots.hora}.`
          )
        } catch (error) {
          await sendTelegramMessage(
            message.chat.id,
            'No pude registrar la cita en este momento. Intenta más tarde o escribe /start.'
          )
        }
        return jsonResponse({ ok: true })
      }
      if (NO_WORDS.has(lower)) {
        await updateSession(session.id, { step: 'ask_fecha', slots, ...refreshPayload })
        await sendTelegramMessage(message.chat.id, 'Claro. ¿Qué fecha prefieres? (YYYY-MM-DD)')
        return jsonResponse({ ok: true })
      }
      await sendTelegramMessage(message.chat.id, 'Responde "si" para confirmar o "no" para cambiar la fecha.')
      return jsonResponse({ ok: true })
    }
    default: {
      await updateSession(session.id, { step: 'ask_nombre', slots, ...refreshPayload })
      await sendTelegramMessage(message.chat.id, START_TEXT)
      return jsonResponse({ ok: true })
    }
  }
})
