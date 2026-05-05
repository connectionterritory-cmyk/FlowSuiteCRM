import { resolveTemplate } from './messagePlaceholders'

export const DEFAULT_ORGANIZATION_NAME = 'Connection Worldwide Group'
export const CUSTOM_TEMPLATES_STORAGE_KEY = 'flowsuite.whatsapp.templates'

export const CONEXIONES_INFINITAS_DIFUSION = {
  id: 'conexiones_infinitas_difusion',
  nombre: 'Conexiones Infinitas - Lista de difusion',
  mensaje:
    '🎁 Estoy participando para ganarme un regalo premium de Royal Prestige. Ya separé uno para ti también — te lo llevan a tu casa. Habla con {vendedor_nombre} al {vendedor_telefono} por WhatsApp y él/ella te explica cómo reclamarlo 😊',
  variables: ['vendedor', 'telefono'],
}

export type WhatsappContextType = 'lead' | 'cliente' | '4en14' | 'conexiones'

export type WhatsappContext = {
  type: WhatsappContextType
  nombre?: string
  vendedor?: string
  organizacion?: string
  telefono?: string
  next_action_date?: string
  fecha?: string
  embajador?: string
  fuente?: string | null
  estado_pipeline?: string | null
  programa_id?: string | null
  embajador_id?: string | null
}

export type WhatsappTemplateCategory =
  | 'pipeline'
  | 'source'
  | 'client'
  | '4en14'
  | 'conexiones'
  | 'negocio'
  | 'cartera'
  | 'campana'
  | 'custom'
  | 'general'
  | 'seguimiento'
  | 'referidos'
  | 'cumpleanos'
  | 'citas'
  | 'servicio'
  | 'cambio_repuestos'

export type SystemTemplateSeed = {
  key: string
  label: string
  message: string
  category: 'basic' | 'cartera'
}

export type WhatsappTemplate = {
  id: string
  label: string
  message: string
  category: WhatsappTemplateCategory
}

export type CustomWhatsappTemplate = WhatsappTemplate & {
  custom?: boolean
}

export const templateTabs = [
  { key: 'pipeline', labelKey: 'whatsapp.tabs.pipeline' },
  { key: 'source', labelKey: 'whatsapp.tabs.source' },
  { key: 'client', labelKey: 'whatsapp.tabs.client' },
  { key: '4en14', labelKey: 'whatsapp.tabs.4en14' },
  { key: 'conexiones', labelKey: 'whatsapp.tabs.conexiones' },
  { key: 'campana', labelKey: 'whatsapp.tabs.campana' },
  { key: 'custom', labelKey: 'whatsapp.tabs.custom' },
] as const

