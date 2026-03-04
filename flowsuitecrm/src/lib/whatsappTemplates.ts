export const DEFAULT_ORGANIZATION_NAME = 'Connection Worldwide Group'
export const CUSTOM_TEMPLATES_STORAGE_KEY = 'flowsuite.whatsapp.templates'

export const CONEXIONES_INFINITAS_DIFUSION = {
  id: 'conexiones_infinitas_difusion',
  nombre: 'Conexiones Infinitas - Lista de difusion',
  mensaje:
    '🎁 Estoy participando para ganarme un regalo premium de Royal Prestige. Ya separé uno para ti también — te lo llevan a tu casa. Habla con {vendedor} al {telefono} por WhatsApp y él/ella te explica cómo reclamarlo 😊',
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
  | 'custom'
  | 'general'
  | 'seguimiento'
  | 'cartera'
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
  { key: 'custom', labelKey: 'whatsapp.tabs.custom' },
] as const

export const DEFAULT_SYSTEM_TEMPLATES: SystemTemplateSeed[] = [
  {
    key: 'cumpleanos',
    label: 'Feliz Cumpleanos',
    category: 'basic',
    message:
      '🎉 ¡Feliz cumpleaños {cliente}! 🎂\nTe saluda {vendedor} de {organizacion}.\nQueremos celebrar contigo con un detalle especial. ¿Te parece si coordinamos?\nContáctame al {telefono}.',
  },
  {
    key: 'referido',
    label: 'Referido',
    category: 'basic',
    message:
      'Hola {cliente} 😊\nTe contacto de parte de {recomendado_por}.\nSoy {vendedor} de {organizacion}. Me gustaría presentarte algo especial de Royal Prestige.\n¿Tienes unos minutos esta semana?\nContacto: {telefono}.',
  },
  {
    key: 'seguimiento',
    label: 'Seguimiento',
    category: 'basic',
    message:
      'Hola {cliente}, soy {vendedor} de {organizacion}.\nQuería darle seguimiento a nuestra conversación. ¿Podemos coordinar una cita?\nEstoy pendiente en {telefono}.',
  },
  {
    key: 'recordatorio',
    label: 'Recordatorio',
    category: 'basic',
    message:
      'Hola {cliente} 👋\nSolo quería recordarte nuestra cita/seguimiento con Royal Prestige.\nSi necesitas ajustar horario, me dices por {telefono}.',
  },
  {
    key: 'personalizado',
    label: 'Personalizado',
    category: 'basic',
    message: '',
  },
  {
    key: 'cartera_0_30',
    label: 'Cartera 0-30',
    category: 'cartera',
    message:
      'Hola {cliente}, soy {vendedor} de {organizacion}.\nTe escribo por tu cuenta Royal Prestige (HyCite) #{cuenta_hycite}.\nSaldo actual: ${saldo_actual}.\nSi ya realizaste el pago, ignora este mensaje. Si necesitas apoyo, escríbeme al {telefono}.',
  },
  {
    key: 'cartera_31_60',
    label: 'Cartera 31-60',
    category: 'cartera',
    message:
      '{cliente}, te escribo por tu cuenta Royal Prestige (HyCite) #{cuenta_hycite}.\nTienes {dias_atraso} días de atraso y un monto moroso de ${monto_moroso}.\nSi no regularizas el pago, puede afectar tu historial crediticio.\nNecesito tu respuesta para coordinar pago o arreglo.\nContacto: {telefono}.',
  },
  {
    key: 'cartera_60_mas',
    label: 'Cartera 60+',
    category: 'cartera',
    message:
      '{cliente}, tu cuenta Royal Prestige (HyCite) #{cuenta_hycite} tiene {dias_atraso} días de atraso.\nMonto moroso: ${monto_moroso}.\nSi no llegamos a un arreglo, tu cuenta será enviada a tu distribuidor y el crédito podrá ser reportado, afectando tu historial.\nComunícate al {telefono}.',
  },
]

export type WhatsappTemplateTabKey = (typeof templateTabs)[number]['key']

