export const CWG_WEBSITE = 'https://www.connectionworldwidegroup.com'
export const CWG_EMPRENDE_URL = 'https://www.connectionworldwidegroup.com/emprende-con-nosotros/'

export type EmailTemplateCategory =
  | 'negocio'
  | 'servicio'
  | 'oferta'
  | 'cartera'
  | 'cumpleanos'

export type EmailTemplate = {
  id: string
  label: string
  subject: string
  message: string
  category: EmailTemplateCategory
}

export const EMAIL_CATEGORY_LABELS: Record<EmailTemplateCategory, string> = {
  negocio: 'Oportunidad de negocio',
  servicio: 'Servicio al cliente',
  oferta: 'Oferta del mes',
  cartera: 'Cartera',
  cumpleanos: 'Cumpleaños',
}

export const emailTemplates: EmailTemplate[] = [
  // ── Oportunidad de negocio ────────────────────────────────────────────────
  {
    id: 'negocio.distribuidor',
    category: 'negocio',
    label: 'Invitación a ser distribuidor',
    subject: 'Una oportunidad que quiero compartirte — Royal Prestige',
    message: `Hola {cliente},

Espero que estés muy bien. Te escribo porque creo que tienes el perfil ideal para algo que puede cambiar tu situación financiera.

Royal Prestige está abriendo nuevas plazas de distribuidores independientes en tu zona. Es una oportunidad real de generar ingresos desde casa, con respaldo de una marca de 60 años en el mercado.

¿Qué incluye?
• Capacitación completa sin costo
• Kit de inicio con materiales profesionales
• Acceso a una red de clientes activos
• Comisiones directas desde el primer mes

No se necesita experiencia previa — solo ganas de crecer.

Puedes conocer más sobre la oportunidad aquí:
https://www.connectionworldwidegroup.com/emprende-con-nosotros/

¿Te gustaría que conversemos 15 minutos esta semana para contarte los detalles? Escríbeme por WhatsApp al {vendedor_telefono}.

Quedo pendiente a tu respuesta.`,
  },
  {
    id: 'negocio.referido',
    category: 'negocio',
    label: 'Seguimiento de referido',
    subject: '{recomendado_por_nombre} me pidió que te contactara',
    message: `Hola {cliente},

Te escribo de parte de {recomendado_por_nombre}, quien me recomendó contactarte.

Soy {vendedor_nombre} de {organizacion}, distribuidores autorizados de Royal Prestige. {recomendado_por_nombre} pensó que podrías estar interesado/a en los productos o en la oportunidad de negocio que ofrecemos.

Royal Prestige lleva más de 60 años ayudando a familias con sistemas de cocina y purificación de agua de alta calidad, con financiamiento directo y sin aval.

Si quieres conocer más sobre lo que hacemos antes de nuestra llamada:
https://www.connectionworldwidegroup.com/emprende-con-nosotros/

Me gustaría presentarte lo que tenemos disponible para tu zona. ¿Tienes disponibilidad esta semana para una llamada corta? Puedes escribirme al {vendedor_telefono}.

Gracias por tu tiempo.`,
  },
  {
    id: 'negocio.reactivacion',
    category: 'negocio',
    label: 'Reactivación de contacto frío',
    subject: 'Tenemos novedades para ti — {organizacion}',
    message: `Hola {cliente},

Hace tiempo que no hablamos, pero quería retomar el contacto porque tenemos novedades importantes en {organizacion}.

Este año Royal Prestige lanzó nuevos programas de financiamiento y productos actualizados que creo que pueden ser de tu interés.

Si en algún momento conversamos y no era el momento adecuado, quizás ahora sí lo sea. No hay ningún compromiso — solo quiero mantenerte informado/a.

Puedes ver más sobre nuestra empresa aquí:
https://www.connectionworldwidegroup.com/emprende-con-nosotros/

¿Podemos agendar una llamada de 10 minutos esta semana? Escríbeme al {vendedor_telefono}.

Gracias.`,
  },

  // ── Servicio al cliente ───────────────────────────────────────────────────
  {
    id: 'servicio.confirmacion_cita',
    category: 'servicio',
    label: 'Confirmación de cita de servicio',
    subject: 'Confirmación de tu cita de servicio — Royal Prestige',
    message: `Hola {cliente},

Te confirmamos tu cita de servicio técnico con Royal Prestige.

Nuestro técnico estará contigo para revisar y dar mantenimiento a tu equipo. Si necesitas reprogramar o tienes alguna pregunta antes de la visita, no dudes en responder este correo.

Gracias por confiar en nosotros.
`,
  },
  {
    id: 'servicio.post_servicio',
    category: 'servicio',
    label: 'Seguimiento post-servicio',
    subject: '¿Cómo quedó tu equipo? — Royal Prestige',
    message: `Hola {cliente},

Esperamos que hayas quedado satisfecho/a con el servicio que recibiste.

Queremos asegurarnos de que tu equipo Royal Prestige esté funcionando perfectamente. Si notas algo fuera de lo normal o tienes alguna pregunta sobre el mantenimiento, estamos aquí para ayudarte.

Tu opinión es importante para nosotros — si deseas, puedes responder este correo con cualquier comentario.

Gracias por ser parte de nuestra familia de clientes.
`,
  },
  {
    id: 'servicio.recordatorio_mantenimiento',
    category: 'servicio',
    label: 'Recordatorio de mantenimiento',
    subject: 'Es momento de dar mantenimiento a tu equipo Royal Prestige',
    message: `Hola {cliente},

Te escribimos para recordarte que es tiempo de programar el mantenimiento preventivo de tu equipo Royal Prestige.

El mantenimiento regular garantiza:
• Mejor desempeño y vida útil prolongada del equipo
• Calidad óptima del agua purificada
• Protección de tu inversión

Contáctanos para agendar tu visita sin costo adicional dentro de tu plan de servicio.

Estamos a tus órdenes.
`,
  },
  {
    id: 'servicio.bienvenida',
    category: 'servicio',
    label: 'Bienvenida a cliente nuevo',
    subject: '¡Bienvenido/a a la familia Royal Prestige, {cliente}!',
    message: `Hola {cliente},

¡Bienvenido/a a la familia Royal Prestige!

Nos da mucho gusto tenerte como cliente. A partir de ahora cuentas con:

• Servicio técnico autorizado en tu zona
• Garantía respaldada por HyCite Corporation
• Atención personalizada de tu distribuidor

Tu distribuidor asignado es {vendedor_nombre}, quien estará disponible para cualquier consulta o servicio que necesites.

Si tienes alguna pregunta sobre el uso o mantenimiento de tu equipo, no dudes en escribirnos.

¡Que disfrutes tu equipo al máximo!
`,
  },

  // ── Oferta del mes ────────────────────────────────────────────────────────
  {
    id: 'oferta.frescaflow_abril',
    category: 'oferta',
    label: 'FrescaFlow — Oferta de abril',
    subject: '20% de descuento en Sistema FrescaFlow — Solo este mes',
    message: `Hola {cliente},

Tenemos una oferta exclusiva para ti este mes de abril.

El Sistema FrescaFlow de Royal Prestige está disponible con 20% de descuento — y lo reservamos primero para nuestros clientes activos como tú.

¿Por qué FrescaFlow?
• Agua purificada al instante, directo del grifo
• Elimina cloro, metales pesados y bacterias
• Sin garrafones, sin gastos mensuales
• Tecnología Royal Prestige con garantía incluida

Esta oferta vence el 30 de abril y los cupos son limitados.

¿Te interesa? Responde este correo o contáctame directamente y te doy todos los detalles en minutos.
`,
  },
  {
    id: 'oferta.descuento_repuesto',
    category: 'oferta',
    label: 'Descuento en repuesto para clientes activos',
    subject: 'Oferta especial en repuestos para tu equipo — {organizacion}',
    message: `Hola {cliente},

Como cliente activo de Royal Prestige, tienes acceso a una oferta especial este mes en repuestos para tu equipo.

Sabemos que mantener tu sistema en óptimas condiciones es importante, por eso queremos facilitártelo con precios preferenciales exclusivos para ti.

Para aprovechar esta oferta, simplemente responde este correo indicando el modelo de tu equipo o contáctame directamente.

La oferta está disponible por tiempo limitado.
`,
  },
  {
    id: 'oferta.recompra',
    category: 'oferta',
    label: 'Invitación a recompra',
    subject: 'Novedades Royal Prestige que pueden interesarte, {cliente}',
    message: `Hola {cliente},

Esperamos que sigas disfrutando tu equipo Royal Prestige.

Queríamos hacerte saber que este mes tenemos nuevos productos y programas de financiamiento especiales para clientes como tú, que ya conocen la calidad de la marca.

Si en algún momento te ha interesado complementar tu equipo o renovarlo, este es un buen momento para conversarlo.

¿Te gustaría que te cuente las opciones disponibles?
`,
  },

  // ── Cartera ───────────────────────────────────────────────────────────────
  {
    id: 'cartera.recordatorio',
    category: 'cartera',
    label: 'Recordatorio de pago',
    subject: 'Recordatorio de pago — Cuenta Royal Prestige #{cuenta_hycite}',
    message: `Hola {cliente},

Te escribimos para recordarte que tienes un saldo pendiente en tu cuenta Royal Prestige (HyCite) #{cuenta_hycite}.

Saldo actual: ${'{saldo_actual}'}

Si ya realizaste tu pago, por favor ignora este mensaje. Si necesitas apoyo para coordinar tu pago o tienes alguna pregunta, con gusto te atendemos.

Estamos aquí para ayudarte.
`,
  },
  {
    id: 'cartera.arreglo_pago',
    category: 'cartera',
    label: 'Propuesta de arreglo de pago',
    subject: 'Tu cuenta Royal Prestige — Hablemos de opciones',
    message: `Hola {cliente},

Hemos notado que tu cuenta Royal Prestige (HyCite) #{cuenta_hycite} tiene {dias_atraso} días de atraso con un monto moroso de ${'{monto_moroso}'}.

Entendemos que pueden surgir situaciones inesperadas. Por eso queremos contactarte antes de que el proceso avance, para encontrar juntos una solución que funcione para ti.

¿Podemos coordinar una llamada corta esta semana para revisar opciones de pago?

Responde este correo o contáctame directamente. Tu cuenta es importante para nosotros y queremos ayudarte a regularizarla.
`,
  },

  // ── Cumpleaños ────────────────────────────────────────────────────────────
  {
    id: 'cumpleanos.cliente',
    category: 'cumpleanos',
    label: 'Feliz cumpleaños con oferta',
    subject: '🎂 ¡Feliz cumpleaños {cliente}! Un regalo especial para ti',
    message: `Hola {cliente},

¡Hoy es tu día especial y queríamos ser los primeros en celebrarlo contigo! 🎉

En {organizacion} te tenemos un regalo de cumpleaños: un bono exclusivo de $200 para tu próximo equipo Royal Prestige, válido durante este mes.

No necesitas hacer nada complicado — solo contáctame y coordinamos los detalles para que puedas reclamar tu regalo.

¡Que tengas un cumpleaños increíble rodeado de las personas que más quieres!

Con cariño,`,
  },
]

export const getEmailTemplatesByCategory = (category: EmailTemplateCategory): EmailTemplate[] =>
  emailTemplates.filter((t) => t.category === category)

export const EMAIL_CATEGORIES = Object.keys(EMAIL_CATEGORY_LABELS) as EmailTemplateCategory[]