export const DEFAULT_SYSTEM_TEMPLATES: SystemTemplateSeed[] = [
  {
    key: 'cumpleanos',
    label: 'Feliz Cumpleaños',
    category: 'basic',
    message:
      '🎉 ¡Feliz cumpleaños {nombre}! 🎂\n\nTe saluda {vendedor_nombre} de Connection Worldwide Group.\n\nQueremos celebrar contigo — tienes un detalle especial esperándote 🎁 ¿Te parece si lo coordinamos?\n\nEscríbeme o llámame al {vendedor_telefono}.',
  },
  {
    key: 'referido',
    label: 'Referido',
    category: 'basic',
    message:
      'Hola {nombre} 😊 Te contacto de parte de *{recomendado_por_nombre}*, quien me pidió que te escribiera.\n\nSoy {vendedor_nombre} de Connection Worldwide Group, distribuidores autorizados de Royal Prestige. Tu conocido/a pensó que podría interesarte lo que hacemos.\n\n¿Tienes unos minutos esta semana? Estoy al {vendedor_telefono}.',
  },
  {
    key: 'seguimiento',
    label: 'Seguimiento',
    category: 'basic',
    message:
      'Hola {nombre} 👋 Soy {vendedor_nombre} de Connection Worldwide Group.\n\nQuería darle seguimiento a nuestra conversación — a veces los mensajes se pierden 😄\n\n¿Podemos coordinar una cita esta semana? Estoy al {vendedor_telefono}.',
  },
  {
    key: 'recordatorio',
    label: 'Recordatorio de cita',
    category: 'basic',
    message:
      'Hola {nombre} ✅ Solo quería recordarte nuestra cita/seguimiento de Royal Prestige.\n\nSi necesitas ajustar el horario avísame con tiempo. Estoy al {vendedor_telefono} 😊',
  },
  {
    key: 'personalizado',
    label: 'Personalizado',
    category: 'basic',
    message: '',
  },
  {
    key: 'cartera_0_30',
    label: 'Cartera 0-30 días',
    category: 'cartera',
    message:
      'Hola {nombre}, soy {vendedor_nombre} de Connection Worldwide Group.\n\nTe escribo por tu cuenta Royal Prestige #{cuenta_hycite}. Tienes un saldo pendiente de *${saldo_actual}*.\n\nSi ya realizaste tu pago ignora este mensaje. Si necesitas apoyo para coordinarlo, escríbeme aquí o al {vendedor_telefono} 😊',
  },
  {
    key: 'cartera_31_60',
    label: 'Cartera 31-60 días',
    category: 'cartera',
    message:
      'Hola {nombre}, soy {vendedor_nombre} de Connection Worldwide Group.\n\nTu cuenta Royal Prestige #{cuenta_hycite} tiene *{dias_atraso} días de atraso* con un monto de *${monto_moroso}*.\n\nQuiero ayudarte a regularizarla antes de que avance el proceso. ¿Podemos hablar hoy? Estoy al {vendedor_telefono}.',
  },
  {
    key: 'cartera_60_mas',
    label: 'Cartera 60+ días',
    category: 'cartera',
    message:
      '{nombre}, tu cuenta Royal Prestige #{cuenta_hycite} tiene *{dias_atraso} días de atraso* — monto moroso: *${monto_moroso}*.\n\nEs importante que hablemos hoy para encontrar una solución antes de que el proceso avance y afecte tu historial crediticio.\n\nContáctame al {vendedor_telefono} o responde aquí. Estoy disponible.',
  },
]

export type WhatsappTemplateTabKey = (typeof templateTabs)[number]['key']

