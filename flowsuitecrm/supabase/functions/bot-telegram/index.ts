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
const evolutionUrl = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/+$/, '')
const evolutionKey = Deno.env.get('EVOLUTION_API_KEY') ?? ''
const evolutionInstance = Deno.env.get('EVOLUTION_INSTANCE') ?? ''
const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''

const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function sendTelegram(chatId: number | string, text: string) {
  if (!telegramToken) return
  await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '****'
  return '***-***-' + digits.slice(-4)
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '****'
  return local.slice(0, 2) + '****@' + domain
}

function sanitizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 11) return digits
  if (digits.length === 10) return '1' + digits
  return digits
}

async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  if (!evolutionUrl || !evolutionKey || !evolutionInstance) return false
  const clean = sanitizePhone(phone)
  if (!clean || clean.length < 10) return false
  try {
    const res = await fetch(`${evolutionUrl}/message/sendText/${encodeURIComponent(evolutionInstance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': evolutionKey },
      body: JSON.stringify({ number: clean, text: message }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function sendEmail(to: string, code: string): Promise<boolean> {
  if (!resendKey) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Royal Prestige <cobranza@flowiadigital.com>',
        to,
        subject: 'Código de verificación — Royal Prestige',
        html: `<p>Tu código de verificación para vincular tu cuenta en Telegram es:</p><h2>${code}</h2><p>Válido por 10 minutos. Si no solicitaste esto, ignora este mensaje.</p>`,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function getActiveSession(chatId: string) {
  const { data } = await supabaseClient
    .from('bot_sessions')
    .select('*')
    .eq('chat_id', chatId)
    .eq('canal', 'telegram')
    .eq('activa', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as BotSession | null
}

async function deactivateSessions(chatId: string) {
  await supabaseClient
    .from('bot_sessions')
    .update({ activa: false })
    .eq('chat_id', chatId)
    .eq('canal', 'telegram')
    .eq('activa', true)
}

async function createSession(chatId: string, intent: string, step: string) {
  const { data } = await supabaseClient
    .from('bot_sessions')
    .insert({
      chat_id: chatId,
      canal: 'telegram',
      intent,
      step,
      slots: {},
      activa: true,
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    })
    .select('*')
    .single()
  return data as BotSession
}

async function updateSession(id: string, patch: Partial<BotSession>) {
  await supabaseClient.from('bot_sessions').update(patch).eq('id', id)
}

async function findCliente(query: string) {
  const digits = query.replace(/\D/g, '')
  if (/^\d{6,10}$/.test(digits)) {
    const { data } = await supabaseClient
      .from('clientes')
      .select('id, nombre, apellido, telefono, telefono_casa, email, hycite_id, monto_moroso, dias_atraso, saldo_actual, telegram_chat_id')
      .eq('hycite_id', digits)
      .maybeSingle()
    if (data) return data
  }
  if (digits.length >= 10) {
    const phone10 = digits.slice(-10)
    const { data } = await supabaseClient
      .from('clientes')
      .select('id, nombre, apellido, telefono, telefono_casa, email, hycite_id, monto_moroso, dias_atraso, saldo_actual, telegram_chat_id')
      .or(`telefono.ilike.%${phone10},telefono_casa.ilike.%${phone10}`)
      .limit(1)
      .maybeSingle()
    if (data) return data
  }
  return null
}

async function vincularCliente(clienteId: string, chatId: string) {
  await supabaseClient
    .from('clientes')
    .update({ telegram_chat_id: chatId })
    .eq('id', clienteId)
}

serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ ok: true })

  if (!supabaseUrl || !serviceRoleKey || !telegramToken) {
    return jsonResponse({ error: 'Missing configuration' }, 500)
  }

  if (telegramSecret) {
    const secretHeader = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
    if (secretHeader !== telegramSecret) return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const update = (await req.json()) as TelegramUpdate
  const message = update.message
  if (!message?.text) return jsonResponse({ ok: true })

  const chatId = String(message.chat.id)
  const text = message.text.trim()
  const lower = text.toLowerCase()
  const refresh10m = { expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }
  const refresh2h = { expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() }

  // ── Comandos globales ──────────────────────────────────────────
  if (lower.startsWith('/start')) {
    await deactivateSessions(chatId)
    await sendTelegram(message.chat.id,
      `👋 Hola, soy el asistente de cuenta de *Royal Prestige*.\n\n` +
      `• Escribe /vincular para conectar tu cuenta\n` +
      `• Escribe /estado para ver tu saldo\n` +
      `• Escribe /help para ver todos los comandos`
    )
    return jsonResponse({ ok: true })
  }

  if (lower.startsWith('/vincular')) {
    await deactivateSessions(chatId)
    await createSession(chatId, 'cartera', 'ask_cuenta')
    await sendTelegram(message.chat.id,
      `🔗 *Vinculación de cuenta*\n\nEscribe tu *número de cuenta Hycite* o tu *teléfono registrado* con Royal Prestige:`
    )
    return jsonResponse({ ok: true })
  }

  if (lower.startsWith('/estado')) {
    const { data: cliente } = await supabaseClient
      .from('clientes')
      .select('nombre, apellido, saldo_actual, monto_moroso, dias_atraso, hycite_id')
      .eq('telegram_chat_id', chatId)
      .maybeSingle()

    if (!cliente) {
      await sendTelegram(message.chat.id, `No tienes una cuenta vinculada. Escribe /vincular para conectarla.`)
      return jsonResponse({ ok: true })
    }

    const nombre = `${cliente.nombre ?? ''} ${cliente.apellido ?? ''}`.trim()
    const moroso = parseFloat(cliente.monto_moroso ?? 0)
    const saldo = parseFloat(cliente.saldo_actual ?? 0)
    const dias = parseInt(cliente.dias_atraso ?? 0)
    const estadoMsg = moroso > 0
      ? `⚠️ Tienes *$${moroso.toFixed(2)} pendientes* con ${dias} días de atraso.`
      : `✅ Tu cuenta está al día.`

    await sendTelegram(message.chat.id,
      `📋 *Estado de cuenta — ${nombre}*\n` +
      `Cuenta: ${cliente.hycite_id ?? '-'}\n` +
      `Saldo total: $${saldo.toFixed(2)}\n` +
      `${estadoMsg}`
    )
    return jsonResponse({ ok: true })
  }

  if (lower.startsWith('/help') || lower.startsWith('/ayuda')) {
    await sendTelegram(message.chat.id,
      `📌 *Comandos disponibles:*\n` +
      `/vincular — Conecta tu cuenta Royal Prestige\n` +
      `/estado — Ver tu saldo actual\n` +
      `/start — Reiniciar`
    )
    return jsonResponse({ ok: true })
  }

  // ── Flujo de sesión activa ─────────────────────────────────────
  const session = await getActiveSession(chatId)

  if (session?.intent === 'cartera') {
    switch (session.step) {

      case 'ask_cuenta': {
        const cliente = await findCliente(text)

        if (!cliente) {
          const intentos = (session.intentos ?? 0) + 1
          await updateSession(session.id, { intentos, ...refresh2h })
          if (intentos >= 3) {
            await deactivateSessions(chatId)
            await sendTelegram(message.chat.id,
              `No encontré tu cuenta después de varios intentos. Contacta a tu distribuidor para ayuda.`
            )
            return jsonResponse({ ok: true })
          }
          await sendTelegram(message.chat.id,
            `No encontré ninguna cuenta con ese dato. Intenta con tu número de cuenta Hycite o tu teléfono (intento ${intentos}/3).`
          )
          return jsonResponse({ ok: true })
        }

        // Bloquear si ya está vinculada a otro chat
        if (cliente.telegram_chat_id && cliente.telegram_chat_id !== chatId) {
          await deactivateSessions(chatId)
          await sendTelegram(message.chat.id,
            `⛔ Esta cuenta ya está vinculada a otro dispositivo. Contacta a tu distribuidor si necesitas desvincularla.`
          )
          return jsonResponse({ ok: true })
        }

        // Generar código y enviar al contacto registrado del cliente
        const code = generateCode()
        const phone = cliente.telefono ?? cliente.telefono_casa ?? ''
        const email = cliente.email ?? ''
        let enviado = false
        let canal_envio = ''

        if (phone) {
          enviado = await sendWhatsApp(phone, `Tu código de verificación para vincular tu cuenta Royal Prestige en Telegram es: *${code}*\n\nVálido por 10 minutos. Si no solicitaste esto, ignóralo.`)
          if (enviado) canal_envio = `WhatsApp ${maskPhone(phone)}`
        }
        if (!enviado && email) {
          enviado = await sendEmail(email, code)
          if (enviado) canal_envio = `correo ${maskEmail(email)}`
        }

        if (!enviado) {
          await deactivateSessions(chatId)
          await sendTelegram(message.chat.id,
            `No hay teléfono ni email registrado para esta cuenta. Contacta a tu distribuidor para vincularte.`
          )
          return jsonResponse({ ok: true })
        }

        const nombre = `${cliente.nombre ?? ''} ${cliente.apellido ?? ''}`.trim()
        await updateSession(session.id, {
          step: 'verify_code',
          slots: { cliente_id: cliente.id, nombre, code, intentos_codigo: 0 },
          ...refresh10m,
        })
        await sendTelegram(message.chat.id,
          `📲 Enviamos un código de 6 dígitos a tu ${canal_envio}.\n\nIngresa el código para confirmar que eres *${nombre}*:`
        )
        return jsonResponse({ ok: true })
      }

      case 'verify_code': {
        const codigoCorrecto = session.slots.code as string
        const clienteId = session.slots.cliente_id as string
        const nombre = session.slots.nombre as string
        const intentosCodigo = (session.slots.intentos_codigo as number ?? 0) + 1

        if (text === codigoCorrecto) {
          await vincularCliente(clienteId, chatId)
          await deactivateSessions(chatId)
          await sendTelegram(message.chat.id,
            `✅ *¡Listo, ${nombre}!*\n\nTu cuenta quedó vinculada. Recibirás notificaciones de cuenta directamente aquí.\n\nEscribe /estado para ver tu saldo.`
          )
          return jsonResponse({ ok: true })
        }

        if (intentosCodigo >= 3) {
          await deactivateSessions(chatId)
          await sendTelegram(message.chat.id,
            `❌ Demasiados intentos incorrectos. Escribe /vincular para intentar de nuevo.`
          )
          return jsonResponse({ ok: true })
        }

        await updateSession(session.id, {
          slots: { ...session.slots, intentos_codigo: intentosCodigo },
          ...refresh10m,
        })
        await sendTelegram(message.chat.id,
          `Código incorrecto. Intenta de nuevo (${intentosCodigo}/3):`
        )
        return jsonResponse({ ok: true })
      }
    }
  }

  // ── Sin sesión — respuesta por defecto ────────────────────────
  await sendTelegram(message.chat.id,
    `Escribe /vincular para conectar tu cuenta, o /help para ver los comandos.`
  )
  return jsonResponse({ ok: true })
})
