import { startTransition, type ClipboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase/client'
import { isMissingLeadAddressColumnError } from '../lib/leadsSchema'
import { ContactoTimeline } from './ContactoTimeline'
import { useToast } from './useToast'
import { saveGestion } from './gestionUtils'
import { useAuth } from '../auth/useAuth'
import { IconRestore, IconSwap, IconTrash } from './icons'
import { parseUsAddress, buildMapsNavUrl, capitalizeProperName, type ParsedAddress } from '../lib/addressUtils'
import { useModalHost } from '../modals/useModalHost'
import { NearbyContactsPanel, type NearbyContact, type NearbyPanelState } from './NearbyContactsPanel'
import { CILlamadasPanel } from '../modules/conexiones-infinitas/CILlamadasPanel'

type LeadCalificacion = {
  id: string
  nombre?: string | null
  apellido?: string | null
  email?: string | null
  telefono?: string | null
  direccion?: string | null
  apartamento?: string | null
  ciudad?: string | null
  estado_region?: string | null
  codigo_postal?: string | null
  fecha_nacimiento?: string | null
  fuente?: string | null
  referidor_tipo?: 'cliente' | 'lead' | 'embajador' | null
  referidor_id?: string | null
  embajador_id?: string | null
  referido_por_cliente_id?: string | null
  owner_id?: string | null
  vendedor_id?: string | null
  next_action?: string | null
  estado_civil?: string | null
  nombre_conyuge?: string | null
  telefono_conyuge?: string | null
  situacion_laboral?: string | null
  ninos_en_casa?: boolean | null
  cantidad_ninos?: number | null
  tiene_productos_rp?: boolean | null
  tipo_vivienda?: string | null
  deleted_at?: string | null
  deleted_reason?: string | null
  persona_id?: string | null
}

type CalificacionPanelProps = {
  open: boolean
  lead: LeadCalificacion | null
  ownerName?: string | null
  fuenteLabel?: string | null
  recomendadoPor?: string | null
  canManage?: boolean
  focusAddress?: boolean
  onOpenManage?: (lead: LeadCalificacion, mode: 'delete' | 'reassign' | 'restore') => void
  onEditLead?: () => void
  onVerPerfil?: () => void
  onAgendarCita?: () => void
  onClose: () => void
  onSaved: () => Promise<void>
}

type LeadContextState = {
  loading: boolean
  origenPrincipal: string
  referidoPor: string | null
  vendedor: string | null
  conexiones: {
    linked: boolean
    resumen: string | null
  }
  programa4en14: {
    linked: boolean
    resumen: string | null
  }
  referidos: {
    total: number
    items: {
      id: string
      nombre: string
      telefono: string | null
      origen: 'Conexiones' | '4 en 14'
      estado: string | null
      leadId: string | null
      programaLabel?: string | null
    }[]
  }
}

type LeadDetailTab = 'resumen' | 'referidos' | 'programas' | 'historial' | 'llamadas'

const initialForm = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  direccion: '',
  apartamento: '',
  ciudad: '',
  estado_region: '',
  codigo_postal: '',
  fecha_nacimiento: '',
  estado_civil: '',
  nombre_conyuge: '',
  telefono_conyuge: '',
  situacion_laboral: '',
  ninos_en_casa: 'no',
  cantidad_ninos: '',
  tiene_productos_rp: 'no',
  tipo_vivienda: '',
}

function buildInitialFormValues(lead: LeadCalificacion | null) {
  if (!lead) return initialForm

  let nombre = lead.nombre ?? ''
  let apellido = lead.apellido ?? ''
  if (!apellido && nombre.trim().includes(' ')) {
    const parts = nombre.trim().split(/\s+/)
    nombre = parts.shift() ?? nombre
    apellido = parts.join(' ')
  }

  return {
    nombre,
    apellido,
    email: lead.email ?? '',
    telefono: lead.telefono ?? '',
    direccion: lead.direccion ?? '',
    apartamento: lead.apartamento ?? '',
    ciudad: lead.ciudad ?? '',
    estado_region: lead.estado_region ?? '',
    codigo_postal: lead.codigo_postal ?? '',
    fecha_nacimiento: lead.fecha_nacimiento ?? '',
    estado_civil: lead.estado_civil ?? '',
    nombre_conyuge: lead.nombre_conyuge ?? '',
    telefono_conyuge: lead.telefono_conyuge ?? '',
    situacion_laboral: lead.situacion_laboral ?? '',
    ninos_en_casa: lead.ninos_en_casa ? 'si' : 'no',
    cantidad_ninos: lead.cantidad_ninos ? String(lead.cantidad_ninos) : '',
    tiene_productos_rp: lead.tiene_productos_rp ? 'si' : 'no',
    tipo_vivienda: lead.tipo_vivienda ?? '',
  }
}

function buildInitialContextState({
  ownerName,
  lead,
  fuenteLabel,
  recomendadoPor,
}: {
  ownerName?: string | null
  lead: LeadCalificacion
  fuenteLabel?: string | null
  recomendadoPor?: string | null
}): LeadContextState {
  return {
    loading: true,
    origenPrincipal: fuenteLabel ?? lead.fuente ?? 'Lead directo',
    referidoPor: recomendadoPor?.trim() || null,
    vendedor: ownerName ?? lead.vendedor_id ?? lead.owner_id ?? null,
    conexiones: { linked: false, resumen: null },
    programa4en14: { linked: false, resumen: null },
    referidos: { total: 0, items: [] },
  }
}