export const baseTemplates: WhatsappTemplate[] = [
  // ── Pipeline ────────────────────────────────────────────────────────────────
  {
    id: 'pipeline.nuevo',
    category: 'pipeline',
    label: 'Nuevo',
    message:
      'Hola {nombre} 👋 Soy {vendedor_nombre} de Connection Worldwide Group, distribuidores autorizados de Royal Prestige.\n\nTe contacto porque tenemos algo que puede interesarte — productos de calidad premium con financiamiento directo, sin aval.\n\n¿Tienes 10 minutos esta semana para que te cuente? 😊',
  },
  {
    id: 'pipeline.contactado',
    category: 'pipeline',
    label: 'Contactado',
    message:
      'Hola {nombre}, soy {vendedor_nombre} — te escribí hace unos días sobre Royal Prestige.\n\nQuería darte seguimiento, a veces los mensajes se pierden 😄\n\n¿Pudimos coordinar una cita esta semana?',
  },
  {
    id: 'pipeline.cita',
    category: 'pipeline',
    label: 'Cita agendada',
    message:
      'Hola {nombre} ✅ Te confirmo nuestra cita el *{next_action_date}*.\n\nSi necesitas cambiar el horario avísame con tiempo. ¡Nos vemos!',
  },
  {
    id: 'pipeline.demo',
    category: 'pipeline',
    label: 'Recordatorio demo',
    message:
      'Hola {nombre} 👋 Mañana es nuestra presentación de Royal Prestige.\n\n¿Confirmamos? Te espero puntual. Cualquier cambio de último momento me avisas aquí 😊',
  },
  {
    id: 'pipeline.cierre',
    category: 'pipeline',
    label: 'Post-presentación',
    message:
      'Hola {nombre}, fue un placer presentarte los productos Royal Prestige 🙌\n\n¿Te quedó alguna duda sobre el financiamiento o los modelos? Puedo resolverla ahora mismo — solo dime.',
  },
  {
    id: 'pipeline.descartado',
    category: 'pipeline',
    label: 'Reactivación',
    message:
      'Hola {nombre}, ¿cómo has estado? 😊\n\nHace tiempo que no hablamos y quería retomar el contacto. Tenemos novedades en Royal Prestige — nuevos modelos y mejores condiciones de financiamiento.\n\n¿Te interesa que te cuente?',
  },

  // ── Source ──────────────────────────────────────────────────────────────────
  {
    id: 'source.programa_canastas',
    category: 'source',
    label: 'Programa de Canastas',
    message:
      'Hola {nombre} 😊 Soy {vendedor_nombre} de Connection Worldwide Group.\n\nParticipaste en nuestro programa de canastas y quería presentarte personalmente lo que hacemos — productos Royal Prestige de calidad premium para el hogar.\n\n¿Tienes unos minutos esta semana?',
  },
  {
    id: 'source.feria',
    category: 'source',
    label: 'Feria / Exhibición',
    message:
      'Hola {nombre} 👋 Fue un placer conocerte en el evento. Soy {vendedor_nombre} de Connection Worldwide Group.\n\nQuería darte seguimiento y contarte más sobre lo que viste. ¿Agendamos una llamada rápida esta semana?',
  },
  {
    id: 'source.referido',
    category: 'source',
    label: 'Referido',
    message:
      'Hola {nombre} 😊 Te contacto de parte de *{embajador}*, quien me recomendó hablar contigo.\n\nSoy {vendedor_nombre} de Connection Worldwide Group, distribuidores autorizados de Royal Prestige. Tu conocido/a pensó que podría interesarte lo que hacemos.\n\n¿Tienes unos minutos para que te cuente?',
  },
  {
    id: 'source.toque_puerta',
    category: 'source',
    label: 'Toque de puerta',
    message:
      'Hola {nombre}, soy {vendedor_nombre} de Connection Worldwide Group 👋\n\nPasé por tu zona presentando los productos Royal Prestige y quería seguir en contacto.\n\n¿Tienes disponibilidad esta semana para una visita rápida?',
  },

  // ── Client ──────────────────────────────────────────────────────────────────
  {
    id: 'client.servicio',
    category: 'client',
    label: 'Servicio / Mantenimiento',
    message:
      'Hola {nombre} 👋 Soy {vendedor_nombre} de Connection Worldwide Group.\n\nTe escribo para coordinar el *mantenimiento de tu equipo Royal Prestige* — es importante hacerlo a tiempo para que siga funcionando al 100%.\n\n¿Cuándo tienes disponibilidad esta semana?',
  },
  {
    id: 'client.cumpleanos',
    category: 'client',
    label: 'Cumpleaños',
    message:
      '🎉 ¡Feliz cumpleaños {nombre}! 🎂\n\nTe saluda {vendedor_nombre}, tu distribuidor de Royal Prestige.\n\nQueremos celebrar contigo: tienes un *BONO especial de $200* para tu próximo equipo y un detalle sorpresa que te entregaremos personalmente 🥳\n\n¡Que tengas un día increíble! Escríbeme hoy para reclamar tu regalo.',
  },
  {
    id: 'client.morosa',
    category: 'client',
    label: 'Cuenta con atraso',
    message:
      'Hola {nombre}, soy {vendedor_nombre} de Connection Worldwide Group.\n\nTe escribo porque vi que tienes un saldo pendiente en tu cuenta Royal Prestige y quería ver si podemos coordinarlo antes de que avance el proceso.\n\n¿Tienes un momento para hablar hoy?',
  },
  {
    id: 'client.recompra',
    category: 'client',
    label: 'Recompra / Upsell',
    message:
      'Hola {nombre} 😊 Espero que estés disfrutando tu equipo Royal Prestige.\n\nTe escribo porque este mes tenemos *nuevos modelos y promociones exclusivas* para clientes como tú que ya conocen la calidad de la marca.\n\n¿Te agendo una visita rápida para contarte?',
  },

  // ── 4 en 14 ─────────────────────────────────────────────────────────────────
  {
    id: '4en14.invitacion_demo',
    category: '4en14',
    label: 'Invitación demo',
    message:
      'Hola {nombre} 👋 Te invito a una *presentación exclusiva de Royal Prestige* el *{fecha}*.\n\nEs una experiencia diferente — verás los productos en acción y conocerás la oportunidad de negocio. ¡Vale mucho la pena!\n\n¿Puedes ese día? 😊',
  },
  {
    id: '4en14.recordatorio_demo',
    category: '4en14',
    label: 'Recordatorio demo',
    message:
      'Hola {nombre} ✅ Solo un recordatorio: *mañana es tu presentación de Royal Prestige*.\n\nTe espero puntual. Si hay algún cambio avísame con tiempo 😊',
  },
  {
    id: '4en14.post_demo',
    category: '4en14',
    label: 'Seguimiento post-demo',
    message:
      'Hola {nombre}, gracias por asistir a la presentación 🙌\n\n¿Qué te pareció? Si tienes alguna pregunta sobre los productos o el financiamiento, estoy aquí para resolverla.\n\n¿Seguimos con el siguiente paso?',
  },
  {
    id: '4en14.demo_calificada',
    category: '4en14',
    label: 'Demo calificada',
    message:
      '🎉 ¡Felicitaciones {nombre}! Tu demo fue *calificada* — eso es un logro importante.\n\nVamos al siguiente paso. ¿Cuándo tienes disponibilidad esta semana para coordinarlo?',
  },
  {
    id: '4en14.ciclo_completado',
    category: '4en14',
    label: 'Ciclo completado',
    message:
      '🏆 ¡{nombre}, completaste tu ciclo *4 en 14*! Eso es increíble — no todo el mundo llega aquí.\n\nTu regalo ya está listo. ¿Cuándo coordinamos la entrega? 🎁',
  },

  // ── Conexiones Infinitas ─────────────────────────────────────────────────────
  {
    id: 'conexiones.bienvenida',
    category: 'conexiones',
    label: 'Bienvenida embajador',
    message:
      'Hola {nombre} 🎉 ¡Bienvenido/a oficialmente al programa *Conexiones Infinitas* de Connection Worldwide Group como Embajador Silver!\n\nEsto es el inicio de algo grande. Voy a estar contigo en cada paso. ¿Empezamos? 💪',
  },
  {
    id: 'conexiones.upgrade_gold',
    category: 'conexiones',
    label: 'Upgrade a Gold',
    message:
      '🏆 ¡{nombre}, lo lograste! Alcanzaste el nivel *Gold* en Conexiones Infinitas.\n\nEso habla muy bien de ti y de tu trabajo. ¡Felicitaciones! ¿Listo/a para el siguiente nivel? 🚀',
  },
  {
    id: 'conexiones.seguimiento',
    category: 'conexiones',
    label: 'Seguimiento mensual',
    message:
      'Hola {nombre} 👋 ¿Cómo van tus conexiones este mes?\n\nQuería saber si necesitas apoyo, materiales o tienes alguna pregunta. Estoy aquí para ayudarte a llegar a tu meta 💪',
  },
  {
    id: 'conexiones.premio',
    category: 'conexiones',
    label: 'Premio entregado',
    message:
      '🎁 {nombre}, fue un placer entregarte tu premio de Conexiones Infinitas. ¡Te lo ganaste con trabajo!\n\nSigue así — el próximo nivel tiene mejores recompensas. ¡Vamos! 🚀',
  },
  // ── Oportunidad de negocio ───────────────────────────────────────────────────
  {
    id: 'negocio.distribuidor',
    category: 'negocio',
    label: 'Invitación a distribuidor',
    message:
      'Hola {nombre} 👋 Soy {vendedor_nombre} de Connection Worldwide Group.\n\nTe contacto porque creo que tienes el perfil ideal para una oportunidad que puede cambiar tu situación financiera.\n\nRoyal Prestige está abriendo plazas de distribuidores en tu zona — ingresos reales desde casa, sin experiencia previa, con capacitación incluida.\n\n¿Tienes 10 minutos esta semana para que te cuente los detalles? 💼\n\nwww.connectionworldwidegroup.com/emprende-con-nosotros/',
  },
  {
    id: 'negocio.referido_negocio',
    category: 'negocio',
    label: 'Referido — negocio',
    message:
      'Hola {nombre} 😊 Te contacto de parte de *{recomendado_por_nombre}*, quien pensó que esta oportunidad podría interesarte.\n\nSoy {vendedor_nombre} de Connection Worldwide Group. Trabajamos con Royal Prestige — una marca de 60 años — y tenemos plazas abiertas de distribuidores en tu zona.\n\n¿Tienes unos minutos para que te explique cómo funciona?',
  },
  {
    id: 'negocio.reactivacion',
    category: 'negocio',
    label: 'Reactivación',
    message:
      'Hola {nombre}, ¿cómo has estado? 😊\n\nHace tiempo que no hablamos. Quería retomar el contacto porque tenemos novedades importantes — nuevos programas de ingreso con Royal Prestige y mejores condiciones que antes.\n\nSi en algún momento te llamó la atención, quizás ahora sea el momento. ¿Conversamos esta semana?',
  },
  {
    id: 'negocio.seguimiento',
    category: 'negocio',
    label: 'Seguimiento negocio',
    message:
      'Hola {nombre} 👋 Soy {vendedor_nombre}, te escribí hace unos días sobre la oportunidad con Royal Prestige.\n\nQuería darte seguimiento — a veces los mensajes se pierden 😄\n\n¿Pudiste ver la info? ¿Te quedó alguna pregunta? Estoy aquí para resolverla.',
  },

  // ── Cartera ─────────────────────────────────────────────────────────────────
  {
    id: 'cartera.0_30',
    category: 'cartera',
    label: 'Cartera 0-30 días',
    message:
      'Hola {nombre}, soy {vendedor_nombre} de Connection Worldwide Group.\n\nTe escribo por tu cuenta Royal Prestige #{cuenta_hycite}.\n• Saldo actual: *${saldo_actual}*\n• Monto moroso: *${monto_moroso}*\n\nSi ya realizaste tu pago ignora este mensaje. Si necesitas apoyo para coordinarlo, escríbeme aquí o al {{vendedor_telefono|\"este número\"}} 😊',
  },
  {
    id: 'cartera.31_60',
    category: 'cartera',
    label: 'Cartera 31-60 días',
    message:
      'Hola {nombre}, soy {vendedor_nombre} de Connection Worldwide Group.\n\nTu cuenta Royal Prestige #{cuenta_hycite} tiene *{dias_atraso} días de atraso*.\n• Saldo actual: *${saldo_actual}*\n• Monto moroso: *${monto_moroso}*\n\nQuiero ayudarte a regularizarla antes de que avance el proceso. ¿Podemos hablar hoy? Estoy al {{vendedor_telefono|\"este número\"}}.',
  },
  {
    id: 'cartera.60_mas',
    category: 'cartera',
    label: 'Cartera 60+ días',
    message:
      '{nombre}, tu cuenta Royal Prestige #{cuenta_hycite} tiene *{dias_atraso} días de atraso*.\n• Saldo actual: *${saldo_actual}*\n• Monto moroso: *${monto_moroso}*\n\nEs importante que hablemos hoy para encontrar una solución antes de que el proceso avance y afecte tu historial crediticio.\n\nContáctame al {{vendedor_telefono|\"este número\"}} o responde aquí. Estoy disponible.',
  },
  {
    id: 'cartera.cargo_vuelta_oficina_local',
    category: 'cartera',
    label: 'Cuenta en cobro directo — oficina local',
    message:
      'Estimado/a {nombre}, le contactamos desde la oficina del distribuidor de *Connection Worldwide Group* respecto a su cuenta Royal Prestige #{cuenta_hycite}.\n\nSu cuenta tiene un *balance pendiente de ${monto_cargo_vuelta}*.\n\nSi no llegamos a un acuerdo de pago, esta cuenta será enviada al *Departamento Legal* ⚖️ para iniciar el proceso formal.\n\nPara evitar esto, comuníquese con nosotros:\n📞 *Patricia Caicedo* — (786) 291-3042\n📞 (818) 266-7038\n\nEstamos dispuestos a encontrar una solución antes de que el proceso avance.\n\n*Departamento de Cobranza CWG*',
  },

  // ── Campaña FrescaFlow Abril ────────────────────────────────────────────────
  {
    id: 'campana.frescaflow_v1',
    category: 'campana',
    label: 'FrescaFlow V1 — Beneficio VIP',
    message:
      'Hola {nombre} 👋\n\nQuería avisarte personalmente porque eres parte de nuestra familia de clientes especiales.\n\nEste abril tenemos el *Sistema FrescaFlow Royal Prestige con 20% de descuento* — y lo reservamos primero para clientes como tú.\n\n✅ Agua purificada al instante, sin garrafones\n✅ Elimina cloro, metales y bacterias del agua\n✅ Ahorro real desde el primer mes\n\n¿Te interesa saber más? Escríbeme aquí o al {{vendedor_telefono|\"este número\"}} y te cuento todo 😊\n\n— Connection Worldwide Group',
  },
  {
    id: 'campana.frescaflow_v2',
    category: 'campana',
    label: 'FrescaFlow V2 — Directo al grano',
    message:
      '{nombre}, buenas 🙌\n\nTengo algo bueno para ti este mes:\n\n🌿 *FrescaFlow Royal Prestige — 20% OFF en abril*\nSolo para clientes activos. Disponibilidad limitada.\n\n💧 ¿Por qué comprarlo ahora?\n1. Agua limpia y segura para toda tu familia\n2. Deja de gastar en botellas y garrafones\n3. Tecnología Royal Prestige con respaldo garantizado\n\nSi quieres aprovecharlo, dime y te doy los detalles en 2 minutos.\n\nConnection Worldwide Group | {{vendedor_telefono|\"este número\"}}',
  },
  {
    id: 'campana.frescaflow_v3',
    category: 'campana',
    label: 'FrescaFlow V3 — Familia',
    message:
      'Hola {nombre}, ¿cómo está la familia? 😊\n\nTe escribo porque este mes tenemos algo especial para el hogar:\n\nEl *Sistema FrescaFlow de Royal Prestige* está disponible con *20% de descuento solo en abril*.\n\n🏡 Lo que más les gusta a las familias:\n• Agua pura directo del grifo, sin esperar\n• Protege la salud de niños y adultos mayores\n• Se instala fácil y dura años sin mantenimiento costoso\n\nSi te llama la atención, con gusto te explico cómo funciona.\n\nEstoy al {{vendedor_telefono|\"este número\"}} o aquí mismo 👇\n\nConnection Worldwide Group',
  },
  {
    id: 'campana.frescaflow_v4',
    category: 'campana',
    label: 'FrescaFlow V4 — Urgencia suave',
    message:
      '{nombre}, te aviso antes de que se acabe el mes 📅\n\nAbril es el último mes con el *20% de descuento en el Sistema FrescaFlow Royal Prestige* — y quedan pocos cupos a ese precio.\n\n⚡ 3 razones para no esperar más:\n1. El 20% de descuento vence el 30 de abril\n2. Agua filtrada de calidad premium para tu hogar hoy mismo\n3. Respaldo total de Royal Prestige — marca de confianza\n\nEscríbeme o llámame: {{vendedor_telefono|\"este número\"}}\n\nConnection Worldwide Group — Distribuidores Autorizados',
  },
  {
    id: 'campana.frescaflow_v5',
    category: 'campana',
    label: 'FrescaFlow V5 — Confianza',
    message:
      '{nombre}, espero que estés muy bien 🙏\n\nComo cliente nuestro ya sabes que solo te contacto cuando tengo algo que vale la pena.\n\nEste mes es el *Sistema FrescaFlow Royal Prestige con 20% de descuento* — una de las promos más fuertes del año.\n\n🌟 Vale la pena porque:\n› Filtra y purifica el agua de tu casa las 24 horas\n› Elimina el gasto mensual en agua embotellada\n› Inversión que se paga sola en menos de 6 meses\n\n¿Te agendo una llamada rápida para contarte los detalles?\n\n{{vendedor_telefono|\"este número\"}} | Connection Worldwide Group',
  },
]