const baseTemplates: WhatsappTemplate[] = [
  {
    id: 'pipeline.nuevo',
    category: 'pipeline',
    label: 'Nuevo',
    message:
      'Hola {nombre}, soy {vendedor} de {organizacion}. Me gustaría presentarte una oportunidad única con Royal Prestige. ¿Tienes unos minutos esta semana?',
  },
  {
    id: 'pipeline.contactado',
    category: 'pipeline',
    label: 'Contactado',
    message: 'Hola {nombre}, quería darte seguimiento a nuestra conversación. ¿Pudimos agendar una cita esta semana?',
  },
  {
    id: 'pipeline.cita',
    category: 'pipeline',
    label: 'Cita',
    message: 'Hola {nombre}, te confirmo nuestra cita. Estaré contigo el {next_action_date}. ¿Confirmamos?',
  },
  {
    id: 'pipeline.demo',
    category: 'pipeline',
    label: 'Demo',
    message: 'Hola {nombre}, mañana es nuestra presentación. Te espero puntual. Cualquier pregunta estoy aquí.',
  },
  {
    id: 'pipeline.cierre',
    category: 'pipeline',
    label: 'Cierre',
    message:
      'Hola {nombre}, fue un placer presentarte los productos Royal Prestige. ¿Tienes alguna pregunta sobre el financiamiento? Puedo ayudarte.',
  },
  {
    id: 'pipeline.descartado',
    category: 'pipeline',
    label: 'Descartado',
    message: 'Hola {nombre}, espero estés muy bien. Quería retomar el contacto, tenemos novedades que podrían interesarte.',
  },
  {
    id: 'source.programa_canastas',
    category: 'source',
    label: 'Programa de Canastas',
    message:
      'Hola {nombre}, soy {vendedor} de {organizacion}. Participaste en nuestro sorteo y quería presentarte más sobre lo que hacemos. ¿Tienes unos minutos?',
  },
  {
    id: 'source.feria',
    category: 'source',
    label: 'Feria/Exhibición',
    message:
      'Hola {nombre}, fue un placer conocerte en el evento. Soy {vendedor} de {organizacion} y quería darte seguimiento. ¿Agendamos una cita?',
  },
  {
    id: 'source.referido',
    category: 'source',
    label: 'Referido',
    message:
      'Hola {nombre}, te contacto de parte de {embajador}. Soy {vendedor} de {organizacion} y me gustaría presentarte algo especial.',
  },
  {
    id: 'source.toque_puerta',
    category: 'source',
    label: 'Toque de puerta',
    message:
      'Hola {nombre}, paso por aquí para saludarte. Soy {vendedor} de {organizacion}. ¿Tienes unos minutos esta semana para una presentación?',
  },
  {
    id: 'client.servicio',
    category: 'client',
    label: 'Servicio',
    message:
      'Hola {nombre}, te contacto de {organizacion} para coordinar el mantenimiento de tu equipo. ¿Cuándo tienes disponibilidad?',
  },
  {
    id: 'client.cumpleanos',
    category: 'client',
    label: 'Cumpleaños',
    message: '🎉 ¡Feliz cumpleaños {nombre}! 🎂\n\nTe saluda {vendedor}, Distribuidor Autorizado de Royal Prestige.\n\nQueremos celebrar contigo: tienes un BONO especial de $200 para tu próximo equipo y un detalle sorpresa que te entregaremos personalmente. 🥳\n\n¡Que tengas un día increíble! Contáctanos hoy para reclamar tu regalo.',
  },
  {
    id: 'client.morosa',
    category: 'client',
    label: 'Cuenta morosa',
    message:
      'Hola {nombre}, soy {vendedor} de {organizacion}. Quería coordinar contigo sobre tu cuenta. ¿Tienes un momento para hablar?',
  },
  {
    id: 'client.recompra',
    category: 'client',
    label: 'Recompra',
    message:
      'Hola {nombre}, espero que estés disfrutando tus productos Royal Prestige. Tenemos novedades que podrían interesarte. ¿Agendamos una visita?',
  },
  {
    id: '4en14.invitacion_demo',
    category: '4en14',
    label: 'Invitación demo',
    message:
      'Hola {nombre}, te invito a una presentación exclusiva de Royal Prestige. Es una experiencia única. ¿Puedes el {fecha}?',
  },
  {
    id: '4en14.recordatorio_demo',
    category: '4en14',
    label: 'Recordatorio demo',
    message: 'Hola {nombre}, te recuerdo nuestra presentación mañana. ¡Te espero! Cualquier cambio avísame.',
  },
  {
    id: '4en14.post_demo',
    category: '4en14',
    label: 'Seguimiento post-demo',
    message: 'Hola {nombre}, gracias por asistir a la presentación. ¿Tienes alguna pregunta? Estoy aquí para ayudarte.',
  },
  {
    id: '4en14.demo_calificada',
    category: '4en14',
    label: 'Demo calificada',
    message:
      'Hola {nombre}, tu demo fue calificada. ¡Felicitaciones! Sigamos con el siguiente paso. ¿Te parece si coordinamos la próxima reunión?',
  },
  {
    id: '4en14.ciclo_completado',
    category: '4en14',
    label: 'Ciclo completado',
    message:
      'Hola {nombre}, completaste tu ciclo 4 en 14. ¡Felicitaciones! Tu regalo está listo. Coordinemos la entrega.',
  },
  {
    id: 'conexiones.bienvenida',
    category: 'conexiones',
    label: 'Bienvenida embajador',
    message:
      'Hola {nombre}, bienvenido al programa Conexiones Infinitas de {organizacion} como Embajador Silver. ¡Empecemos!',
  },
  {
    id: 'conexiones.upgrade_gold',
    category: 'conexiones',
    label: 'Upgrade a Gold',
    message:
      '🏆 Hola {nombre}, ¡felicitaciones! Alcanzaste el nivel Gold en Conexiones Infinitas. ¡Es un logro increíble!',
  },
  {
    id: 'conexiones.seguimiento',
    category: 'conexiones',
    label: 'Seguimiento conexiones',
    message: 'Hola {nombre}, quería saber cómo van tus conexiones este mes. ¿Necesitas apoyo o materiales?',
  },
  {
    id: 'conexiones.premio',
    category: 'conexiones',
    label: 'Premio entregado',
    message: 'Hola {nombre}, fue un placer entregarte tu premio de Conexiones Infinitas. ¡Sigue así!',
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
  if (context.type === 'cliente') return ['client', 'custom']
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
  message.replace(/\{([a-z_]+)\}/gi, (_match, key) => variables[key] ?? '')

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
