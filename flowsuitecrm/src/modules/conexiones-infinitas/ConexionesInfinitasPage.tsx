import { type ChangeEvent, type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { StatCard } from '../../components/StatCard'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'
import { useConexiones } from '../../hooks/useConexiones'
import { CONEXIONES_INFINITAS_DIFUSION, replaceTemplateVariables } from '../../lib/whatsappTemplates'
import { IconMail, IconSms, IconWhatsapp } from '../../components/icons'
import { useAuth } from '../../auth/AuthProvider'
import { useUsers } from '../../data/UsersProvider'
import { useMessaging } from '../../hooks/useMessaging'

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

type CiReferido = {
  id: string
  activacion_id: string | null
  nombre: string | null
  telefono: string | null
  relacion: string | null
  estado: string | null
  lead_id: string | null
}

type CiRelacion = 'familiar' | 'amigo' | 'companero'

type ReferidoFormRow = {
  nombre: string
  telefono: string
  relacion: CiRelacion
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

const MIN_REFERIDOS_CI = 20
const MIN_REFERIDOS_DRAFT = 1

const ciReferidoStates = [
  'pendiente',
  'contactado',
  'cita_agendada',
  'presentacion_hecha',
  'regalo_entregado',
] as const

const ciRelacionOptions = ['familiar', 'amigo', 'companero'] as const

const initialCiReferidoRow: ReferidoFormRow = {
  nombre: '',
  telefono: '',
  relacion: 'familiar',
}

const buildCiReferidoRows = (count = 3) =>
  Array.from({ length: count }, () => ({ ...initialCiReferidoRow }))

const buildConexionRows = (count = 3) =>
  Array.from({ length: count }, () => ({ nombre: '', telefono: '', email: '', estado: 'pendiente' }))

const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const stripPhone = (value: string) => value.replace(/\D/g, '')

const CLIENT_DIFFUSION_TEMPLATE =
  '¡Mira esta belleza! 🎁 Estoy participando para ganármela y ya te dejé anotado para que a ti también te den un Regalo Premium. Te va a contactar mi asesor {vendedor} ({telefono_vendedor}) para explicarte. ¡Cualquier cosa llámame y te cuento cómo funciona!'

function ConexionesActivacionesTab() {
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
  const [detailGiftId, setDetailGiftId] = useState('')
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

  const getActivationState = useCallback(
    ({
      referidosCount,
      photoPath,
      whatsappAt,
    }: {
      referidosCount: number
      photoPath: string | null
      whatsappAt: string | null
    }) => {
      if (whatsappAt) return 'completo'
      if (referidosCount >= MIN_REFERIDOS_CI && photoPath) return 'activo'
      return 'borrador'
    },
    [],
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

    if (!selectedOwnerType || !selectedOwnerId) {
      setActivationError(t('conexiones.activaciones.errors.selectOwner'))
      return
    }

    setActivationSaving(true)
    setActivationError(null)

    const { data: activationResult, error: activationError } = await createActivacion({
      clienteId: selectedOwnerType === 'cliente' ? selectedOwnerId : null,
      leadId: selectedOwnerType === 'prospecto' ? selectedOwnerId : null,
      regaloId: selectedGiftId || null,
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
    let updatePayload: { regalo_id?: string | null; foto_url?: string | null; estado?: string | null } = {}

    if (!detailCanUnlockGift) {
      updatePayload = {
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
  const activationActionDisabled =
    activationSaving || !hasMinimumReferidos || (canSeeStep2 && !canActivate)

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
                  {ciRelacionOptions.map((option) => (
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
            {productos.length === 0 ? (
              <div className="template-empty">{t('conexiones.activaciones.form.giftEmpty')}</div>
            ) : (
              <div className="ci-gift-grid">
                {productos.map((gift) => (
                  <button
                    key={gift.id}
                    type="button"
                    className={`ci-gift-card ${selectedGiftId === gift.id ? 'selected' : ''}`.trim()}
                    onClick={() => setSelectedGiftId(gift.id)}
                  >
                    <span>{gift.nombre}</span>
                  </button>
                ))}
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
                {productos.length === 0 ? (
                  <div className="template-empty">{t('conexiones.activaciones.form.giftEmpty')}</div>
                ) : (
                  <div className="ci-gift-grid">
                    {productos.map((gift) => (
                      <button
                        key={gift.id}
                        type="button"
                        className={`ci-gift-card ${detailGiftId === gift.id ? 'selected' : ''}`.trim()}
                        onClick={() => setDetailGiftId(gift.id)}
                      >
                        <span>{gift.nombre}</span>
                      </button>
                    ))}
                  </div>
                )}
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
                  {ciRelacionOptions.map((option) => (
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
                              {ciRelacionOptions.map((option) => (
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
                              {ciReferidoStates.map((state) => (
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
  const conexionNameRefs = useRef<Array<HTMLInputElement | null>>([])

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

  const rows = useMemo<DataTableRow[]>(() => {
    return programas.map((programa) => {
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
  }, [embajadorMap, numberFormat, periodoMap, programas, t])

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
      />
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
            const contact = {
              nombre: row.nombre.trim() || t('common.noData'),
              telefono: row.telefono,
              email: row.email,
              vendedor: vendedorName === '-' ? '' : vendedorName,
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
