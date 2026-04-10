export type AssignedOption = {
  id: string
  label: string
}

export type CitaForm = {
  id?: string
  owner_id?: string
  start_at: string
  timezone?: string
  tipo: string
  estado: string
  notas: string
  direccion: string
  ciudad?: string
  estado_region?: string
  zip?: string
  apartamento?: string
  assigned_to: string
  contacto_nombre: string
  contacto_telefono: string
  contacto_tipo: 'cliente' | 'lead'
  contacto_id: string
  campaign_id?: string
  message_id?: string
  response_id?: string
  resultado?: string
  resultado_notas?: string
  next_action_date?: string
}

export type CierreActividad = {
  resumen: string
  demo_realizada: boolean
  muestra_entregada: boolean
  referidos_obtenidos: boolean
  referidos_count: string
  productos_interes: string[]
}

export type CierreTarea = {
  crear_tarea: boolean
  tipo: string
  descripcion: string
  asignado_a: string
  fecha_vencimiento: string
  hora_vencimiento: string
  prioridad: string
}

export const ESTADO_OPTIONS = [
  { value: 'programada', label: 'Programada' },
  { value: 'confirmada', label: 'Confirmada' },
  { value: 'en_camino', label: 'En camino' },
  { value: 'completada', label: 'Completada' },
  { value: 'no_show', label: 'No show' },
  { value: 'cancelada', label: 'Cancelada' },
]

export const TIPO_OPTIONS = [
  { value: 'servicio', label: 'Servicio' },
  { value: 'demo', label: 'Demo' },
  { value: 'cobranza', label: 'Cobranza' },
  { value: 'reclutamiento', label: 'Reclutamiento' },
  { value: 'otro', label: 'Otro' },
]

export const CONTACTO_TIPO_OPTIONS = [
  { value: 'cliente', label: 'Cliente' },
  { value: 'lead', label: 'Lead / Prospecto' },
]

export const RESULTADO_OPTIONS = [
  { value: 'realizada', label: 'Visita realizada' },
  { value: 'venta', label: 'Venta' },
  { value: 'no_contacto', label: 'No contacto' },
  { value: 'reagendar', label: 'Reagendar' },
  { value: 'no_interes', label: 'Sin interés' },
  { value: 'otro', label: 'Otro' },
]

export const PRODUCTOS_OPTIONS = [
  { value: 'purificador_aire', label: 'Purificador de aire' },
  { value: 'multipana', label: 'Multipana' },
  { value: 'filtro_agua', label: 'Filtro de agua' },
  { value: 'suavizador', label: 'Suavizador de agua' },
  { value: 'otro', label: 'Otro' },
]

export const TAREA_TIPO_OPTIONS = [
  { value: 'llamada', label: 'Llamada' },
  { value: 'visita', label: 'Visita' },
  { value: 'enviar_material', label: 'Enviar material' },
  { value: 'reagendar_cita', label: 'Reagendar cita' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'cobro', label: 'Cobro' },
  { value: 'otro', label: 'Otro' },
]

export const TAREA_PRIORIDAD_OPTIONS = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
]

export const TIMEZONE_OPTIONS = [
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'America/Denver', label: 'Denver (MT)' },
  { value: 'America/Chicago', label: 'Chicago (CT)' },
  { value: 'America/New_York', label: 'New York / Florida (ET)' },
  { value: 'America/Bogota', label: 'Bogota (COT)' },
  { value: 'America/Mexico_City', label: 'Ciudad de Mexico (CT)' },
]