export const getOrganizationName = (metadata?: Record<string, unknown> | null) => {
  const value = typeof metadata?.organization_name === 'string' ? metadata.organization_name.trim() : ''
  return value || DEFAULT_ORGANIZATION_NAME
}

export const getTemplatesByCategory = (
  category: WhatsappTemplateCategory,
  customTemplates: CustomWhatsappTemplate[] = []
) => {
  const allTemplates = [...baseTemplates, ...customTemplates]
  return allTemplates.filter((template) => template.category === category)
}

export const getAvailableCategories = (context: WhatsappContext): WhatsappTemplateCategory[] => {
  if (context.type === 'lead') {
    const categories: WhatsappTemplateCategory[] = ['pipeline', 'source']
    if (context.programa_id) categories.push('4en14')
    if (context.embajador_id) categories.push('conexiones')
    categories.push('custom')
    return categories
  }
  if (context.type === 'cliente') return ['client', 'campana', 'custom']
  if (context.type === '4en14') return ['4en14', 'custom']
  if (context.type === 'conexiones') return ['conexiones', 'custom']
  return ['pipeline', 'source', 'custom']
}

export const getDefaultCategory = (
  context: WhatsappContext,
  available: WhatsappTemplateCategory[]
): WhatsappTemplateCategory => {
  if (context.type === 'cliente') return 'client'
  if (context.type === '4en14') return '4en14'
  if (context.type === 'conexiones') return 'conexiones'
  if (available.includes('pipeline')) return 'pipeline'
  return available[0] ?? 'pipeline'
}

