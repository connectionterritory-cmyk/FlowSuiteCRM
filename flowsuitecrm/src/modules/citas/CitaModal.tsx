import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'
import { useToast } from '../../components/Toast'
import { isMissingLeadAddressColumnError, LEADS_SEARCH_BASE_SELECT, LEADS_SEARCH_EXTENDED_SELECT } from '../../lib/leadsSchema'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { formatProperName, formatProperText, formatStateRegion } from '../../lib/textFormat'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { buildContactRef, getContactTable } from '../../lib/contactRefs'
import type { ContactKind } from '../../types/contacts'

type AssignedOption = {
  id: string
  label: string
}

export type CitaForm = {
  id?: string
  owner_id?: string
  start_at: string
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
  contacto_tipo: ContactKind
  contacto_id: string
  campaign_id?: string
  message_id?: string
  response_id?: string
  resultado?: string
  resultado_notas?: string
  next_action_date?: string
}

type CitaModalProps = {
  open: boolean
  onClose: () => void
  onSaved?: (citaId?: string) => void
  initialData?: Partial<CitaForm>
  assignedOptions?: AssignedOption[]
}

const emptyForm: CitaForm = {
  owner_id: '',
  start_at: '',
  tipo: 'servicio',
  estado: 'programada',
  notas: '',
  direccion: '',
  ciudad: '',
  estado_region: '',
  zip: '',
  apartamento: '',
  assigned_to: '',
  contacto_nombre: '',
  contacto_telefono: '',
  contacto_tipo: 'cliente',
  contacto_id: '',
  campaign_id: '',
  message_id: '',
  response_id: '',
  resultado: '',
  resultado_notas: '',
  next_action_date: '',
}

const ESTADO_OPTIONS = [
  { value: 'programada', label: 'Programada' },
  { value: 'confirmada', label: 'Confirmada' },
  { value: 'en_camino', label: 'En camino' },
  { value: 'completada', label: 'Completada' },
  { value: 'no_show', label: 'No show' },
  { value: 'cancelada', label: 'Cancelada' },
]

const TIPO_OPTIONS = [
  { value: 'servicio', label: 'Servicio' },
  { value: 'demo', label: 'Demo' },
  { value: 'cobranza', label: 'Cobranza' },
  { value: 'reclutamiento', label: 'Reclutamiento' },
  { value: 'otro', label: 'Otro' },
]

const CONTACTO_TIPO_OPTIONS = [
  { value: 'cliente', label: 'Cliente' },
  { value: 'lead', label: 'Lead / Prospecto' },
]

const RESULTADO_OPTIONS = [
  { value: 'realizada', label: 'Visita realizada' },
  { value: 'venta', label: 'Venta' },
  { value: 'no_contacto', label: 'No contacto' },
  { value: 'reagendar', label: 'Reagendar' },
  { value: 'no_interes', label: 'Sin interés' },
  { value: 'otro', label: 'Otro' },
]

const PRODUCTOS_OPTIONS = [
  { value: 'purificador_aire', label: 'Purificador de aire' },
  { value: 'multipana', label: 'Multipana' },
  { value: 'filtro_agua', label: 'Filtro de agua' },
  { value: 'suavizador', label: 'Suavizador de agua' },
  { value: 'otro', label: 'Otro' },
]

const TAREA_TIPO_OPTIONS = [
  { value: 'llamada', label: 'Llamada' },
  { value: 'visita', label: 'Visita' },
  { value: 'enviar_material', label: 'Enviar material' },
  { value: 'reagendar_cita', label: 'Reagendar cita' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'cobro', label: 'Cobro' },
  { value: 'otro', label: 'Otro' },
]

const TAREA_PRIORIDAD_OPTIONS = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
]

type CierreActividad = {
  resumen: string
  demo_realizada: boolean
  muestra_entregada: boolean
  referidos_obtenidos: boolean
  referidos_count: string
  productos_interes: string[]
}

type CierreTarea = {
  crear_tarea: boolean
  tipo: string
  descripcion: string
  asignado_a: string
  fecha_vencimiento: string
  hora_vencimiento: string
  prioridad: string
}

const emptyCierreActividad: CierreActividad = {
  resumen: '',
  demo_realizada: false,
  muestra_entregada: false,
  referidos_obtenidos: false,
  referidos_count: '',
  productos_interes: [],
}

