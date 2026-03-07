import { type ChangeEvent, type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { StatCard } from '../../components/StatCard'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { Badge } from '../../components/Badge'
import { useToast } from '../../components/Toast'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { IconMail, IconSms, IconWhatsapp } from '../../components/icons'
import { useAuth } from '../../auth/AuthProvider'
import { useUsers } from '../../data/UsersProvider'
import { useMessaging } from '../../hooks/useMessaging'
import { CitaModal, type CitaForm } from '../citas/CitaModal'

type CycleRecord = {
  id: string
  propietario_tipo: string | null
  propietario_id: string | null
  vendedor_id: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  meta_presentaciones: number | null
  ciclo_numero: number | null
  estado: string | null
  regalo_producto_id?: string | null
  regalo_entregado?: boolean | null
  fecha_regalo?: string | null
}

type ReferidoRecord = {
  id: string
  programa_id: string | null
  nombre: string | null
  telefono: string | null
  estado_presentacion: string | null
  created_at: string | null
  lead_id?: string | null
  prioridad_top?: boolean | null
  notas_adicionales?: string | null
  fecha_demo?: string | null
  cita_id?: string | null
}

type ReferralRow = {
  nombre: string
  telefono: string
  email: string
}

type OwnerOption = {
  id: string
  nombre: string | null
  apellido: string | null
}

type LeadRecord = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  email: string | null
  estado_civil?: string | null
  situacion_laboral?: string | null
  ninos_en_casa: boolean | null
  tiene_credito?: boolean | null
  tiene_productos_rp: boolean | null
  tipo_vivienda: string | null
}

type UsuarioOption = {
  id: string
  nombre: string | null
  apellido: string | null
}

type ProductoOption = {
  id: string
  nombre: string
  categoria: string | null
}

const initialForm = {
  owner_type: 'cliente',
  owner_id: '',
  fecha_inicio: '',
  fecha_fin: '',
  meta_presentaciones: '4',
  ciclo_numero: '1',
  regalo_producto_id: '',
}

const initialCalificacionForm = {
  pareja_doble_ingreso: false,
  ninos_en_casa: false,
  tiene_credito: false,
  tiene_productos_rp: false,
  casa_propia: false,
  prioridad_top: false,
  notas_adicionales: '',
  estado_presentacion: 'pendiente',
}

const buildReferralRows = (count = 3) =>
  Array.from({ length: count }, () => ({ nombre: '', telefono: '', email: '' }))

const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const stripPhone = (value: string) => value.replace(/\D/g, '')