export function CalificacionPanel({
  open,
  lead,
  ownerName,
  fuenteLabel,
  recomendadoPor,
  canManage = false,
  focusAddress = false,
  onOpenManage,
  onEditLead,
  onVerPerfil,
  onAgendarCita,
  onClose,
  onSaved,
}: CalificacionPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { showToast } = useToast()
  const { openGestionModal, openCitaModal } = useModalHost()
  const [formValues, setFormValues] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [parsedAddr, setParsedAddr] = useState<ParsedAddress | null>(null)
  const addressBannerRef = useRef<HTMLDivElement>(null)

  // Scroll the address section into view when opening with missing geo data
  useEffect(() => {
    if (!open || !focusAddress) return
    const timer = setTimeout(() => {
      addressBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 300)
    return () => clearTimeout(timer)
  }, [open, focusAddress])
  const [activeTab, setActiveTab] = useState<LeadDetailTab>('resumen')
  const [nearbyPanel, setNearbyPanel] = useState<NearbyPanelState | null>(null)
  const handleSelectNearbyContact = (contact: NearbyContact) => {
    setNearbyPanel(null)
    if (contact.tipo === 'lead') {
      navigate(`/leads?leadId=${encodeURIComponent(contact.id)}`)
      return
    }
    navigate(`/clientes?clienteId=${encodeURIComponent(contact.id)}`)
  }
  const [context, setContext] = useState<LeadContextState>({
    loading: false,
    origenPrincipal: '-',
    referidoPor: null,
    vendedor: null,
    conexiones: { linked: false, resumen: null },
    programa4en14: { linked: false, resumen: null },
    referidos: { total: 0, items: [] },
  })

  useEffect(() => {
    if (!lead) return
    startTransition(() => {
      setFormValues(buildInitialFormValues(lead))
      setShowActions(false)
      setParsedAddr(null)
      setActiveTab('resumen')
    })
  }, [lead])

  useEffect(() => {
    if (!open || !lead) return

    let active = true
    const vendedorLabel = ownerName ?? lead.vendedor_id ?? lead.owner_id ?? null
    const fallbackOrigen = fuenteLabel ?? lead.fuente ?? 'Lead directo'
    const initialReferidoPor = recomendadoPor?.trim() || null

    startTransition(() => {
      setContext(buildInitialContextState({ ownerName, lead, fuenteLabel, recomendadoPor }))
    })

    const loadContext = async () => {
      const [conexionesRes, programaReferidosRes] = await Promise.all([
        supabase
          .from('ci_referidos')
          .select('id, activacion_id, estado')
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('programa_4en14_referidos')
          .select('id, programa_id, estado_presentacion, fecha_demo')
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      if (!active) return

      const conexionesRows = (conexionesRes.data as { activacion_id?: string | null; estado?: string | null }[] | null) ?? []
      const programaReferidosRows =
        (programaReferidosRes.data as { programa_id?: string | null; estado_presentacion?: string | null; fecha_demo?: string | null }[] | null) ?? []

      const [ownedActivacionesRes, ownedProgramasRes] = await Promise.all([
        supabase
          .from('ci_activaciones')
          .select('id')
          .eq('lead_id', lead.id),
        supabase
          .from('programa_4en14')
          .select('id, ciclo_numero')
          .eq('propietario_tipo', 'lead')
          .eq('propietario_id', lead.id),
      ])

      if (!active) return

      const ownedActivacionIds = (
        (ownedActivacionesRes.data as { id: string }[] | null) ?? []
      ).map((row) => row.id)
      let ownedProgramas = (ownedProgramasRes.data as { id: string; ciclo_numero?: number | null }[] | null) ?? []

      if (ownedActivacionIds.length === 0 || ownedProgramas.length === 0) {
        const duplicateLeadIds = new Set<string>()
        if (lead.telefono?.trim()) {
          const { data: duplicateByPhone } = await supabase
            .from('leads')
            .select('id')
            .eq('telefono', lead.telefono.trim())
            .is('deleted_at', null)
          ;((duplicateByPhone as { id: string }[] | null) ?? []).forEach((row) => duplicateLeadIds.add(row.id))
        }
        if (lead.nombre?.trim() && lead.apellido?.trim()) {
          const { data: duplicateByName } = await supabase
            .from('leads')
            .select('id')
            .eq('nombre', lead.nombre.trim())
            .eq('apellido', lead.apellido.trim())
            .is('deleted_at', null)
          ;((duplicateByName as { id: string }[] | null) ?? []).forEach((row) => duplicateLeadIds.add(row.id))
        }

        duplicateLeadIds.delete(lead.id)

        if (duplicateLeadIds.size > 0) {
          const alternateLeadIds = [...duplicateLeadIds]
          const [altActivacionesRes, altProgramasRes] = await Promise.all([
            ownedActivacionIds.length === 0
              ? supabase
                  .from('ci_activaciones')
                  .select('id')
                  .in('lead_id', alternateLeadIds)
              : Promise.resolve({ data: [] }),
            ownedProgramas.length === 0
              ? supabase
                  .from('programa_4en14')
                  .select('id, ciclo_numero')
                  .eq('propietario_tipo', 'lead')
                  .in('propietario_id', alternateLeadIds)
              : Promise.resolve({ data: [] }),
          ])

          if (!active) return

          const altActivacionIds = ((altActivacionesRes.data as { id: string }[] | null) ?? []).map((row) => row.id)
          const altProgramas = (altProgramasRes.data as { id: string; ciclo_numero?: number | null }[] | null) ?? []

          if (ownedActivacionIds.length === 0) ownedActivacionIds.push(...altActivacionIds)
          if (ownedProgramas.length === 0) ownedProgramas = altProgramas
        }
      }

      const ownedProgramaIds = ownedProgramas.map((row) => row.id)

      const [generatedCiReferidosRes, generatedCiReferidosCountRes, generated4en14ReferidosRes, generated4en14ReferidosCountRes] = await Promise.all([
        ownedActivacionIds.length > 0
          ? supabase
              .from('ci_referidos')
              .select('id, nombre, telefono, estado, lead_id, created_at')
              .in('activacion_id', ownedActivacionIds)
              .order('created_at', { ascending: false })
              .limit(5)
          : Promise.resolve({ data: [] }),
        ownedActivacionIds.length > 0
          ? supabase
              .from('ci_referidos')
              .select('id', { count: 'exact', head: true })
              .in('activacion_id', ownedActivacionIds)
          : Promise.resolve({ count: 0 }),
        ownedProgramaIds.length > 0
          ? supabase
              .from('programa_4en14_referidos')
              .select('id, nombre, telefono, estado_presentacion, lead_id, programa_id, created_at')
              .in('programa_id', ownedProgramaIds)
              .order('created_at', { ascending: false })
              .limit(5)
          : Promise.resolve({ data: [] }),
        ownedProgramaIds.length > 0
          ? supabase
              .from('programa_4en14_referidos')
              .select('id', { count: 'exact', head: true })
              .in('programa_id', ownedProgramaIds)
          : Promise.resolve({ count: 0 }),
      ])

      if (!active) return

      const generatedCiReferidos =
        (generatedCiReferidosRes.data as {
          id: string
          nombre?: string | null
          telefono?: string | null
          estado?: string | null
          lead_id?: string | null
        }[] | null) ?? []
      const generatedCiReferidosCount = generatedCiReferidosCountRes.count ?? generatedCiReferidos.length
      const generated4en14Referidos =
        (generated4en14ReferidosRes.data as {
          id: string
          nombre?: string | null
          telefono?: string | null
          estado_presentacion?: string | null
          lead_id?: string | null
          programa_id?: string | null
        }[] | null) ?? []
      const generated4en14ReferidosCount = generated4en14ReferidosCountRes.count ?? generated4en14Referidos.length

      const programaLabelById = new Map(
        ownedProgramas.map((row) => [row.id, row.ciclo_numero ? `Ciclo ${row.ciclo_numero}` : 'Programa activo']),
      )

      const referidosItems = [
        ...generatedCiReferidos.map((row) => ({
          id: `ci-${row.id}`,
          nombre: row.nombre?.trim() || 'Referido sin nombre',
          telefono: row.telefono ?? null,
          origen: 'Conexiones' as const,
          estado: row.estado ?? null,
          leadId: row.lead_id ?? null,
          programaLabel: null,
        })),
        ...generated4en14Referidos.map((row) => ({
          id: `4en14-${row.id}`,
          nombre: row.nombre?.trim() || 'Referido sin nombre',
          telefono: row.telefono ?? null,
          origen: '4 en 14' as const,
          estado: row.estado_presentacion ?? null,
          leadId: row.lead_id ?? null,
          programaLabel: row.programa_id ? (programaLabelById.get(row.programa_id) ?? 'Programa activo') : null,
        })),
      ]

      let conexionesResumen: string | null = null
      let conexionesReferidoPor = initialReferidoPor

      if (conexionesRows.length > 0) {
        const activacionIds = [...new Set(conexionesRows.map((row) => row.activacion_id).filter((value): value is string => Boolean(value)))]
        const latest = conexionesRows[0]
        if (activacionIds.length > 0) {
          const { data: activaciones } = await supabase
            .from('ci_activaciones')
            .select('id, vendedor_id, cliente_id, lead_id, estado')
            .in('id', activacionIds)

          if (!active) return

          const activacion = ((activaciones as {
            id: string
            vendedor_id?: string | null
            cliente_id?: string | null
            lead_id?: string | null
            estado?: string | null
          }[] | null) ?? [])[0]

          if (activacion) {
            const lookups: PromiseLike<{ kind: 'usuario' | 'cliente' | 'lead'; name: string | null }>[] = []
            if (activacion.vendedor_id) {
              lookups.push(
                supabase
                  .from('usuarios')
                  .select('nombre, apellido')
                  .eq('id', activacion.vendedor_id)
                  .maybeSingle()
                  .then(({ data }) => ({
                    kind: 'usuario' as const,
                    name: [data?.nombre, data?.apellido].filter(Boolean).join(' ').trim() || null,
                  })),
              )
            }
            if (activacion.cliente_id) {
              lookups.push(
                supabase
                  .from('clientes')
                  .select('nombre, apellido')
                  .eq('id', activacion.cliente_id)
                  .maybeSingle()
                  .then(({ data }) => ({
                    kind: 'cliente' as const,
                    name: [data?.nombre, data?.apellido].filter(Boolean).join(' ').trim() || null,
                  })),
              )
            } else if (activacion.lead_id) {
              lookups.push(
                supabase
                  .from('leads')
                  .select('nombre, apellido')
                  .eq('id', activacion.lead_id)
                  .maybeSingle()
                  .then(({ data }) => ({
                    kind: 'lead' as const,
                    name: [data?.nombre, data?.apellido].filter(Boolean).join(' ').trim() || null,
                  })),
              )
            }

            const lookupResults = await Promise.all(lookups)
            if (!active) return

            const representante = lookupResults.find((row) => row.kind === 'usuario')?.name ?? null
            const owner =
              lookupResults.find((row) => row.kind === 'cliente')?.name ??
              lookupResults.find((row) => row.kind === 'lead')?.name ??
              null

            conexionesResumen = [
              `Estado ${latest.estado ?? activacion.estado ?? 'pendiente'}`,
              representante ? `Vendedor ${representante}` : null,
            ].filter(Boolean).join(' · ')

            if (!conexionesReferidoPor && owner) conexionesReferidoPor = owner
          }
        }
      }

      let programaResumen: string | null = null
      if (programaReferidosRows.length > 0) {
        const programaIds = [...new Set(programaReferidosRows.map((row) => row.programa_id).filter((value): value is string => Boolean(value)))]
        if (programaIds.length > 0) {
          const { data: programas } = await supabase
            .from('programa_4en14')
            .select('id, propietario_tipo, propietario_id, vendedor_id, ciclo_numero, estado')
            .in('id', programaIds)

          if (!active) return

          const programa = ((programas as {
            id: string
            propietario_tipo?: string | null
            propietario_id?: string | null
            vendedor_id?: string | null
            ciclo_numero?: number | null
            estado?: string | null
          }[] | null) ?? [])[0]

          if (programa) {
            let vendedorPrograma: string | null = null
            let ownerPrograma: string | null = null

            const lookups: PromiseLike<{ kind: 'vendedor' | 'owner'; name: string | null }>[] = []
            if (programa.vendedor_id) {
              lookups.push(
                supabase
                  .from('usuarios')
                  .select('nombre, apellido')
                  .eq('id', programa.vendedor_id)
                  .maybeSingle()
                  .then(({ data }) => ({
                    kind: 'vendedor' as const,
                    name: [data?.nombre, data?.apellido].filter(Boolean).join(' ').trim() || null,
                  })),
              )
            }
            if (programa.propietario_id) {
              if (programa.propietario_tipo === 'cliente') {
                lookups.push(
                  supabase
                    .from('clientes')
                    .select('nombre, apellido')
                    .eq('id', programa.propietario_id)
                    .maybeSingle()
                    .then(({ data }) => ({
                      kind: 'owner' as const,
                      name: [data?.nombre, data?.apellido].filter(Boolean).join(' ').trim() || null,
                    })),
                )
              } else if (programa.propietario_tipo === 'lead') {
                lookups.push(
                  supabase
                    .from('leads')
                    .select('nombre, apellido')
                    .eq('id', programa.propietario_id)
                    .maybeSingle()
                    .then(({ data }) => ({
                      kind: 'owner' as const,
                      name: [data?.nombre, data?.apellido].filter(Boolean).join(' ').trim() || null,
                    })),
                )
              } else if (programa.propietario_tipo === 'embajador') {
                lookups.push(
                  supabase
                    .from('embajadores')
                    .select('nombre, apellido')
                    .eq('id', programa.propietario_id)
                    .maybeSingle()
                    .then(({ data }) => ({
                      kind: 'owner' as const,
                      name: [data?.nombre, data?.apellido].filter(Boolean).join(' ').trim() || null,
                    })),
                )
              }
            }

            const lookupResults = await Promise.all(lookups)
            if (!active) return

            vendedorPrograma = lookupResults.find((row) => row.kind === 'vendedor')?.name ?? null
            ownerPrograma = lookupResults.find((row) => row.kind === 'owner')?.name ?? null

            programaResumen = [
              programa.ciclo_numero ? `Ciclo ${programa.ciclo_numero}` : 'Programa activo',
              programaReferidosRows[0]?.estado_presentacion
                ? `Estado ${programaReferidosRows[0].estado_presentacion}`
                : programa.estado
                  ? `Estado ${programa.estado}`
                  : null,
              ownerPrograma ? `Referido por ${ownerPrograma}` : null,
              vendedorPrograma ? `Vendedor ${vendedorPrograma}` : null,
            ].filter(Boolean).join(' · ')
          }
        }
      }

      const nextOrigenPrincipal =
        conexionesRows.length > 0
          ? 'Conexiones'
          : programaReferidosRows.length > 0
            ? '4 en 14'
            : fallbackOrigen

      const conexionesLinked = conexionesRows.length > 0 || ownedActivacionIds.length > 0 || generatedCiReferidosCount > 0
      const programaLinked = programaReferidosRows.length > 0 || ownedProgramaIds.length > 0 || generated4en14ReferidosCount > 0

      if (!conexionesResumen && conexionesLinked) {
        conexionesResumen = generatedCiReferidosCount > 0
          ? `${generatedCiReferidosCount} referidos en la lista`
          : 'Participando'
      }

      if (!programaResumen && programaLinked) {
        programaResumen = generated4en14ReferidosCount > 0
          ? `${generated4en14ReferidosCount} referidos en el ciclo`
          : ownedProgramas[0]?.ciclo_numero
            ? `Ciclo ${ownedProgramas[0].ciclo_numero}`
            : 'Participando'
      }

      setContext({
        loading: false,
        origenPrincipal: nextOrigenPrincipal,
        referidoPor: conexionesReferidoPor,
        vendedor: vendedorLabel,
        conexiones: {
          linked: conexionesLinked,
          resumen: conexionesResumen,
        },
        programa4en14: {
          linked: programaLinked,
          resumen: programaResumen,
        },
        referidos: {
          total: ownedActivacionIds.length + ownedProgramaIds.length > 0
            ? generatedCiReferidosCount + generated4en14ReferidosCount
            : 0,
          items: referidosItems,
        },
      })
    }

    void loadContext()

    return () => {
      active = false
    }
  }, [open, lead, ownerName, fuenteLabel, recomendadoPor])

  const fullName = useMemo(() => {
    if (!lead) return '-'
    return [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
  }, [lead])
  const programCount = Number(context.conexiones.linked) + Number(context.programa4en14.linked)

  const isDeleted = Boolean(lead?.deleted_at)

  if (!open || !lead) return null

  const handleChange = (field: keyof typeof initialForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value
      setFormValues((prev) => ({
        ...prev,
        [field]: value,
      }))
    }

  const handleCapitalize = (field: 'nombre' | 'apellido') => () => {
    setFormValues((prev) => ({ ...prev, [field]: capitalizeProperName(prev[field] as string) }))
  }

  const handleDireccionPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text')
    const parsed = parseUsAddress(pasted)
    if (parsed) {
      event.preventDefault()
      setFormValues((prev) => ({
        ...prev,
        direccion: parsed.direccion,
        ciudad: parsed.ciudad,
        estado_region: parsed.estado_region,
        codigo_postal: parsed.codigo_postal,
      }))
      setParsedAddr(parsed)
    }
  }

  const handleSave = async () => {
    if (!lead) return
    setSaving(true)
    setError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const isCasado = formValues.estado_civil === 'casado'
    const hasKids = formValues.ninos_en_casa === 'si'
    const payload: Record<string, unknown> = {
      nombre: toNull(formValues.nombre),
      apellido: toNull(formValues.apellido),
      email: toNull(formValues.email),
      telefono: toNull(formValues.telefono),
      direccion: toNull(formValues.direccion),
      apartamento: toNull(formValues.apartamento),
      ciudad: toNull(formValues.ciudad),
      estado_region: toNull(formValues.estado_region),
      codigo_postal: toNull(formValues.codigo_postal),
      estado_civil: formValues.estado_civil || null,
      nombre_conyuge: isCasado ? toNull(formValues.nombre_conyuge) : null,
      telefono_conyuge: isCasado ? toNull(formValues.telefono_conyuge) : null,
      situacion_laboral: formValues.situacion_laboral || null,
      ninos_en_casa: hasKids,
      cantidad_ninos: hasKids ? Number(formValues.cantidad_ninos) || null : null,
      tiene_productos_rp: formValues.tiene_productos_rp === 'si',
      tipo_vivienda: formValues.tipo_vivienda || null,
    }

    if (lead.fecha_nacimiento !== undefined) payload.fecha_nacimiento = formValues.fecha_nacimiento || null

    let { error: updateError } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', lead.id)

    if (updateError && isMissingLeadAddressColumnError(updateError.message)) {
      const fallbackPayload = {
        nombre: payload.nombre,
        apellido: payload.apellido,
        email: payload.email,
        telefono: payload.telefono,
        estado_civil: payload.estado_civil,
        nombre_conyuge: payload.nombre_conyuge,
        telefono_conyuge: payload.telefono_conyuge,
        situacion_laboral: payload.situacion_laboral,
        ninos_en_casa: payload.ninos_en_casa,
        cantidad_ninos: payload.cantidad_ninos,
        tiene_productos_rp: payload.tiene_productos_rp,
        tipo_vivienda: payload.tipo_vivienda,
        ...(lead.fecha_nacimiento !== undefined ? { fecha_nacimiento: payload.fecha_nacimiento } : {}),
      }
      ;({ error: updateError } = await supabase
        .from('leads')
        .update(fallbackPayload)
        .eq('id', lead.id))
    }

    if (updateError) {
      setError(updateError.message)
      showToast(updateError.message, 'error')
    } else {
      await onSaved()
      showToast(t('toast.success'))
      setShowActions(true)
    }
    setSaving(false)
  }

  const handleQuickAction = (action: 'schedule' | 'add4en14' | 'done') => {
    setShowActions(false)
    if (action === 'done') {
      onClose()
    }
  }

  const leadNavigationState = {
    fromLead: {
      id: lead.id,
      nombre: fullName,
      telefono: lead.telefono ?? null,
      email: lead.email ?? null,
      fuente: fuenteLabel ?? lead.fuente ?? null,
    },
  }

  return (
    <>
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calificacion-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h3 id="calificacion-title" style={{ margin: 0 }}>{t('leads.calificacion.title')}</h3>
              {lead.persona_id && onVerPerfil && (
                <button type="button" className="btn ghost" onClick={onVerPerfil}>
                  Ver perfil
                </button>
              )}
              {onEditLead && (
                <button type="button" className="btn ghost" onClick={onEditLead}>
                  Editar perfil
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  openCitaModal({
                    initialData: {
                      contacto_tipo: 'lead',
                      contacto_id: lead.id,
                      contacto_nombre: fullName,
                      contacto_telefono: lead.telefono ?? '',
                    },
                  })
                }
              >
                Agendar cita
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  openGestionModal({
                    contacto: {
                      tipo: 'lead',
                      id: lead.id,
                      nombre: fullName,
                      telefono: lead.telefono ?? null,
                      email: lead.email ?? null,
                      subtitle: `${fuenteLabel ?? lead.fuente ?? 'Lead'} · piloto`,
                    },
                    moduloOrigen: 'leads',
                    origenId: lead.id,
                    onSubmit: async (draft) => {
                      if (!session?.user) return
                      try {
                        await saveGestion(draft, session.user.id)
                        showToast(`Gestión registrada: ${draft.resumen || draft.tipo}`)
                      } catch (err: any) {
                        showToast(`Error: ${err.message}`, 'error')
                      }
                    },
                  })
                }
              >
                + Gestión
              </button>
              {onAgendarCita && !isDeleted && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onAgendarCita}
                >
                  📅 + Cita
                </button>
              )}
            </div>
            <p className="drawer-subtitle">{fullName}</p>
            {(fuenteLabel || ownerName || lead.next_action) && (
              <p className="drawer-subtitle calificacion-meta">
                {(fuenteLabel ?? lead.fuente ?? '-')}
                {' · '}
                {(ownerName ?? lead.owner_id ?? '-')}
                {' · '}
                {(lead.next_action ?? '-')}
              </p>
            )}
            {isDeleted && (
              <p className="drawer-subtitle" style={{ color: '#b91c1c', fontWeight: 600 }}>
                Eliminado: {lead.deleted_reason ?? '-'}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {canManage && onOpenManage && !isDeleted && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onOpenManage(lead, 'reassign')}
                  aria-label="Reasignar"
                  title="Reasignar"
                >
                  <IconSwap />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onOpenManage(lead, 'delete')}
                  aria-label="Eliminar"
                  title="Eliminar"
                >
                  <IconTrash />
                </button>
              </>
            )}
            {canManage && onOpenManage && isDeleted && (
              <button
                type="button"
                className="icon-button"
                onClick={() => onOpenManage(lead, 'restore')}
                aria-label="Restaurar"
                title="Restaurar"
              >
                <IconRestore />
              </button>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              x
            </button>
          </div>
        </header>

        <div className="drawer-body">
          <div className="drawer-section">
            <h4>Contexto</h4>
            <div className="form-grid">
              <div className="form-field">
                <span>Origen principal</span>
                <strong>{context.loading ? 'Cargando...' : context.origenPrincipal || '-'}</strong>
              </div>
              <div className="form-field">
                <span>Vendedor</span>
                <strong>{context.loading ? 'Cargando...' : context.vendedor || '-'}</strong>
              </div>
              <div className="form-field">
                <span>Referido por</span>
                <strong>{context.loading ? 'Cargando...' : context.referidoPor || 'Sin referencia directa'}</strong>
              </div>
              <div className="form-field">
                <span>Fuente base</span>
                <strong>{fuenteLabel ?? lead.fuente ?? '-'}</strong>
              </div>
            </div>
          </div>

          <div className="drawer-section" style={{ paddingTop: 0 }}>
            <div className="template-tabs" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
              {[
                { key: 'resumen', label: 'Resumen' },
                { key: 'referidos', label: `Referidos (${context.referidos.total})` },
                { key: 'programas', label: `Programas (${programCount})` },
                { key: 'historial', label: 'Historial' },
                { key: 'llamadas', label: '📞 Llamadas' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`template-tab ${activeTab === tab.key ? 'active' : ''}`.trim()}
                  onClick={() => setActiveTab(tab.key as LeadDetailTab)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'resumen' && (
            <>
          <div className="drawer-section">
            <h4>{t('leads.calificacion.generalTitle')}</h4>
            <div className="form-grid">
              <label className="form-field">
                <span>{t('leads.fields.nombre')}</span>
                <input value={formValues.nombre} onChange={handleChange('nombre')} onBlur={handleCapitalize('nombre')} />
              </label>
              <label className="form-field">
                <span>{t('leads.fields.apellido')}</span>
                <input value={formValues.apellido} onChange={handleChange('apellido')} onBlur={handleCapitalize('apellido')} />
              </label>
              <label className="form-field">
                <span>{t('leads.fields.email')}</span>
                <input type="email" value={formValues.email} onChange={handleChange('email')} />
              </label>
              <label className="form-field">
                <span>{t('leads.fields.telefono')}</span>
                <input value={formValues.telefono} onChange={handleChange('telefono')} />
              </label>
              {focusAddress && (!formValues.ciudad || !formValues.codigo_postal) && (
                <div
                  ref={addressBannerRef}
                  style={{
                    gridColumn: '1 / -1',
                    padding: '0.6rem 0.9rem',
                    background: '#fef3c7',
                    border: '1px solid #fcd34d',
                    borderRadius: '0.375rem',
                    fontSize: '0.82rem',
                    color: '#92400e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  ⚠ Completa ciudad y ZIP para validar la zona antes de gestionar
                </div>
              )}
              <label className="form-field">
                <span>{t('leads.calificacion.general.direccion')}</span>
                <input
                  value={formValues.direccion}
                  onChange={handleChange('direccion')}
                  onPaste={handleDireccionPaste}
                  placeholder="Pega la dirección completa para auto-rellenar"
                />
              </label>
              {parsedAddr && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    padding: '0.5rem 0.75rem',
                    background: '#d1fae5',
                    border: '1px solid #6ee7b7',
                    borderRadius: '0.375rem',
                    fontSize: '0.82rem',
                    color: '#065f46',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  ✓ Dirección detectada — ciudad, estado y ZIP rellenados automáticamente
                </div>
              )}
              <label className="form-field">
                <span>{t('leads.calificacion.general.apartamento')}</span>
                <input value={formValues.apartamento} onChange={handleChange('apartamento')} />
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.general.ciudad')}</span>
                <input value={formValues.ciudad} onChange={handleChange('ciudad')} />
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.general.estadoRegion')}</span>
                <input value={formValues.estado_region} onChange={handleChange('estado_region')} />
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.general.codigoPostal')}</span>
                <input value={formValues.codigo_postal} onChange={handleChange('codigo_postal')} />
              </label>
              {(formValues.direccion || formValues.ciudad) && (() => {
                const mapsUrl = buildMapsNavUrl({
                  direccion: formValues.direccion || null,
                  ciudad: formValues.ciudad || null,
                  estado_region: formValues.estado_region || null,
                  codigo_postal: formValues.codigo_postal || null,
                })
                return mapsUrl ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <button
                      type="button"
                      onClick={() => setNearbyPanel({
                        contactoNombre: [formValues.nombre, formValues.apellido].filter(Boolean).join(' ') || 'Prospecto',
                        mapsUrl,
                        zip: formValues.codigo_postal || null,
                        ciudad: formValues.ciudad || null,
                        baseId: lead.id,
                        baseTipo: 'lead',
                      })}
                      style={{
                        fontSize: '0.82rem',
                        color: '#10b981',
                        fontWeight: 700,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        padding: '0.25rem 0.75rem',
                        border: '1px solid #10b98133',
                        borderRadius: '9999px',
                        background: '#10b98111',
                        cursor: 'pointer',
                      }}
                    >
                      🗺 Ver en mapa / Navegar
                    </button>
                  </div>
                ) : null
              })()}
              <label className="form-field">
                <span>{t('leads.calificacion.general.fechaNacimiento')}</span>
                <input
                  type="date"
                  value={formValues.fecha_nacimiento}
                  onChange={handleChange('fecha_nacimiento')}
                />
              </label>
            </div>
          </div>

          <div className="drawer-section">
            <h4>{t('leads.calificacion.ventaTitle')}</h4>
            <div className="form-grid">
              <label className="form-field">
                <span>{t('leads.calificacion.estadoCivil')}</span>
                <select value={formValues.estado_civil} onChange={handleChange('estado_civil')}>
                  <option value="">{t('common.select')}</option>
                  <option value="soltero">{t('leads.calificacion.estados.soltero')}</option>
                  <option value="casado">{t('leads.calificacion.estados.casado')}</option>
                  <option value="viudo">{t('leads.calificacion.estados.viudo')}</option>
                  <option value="divorciado">{t('leads.calificacion.estados.divorciado')}</option>
                </select>
              </label>
              {formValues.estado_civil === 'casado' && (
                <>
                  <label className="form-field">
                    <span>{t('leads.calificacion.nombreConyuge')}</span>
                    <input value={formValues.nombre_conyuge} onChange={handleChange('nombre_conyuge')} />
                  </label>
                  <label className="form-field">
                    <span>{t('leads.calificacion.telefonoConyuge')}</span>
                    <input value={formValues.telefono_conyuge} onChange={handleChange('telefono_conyuge')} />
                  </label>
                </>
              )}
              <label className="form-field">
                <span>{t('leads.calificacion.situacionLaboral')}</span>
                <select value={formValues.situacion_laboral} onChange={handleChange('situacion_laboral')}>
                  <option value="">{t('common.select')}</option>
                  <option value="solo">{t('leads.calificacion.laboral.solo')}</option>
                  <option value="ambos">{t('leads.calificacion.laboral.ambos')}</option>
                  <option value="ninguno">{t('leads.calificacion.laboral.ninguno')}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.ninosCasa')}</span>
                <select value={formValues.ninos_en_casa} onChange={handleChange('ninos_en_casa')}>
                  <option value="no">{t('common.no')}</option>
                  <option value="si">{t('common.yes')}</option>
                </select>
              </label>
              {formValues.ninos_en_casa === 'si' && (
                <label className="form-field">
                  <span>{t('leads.calificacion.cantidadNinos')}</span>
                  <input type="number" value={formValues.cantidad_ninos} onChange={handleChange('cantidad_ninos')} />
                </label>
              )}
              <label className="form-field">
                <span>{t('leads.calificacion.productosRp')}</span>
                <select value={formValues.tiene_productos_rp} onChange={handleChange('tiene_productos_rp')}>
                  <option value="no">{t('common.no')}</option>
                  <option value="si">{t('common.yes')}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.vivienda')}</span>
                <select value={formValues.tipo_vivienda} onChange={handleChange('tipo_vivienda')}>
                  <option value="">{t('common.select')}</option>
                  <option value="duenos">{t('leads.calificacion.viviendaOptions.duenos')}</option>
                  <option value="rentan">{t('leads.calificacion.viviendaOptions.rentan')}</option>
                </select>
              </label>
            </div>
            {error && <div className="form-error">{error}</div>}
          </div>
            </>
          )}

          {activeTab === 'referidos' && (
          <div className="drawer-section">
            <h4>Referidos</h4>
            {context.loading ? (
              <p className="drawer-subtitle">Cargando referidos...</p>
            ) : context.referidos.total === 0 ? (
              <p className="drawer-subtitle">Este lead todavía no tiene referidos visibles en Conexiones o 4 en 14.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <p className="drawer-subtitle" style={{ margin: 0 }}>
                  {context.referidos.total} referido{context.referidos.total === 1 ? '' : 's'} visible{context.referidos.total === 1 ? '' : 's'} desde este lead.
                </p>
                {context.referidos.items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      border: '1px solid var(--border-color, #243244)',
                      background: 'rgba(15, 23, 42, 0.35)',
                      borderRadius: '0.85rem',
                      padding: '0.85rem 1rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 18rem' }}>
                      <div style={{ fontWeight: 700 }}>{item.nombre}</div>
                      <div className="drawer-subtitle" style={{ marginTop: '0.15rem' }}>
                        {item.origen}
                        {item.programaLabel ? ` · ${item.programaLabel}` : ''}
                        {item.estado ? ` · ${item.estado}` : ''}
                        {item.telefono ? ` · ${item.telefono}` : ''}
                      </div>
                    </div>
                    {item.leadId ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          openGestionModal({
                            contacto: {
                              tipo: 'lead',
                              id: item.leadId!,
                              nombre: item.nombre,
                              telefono: item.telefono,
                              email: null,
                              subtitle: `${item.origen}${item.programaLabel ? ` · ${item.programaLabel}` : ''}`,
                            },
                            moduloOrigen: 'leads',
                            origenId: lead.id,
                            onSubmit: async (draft) => {
                              if (!session?.user) return
                              try {
                                await saveGestion(draft, session.user.id)
                                showToast(`Gestión registrada: ${draft.resumen || draft.tipo}`)
                              } catch (err: any) {
                                showToast(`Error: ${err.message}`, 'error')
                              }
                            },
                          })
                        }
                      >
                        + Gestión
                      </button>
                    ) : (
                      <span className="drawer-subtitle" style={{ margin: 0 }}>
                        Sin lead vinculado
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {activeTab === 'programas' && (
          <div className="drawer-section">
            <h4>Programas</h4>
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              <div
                style={{
                  border: '1px solid var(--border-color, #243244)',
                  background: 'rgba(15, 23, 42, 0.35)',
                  borderRadius: '0.85rem',
                  padding: '0.9rem 1rem',
                  display: 'grid',
                  gap: '0.5rem',
                }}
              >
                <div style={{ fontWeight: 700 }}>Conexiones</div>
                <div className="drawer-subtitle" style={{ margin: 0 }}>
                  {context.loading
                    ? 'Cargando...'
                    : context.conexiones.linked
                      ? context.conexiones.resumen ?? 'Participando'
                      : 'Aún no participa en Conexiones.'}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => navigate('/conexiones-infinitas', { state: leadNavigationState })}
                  >
                    {context.conexiones.linked ? 'Abrir programa' : 'Iniciar en Conexiones'}
                  </button>
                </div>
              </div>
              <div
                style={{
                  border: '1px solid var(--border-color, #243244)',
                  background: 'rgba(15, 23, 42, 0.35)',
                  borderRadius: '0.85rem',
                  padding: '0.9rem 1rem',
                  display: 'grid',
                  gap: '0.5rem',
                }}
              >
                <div style={{ fontWeight: 700 }}>4 en 14</div>
                <div className="drawer-subtitle" style={{ margin: 0 }}>
                  {context.loading
                    ? 'Cargando...'
                    : context.programa4en14.linked
                      ? context.programa4en14.resumen ?? 'Participando'
                      : 'Aún no participa en 4 en 14.'}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => navigate('/4en14', { state: leadNavigationState })}
                  >
                    {context.programa4en14.linked ? 'Abrir programa' : 'Iniciar en 4 en 14'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          )}

          {activeTab === 'historial' && (
          <div className="drawer-section">
            <h4>Historial</h4>
            <ContactoTimeline contactoTipo="lead" contactoId={lead.id} emptyLabel="Sin historial de actividades para este prospecto" />
          </div>
          )}

          {activeTab === 'llamadas' && (
          <div className="drawer-section">
            <CILlamadasPanel
              clienteId={null}
              leadId={lead.id}
              ownerName={fullName}
            />
          </div>
          )}

          {showActions && (
            <div className="drawer-section">
              <div className="calificacion-next-actions">
                <span className="calificacion-next-title">{t('leads.calificacion.actions.title')}</span>
                <div className="calificacion-next-buttons">
                  <button type="button" className="btn ghost" onClick={() => handleQuickAction('schedule')}>
                    {t('leads.calificacion.actions.schedule')}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => handleQuickAction('add4en14')}>
                    {t('leads.calificacion.actions.add4en14')}
                  </button>
                  <button type="button" className="btn primary" onClick={() => handleQuickAction('done')}>
                    {t('leads.calificacion.actions.done')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('leads.calificacion.saveAll')}
          </button>
        </div>
      </aside>
    </div>

    {nearbyPanel && (
      <NearbyContactsPanel {...nearbyPanel} onClose={() => setNearbyPanel(null)} onSelectContact={handleSelectNearbyContact} />
    )}
    </>
  )
}