const emptyCierreTarea: CierreTarea = {
  crear_tarea: false,
  tipo: 'llamada',
  descripcion: '',
  asignado_a: '',
  fecha_vencimiento: '',
  hora_vencimiento: '',
  prioridad: 'media',
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ContactSearchResult = {
  id: string
  tipo: ContactKind
  nombre: string
  telefono: string | null
  direccion?: string | null
  apartamento?: string | null
  ciudad?: string | null
  estado_region?: string | null
  zip?: string | null
}

type DirtySnapshot = {
  form: CitaForm
  cierreActividad: CierreActividad
  cierreTarea: CierreTarea
}

const toIso = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const buildDirtySnapshot = ({ form, cierreActividad, cierreTarea }: DirtySnapshot) => JSON.stringify({
  form,
  cierreActividad,
  cierreTarea,
})

export function CitaModal({ open, onClose, onSaved, initialData, assignedOptions = [] }: CitaModalProps) {
  const { showToast } = useToast()
  const { session } = useAuth()
  const { distributionUserIds, hasDistribuidorScope, viewMode } = useViewMode()
  const mountedRef = useRef(false)
  const userEditedRef = useRef(false)
  const [form, setForm] = useState<CitaForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>([])
  const [contactLoading, setContactLoading] = useState(false)
  const [showSearch, setShowSearch] = useState(true)
  const [role, setRole] = useState<string | null>(null)
  const [cierreActividad, setCierreActividad] = useState<CierreActividad>(emptyCierreActividad)
  const [cierreTarea, setCierreTarea] = useState<CierreTarea>(emptyCierreTarea)
  const [initialEstado, setInitialEstado] = useState('')
  const [initialSnapshot, setInitialSnapshot] = useState('')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const updateForm = (updater: CitaForm | ((prev: CitaForm) => CitaForm)) => {
    userEditedRef.current = true
    setForm((prev) => (typeof updater === 'function' ? (updater as (prev: CitaForm) => CitaForm)(prev) : updater))
  }

  const updateCierreActividad = (
    updater: CierreActividad | ((prev: CierreActividad) => CierreActividad),
  ) => {
    userEditedRef.current = true
    setCierreActividad((prev) => (
      typeof updater === 'function'
        ? (updater as (prev: CierreActividad) => CierreActividad)(prev)
        : updater
    ))
  }

  const updateCierreTarea = (updater: CierreTarea | ((prev: CierreTarea) => CierreTarea)) => {
    userEditedRef.current = true
    setCierreTarea((prev) => (
      typeof updater === 'function'
        ? (updater as (prev: CierreTarea) => CierreTarea)(prev)
        : updater
    ))
  }

  const currentSnapshot = useMemo(
    () => buildDirtySnapshot({ form, cierreActividad, cierreTarea }),
    [form, cierreActividad, cierreTarea],
  )

  const isDirty = useMemo(
    () => Boolean(open && initialSnapshot && currentSnapshot !== initialSnapshot),
    [currentSnapshot, initialSnapshot, open],
  )

  const isFollowUpTaskInvalid = useMemo(
    () => (
      form.estado === 'completada' &&
      cierreTarea.crear_tarea &&
      (!cierreTarea.tipo || !cierreTarea.asignado_a || !cierreTarea.fecha_vencimiento)
    ),
    [cierreTarea, form.estado],
  )

  const handleRequestClose = () => {
    if (saving) return
    if (isDirty && !window.confirm('Tienes cambios sin guardar. Si cierras ahora, los perderas.')) {
      return
    }
    onClose()
  }

  useEffect(() => {
    if (!open) return
    userEditedRef.current = false
    const next = { ...emptyForm, ...initialData }
    if (!next.assigned_to) {
      next.assigned_to = assignedOptions[0]?.id ?? ''
    }
    if (!next.owner_id) {
      next.owner_id = session?.user.id ?? ''
    }
    const nextCierreTarea = {
      ...emptyCierreTarea,
      asignado_a: next.assigned_to || session?.user.id || '',
    }
    setForm(next)
    setContactSearch(next.contacto_nombre || '')
    setContactResults([])
    setShowSearch(!Boolean(next.contacto_id))
    setInitialEstado(next.estado || '')
    setCierreActividad(emptyCierreActividad)
    setCierreTarea(nextCierreTarea)
    setInitialSnapshot(buildDirtySnapshot({
      form: next,
      cierreActividad: emptyCierreActividad,
      cierreTarea: nextCierreTarea,
    }))

    // If editing an existing cita, refresh address from the linked contact
    if (!next.contacto_id || !isSupabaseConfigured) return
    let active = true
    const table = next.contacto_tipo === 'lead' ? 'leads' : 'clientes'
    const addressSelect =
      next.contacto_tipo === 'lead'
        ? 'direccion, apartamento, ciudad, estado_region, codigo_postal'
        : 'direccion, ciudad, estado_region, codigo_postal'
    void supabase
      .from(table)
      .select(addressSelect)
      .eq('id', next.contacto_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return
        const row = data as {
          direccion?: string | null
          apartamento?: string | null
          ciudad?: string | null
          estado_region?: string | null
          codigo_postal?: string | null
        }
        const nextForm = {
          ...next,
          direccion: row.direccion ?? next.direccion,
          apartamento: row.apartamento ?? next.apartamento,
          ciudad: row.ciudad ?? next.ciudad,
          estado_region: row.estado_region ?? next.estado_region,
          zip: row.codigo_postal ?? next.zip,
        }
        setForm((prev) => ({
          ...prev,
          direccion: row.direccion ?? prev.direccion,
          apartamento: row.apartamento ?? prev.apartamento,
          ciudad: row.ciudad ?? prev.ciudad,
          estado_region: row.estado_region ?? prev.estado_region,
          zip: row.codigo_postal ?? prev.zip,
        }))
        if (!userEditedRef.current) {
          setInitialSnapshot(buildDirtySnapshot({
            form: nextForm,
            cierreActividad: emptyCierreActividad,
            cierreTarea: nextCierreTarea,
          }))
        }
      })
    return () => {
      active = false
    }
  }, [assignedOptions, initialData, open, session?.user.id])

  useEffect(() => {
    if (!open || !isSupabaseConfigured || !session?.user.id) {
      setRole(null)
      return
    }
    const loadRole = async () => {
      const { data } = await supabase
        .from('usuarios')
        .select('rol')
        .eq('id', session.user.id)
        .maybeSingle()
      setRole((data as { rol?: string } | null)?.rol ?? null)
    }
    void loadRole()
  }, [open, session?.user.id])

  const selectedContactLabel = useMemo(() => {
    if (!form.contacto_id) return ''
    const phone = form.contacto_telefono ? ` · ${form.contacto_telefono}` : ''
    return `${form.contacto_nombre || 'Contacto'}${phone}`
  }, [form.contacto_id, form.contacto_nombre, form.contacto_telefono])

  const scopeHint = useMemo(() => {
    if (role === 'distribuidor' && viewMode === 'seller') {
      return 'Estás en vista Vendedor. Si buscas contactos del equipo, cambia arriba a Distribuidor.'
    }
    return null
  }, [role, viewMode])

  useEffect(() => {
    if (!open) return
    const term = contactSearch.trim()
    if (!showSearch || term.length < 2) {
      setContactResults([])
      setContactLoading(false)
      return
    }
    let active = true
    const handle = setTimeout(async () => {
      setContactLoading(true)
      const searchValue = `%${term}%`
      if (form.contacto_tipo === 'cliente') {
        let query = supabase
          .from('clientes')
          .select('id, nombre, apellido, telefono, direccion, ciudad, estado_region, codigo_postal, vendedor_id, distribuidor_id')
          .or(`nombre.ilike.${searchValue},apellido.ilike.${searchValue},telefono.ilike.${searchValue}`)
          .limit(10)
        if (role && role !== 'admin' && role !== 'distribuidor' && role !== 'supervisor_telemercadeo' && role !== 'telemercadeo' && session?.user.id) {
          query = query.eq('vendedor_id', session.user.id)
        } else if (role === 'distribuidor' && viewMode === 'seller' && session?.user.id) {
          query = query.eq('vendedor_id', session.user.id)
        } else if (hasDistribuidorScope && distributionUserIds.length > 0 && role !== 'supervisor_telemercadeo') {
          query = query.in('vendedor_id', distributionUserIds)
        }
        const { data, error } = await query
        if (!active) return
        if (error) {
          setContactResults([])
        } else {
          const results = (data ?? []).map((row) => ({
            id: row.id,
            tipo: 'cliente' as const,
            nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Cliente',
            telefono: row.telefono ?? null,
            direccion: row.direccion ?? null,
            ciudad: row.ciudad ?? null,
            estado_region: row.estado_region ?? null,
            zip: row.codigo_postal ?? null,
          }))
          setContactResults(results)
        }
      } else {
        const buildLeadSearchQuery = (selectClause: string) => {
          let query = supabase
            .from('leads')
            .select(selectClause)
            .is('deleted_at', null)
            .or(`nombre.ilike.${searchValue},apellido.ilike.${searchValue},telefono.ilike.${searchValue}`)
            .limit(10)
          if (role && role !== 'admin' && role !== 'distribuidor' && role !== 'supervisor_telemercadeo' && role !== 'telemercadeo' && session?.user.id) {
            query = query.or(`vendedor_id.eq.${session.user.id},owner_id.eq.${session.user.id}`)
          } else if (role === 'distribuidor' && viewMode === 'seller' && session?.user.id) {
            query = query.or(`vendedor_id.eq.${session.user.id},owner_id.eq.${session.user.id}`)
          } else if (hasDistribuidorScope && distributionUserIds.length > 0 && role !== 'supervisor_telemercadeo') {
            query = query.in('vendedor_id', distributionUserIds)
          }
          return query
        }
        let { data, error } = await buildLeadSearchQuery(LEADS_SEARCH_EXTENDED_SELECT)
        if (error && isMissingLeadAddressColumnError(error.message)) {
          ;({ data, error } = await buildLeadSearchQuery(LEADS_SEARCH_BASE_SELECT))
        }
        if (!active) return
        if (error) {
          setContactResults([])
        } else {
          const results = ((data as Array<{
            id: string
            nombre: string | null
            apellido: string | null
            telefono: string | null
            direccion?: string | null
            apartamento?: string | null
            ciudad?: string | null
            estado_region?: string | null
            codigo_postal?: string | null
          }> | null) ?? []).map((row) => ({
            id: row.id,
            tipo: 'lead' as const,
            nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Lead',
            telefono: row.telefono ?? null,
            direccion: row.direccion ?? null,
            apartamento: row.apartamento ?? null,
            ciudad: row.ciudad ?? null,
            estado_region: row.estado_region ?? null,
            zip: row.codigo_postal ?? null,
          }))
          setContactResults(results)
        }
      }
      setContactLoading(false)
    }, 300)

    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [contactSearch, distributionUserIds, form.contacto_tipo, hasDistribuidorScope, open, role, session?.user.id, showSearch, viewMode])

  const handleSelectContact = (contact: ContactSearchResult) => {
    updateForm((prev) => ({
      ...prev,
      contacto_tipo: contact.tipo,
      contacto_id: contact.id,
      contacto_nombre: contact.nombre,
      contacto_telefono: contact.telefono ?? '',
      direccion: contact.direccion ?? prev.direccion,
      apartamento: contact.apartamento ?? prev.apartamento,
      ciudad: contact.ciudad ?? prev.ciudad,
      estado_region: contact.estado_region ?? prev.estado_region,
      zip: contact.zip ?? prev.zip,
    }))
    setContactSearch(contact.nombre)
    setContactResults([])
    setShowSearch(false)
  }

  const title = useMemo(() => (form.id ? 'Editar cita' : 'Nueva cita'), [form.id])

  const handleSave = async () => {
    if (!isSupabaseConfigured) {
      showToast('Configura Supabase para guardar cambios.', 'error')
      return
    }
    if (!form.start_at || !form.tipo) {
      showToast('Completa fecha y tipo.', 'error')
      return
    }
    if (!form.contacto_tipo || !['cliente', 'lead'].includes(form.contacto_tipo)) {
      showToast('Selecciona el tipo de contacto (cliente o lead).', 'error')
      return
    }
    if (!form.contacto_id.trim()) {
      showToast('El ID de contacto es obligatorio.', 'error')
      return
    }
    if (!UUID_REGEX.test(form.contacto_id.trim())) {
      showToast('El ID de contacto debe ser un UUID válido (ej: 550e8400-…).', 'error')
      return
    }
    if (form.estado === 'completada' && !form.resultado?.trim()) {
      showToast('Selecciona el resultado de la cita antes de marcarla como completada.', 'error')
      return
    }
    if (isFollowUpTaskInvalid) {
      showToast('Completa los campos obligatorios de la tarea de seguimiento.', 'error')
      return
    }
    const startIso = toIso(form.start_at)
    if (!startIso) {
      showToast('Fecha invalida.', 'error')
      return
    }
    const startDate = new Date(startIso)
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
    if (endDate.getTime() <= startDate.getTime()) {
      showToast('La hora de fin debe ser mayor a la de inicio.', 'error')
      return
    }
    setSaving(true)

    // owner_id is immutable after creation — only set on INSERT, never on UPDATE
    const basePayload = {
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      tipo: form.tipo.trim(),
      estado: form.estado.trim() || 'programada',
      notas: form.notas.trim() || null,
      direccion: form.direccion ? formatProperText(form.direccion) : null,
      ciudad: form.ciudad ? formatProperText(form.ciudad) : null,
      estado_region: form.estado_region ? formatStateRegion(form.estado_region) : null,
      zip: form.zip?.trim() || null,
      apartamento: form.apartamento?.trim() || null,
      assigned_to: form.assigned_to || null,
      nombre: form.contacto_nombre ? formatProperName(form.contacto_nombre) : null,
      telefono: form.contacto_telefono.trim() || null,
      contacto_tipo: form.contacto_tipo,
      contacto_id: form.contacto_id.trim(),
      campaign_id: form.campaign_id || null,
      message_id: form.message_id || null,
      response_id: form.response_id || null,
      resultado: form.resultado?.trim() || null,
      resultado_notas: form.resultado_notas?.trim() || null,
    }
    const request = form.id
      ? supabase.from('citas').update(basePayload).eq('id', form.id).select('id').maybeSingle()
      : supabase.from('citas').insert({ ...basePayload, owner_id: session?.user.id ?? '' }).select('id').maybeSingle()
    const { data: savedData, error } = await request
    if (!mountedRef.current) return
    if (error) {
      showToast(error.message, 'error')
      setSaving(false)
      return
    }
    showToast(form.id ? 'Cita actualizada' : 'Cita creada')
    const citaId = (savedData as { id?: string } | null)?.id ?? form.id
    const contactRef = buildContactRef(form.contacto_tipo, form.contacto_id)

    // ── Actividad histórica ──────────────────────────────────────────────
    // Insert only when transitioning to completada (not on re-edits)
    const isTransicionando = form.estado === 'completada' && initialEstado !== 'completada'
    if (isTransicionando && citaId && session?.user.id) {
      const metadata: Record<string, unknown> = { resultado: form.resultado }
      if (cierreActividad.demo_realizada) metadata.demo_realizada = true
      if (cierreActividad.muestra_entregada) metadata.muestra_entregada = true
      if (cierreActividad.referidos_obtenidos) {
        metadata.referidos_obtenidos = true
        if (cierreActividad.referidos_count) {
          metadata.referidos_count = Number(cierreActividad.referidos_count)
        }
      }
      if (cierreActividad.productos_interes.length > 0) {
        metadata.productos_interes = cierreActividad.productos_interes
      }
      const resumen =
        cierreActividad.resumen.trim() ||
        RESULTADO_OPTIONS.find((o) => o.value === form.resultado)?.label ||
        'Cita completada'
      // Unique index on (cita_id) where tipo='cita_completada' prevents duplicates
      const { error: actividadError } = await supabase.from('contacto_actividades').insert({
        contacto_tipo: form.contacto_tipo,
        contacto_id: form.contacto_id.trim(),
        tipo: 'cita_completada',
        resumen,
        contenido: form.resultado_notas?.trim() || null,
        autor_id: session.user.id,
        fecha_actividad: startDate.toISOString(),
        metadata,
        cita_id: citaId,
      })
      if (!mountedRef.current) return
      if (actividadError) {
        // Non-blocking: cita already saved; log for debugging
        console.warn('contacto_actividades insert failed:', actividadError.message)
      }
    }

    // ── Tarea de seguimiento ─────────────────────────────────────────────
    if (
      cierreTarea.crear_tarea &&
      cierreTarea.tipo &&
      cierreTarea.asignado_a &&
      cierreTarea.fecha_vencimiento &&
      session?.user.id
    ) {
      const { error: tareaError } = await supabase.from('crm_tareas').insert({
        contacto_tipo: form.contacto_tipo,
        contacto_id: form.contacto_id.trim(),
        tipo: cierreTarea.tipo,
        descripcion: cierreTarea.descripcion.trim() || null,
        asignado_a: cierreTarea.asignado_a,
        created_by: session.user.id,
        fecha_vencimiento: cierreTarea.fecha_vencimiento,
        hora_vencimiento: cierreTarea.hora_vencimiento || null,
        prioridad: cierreTarea.prioridad,
        cita_origen_id: citaId || null,
      })
      if (!mountedRef.current) return
      if (tareaError) {
        showToast('Tarea no guardada: ' + tareaError.message, 'error')
      } else if (contactRef) {
        // Update next_action cache on contact for HoyPage compatibility
        const contactTable = getContactTable(contactRef.contacto_tipo)
        await supabase
          .from(contactTable)
          .update({
            next_action:
              TAREA_TIPO_OPTIONS.find((o) => o.value === cierreTarea.tipo)?.label ?? 'Seguimiento',
            next_action_date: cierreTarea.fecha_vencimiento,
          })
          .eq('id', contactRef.contacto_id)
        if (!mountedRef.current) return
      }
    }

    // Set next action on contact when result requires follow-up (existing behavior)
    if (
      (form.resultado === 'reagendar' || form.estado === 'no_show') &&
      contactRef &&
      form.next_action_date &&
      !cierreTarea.crear_tarea  // skip if tarea already handled next_action
    ) {
      const contactTable = getContactTable(contactRef.contacto_tipo)
      await supabase.from(contactTable).update({
        next_action: 'Reagendar cita',
        next_action_date: form.next_action_date,
      }).eq('id', contactRef.contacto_id)
      if (!mountedRef.current) return
    }

    // Sync address to contact only if contact has no address yet (never overwrite existing)
    const citaDireccion = basePayload.direccion
    if (citaDireccion && contactRef) {
      const table = getContactTable(contactRef.contacto_tipo)
      const { data: contactData } = await supabase
        .from(table)
        .select('direccion')
        .eq('id', contactRef.contacto_id)
        .maybeSingle()
      if (!mountedRef.current) return
      if ((contactData as { direccion?: string | null } | null)?.direccion == null) {
        await supabase.from(table).update({
          direccion: citaDireccion,
          ciudad: basePayload.ciudad ?? null,
          estado_region: basePayload.estado_region ?? null,
          codigo_postal: basePayload.zip ?? null,
        }).eq('id', contactRef.contacto_id)
        if (!mountedRef.current) return
      }
    }

    setInitialSnapshot(buildDirtySnapshot({ form, cierreActividad, cierreTarea }))
    setSaving(false)
    onSaved?.(citaId)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={handleRequestClose}
      actions={
        <>
          <Button variant="ghost" type="button" onClick={handleRequestClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !form.start_at || !form.tipo || isFollowUpTaskInvalid}>
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <label className="form-field">
          <span>Fecha y hora</span>
          <input
            type="datetime-local"
            value={form.start_at}
            onChange={(event) => updateForm((prev) => ({ ...prev, start_at: event.target.value }))}
          />
        </label>
        <label className="form-field">
          <span>Tipo</span>
          <select
            value={form.tipo}
            onChange={(event) => updateForm((prev) => ({ ...prev, tipo: event.target.value }))}
          >
            {TIPO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Estado</span>
          <select
            value={form.estado}
            onChange={(event) => updateForm((prev) => ({ ...prev, estado: event.target.value }))}
          >
            {ESTADO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {form.estado === 'completada' && (
          <>
            <label className="form-field">
              <span>Resultado <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span></span>
              <select
                value={form.resultado ?? ''}
                onChange={(event) => updateForm((prev) => ({ ...prev, resultado: event.target.value }))}
              >
                <option value="">Selecciona un resultado…</option>
                {RESULTADO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Notas del resultado</span>
              <textarea
                rows={3}
                value={form.resultado_notas ?? ''}
                onChange={(event) => updateForm((prev) => ({ ...prev, resultado_notas: event.target.value }))}
                placeholder="Detalle del resultado"
              />
            </label>

            {/* ── Resumen corto para el timeline ── */}
            <label className="form-field" style={{ gridColumn: 'span 2' }}>
              <span>Resumen de la visita</span>
              <input
                value={cierreActividad.resumen}
                onChange={(e) => updateCierreActividad((prev) => ({ ...prev, resumen: e.target.value }))}
                placeholder="Ej: Demo realizada, 20 referidos, interés en purificador"
              />
            </label>

            {/* ── Checkboxes: qué pasó ── */}
            <div className="form-field" style={{ gridColumn: 'span 2' }}>
              <span>¿Qué pasó en la visita?</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem' }}>
                {(
                  [
                    { key: 'demo_realizada', label: 'Demo realizada' },
                    { key: 'muestra_entregada', label: 'Muestra entregada' },
                    { key: 'referidos_obtenidos', label: 'Referidos obtenidos' },
                  ] as const
                ).map(({ key, label }) => (
                  <label
                    key={key}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={cierreActividad[key]}
                      onChange={(e) =>
                        updateCierreActividad((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
                {cierreActividad.referidos_obtenidos && (
                  <input
                    type="number"
                    min="0"
                    max="999"
                    value={cierreActividad.referidos_count}
                    onChange={(e) =>
                      updateCierreActividad((prev) => ({ ...prev, referidos_count: e.target.value }))
                    }
                    placeholder="Cantidad"
                    style={{ width: 90 }}
                  />
                )}
              </div>
            </div>

            {/* ── Productos de interés (solo si demo) ── */}
            {cierreActividad.demo_realizada && (
              <div className="form-field" style={{ gridColumn: 'span 2' }}>
                <span>Productos de interés</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem' }}>
                  {PRODUCTOS_OPTIONS.map((producto) => (
                    <label
                      key={producto.value}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
                    >
                      <input
                      type="checkbox"
                      checked={cierreActividad.productos_interes.includes(producto.value)}
                      onChange={(e) =>
                        updateCierreActividad((prev) => ({
                          ...prev,
                          productos_interes: e.target.checked
                            ? [...prev.productos_interes, producto.value]
                              : prev.productos_interes.filter((p) => p !== producto.value),
                          }))
                        }
                      />
                      {producto.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* ── Tarea de seguimiento ── */}
            <div
              className="form-field"
              style={{
                gridColumn: 'span 2',
                borderTop: '1px solid var(--color-border, #374151)',
                paddingTop: '0.75rem',
              }}
            >
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 500 }}
              >
                <input
                  type="checkbox"
                  checked={cierreTarea.crear_tarea}
                  onChange={(e) =>
                    updateCierreTarea((prev) => ({ ...prev, crear_tarea: e.target.checked }))
                  }
                />
                Crear tarea de seguimiento
              </label>
              {cierreTarea.crear_tarea && isFollowUpTaskInvalid && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    color: 'var(--color-error, #dc2626)',
                    fontSize: '0.875rem',
                  }}
                >
                  Completa tipo, asignado y fecha para crear la tarea.
                </div>
              )}
            </div>

            {cierreTarea.crear_tarea && (
              <>
                <label className="form-field">
                  <span>Tipo de tarea</span>
                  <select
                    value={cierreTarea.tipo}
                    onChange={(e) => updateCierreTarea((prev) => ({ ...prev, tipo: e.target.value }))}
                  >
                    {TAREA_TIPO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Asignar a</span>
                  <select
                    value={cierreTarea.asignado_a}
                    onChange={(e) =>
                      updateCierreTarea((prev) => ({ ...prev, asignado_a: e.target.value }))
                    }
                  >
                    {assignedOptions.length === 0 && <option value="">Sin opciones</option>}
                    {assignedOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>
                    Fecha <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span>
                  </span>
                  <input
                    type="date"
                    value={cierreTarea.fecha_vencimiento}
                    onChange={(e) =>
                      updateCierreTarea((prev) => ({ ...prev, fecha_vencimiento: e.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Hora (opcional)</span>
                  <input
                    type="time"
                    value={cierreTarea.hora_vencimiento}
                    onChange={(e) =>
                      updateCierreTarea((prev) => ({ ...prev, hora_vencimiento: e.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Prioridad</span>
                  <select
                    value={cierreTarea.prioridad}
                    onChange={(e) =>
                      updateCierreTarea((prev) => ({ ...prev, prioridad: e.target.value }))
                    }
                  >
                    {TAREA_PRIORIDAD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Descripción</span>
                  <input
                    value={cierreTarea.descripcion}
                    onChange={(e) =>
                      updateCierreTarea((prev) => ({ ...prev, descripcion: e.target.value }))
                    }
                    placeholder="Ej: Enviar videos de purificador y multipana"
                  />
                </label>
              </>
            )}
          </>
        )}
        {(form.resultado === 'reagendar' || form.estado === 'no_show') && (
          <label className="form-field">
            <span>
              Fecha del próximo paso <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span>
            </span>
            <input
              type="date"
              value={form.next_action_date ?? ''}
              onChange={(event) => updateForm((prev) => ({ ...prev, next_action_date: event.target.value }))}
            />
            <div className="form-hint">Se asignará "Reagendar cita" como próxima acción en el contacto.</div>
          </label>
        )}
        {/* CONTACTO — obligatorio, ligado a cliente o lead real */}
        <div className="form-field">
          <span>Tipo de contacto</span>
          <select
            value={form.contacto_tipo}
            onChange={(event) => {
              const nextTipo = event.target.value as ContactKind
              updateForm((prev) => ({
                ...prev,
                contacto_tipo: nextTipo,
                contacto_id: '',
                contacto_nombre: '',
                contacto_telefono: '',
              }))
              setContactSearch('')
              setContactResults([])
              setShowSearch(true)
            }}
          >
            {CONTACTO_TIPO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="form-hint">
            {form.contacto_tipo === 'cliente'
              ? '¿Buscas un prospecto? Cambia a Lead / Prospecto'
              : '¿Buscas un cliente convertido? Cambia a Cliente'}
          </div>
          {scopeHint && <div className="form-hint">{scopeHint}</div>}
        </div>
        <div className="form-field">
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span>Contacto</span>
            {!showSearch && form.contacto_id ? (
              <div className="card" style={{ padding: '0.5rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <span>{selectedContactLabel}</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowSearch(true)
                    setContactSearch('')
                    setContactResults([])
                  }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <>
                <input
                  value={contactSearch}
                  onChange={(event) => setContactSearch(event.target.value)}
                  onBlur={() => {
                    setTimeout(() => {
                      if (form.contacto_id) {
                        setShowSearch(false)
                        setContactSearch(form.contacto_nombre)
                        setContactResults([])
                      }
                    }, 150)
                  }}
                  placeholder={form.contacto_tipo === 'lead' ? 'Buscar prospecto por nombre o teléfono' : 'Buscar cliente por nombre o teléfono'}
                />
                {contactLoading && <div className="form-hint">Buscando...</div>}
                {!contactLoading && contactSearch.trim().length >= 2 && contactResults.length === 0 && (
                  <div className="form-hint">
                    Sin resultados.{' '}
                    {form.contacto_tipo === 'cliente'
                      ? 'Si buscas un prospecto, cambia el tipo a Lead / Prospecto.'
                      : 'Si buscas un cliente convertido, cambia el tipo a Cliente.'}
                    {scopeHint ? ` ${scopeHint}` : ''}
                  </div>
                )}
                {contactResults.length > 0 && (
                  <div className="card" style={{ marginTop: '0.5rem', maxHeight: 220, overflow: 'auto' }}>
                    {contactResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className="list-row"
                        onClick={() => handleSelectContact(result)}
                        style={{ width: '100%', textAlign: 'left' }}
                      >
                        <strong>{result.nombre}</strong>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)' }}>
                          {result.telefono || 'Sin telefono'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>
        </div>
        <label className="form-field">
          <span>Asignado a</span>
          <select
            value={form.assigned_to}
            onChange={(event) => updateForm((prev) => ({ ...prev, assigned_to: event.target.value }))}
            disabled={assignedOptions.length <= 1}
          >
            {assignedOptions.length === 0 && <option value="">Sin asignar</option>}
            {assignedOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Dirección</span>
          <input
            value={form.direccion}
            onChange={(event) => updateForm((prev) => ({ ...prev, direccion: event.target.value }))}
            placeholder="Calle y número"
          />
        </label>
        <label className="form-field">
          <span>Apt / Suite</span>
          <input
            value={form.apartamento ?? ''}
            onChange={(event) => updateForm((prev) => ({ ...prev, apartamento: event.target.value }))}
            placeholder="Apt, suite, unidad…"
          />
        </label>
        <label className="form-field">
          <span>Ciudad</span>
          <input
            value={form.ciudad ?? ''}
            onChange={(event) => updateForm((prev) => ({ ...prev, ciudad: event.target.value }))}
            placeholder="Ciudad"
          />
        </label>
        <label className="form-field">
          <span>Estado / Región</span>
          <input
            value={form.estado_region ?? ''}
            onChange={(event) => updateForm((prev) => ({ ...prev, estado_region: event.target.value }))}
            placeholder="Estado"
          />
        </label>
        <label className="form-field">
          <span>ZIP / Código postal</span>
          <input
            value={form.zip ?? ''}
            onChange={(event) => updateForm((prev) => ({ ...prev, zip: event.target.value }))}
            placeholder="12345"
          />
        </label>
        <label className="form-field">
          <span>Notas</span>
          <textarea
            rows={3}
            value={form.notas}
            onChange={(event) => updateForm((prev) => ({ ...prev, notas: event.target.value }))}
            placeholder="Notas internas o indicaciones"
          />
        </label>
      </div>
    </Modal>
  )
}