export function Programa4en14Page() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const { usersById } = useUsers()
  const { showToast } = useToast()
  const { openWhatsapp, openSms, openEmail, ModalRenderer } = useMessaging()
  const { metrics, loading } = useDashboardMetrics()
  const [cycles, setCycles] = useState<CycleRecord[]>([])
  const [referidos, setReferidos] = useState<ReferidoRecord[]>([])
  const [clientes, setClientes] = useState<OwnerOption[]>([])
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [embajadores, setEmbajadores] = useState<OwnerOption[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioOption[]>([])
  const [productos, setProductos] = useState<ProductoOption[]>([])
  const [hasCreditField, setHasCreditField] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [giftSubmittingId, setGiftSubmittingId] = useState<string | null>(null)
  const [expandedCycles, setExpandedCycles] = useState<Set<string>>(new Set())
  const [calificacionOpen, setCalificacionOpen] = useState(false)
  const [calificacionReferido, setCalificacionReferido] = useState<ReferidoRecord | null>(null)
  const [calificacionForm, setCalificacionForm] = useState(initialCalificacionForm)
  const [calificacionSubmitting, setCalificacionSubmitting] = useState(false)
  const [calificacionError, setCalificacionError] = useState<string | null>(null)
  const [referralOpen, setReferralOpen] = useState(false)
  const [referralProgramId, setReferralProgramId] = useState<string | null>(null)
  const [referralRows, setReferralRows] = useState<ReferralRow[]>(buildReferralRows())
  const [referralSubmitting, setReferralSubmitting] = useState(false)
  const [referralError, setReferralError] = useState<string | null>(null)
  const configured = isSupabaseConfigured
  const [citaOpen, setCitaOpen] = useState(false)
  const [citaInitial, setCitaInitial] = useState<Partial<CitaForm>>({})
  const [citaReferidoId, setCitaReferidoId] = useState<string | null>(null)
  const demoInitializedRef = useRef(false)
  const demoQualifiedSeenRef = useRef<Set<string>>(new Set())
  const referralNameRefs = useRef<Array<HTMLInputElement | null>>([])

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  )

  const handleAgendarCita4en14 = (ref: ReferidoRecord) => {
    if (!ref.lead_id) return
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    setCitaInitial({
      owner_id: session?.user.id ?? '',
      start_at: local.toISOString().slice(0, 16),
      tipo: 'demo',
      estado: 'programada',
      assigned_to: session?.user.id ?? '',
      contacto_tipo: 'lead',
      contacto_id: ref.lead_id,
      contacto_nombre: ref.nombre ?? '',
      contacto_telefono: ref.telefono ?? '',
    })
    setCitaReferidoId(ref.id)
    setCitaOpen(true)
  }

  const handleCitaSaved4en14 = async (citaId?: string) => {
    setCitaOpen(false)
    if (!citaId || !citaReferidoId || !configured) return
    await supabase
      .from('programa_4en14_referidos')
      .update({ cita_id: citaId })
      .eq('id', citaReferidoId)
    setCitaReferidoId(null)
    void loadData()
  }

  const loadData = useCallback(async () => {
    if (!configured) return
    setLoadingData(true)
    setError(null)
    const leadSelectBase =
      'id, nombre, apellido, telefono, email, estado_civil, situacion_laboral, ninos_en_casa, tiene_productos_rp, tipo_vivienda'
    const leadSelectWithCredit = `${leadSelectBase}, tiene_credito`
    const leadsPromise = supabase.from('leads').select(leadSelectWithCredit).is('deleted_at', null)
    const [
      cyclesResult,
      referidosResult,
      clientesResult,
      embajadoresResult,
      usuariosResult,
      productosResult,
      leadsResultWithCredit,
    ] = await Promise.all([
      supabase
        .from('programa_4en14')
        .select(
          'id, propietario_tipo, propietario_id, vendedor_id, fecha_inicio, fecha_fin, meta_presentaciones, ciclo_numero, estado, regalo_producto_id, regalo_entregado, fecha_regalo'
        ),
      supabase
        .from('programa_4en14_referidos')
        .select(
          'id, programa_id, nombre, telefono, estado_presentacion, created_at, lead_id, prioridad_top, notas_adicionales, fecha_demo, cita_id'
        ),
      supabase.from('clientes').select('id, nombre, apellido'),
      supabase.from('embajadores').select('id, nombre, apellido'),
      supabase.from('usuarios').select('id, nombre, apellido'),
      supabase.from('productos').select('id, nombre, categoria').eq('activo', true).order('nombre'),
      leadsPromise,
    ])

    let leadsResult = leadsResultWithCredit
    let creditAvailable = true
    if (leadsResult.error && leadsResult.error.message?.includes('tiene_credito')) {
      creditAvailable = false
      leadsResult = (await supabase
        .from('leads')
        .select(leadSelectBase)
        .is('deleted_at', null)) as typeof leadsResultWithCredit
    }

    if (
      cyclesResult.error ||
      referidosResult.error ||
      clientesResult.error ||
      embajadoresResult.error ||
      usuariosResult.error
      || productosResult.error
      || leadsResult.error
    ) {
      setError(
        cyclesResult.error?.message ||
          referidosResult.error?.message ||
          clientesResult.error?.message ||
          embajadoresResult.error?.message ||
          usuariosResult.error?.message ||
          productosResult.error?.message ||
          leadsResult.error?.message ||
          t('common.noData')
      )
    }

    setCycles((cyclesResult.data as CycleRecord[]) ?? [])
    setReferidos((referidosResult.data as ReferidoRecord[]) ?? [])
    setClientes((clientesResult.data as OwnerOption[]) ?? [])
    setLeads((leadsResult.data as LeadRecord[]) ?? [])
    setHasCreditField(creditAvailable && !leadsResult.error)
    setEmbajadores((embajadoresResult.data as OwnerOption[]) ?? [])
    setUsuarios((usuariosResult.data as UsuarioOption[]) ?? [])
    setProductos((productosResult.data as ProductoOption[]) ?? [])
    setLoadingData(false)
  }, [configured, t])

  useEffect(() => {
    if (configured) {
      loadData()
    }
  }, [configured, loadData])

  useEffect(() => {
    const qualified = referidos.filter(
      (referido) => referido.estado_presentacion === 'demo_calificada' && referido.id
    )
    if (!demoInitializedRef.current) {
      demoQualifiedSeenRef.current = new Set(qualified.map((referido) => referido.id))
      demoInitializedRef.current = true
      return
    }
    const newQualified = qualified.find((referido) => !demoQualifiedSeenRef.current.has(referido.id))
    if (!newQualified) return
    demoQualifiedSeenRef.current.add(newQualified.id)
    if (newQualified.programa_id) {
      openReferralModal(newQualified.programa_id)
    }
  }, [referidos])

  const calcEndDate = useCallback((start: string) => {
    if (!start) return ''
    const date = new Date(`${start}T00:00:00`)
    date.setDate(date.getDate() + 14)
    return date.toISOString().slice(0, 10)
  }, [])

  const formatDate = useCallback((value: string | null | undefined) => {
    if (!value) return ''
    const date = value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00`)
    if (Number.isNaN(date.getTime())) return value
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = String(date.getFullYear())
    return `${day}/${month}/${year}`
  }, [])

  const handleOpenForm = () => {
    setFormValues({
      ...initialForm,
      fecha_inicio: '',
      fecha_fin: '',
    })
    setFormError(null)
    setFormOpen(true)
  }

  const openReferralModal = useCallback((programId: string) => {
    setReferralProgramId(programId)
    setReferralRows(buildReferralRows())
    setReferralError(null)
    setReferralOpen(true)
  }, [])

  const toggleCycleExpanded = useCallback((cycleId: string) => {
    setExpandedCycles((prev) => {
      const next = new Set(prev)
      if (next.has(cycleId)) {
        next.delete(cycleId)
      } else {
        next.add(cycleId)
      }
      return next
    })
  }, [])

  const handleChange = (field: keyof typeof initialForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value
      if (field === 'owner_type') {
        setFormValues((prev) => ({ ...prev, owner_type: value, owner_id: '' }))
        return
      }
      if (field === 'fecha_inicio') {
        const endDate = calcEndDate(value)
        setFormValues((prev) => ({ ...prev, fecha_inicio: value, fecha_fin: endDate }))
        return
      }
      setFormValues((prev) => ({ ...prev, [field]: value }))
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const vendedorId = session?.user.id ?? null
    const payload = {
      propietario_tipo: formValues.owner_type,
      propietario_id: toNull(formValues.owner_id),
      vendedor_id: vendedorId,
      fecha_inicio: formValues.fecha_inicio || null,
      fecha_fin: formValues.fecha_fin || null,
      meta_presentaciones: Number(formValues.meta_presentaciones) || 4,
      ciclo_numero: Number(formValues.ciclo_numero) || 1,
      estado: 'activo',
      regalo_producto_id: toNull(formValues.regalo_producto_id),
    }

    const { error: insertError } = await supabase.from('programa_4en14').insert(payload)

    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      setFormOpen(false)
      await loadData()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const ownerOptions = useMemo(() => {
    if (formValues.owner_type === 'cliente') return clientes
    if (formValues.owner_type === 'lead') return leads
    if (formValues.owner_type === 'embajador') return embajadores
    if (formValues.owner_type === 'vendedor') return usuarios
    return []
  }, [clientes, embajadores, formValues.owner_type, leads, usuarios])

  const ownerMap = useMemo(() => {
    const buildMap = (list: OwnerOption[]) => {
      const map = new Map<string, string>()
      list.forEach((item) => {
        const name = [item.nombre, item.apellido].filter(Boolean).join(' ') || item.id
        map.set(item.id, name)
      })
      return map
    }
    return {
      cliente: buildMap(clientes),
      lead: buildMap(leads),
      embajador: buildMap(embajadores),
      vendedor: buildMap(usuarios),
      usuario: buildMap(usuarios),
    }
  }, [clientes, embajadores, leads, usuarios])

  const leadMap = useMemo(() => {
    const map = new Map<string, LeadRecord>()
    leads.forEach((lead) => {
      map.set(lead.id, lead)
    })
    return map
  }, [leads])

  const leadByPhone = useMemo(() => {
    const map = new Map<string, LeadRecord>()
    leads.forEach((lead) => {
      const phone = lead.telefono ? stripPhone(lead.telefono) : ''
      if (phone) {
        map.set(phone, lead)
      }
    })
    return map
  }, [leads])

  const productoMap = useMemo(() => {
    const map = new Map<string, string>()
    productos.forEach((producto) => {
      map.set(producto.id, producto.nombre)
    })
    return map
  }, [productos])

  const productosPorCategoria = useMemo(() => {
    const grouped = new Map<string, ProductoOption[]>()
    productos.forEach((producto) => {
      const category = producto.categoria?.trim() || t('programa4en14.form.giftCategoryUncategorized')
      const list = grouped.get(category)
      if (list) {
        list.push(producto)
      } else {
        grouped.set(category, [producto])
      }
    })
    return Array.from(grouped.entries())
  }, [productos, t])

  const presentationCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    referidos.forEach((referido) => {
      if (!referido.programa_id) return
      if (referido.estado_presentacion !== 'show') return
      counts[referido.programa_id] = (counts[referido.programa_id] ?? 0) + 1
    })
    return counts
  }, [referidos])

  const referidosByCycle = useMemo(() => {
    const grouped = new Map<string, ReferidoRecord[]>()
    referidos.forEach((referido) => {
      if (!referido.programa_id) return
      const list = grouped.get(referido.programa_id)
      if (list) {
        list.push(referido)
      } else {
        grouped.set(referido.programa_id, [referido])
      }
    })
    return grouped
  }, [referidos])

  const getLeadForReferido = useCallback(
    (referido: ReferidoRecord) => {
      if (referido.lead_id) {
        return leadMap.get(referido.lead_id) ?? null
      }
      const phone = referido.telefono ? stripPhone(referido.telefono) : ''
      return phone ? leadByPhone.get(phone) ?? null : null
    },
    [leadByPhone, leadMap]
  )

  const getLeadScore = useCallback(
    (lead: LeadRecord | null) => {
      if (!lead) return 0
      const estadoCivil = lead.estado_civil ?? ''
      const situacionLaboral = lead.situacion_laboral ?? ''
      const hasDualIncome =
        (estadoCivil === 'casado' || estadoCivil === 'union_libre') &&
        situacionLaboral === 'trabajan_dos'
      const hasCredit = hasCreditField ? Boolean(lead.tiene_credito) : false
      const ownsHome = lead.tipo_vivienda === 'propia'
      const criteria = [
        hasDualIncome,
        Boolean(lead.ninos_en_casa),
        hasCredit,
        Boolean(lead.tiene_productos_rp),
        ownsHome,
      ]
      return criteria.filter(Boolean).length
    },
    [hasCreditField]
  )

  const openCalificacionPanel = useCallback(
    (referido: ReferidoRecord) => {
      const lead = getLeadForReferido(referido)
      const estadoCivil = lead?.estado_civil ?? ''
      const situacionLaboral = lead?.situacion_laboral ?? ''
      const hasDualIncome =
        (estadoCivil === 'casado' || estadoCivil === 'union_libre') &&
        situacionLaboral === 'trabajan_dos'
      setCalificacionReferido(referido)
      setCalificacionForm({
        pareja_doble_ingreso: hasDualIncome,
        ninos_en_casa: Boolean(lead?.ninos_en_casa),
        tiene_credito: hasCreditField ? Boolean(lead?.tiene_credito) : false,
        tiene_productos_rp: Boolean(lead?.tiene_productos_rp),
        casa_propia: lead?.tipo_vivienda === 'propia',
        prioridad_top: Boolean(referido.prioridad_top),
        notas_adicionales: referido.notas_adicionales ?? '',
        estado_presentacion: referido.estado_presentacion ?? 'pendiente',
      })
      setCalificacionError(null)
      setCalificacionOpen(true)
    },
    [getLeadForReferido, hasCreditField]
  )

  const handleDeliverGift = useCallback(
    async (cycleId: string) => {
      if (!configured) return
      const confirmed = window.confirm(t('programa4en14.gift.confirmDeliver'))
      if (!confirmed) return
      setGiftSubmittingId(cycleId)
      const today = new Date().toISOString().slice(0, 10)
      const { error: updateError } = await supabase
        .from('programa_4en14')
        .update({ regalo_entregado: true, fecha_regalo: today })
        .eq('id', cycleId)
      if (updateError) {
        showToast(updateError.message, 'error')
      } else {
        await loadData()
        showToast(t('toast.success'))
      }
      setGiftSubmittingId(null)
    },
    [configured, loadData, showToast, t]
  )

  const cycleRows = useMemo<DataTableRow[]>(() => {
    return cycles.map((cycle) => {
      const ownerType = cycle.propietario_tipo ?? ''
      const ownerLookup = ownerType in ownerMap ? ownerMap[ownerType as keyof typeof ownerMap] : null
      const ownerId = cycle.propietario_id
      const fallbackOwnerName = ownerId
        ? ownerMap.cliente.get(ownerId) ||
          ownerMap.lead.get(ownerId) ||
          ownerMap.embajador.get(ownerId) ||
          ownerMap.vendedor.get(ownerId) ||
          ownerMap.usuario.get(ownerId)
        : null
      const ownerName = ownerId
        ? ownerLookup?.get(ownerId) ?? fallbackOwnerName ?? ownerId
        : '-'
      const vendedorName = cycle.vendedor_id ? usersById[cycle.vendedor_id] ?? cycle.vendedor_id : '-'
      const presentationCount = presentationCounts[cycle.id] ?? 0
      const metaPresentaciones = cycle.meta_presentaciones ?? 4
      const progressValue = metaPresentaciones > 0 ? Math.min(1, presentationCount / metaPresentaciones) : 0
      const progressLabel = `${presentationCount}/${metaPresentaciones}`
      const progressCell = (
        <div className="progress-cell">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.round(progressValue * 100)}%` }} />
          </div>
          <span className="progress-label">{progressLabel}</span>
        </div>
      )
      const giftName = cycle.regalo_producto_id ? productoMap.get(cycle.regalo_producto_id) ?? '-' : '-'
      const isGiftReady = presentationCount >= metaPresentaciones
      const giftDelivered = Boolean(cycle.regalo_entregado)
      const giftDateLabel = giftDelivered ? formatDate(cycle.fecha_regalo) : ''
      const giftBadge = giftDelivered ? (
        <Badge
          tone="blue"
          label={
            giftDateLabel
              ? t('programa4en14.gift.deliveredWithDate', { date: giftDateLabel })
              : t('programa4en14.gift.delivered')
          }
        />
      ) : isGiftReady ? (
        <Badge tone="gold" label={t('programa4en14.gift.pending')} />
      ) : null
      const giftAction = isGiftReady && !giftDelivered ? (
        <Button
          variant="ghost"
          type="button"
          onClick={() => handleDeliverGift(cycle.id)}
          disabled={giftSubmittingId === cycle.id}
        >
          {giftSubmittingId === cycle.id ? t('common.saving') : t('programa4en14.gift.deliver')}
        </Button>
      ) : null
      const giftCell = (
        <div className="gift-cell">
          <span>{giftName}</span>
          {giftBadge}
          {giftAction}
        </div>
      )
      const isExpanded = expandedCycles.has(cycle.id)
      const expandLabel = isExpanded ? t('programa4en14.actions.collapse') : t('programa4en14.actions.expand')
      const expandCell = (
        <button
          type="button"
          className={`expand-toggle ${isExpanded ? 'expanded' : ''}`.trim()}
          aria-label={expandLabel}
          onClick={() => toggleCycleExpanded(cycle.id)}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
      )

      const referidosList = referidosByCycle.get(cycle.id) ?? []
      const expandedContent = (
        <div className="cycle-expanded">
          <div className="cycle-expanded-header">
            <div className="cycle-expanded-title">
              <span>{t('programa4en14.referralTable.title', { count: referidosList.length })}</span>
            </div>
            <Button variant="ghost" type="button" onClick={() => openReferralModal(cycle.id)}>
              {t('programa4en14.actions.addReferidos')}
            </Button>
          </div>
          <div className="cycle-expanded-body">
            {referidosList.length === 0 ? (
              <div className="table-empty">{t('programa4en14.referralTable.empty')}</div>
            ) : (
              <div className="referral-subtable-scroll">
                <table className="referral-subtable">
                  <thead>
                    <tr>
                      <th>{t('programa4en14.referralTable.columns.nombre')}</th>
                      <th>{t('programa4en14.referralTable.columns.telefono')}</th>
                      <th>{t('programa4en14.referralTable.columns.calificacion')}</th>
                      <th>{t('programa4en14.referralTable.columns.prioridad')}</th>
                      <th>{t('programa4en14.referralTable.columns.estado')}</th>
                      <th>{t('programa4en14.referralTable.columns.fechaDemo')}</th>
                      <th>{t('programa4en14.referralTable.columns.acciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referidosList.map((referido) => {
                      const lead = getLeadForReferido(referido)
                      const stars = getLeadScore(lead)
                      const starsLabel = stars > 0 ? '⭐'.repeat(stars) : t('programa4en14.rating.none')
                      const prioridadLabel = referido.prioridad_top ? (
                        <Badge tone="blue" label={t('programa4en14.priority.top4')} />
                      ) : (
                        '-'
                      )
                      const estadoKey = referido.estado_presentacion ?? ''
                      const estadoLabel = estadoKey
                        ? t(`programa4en14.referralStates.${estadoKey}`)
                        : '-'
                      const demoDateLabel = referido.fecha_demo ? formatDate(referido.fecha_demo) : '-'
                      const phoneDigits = referido.telefono ? stripPhone(referido.telefono) : ''
                      const emailValue = lead?.email ?? ''
                      const contact = {
                        nombre: referido.nombre ?? '',
                        telefono: referido.telefono ?? '',
                        email: emailValue,
                        vendedor: vendedorName === '-' ? '' : vendedorName,
                        leadId: lead?.id ?? null,
                      }
                      const hasPhone = phoneDigits.length > 0
                      const hasEmail = Boolean(emailValue.trim())
                      return (
                        <tr key={referido.id}>
                          <td>{referido.nombre ?? '-'}</td>
                          <td>{referido.telefono ? formatPhone(stripPhone(referido.telefono)) : '-'}</td>
                          <td>{starsLabel}</td>
                          <td>{prioridadLabel}</td>
                          <td>{estadoLabel}</td>
                          <td>{demoDateLabel}</td>
                          <td>
                            <div className="referral-row-actions">
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={t('programa4en14.referralTable.actions.calificar')}
                                onClick={() => openCalificacionPanel(referido)}
                              >
                                ✏️
                              </button>
                              {referido.lead_id && !referido.cita_id && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => handleAgendarCita4en14(referido)}
                                >
                                  + Cita
                                </Button>
                              )}
                              {referido.cita_id && (
                                <Badge label="Cita" tone="blue" />
                              )}
                              <div className="contact-actions">
                                <button
                                  type="button"
                                  className="contact-icon whatsapp"
                                  aria-label={t('programa4en14.referralTable.actions.whatsapp')}
                                  disabled={!hasPhone}
                                  onClick={() => {
                                    if (!hasPhone) return
                                    openWhatsapp(contact)
                                  }}
                                >
                                  <IconWhatsapp />
                                </button>
                                <button
                                  type="button"
                                  className="contact-icon sms"
                                  aria-label={t('programa4en14.referralTable.actions.sms')}
                                  disabled={!hasPhone}
                                  onClick={() => {
                                    if (!hasPhone) return
                                    openSms(contact)
                                  }}
                                >
                                  <IconSms />
                                </button>
                                <button
                                  type="button"
                                  className="contact-icon email"
                                  aria-label={t('programa4en14.referralTable.actions.email')}
                                  disabled={!hasEmail}
                                  onClick={() => {
                                    if (!hasEmail) return
                                    openEmail(contact)
                                  }}
                                >
                                  <IconMail />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )

      return {
        id: cycle.id,
        cells: [
          expandCell,
          ownerName,
          vendedorName,
          cycle.fecha_inicio ? formatDate(cycle.fecha_inicio) : '-',
          cycle.estado ?? '-',
          progressCell,
          giftCell,
        ],
        expandedContent,
        isExpanded,
      }
    })
  }, [
    cycles,
    expandedCycles,
    formatDate,
    getLeadForReferido,
    getLeadScore,
    giftSubmittingId,
    handleDeliverGift,
    openCalificacionPanel,
    openEmail,
    openReferralModal,
    openSms,
    openWhatsapp,
    ownerMap,
    presentationCounts,
    productoMap,
    referidosByCycle,
    t,
    toggleCycleExpanded,
    usersById,
  ])

  const emptyLabel = loadingData ? t('common.loading') : t('common.noData')
  const vendedorName = session?.user.id ? usersById[session.user.id] ?? session.user.id : '-'
  const referralCount = referralRows.filter((row) => row.nombre.trim() !== '').length

  const handleReferralChange = (index: number, field: keyof ReferralRow) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = field === 'telefono' ? formatPhone(event.target.value) : event.target.value
      setReferralRows((prev) =>
        prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
      )
    }

  const handleReferralPhoneKeyDown = (index: number) =>
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      const nextIndex = index + 1
      const nextInput = referralNameRefs.current[nextIndex]
      if (nextInput) {
        nextInput.focus()
      }
    }

  const handleAddReferralRow = () => {
    setReferralRows((prev) => [...prev, { nombre: '', telefono: '', email: '' }])
  }

  const handleSaveReferidos = async () => {
    if (!configured || !referralProgramId) return
    const validRows = referralRows.filter((row) => row.nombre.trim() !== '')
    if (validRows.length === 0) {
      setReferralError(t('programa4en14.referralLoop.empty'))
      return
    }
    setReferralSubmitting(true)
    setReferralError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const vendedorId = session?.user.id ?? null
    const leadsPayload = validRows.map((row) => ({
      nombre: row.nombre.trim(),
      telefono: toNull(stripPhone(row.telefono)),
      email: toNull(row.email),
      fuente: 'referido',
      owner_id: vendedorId,
      estado_pipeline: 'nuevo',
    }))

    const { data: leadsData, error: leadsError } = await supabase
      .from('leads')
      .insert(leadsPayload)
      .select('id')

    if (leadsError) {
      const message = leadsError.message ?? t('toast.error')
      setReferralError(message)
      showToast(message, 'error')
      setReferralSubmitting(false)
      return
    }

    const referidosPayload = validRows.map((row, index) => ({
      programa_id: referralProgramId,
      nombre: row.nombre.trim(),
      telefono: toNull(stripPhone(row.telefono)),
      estado_presentacion: 'pendiente',
      lead_id: leadsData?.[index]?.id ?? null,
    }))

    const { error: referidosError } = await supabase
      .from('programa_4en14_referidos')
      .insert(referidosPayload)

    if (referidosError) {
      const message = referidosError.message ?? t('toast.error')
      setReferralError(message)
      showToast(message, 'error')
    } else {
      setReferralOpen(false)
      setReferralRows(buildReferralRows())
      await loadData()
      showToast(t('toast.success'))
    }
    setReferralSubmitting(false)
  }

  const handleCalificacionChange = (field: keyof typeof initialCalificacionForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value =
        event.target instanceof HTMLInputElement && event.target.type === 'checkbox'
          ? event.target.checked
          : event.target.value
      setCalificacionForm((prev) => ({ ...prev, [field]: value }))
    }

  const handleSaveCalificacion = async () => {
    if (!calificacionReferido) return
    setCalificacionSubmitting(true)
    setCalificacionError(null)
    const lead = getLeadForReferido(calificacionReferido)
    const leadId = calificacionReferido.lead_id ?? lead?.id ?? null
    const shouldSetDemoDate =
      (calificacionForm.estado_presentacion === 'show' ||
        calificacionForm.estado_presentacion === 'demo_calificada' ||
        calificacionForm.estado_presentacion === 'venta') &&
      !calificacionReferido.fecha_demo
    const demoDate = shouldSetDemoDate ? new Date().toISOString().slice(0, 10) : calificacionReferido.fecha_demo
    const referidosPayload = {
      estado_presentacion: calificacionForm.estado_presentacion,
      prioridad_top: calificacionForm.prioridad_top,
      notas_adicionales: calificacionForm.notas_adicionales.trim() || null,
      fecha_demo: demoDate || null,
    }

    const existingEstadoCivil = lead?.estado_civil ?? null
    const existingSituacion = lead?.situacion_laboral ?? null
    let nextEstadoCivil = existingEstadoCivil
    let nextSituacion = existingSituacion
    if (calificacionForm.pareja_doble_ingreso) {
      nextEstadoCivil =
        existingEstadoCivil === 'casado' || existingEstadoCivil === 'union_libre'
          ? existingEstadoCivil
          : 'casado'
      nextSituacion = 'trabajan_dos'
    } else if (existingSituacion === 'trabajan_dos') {
      nextSituacion = null
    }

    const nextTipoVivienda = calificacionForm.casa_propia
      ? 'propia'
      : lead?.tipo_vivienda === 'propia'
        ? null
        : lead?.tipo_vivienda ?? null

    const leadPayload: Record<string, unknown> | null = leadId
      ? {
          estado_civil: nextEstadoCivil,
          situacion_laboral: nextSituacion,
          ninos_en_casa: calificacionForm.ninos_en_casa,
          tiene_productos_rp: calificacionForm.tiene_productos_rp,
          tipo_vivienda: nextTipoVivienda,
        }
      : null

    if (leadPayload && hasCreditField) {
      leadPayload.tiene_credito = calificacionForm.tiene_credito
    }

    const updates = [
      supabase.from('programa_4en14_referidos').update(referidosPayload).eq('id', calificacionReferido.id),
    ]
    if (leadPayload && leadId) {
      updates.push(supabase.from('leads').update(leadPayload).eq('id', leadId))
    }

    const results = await Promise.all(updates)
    const updateError = results.find((result) => 'error' in result && result.error)

    if (updateError && 'error' in updateError && updateError.error) {
      setCalificacionError(updateError.error.message)
      showToast(updateError.error.message, 'error')
    } else {
      setCalificacionOpen(false)
      setCalificacionReferido(null)
      await loadData()
      showToast(t('toast.success'))
    }
    setCalificacionSubmitting(false)
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('programa4en14.title')}
        subtitle={t('programa4en14.subtitle')}
        action={<Button onClick={handleOpenForm}>{t('programa4en14.actions.newCycle')}</Button>}
      />

      <div className="stat-grid">
        <StatCard
          label={t('programa4en14.metrics.ciclosActivos')}
          value={loading ? t('common.loading') : numberFormat.format(metrics.cyclesActive)}
        />
        <StatCard
          label={t('programa4en14.metrics.demosCalificadas')}
          value={loading ? t('common.loading') : numberFormat.format(metrics.demos)}
          accent="gold"
        />
      </div>

      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}
      {error && <div className="form-error">{error}</div>}
      <DataTable
        columns={[
          t('programa4en14.columns.expand'),
          t('programa4en14.columns.propietario'),
          t('programa4en14.columns.vendedor'),
          t('programa4en14.columns.fechaInicio'),
          t('programa4en14.columns.estado'),
          t('programa4en14.columns.presentaciones'),
          t('programa4en14.columns.regalo'),
        ]}
        rows={cycleRows}
        emptyLabel={emptyLabel}
      />

      <Modal
        open={formOpen}
        title={t('programa4en14.form.title')}
        description={t('programa4en14.form.description')}
        onClose={() => {
          setFormOpen(false)
          setFormError(null)
        }}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="cycle-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="cycle-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{t('programa4en14.form.ownerType')}</span>
            <select value={formValues.owner_type} onChange={handleChange('owner_type')}>
              <option value="cliente">{t('programa4en14.form.ownerTypes.cliente')}</option>
              <option value="lead">{t('programa4en14.form.ownerTypes.lead')}</option>
              <option value="vendedor">{t('programa4en14.form.ownerTypes.vendedor')}</option>
              <option value="embajador">{t('programa4en14.form.ownerTypes.embajador')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t('programa4en14.form.owner')}</span>
            <select value={formValues.owner_id} onChange={handleChange('owner_id')}>
              <option value="">{t('common.select')}</option>
              {ownerOptions.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {[owner.nombre, owner.apellido].filter(Boolean).join(' ') || owner.id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('programa4en14.form.vendedor')}</span>
            <input value={vendedorName} readOnly />
          </label>
          <label className="form-field">
            <span>{t('programa4en14.form.fechaInicio')}</span>
            <input type="date" value={formValues.fecha_inicio} onChange={handleChange('fecha_inicio')} />
          </label>
          <label className="form-field">
            <span>{t('programa4en14.form.fechaFin')}</span>
            <input type="date" value={formValues.fecha_fin} readOnly />
          </label>
          <label className="form-field">
            <span>{t('programa4en14.form.meta')}</span>
            <input
              type="number"
              value={formValues.meta_presentaciones}
              onChange={handleChange('meta_presentaciones')}
            />
          </label>
          <label className="form-field">
            <span>{t('programa4en14.form.cicloNumero')}</span>
            <input type="number" value={formValues.ciclo_numero} onChange={handleChange('ciclo_numero')} />
          </label>
          <label className="form-field">
            <span>{t('programa4en14.form.giftLabel')}</span>
            <select value={formValues.regalo_producto_id} onChange={handleChange('regalo_producto_id')}>
              <option value="">{t('common.select')}</option>
              {productosPorCategoria.map(([categoria, items]) => (
                <optgroup key={categoria} label={categoria}>
                  {items.map((producto) => (
                    <option key={producto.id} value={producto.id}>
                      {producto.nombre}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
      <Modal
        open={referralOpen}
        title={t('programa4en14.referralLoop.title')}
        description={t('programa4en14.referralLoop.subtitle')}
        className="referral-modal"
        bodyClassName="referral-modal-body"
        onClose={() => {
          setReferralOpen(false)
          setReferralError(null)
          setReferralProgramId(null)
        }}
        actions={
          <>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setReferralOpen(false)
                setReferralProgramId(null)
              }}
            >
              {t('programa4en14.referralLoop.skip')}
            </Button>
            <Button type="button" onClick={handleSaveReferidos} disabled={referralSubmitting}>
              {referralSubmitting ? t('common.saving') : t('programa4en14.referralLoop.save')}
            </Button>
          </>
        }
      >
        <div className="referral-header">
          <span className="referral-counter">
            {t('programa4en14.referralLoop.counter', { count: referralCount })}
          </span>
          <Button variant="ghost" type="button" onClick={handleAddReferralRow}>
            {t('programa4en14.referralLoop.addRow')}
          </Button>
        </div>
        <div className={`referral-list ${referralRows.length > 5 ? 'scroll' : ''}`.trim()}>
          {referralRows.map((row, index) => {
            const phoneDigits = stripPhone(row.telefono)
            const hasName = row.nombre.trim() !== ''
            const hasPhone = phoneDigits.length > 0
            const hasEmail = row.email.trim() !== ''
            const contact = {
              nombre: row.nombre.trim() || t('common.noData'),
              telefono: row.telefono,
              email: row.email,
              vendedor: vendedorName === '-' ? '' : vendedorName,
            }
            return (
              <div key={`referral-${index}`} className="referral-row">
                <div className="referral-index">{index + 1}</div>
                <input
                  ref={(element) => {
                    referralNameRefs.current[index] = element
                  }}
                  className="referral-input"
                  value={row.nombre}
                  onChange={handleReferralChange(index, 'nombre')}
                  placeholder={t('programa4en14.referralLoop.nombrePlaceholder')}
                />
                <input
                  className="referral-input"
                  value={row.telefono}
                  onChange={handleReferralChange(index, 'telefono')}
                  onKeyDown={handleReferralPhoneKeyDown(index)}
                  placeholder={t('programa4en14.referralLoop.telefonoPlaceholder')}
                />
                <input
                  className="referral-input"
                  value={row.email}
                  onChange={handleReferralChange(index, 'email')}
                  onKeyDown={handleReferralPhoneKeyDown(index)}
                  placeholder={t('programa4en14.referralLoop.emailPlaceholder')}
                />
                <div className="referral-actions">
                  {(() => {
                    return (
                      <>
                        <button
                          type="button"
                          className="contact-icon whatsapp"
                          aria-label={t('programa4en14.referralLoop.whatsapp')}
                          disabled={!hasName || !hasPhone}
                          onClick={() => {
                            if (!hasName || !hasPhone) return
                            openWhatsapp(contact)
                          }}
                        >
                          <IconWhatsapp />
                        </button>
                        <button
                          type="button"
                          className="contact-icon sms"
                          aria-label={t('programa4en14.referralLoop.sms')}
                          disabled={!hasName || !hasPhone}
                          onClick={() => {
                            if (!hasName || !hasPhone) return
                            openSms(contact)
                          }}
                        >
                          <IconSms />
                        </button>
                        <button
                          type="button"
                          className="contact-icon email"
                          aria-label={t('programa4en14.referralLoop.email')}
                          disabled={!hasName || !hasEmail}
                          onClick={() => {
                            if (!hasName || !hasEmail) return
                            openEmail(contact)
                          }}
                        >
                          <IconMail />
                        </button>
                      </>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
        {referralError && <div className="form-error">{referralError}</div>}
      </Modal>
      {calificacionOpen && calificacionReferido && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onClick={() => {
            setCalificacionOpen(false)
            setCalificacionReferido(null)
          }}
        >
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calificacion-referido-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="drawer-header">
              <div>
                <h3 id="calificacion-referido-title">{t('programa4en14.calificacion.title')}</h3>
                <p className="drawer-subtitle">
                  {calificacionReferido.nombre ?? t('common.noData')}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setCalificacionOpen(false)
                  setCalificacionReferido(null)
                }}
                aria-label={t('common.close')}
              >
                x
              </button>
            </header>
            <div className="drawer-body">
              <div className="drawer-section">
                <h4>{t('programa4en14.calificacion.criteriaTitle')}</h4>
                <div className="criteria-grid">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={calificacionForm.pareja_doble_ingreso}
                      onChange={handleCalificacionChange('pareja_doble_ingreso')}
                    />
                    <span>{t('programa4en14.calificacion.criteria.trabajanDos')}</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={calificacionForm.ninos_en_casa}
                      onChange={handleCalificacionChange('ninos_en_casa')}
                    />
                    <span>{t('programa4en14.calificacion.criteria.ninosEnCasa')}</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={calificacionForm.tiene_credito}
                      onChange={handleCalificacionChange('tiene_credito')}
                    />
                    <span>{t('programa4en14.calificacion.criteria.tieneCredito')}</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={calificacionForm.tiene_productos_rp}
                      onChange={handleCalificacionChange('tiene_productos_rp')}
                    />
                    <span>{t('programa4en14.calificacion.criteria.tieneProductosRp')}</span>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={calificacionForm.casa_propia}
                      onChange={handleCalificacionChange('casa_propia')}
                    />
                    <span>{t('programa4en14.calificacion.criteria.casaPropia')}</span>
                  </label>
                </div>
              </div>
              <div className="drawer-section">
                <h4>{t('programa4en14.calificacion.priorityTitle')}</h4>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={calificacionForm.prioridad_top}
                    onChange={handleCalificacionChange('prioridad_top')}
                  />
                  <span>{t('programa4en14.calificacion.priorityTop4')}</span>
                </label>
              </div>
              <div className="drawer-section">
                <label className="form-field">
                  <span>{t('programa4en14.calificacion.estado')}</span>
                  <select
                    value={calificacionForm.estado_presentacion}
                    onChange={handleCalificacionChange('estado_presentacion')}
                  >
                    <option value="pendiente">{t('programa4en14.referralStates.pendiente')}</option>
                    <option value="agendada">{t('programa4en14.referralStates.agendada')}</option>
                    <option value="show">{t('programa4en14.referralStates.show')}</option>
                    <option value="demo_calificada">{t('programa4en14.referralStates.demo_calificada')}</option>
                    <option value="venta">{t('programa4en14.referralStates.venta')}</option>
                    <option value="no_interes">{t('programa4en14.referralStates.no_interes')}</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>{t('programa4en14.calificacion.notas')}</span>
                  <textarea
                    rows={3}
                    value={calificacionForm.notas_adicionales}
                    onChange={handleCalificacionChange('notas_adicionales')}
                    placeholder={t('programa4en14.calificacion.notasPlaceholder')}
                  />
                </label>
                {calificacionError && <div className="form-error">{calificacionError}</div>}
              </div>
            </div>
            <div className="modal-actions">
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setCalificacionOpen(false)
                  setCalificacionReferido(null)
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="button" onClick={handleSaveCalificacion} disabled={calificacionSubmitting}>
                {calificacionSubmitting ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </aside>
        </div>
      )}
      <ModalRenderer />
      <CitaModal
        open={citaOpen}
        onClose={() => { setCitaOpen(false); setCitaReferidoId(null) }}
        onSaved={handleCitaSaved4en14}
        initialData={citaInitial}
      />
    </div>
  )
}
