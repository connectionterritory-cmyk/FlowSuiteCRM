import { type ChangeEvent, type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { StatCard } from '../../components/StatCard'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { ActivacionReferidosPanel } from '../../components/ActivacionReferidosPanel'
import { useToast } from '../../components/Toast'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'
import { useConexiones, type CiActivacion, type CiReferido, type GiftProduct } from '../../hooks/useConexiones'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { CONEXIONES_INFINITAS_DIFUSION, replaceTemplateVariables } from '../../lib/whatsappTemplates'
import { IconMail, IconSms, IconWhatsapp } from '../../components/icons'
import { useAuth } from '../../auth/AuthProvider'
import { useUsers } from '../../data/UsersProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { useMessaging } from '../../hooks/useMessaging'
import {
  CI_REFERIDO_ESTADOS,
  CI_RELACIONES,
  MIN_REFERIDOS_CI,
  MIN_REFERIDOS_DRAFT,
  formatPhone,
  getActivationState,
  stripPhone,
  type CiRelacion,
  type ReferidoFormRow,
} from '../../lib/conexiones/validaciones'

type EmbajadorProgramaRecord = {
  id: string
  embajador_id: string | null
  periodo_id: string | null
  nivel: string | null
  conexiones?: number | null
  total_conexiones?: number | null
  total_conexiones_anual?: number | null
  total_ventas_generadas_anual?: number | null
  ventas_generadas?: number | null
}

type ConexionRow = {
  nombre: string
  telefono: string
  email: string
  estado: string
}

type UsuarioRecord = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  distribuidor_padre_id?: string | null
}

type OwnerCandidate = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  type: 'cliente' | 'prospecto'
}

const initialEmbajadorForm = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  fecha_nacimiento: '',
}

const currentYear = new Date().getFullYear()

const formatYearDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().slice(0, 10)
}

const initialPeriodoForm = {
  anio: String(currentYear),
  fecha_inicio: formatYearDate(currentYear, 1, 1),
  fecha_fin: formatYearDate(currentYear, 12, 31),
}

const initialRegistroForm = {
  embajador_id: '',
}

const CI_CLOSED_DAYS = 90

const initialCiReferidoRow: ReferidoFormRow = {
  nombre: '',
  telefono: '',
  relacion: 'familiar',
}

const buildCiReferidoRows = (count = 5) =>
  Array.from({ length: count }, () => ({ ...initialCiReferidoRow }))

const normalizeCategory = (value?: string | null) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()

const CLIENT_DIFFUSION_TEMPLATE =
  '¡Mira esta belleza! 🎁 Estoy participando para ganármela y ya te dejé anotado para que a ti también te den un Regalo Premium. Te va a contactar mi asesor {vendedor} ({telefono_vendedor}) para explicarte. ¡Cualquier cosa llámame y te cuento cómo funciona!'

const buildConexionRows = (count = 3) =>
  Array.from({ length: count }, () => ({ nombre: '', telefono: '', email: '', estado: 'pendiente' }))