export const getPreferredTemplateId = (category: WhatsappTemplateCategory, context: WhatsappContext) => {
  if (category === 'pipeline' && context.estado_pipeline) {
    return `pipeline.${context.estado_pipeline}`
  }
  if (category === 'source' && context.fuente) {
    const fuenteMap: Record<string, string> = {
      programa_canastas: 'source.programa_canastas',
      feria: 'source.feria',
      exhibicion: 'source.feria',
      referido: 'source.referido',
      toque_puerta: 'source.toque_puerta',
    }
    return fuenteMap[context.fuente] ?? null
  }
  if (category === '4en14') return '4en14.invitacion_demo'
  if (category === 'conexiones') return 'conexiones.bienvenida'
  if (category === 'client') return 'client.servicio'
  return null
}

export const buildTemplateVariables = (context: WhatsappContext) => {
  const organizacion = context.organizacion?.trim() || DEFAULT_ORGANIZATION_NAME
  return {
    nombre: context.nombre ?? '',
    vendedor: context.vendedor ?? '',
    organizacion,
    telefono: context.telefono ?? '',
    next_action_date: context.next_action_date ?? '',
    fecha: context.fecha ?? context.next_action_date ?? '',
    embajador: context.embajador ?? '',
  }
}

export const replaceTemplateVariables = (message: string, variables: Record<string, string>) =>
  resolveTemplate(message, variables).text

export const buildWhatsappUrl = (phone: string, message: string) => {
  const sanitizedPhone = phone.replace(/\D/g, '')
  if (!sanitizedPhone) return null
  // Use api.whatsapp.com/send (no redirect) to avoid emoji corruption
  // that can happen when wa.me does a 302 redirect through the browser.
  return `https://api.whatsapp.com/send?phone=${sanitizedPhone}&text=${encodeURIComponent(message)}`
}

const isTemplateValid = (template: CustomWhatsappTemplate) =>
  Boolean(template.id && template.label && template.message && template.category)

export const loadCustomTemplates = (): CustomWhatsappTemplate[] => {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as CustomWhatsappTemplate[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((template) => ({ ...template, custom: true })).filter(isTemplateValid)
  } catch {
    return []
  }
}

export const saveCustomTemplates = (templates: CustomWhatsappTemplate[]) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(templates))
}