export function ConexionesActivacionesTabLegacy() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const { usersById } = useUsers()
  const { showToast } = useToast()
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const {
    configured,
    loading,
    error,
    data,
    loadConexiones,
    createActivacion,
    updateActivacion,
    updateReferido,
    addReferido,
    enviarFotoSorteo,
    uploadActivationPhoto,
    createSignedPhotoUrl,
    createCliente,
    createProspecto,
    createLeadFromReferido,
  } = useConexiones({ mode: 'activaciones', autoLoad: true })
  const { activaciones, referidos, clientes, leads, productos, representante, representantesMap } = data
  const [activationOpen, setActivationOpen] = useState(false)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [activationSaving, setActivationSaving] = useState(false)
  const [selectedActivationId, setSelectedActivationId] = useState<string | null>(null)
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null)
  const [ownerSearch, setOwnerSearch] = useState('')
  const [selectedOwnerType, setSelectedOwnerType] = useState<'cliente' | 'prospecto' | null>(null)
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [createMode, setCreateMode] = useState<'cliente' | 'prospecto' | null>(null)
  const [ownerCreateError, setOwnerCreateError] = useState<string | null>(null)
  const [ownerCreating, setOwnerCreating] = useState(false)
  const [newClienteForm, setNewClienteForm] = useState({
    nombre: '',
    apellido: '',
    telefono: '',
    numeroCuentaFinanciera: '',
  })
  const [newProspectoForm, setNewProspectoForm] = useState({
    nombre: '',
    apellido: '',
    telefono: '',
  })
  const [referidoRows, setReferidoRows] = useState<ReferidoFormRow[]>(buildCiReferidoRows())
  const [selectedGiftId, setSelectedGiftId] = useState('')
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [whatsappSentAt, setWhatsappSentAt] = useState<string | null>(null)
  const [referidoUpdatingId, setReferidoUpdatingId] = useState<string | null>(null)
  const [referidoLeadCreatingId, setReferidoLeadCreatingId] = useState<string | null>(null)
  const [referidoDrafts, setReferidoDrafts] = useState<Record<string, ReferidoFormRow>>({})
  const [referidoSavingId, setReferidoSavingId] = useState<string | null>(null)
  const [newReferidoForm, setNewReferidoForm] = useState<ReferidoFormRow>({ ...initialCiReferidoRow })
  const [visitGiftEnabled, setVisitGiftEnabled] = useState(false)
  const [selectedVisitGiftId, setSelectedVisitGiftId] = useState('')
  const [visitGiftQty, setVisitGiftQty] = useState('1')
  const [visitGiftDeliveredAt, setVisitGiftDeliveredAt] = useState<string | null>(null)
  const [visitGiftSearch, setVisitGiftSearch] = useState('')
  const [premiumGiftQtyPartial, setPremiumGiftQtyPartial] = useState('')
  const [premiumGiftDeliveredAt, setPremiumGiftDeliveredAt] = useState<string | null>(null)
  const [premiumGiftSearch, setPremiumGiftSearch] = useState('')
  const [detailGiftId, setDetailGiftId] = useState('')
  const [detailVisitGiftEnabled, setDetailVisitGiftEnabled] = useState(false)
  const [detailVisitGiftId, setDetailVisitGiftId] = useState('')
  const [detailVisitGiftQty, setDetailVisitGiftQty] = useState('1')
  const [detailVisitGiftDeliveredAt, setDetailVisitGiftDeliveredAt] = useState<string | null>(null)
  const [detailPremiumGiftQtyPartial, setDetailPremiumGiftQtyPartial] = useState('')
  const [detailPremiumGiftDeliveredAt, setDetailPremiumGiftDeliveredAt] = useState<string | null>(null)
  const [detailVisitGiftSearch, setDetailVisitGiftSearch] = useState('')
  const [detailPremiumGiftSearch, setDetailPremiumGiftSearch] = useState('')
  const [detailPhotoPath, setDetailPhotoPath] = useState<string | null>(null)
  const [detailPhotoPreviewUrl, setDetailPhotoPreviewUrl] = useState<string | null>(null)
  const [detailPhotoUploading, setDetailPhotoUploading] = useState(false)
  const [detailWhatsappSentAt, setDetailWhatsappSentAt] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailUpdating, setDetailUpdating] = useState(false)

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  )
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language),
    [i18n.language],
  )
  const dateTimeFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const formatDate = useCallback(
    (value?: string | null) => {
      if (!value) return '-'
      return dateFormat.format(new Date(value))
    },
    [dateFormat],
  )

  const formatDateTime = useCallback(
    (value?: string | null) => {
      if (!value) return '-'
      return dateTimeFormat.format(new Date(value))
    },
    [dateTimeFormat],
  )


  const validReferidos = useMemo(
    () =>
      referidoRows.filter(
        (row) => row.nombre.trim() !== '' && stripPhone(row.telefono).length > 0,
      ),
    [referidoRows],
  )

  const incompleteReferidos = useMemo(
    () =>
      referidoRows.filter((row) => {
        const hasName = row.nombre.trim() !== ''
        const hasPhone = stripPhone(row.telefono).length > 0
        return (hasName || row.telefono.trim() !== '') && (!hasName || !hasPhone)
      }),
    [referidoRows],
  )

  const referidosRemaining = Math.max(0, MIN_REFERIDOS_CI - validReferidos.length)
  const hasMinimumReferidos = validReferidos.length >= MIN_REFERIDOS_DRAFT
  const canSeeStep2 = validReferidos.length >= MIN_REFERIDOS_CI
  const canActivate = canSeeStep2 && Boolean(photoPath)
  const canSeeStep3 = canActivate

  const messageText = useMemo(
    () =>
      replaceTemplateVariables(CONEXIONES_INFINITAS_DIFUSION.mensaje, {
        vendedor: representante?.nombre ?? '',
        telefono: representante?.telefono ?? '',
      }),
    [representante],
  )


  const clientesMap = useMemo(() => {
    const map = new Map<string, string>()
    clientes.forEach((cliente) => {
      const name = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ').trim()
      map.set(cliente.id, name || cliente.id)
    })
    return map
  }, [clientes])

  const leadsMap = useMemo(() => {
    const map = new Map<string, string>()
    leads.forEach((lead) => {
      const name = [lead.nombre, lead.apellido].filter(Boolean).join(' ').trim()
      map.set(lead.id, name || lead.id)
    })
    return map
  }, [leads])

  const ownerSearchTerm = ownerSearch.trim().toLowerCase()
  const ownerSearchPhone = stripPhone(ownerSearchTerm)

  const filteredClientes = useMemo(() => {
    if (!ownerSearchTerm) return []
    return clientes.filter((cliente) => {
      const fullName = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ').toLowerCase()
      const phone = stripPhone(cliente.telefono ?? '')
      const matchesPhone = ownerSearchPhone ? phone.includes(ownerSearchPhone) : false
      return fullName.includes(ownerSearchTerm) || matchesPhone
    })
  }, [clientes, ownerSearchPhone, ownerSearchTerm])

  const filteredProspectos = useMemo(() => {
    if (!ownerSearchTerm) return []
    return leads.filter((lead) => {
      const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ').toLowerCase()
      const phone = stripPhone(lead.telefono ?? '')
      const matchesPhone = ownerSearchPhone ? phone.includes(ownerSearchPhone) : false
      return fullName.includes(ownerSearchTerm) || matchesPhone
    })
  }, [leads, ownerSearchPhone, ownerSearchTerm])

  const selectedOwnerName = useMemo(() => {
    if (!selectedOwnerType || !selectedOwnerId) return ''
    if (selectedOwnerType === 'cliente') {
      return clientesMap.get(selectedOwnerId) ?? selectedOwnerId
    }
    return leadsMap.get(selectedOwnerId) ?? selectedOwnerId
  }, [clientesMap, leadsMap, selectedOwnerId, selectedOwnerType])

  const giftMap = useMemo(() => {
    const map = new Map<string, string>()
    productos.forEach((gift) => {
      map.set(gift.id, gift.nombre)
    })
    return map
  }, [productos])

  const premiumProducts = useMemo(
    () => productos.filter((gift) => normalizeCategory(gift.categoria) === 'regalo premium'),
    [productos],
  )

  const visitProducts = useMemo(
    () => productos.filter((gift) => normalizeCategory(gift.categoria) === 'regalo de visita'),
    [productos],
  )

  const referidosByActivacion = useMemo(() => {
    const map = new Map<string, CiReferido[]>()
    referidos.forEach((referido) => {
      if (!referido.activacion_id) return
      const current = map.get(referido.activacion_id) ?? []
      current.push(referido)
      map.set(referido.activacion_id, current)
    })
    return map
  }, [referidos])

  const selectedActivation = useMemo(
    () => activaciones.find((item) => item.id === selectedActivationId) ?? null,
    [activaciones, selectedActivationId],
  )

  const selectedReferidos = useMemo(
    () => (selectedActivation ? referidosByActivacion.get(selectedActivation.id) ?? [] : []),
    [referidosByActivacion, selectedActivation],
  )

  const activationOwner = useMemo(() => {
    if (!selectedActivation?.representante_id) return null
    return representantesMap[selectedActivation.representante_id] ?? null
  }, [representantesMap, selectedActivation])

  const activationOwnerName = useMemo(() => {
    if (!selectedActivation?.representante_id) return ''
    return (
      activationOwner?.nombre ??
      usersById[selectedActivation.representante_id] ??
      selectedActivation.representante_id
    )
  }, [activationOwner, selectedActivation, usersById])

  const activationOwnerPhone = activationOwner?.telefono ?? ''

  const clientDiffusionMessage = useMemo(
    () =>
      replaceTemplateVariables(CLIENT_DIFFUSION_TEMPLATE, {
        vendedor: activationOwnerName,
        telefono_vendedor: activationOwnerPhone,
      }),
    [activationOwnerName, activationOwnerPhone],
  )

  const selectedReferidosCount = selectedReferidos.length
  const detailReferidosRemaining = Math.max(0, MIN_REFERIDOS_CI - selectedReferidosCount)
  const detailHasPhoto = Boolean(detailPhotoPath)
  const detailCanUnlockGift = selectedReferidosCount >= MIN_REFERIDOS_CI
  const detailCanActivate = detailCanUnlockGift && detailHasPhoto
  const detailWhatsappAlreadySent = Boolean(
    detailWhatsappSentAt ?? selectedActivation?.whatsapp_mensaje_enviado_at,
  )
  const detailEstadoValue = selectedActivation
    ? getActivationState({
      referidosCount: selectedReferidosCount,
      photoPath: detailPhotoPath || selectedActivation.foto_url || null,
      whatsappAt: detailWhatsappSentAt ?? selectedActivation.whatsapp_mensaje_enviado_at ?? null,
    })
    : null
  const detailEstadoLabel = detailEstadoValue
    ? (() => {
      const key = `conexiones.activaciones.states.${detailEstadoValue}`
      const label = t(key)
      return label === key ? detailEstadoValue : label
    })()
    : '-'

  useEffect(() => {
    let active = true
    if (!configured || !selectedActivation?.foto_url) {
      setSelectedPhotoUrl(null)
      return
    }

    const fotoPath = selectedActivation.foto_url
    if (fotoPath.startsWith('http')) {
      setSelectedPhotoUrl(fotoPath)
      return
    }

    createSignedPhotoUrl(fotoPath).then(({ data, error }) => {
      if (!active) return
      if (error) {
        setSelectedPhotoUrl(null)
        return
      }
      setSelectedPhotoUrl(data ?? null)
    })

    return () => {
      active = false
    }
  }, [configured, selectedActivation])

  const revokePreviewUrl = useCallback((url: string | null) => {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }, [])

  useEffect(() => {
    if (!selectedActivation) {
      revokePreviewUrl(detailPhotoPreviewUrl)
      setDetailGiftId('')
      setDetailVisitGiftEnabled(false)
      setDetailPhotoPath(null)
      setDetailPhotoPreviewUrl(null)
      setDetailWhatsappSentAt(null)
      setReferidoDrafts({})
      setNewReferidoForm({ ...initialCiReferidoRow })
      setDetailError(null)
      return
    }
    revokePreviewUrl(detailPhotoPreviewUrl)
    setDetailGiftId(selectedActivation.regalo_id ?? '')
    const hasVisitGift =
      Boolean(selectedActivation.regalo_visita_id) ||
      selectedActivation.regalo_visita_cantidad != null ||
      Boolean(selectedActivation.regalo_visita_entregado_at)
    setDetailVisitGiftEnabled(hasVisitGift)
    setDetailVisitGiftId(selectedActivation.regalo_visita_id ?? '')
    setDetailVisitGiftQty(
      selectedActivation.regalo_visita_cantidad != null
        ? String(selectedActivation.regalo_visita_cantidad)
        : '1',
    )
    setDetailVisitGiftDeliveredAt(selectedActivation.regalo_visita_entregado_at ?? null)
    setDetailPremiumGiftQtyPartial(selectedActivation.regalo_premium_cantidad_parcial ?? '')
    setDetailPremiumGiftDeliveredAt(selectedActivation.regalo_premium_entregado_at ?? null)
    setDetailVisitGiftSearch('')
    setDetailPremiumGiftSearch('')
    setDetailPhotoPath(selectedActivation.foto_url ?? null)
    setDetailPhotoPreviewUrl(null)
    setDetailWhatsappSentAt(selectedActivation.whatsapp_mensaje_enviado_at ?? null)
    setReferidoDrafts({})
    setNewReferidoForm({ ...initialCiReferidoRow })
    setDetailError(null)
  }, [detailPhotoPreviewUrl, revokePreviewUrl, selectedActivation])

  const resetActivationForm = useCallback(() => {
    revokePreviewUrl(photoPreviewUrl)
    setActivationError(null)
    setOwnerSearch('')
    setSelectedOwnerType(null)
    setSelectedOwnerId('')
    setCreateMode(null)
    setOwnerCreateError(null)
    setOwnerCreating(false)
    setNewClienteForm({ nombre: '', apellido: '', telefono: '', numeroCuentaFinanciera: '' })
    setNewProspectoForm({ nombre: '', apellido: '', telefono: '' })
    setReferidoRows(buildCiReferidoRows())
    setSelectedGiftId('')
    setVisitGiftEnabled(false)
    setSelectedVisitGiftId('')
    setVisitGiftQty('1')
    setVisitGiftDeliveredAt(null)
    setVisitGiftSearch('')
    setPremiumGiftQtyPartial('')
    setPremiumGiftDeliveredAt(null)
    setPremiumGiftSearch('')
    setPhotoPath(null)
    setPhotoPreviewUrl(null)
    setPhotoUploading(false)
    setWhatsappSentAt(null)
  }, [photoPreviewUrl, revokePreviewUrl])

  const handleOpenActivation = () => {
    resetActivationForm()
    setActivationOpen(true)
  }

  const handleSelectOwner = useCallback((type: 'cliente' | 'prospecto', id: string) => {
    setSelectedOwnerType(type)
    setSelectedOwnerId(id)
    setCreateMode(null)
    setOwnerCreateError(null)
  }, [])

  const handleClearOwner = () => {
    setSelectedOwnerType(null)
    setSelectedOwnerId('')
  }

  const handleStartCreate = (mode: 'cliente' | 'prospecto') => {
    setCreateMode(mode)
    setOwnerCreateError(null)
    setSelectedOwnerType(null)
    setSelectedOwnerId('')
  }

  const findClienteByPhone = useCallback(
    (phone: string) => {
      const normalized = stripPhone(phone)
      if (!normalized) return null
      return clientes.find((cliente) => stripPhone(cliente.telefono ?? '') === normalized) ?? null
    },
    [clientes],
  )

  const findProspectoByPhone = useCallback(
    (phone: string) => {
      const normalized = stripPhone(phone)
      if (!normalized) return null
      return leads.find((lead) => stripPhone(lead.telefono ?? '') === normalized) ?? null
    },
    [leads],
  )

  const handleCreateCliente = async () => {
    if (!configured) {
      setOwnerCreateError(t('common.supabaseRequired'))
      return
    }
    if (!session?.user.id) {
      setOwnerCreateError(t('conexiones.activaciones.errors.noUser'))
      return
    }
    const nombre = newClienteForm.nombre.trim()
    const telefono = stripPhone(newClienteForm.telefono)
    const cuenta = newClienteForm.numeroCuentaFinanciera.trim()
    if (!nombre || !telefono || !cuenta) {
      setOwnerCreateError(t('conexiones.activaciones.errors.clienteRequired'))
      return
    }

    const existingCliente = findClienteByPhone(telefono)
    if (existingCliente) {
      handleSelectOwner('cliente', existingCliente.id)
      setOwnerCreateError(t('conexiones.activaciones.errors.clientePhoneExists'))
      return
    }

    const existingProspecto = findProspectoByPhone(telefono)
    if (existingProspecto) {
      handleSelectOwner('prospecto', existingProspecto.id)
      setOwnerCreateError(t('conexiones.activaciones.errors.prospectoPhoneExists'))
      return
    }

    setOwnerCreating(true)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const payload = {
      nombre: toNull(nombre),
      apellido: toNull(newClienteForm.apellido),
      telefono: telefono,
      numero_cuenta_financiera: toNull(cuenta),
      vendedor_id: session.user.id,
      activo: true,
    }
    const { data, error } = await createCliente(payload)

    if (error) {
      setOwnerCreateError(error)
      showToast(error, 'error')
    } else {
      handleSelectOwner('cliente', data?.id ?? '')
      setOwnerSearch('')
      setNewClienteForm({ nombre: '', apellido: '', telefono: '', numeroCuentaFinanciera: '' })
      showToast(t('toast.success'))
      await loadConexiones()
    }
    setOwnerCreating(false)
  }

  const handleCreateProspecto = async () => {
    if (!configured) {
      setOwnerCreateError(t('common.supabaseRequired'))
      return
    }
    if (!session?.user.id) {
      setOwnerCreateError(t('conexiones.activaciones.errors.noUser'))
      return
    }
    const nombre = newProspectoForm.nombre.trim()
    const telefono = stripPhone(newProspectoForm.telefono)
    if (!nombre || !telefono) {
      setOwnerCreateError(t('conexiones.activaciones.errors.prospectoRequired'))
      return
    }

    const existingCliente = findClienteByPhone(telefono)
    if (existingCliente) {
      handleSelectOwner('cliente', existingCliente.id)
      setOwnerCreateError(t('conexiones.activaciones.errors.clientePhoneExists'))
      return
    }

    const existingProspecto = findProspectoByPhone(telefono)
    if (existingProspecto) {
      handleSelectOwner('prospecto', existingProspecto.id)
      setOwnerCreateError(t('conexiones.activaciones.errors.prospectoPhoneExists'))
      return
    }

    setOwnerCreating(true)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const payload = {
      nombre: toNull(nombre),
      apellido: toNull(newProspectoForm.apellido),
      telefono: telefono,
      fuente: 'conexiones_infinitas',
      estado_pipeline: 'nuevo',
      owner_id: session.user.id,
    }
    const { data, error } = await createProspecto(payload)

    if (error) {
      setOwnerCreateError(error)
      showToast(error, 'error')
    } else {
      handleSelectOwner('prospecto', data?.id ?? '')
      setOwnerSearch('')
      setNewProspectoForm({ nombre: '', apellido: '', telefono: '' })
      showToast(t('toast.success'))
      await loadConexiones()
    }
    setOwnerCreating(false)
  }

  const handleReferidoChange = (index: number, field: keyof ReferidoFormRow) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = field === 'telefono' ? formatPhone(event.target.value) : event.target.value
      const nextValue = field === 'relacion' ? (value as CiRelacion) : value
      setReferidoRows((prev) =>
        prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: nextValue } : row)),
      )
    }

  const handleAddReferidoRow = () => {
    setReferidoRows((prev) => [...prev, { ...initialCiReferidoRow }])
  }

  const handleRemoveReferidoRow = (index: number) => {
    setReferidoRows((prev) => prev.filter((_row, rowIndex) => rowIndex !== index))
  }

  const handlePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !configured) return
    setPhotoUploading(true)
    setActivationError(null)
    try {
      const extension = file.name.split('.').pop() || 'jpg'
      const safeName = `${session?.user.id ?? 'user'}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const path = `activaciones/${safeName}.${extension}`
      const { data, error } = await uploadActivationPhoto(file, path)
      if (error) {
        setActivationError(error)
        showToast(error, 'error')
        return
      }
      revokePreviewUrl(photoPreviewUrl)
      setPhotoPath(data)
      setPhotoPreviewUrl(URL.createObjectURL(file))
    } finally {
      setPhotoUploading(false)
    }
  }

  const handleCopyMessage = async () => {
    if (!messageText) return
    try {
      await navigator.clipboard.writeText(messageText)
      showToast(t('conexiones.activaciones.whatsapp.copied'))
    } catch {
      showToast(t('toast.error'), 'error')
    }
  }

  const handleCopyClientMessage = async () => {
    if (!clientDiffusionMessage) return
    try {
      await navigator.clipboard.writeText(clientDiffusionMessage)
      showToast(t('conexiones.activaciones.form.clientMessageCopied'))
    } catch {
      showToast(t('toast.error'), 'error')
    }
  }

  const handleMarkWhatsappSent = () => {
    setWhatsappSentAt(new Date().toISOString())
    showToast(t('conexiones.activaciones.whatsapp.marked'))
  }

  const handleSaveActivacion = async () => {
    if (!configured) {
      setActivationError(t('common.supabaseRequired'))
      return
    }
    if (!session?.user.id) {
      setActivationError(t('conexiones.activaciones.errors.noUser'))
      return
    }
    if (incompleteReferidos.length > 0) {
      setActivationError(t('conexiones.activaciones.errors.referidoIncompleto'))
      return
    }
    if (validReferidos.length < MIN_REFERIDOS_DRAFT) {
      setActivationError(t('conexiones.activaciones.errors.minReferidosDraft'))
      return
    }
    if (validReferidos.length >= MIN_REFERIDOS_CI) {
      if (!photoPath) {
        setActivationError(t('conexiones.activaciones.errors.photoRequired'))
        return
      }
    }

    if (premiumGiftDeliveredAt && !photoPath) {
      setActivationError(t('conexiones.activaciones.errors.photoRequired'))
      return
    }

    if (!selectedOwnerType || !selectedOwnerId) {
      setActivationError(t('conexiones.activaciones.errors.selectOwner'))
      return
    }

    setActivationSaving(true)
    setActivationError(null)

    const visitGiftPayload = visitGiftEnabled
      ? {
        regaloVisitaId: selectedVisitGiftId || null,
        regaloVisitaCantidad: visitGiftQty.trim() ? Number(visitGiftQty) : null,
        regaloVisitaEntregadoAt: visitGiftDeliveredAt,
      }
      : { regaloVisitaId: null, regaloVisitaCantidad: null, regaloVisitaEntregadoAt: null }

    const { data: activationResult, error: activationError } = await createActivacion({
      clienteId: selectedOwnerType === 'cliente' ? selectedOwnerId : null,
      leadId: selectedOwnerType === 'prospecto' ? selectedOwnerId : null,
      regaloId: selectedGiftId || null,
      ...visitGiftPayload,
      regaloPremiumCantidadParcial: premiumGiftQtyPartial.trim() || null,
      regaloPremiumEntregadoAt: premiumGiftDeliveredAt,
      fotoUrl: photoPath,
      whatsappEnviadoAt: null,
      referidos: validReferidos,
    })

    if (activationError || !activationResult) {
      setActivationError(activationError ?? t('toast.error'))
      showToast(activationError ?? t('toast.error'), 'error')
      setActivationSaving(false)
      return
    }

    if (whatsappSentAt) {
      const sendResult = await enviarFotoSorteo(activationResult.activacion.id, whatsappSentAt)
      if (sendResult.error) {
        showToast('Error al enviar. Inténtalo de nuevo o contacta a soporte', 'error')
      } else {
        showToast('Mensaje enviado y Lead registrado')
      }
    }

    setActivationOpen(false)
    resetActivationForm()
    await loadConexiones()
    showToast(t('toast.success'))

    setActivationSaving(false)
  }

  const handleReferidoDraftChange =
    (referidoId: string, field: keyof ReferidoFormRow) =>
      (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = field === 'telefono' ? formatPhone(event.target.value) : event.target.value
        const nextValue = field === 'relacion' ? (value as CiRelacion) : value
        setReferidoDrafts((prev) => ({
          ...prev,
          [referidoId]: { ...(prev[referidoId] ?? {}), [field]: nextValue } as ReferidoFormRow,
        }))
      }

  const handleSaveReferido = async (referido: CiReferido) => {
    if (!configured) return
    const draft = referidoDrafts[referido.id]
    const nombre = draft?.nombre ?? referido.nombre ?? ''
    const telefono = draft?.telefono ?? referido.telefono ?? ''
    const relacion = draft?.relacion ?? referido.relacion ?? 'familiar'
    if (nombre.trim() === '' || stripPhone(telefono).length === 0) {
      showToast(t('conexiones.activaciones.errors.referidoIncompleto'), 'error')
      return
    }
    setReferidoSavingId(referido.id)
    const { error } = await updateReferido(referido.id, {
      nombre: nombre.trim(),
      telefono: stripPhone(telefono),
      relacion,
    })
    if (error) {
      showToast(error, 'error')
    } else {
      setReferidoDrafts((prev) => {
        const next = { ...prev }
        delete next[referido.id]
        return next
      })
      showToast(t('toast.success'))
    }
    setReferidoSavingId(null)
  }

  const handleAddReferidoToActivation = async () => {
    if (!configured || !selectedActivation) return
    const nombre = newReferidoForm.nombre.trim()
    const telefono = stripPhone(newReferidoForm.telefono)
    if (!nombre || !telefono) {
      setDetailError(t('conexiones.activaciones.errors.referidoIncompleto'))
      return
    }
    setDetailUpdating(true)
    setDetailError(null)
    const { data: insertedReferido, error: insertError } = await addReferido(selectedActivation.id, {
      nombre,
      telefono: newReferidoForm.telefono,
      relacion: newReferidoForm.relacion,
    })
    if (insertError || !insertedReferido) {
      setDetailError(insertError ?? t('toast.error'))
      showToast(insertError ?? t('toast.error'), 'error')
      setDetailUpdating(false)
      return
    }
    const referido = insertedReferido as CiReferido
    const existingLead = leads.find(
      (lead) => stripPhone(lead.telefono ?? '') === stripPhone(referido.telefono ?? ''),
    )
    if (!existingLead && session?.user.id && referido.telefono) {
      const [nombreBase, ...apellidoParts] = (referido.nombre ?? '').trim().split(' ')
      const apellido = apellidoParts.join(' ').trim()
      const { error: leadError } = await createLeadFromReferido({
        referidoId: referido.id,
        nombre: nombreBase || referido.nombre || '',
        apellido: apellido || null,
        telefono: referido.telefono,
        owner_id: session.user.id,
        vendedor_id: session.user.id,
        referido_por_cliente_id: selectedActivation.cliente_id ?? null,
      })
      if (leadError) {
        showToast(leadError, 'error')
      }
    }

    setNewReferidoForm({ ...initialCiReferidoRow })
    const nextCount = selectedReferidosCount + 1
    const nextEstado = getActivationState({
      referidosCount: nextCount,
      photoPath: detailPhotoPath,
      whatsappAt: detailWhatsappSentAt ?? selectedActivation.whatsapp_mensaje_enviado_at ?? null,
    })
    if (selectedActivation.estado !== nextEstado) {
      await updateActivacion(selectedActivation.id, { estado: nextEstado })
    }
    setDetailUpdating(false)
  }

  const handleDetailPhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !configured || !selectedActivation) return
    setDetailPhotoUploading(true)
    setDetailError(null)
    try {
      const extension = file.name.split('.').pop() || 'jpg'
      const safeName = `${selectedActivation.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const path = `activaciones/${safeName}.${extension}`
      const { data, error } = await uploadActivationPhoto(file, path)
      if (error) {
        setDetailError(error)
        showToast(error, 'error')
        return
      }
      revokePreviewUrl(detailPhotoPreviewUrl)
      setDetailPhotoPath(data)
      setDetailPhotoPreviewUrl(URL.createObjectURL(file))
    } finally {
      setDetailPhotoUploading(false)
    }
  }

  const handleUpdateActivationDetails = async () => {
    if (!configured || !selectedActivation) return
    setDetailUpdating(true)
    setDetailError(null)
    let updatePayload: {
      regalo_id?: string | null
      regalo_visita_id?: string | null
      regalo_visita_cantidad?: number | null
      regalo_visita_entregado_at?: string | null
      regalo_premium_cantidad_parcial?: string | null
      regalo_premium_entregado_at?: string | null
      foto_url?: string | null
      estado?: string | null
    } = {
      regalo_visita_id: detailVisitGiftEnabled ? detailVisitGiftId || null : null,
      regalo_visita_cantidad: detailVisitGiftEnabled
        ? detailVisitGiftQty.trim()
          ? Number(detailVisitGiftQty)
          : null
        : null,
      regalo_visita_entregado_at: detailVisitGiftEnabled ? detailVisitGiftDeliveredAt : null,
      regalo_premium_cantidad_parcial: detailPremiumGiftQtyPartial.trim() || null,
      regalo_premium_entregado_at: detailPremiumGiftDeliveredAt,
    }

    if (detailPremiumGiftDeliveredAt && !detailPhotoPath) {
      setDetailError(t('conexiones.activaciones.errors.photoRequired'))
      setDetailUpdating(false)
      return
    }

    if (!detailCanUnlockGift) {
      updatePayload = {
        ...updatePayload,
        regalo_id: detailGiftId || null,
        estado: 'borrador',
      }
    } else {
      if (!detailPhotoPath) {
        setDetailError(t('conexiones.activaciones.errors.photoRequired'))
        setDetailUpdating(false)
        return
      }
      const nextEstado = getActivationState({
        referidosCount: selectedReferidosCount,
        photoPath: detailPhotoPath,
        whatsappAt: detailWhatsappSentAt ?? selectedActivation.whatsapp_mensaje_enviado_at ?? null,
      })
      updatePayload = {
        ...updatePayload,
        regalo_id: detailGiftId || null,
        foto_url: detailPhotoPath,
        estado: nextEstado,
      }
    }

    const { error } = await updateActivacion(selectedActivation.id, updatePayload)
    if (error) {
      setDetailError(error)
      showToast(error, 'error')
    } else {
      showToast(t('toast.success'))
    }
    setDetailUpdating(false)
  }

  const handleMarkDetailWhatsappSent = async () => {
    if (!configured || !selectedActivation) return
    if (!detailCanActivate) {
      setDetailError(t('conexiones.activaciones.errors.whatsappBlocked'))
      return
    }
    const sentAt = new Date().toISOString()
    setDetailUpdating(true)
    setDetailError(null)
    const { error } = await enviarFotoSorteo(selectedActivation.id, sentAt)
    if (error) {
      setDetailError('Error al enviar. Inténtalo de nuevo o contacta a soporte')
      showToast('Error al enviar. Inténtalo de nuevo o contacta a soporte', 'error')
    } else {
      setDetailWhatsappSentAt(sentAt)
      showToast('Mensaje enviado y Lead registrado')
    }
    setDetailUpdating(false)
  }

  const handleUpdateReferidoEstado = async (referidoId: string, nextEstado: string) => {
    if (!configured) return
    setReferidoUpdatingId(referidoId)
    const { error } = await updateReferido(referidoId, { estado: nextEstado })
    if (error) {
      showToast(error, 'error')
    }
    setReferidoUpdatingId(null)
  }

  const handleCreateLeadFromReferido = async (referido: CiReferido) => {
    if (!configured || !session?.user.id) return
    if (!referido.nombre || !referido.telefono) {
      showToast(t('conexiones.activaciones.errors.referidoIncompleto'), 'error')
      return
    }
    setReferidoLeadCreatingId(referido.id)
    const [nombre, ...apellidoParts] = referido.nombre.trim().split(' ')
    const apellido = apellidoParts.join(' ').trim()
    const referidoPorClienteId = selectedActivation?.cliente_id ?? null
    const { error } = await createLeadFromReferido({
      referidoId: referido.id,
      nombre: nombre || referido.nombre.trim(),
      apellido: apellido || null,
      telefono: referido.telefono,
      owner_id: session.user.id,
      vendedor_id: session.user.id,
      referido_por_cliente_id: referidoPorClienteId,
    })

    if (error) {
      showToast(error, 'error')
    } else {
      showToast(t('toast.success'))
    }

    setReferidoLeadCreatingId(null)
  }

  const activationRows = useMemo<DataTableRow[]>(() => {
    return activaciones.map((activation) => {
      const repName = activation.representante_id
        ? usersById[activation.representante_id] ?? activation.representante_id
        : '-'
      const ownerName = activation.cliente_id
        ? clientesMap.get(activation.cliente_id) ?? activation.cliente_id
        : activation.lead_id
          ? leadsMap.get(activation.lead_id) ?? activation.lead_id
          : '-'
      const referidosCount = referidosByActivacion.get(activation.id)?.length ?? 0
      const progresoValue = `${referidosCount}/${MIN_REFERIDOS_CI}`
      const progresoColor =
        referidosCount >= MIN_REFERIDOS_CI
          ? referidosCount > MIN_REFERIDOS_CI
            ? '#a855f7'
            : '#22c55e'
          : referidosCount >= Math.floor(MIN_REFERIDOS_CI / 2)
            ? '#3b82f6'
            : '#94a3b8'
      const giftName = activation.regalo_id ? giftMap.get(activation.regalo_id) ?? activation.regalo_id : '-'
      const dateValue = activation.fecha_activacion ?? activation.created_at
      const whatsappLabel = activation.whatsapp_mensaje_enviado_at
        ? t('conexiones.activaciones.whatsapp.sent')
        : t('conexiones.activaciones.whatsapp.pending')
      const estadoValue = activation.estado ??
        getActivationState({
          referidosCount,
          photoPath: activation.foto_url ?? null,
          whatsappAt: activation.whatsapp_mensaje_enviado_at ?? null,
        })
      const estadoKey = `conexiones.activaciones.states.${estadoValue}`
      const estadoLabel = t(estadoKey)
      const estadoFinal = estadoLabel === estadoKey ? estadoValue : estadoLabel
      const estadoIcon =
        estadoValue === 'completo' ? '🔵' : estadoValue === 'activo' ? '🟢' : '🟡'
      const estadoDisplay = (
        <span className={`badge ci-state ${estadoValue}`.trim()}>
          {estadoIcon} {estadoFinal}
          {estadoValue === 'borrador' ? ` (${referidosCount}/${MIN_REFERIDOS_CI})` : ''}
        </span>
      )
      return {
        id: activation.id,
        cells: [
          formatDate(dateValue),
          repName,
          ownerName,
          numberFormat.format(referidosCount),
          <span style={{ color: progresoColor, fontWeight: 600 }}>{progresoValue}</span>,
          giftName,
          activation.foto_url ? t('common.yes') : t('common.no'),
          whatsappLabel,
          estadoDisplay,
        ],
      }
    })
  }, [
    activaciones,
    clientesMap,
    formatDate,
    giftMap,
    getActivationState,
    leadsMap,
    numberFormat,
    referidosByActivacion,
    t,
    usersById,
  ])

  const emptyLabel = loading ? t('common.loading') : t('common.noData')
  const activationActionLabel = canSeeStep2
    ? t('conexiones.activaciones.form.activateProgram')
    : t('conexiones.activaciones.form.saveDraft')
  const hasSelectedOwner = Boolean(selectedOwnerType && selectedOwnerId)
  const activationActionDisabled =
    activationSaving ||
    !hasMinimumReferidos ||
    !hasSelectedOwner ||
    (canSeeStep2 && !canActivate)

  const selectedActivationTitle = selectedActivation
    ? t('conexiones.activaciones.detailTitle', {
      name:
        selectedActivation.cliente_id
          ? clientesMap.get(selectedActivation.cliente_id) ?? selectedActivation.cliente_id
          : selectedActivation.lead_id
            ? leadsMap.get(selectedActivation.lead_id) ?? selectedActivation.lead_id
            : selectedActivation.id,
    })
    : ''

  const selectedActivationOwnerName = selectedActivation
    ? selectedActivation.cliente_id
      ? clientesMap.get(selectedActivation.cliente_id) ?? ''
      : selectedActivation.lead_id
        ? leadsMap.get(selectedActivation.lead_id) ?? ''
        : ''
    : ''

  const getReferidoDraftValue = useCallback(
    (referido: CiReferido, field: keyof ReferidoFormRow) => {
      const draft = referidoDrafts[referido.id]
      if (draft && draft[field] != null) {
        return String(draft[field] ?? '')
      }
      if (field === 'relacion') return referido.relacion ?? 'familiar'
      if (field === 'telefono') return formatPhone(referido.telefono ?? '')
      return referido.nombre ?? ''
    },
    [formatPhone, referidoDrafts],
  )

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('conexiones.activaciones.title')}
        subtitle={t('conexiones.activaciones.subtitle')}
        action={
          <Button type="button" onClick={handleOpenActivation}>
            {t('conexiones.activaciones.actions.new')}
          </Button>
        }
      />

      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="form-hint">{t('common.loading')}</div>}
      <DataTable
        columns={[
          t('conexiones.activaciones.columns.fecha'),
          t('conexiones.activaciones.columns.representante'),
          t('conexiones.activaciones.columns.cliente'),
          t('conexiones.activaciones.columns.referidos'),
          'Progreso',
          t('conexiones.activaciones.columns.regalo'),
          t('conexiones.activaciones.columns.foto'),
          t('conexiones.activaciones.columns.whatsapp'),
          t('conexiones.activaciones.columns.estado'),
        ]}
        rows={activationRows}
        emptyLabel={emptyLabel}
        onRowClick={(row) => setSelectedActivationId(row.id)}
      />

      <Modal
        open={activationOpen}
        title={t('conexiones.activaciones.form.title')}
        onClose={() => setActivationOpen(false)}
        className="ci-activation-modal"
        bodyClassName="ci-activation-modal-body"
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setActivationOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleSaveActivacion} disabled={activationActionDisabled}>
              {activationSaving ? t('common.saving') : activationActionLabel}
            </Button>
          </>
        }
      >
        <div className="ci-step">
          <div className="ci-step-header">
            <span className="ci-step-pill">1</span>
            <div>
              <h4>{t('conexiones.activaciones.steps.cliente')}</h4>
              <p>{t('conexiones.activaciones.steps.clienteHint')}</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>{t('conexiones.activaciones.form.searchLabel')}</span>
              <input
                value={ownerSearch}
                onChange={(event) => setOwnerSearch(event.target.value)}
                placeholder={t('conexiones.activaciones.form.searchPlaceholder')}
              />
            </label>
          </div>

          {selectedOwnerType && selectedOwnerId && (
            <div className="ci-owner-selected">
              <div>
                <strong>{t('conexiones.activaciones.form.selectedLabel')}</strong>
                <span>
                  {selectedOwnerName} · {t(`conexiones.activaciones.form.selected.${selectedOwnerType}`)}
                </span>
              </div>
              <button type="button" className="icon-button" onClick={handleClearOwner}>
                x
              </button>
            </div>
          )}

          {ownerSearchTerm ? (
            <div className="ci-owner-results">
              <div className="ci-owner-group">
                <span className="ci-owner-label">{t('conexiones.activaciones.form.resultsClientes')}</span>
                {filteredClientes.length === 0 ? (
                  <span className="ci-owner-empty">{t('common.noData')}</span>
                ) : (
                  filteredClientes.map((cliente) => {
                    const name = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.id
                    const isActive = selectedOwnerType === 'cliente' && selectedOwnerId === cliente.id
                    return (
                      <button
                        key={cliente.id}
                        type="button"
                        className={`ci-owner-option ${isActive ? 'active' : ''}`.trim()}
                        onClick={() => handleSelectOwner('cliente', cliente.id)}
                      >
                        <span>{name}</span>
                        <span className="ci-owner-meta">{cliente.telefono ?? '-'}</span>
                      </button>
                    )
                  })
                )}
              </div>
              <div className="ci-owner-group">
                <span className="ci-owner-label">{t('conexiones.activaciones.form.resultsProspectos')}</span>
                {filteredProspectos.length === 0 ? (
                  <span className="ci-owner-empty">{t('common.noData')}</span>
                ) : (
                  filteredProspectos.map((lead) => {
                    const name = [lead.nombre, lead.apellido].filter(Boolean).join(' ') || lead.id
                    const isActive = selectedOwnerType === 'prospecto' && selectedOwnerId === lead.id
                    return (
                      <button
                        key={lead.id}
                        type="button"
                        className={`ci-owner-option ${isActive ? 'active' : ''}`.trim()}
                        onClick={() => handleSelectOwner('prospecto', lead.id)}
                      >
                        <span>{name}</span>
                        <span className="ci-owner-meta">{lead.telefono ?? '-'}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            <p className="ci-owner-hint">{t('conexiones.activaciones.form.searchHint')}</p>
          )}

          <div className="ci-owner-actions">
            <Button variant="ghost" type="button" onClick={() => handleStartCreate('cliente')}>
              {t('conexiones.activaciones.form.createCliente')}
            </Button>
            <Button variant="ghost" type="button" onClick={() => handleStartCreate('prospecto')}>
              {t('conexiones.activaciones.form.createProspecto')}
            </Button>
          </div>

          {createMode === 'cliente' && (
            <div className="ci-owner-create">
              <h5>{t('conexiones.activaciones.form.createClienteTitle')}</h5>
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('conexiones.activaciones.form.clienteNombre')}</span>
                  <input
                    value={newClienteForm.nombre}
                    onChange={(event) => {
                      setOwnerCreateError(null)
                      setNewClienteForm((prev) => ({ ...prev, nombre: event.target.value }))
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>{t('conexiones.activaciones.form.clienteApellido')}</span>
                  <input
                    value={newClienteForm.apellido}
                    onChange={(event) => {
                      setOwnerCreateError(null)
                      setNewClienteForm((prev) => ({ ...prev, apellido: event.target.value }))
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>{t('conexiones.activaciones.form.clienteTelefono')}</span>
                  <input
                    value={newClienteForm.telefono}
                    onChange={(event) => {
                      setOwnerCreateError(null)
                      setNewClienteForm((prev) => ({ ...prev, telefono: formatPhone(event.target.value) }))
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>{t('conexiones.activaciones.form.clienteCuenta')}</span>
                  <input
                    value={newClienteForm.numeroCuentaFinanciera}
                    onChange={(event) => {
                      setOwnerCreateError(null)
                      setNewClienteForm((prev) => ({ ...prev, numeroCuentaFinanciera: event.target.value }))
                    }}
                  />
                </label>
              </div>
              {ownerCreateError && <div className="form-error">{ownerCreateError}</div>}
              <div className="ci-owner-create-actions">
                <Button variant="ghost" type="button" onClick={() => setCreateMode(null)}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" onClick={handleCreateCliente} disabled={ownerCreating}>
                  {ownerCreating ? t('common.saving') : t('conexiones.activaciones.form.createCliente')}
                </Button>
              </div>
            </div>
          )}

          {createMode === 'prospecto' && (
            <div className="ci-owner-create">
              <h5>{t('conexiones.activaciones.form.createProspectoTitle')}</h5>
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('conexiones.activaciones.form.prospectoNombre')}</span>
                  <input
                    value={newProspectoForm.nombre}
                    onChange={(event) => {
                      setOwnerCreateError(null)
                      setNewProspectoForm((prev) => ({ ...prev, nombre: event.target.value }))
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>{t('conexiones.activaciones.form.prospectoApellido')}</span>
                  <input
                    value={newProspectoForm.apellido}
                    onChange={(event) => {
                      setOwnerCreateError(null)
                      setNewProspectoForm((prev) => ({ ...prev, apellido: event.target.value }))
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>{t('conexiones.activaciones.form.prospectoTelefono')}</span>
                  <input
                    value={newProspectoForm.telefono}
                    onChange={(event) => {
                      setOwnerCreateError(null)
                      setNewProspectoForm((prev) => ({ ...prev, telefono: formatPhone(event.target.value) }))
                    }}
                  />
                </label>
              </div>
              {ownerCreateError && <div className="form-error">{ownerCreateError}</div>}
              <div className="ci-owner-create-actions">
                <Button variant="ghost" type="button" onClick={() => setCreateMode(null)}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" onClick={handleCreateProspecto} disabled={ownerCreating}>
                  {ownerCreating ? t('common.saving') : t('conexiones.activaciones.form.createProspecto')}
                </Button>
              </div>
            </div>
          )}

          <div className="referral-header">
            <div className={`ci-counter ${canSeeStep2 ? 'ready' : 'pending'}`.trim()}>
              <strong>{t('conexiones.activaciones.counter', { count: validReferidos.length })}</strong>
              <span>
                {canSeeStep2
                  ? t('conexiones.activaciones.readyGift')
                  : t('conexiones.activaciones.unlockGift', { count: referidosRemaining })}
              </span>
            </div>
            <Button variant="ghost" type="button" onClick={handleAddReferidoRow}>
              {t('conexiones.activaciones.form.addReferido')}
            </Button>
          </div>
          <div className={`referral-list ${referidoRows.length > 6 ? 'scroll' : ''}`.trim()}>
            {referidoRows.map((row, index) => (
              <div key={`ci-referido-${index}`} className="referral-row">
                <div className="referral-index">{index + 1}</div>
                <input
                  className="referral-input"
                  value={row.nombre}
                  onChange={handleReferidoChange(index, 'nombre')}
                  placeholder={t('conexiones.activaciones.form.referidoNombre')}
                />
                <input
                  className="referral-input"
                  value={row.telefono}
                  onChange={handleReferidoChange(index, 'telefono')}
                  placeholder={t('conexiones.activaciones.form.referidoTelefono')}
                />
                <select
                  className="referral-input"
                  value={row.relacion}
                  onChange={handleReferidoChange(index, 'relacion')}
                >
                  {CI_RELACIONES.map((option) => (
                    <option key={option} value={option}>
                      {t(`conexiones.activaciones.relaciones.${option}`)}
                    </option>
                  ))}
                </select>
                <div className="referral-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('conexiones.activaciones.form.removeReferido')}
                    onClick={() => handleRemoveReferidoRow(index)}
                  >
                    x
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="ci-gift-visit">
            <div className="ci-gift-visit-header">
              <h5>Regalo de visita</h5>
              <label className="form-field checkbox-field">
                <span>Aplicar regalo de visita</span>
                <input
                  type="checkbox"
                  checked={visitGiftEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked
                    setVisitGiftEnabled(enabled)
                    if (!enabled) {
                      setSelectedVisitGiftId('')
                      setVisitGiftQty('1')
                      setVisitGiftDeliveredAt(null)
                      setVisitGiftSearch('')
                    }
                  }}
                />
              </label>
            </div>
            <p className="form-hint">
              Opcional: activalo solo cuando la visita amerita entregar un regalo.
            </p>
            {visitProducts.length === 0 ? (
              <div className="template-empty">No hay regalos de visita configurados.</div>
            ) : (
              <div className="ci-gift-visit-fields">
                <input
                  className="referral-input"
                  value={visitGiftSearch}
                  onChange={(event) => setVisitGiftSearch(event.target.value)}
                  placeholder="Buscar regalo"
                  disabled={!visitGiftEnabled}
                />
                <select
                  className="referral-input"
                  value={selectedVisitGiftId}
                  onChange={(event) => setSelectedVisitGiftId(event.target.value)}
                  disabled={!visitGiftEnabled}
                >
                  <option value="">Selecciona un regalo</option>
                  {visitProducts
                    .filter((gift) => gift.nombre.toLowerCase().includes(visitGiftSearch.toLowerCase()))
                    .map((gift) => (
                      <option key={gift.id} value={gift.id}>
                        {gift.nombre}
                      </option>
                    ))}
                </select>
                <input
                  className="referral-input"
                  type="number"
                  min={1}
                  value={visitGiftQty}
                  onChange={(event) => setVisitGiftQty(event.target.value)}
                  placeholder="Cantidad"
                  disabled={!visitGiftEnabled}
                />
                <label className="form-field checkbox-field">
                  <span>Entregado</span>
                  <input
                    type="checkbox"
                    checked={Boolean(visitGiftDeliveredAt)}
                    onChange={(event) =>
                      setVisitGiftDeliveredAt(event.target.checked ? new Date().toISOString() : null)
                    }
                    disabled={!visitGiftEnabled}
                  />
                </label>
                {visitGiftDeliveredAt && (
                  <p className="ci-upload-note">Entregado: {formatDateTime(visitGiftDeliveredAt)}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {canSeeStep2 && (
          <div className="ci-step">
            <div className="ci-step-header">
              <span className="ci-step-pill">2</span>
              <div>
                <h4>{t('conexiones.activaciones.steps.regalo')}</h4>
                <p>{t('conexiones.activaciones.steps.regaloHint')}</p>
              </div>
            </div>
            {/* Regalo premium */}
            <div className="ci-gift-premium">
              <h5>Regalo premium</h5>
              {premiumProducts.length === 0 ? (
                <div className="template-empty">{t('conexiones.activaciones.form.giftEmpty')}</div>
              ) : (
                <div className="ci-gift-premium-fields">
                  <input
                    className="referral-input"
                    value={premiumGiftSearch}
                    onChange={(event) => setPremiumGiftSearch(event.target.value)}
                    placeholder="Buscar regalo premium"
                  />
                  <select
                    className="referral-input"
                    value={selectedGiftId}
                    onChange={(event) => setSelectedGiftId(event.target.value)}
                  >
                    <option value="">Selecciona un regalo premium</option>
                    {premiumProducts
                      .filter((gift) =>
                        gift.nombre.toLowerCase().includes(premiumGiftSearch.toLowerCase()),
                      )
                      .map((gift) => (
                        <option key={gift.id} value={gift.id}>
                          {gift.nombre}
                        </option>
                      ))}
                  </select>
                  <input
                    className="referral-input"
                    value={premiumGiftQtyPartial}
                    onChange={(event) => setPremiumGiftQtyPartial(event.target.value)}
                    placeholder="Cantidad parcial (ej: 1 tazón)"
                  />
                  <label className="form-field checkbox-field">
                    <span>Entregado</span>
                    <input
                      type="checkbox"
                      checked={Boolean(premiumGiftDeliveredAt)}
                      onChange={(event) =>
                        setPremiumGiftDeliveredAt(event.target.checked ? new Date().toISOString() : null)
                      }
                    />
                  </label>
                  {premiumGiftDeliveredAt && (
                    <p className="ci-upload-note">Entregado: {formatDateTime(premiumGiftDeliveredAt)}</p>
                  )}
                </div>
              )}
              <label className="form-field">
                <span>{t('conexiones.activaciones.form.foto')}</span>
                <input type="file" accept="image/*" onChange={handlePhotoChange} />
              </label>
              {photoUploading && <p className="ci-upload-note">{t('conexiones.activaciones.form.fotoUploading')}</p>}
              {photoPreviewUrl && (
                <div className="ci-photo-preview">
                  <img src={photoPreviewUrl} alt={t('conexiones.activaciones.form.fotoAlt')} />
                </div>
              )}
            </div>
          </div>
        )}

        {canSeeStep3 && (
          <div className="ci-step">
            <div className="ci-step-header">
              <span className="ci-step-pill">3</span>
              <div>
                <h4>{t('conexiones.activaciones.steps.whatsapp')}</h4>
                <p>{t('conexiones.activaciones.steps.whatsappHint')}</p>
              </div>
            </div>
            <div className="ci-message-card">
              <p>{messageText}</p>
            </div>
            <div className="ci-message-actions">
              <Button variant="ghost" type="button" onClick={handleCopyMessage}>
                {t('conexiones.activaciones.form.copyMessage')}
              </Button>
              <Button type="button" onClick={handleMarkWhatsappSent} disabled={Boolean(whatsappSentAt)}>
                {t('conexiones.activaciones.form.markSent')}
              </Button>
            </div>
            {whatsappSentAt && (
              <p className="ci-sent-meta">
                {t('conexiones.activaciones.form.sentAt', { date: formatDateTime(whatsappSentAt) })}
              </p>
            )}
          </div>
        )}

        {activationError && <div className="form-error">{activationError}</div>}
      </Modal>

      <Modal
        open={Boolean(selectedActivation)}
        title={selectedActivationTitle}
        onClose={() => setSelectedActivationId(null)}
        className="ci-detail-modal"
        bodyClassName="ci-detail-modal-body"
        actions={
          <Button variant="ghost" type="button" onClick={() => setSelectedActivationId(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {selectedActivation && (
          <div className="ci-detail">
            <div className="ci-detail-grid">
              <div className="card ci-detail-card">
                <dl className="detail-list">
                  <div className="detail-row">
                    <dt>{t('conexiones.activaciones.columns.fecha')}</dt>
                    <dd>{formatDateTime(selectedActivation.fecha_activacion ?? selectedActivation.created_at)}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>{t('conexiones.activaciones.columns.representante')}</dt>
                    <dd>
                      {selectedActivation.representante_id
                        ? usersById[selectedActivation.representante_id] ?? selectedActivation.representante_id
                        : '-'}
                    </dd>
                  </div>
                  <div className="detail-row">
                    <dt>{t('conexiones.activaciones.columns.cliente')}</dt>
                    <dd>
                      {selectedActivation.cliente_id
                        ? clientesMap.get(selectedActivation.cliente_id) ?? selectedActivation.cliente_id
                        : selectedActivation.lead_id
                          ? leadsMap.get(selectedActivation.lead_id) ?? selectedActivation.lead_id
                          : '-'}
                    </dd>
                  </div>
                  <div className="detail-row">
                    <dt>{t('conexiones.activaciones.columns.regalo')}</dt>
                    <dd>
                      {selectedActivation.regalo_id
                        ? giftMap.get(selectedActivation.regalo_id) ?? selectedActivation.regalo_id
                        : '-'}
                    </dd>
                  </div>
                  <div className="detail-row">
                    <dt>Regalo de visita</dt>
                    <dd>
                      {selectedActivation.regalo_visita_id
                        ? giftMap.get(selectedActivation.regalo_visita_id) ??
                        selectedActivation.regalo_visita_id
                        : '-'}
                    </dd>
                  </div>
                  <div className="detail-row">
                    <dt>Cantidad visita</dt>
                    <dd>{selectedActivation.regalo_visita_cantidad ?? '-'}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>Visita entregado</dt>
                    <dd>
                      {selectedActivation.regalo_visita_entregado_at
                        ? formatDateTime(selectedActivation.regalo_visita_entregado_at)
                        : '-'}
                    </dd>
                  </div>
                  <div className="detail-row">
                    <dt>Cantidad parcial premium</dt>
                    <dd>{selectedActivation.regalo_premium_cantidad_parcial ?? '-'}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>Premium entregado</dt>
                    <dd>
                      {selectedActivation.regalo_premium_entregado_at
                        ? formatDateTime(selectedActivation.regalo_premium_entregado_at)
                        : '-'}
                    </dd>
                  </div>
                  <div className="detail-row">
                    <dt>{t('conexiones.activaciones.columns.whatsapp')}</dt>
                    <dd>
                      {(detailWhatsappSentAt ?? selectedActivation.whatsapp_mensaje_enviado_at)
                        ? formatDateTime(detailWhatsappSentAt ?? selectedActivation.whatsapp_mensaje_enviado_at)
                        : t('conexiones.activaciones.whatsapp.pending')}
                    </dd>
                  </div>
                  <div className="detail-row">
                    <dt>{t('conexiones.activaciones.columns.estado')}</dt>
                    <dd>
                      {detailEstadoValue ? (
                        <span className={`badge ci-state ${detailEstadoValue}`.trim()}>
                          {detailEstadoValue === 'completo'
                            ? '🔵'
                            : detailEstadoValue === 'activo'
                              ? '🟢'
                              : '🟡'}{' '}
                          {detailEstadoLabel}
                        </span>
                      ) : (
                        '-'
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="card ci-detail-card">
                <div className="ci-photo-preview">
                  {detailPhotoPreviewUrl ? (
                    <img src={detailPhotoPreviewUrl} alt={t('conexiones.activaciones.form.fotoAlt')} />
                  ) : selectedPhotoUrl ? (
                    <img src={selectedPhotoUrl} alt={t('conexiones.activaciones.form.fotoAlt')} />
                  ) : (
                    <p className="template-empty">{t('conexiones.activaciones.form.fotoMissing')}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="ci-activation-progress">
              <div className={`ci-counter ${detailCanUnlockGift ? 'ready' : 'pending'}`.trim()}>
                <strong>{t('conexiones.activaciones.counter', { count: selectedReferidosCount })}</strong>
                <span>
                  {detailCanUnlockGift
                    ? t('conexiones.activaciones.readyGift')
                    : t('conexiones.activaciones.unlockGift', { count: detailReferidosRemaining })}
                </span>
              </div>
            </div>

            <div className="ci-client-message">
              <h4>{t('conexiones.activaciones.form.clientMessageTitle')}</h4>
              <div className="ci-message-card">
                <p>{clientDiffusionMessage}</p>
              </div>
              <div className="ci-message-actions">
                <Button variant="ghost" type="button" onClick={handleCopyClientMessage}>
                  {t('conexiones.activaciones.form.copyClientMessage')}
                </Button>
              </div>
            </div>

            <div className="ci-activation-actions">
              <div>
                <h4>{t('conexiones.activaciones.steps.regalo')}</h4>
                <div className="ci-gift-visit">
                  <div className="ci-gift-visit-header">
                    <h5>Regalo de visita</h5>
                    <label className="form-field checkbox-field">
                      <span>Aplicar regalo de visita</span>
                      <input
                        type="checkbox"
                        checked={detailVisitGiftEnabled}
                        onChange={(event) => {
                          const enabled = event.target.checked
                          setDetailVisitGiftEnabled(enabled)
                          if (!enabled) {
                            setDetailVisitGiftId('')
                            setDetailVisitGiftQty('1')
                            setDetailVisitGiftDeliveredAt(null)
                            setDetailVisitGiftSearch('')
                          }
                        }}
                      />
                    </label>
                  </div>
                  <p className="form-hint">
                    Opcional: activalo solo cuando la visita amerita entregar un regalo.
                  </p>
                  {visitProducts.length === 0 ? (
                    <div className="template-empty">No hay regalos de visita configurados.</div>
                  ) : (
                    <div className="ci-gift-visit-fields">
                      <input
                        className="referral-input"
                        value={detailVisitGiftSearch}
                        onChange={(event) => setDetailVisitGiftSearch(event.target.value)}
                        placeholder="Buscar regalo"
                        disabled={!detailVisitGiftEnabled}
                      />
                      <select
                        className="referral-input"
                        value={detailVisitGiftId}
                        onChange={(event) => setDetailVisitGiftId(event.target.value)}
                        disabled={!detailVisitGiftEnabled}
                      >
                        <option value="">Selecciona un regalo</option>
                        {visitProducts
                          .filter((gift) =>
                            gift.nombre.toLowerCase().includes(detailVisitGiftSearch.toLowerCase()),
                          )
                          .map((gift) => (
                            <option key={gift.id} value={gift.id}>
                              {gift.nombre}
                            </option>
                          ))}
                      </select>
                      <input
                        className="referral-input"
                        type="number"
                        min={1}
                        value={detailVisitGiftQty}
                        onChange={(event) => setDetailVisitGiftQty(event.target.value)}
                        placeholder="Cantidad"
                        disabled={!detailVisitGiftEnabled}
                      />
                      <label className="form-field checkbox-field">
                        <span>Entregado</span>
                        <input
                          type="checkbox"
                          checked={Boolean(detailVisitGiftDeliveredAt)}
                          onChange={(event) =>
                            setDetailVisitGiftDeliveredAt(
                              event.target.checked ? new Date().toISOString() : null,
                            )
                          }
                          disabled={!detailVisitGiftEnabled}
                        />
                      </label>
                      {detailVisitGiftDeliveredAt && (
                        <p className="ci-upload-note">Entregado: {formatDateTime(detailVisitGiftDeliveredAt)}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="ci-gift-premium">
                  <h5>Regalo premium</h5>
                  {premiumProducts.length === 0 ? (
                    <div className="template-empty">{t('conexiones.activaciones.form.giftEmpty')}</div>
                  ) : (
                    <div className="ci-gift-premium-fields">
                      <input
                        className="referral-input"
                        value={detailPremiumGiftSearch}
                        onChange={(event) => setDetailPremiumGiftSearch(event.target.value)}
                        placeholder="Buscar regalo premium"
                      />
                      <select
                        className="referral-input"
                        value={detailGiftId}
                        onChange={(event) => setDetailGiftId(event.target.value)}
                      >
                        <option value="">Selecciona un regalo premium</option>
                        {premiumProducts
                          .filter((gift) =>
                            gift.nombre.toLowerCase().includes(detailPremiumGiftSearch.toLowerCase()),
                          )
                          .map((gift) => (
                            <option key={gift.id} value={gift.id}>
                              {gift.nombre}
                            </option>
                          ))}
                      </select>
                      <input
                        className="referral-input"
                        value={detailPremiumGiftQtyPartial}
                        onChange={(event) => setDetailPremiumGiftQtyPartial(event.target.value)}
                        placeholder="Cantidad parcial (ej: 1 tazón)"
                      />
                      <label className="form-field checkbox-field">
                        <span>Entregado</span>
                        <input
                          type="checkbox"
                          checked={Boolean(detailPremiumGiftDeliveredAt)}
                          onChange={(event) =>
                            setDetailPremiumGiftDeliveredAt(
                              event.target.checked ? new Date().toISOString() : null,
                            )
                          }
                        />
                      </label>
                      {detailPremiumGiftDeliveredAt && (
                        <p className="ci-upload-note">Entregado: {formatDateTime(detailPremiumGiftDeliveredAt)}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {!detailCanUnlockGift && (
                <p className="template-warning">
                  {t('conexiones.activaciones.unlockGift', { count: detailReferidosRemaining })}
                </p>
              )}
              <label className="form-field">
                <span>{t('conexiones.activaciones.form.foto')}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleDetailPhotoChange}
                  disabled={!detailCanUnlockGift}
                />
              </label>
              {detailPhotoUploading && (
                <p className="ci-upload-note">{t('conexiones.activaciones.form.fotoUploading')}</p>
              )}
              <div className="ci-activation-actions-row">
                <Button
                  type="button"
                  onClick={handleUpdateActivationDetails}
                  disabled={detailUpdating || (detailCanUnlockGift && !detailCanActivate)}
                >
                  {detailUpdating
                    ? t('common.saving')
                    : detailCanUnlockGift
                      ? t('conexiones.activaciones.form.activateProgram')
                      : t('conexiones.activaciones.form.saveGiftSelection')}
                </Button>
              </div>
            </div>

            {detailCanActivate && (
              <div className="ci-whatsapp-section">
                <h4>{t('conexiones.activaciones.steps.whatsapp')}</h4>
                <div className="ci-message-card">
                  <p>{messageText}</p>
                </div>
                <div className="ci-message-actions">
                  <Button variant="ghost" type="button" onClick={handleCopyMessage}>
                    {t('conexiones.activaciones.form.copyMessage')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleMarkDetailWhatsappSent}
                    disabled={detailWhatsappAlreadySent || detailUpdating}
                  >
                    {detailWhatsappAlreadySent
                      ? t('conexiones.activaciones.whatsapp.sent')
                      : t('conexiones.activaciones.form.markSent')}
                  </Button>
                </div>
                {detailWhatsappSentAt && (
                  <p className="ci-sent-meta">
                    {t('conexiones.activaciones.form.sentAt', { date: formatDateTime(detailWhatsappSentAt) })}
                  </p>
                )}
              </div>
            )}

            {detailError && <div className="form-error">{detailError}</div>}

            <div className="ci-referidos-section">
              <h4>{t('conexiones.activaciones.referidos.title')}</h4>
              <div className="ci-referidos-add">
                <input
                  className="referral-input"
                  value={newReferidoForm.nombre}
                  onChange={(event) =>
                    setNewReferidoForm((prev) => ({ ...prev, nombre: event.target.value }))
                  }
                  placeholder={t('conexiones.activaciones.form.referidoNombre')}
                />
                <input
                  className="referral-input"
                  value={newReferidoForm.telefono}
                  onChange={(event) =>
                    setNewReferidoForm((prev) => ({
                      ...prev,
                      telefono: formatPhone(event.target.value),
                    }))
                  }
                  placeholder={t('conexiones.activaciones.form.referidoTelefono')}
                />
                <select
                  className="referral-input"
                  value={newReferidoForm.relacion}
                  onChange={(event) =>
                    setNewReferidoForm((prev) => ({
                      ...prev,
                      relacion: event.target.value as CiRelacion,
                    }))
                  }
                >
                  {CI_RELACIONES.map((option) => (
                    <option key={option} value={option}>
                      {t(`conexiones.activaciones.relaciones.${option}`)}
                    </option>
                  ))}
                </select>
                <Button type="button" onClick={handleAddReferidoToActivation} disabled={detailUpdating}>
                  {t('conexiones.activaciones.referidos.add')}
                </Button>
              </div>
              <div className="referral-subtable-scroll">
                <table className="referral-subtable">
                  <thead>
                    <tr>
                      <th>{t('conexiones.activaciones.referidos.columns.nombre')}</th>
                      <th>{t('conexiones.activaciones.referidos.columns.telefono')}</th>
                      <th>{t('conexiones.activaciones.referidos.columns.relacion')}</th>
                      <th>{t('conexiones.activaciones.referidos.columns.estado')}</th>
                      <th>{t('conexiones.activaciones.referidos.columns.acciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedReferidos.length === 0 ? (
                      <tr>
                        <td colSpan={5}>{t('common.noData')}</td>
                      </tr>
                    ) : (
                      selectedReferidos.map((referido) => (
                        <tr key={referido.id}>
                          <td>
                            <input
                              className="referral-input"
                              value={getReferidoDraftValue(referido, 'nombre')}
                              onChange={handleReferidoDraftChange(referido.id, 'nombre')}
                            />
                          </td>
                          <td>
                            <input
                              className="referral-input"
                              value={getReferidoDraftValue(referido, 'telefono')}
                              onChange={handleReferidoDraftChange(referido.id, 'telefono')}
                            />
                          </td>
                          <td>
                            <select
                              className="referral-input"
                              value={getReferidoDraftValue(referido, 'relacion')}
                              onChange={handleReferidoDraftChange(referido.id, 'relacion')}
                            >
                              {CI_RELACIONES.map((option) => (
                                <option key={option} value={option}>
                                  {t(`conexiones.activaciones.relaciones.${option}`)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={referido.estado ?? 'pendiente'}
                              onChange={(event) =>
                                handleUpdateReferidoEstado(referido.id, event.target.value)
                              }
                              disabled={referidoUpdatingId === referido.id}
                            >
                              {CI_REFERIDO_ESTADOS.map((state) => (
                                <option key={state} value={state}>
                                  {t(`conexiones.activaciones.referidos.states.${state}`)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <div className="referral-row-actions">
                              <Button
                                variant="ghost"
                                type="button"
                                onClick={() => handleSaveReferido(referido)}
                                disabled={referidoSavingId === referido.id}
                              >
                                {referidoSavingId === referido.id
                                  ? t('common.saving')
                                  : t('conexiones.activaciones.referidos.save')}
                              </Button>
                              <button
                                type="button"
                                className="whatsapp-button"
                                aria-label={t('conexiones.activaciones.referidos.actions.whatsapp')}
                                onClick={() =>
                                  openWhatsapp({
                                    nombre: referido.nombre ?? '',
                                    telefono: referido.telefono ?? '',
                                    vendedor: representante?.nombre ?? '',
                                    recomendadoPor: selectedActivationOwnerName,
                                    leadId: referido.lead_id,
                                  })
                                }
                                disabled={!referido.telefono}
                              >
                                <IconWhatsapp className="whatsapp-icon" />
                              </button>
                              <Button
                                variant="ghost"
                                type="button"
                                onClick={() => handleCreateLeadFromReferido(referido)}
                                disabled={Boolean(referido.lead_id) || referidoLeadCreatingId === referido.id}
                              >
                                {referido.lead_id
                                  ? t('conexiones.activaciones.referidos.actions.leadCreated')
                                  : t('conexiones.activaciones.referidos.actions.createLead')}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <ModalRenderer />
    </div>
  )
}

export function ConexionesActivacionesTabLegacy2() {
  const { t, i18n } = useTranslation()
  const { showToast } = useToast()
  const {
    configured,
    loading,
    error,
    data,
    addReferido,
    updateActivacion,
    searchProductos,
    fetchProductosByIds,
    createActivacionOwner,
  } = useConexiones({ mode: 'activaciones', autoLoad: true })
  const { activaciones, referidos, clientes, leads } = data
  const [referidoSaving, setReferidoSaving] = useState(false)
  const [referidoError, setReferidoError] = useState<string | null>(null)
  const [newReferidoForm, setNewReferidoForm] = useState<ReferidoFormRow>({ ...initialCiReferidoRow })
  const [ownerMode, setOwnerMode] = useState<'cliente' | 'prospecto'>('cliente')
  const [ownerSearch, setOwnerSearch] = useState('')
  const [visitSearch, setVisitSearch] = useState('')
  const [visitResults, setVisitResults] = useState<GiftProduct[]>([])
  const [visitSelected, setVisitSelected] = useState<GiftProduct | null>(null)
  const [visitSearching, setVisitSearching] = useState(false)
  const [visitSaving, setVisitSaving] = useState(false)
  const [premiumSearch, setPremiumSearch] = useState('')
  const [premiumResults, setPremiumResults] = useState<GiftProduct[]>([])
  const [premiumSelected, setPremiumSelected] = useState<GiftProduct | null>(null)
  const [premiumSearching, setPremiumSearching] = useState(false)
  const [premiumSaving, setPremiumSaving] = useState(false)

  const dateTimeFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const formatDateTime = useCallback(
    (value?: string | null) => {
      if (!value) return '-'
      return dateTimeFormat.format(new Date(value))
    },
    [dateTimeFormat],
  )

  const activation = activaciones[0] ?? null
  const referidosCount = referidos.length
  const progressValue = Math.min(referidosCount, MIN_REFERIDOS_CI) / MIN_REFERIDOS_CI
  const extraReferidos = Math.max(0, referidosCount - MIN_REFERIDOS_CI)
  const premiumUnlocked = referidosCount >= MIN_REFERIDOS_CI
  const ownerLabel = useMemo(() => {
    if (!activation) return '-'
    if (activation.cliente_id) {
      const owner = clientes.find((item) => item.id === activation.cliente_id)
      if (!owner) return activation.cliente_id
      return [owner.nombre, owner.apellido].filter(Boolean).join(' ').trim() || owner.id
    }
    if (activation.lead_id) {
      const owner = leads.find((item) => item.id === activation.lead_id)
      if (!owner) return activation.lead_id
      return [owner.nombre, owner.apellido].filter(Boolean).join(' ').trim() || owner.id
    }
    return '-'
  }, [activation, clientes, leads])

  const ownerSearchTerm = ownerSearch.trim().toLowerCase()
  const ownerSearchPhone = stripPhone(ownerSearchTerm)
  const filteredOwners = useMemo(() => {
    if (!ownerSearchTerm) return []
    if (ownerMode === 'cliente') {
      return clientes.filter((cliente) => {
        const fullName = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ').toLowerCase()
        const phone = stripPhone(cliente.telefono ?? '')
        const matchesPhone = ownerSearchPhone ? phone.includes(ownerSearchPhone) : false
        return fullName.includes(ownerSearchTerm) || matchesPhone
      })
    }
    return leads.filter((lead) => {
      const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ').toLowerCase()
      const phone = stripPhone(lead.telefono ?? '')
      const matchesPhone = ownerSearchPhone ? phone.includes(ownerSearchPhone) : false
      return fullName.includes(ownerSearchTerm) || matchesPhone
    })
  }, [clientes, leads, ownerMode, ownerSearchPhone, ownerSearchTerm])

  const productLabel = useCallback((product: GiftProduct) => {
    const code = product.codigo?.trim()
    return code ? `${code} - ${product.nombre}` : product.nombre
  }, [])

  useEffect(() => {
    let active = true
    const ids = [activation?.regalo_visita_id, activation?.regalo_id].filter(Boolean) as string[]
    if (!activation || ids.length === 0) {
      setVisitSelected(null)
      setPremiumSelected(null)
      return
    }
    fetchProductosByIds(ids).then(({ data: products, error: fetchError }) => {
      if (!active) return
      if (fetchError || !products) return
      const visit = products.find((item) => item.id === activation.regalo_visita_id) ?? null
      const premium = products.find((item) => item.id === activation.regalo_id) ?? null
      setVisitSelected(visit)
      setPremiumSelected(premium)
    })
    return () => {
      active = false
    }
  }, [activation, fetchProductosByIds])

  useEffect(() => {
    let active = true
    const term = visitSearch.trim()
    if (!term) {
      setVisitResults([])
      setVisitSearching(false)
      return
    }
    setVisitSearching(true)
    const handle = window.setTimeout(() => {
      searchProductos(term).then(({ data: products, error: searchError }) => {
        if (!active) return
        if (searchError || !products) {
          setVisitResults([])
          setVisitSearching(false)
          return
        }
        setVisitResults(products)
        setVisitSearching(false)
      })
    }, 350)
    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [searchProductos, visitSearch])

  useEffect(() => {
    let active = true
    const term = premiumSearch.trim()
    if (!term) {
      setPremiumResults([])
      setPremiumSearching(false)
      return
    }
    setPremiumSearching(true)
    const handle = window.setTimeout(() => {
      searchProductos(term).then(({ data: products, error: searchError }) => {
        if (!active) return
        if (searchError || !products) {
          setPremiumResults([])
          setPremiumSearching(false)
          return
        }
        setPremiumResults(products)
        setPremiumSearching(false)
      })
    }, 350)
    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [premiumSearch, searchProductos])

  const handleAddReferido = async () => {
    if (!configured || !activation) return
    setReferidoError(null)
    const nombre = newReferidoForm.nombre.trim()
    const telefono = stripPhone(newReferidoForm.telefono)
    if (!nombre || !telefono) {
      setReferidoError(t('conexiones.activaciones.errors.referidoIncompleto'))
      return
    }
    setReferidoSaving(true)
    const { error: addError } = await addReferido(activation.id, {
      nombre,
      telefono: newReferidoForm.telefono,
      relacion: newReferidoForm.relacion,
    })
    if (addError) {
      setReferidoError(addError)
      showToast(addError, 'error')
    } else {
      setNewReferidoForm({ ...initialCiReferidoRow })
    }
    setReferidoSaving(false)
  }

  const handleMarkVisitDelivered = async () => {
    if (!configured || !activation) return
    if (!visitSelected) {
      showToast('Selecciona un regalo de visita antes de marcar como entregado.', 'error')
      return
    }
    setVisitSaving(true)
    const { error: updateError } = await updateActivacion(activation.id, {
      regalo_visita_id: visitSelected.id,
      regalo_visita_entregado_at: new Date().toISOString(),
    })
    if (updateError) {
      showToast(updateError, 'error')
    } else {
      showToast(t('toast.success'))
    }
    setVisitSaving(false)
  }

  const handleMarkPremiumDelivered = async () => {
    if (!configured || !activation) return
    if (!premiumUnlocked) {
      showToast('El regalo premium se habilita al llegar a 20 referidos.', 'error')
      return
    }
    if (!premiumSelected) {
      showToast('Selecciona un regalo premium antes de marcar como entregado.', 'error')
      return
    }
    setPremiumSaving(true)
    const giftName = productLabel(premiumSelected)
    const { error: updateError } = await updateActivacion(activation.id, {
      regalo_id: premiumSelected.id,
      regalo_premium_entregado_at: new Date().toISOString(),
      regalo_nombre: giftName,
    })
    if (updateError) {
      showToast(updateError, 'error')
    } else {
      showToast(t('toast.success'))
    }
    setPremiumSaving(false)
  }

  const handleSelectOwner = async (id: string) => {
    if (!configured) return
    if (!activation) {
      const { error: createError } = await createActivacionOwner(
        ownerMode === 'cliente' ? { clienteId: id } : { leadId: id },
      )
      if (createError) {
        showToast(createError, 'error')
        return
      }
      setOwnerSearch('')
      showToast(t('toast.success'))
      return
    }
    const payload = ownerMode === 'cliente' ? { cliente_id: id, lead_id: null } : { lead_id: id, cliente_id: null }
    const { error: updateError } = await updateActivacion(activation.id, payload)
    if (updateError) {
      showToast(updateError, 'error')
      return
    }
    setOwnerSearch('')
    showToast(t('toast.success'))
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('conexiones.activaciones.title')}
        subtitle={t('conexiones.activaciones.subtitle')}
      />

      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="form-hint">{t('common.loading')}</div>}

      {!loading && !activation && configured && (
        <div className="form-hint">No hay activaciones activas para mostrar.</div>
      )}

      <>
        <div className="card">
          <h4>Como funciona el programa</h4>
          <p className="form-hint">1) Visita al cliente y registra el regalo de visita si aplica.</p>
          <p className="form-hint">2) Agrega los referidos del cliente (meta: 20).</p>
          <p className="form-hint">
            3) Al llegar a 20 referidos se habilita el regalo premium.
          </p>
        </div>

        <div className="card">
          <h4>Dueno del programa</h4>
          <p className="form-hint">Actual: {ownerLabel}</p>
          <div className="ci-owner-actions">
            <Button
              variant={ownerMode === 'cliente' ? 'primary' : 'ghost'}
              type="button"
              onClick={() => setOwnerMode('cliente')}
            >
              Cliente
            </Button>
            <Button
              variant={ownerMode === 'prospecto' ? 'primary' : 'ghost'}
              type="button"
              onClick={() => setOwnerMode('prospecto')}
            >
              Prospecto
            </Button>
          </div>
          <label className="form-field">
            <span>Buscar por nombre o telefono</span>
            <input
              value={ownerSearch}
              onChange={(event) => setOwnerSearch(event.target.value)}
              placeholder={ownerMode === 'cliente' ? 'Buscar cliente' : 'Buscar prospecto'}
            />
          </label>
          {ownerSearchTerm ? (
            <div className="ci-owner-results">
              {filteredOwners.length === 0 ? (
                <span className="ci-owner-empty">{t('common.noData')}</span>
              ) : (
                filteredOwners.map((owner) => {
                  const name = [owner.nombre, owner.apellido].filter(Boolean).join(' ') || owner.id
                  return (
                    <button
                      key={owner.id}
                      type="button"
                      className="ci-owner-option"
                      onClick={() => handleSelectOwner(owner.id)}
                    >
                      <span>{name}</span>
                      <span className="ci-owner-meta">{owner.telefono ?? '-'}</span>
                    </button>
                  )
                })
              )}
            </div>
          ) : (
            <p className="ci-owner-hint">Selecciona el dueno del programa para iniciar.</p>
          )}
        </div>

        {activation && (
          <div className="card">
            <h4>{t('conexiones.activaciones.referidos.title')}</h4>
            <div className="ci-activation-progress">
              <div className="ci-counter">
                <strong>{t('conexiones.activaciones.counter', { count: referidosCount })}</strong>
                <span>
                  Meta: {MIN_REFERIDOS_CI}
                  {extraReferidos > 0 ? ` · Extra: +${extraReferidos}` : ''}
                </span>
              </div>
              <div className="conexiones-progress" title={`Progreso: ${referidosCount}/${MIN_REFERIDOS_CI}`}>
                <div
                  className="conexiones-progress-bar"
                  style={{ width: `${Math.round(progressValue * 100)}%` }}
                />
              </div>
            </div>

            <div className="ci-referidos-add">
              <input
                className="referral-input"
                value={newReferidoForm.nombre}
                onChange={(event) =>
                  setNewReferidoForm((prev) => ({ ...prev, nombre: event.target.value }))
                }
                placeholder={t('conexiones.activaciones.form.referidoNombre')}
              />
              <input
                className="referral-input"
                value={newReferidoForm.telefono}
                onChange={(event) =>
                  setNewReferidoForm((prev) => ({
                    ...prev,
                    telefono: formatPhone(event.target.value),
                  }))
                }
                placeholder={t('conexiones.activaciones.form.referidoTelefono')}
              />
              <select
                className="referral-input"
                value={newReferidoForm.relacion}
                onChange={(event) =>
                  setNewReferidoForm((prev) => ({
                    ...prev,
                    relacion: event.target.value as CiRelacion,
                  }))
                }
              >
                {CI_RELACIONES.map((option) => (
                  <option key={option} value={option}>
                    {t(`conexiones.activaciones.relaciones.${option}`)}
                  </option>
                ))}
              </select>
              <Button type="button" onClick={handleAddReferido} disabled={referidoSaving}>
                {referidoSaving ? t('common.saving') : t('conexiones.activaciones.referidos.add')}
              </Button>
            </div>
            {referidoError && <div className="form-error">{referidoError}</div>}
            <div className="referral-subtable-scroll">
              <table className="referral-subtable">
                <thead>
                  <tr>
                    <th>{t('conexiones.activaciones.referidos.columns.nombre')}</th>
                    <th>{t('conexiones.activaciones.referidos.columns.telefono')}</th>
                    <th>{t('conexiones.activaciones.referidos.columns.relacion')}</th>
                  </tr>
                </thead>
                <tbody>
                  {referidos.length === 0 ? (
                    <tr>
                      <td colSpan={3}>{t('common.noData')}</td>
                    </tr>
                  ) : (
                    referidos.map((referido) => (
                      <tr key={referido.id}>
                        <td>{referido.nombre ?? '-'}</td>
                        <td>{formatPhone(referido.telefono ?? '')}</td>
                        <td>{t(`conexiones.activaciones.relaciones.${referido.relacion ?? 'familiar'}`)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activation && (
          <div className="card">
            <h4>{t('conexiones.activaciones.steps.regalo')}</h4>
            <div className="ci-gift-visit">
              <h5>Regalo de visita</h5>
              <label className="form-field">
                <span>Buscar por codigo o nombre</span>
                <input
                  value={visitSearch}
                  onChange={(event) => setVisitSearch(event.target.value)}
                  placeholder="Ej: RV-001 o Tazon"
                />
              </label>
              <label className="form-field">
                <span>Selecciona regalo de visita</span>
                <select
                  value={visitSelected?.id ?? ''}
                  onChange={(event) => {
                    const selected = visitResults.find((item) => item.id === event.target.value) ?? null
                    setVisitSelected(selected)
                  }}
                >
                  <option value="">
                    {visitSearching ? 'Buscando regalos...' : 'Selecciona un regalo'}
                  </option>
                  {visitResults.map((product) => (
                    <option key={product.id} value={product.id}>
                      {productLabel(product)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-hint">
                {visitSelected
                  ? `Seleccionado: ${productLabel(visitSelected)}`
                  : activation.regalo_visita_id
                    ? `Seleccionado: ${activation.regalo_visita_id}`
                    : 'No hay regalo de visita seleccionado.'}
              </p>
              <div className="ci-activation-actions-row">
                <Button type="button" onClick={handleMarkVisitDelivered} disabled={visitSaving || !visitSelected}>
                  {visitSaving ? t('common.saving') : 'Marcar Regalo de Visita Entregado'}
                </Button>
                {activation.regalo_visita_entregado_at && (
                  <span className="form-hint">
                    Entregado: {formatDateTime(activation.regalo_visita_entregado_at)}
                  </span>
                )}
              </div>
            </div>

            <div className={`ci-gift-premium ${premiumUnlocked ? '' : 'disabled'}`.trim()}>
              <h5>Regalo premium</h5>
              {!premiumUnlocked && (
                <p className="template-warning">
                  Falta(n) {Math.max(0, MIN_REFERIDOS_CI - referidosCount)} referido(s) para habilitar el regalo premium.
                </p>
              )}
              <label className="form-field">
                <span>Buscar por codigo o nombre</span>
                <input
                  value={premiumSearch}
                  onChange={(event) => setPremiumSearch(event.target.value)}
                  placeholder="Ej: RP-001 o Vajilla"
                  disabled={!premiumUnlocked}
                />
              </label>
              <label className="form-field">
                <span>Selecciona regalo premium</span>
                <select
                  value={premiumSelected?.id ?? ''}
                  onChange={(event) => {
                    const selected = premiumResults.find((item) => item.id === event.target.value) ?? null
                    setPremiumSelected(selected)
                  }}
                  disabled={!premiumUnlocked}
                >
                  <option value="">
                    {premiumSearching ? 'Buscando regalos...' : 'Selecciona un regalo'}
                  </option>
                  {premiumResults.map((product) => (
                    <option key={product.id} value={product.id}>
                      {productLabel(product)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-hint">
                {premiumSelected
                  ? `Seleccionado: ${productLabel(premiumSelected)}`
                  : activation.regalo_id
                    ? `Seleccionado: ${activation.regalo_id}`
                    : 'No hay regalo premium seleccionado.'}
              </p>
              <div className="ci-activation-actions-row">
                <Button
                  type="button"
                  onClick={handleMarkPremiumDelivered}
                  disabled={premiumSaving || !premiumUnlocked || !premiumSelected}
                >
                  {premiumSaving ? t('common.saving') : 'Marcar Regalo Premium Entregado'}
                </Button>
                {activation.regalo_premium_entregado_at && (
                  <span className="form-hint">
                    Entregado: {formatDateTime(activation.regalo_premium_entregado_at)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    </div>
  )
}

function ConexionesActivacionesTab() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const { usersById } = useUsers()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const [hasDistribuidorScope, setHasDistribuidorScope] = useState(false)
  const { viewMode, distributionUserIds } = useViewMode()
  const { currentUser } = useUsers()
  const [currentUserLabel, setCurrentUserLabel] = useState<string | null>(null)
  const [programId, setProgramId] = useState<string | null>(null)
  const [activaciones, setActivaciones] = useState<CiActivacion[]>([])
  const [ownerClienteMap, setOwnerClienteMap] = useState<Record<string, string>>({})
  const [ownerLeadMap, setOwnerLeadMap] = useState<Record<string, string>>({})
  const [representanteMap, setRepresentanteMap] = useState<Record<string, string>>({})
  const [referidosCount, setReferidosCount] = useState<Record<string, number>>({})
  const [tab, setTab] = useState<'activa' | 'cerrada'>('activa')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(50)
  const [isMobile, setIsMobile] = useState(false)
  const [sortColAct, setSortColAct] = useState<number | null>(null)
  const [sortDirAct, setSortDirAct] = useState<'asc' | 'desc'>('asc')
  const [selectedActivation, setSelectedActivation] = useState<CiActivacion | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardOwnerId, setWizardOwnerId] = useState<string | null>(null)
  const [wizardOwnerType, setWizardOwnerType] = useState<'cliente' | 'prospecto'>('cliente')
  const [wizardOwnerLabel, setWizardOwnerLabel] = useState<string | null>(null)
  const [ownerSearch, setOwnerSearch] = useState('')
  const [ownerResults, setOwnerResults] = useState<OwnerCandidate[]>([])
  const [ownerSearching, setOwnerSearching] = useState(false)
  const [wizardError, setWizardError] = useState<string | null>(null)
  const [wizardSaving, setWizardSaving] = useState(false)
  const [distributionIds, setDistributionIds] = useState<string[]>([])
  const [ownerEditOpen, setOwnerEditOpen] = useState(false)
  const [ownerEditType, setOwnerEditType] = useState<'cliente' | 'prospecto'>('cliente')
  const [ownerEditId, setOwnerEditId] = useState<string | null>(null)
  const [ownerEditSearch, setOwnerEditSearch] = useState('')
  const [ownerEditResults, setOwnerEditResults] = useState<OwnerCandidate[]>([])
  const [ownerEditSearching, setOwnerEditSearching] = useState(false)
  const [ownerEditSaving, setOwnerEditSaving] = useState(false)
  const [ownerEditError, setOwnerEditError] = useState<string | null>(null)
  const [ownerEditPhone, setOwnerEditPhone] = useState<string | null>(null)

  const dateTimeFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const formatDateTime = useCallback(
    (value?: string | null) => {
      if (!value) return '-'
      return dateTimeFormat.format(new Date(value))
    },
    [dateTimeFormat],
  )

  const formatRelativeTime = useCallback(
    (value?: string | null) => {
      if (!value) return '-'
      const diffMs = Date.now() - new Date(value).getTime()
      const minutes = Math.max(1, Math.floor(diffMs / 60000))
      if (diffMs < 60 * 60 * 1000) {
        return t('conexiones.activaciones.relative.minutes', { count: minutes })
      }
      const hours = Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)))
      if (diffMs < 24 * 60 * 60 * 1000) {
        return t('conexiones.activaciones.relative.hours', { count: hours })
      }
      const days = Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)))
      return t('conexiones.activaciones.relative.days', { count: days })
    },
    [t],
  )

  const cutoffDate = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() - CI_CLOSED_DAYS)
    return date
  }, [])

  const isClosed = useCallback(
    (activation: CiActivacion) => {
      if (activation.estado === 'cerrado') return true
      const lastActivity = activation.updated_at ?? activation.created_at
      if (!lastActivity) return false
      return new Date(lastActivity) < cutoffDate
    },
    [cutoffDate],
  )

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const effectiveScope: 'mine' | 'distribution' =
    role === 'admin' || role === 'distribuidor'
      ? 'distribution'
      : hasDistribuidorScope && viewMode === 'distributor'
        ? 'distribution'
        : 'mine'

  const loadRoleAndProgram = useCallback(async () => {
    if (!configured || !session?.user.id) return
    setError(null)
    const [roleResult, programResult] = await Promise.all([
      supabase
        .from('usuarios')
        .select('rol, nombre, apellido, codigo_distribuidor')
        .eq('id', session.user.id)
        .maybeSingle(),
      supabase
        .from('programas')
        .select('id')
        .eq('activo', true)
        .ilike('nombre', '%conexiones infinitas%')
        .limit(1)
        .maybeSingle(),
    ])

    if (roleResult.error) {
      setError(roleResult.error.message)
      return
    }
    const nextRole = roleResult.data?.rol ?? null
    setRole(nextRole)
    const nameLabel = [roleResult.data?.nombre, roleResult.data?.apellido].filter(Boolean).join(' ').trim()
    setCurrentUserLabel(nameLabel || session.user.id)
    const nextDistribuidorCode = roleResult.data?.codigo_distribuidor ?? null
    setHasDistribuidorScope(nextRole === 'admin' || nextRole === 'distribuidor' || Boolean(nextDistribuidorCode))

    if (programResult.error || !programResult.data?.id) {
      setError(t('conexiones.activaciones.errors.programMissing'))
      setProgramId(null)
      return
    }
    setProgramId(programResult.data.id)
  }, [configured, session?.user.id, t])

  const loadActivaciones = useCallback(async () => {
    if (!configured || !session?.user.id || !programId) return
    setLoading(true)
    setError(null)

    let query = supabase
      .from('ci_activaciones')
      .select('id, representante_id, estado, updated_at, created_at, programa_id, cliente_id, lead_id')
      .eq('programa_id', programId)

    if (role === 'telemercadeo' || role === 'supervisor_telemercadeo') {
      const { data: assignments } = await supabase
        .from('tele_vendedor_assignments')
        .select('vendedor_id')
        .eq('tele_id', session.user.id)
      const ids = (assignments ?? []).map((a) => a.vendedor_id)

      if (ids.length === 0) {
        setActivaciones([])
        setReferidosCount({})
        setLoading(false)
        return
      }
      query = query.in('representante_id', ids)
    } else if (role === 'vendedor' || (hasDistribuidorScope && effectiveScope === 'mine')) {
      query = query.eq('representante_id', session.user.id)
    } else if (hasDistribuidorScope && effectiveScope === 'distribution') {
      if (role === 'admin') {
        // Admin: see all activaciones (no representante filter)
        // Keep query scoped only by programa_id
      } else {
      let distIds = distributionUserIds
      let codigoDistribuidor = currentUser?.codigo_distribuidor ?? null
      if (!codigoDistribuidor) {
        const { data } = await supabase
          .from('usuarios')
          .select('codigo_distribuidor')
          .eq('id', session.user.id)
          .maybeSingle()
        codigoDistribuidor = (data as { codigo_distribuidor?: string | null } | null)?.codigo_distribuidor ?? null
      }
      if (distIds.length === 0) {
        let distQuery = supabase
          .from('usuarios')
          .select('id')
          .eq('activo', true)
        if (codigoDistribuidor) {
          distQuery = distQuery.or(
            `codigo_distribuidor.eq.${codigoDistribuidor},distribuidor_padre_id.eq.${session.user.id}`,
          )
        } else {
          distQuery = distQuery.eq('distribuidor_padre_id', session.user.id)
        }
        const { data, error: distError } = await distQuery
        if (distError) {
          setError(distError.message)
        } else {
          distIds = (data ?? []).map((row) => row.id)
        }
      }
      if (session.user.id && !distIds.includes(session.user.id)) distIds.push(session.user.id)
      setDistributionIds(distIds)
      if (distIds.length === 0) {
        setActivaciones([])
        setReferidosCount({})
        setLoading(false)
        return
      }
      query = query.in('representante_id', distIds)
      }
    }

    const cutoffIso = cutoffDate.toISOString()
    if (tab === 'cerrada') {
      query = query.or(
        `estado.eq.cerrado,updated_at.lt.${cutoffIso},and(updated_at.is.null,created_at.lt.${cutoffIso})`,
      )
    } else {
      query = query.neq('estado', 'cerrado')

      // Relaxed cutoff for distribution/admin/tele views to ensure they see data even if inactive
      const isTeamView = effectiveScope === 'distribution' || role === 'admin' || role === 'telemercadeo' || role === 'supervisor_telemercadeo'
      if (!isTeamView) {
        query = query.or(`updated_at.gte.${cutoffIso},and(updated_at.is.null,created_at.gte.${cutoffIso})`)
      }
    }

    const { data, error: fetchError } = await query.order('updated_at', { ascending: false }).limit(limit)
    if (fetchError) {
      setError(fetchError.message)
      setActivaciones([])
      setReferidosCount({})
      setLoading(false)
      return
    }

    const rows = ((data as CiActivacion[]) ?? []).slice().sort((a, b) => {
      const timeA = new Date(a.updated_at ?? a.created_at ?? 0).getTime()
      const timeB = new Date(b.updated_at ?? b.created_at ?? 0).getTime()
      return timeB - timeA
    })
    setActivaciones(rows)

    const activationIds = rows.map((row) => row.id)
    if (activationIds.length === 0) {
      setOwnerClienteMap({})
      setOwnerLeadMap({})
      setRepresentanteMap({})
      setReferidosCount({})
      setLoading(false)
      return
    }

    const representanteIds = Array.from(
      new Set(rows.map((row) => row.representante_id).filter((value): value is string => Boolean(value))),
    )
    const clienteIds = Array.from(
      new Set(rows.map((row) => row.cliente_id).filter((value): value is string => Boolean(value))),
    )
    const leadIds = Array.from(
      new Set(rows.map((row) => row.lead_id).filter((value): value is string => Boolean(value))),
    )

    const [representantesResult, clientesResult, leadsResult, referidosResult] = await Promise.all([
      representanteIds.length > 0
        ? supabase.from('usuarios').select('id, nombre, apellido').in('id', representanteIds)
        : Promise.resolve({ data: [], error: null }),
      clienteIds.length > 0
        ? supabase.from('clientes').select('id, nombre, apellido').in('id', clienteIds)
        : Promise.resolve({ data: [], error: null }),
      leadIds.length > 0
        ? supabase.from('leads').select('id, nombre, apellido').in('id', leadIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('ci_referidos').select('activacion_id').in('activacion_id', activationIds),
    ])

    if (representantesResult.error) {
      setError(representantesResult.error.message)
    }
    if (clientesResult.error) {
      setError(clientesResult.error.message)
    }
    if (leadsResult.error) {
      setError(leadsResult.error.message)
    }

    const representanteNameMap: Record<string, string> = {}
      ; ((representantesResult.data ?? []) as UsuarioRecord[]).forEach((user) => {
        const label = [user.nombre, user.apellido].filter(Boolean).join(' ').trim()
        representanteNameMap[user.id] = label || user.id
      })

    const clienteNameMap: Record<string, string> = {}
      ; ((clientesResult.data ?? []) as Array<{ id: string; nombre: string | null; apellido: string | null }>).forEach(
        (cliente) => {
          const label = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ').trim()
          clienteNameMap[cliente.id] = label || cliente.id
        },
      )

    const leadNameMap: Record<string, string> = {}
      ; ((leadsResult.data ?? []) as Array<{ id: string; nombre: string | null; apellido: string | null }>).forEach(
        (lead) => {
          const label = [lead.nombre, lead.apellido].filter(Boolean).join(' ').trim()
          leadNameMap[lead.id] = label || lead.id
        },
      )

    const counts: Record<string, number> = {}
      ; ((referidosResult.data ?? []) as { activacion_id: string | null }[]).forEach((row) => {
        if (!row.activacion_id) return
        counts[row.activacion_id] = (counts[row.activacion_id] ?? 0) + 1
      })

    setOwnerClienteMap(clienteNameMap)
    setOwnerLeadMap(leadNameMap)
    setRepresentanteMap(representanteNameMap)
    setReferidosCount(counts)
    setLoading(false)
  }, [
    configured,
    session?.user.id,
    programId,
    role,
    effectiveScope,
    tab,
    limit,
    cutoffDate,
    distributionIds,
    distributionUserIds,
    currentUser?.codigo_distribuidor,
  ])

  useEffect(() => {
    loadRoleAndProgram()
  }, [loadRoleAndProgram])

  useEffect(() => {
    if (!programId || !role) return
    loadActivaciones()
  }, [loadActivaciones, programId, role, distributionUserIds])

  useEffect(() => {
    if (!wizardOpen) {
      setWizardStep(1)
      setWizardError(null)
      setOwnerSearch('')
      setOwnerResults([])
      setWizardOwnerId(null)
      setWizardOwnerType('cliente')
      setWizardOwnerLabel(null)
    }
  }, [wizardOpen])

  useEffect(() => {
    let active = true
    const term = ownerSearch.trim()
    if (!wizardOpen || term.length < 2) {
      setOwnerResults([])
      setOwnerSearching(false)
      return
    }
    setOwnerSearching(true)
    const handle = window.setTimeout(() => {
      const run = async () => {
        const table = wizardOwnerType === 'cliente' ? 'clientes' : 'leads'
        let query = supabase
          .from(table)
          .select('id, nombre, apellido, telefono')
          .or(`nombre.ilike.%${term}%,apellido.ilike.%${term}%,telefono.ilike.%${term}%`)
          .limit(20)

        const { data, error: searchError } = await query
        if (!active) return
        if (searchError) {
          setOwnerResults([])
          setOwnerSearching(false)
          return
        }
        const results = ((data as Array<{ id: string; nombre: string | null; apellido: string | null; telefono: string | null }>) ?? []).map(
          (row) => ({ ...row, type: wizardOwnerType }),
        )
        setOwnerResults(results)
        setOwnerSearching(false)
      }
      void run()
    }, 350)
    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [ownerSearch, wizardOpen, wizardOwnerType])

  useEffect(() => {
    if (!ownerEditOpen || !selectedActivation) return
    const ownerId = selectedActivation.cliente_id ?? selectedActivation.lead_id ?? null
    const ownerTable = selectedActivation.cliente_id ? 'clientes' : 'leads'
    if (selectedActivation.cliente_id) {
      setOwnerEditType('cliente')
      setOwnerEditId(selectedActivation.cliente_id)
    } else if (selectedActivation.lead_id) {
      setOwnerEditType('prospecto')
      setOwnerEditId(selectedActivation.lead_id)
    } else {
      setOwnerEditType('cliente')
      setOwnerEditId(null)
    }
    setOwnerEditSearch('')
    setOwnerEditResults([])
    setOwnerEditError(null)
    setOwnerEditPhone(null)
    if (ownerId && configured) {
      void supabase
        .from(ownerTable)
        .select('telefono')
        .eq('id', ownerId)
        .maybeSingle()
        .then(({ data }) => { if (data) setOwnerEditPhone((data as { telefono: string | null }).telefono ?? null) })
    }
  }, [ownerEditOpen, selectedActivation, configured])

  useEffect(() => {
    let active = true
    const term = ownerEditSearch.trim()
    if (!ownerEditOpen || term.length < 2) {
      setOwnerEditResults([])
      setOwnerEditSearching(false)
      return
    }
    setOwnerEditSearching(true)
    const handle = window.setTimeout(() => {
      const run = async () => {
        const table = ownerEditType === 'cliente' ? 'clientes' : 'leads'
        const query = supabase
          .from(table)
          .select('id, nombre, apellido, telefono')
          .or(`nombre.ilike.%${term}%,apellido.ilike.%${term}%,telefono.ilike.%${term}%`)
          .limit(20)

        const { data, error: searchError } = await query
        if (!active) return
        if (searchError) {
          setOwnerEditResults([])
          setOwnerEditSearching(false)
          return
        }
        const results = ((data as Array<{ id: string; nombre: string | null; apellido: string | null; telefono: string | null }>) ?? []).map(
          (row) => ({ ...row, type: ownerEditType }),
        )
        setOwnerEditResults(results)
        setOwnerEditSearching(false)
      }
      void run()
    }, 350)
    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [ownerEditOpen, ownerEditSearch, ownerEditType])

  const filteredActivaciones = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return activaciones
    return activaciones.filter((row) => {
      const ownerLabel = row.cliente_id
        ? ownerClienteMap[row.cliente_id] ?? row.cliente_id
        : row.lead_id
          ? ownerLeadMap[row.lead_id] ?? row.lead_id
          : ''
      const repLabel = row.representante_id
        ? representanteMap[row.representante_id] ?? row.representante_id
        : ''
      return (
        ownerLabel.toLowerCase().includes(term) ||
        repLabel.toLowerCase().includes(term)
      )
    })
  }, [activaciones, ownerClienteMap, ownerLeadMap, representanteMap, search])

  const handleSortAct = (colIndex: number) => {
    if (sortColAct === colIndex) {
      setSortDirAct((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColAct(colIndex)
      setSortDirAct('asc')
    }
  }

  const sortedActivaciones = useMemo(() => {
    if (sortColAct === null) return filteredActivaciones
    return [...filteredActivaciones].sort((a, b) => {
      let valA: number | string = 0
      let valB: number | string = 0
      if (sortColAct === 1) {
        valA = referidosCount[a.id] ?? 0
        valB = referidosCount[b.id] ?? 0
      } else if (sortColAct === 3) {
        valA = a.updated_at ?? a.created_at ?? ''
        valB = b.updated_at ?? b.created_at ?? ''
      }
      if (valA < valB) return sortDirAct === 'asc' ? -1 : 1
      if (valA > valB) return sortDirAct === 'asc' ? 1 : -1
      return 0
    })
  }, [filteredActivaciones, sortColAct, sortDirAct, referidosCount])

  const exportarCSVActivaciones = () => {
    const headers = effectiveScope === 'distribution'
      ? ['Cliente/Prospecto', 'Referidos', 'Progreso', 'Ultima actividad', 'Estado', 'Vendedor']
      : ['Cliente/Prospecto', 'Referidos', 'Progreso', 'Ultima actividad', 'Estado']
    const csvRows = filteredActivaciones.map((row) => {
      const ownerLabel = getOwnerLabel(row)
      const refs = referidosCount[row.id] ?? 0
      const progreso = `${refs}/${MIN_REFERIDOS_CI}`
      const lastActivity = formatDateTime(row.updated_at ?? row.created_at)
      const estado = isClosed(row)
        ? t('conexiones.activaciones.status.closed')
        : t('conexiones.activaciones.status.active')
      const repLabel = row.representante_id ? representanteMap[row.representante_id] ?? '-' : '-'
      const values = effectiveScope === 'distribution'
        ? [ownerLabel, refs, progreso, lastActivity, estado, repLabel]
        : [ownerLabel, refs, progreso, lastActivity, estado]
      return values
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    })
    const csv = [headers.join(','), ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `activaciones_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtersCount = useMemo(() => {
    let count = 0
    if (search.trim()) count += 1
    if (hasDistribuidorScope && effectiveScope === 'distribution') count += 1
    return count
  }, [hasDistribuidorScope, search, effectiveScope])

  const selectedOwnerLabel = useMemo(() => {
    if (!wizardOwnerId) return '-'
    if (wizardOwnerLabel) return wizardOwnerLabel
    const owner = ownerResults.find((item) => item.id === wizardOwnerId)
    if (owner) return [owner.nombre, owner.apellido].filter(Boolean).join(' ') || owner.id
    if (wizardOwnerType === 'cliente') {
      return ownerClienteMap[wizardOwnerId] ?? wizardOwnerId
    }
    return ownerLeadMap[wizardOwnerId] ?? wizardOwnerId
  }, [ownerClienteMap, ownerLeadMap, ownerResults, wizardOwnerId, wizardOwnerLabel, wizardOwnerType])

  const ownerEditLabel = useMemo(() => {
    if (!ownerEditId) return '-'
    const owner = ownerEditResults.find((item) => item.id === ownerEditId)
    if (owner) return [owner.nombre, owner.apellido].filter(Boolean).join(' ') || owner.id
    if (ownerEditType === 'cliente') {
      return ownerClienteMap[ownerEditId] ?? ownerEditId
    }
    return ownerLeadMap[ownerEditId] ?? ownerEditId
  }, [ownerClienteMap, ownerEditId, ownerEditResults, ownerEditType, ownerLeadMap])

  const getOwnerLabel = useCallback(
    (activation: CiActivacion) => {
      if (activation.cliente_id) {
        return ownerClienteMap[activation.cliente_id] ?? activation.cliente_id
      }
      if (activation.lead_id) {
        return ownerLeadMap[activation.lead_id] ?? activation.lead_id
      }
      return '-'
    },
    [ownerClienteMap, ownerLeadMap],
  )

  const handleOpenDetail = (activation: CiActivacion) => {
    setSelectedActivation(activation)
    setDetailOpen(true)
  }

  const handleReactivate = async (activationId: string) => {
    if (!configured) return
    const { error: updateError } = await supabase
      .from('ci_activaciones')
      .update({ estado: 'activo', updated_at: new Date().toISOString() })
      .eq('id', activationId)
    if (updateError) {
      showToast(updateError.message, 'error')
      return
    }
    showToast(t('conexiones.activaciones.actions.reactivated'))
    await loadActivaciones()
  }

  const canEditOwner = false
  const canCreateActivation = role === 'admin' || role === 'distribuidor' || role === 'vendedor'

  const handleSaveOwnerEdit = async () => {
    if (!configured || !selectedActivation) return
    if (!ownerEditId) {
      setOwnerEditError(t('conexiones.activaciones.errors.ownerRequired'))
      return
    }
    setOwnerEditSaving(true)
    setOwnerEditError(null)
    const payload =
      ownerEditType === 'cliente'
        ? { cliente_id: ownerEditId, lead_id: null }
        : { lead_id: ownerEditId, cliente_id: null }
    const { error: updateError } = await supabase
      .from('ci_activaciones')
      .update(payload)
      .eq('id', selectedActivation.id)
    if (updateError) {
      setOwnerEditError(updateError.message)
      setOwnerEditSaving(false)
      return
    }
    setSelectedActivation((prev) => (prev ? { ...prev, ...payload } : prev))
    setOwnerEditSaving(false)
    setOwnerEditOpen(false)
    showToast(t('toast.success'))
    await loadActivaciones()
  }

  const handleCreateActivation = async () => {
    if (!configured || !session?.user.id) return
    if (!programId) {
      setWizardError(t('conexiones.activaciones.errors.programMissing'))
      return
    }
    const { data: repRow, error: repError } = await supabase
      .from('usuarios')
      .select('id')
      .eq('id', session.user.id)
      .maybeSingle()
    if (repError || !repRow?.id) {
      setWizardError(t('conexiones.activaciones.errors.representanteMissing'))
      return
    }
    if (!wizardOwnerId) {
      setWizardError(t('conexiones.activaciones.errors.ownerRequired'))
      return
    }
    const ownerField = wizardOwnerType === 'cliente' ? 'cliente_id' : 'lead_id'
    const { data: existingActivations, error: existingError } = await supabase
      .from('ci_activaciones')
      .select('id, estado, updated_at, created_at')
      .eq('programa_id', programId)
      .eq(ownerField, wizardOwnerId)
    if (existingError) {
      setWizardError(existingError.message)
      return
    }
    if ((existingActivations ?? []).some((row) => !isClosed(row as CiActivacion))) {
      setWizardError(t('conexiones.activaciones.errors.ownerActive'))
      return
    }
    setWizardSaving(true)
    const { data, error: createError } = await supabase
      .from('ci_activaciones')
      .insert({
        representante_id: session.user.id,
        owner_id: null,
        cliente_id: wizardOwnerType === 'cliente' ? wizardOwnerId : null,
        lead_id: wizardOwnerType === 'prospecto' ? wizardOwnerId : null,
        estado: 'activo',
        programa_id: programId,
      })
      .select('id, representante_id, estado, updated_at, created_at, programa_id, cliente_id, lead_id')
      .single()
    if (createError || !data) {
      setWizardError(createError?.message ?? t('toast.error'))
      setWizardSaving(false)
      return
    }
    setWizardSaving(false)
    setWizardOpen(false)
    showToast(t('toast.success'))
    setSelectedActivation(data as CiActivacion)
    setDetailOpen(true)
    await loadActivaciones()
  }

  const listRows = useMemo<DataTableRow[]>(() => {
    return sortedActivaciones.map((row) => {
      const ownerLabel = getOwnerLabel(row)
      const repLabel = row.representante_id ? representanteMap[row.representante_id] ?? '-' : '-'
      const lastActivityValue = row.updated_at ?? row.created_at
      const lastActivityLabel = formatRelativeTime(lastActivityValue)
      const lastActivityFull = formatDateTime(lastActivityValue)
      const referidosTotal = referidosCount[row.id] ?? 0
      const progresoValue = `${referidosTotal}/${MIN_REFERIDOS_CI}`
      const progresoColor =
        referidosTotal >= MIN_REFERIDOS_CI
          ? referidosTotal > MIN_REFERIDOS_CI
            ? '#a855f7'
            : '#22c55e'
          : referidosTotal >= Math.floor(MIN_REFERIDOS_CI / 2)
            ? '#3b82f6'
            : '#94a3b8'
      const statusLabel = isClosed(row)
        ? t('conexiones.activaciones.status.closed')
        : t('conexiones.activaciones.status.active')
      const actions = (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Button
            variant="ghost"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              handleOpenDetail(row)
            }}
          >
            {t('conexiones.activaciones.actions.view')}
          </Button>
          {isClosed(row) && (
            <Button
              variant="ghost"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                handleReactivate(row.id)
              }}
            >
              {t('conexiones.activaciones.actions.reactivate')}
            </Button>
          )}
        </div>
      )
      return {
        id: row.id,
        cells: [
          ownerLabel,
          referidosTotal,
          <span style={{ color: progresoColor, fontWeight: 600 }}>{progresoValue}</span>,
          <span key="activity" title={lastActivityFull}>
            {lastActivityLabel}
          </span>,
          statusLabel,
          ...(effectiveScope === 'distribution' ? [repLabel] : []),
          actions,
        ],
      }
    })
  }, [sortedActivaciones, formatDateTime, formatRelativeTime, getOwnerLabel, isClosed, referidosCount, representanteMap, effectiveScope, t])

  const canAccess = role !== 'telemercadeo'


  return (
    <div className="page-stack">
      <SectionHeader
        title={t('conexiones.activaciones.title')}
        subtitle={t('conexiones.activaciones.subtitle')}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button
              variant="ghost"
              type="button"
              onClick={exportarCSVActivaciones}
              disabled={filteredActivaciones.length === 0}
            >
              Exportar CSV
            </Button>
            <Button type="button" onClick={() => setWizardOpen(true)} disabled={!canCreateActivation}>
              {t('conexiones.activaciones.actions.new')}
            </Button>
          </div>
        }
      />

      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}

      {error && <div className="form-error">{error}</div>}

      {!canAccess && (
        <EmptyState
          title={t('conexiones.activaciones.noAccess')}
          description={t('conexiones.activaciones.noAccessDetail')}
        />
      )}

      {canAccess && (
        <>
          <div className="template-tabs ci-tabs">
            <button
              type="button"
              className={`template-tab ${tab === 'activa' ? 'active' : ''}`.trim()}
              onClick={() => setTab('activa')}
            >
              {t('conexiones.activaciones.tabs.active')}
            </button>
            <button
              type="button"
              className={`template-tab ${tab === 'cerrada' ? 'active' : ''}`.trim()}
              onClick={() => setTab('cerrada')}
            >
              {t('conexiones.activaciones.tabs.closed')}
            </button>
          </div>

          <div className="card">
            <div className="stat-grid">
              <StatCard
                label={t('conexiones.activaciones.tabs.active')}
                value={String(activaciones.filter((row) => !isClosed(row)).length)}
              />
              <StatCard
                label={t('conexiones.activaciones.tabs.closed')}
                value={String(activaciones.filter((row) => isClosed(row)).length)}
              />
            </div>
          </div>

          <div className="card">
            <div className="filters-header">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setFiltersOpen((prev) => !prev)}
              >
                {t('conexiones.activaciones.filters')}
                {filtersCount > 0 ? ` (${filtersCount})` : ''}
              </Button>
            </div>
            {(filtersOpen || !isMobile) && (
              <div className="filters-grid">
                <label className="form-field">
                  <span>{t('conexiones.activaciones.labels.search')}</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} />
                </label>
              </div>
            )}
          </div>

          {loading && filteredActivaciones.length === 0 ? (
            <div className="template-empty">{t('common.loading')}</div>
          ) : filteredActivaciones.length === 0 ? (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <EmptyState
                title={
                  tab === 'activa'
                    ? t('conexiones.activaciones.emptyActiveTitle')
                    : t('conexiones.activaciones.emptyClosedTitle')
                }
                description={
                  tab === 'activa'
                    ? t('conexiones.activaciones.emptyActiveDescription')
                    : t('conexiones.activaciones.emptyClosedDescription')
                }
              />
              {tab === 'activa' && canCreateActivation && (
                <div>
                  <Button type="button" onClick={() => setWizardOpen(true)}>
                    {t('conexiones.activaciones.actions.new')}
                  </Button>
                </div>
              )}
            </div>
          ) : isMobile ? (
            <div className="card-grid">
              {sortedActivaciones.map((row) => {
                const lastActivityValue = row.updated_at ?? row.created_at
                const referidosTotal = referidosCount[row.id] ?? 0
                const progresoValue = `${referidosTotal}/${MIN_REFERIDOS_CI}`
                const progresoColor =
                  referidosTotal >= MIN_REFERIDOS_CI
                    ? referidosTotal > MIN_REFERIDOS_CI
                      ? '#a855f7'
                      : '#22c55e'
                    : referidosTotal >= Math.floor(MIN_REFERIDOS_CI / 2)
                      ? '#3b82f6'
                      : '#94a3b8'
                return (
                  <div key={row.id} className="card" onClick={() => handleOpenDetail(row)}>
                    <div className="card-header">
                      <strong>{getOwnerLabel(row)}</strong>
                      <span className="badge">
                        {isClosed(row)
                          ? t('conexiones.activaciones.status.closed')
                          : t('conexiones.activaciones.status.active')}
                      </span>
                    </div>
                    {effectiveScope === 'distribution' && row.representante_id && (
                      <p className="form-hint">
                        {t('conexiones.activaciones.labels.representante')}: {representanteMap[row.representante_id] ?? '-'}
                      </p>
                    )}
                    <p className="form-hint">
                      {t('conexiones.activaciones.labels.referidos')}: {referidosCount[row.id] ?? 0}
                    </p>
                    <p className="form-hint" style={{ color: progresoColor, fontWeight: 600 }}>
                      Progreso: {progresoValue}
                    </p>
                    <p className="form-hint" title={formatDateTime(lastActivityValue)}>
                      {t('conexiones.activaciones.labels.lastActivity')}: {formatRelativeTime(lastActivityValue)}
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleOpenDetail(row)
                        }}
                      >
                        {t('conexiones.activaciones.actions.view')}
                      </Button>
                      {isClosed(row) && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleReactivate(row.id)
                          }}
                        >
                          {t('conexiones.activaciones.actions.reactivate')}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <DataTable
              columns={[
                t('conexiones.activaciones.labels.owner'),
                t('conexiones.activaciones.labels.referidos'),
                'Progreso',
                t('conexiones.activaciones.labels.lastActivity'),
                t('conexiones.activaciones.labels.estado'),
                ...(effectiveScope === 'distribution' ? [t('conexiones.activaciones.labels.representante')] : []),
                t('conexiones.activaciones.labels.actions'),
              ]}
              rows={listRows}
              emptyLabel={t('conexiones.activaciones.emptyTable')}
              sortableColumns={[1, 3]}
              sortColIndex={sortColAct ?? undefined}
              sortDir={sortDirAct}
              onSort={handleSortAct}
              onRowClick={(row) => {
                const activation = filteredActivaciones.find((item) => item.id === row.id)
                if (activation) handleOpenDetail(activation)
              }}
            />
          )}

          {filteredActivaciones.length >= limit && (
            <div className="ci-activation-actions-row">
              <Button type="button" onClick={() => setLimit((prev) => prev + 50)}>
                {t('conexiones.activaciones.actions.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      <ActivacionReferidosPanel
        open={detailOpen}
        activation={selectedActivation}
        ownerLabel={selectedActivation ? getOwnerLabel(selectedActivation) : ''}
        ownerClienteId={selectedActivation?.cliente_id ?? null}
        currentUserId={session?.user.id ?? null}
        currentRole={role}
        canEditOwner={canEditOwner}
        isClosed={selectedActivation ? isClosed(selectedActivation) : false}
        onClose={() => setDetailOpen(false)}
        onEditOwner={() => setOwnerEditOpen(true)}
        onReactivate={() => selectedActivation && handleReactivate(selectedActivation.id)}
        onRefresh={loadActivaciones}
      />

      <Modal
        open={ownerEditOpen}
        title={t('conexiones.activaciones.actions.editOwner')}
        onClose={() => setOwnerEditOpen(false)}
        className="ci-activation-modal"
        bodyClassName="ci-activation-modal-body"
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setOwnerEditOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleSaveOwnerEdit} disabled={ownerEditSaving}>
              {ownerEditSaving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="ci-step">
          <div className="ci-step-header">
            <div>
              <h4>{t('conexiones.activaciones.labels.owner')}</h4>
              <p>{t('conexiones.activaciones.wizard.selectOwner')}</p>
            </div>
          </div>
          <div className="segmented" style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              className={ownerEditType === 'cliente' ? 'active' : ''}
              onClick={() => {
                setOwnerEditType('cliente')
                setOwnerEditId(null)
                setOwnerEditSearch('')
                setOwnerEditResults([])
              }}
            >
              {t('conexiones.activaciones.ownerType.cliente')}
            </button>
            <button
              type="button"
              className={ownerEditType === 'prospecto' ? 'active' : ''}
              onClick={() => {
                setOwnerEditType('prospecto')
                setOwnerEditId(null)
                setOwnerEditSearch('')
                setOwnerEditResults([])
              }}
            >
              {t('conexiones.activaciones.ownerType.prospecto')}
            </button>
          </div>
          <div className="ci-owner-selected">
            <div>
              <strong>{t('conexiones.activaciones.labels.owner')}</strong>
              <span>{ownerEditLabel}</span>
              {ownerEditPhone && (
                <span>📞 {ownerEditPhone}</span>
              )}
            </div>
          </div>
          <label className="form-field">
            <span>{t('conexiones.activaciones.wizard.searchUser')}</span>
            <input
              value={ownerEditSearch}
              onChange={(event) => setOwnerEditSearch(event.target.value)}
              placeholder={t('conexiones.activaciones.wizard.searchPlaceholder')}
            />
          </label>
          {ownerEditSearch.trim().length >= 2 && (
            <div className="ci-owner-results">
              {ownerEditSearching ? (
                <span className="ci-owner-empty">{t('common.loading')}</span>
              ) : ownerEditResults.length === 0 ? (
                <span className="ci-owner-empty">{t('common.noData')}</span>
              ) : (
                ownerEditResults.map((owner) => {
                  const name = [owner.nombre, owner.apellido].filter(Boolean).join(' ') || owner.id
                  return (
                    <button
                      key={`${owner.type}-${owner.id}`}
                      type="button"
                      className={`ci-owner-option ${ownerEditId === owner.id && ownerEditType === owner.type ? 'active' : ''
                        }`.trim()}
                      onClick={() => {
                        setOwnerEditType(owner.type)
                        setOwnerEditId(owner.id)
                        setOwnerEditPhone(owner.telefono ?? null)
                      }}
                    >
                      <span>{name}</span>
                      <span className="ci-owner-meta">{owner.telefono ?? '-'}</span>
                    </button>
                  )
                })
              )}
            </div>
          )}
          {ownerEditError && <div className="form-error">{ownerEditError}</div>}
        </div>
      </Modal>

      <Modal
        open={wizardOpen}
        title={t('conexiones.activaciones.wizard.title')}
        onClose={() => setWizardOpen(false)}
        className="ci-activation-modal"
        bodyClassName="ci-activation-modal-body"
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setWizardOpen(false)}>
              {t('common.cancel')}
            </Button>
            {wizardStep === 1 ? (
              <Button type="button" onClick={() => setWizardStep(2)} disabled={!wizardOwnerId}>
                {t('common.next')}
              </Button>
            ) : (
              <Button type="button" onClick={handleCreateActivation} disabled={wizardSaving}>
                {wizardSaving ? t('common.saving') : t('conexiones.activaciones.actions.create')}
              </Button>
            )}
          </>
        }
      >
        {wizardStep === 1 ? (
          <div className="ci-step">
            <div className="ci-step-header">
              <span className="ci-step-pill">1</span>
              <div>
                <h4>{t('conexiones.activaciones.wizard.ownerTitle')}</h4>
                <p>{t('conexiones.activaciones.wizard.ownerHint')}</p>
              </div>
            </div>
            <div className="segmented" style={{ marginBottom: '0.75rem' }}>
              <button
                type="button"
                className={wizardOwnerType === 'cliente' ? 'active' : ''}
                onClick={() => {
                  setWizardOwnerType('cliente')
                  setWizardOwnerId(null)
                  setWizardOwnerLabel(null)
                  setOwnerSearch('')
                  setOwnerResults([])
                }}
              >
                {t('conexiones.activaciones.ownerType.cliente')}
              </button>
              <button
                type="button"
                className={wizardOwnerType === 'prospecto' ? 'active' : ''}
                onClick={() => {
                  setWizardOwnerType('prospecto')
                  setWizardOwnerId(null)
                  setWizardOwnerLabel(null)
                  setOwnerSearch('')
                  setOwnerResults([])
                }}
              >
                {t('conexiones.activaciones.ownerType.prospecto')}
              </button>
            </div>
            <p className="form-hint">{t('conexiones.activaciones.wizard.selectOwner')}</p>
            <label className="form-field">
              <span>{t('conexiones.activaciones.wizard.searchUser')}</span>
              <input
                value={ownerSearch}
                onChange={(event) => setOwnerSearch(event.target.value)}
                placeholder={t('conexiones.activaciones.wizard.searchPlaceholder')}
              />
            </label>
            {ownerSearch.trim().length >= 2 && (
              <div className="ci-owner-results">
                {ownerSearching ? (
                  <span className="ci-owner-empty">{t('common.loading')}</span>
                ) : ownerResults.length === 0 ? (
                  <span className="ci-owner-empty">{t('common.noData')}</span>
                ) : (
                  ownerResults.map((owner) => {
                    const name = [owner.nombre, owner.apellido].filter(Boolean).join(' ') || owner.id
                    return (
                      <button
                        key={`${owner.type}-${owner.id}`}
                        type="button"
                        className={`ci-owner-option ${wizardOwnerId === owner.id && wizardOwnerType === owner.type ? 'active' : ''
                          }`.trim()}
                        onClick={() => {
                          setWizardOwnerType(owner.type)
                          setWizardOwnerId(owner.id)
                          setWizardOwnerLabel(name)
                        }}
                      >
                        <span>{name}</span>
                        <span className="ci-owner-meta">{owner.telefono ?? '-'}</span>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="ci-step">
            <div className="ci-step-header">
              <span className="ci-step-pill">2</span>
              <div>
                <h4>{t('conexiones.activaciones.wizard.confirmTitle')}</h4>
                <p>{t('conexiones.activaciones.wizard.confirmHint')}</p>
              </div>
            </div>
            <div className="ci-owner-selected">
              <div>
                <strong>{t('conexiones.activaciones.labels.owner')}</strong>
                <span>{selectedOwnerLabel}</span>
              </div>
              <div>
                <strong>{t('conexiones.activaciones.labels.representante')}</strong>
                <span>
                  {session?.user.id
                    ? usersById[session.user.id] ??
                    currentUserLabel ??
                    representanteMap[session.user.id] ??
                    session.user.id
                    : '-'}
                </span>
              </div>
            </div>
            {wizardError && <div className="form-error">{wizardError}</div>}
          </div>
        )}
      </Modal>
    </div>
  )
}

function ConexionesEmbajadoresTab() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const { usersById } = useUsers()
  const { showToast } = useToast()
  const { openWhatsapp, openSms, openEmail, ModalRenderer } = useMessaging()
  const { metrics, loading } = useDashboardMetrics()
  const {
    configured,
    loadingEmbajadores,
    errorEmbajadores,
    embajadoresData,
    loadEmbajadores,
    createEmbajador,
    createPeriodo,
    registerEmbajadorPrograma,
    saveConexiones,
  } = useConexiones({ mode: 'embajadores', autoLoad: true })
  const { embajadores, periodos, programas, role } = embajadoresData
  const [embajadorOpen, setEmbajadorOpen] = useState(false)
  const [periodoOpen, setPeriodoOpen] = useState(false)
  const [registroOpen, setRegistroOpen] = useState(false)
  const [conexionOpen, setConexionOpen] = useState(false)
  const [conexionProgram, setConexionProgram] = useState<EmbajadorProgramaRecord | null>(null)
  const [conexionRows, setConexionRows] = useState<ConexionRow[]>(buildConexionRows())
  const [conexionSubmitting, setConexionSubmitting] = useState(false)
  const [conexionError, setConexionError] = useState<string | null>(null)
  const [embajadorForm, setEmbajadorForm] = useState(initialEmbajadorForm)
  const [periodoForm, setPeriodoForm] = useState(initialPeriodoForm)
  const [registroForm, setRegistroForm] = useState(initialRegistroForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [busquedaEmb, setBusquedaEmb] = useState('')
  const [sortColEmb, setSortColEmb] = useState<number | null>(null)
  const [sortDirEmb, setSortDirEmb] = useState<'asc' | 'desc'>('asc')
  const [isMobileEmb, setIsMobileEmb] = useState(false)
  const conexionNameRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    const check = () => setIsMobileEmb(window.innerWidth < 720)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  )

  const embajadorMap = useMemo(() => {
    const map = new Map<string, string>()
    embajadores.forEach((embajador) => {
      const name = [embajador.nombre, embajador.apellido].filter(Boolean).join(' ') || embajador.id
      map.set(embajador.id, name)
    })
    return map
  }, [embajadores])

  const periodoMap = useMemo(() => {
    const map = new Map<string, string>()
    periodos.forEach((periodo) => {
      map.set(periodo.id, periodo.nombre ?? periodo.id)
    })
    return map
  }, [periodos])

  const activePeriod = useMemo(() => periodos.find((periodo) => periodo.activo), [periodos])

  const filteredProgramas = useMemo(() => {
    if (!busquedaEmb.trim()) return programas
    const term = busquedaEmb.trim().toLowerCase()
    return programas.filter((p) => {
      const name = p.embajador_id ? (embajadorMap.get(p.embajador_id) ?? '').toLowerCase() : ''
      return name.includes(term)
    })
  }, [programas, busquedaEmb, embajadorMap])

  const handleSortEmb = (colIndex: number) => {
    if (sortColEmb === colIndex) {
      setSortDirEmb((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColEmb(colIndex)
      setSortDirEmb('asc')
    }
  }

  const sortedProgramas = useMemo(() => {
    if (sortColEmb === null) return filteredProgramas
    return [...filteredProgramas].sort((a, b) => {
      let valA = 0
      let valB = 0
      if (sortColEmb === 2) {
        valA = Number(a.total_conexiones_anual ?? a.total_conexiones ?? a.conexiones ?? 0)
        valB = Number(b.total_conexiones_anual ?? b.total_conexiones ?? b.conexiones ?? 0)
      } else if (sortColEmb === 3) {
        valA = Number(a.total_ventas_generadas_anual ?? a.ventas_generadas ?? 0)
        valB = Number(b.total_ventas_generadas_anual ?? b.ventas_generadas ?? 0)
      }
      if (valA < valB) return sortDirEmb === 'asc' ? -1 : 1
      if (valA > valB) return sortDirEmb === 'asc' ? 1 : -1
      return 0
    })
  }, [filteredProgramas, sortColEmb, sortDirEmb])

  const exportarCSVEmb = () => {
    const headers = [
      t('conexiones.columns.embajador'),
      t('conexiones.columns.periodo'),
      t('conexiones.columns.conexiones'),
      t('conexiones.columns.ventas'),
      t('conexiones.columns.nivel'),
    ]
    const csvRows = filteredProgramas.map((p) => {
      const name = p.embajador_id ? embajadorMap.get(p.embajador_id) ?? p.embajador_id : '-'
      const periodo = p.periodo_id ? periodoMap.get(p.periodo_id) ?? p.periodo_id : '-'
      const conexiones = Number(p.total_conexiones_anual ?? p.total_conexiones ?? p.conexiones ?? 0)
      const ventas = Number(p.total_ventas_generadas_anual ?? p.ventas_generadas ?? 0)
      const nivel = p.nivel ?? '-'
      return [name, periodo, conexiones, ventas, nivel]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    })
    const csv = [headers.join(','), ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `embajadores_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const rows = useMemo<DataTableRow[]>(() => {
    return sortedProgramas.map((programa) => {
      const embajadorName = programa.embajador_id
        ? embajadorMap.get(programa.embajador_id) ?? programa.embajador_id
        : '-'
      const periodoName = programa.periodo_id
        ? periodoMap.get(programa.periodo_id) ?? programa.periodo_id
        : '-'
      const conexionesValue =
        programa.total_conexiones_anual ?? programa.total_conexiones ?? programa.conexiones ?? 0
      const ventasValue =
        programa.total_ventas_generadas_anual ?? programa.ventas_generadas ?? 0
      const ventasNumber = typeof ventasValue === 'number' ? ventasValue : Number(ventasValue) || 0
      const connectionsNumber = typeof conexionesValue === 'number'
        ? conexionesValue
        : Number(conexionesValue) || 0
      const isGold = programa.nivel === 'gold'
      const progressValue = isGold ? 1 : Math.min(1, ventasNumber / 20000)
      const progressTooltip = t('conexiones.progress.tooltip', {
        conexiones: numberFormat.format(connectionsNumber),
        ventas: `$${numberFormat.format(ventasNumber)}`,
      })
      const nivelKey = programa.nivel ? `conexiones.levels.${programa.nivel}` : ''
      const translatedNivel = programa.nivel ? t(nivelKey) : '-'
      const nivelLabel = programa.nivel && translatedNivel === nivelKey ? programa.nivel : translatedNivel
      return {
        id: programa.id,
        cells: [
          <div className="conexiones-embajador-cell">
            <div className="conexiones-embajador-row">
              <span className="conexiones-embajador-name">{embajadorName}</span>
              <Button
                variant="ghost"
                type="button"
                className="conexiones-add-button"
                onClick={() => {
                  setConexionProgram(programa)
                  setConexionRows(buildConexionRows())
                  setConexionError(null)
                  setConexionOpen(true)
                }}
              >
                {t('conexiones.actions.addConexion')}
              </Button>
            </div>
            <div
              className={`conexiones-progress ${isGold ? 'gold' : 'silver'}`}
              title={progressTooltip}
            >
              <div
                className="conexiones-progress-bar"
                style={{ width: `${Math.round(progressValue * 100)}%` }}
              />
              {isGold && <span className="conexiones-progress-icon">🏆</span>}
            </div>
          </div>,
          periodoName,
          numberFormat.format(connectionsNumber),
          numberFormat.format(ventasNumber),
          nivelLabel ?? '-',
        ],
      }
    })
  }, [embajadorMap, numberFormat, periodoMap, sortedProgramas, t])

  const emptyLabel = loadingEmbajadores ? t('common.loading') : t('common.noData')
  const vendedorName = session?.user.id ? usersById[session.user.id] ?? session.user.id : '-'
  const conexionCount = conexionRows.filter((row) => row.nombre.trim() !== '').length
  const handleEmbajadorChange = (field: keyof typeof initialEmbajadorForm) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setEmbajadorForm((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handlePeriodoChange = (field: keyof typeof initialPeriodoForm) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      if (field === 'anio') {
        const year = Number(value) || currentYear
        setPeriodoForm((prev) => ({
          ...prev,
          anio: value,
          fecha_inicio: formatYearDate(year, 1, 1),
          fecha_fin: formatYearDate(year, 12, 31),
        }))
        return
      }
      setPeriodoForm((prev) => ({ ...prev, [field]: value }))
    }

  const handleRegistroChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setRegistroForm({ embajador_id: event.target.value })
  }

  const handleConexionChange = (index: number, field: keyof ConexionRow) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = field === 'telefono' ? formatPhone(event.target.value) : event.target.value
      setConexionRows((prev) =>
        prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
      )
    }

  const handleConexionKeyDown = (index: number) =>
    (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      const nextIndex = index + 1
      const nextInput = conexionNameRefs.current[nextIndex]
      if (nextInput) {
        nextInput.focus()
      }
    }

  const handleAddConexionRow = () => {
    setConexionRows((prev) => [...prev, { nombre: '', telefono: '', email: '', estado: 'pendiente' }])
  }

  const handleCreateEmbajador = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const payload = {
      nombre: toNull(embajadorForm.nombre),
      apellido: toNull(embajadorForm.apellido),
      email: toNull(embajadorForm.email),
      telefono: toNull(embajadorForm.telefono),
      fecha_nacimiento: embajadorForm.fecha_nacimiento || null,
    }

    const { error } = await createEmbajador(payload)

    if (error) {
      setFormError(error)
      showToast(error, 'error')
    } else {
      setEmbajadorOpen(false)
      setEmbajadorForm(initialEmbajadorForm)
      await loadEmbajadores()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const handleCreatePeriodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const year = Number(periodoForm.anio) || currentYear
    const nombrePeriodo = `Programa Conexiones Infinitas ${year}`
    const payload = {
      nombre: nombrePeriodo,
      anio: year,
      fecha_inicio: periodoForm.fecha_inicio || formatYearDate(year, 1, 1),
      fecha_fin: periodoForm.fecha_fin || formatYearDate(year, 12, 31),
      activo: true,
    }

    const { error } = await createPeriodo(payload)

    if (error) {
      setFormError(error)
      showToast(error, 'error')
    } else {
      setPeriodoOpen(false)
      setPeriodoForm(initialPeriodoForm)
      await loadEmbajadores()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const handleRegisterPeriodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    if (!activePeriod) {
      setFormError(t('conexiones.errors.noActivePeriod'))
      showToast(t('conexiones.errors.noActivePeriod'), 'error')
      return
    }
    if (!registroForm.embajador_id) {
      setFormError(t('conexiones.errors.selectEmbajador'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const payload = {
      embajador_id: registroForm.embajador_id,
      periodo_id: activePeriod.id,
      nivel: 'silver',
    }

    const { error } = await registerEmbajadorPrograma(payload)

    if (error) {
      setFormError(error)
      showToast(error, 'error')
    } else {
      setRegistroOpen(false)
      setRegistroForm(initialRegistroForm)
      await loadEmbajadores()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const handleSaveConexiones = async () => {
    if (!configured || !conexionProgram?.embajador_id) return
    const validRows = conexionRows.filter((row) => row.nombre.trim() !== '')
    if (validRows.length === 0) {
      setConexionError(t('conexiones.referralLoop.empty'))
      return
    }
    setConexionSubmitting(true)
    setConexionError(null)
    const ownerId = session?.user.id ?? null
    const { error } = await saveConexiones({ program: conexionProgram, rows: validRows, ownerId })
    if (error) {
      const message = error === 'No rows' ? t('conexiones.referralLoop.empty') : error
      setConexionError(message)
      showToast(message, 'error')
    } else {
      setConexionOpen(false)
      setConexionProgram(null)
      setConexionRows(buildConexionRows())
      await loadEmbajadores()
      showToast(t('toast.success'))
    }
    setConexionSubmitting(false)
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('conexiones.title')}
        subtitle={t('conexiones.subtitle')}
        action={
          <>
            <Button
              variant="ghost"
              type="button"
              onClick={exportarCSVEmb}
              disabled={filteredProgramas.length === 0}
            >
              Exportar CSV
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setFormError(null)
                setEmbajadorForm(initialEmbajadorForm)
                setEmbajadorOpen(true)
              }}
            >
              {t('conexiones.actions.newEmbajador')}
            </Button>
            {role === 'admin' && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setFormError(null)
                  setPeriodoForm(initialPeriodoForm)
                  setPeriodoOpen(true)
                }}
              >
                {t('conexiones.actions.newPeriodo')}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => {
                setFormError(null)
                setRegistroForm(initialRegistroForm)
                setRegistroOpen(true)
              }}
            >
              {t('conexiones.actions.registerPeriodo')}
            </Button>
          </>
        }
      />

      <div className="stat-grid">
        <StatCard
          label={t('conexiones.metrics.silver')}
          value={loading ? t('common.loading') : numberFormat.format(metrics.ambassadorsSilver)}
        />
        <StatCard
          label={t('conexiones.metrics.gold')}
          value={loading ? t('common.loading') : numberFormat.format(metrics.ambassadorsGold)}
          accent="gold"
        />
        <StatCard
          label={t('conexiones.metrics.volumen')}
          value={loading ? t('common.loading') : numberFormat.format(metrics.ambassadorsVolumeAnnual)}
          accent="gold"
        />
      </div>

      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}
      {errorEmbajadores && <div className="form-error">{errorEmbajadores}</div>}
      {loadingEmbajadores && <div className="form-hint">{t('common.loading')}</div>}

      {/* Search */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <input
          style={{ flex: 1, fontSize: '0.875rem' }}
          placeholder="Buscar embajador..."
          value={busquedaEmb}
          onChange={(e) => setBusquedaEmb(e.target.value)}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)', whiteSpace: 'nowrap' }}>
          {filteredProgramas.length} de {programas.length}
        </span>
      </div>

      {isMobileEmb ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {sortedProgramas.map((programa) => {
            const embajadorName = programa.embajador_id
              ? embajadorMap.get(programa.embajador_id) ?? programa.embajador_id
              : '-'
            const periodoName = programa.periodo_id
              ? periodoMap.get(programa.periodo_id) ?? programa.periodo_id
              : '-'
            const conexiones = Number(
              programa.total_conexiones_anual ?? programa.total_conexiones ?? programa.conexiones ?? 0
            )
            const ventas = Number(programa.total_ventas_generadas_anual ?? programa.ventas_generadas ?? 0)
            const isGold = programa.nivel === 'gold'
            const progressValue = isGold ? 1 : Math.min(1, ventas / 20000)
            return (
              <div key={programa.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <strong style={{ fontSize: '0.95rem' }}>{embajadorName}</strong>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      background: isGold ? 'rgba(234,179,8,0.18)' : 'rgba(148,163,184,0.18)',
                      color: isGold ? '#b45309' : '#475569',
                      textTransform: 'uppercase',
                    }}
                  >
                    {programa.nivel ?? 'silver'}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)', marginTop: '4px' }}>
                  {periodoName}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', marginTop: '10px' }}>
                  <div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#6366f1', lineHeight: 1 }}>
                      {numberFormat.format(conexiones)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted, #6b7280)', textTransform: 'uppercase', marginTop: '2px' }}>
                      {t('conexiones.columns.conexiones')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#10b981', lineHeight: 1 }}>
                      {numberFormat.format(ventas)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted, #6b7280)', textTransform: 'uppercase', marginTop: '2px' }}>
                      {t('conexiones.columns.ventas')}
                    </div>
                  </div>
                </div>
                <div className={`conexiones-progress ${isGold ? 'gold' : 'silver'}`} style={{ marginTop: '10px' }}>
                  <div
                    className="conexiones-progress-bar"
                    style={{ width: `${Math.round(progressValue * 100)}%` }}
                  />
                  {isGold && <span className="conexiones-progress-icon">🏆</span>}
                </div>
                <Button
                  variant="ghost"
                  type="button"
                  style={{ marginTop: '8px', alignSelf: 'flex-start' }}
                  onClick={() => {
                    setConexionProgram(programa)
                    setConexionRows(buildConexionRows())
                    setConexionError(null)
                    setConexionOpen(true)
                  }}
                >
                  {t('conexiones.actions.addConexion')}
                </Button>
              </div>
            )
          })}
          {sortedProgramas.length === 0 && (
            <div className="form-hint" style={{ textAlign: 'center', padding: '1rem' }}>
              {emptyLabel}
            </div>
          )}
        </div>
      ) : (
        <DataTable
          columns={[
            t('conexiones.columns.embajador'),
            t('conexiones.columns.periodo'),
            t('conexiones.columns.conexiones'),
            t('conexiones.columns.ventas'),
            t('conexiones.columns.nivel'),
          ]}
          rows={rows}
          emptyLabel={emptyLabel}
          sortableColumns={[2, 3]}
          sortColIndex={sortColEmb ?? undefined}
          sortDir={sortDirEmb}
          onSort={handleSortEmb}
        />
      )}
      <Modal
        open={embajadorOpen}
        title={t('conexiones.form.embajadorTitle')}
        onClose={() => {
          setEmbajadorOpen(false)
          setFormError(null)
        }}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setEmbajadorOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="embajador-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="embajador-form" className="form-grid" onSubmit={handleCreateEmbajador}>
          <label className="form-field">
            <span>{t('conexiones.form.nombre')}</span>
            <input value={embajadorForm.nombre} onChange={handleEmbajadorChange('nombre')} />
          </label>
          <label className="form-field">
            <span>{t('conexiones.form.apellido')}</span>
            <input value={embajadorForm.apellido} onChange={handleEmbajadorChange('apellido')} />
          </label>
          <label className="form-field">
            <span>{t('conexiones.form.email')}</span>
            <input type="email" value={embajadorForm.email} onChange={handleEmbajadorChange('email')} />
          </label>
          <label className="form-field">
            <span>{t('conexiones.form.telefono')}</span>
            <input value={embajadorForm.telefono} onChange={handleEmbajadorChange('telefono')} />
          </label>
          <label className="form-field">
            <span>{t('conexiones.form.fechaNacimiento')}</span>
            <input
              type="date"
              value={embajadorForm.fecha_nacimiento}
              onChange={handleEmbajadorChange('fecha_nacimiento')}
            />
          </label>
          <label className="form-field">
            <span>{t('conexiones.form.vendedor')}</span>
            <input value={vendedorName} readOnly />
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
      <Modal
        open={periodoOpen}
        title={t('conexiones.form.periodoTitle')}
        description={t('conexiones.form.periodoDescription')}
        onClose={() => {
          setPeriodoOpen(false)
          setFormError(null)
        }}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setPeriodoOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="periodo-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="periodo-form" className="form-grid" onSubmit={handleCreatePeriodo}>
          <label className="form-field">
            <span>{t('conexiones.form.anio')}</span>
            <input type="number" value={periodoForm.anio} onChange={handlePeriodoChange('anio')} />
          </label>
          <label className="form-field">
            <span>{t('conexiones.form.fechaInicio')}</span>
            <input type="date" value={periodoForm.fecha_inicio} onChange={handlePeriodoChange('fecha_inicio')} />
          </label>
          <label className="form-field">
            <span>{t('conexiones.form.fechaFin')}</span>
            <input type="date" value={periodoForm.fecha_fin} readOnly />
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
      <Modal
        open={registroOpen}
        title={t('conexiones.form.registroTitle')}
        onClose={() => {
          setRegistroOpen(false)
          setFormError(null)
        }}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setRegistroOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="registro-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="registro-form" className="form-grid" onSubmit={handleRegisterPeriodo}>
          <label className="form-field">
            <span>{t('conexiones.form.periodo')}</span>
            <input value={activePeriod?.nombre ?? '-'} readOnly />
          </label>
          <label className="form-field">
            <span>{t('conexiones.form.nivel')}</span>
            <input value={t('conexiones.levels.silver')} readOnly />
          </label>
          <label className="form-field">
            <span>{t('conexiones.columns.embajador')}</span>
            <select value={registroForm.embajador_id} onChange={handleRegistroChange}>
              <option value="">{t('common.select')}</option>
              {embajadores.map((embajador) => (
                <option key={embajador.id} value={embajador.id}>
                  {[embajador.nombre, embajador.apellido].filter(Boolean).join(' ') || embajador.id}
                </option>
              ))}
            </select>
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
      <Modal
        open={conexionOpen}
        title={t('conexiones.referralLoop.title', {
          embajador: conexionProgram?.embajador_id
            ? embajadorMap.get(conexionProgram.embajador_id) ?? conexionProgram.embajador_id
            : '',
        })}
        description={t('conexiones.referralLoop.subtitle')}
        className="conexion-modal"
        bodyClassName="conexion-modal-body"
        onClose={() => {
          setConexionOpen(false)
          setConexionProgram(null)
          setConexionError(null)
        }}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setConexionOpen(false)}>
              {t('conexiones.referralLoop.skip')}
            </Button>
            <Button type="button" onClick={handleSaveConexiones} disabled={conexionSubmitting}>
              {conexionSubmitting ? t('common.saving') : t('conexiones.referralLoop.save')}
            </Button>
          </>
        }
      >
        <div className="conexion-header">
          <span className="conexion-counter">{t('conexiones.referralLoop.counter', { count: conexionCount })}</span>
          <Button variant="ghost" type="button" onClick={handleAddConexionRow}>
            {t('conexiones.referralLoop.addRow')}
          </Button>
        </div>
        <div className={`conexion-list ${conexionRows.length > 5 ? 'scroll' : ''}`.trim()}>
          {conexionRows.map((row, index) => {
            const phoneDigits = stripPhone(row.telefono)
            const hasName = row.nombre.trim() !== ''
            const hasPhone = phoneDigits.length > 0
            const hasEmail = row.email.trim() !== ''
            const embajadorName = conexionProgram?.embajador_id
              ? embajadorMap.get(conexionProgram.embajador_id) ?? conexionProgram.embajador_id
              : ''
            const contact = {
              nombre: row.nombre.trim() || t('common.noData'),
              telefono: row.telefono,
              email: row.email,
              vendedor: vendedorName === '-' ? '' : vendedorName,
              recomendadoPor: embajadorName,
            }
            return (
              <div key={`conexion-${index}`} className="conexion-row">
                <div className="conexion-index">{index + 1}</div>
                <input
                  ref={(element) => {
                    conexionNameRefs.current[index] = element
                  }}
                  className="conexion-input"
                  value={row.nombre}
                  onChange={handleConexionChange(index, 'nombre')}
                  onKeyDown={handleConexionKeyDown(index)}
                  placeholder={t('conexiones.referralLoop.nombrePlaceholder')}
                />
                <input
                  className="conexion-input"
                  value={row.telefono}
                  onChange={handleConexionChange(index, 'telefono')}
                  onKeyDown={handleConexionKeyDown(index)}
                  placeholder={t('conexiones.referralLoop.telefonoPlaceholder')}
                />
                <input
                  className="conexion-input"
                  value={row.email}
                  onChange={handleConexionChange(index, 'email')}
                  onKeyDown={handleConexionKeyDown(index)}
                  placeholder={t('conexiones.referralLoop.emailPlaceholder')}
                />
                <select
                  className="conexion-select"
                  value={row.estado}
                  onChange={handleConexionChange(index, 'estado')}
                  onKeyDown={handleConexionKeyDown(index)}
                >
                  <option value="pendiente">{t('conexiones.referralLoop.states.pendiente')}</option>
                  <option value="demo_calificada">{t('conexiones.referralLoop.states.demo_calificada')}</option>
                  <option value="venta">{t('conexiones.referralLoop.states.venta')}</option>
                  <option value="no_interes">{t('conexiones.referralLoop.states.no_interes')}</option>
                </select>
                <div className="conexion-actions">
                  {(() => {
                    return (
                      <>
                        <button
                          type="button"
                          className="contact-icon whatsapp"
                          aria-label={t('conexiones.referralLoop.whatsapp')}
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
                          aria-label={t('conexiones.referralLoop.sms')}
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
                          aria-label={t('conexiones.referralLoop.email')}
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
        {conexionError && <div className="form-error">{conexionError}</div>}
      </Modal>
      <ModalRenderer />
    </div>
  )
}

export function ConexionesInfinitasPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'activaciones' | 'embajadores'>('activaciones')

  return (
    <div className="page-stack">
      <div className="template-tabs ci-tabs">
        <button
          type="button"
          className={`template-tab ${activeTab === 'activaciones' ? 'active' : ''}`.trim()}
          onClick={() => setActiveTab('activaciones')}
        >
          {t('conexiones.tabs.activaciones')}
        </button>
        <button
          type="button"
          className={`template-tab ${activeTab === 'embajadores' ? 'active' : ''}`.trim()}
          onClick={() => setActiveTab('embajadores')}
        >
          {t('conexiones.tabs.embajadores')}
        </button>
      </div>
      {activeTab === 'activaciones' ? <ConexionesActivacionesTab /> : <ConexionesEmbajadoresTab />}
    </div>
  )
}
