import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Modal } from './Modal'
import {
  buildWhatsappUrl,
  baseTemplates,
  type WhatsappTemplateCategory,
} from '../lib/whatsappTemplates'
import {
  emailTemplates,
  EMAIL_CATEGORY_LABELS,
  EMAIL_CATEGORIES,
  type EmailTemplateCategory,
} from '../lib/emailTemplates'
import { canonicalizeTemplate, PLACEHOLDER_OPTIONS, resolveTemplate } from '../lib/messagePlaceholders'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useToast } from './useToast'
import type { MessagingChannel, MessagingContact } from '../types/messaging'
import { useUsers } from '../data/useUsers'
import { useAuth } from '../auth/useAuth'
import { getMessagingContactRef } from '../lib/contactRefs'
import { ContactoTimeline } from './ContactoTimeline'

type MessageModalProps = {
  open: boolean
  channel: MessagingChannel
  contact: MessagingContact | null
  initialTemplateId?: string | null
  onClose: () => void
}

const sanitizePhone = (value: string) => value.replace(/\D/g, '')

type SystemTemplate = {
  id: string
  templateKey: string
  label: string
  message: string
  category: string
}

type CloudTemplate = {
  id: string
  nombre: string
  cuerpo: string
  asunto: string | null
  canal: MessagingChannel | 'all'
  category: string
  scope: 'personal' | 'shared'
  is_system?: boolean | null
  owner_id?: string | null
  org_id?: string | null
}

type UnifiedTemplate = {
  id: string
  label: string
  message: string
  subject?: string | null
  category: string
  channel: MessagingChannel
  source: 'system' | 'cloud'
  raw?: CloudTemplate
}

type LegacyTemplate = {
  label: string
  message: string
  category: string
  channel: MessagingChannel | 'all'
  subject: string | null
}

const LEGACY_TEMPLATES_KEY = 'flowsuite.messaging.customTemplates'
const LEGACY_MIGRATED_KEY = 'flowsuite.messaging.customTemplatesMigrated'
const LEGACY_CLEANED_KEY = 'flowsuite.messaging.customTemplatesCleaned'

const normalizeLegacyTemplate = (raw: Record<string, unknown>): LegacyTemplate | null => {
  const label =
    String(raw.label ?? raw.title ?? raw.nombre ?? raw.name ?? '').trim()
  const message =
    String(raw.message ?? raw.cuerpo ?? raw.content ?? raw.texto ?? '').trim()
  if (!label || !message) return null
  const category = String(raw.category ?? raw.categoria ?? raw.tipo ?? 'general').trim() || 'general'
  const channelRaw = String(raw.canal ?? raw.channel ?? raw.canal_envio ?? '').trim().toLowerCase()
  const channel = (channelRaw === 'whatsapp' || channelRaw === 'sms' || channelRaw === 'email' || channelRaw === 'telegram' || channelRaw === 'all')
    ? channelRaw
    : 'whatsapp'
  const subject = String(raw.asunto ?? raw.subject ?? '').trim()
  return {
    label,
    message,
    category,
    channel,
    subject: subject || null,
  }
}

const loadLegacyTemplates = (): LegacyTemplate[] => {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(LEGACY_TEMPLATES_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'object' && item ? normalizeLegacyTemplate(item as Record<string, unknown>) : null))
      .filter((item): item is LegacyTemplate => Boolean(item))
  } catch {
    return []
  }
}

type MessageType =
  | 'general'
  | 'seguimiento'
  | 'cartera'
  | 'referidos'
  | 'cumpleanos'
  | 'citas'
  | 'servicio'
  | 'cambio_repuestos'

const MESSAGE_TYPE_OPTIONS: { value: MessageType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'cartera', label: 'Cartera' },
  { value: 'referidos', label: 'Referidos' },
  { value: 'cumpleanos', label: 'Cumpleanos' },
  { value: 'citas', label: 'Citas' },
  { value: 'servicio', label: 'Servicio' },
  { value: 'cambio_repuestos', label: 'Cambio de repuestos' },
]

const formatAmount = (value?: number | string | null) => {
  if (value === null || value === undefined) return ''
  const normalized = typeof value === 'string' ? value.replace(/[^0-9.-]/g, '') : value
  if (normalized === '') return ''
  const numeric = Number(normalized)
  if (Number.isNaN(numeric)) return ''
  return numeric.toFixed(2)
}

const firstName = (value?: string | null) => {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0] ?? ''
}

const buildSubtitle = (value: string) => {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= 80) return compact
  return compact.slice(0, 77) + '...'
}

const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  general: 'General',
  seguimiento: 'Seguimiento',
  cartera: 'Cartera',
  referidos: 'Referidos',
  cumpleanos: 'Cumpleanos',
  citas: 'Citas',
  servicio: 'Servicio',
  cambio_repuestos: 'Cambio de repuestos',
}

const CHANNEL_LABELS: Record<MessagingChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  telegram: 'Telegram',
}

const normalizeCategoryValue = (value: string | null | undefined) => {
  if (!value) return 'general'
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

const inferMessageTypeFromId = (templateId: string | null | undefined): MessageType => {
  if (!templateId) return 'general'
  const key = templateId.toLowerCase()
  if (key.includes('cumple')) return 'cumpleanos'
  if (key.includes('servicio')) return 'servicio'
  if (key.includes('repuesto') || key.includes('repuestos')) return 'cambio_repuestos'
  if (key.includes('cartera')) return 'cartera'
  if (key.includes('referid')) return 'referidos'
  if (key.includes('cita')) return 'citas'
  if (key.includes('seguimiento')) return 'seguimiento'
  return 'general'
}

const CATEGORY_OPTIONS: { value: WhatsappTemplateCategory; label: string }[] = [
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'source', label: 'Fuente' },
  { value: 'client', label: 'Cliente' },
  { value: 'negocio', label: 'Negocio' },
  { value: 'cartera', label: 'Cartera' },
  { value: '4en14', label: '4 en 14' },
  { value: 'conexiones', label: 'Conexiones' },
  { value: 'campana', label: 'Campaña' },
  { value: 'general', label: 'General' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'referidos', label: 'Referidos' },
  { value: 'cumpleanos', label: 'Cumpleaños' },
  { value: 'citas', label: 'Citas' },
  { value: 'servicio', label: 'Servicio' },
  { value: 'cambio_repuestos', label: 'Cambio repuestos' },
]

// --- COMPONENT ---
export function MessageModal({ open, channel, contact, initialTemplateId, onClose }: MessageModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { currentUser } = useUsers()
  const { session } = useAuth()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const configured = isSupabaseConfigured

  const resolvedContact = useMemo<MessagingContact>(() => {
    if (!contact) {
      return {
        nombre: '',
        telefono: null,
        email: null,
        vendedor: '',
        recomendadoPor: null,
        cuentaHycite: null,
        saldoActual: null,
        montoMoroso: null,
        diasAtraso: null,
        estadoMorosidad: null,
        clienteId: null,
        leadId: null,
      }
    }
    const raw = contact as MessagingContact & Record<string, unknown>
    return {
      ...contact,
      cuentaHycite: contact.cuentaHycite ?? (raw.hycite_id as string | null | undefined) ?? (raw.cuenta_hycite as string | null | undefined) ?? null,
      saldoActual: contact.saldoActual ?? (raw.saldo_actual != null ? Number(raw.saldo_actual) : null),
      montoMoroso: contact.montoMoroso ?? (raw.monto_moroso != null ? Number(raw.monto_moroso) : null),
      diasAtraso: contact.diasAtraso ?? (raw.dias_atraso as number | null | undefined) ?? null,
      estadoMorosidad: contact.estadoMorosidad ?? (raw.estado_morosidad as string | null | undefined) ?? null,
      telegramChatId: (raw.telegram_chat_id as string | null | undefined) ?? (raw.telegramChatId as string | null | undefined) ?? null,
    }
  }, [contact])

  const [hydratedContact, setHydratedContact] = useState<MessagingContact | null>(null)

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [activeChannel, setActiveChannel] = useState<MessagingChannel>(channel)
  const [sending, setSending] = useState(false)
  const [useEvolutionApi, setUseEvolutionApi] = useState(false)
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [cloudTemplates, setCloudTemplates] = useState<CloudTemplate[]>([])
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<'all' | WhatsappTemplateCategory>('all')
  const [newTemplateTitle, setNewTemplateTitle] = useState('')
  const [newTemplateCategory, setNewTemplateCategory] = useState<string>('general')
  const [messageType, setMessageType] = useState<MessageType>('general')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [editingTemplateTitle, setEditingTemplateTitle] = useState('')
  const [editingTemplateMessage, setEditingTemplateMessage] = useState('')
  const [editingTemplateCategory, setEditingTemplateCategory] = useState<string>('general')
  const [editingTemplateSubject, setEditingTemplateSubject] = useState('')
  const [pendingTemplate, setPendingTemplate] = useState<UnifiedTemplate | null>(null)
  const [messageDirty, setMessageDirty] = useState(false)
  const [subjectDirty, setSubjectDirty] = useState(false)

  const [distributorPhone, setDistributorPhone] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailCategoryFilter, setEmailCategoryFilter] = useState<'all' | EmailTemplateCategory>('all')
  const [scheduledFor, setScheduledFor] = useState('')
  const [fieldSearch, setFieldSearch] = useState('')

  const [legacyTemplates, setLegacyTemplates] = useState<LegacyTemplate[]>([])
  const [showLegacyImport, setShowLegacyImport] = useState(false)
  const [legacyImporting, setLegacyImporting] = useState(false)
  const [legacyImportError, setLegacyImportError] = useState<string | null>(null)
  const [legacyImportSummary, setLegacyImportSummary] = useState<{ imported: number; skipped: number } | null>(null)
  const [legacyMigrated, setLegacyMigrated] = useState(false)
  const [legacyCleaned, setLegacyCleaned] = useState(false)
  const [legacyCleanError, setLegacyCleanError] = useState<string | null>(null)
  const [showSystemTemplates, setShowSystemTemplates] = useState(false)
  const [showUserTemplates, setShowUserTemplates] = useState(true)

  const exampleTemplate = useMemo<SystemTemplate>(
    () => ({
      id: 'ejemplo_personalizado',
      templateKey: 'ejemplo_personalizado',
      label: 'Ejemplo personalizado',
      category: 'basic',
      message: [
        'Hola {cliente}, soy {vendedor} de {organizacion}.',
        'Te escribo por tu cuenta Royal Prestige (HyCite) #{cuenta_hycite}.',
        'Saldo actual: $' + '{saldo_actual}. Moroso: $' + '{monto_moroso}.',
        'Si ya pagaste, ignora este mensaje. Si necesitas ayuda, escríbeme al {vendedor_telefono}.',
      ].join('\n'),
    }),
    []
  )

  const activeContact = hydratedContact ?? resolvedContact

  const variables = useMemo(() => {
    const cliente = firstName(activeContact.nombre ?? '')
    const currentUserName = [currentUser?.nombre, currentUser?.apellido].filter(Boolean).join(' ').trim()
    const responsableNombre = activeContact.responsableNombre ?? currentUserName
    const vendedorNombre = activeContact.vendedorNombre
      ?? activeContact.vendedor
      ?? activeContact.responsableNombre
      ?? currentUserName
      ?? ''
    const recomendadoPorNombre = activeContact.recomendadoPorNombre ?? activeContact.recomendadoPor ?? ''
    const cobranzasTelefono = '7862913042'
    const vendedorTelefonoBase = activeContact.vendedorTelefono
      ?? distributorPhone
      ?? currentUser?.telefono
      ?? ''
    const vendedorTelefono = messageType === 'cartera' ? cobranzasTelefono : vendedorTelefonoBase
    return {
      cliente,
      nombre: cliente,
      telefono: activeContact.telefono ?? '',
      vendedor_nombre: vendedorNombre,
      vendedor_telefono: vendedorTelefono,
      responsable_nombre: responsableNombre,
      recomendado_por_nombre: recomendadoPorNombre,
      email: activeContact.email ?? '',
      organizacion: currentUser?.organizacion ?? '',
      cuenta_hycite: activeContact.cuentaHycite ?? '',
      saldo_actual: formatAmount(activeContact.saldoActual),
      monto_moroso: formatAmount(activeContact.montoMoroso),
      dias_atraso: activeContact.diasAtraso != null ? String(activeContact.diasAtraso) : '',
      estado_morosidad: activeContact.estadoMorosidad ?? '',
      fuente: activeContact.fuente ?? '',
      programa: activeContact.programa ?? '',
      ciudad: activeContact.ciudad ?? '',
    }
  }, [activeContact, currentUser?.apellido, currentUser?.nombre, currentUser?.organizacion, currentUser?.telefono, distributorPhone, messageType])

  const systemTemplates = useMemo<UnifiedTemplate[]>(() => {
    if (activeChannel === 'email') {
      return emailTemplates.map((template) => ({
        id: `sys_email_${template.id}`,
        label: template.label,
        message: template.message,
        subject: template.subject,
        category: normalizeCategoryValue(template.category),
        channel: 'email',
        source: 'system' as const,
      }))
    }
    const base = baseTemplates.map((template) => ({
      id: `sys_${template.id}`,
      label: template.label,
      message: template.message,
      category: normalizeCategoryValue(template.category),
      channel: activeChannel,
      source: 'system' as const,
    }))
    return [
      {
        id: `sys_${exampleTemplate.id}`,
        label: exampleTemplate.label,
        message: exampleTemplate.message,
        category: normalizeCategoryValue(exampleTemplate.category),
        channel: activeChannel,
        source: 'system' as const,
      },
      ...base,
    ]
  }, [activeChannel, exampleTemplate])

  const cloudTemplatesForChannel = useMemo<UnifiedTemplate[]>(() => {
    const filtered = cloudTemplates.filter((template) =>
      template.canal === activeChannel || template.canal === 'all'
    )
    return filtered.map((template) => ({
      id: template.id,
      label: template.nombre,
      message: template.cuerpo,
      subject: template.asunto,
      category: normalizeCategoryValue(template.category),
      channel: template.canal === 'all' ? activeChannel : (template.canal as MessagingChannel),
      source: 'cloud',
      raw: template,
    }))
  }, [activeChannel, cloudTemplates])

  const templatesForChannel = useMemo<UnifiedTemplate[]>(() => {
    return [...systemTemplates, ...cloudTemplatesForChannel]
  }, [cloudTemplatesForChannel, systemTemplates])

  const filteredSystemTemplates = useMemo(() => {
    if (activeChannel === 'email') {
      if (emailCategoryFilter === 'all') return systemTemplates
      const filter = normalizeCategoryValue(emailCategoryFilter)
      return systemTemplates.filter((template) => normalizeCategoryValue(template.category) === filter)
    }
    if (categoryFilter === 'all') return systemTemplates
    const filter = normalizeCategoryValue(categoryFilter)
    return systemTemplates.filter((template) => normalizeCategoryValue(template.category) === filter)
  }, [activeChannel, categoryFilter, emailCategoryFilter, systemTemplates])

  const loadUserTemplates = useCallback(async () => {
    if (!open) return
    setTemplatesError(null)
    if (!configured) {
      setCloudTemplates([])
      return
    }
    if (!session?.user?.id) {
      setCloudTemplates([])
      return
    }
    setTemplatesLoading(true)
    const { data, error } = await supabase
      .from('message_templates')
      .select('id, nombre, cuerpo, asunto, canal, category, scope, is_system, owner_id, org_id')
      .order('updated_at', { ascending: false })
    if (error) {
      const message = (error.message || '').toLowerCase()
      if (message.includes('relation') && message.includes('message_templates')) {
        setTemplatesError('Plantillas en la nube no disponibles (migración pendiente).')
      } else if (error.code === '404' || error.code === 'PGRST404') {
        setTemplatesError('Plantillas en la nube no disponibles.')
      } else {
        setTemplatesError('No se pudieron cargar las plantillas.')
      }
      setCloudTemplates([])
      setTemplatesLoading(false)
      return
    }
    setCloudTemplates((data as CloudTemplate[] | null) ?? [])
    setTemplatesLoading(false)
  }, [configured, open, showToast])

  const loadDistributorPhone = useCallback(async () => {
    if (!open) return
    if (!isSupabaseConfigured) {
      setDistributorPhone(currentUser?.telefono ?? '')
      return
    }
    const { data, error } = await supabase.rpc('get_distributor_phone')
    const rpcPhone = (data as string | null) ?? ''
    if (!error && rpcPhone.trim()) {
      setDistributorPhone(rpcPhone)
      return
    }
    if (currentUser?.telefono?.trim()) {
      setDistributorPhone(currentUser.telefono)
      return
    }
    const userId = session?.user.id
    if (!userId) {
      setDistributorPhone('')
      return
    }
    const { data: userRow } = await supabase
      .from('usuarios')
      .select('telefono')
      .eq('id', userId)
      .maybeSingle()
    setDistributorPhone((userRow as { telefono?: string | null } | null)?.telefono ?? '')
  }, [open, currentUser, session])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUserTemplates()
  }, [open, loadUserTemplates])

  useEffect(() => {
    if (!open) return
    setShowSystemTemplates(false)
    setShowUserTemplates(true)
  }, [activeChannel, open])

  useEffect(() => {
    if (!open) return
    if (!configured || !session?.user.id) return
    if (typeof window === 'undefined') return
    const migrated = window.localStorage.getItem(LEGACY_MIGRATED_KEY) === 'true'
    const cleaned = window.localStorage.getItem(LEGACY_CLEANED_KEY) === 'true'
    setLegacyMigrated(migrated)
    setLegacyCleaned(cleaned)
    const legacy = loadLegacyTemplates()
    if (legacy.length === 0) return
    setLegacyTemplates(legacy)
    if (!migrated) {
      setShowLegacyImport(true)
    }
  }, [configured, open, session?.user.id])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDistributorPhone()
  }, [open, loadDistributorPhone])

  useEffect(() => {
    setHydratedContact(null)
    if (!open) return
    if (!configured) return
    const clienteId = resolvedContact.clienteId
    const needsHydration =
      resolvedContact.saldoActual == null
      || resolvedContact.montoMoroso == null
      || resolvedContact.diasAtraso == null
      || resolvedContact.estadoMorosidad == null
      || !resolvedContact.cuentaHycite
    if (!needsHydration) return
    let cancelled = false
    const load = async () => {
      let data: unknown | null = null
      if (clienteId) {
        const response = await supabase
          .from('clientes')
          .select('saldo_actual, monto_moroso, dias_atraso, estado_morosidad, hycite_id')
          .eq('id', clienteId)
          .maybeSingle()
        data = response.data ?? null
      }
      if (!data) {
        const rawPhone = resolvedContact.telefono ?? ''
        const phoneDigits = rawPhone ? sanitizePhone(rawPhone) : ''
        if (phoneDigits.length >= 7) {
          const response = await supabase
            .from('clientes')
            .select('saldo_actual, monto_moroso, dias_atraso, estado_morosidad, hycite_id')
            .or(`telefono.ilike.%${phoneDigits}%,telefono_casa.ilike.%${phoneDigits}%`)
            .limit(1)
            .maybeSingle()
          data = response.data ?? null
        }
      }
      if (cancelled || !data) return
      const row = data as {
        saldo_actual?: number | string | null
        monto_moroso?: number | string | null
        dias_atraso?: number | null
        estado_morosidad?: string | null
        hycite_id?: string | null
      }
      setHydratedContact({
        ...resolvedContact,
        saldoActual: resolvedContact.saldoActual ?? (row.saldo_actual != null ? Number(row.saldo_actual) : null),
        montoMoroso: resolvedContact.montoMoroso ?? (row.monto_moroso != null ? Number(row.monto_moroso) : null),
        diasAtraso: resolvedContact.diasAtraso ?? row.dias_atraso ?? null,
        estadoMorosidad: resolvedContact.estadoMorosidad ?? row.estado_morosidad ?? null,
        cuentaHycite: resolvedContact.cuentaHycite ?? row.hycite_id ?? null,
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [configured, open, resolvedContact])

  useEffect(() => {
    if (!open || !contact) return
    const preferred = initialTemplateId
      ? templatesForChannel.find((tmpl) => tmpl.id === initialTemplateId) ?? null
      : null
    if (preferred) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTemplateId(preferred.id)
      setMessage(canonicalizeTemplate(preferred.message))
      if (preferred.subject && activeChannel === 'email') {
        setEmailSubject(preferred.subject)
      }
    } else if (templatesForChannel.length > 0) {
      const fallbackTemplate = templatesForChannel[0]
      setSelectedTemplateId(fallbackTemplate.id)
      setMessage(canonicalizeTemplate(fallbackTemplate.message))
      if (fallbackTemplate.subject && activeChannel === 'email') {
        setEmailSubject(fallbackTemplate.subject)
      }
    }
    setImageUrl('')
    setMessageDirty(false)
    setSubjectDirty(false)
  }, [activeChannel, contact, initialTemplateId, open, templatesForChannel])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveChannel(channel)
  }, [channel, open])

  const channelLabel = CHANNEL_LABELS[activeChannel] ?? activeChannel
  const hasContact = Boolean(contact)
  const canSendMessage = hasContact && message.trim().length > 0
  const contactRef = getMessagingContactRef(activeContact)
  const contactContextLabel = contactRef
    ? contactRef.contacto_tipo === 'cliente'
      ? 'Cliente'
      : 'Lead'
    : 'Contacto'
  const saludFinanciera = useMemo(() => {
    if (contactRef?.contacto_tipo !== 'cliente') return null
    const saldo = activeContact.saldoActual ?? 0
    const moroso = activeContact.montoMoroso ?? 0
    if (moroso > 0) return `Moroso $${Number(moroso).toFixed(2)}`
    if (saldo > 0) return `Saldo $${Number(saldo).toFixed(2)}`
    return 'Cuenta al día'
  }, [activeContact.montoMoroso, activeContact.saldoActual, contactRef?.contacto_tipo])
  const phoneValue = activeContact.telefono ? sanitizePhone(activeContact.telefono) : ''
  const hasPhone = phoneValue.length > 0
  const hasEmail = Boolean(activeContact.email?.trim())
  const telegramChatId = (activeContact as { telegramChatId?: string | null } | null)?.telegramChatId ?? null
  const hasTelegram = Boolean(telegramChatId)
  const telegramEnabled = false
  const channelTabs: MessagingChannel[] = ['whatsapp', 'sms', 'email', 'telegram']
  const charCount = message.length
  const charOver = charCount > 1024
  const smsSegmentSize = /[^\x00-\x7F]/.test(message) ? 70 : 160
  const smsSegments = charCount > 0 ? Math.ceil(charCount / smsSegmentSize) : 0

  const warningMessage =
    activeChannel === 'email'
      ? !hasEmail
        ? t('messaging.emailMissing')
        : null
      : activeChannel === 'telegram'
        ? !telegramEnabled
          ? 'Telegram aún no está habilitado para envío desde CRM.'
          : !hasTelegram
            ? 'Este contacto no tiene Telegram vinculado.'
            : null
      : !hasPhone
        ? t('messaging.phoneMissing')
        : null

  const inferredMessageType = useMemo<MessageType>(() => {
    const selectedTemplate = templatesForChannel.find((template) => template.id === selectedTemplateId) ?? null
    const category = selectedTemplate?.category
    if (category && category in MESSAGE_TYPE_LABELS) {
      return category as MessageType
    }
    return inferMessageTypeFromId(selectedTemplateId ?? initialTemplateId)
  }, [templatesForChannel, initialTemplateId, selectedTemplateId])

  const resolvedMessage = useMemo(() => resolveTemplate(message, variables), [message, variables])
  const missingPlaceholders = resolvedMessage.missing

  const placeholderGroups = useMemo(() => {
    const term = fieldSearch.trim().toLowerCase()
    const map = new Map<string, { label: string; token: string }[]>()
    PLACEHOLDER_OPTIONS.forEach((option) => {
      const matches = !term
        || option.label.toLowerCase().includes(term)
        || option.token.toLowerCase().includes(term)
      if (!matches) return
      if (!map.has(option.group)) map.set(option.group, [])
      map.get(option.group)!.push({ label: option.label, token: option.token })
    })
    return Array.from(map.entries())
  }, [fieldSearch])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessageType(inferredMessageType)
  }, [inferredMessageType, open])

  const filteredTemplates = useMemo(() => {
    const base = templatesForChannel.filter((template) => template.source === 'cloud')
    if (activeChannel === 'email') {
      const filter = normalizeCategoryValue(emailCategoryFilter)
      return base.filter((template) =>
        emailCategoryFilter === 'all' || normalizeCategoryValue(template.category) === filter
      )
    }
    if (categoryFilter === 'all') return base
    const filter = normalizeCategoryValue(categoryFilter)
    return base.filter((template) => normalizeCategoryValue(template.category) === filter)
  }, [activeChannel, categoryFilter, emailCategoryFilter, templatesForChannel])

  const selectedTemplate = useMemo(() => {
    return templatesForChannel.find((template) => template.id === selectedTemplateId) ?? null
  }, [templatesForChannel, selectedTemplateId])

  // --- VARIABLE INSERTION AT CURSOR ---
  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setMessage((prev) => prev + variable)
      setMessageDirty(true)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const next = message.slice(0, start) + variable + message.slice(end)
    setMessage(next)
    setMessageDirty(true)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + variable.length, start + variable.length)
    }, 0)
  }

  const applyTemplate = (template: UnifiedTemplate, mode: 'replace' | 'insert') => {
    const nextMessage = canonicalizeTemplate(template.message || '')
    if (mode === 'replace') {
      setMessage(nextMessage)
      if (activeChannel === 'email') {
        setEmailSubject(template.subject ?? '')
      }
      setMessageDirty(false)
      setSubjectDirty(false)
    } else {
      const combined = message.trim()
        ? `${message.trim()}\n\n${nextMessage}`.trim()
        : nextMessage
      setMessage(combined)
      if (activeChannel === 'email' && !emailSubject.trim() && template.subject) {
        setEmailSubject(template.subject)
      }
      setMessageDirty(true)
    }
    setSelectedTemplateId(template.id)
    setPendingTemplate(null)
  }

  const handleSelectTemplate = (template: UnifiedTemplate) => {
    if ((messageDirty || subjectDirty) && template.id !== selectedTemplateId) {
      setPendingTemplate(template)
      return
    }
    applyTemplate(template, 'replace')
  }

  const handleSaveTemplate = async () => {
    const title = newTemplateTitle.trim()
    const body = message.trim()
    if (!title || !body) return
    if (!configured || !session?.user.id) {
      showToast('Configura Supabase para guardar plantillas.', 'error')
      return
    }
    setSavingTemplate(true)
    const payload = {
      owner_id: session.user.id,
      org_id: currentUser?.organizacion ?? null,
      canal: activeChannel,
      nombre: title,
      asunto: activeChannel === 'email' ? (emailSubject.trim() || null) : null,
      cuerpo: body,
      category: newTemplateCategory,
      scope: 'personal',
    }
    const { error } = await supabase.from('message_templates').insert(payload)
    if (error) {
      showToast(error.message, 'error')
      setSavingTemplate(false)
      return
    }
    showToast('Plantilla guardada')
    setNewTemplateTitle('')
    setNewTemplateCategory('general')
    setSavingTemplate(false)
    void loadUserTemplates()
  }

  const handleStartEdit = (template: UnifiedTemplate) => {
    if (template.source !== 'cloud' || !template.raw) return
    setEditingTemplateId(template.id)
    setEditingTemplateTitle(template.label)
    setEditingTemplateMessage(template.message)
    setEditingTemplateSubject(template.subject ?? '')
    setEditingTemplateCategory(template.category || 'general')
  }

  const handleCancelEdit = () => {
    setEditingTemplateId(null)
  }

  const handleSaveEdit = async () => {
    if (!editingTemplateId || !editingTemplateTitle.trim()) return
    if (!configured) {
      showToast('Configura Supabase para editar plantillas.', 'error')
      return
    }
    const { error } = await supabase
      .from('message_templates')
      .update({
        nombre: editingTemplateTitle.trim(),
        cuerpo: editingTemplateMessage.trim(),
        asunto: activeChannel === 'email' ? (editingTemplateSubject.trim() || null) : null,
        category: editingTemplateCategory,
      })
      .eq('id', editingTemplateId)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    if (selectedTemplateId === editingTemplateId) {
      setMessage(canonicalizeTemplate(editingTemplateMessage.trim()))
    }
    setEditingTemplateId(null)
    showToast('Plantilla actualizada')
    void loadUserTemplates()
  }

  const handleDuplicateTemplate = async (template: UnifiedTemplate) => {
    if (!configured || !session?.user.id) return
    const title = `Copia de ${template.label}`
    const payload = {
      owner_id: session.user.id,
      org_id: currentUser?.organizacion ?? null,
      canal: activeChannel,
      nombre: title,
      asunto: template.subject ?? null,
      cuerpo: template.message,
      category: template.category,
      scope: 'personal',
    }
    const { error } = await supabase.from('message_templates').insert(payload)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Plantilla duplicada')
    void loadUserTemplates()
  }

  const handleDeleteTemplate = async (template: UnifiedTemplate) => {
    if (template.source !== 'cloud') return
    const ok = window.confirm(`Eliminar la plantilla "${template.label}"?`)
    if (!ok) return
    const { error } = await supabase.from('message_templates').delete().eq('id', template.id)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    if (selectedTemplateId === template.id) {
      setSelectedTemplateId(null)
    }
    showToast('Plantilla eliminada')
    void loadUserTemplates()
  }

  const handleImportLegacyTemplates = async () => {
    if (!configured || !session?.user.id) return
    if (legacyTemplates.length === 0) return
    setLegacyImporting(true)
    setLegacyImportError(null)
    setLegacyImportSummary(null)

    const existing = cloudTemplates
    const existingNames = new Set(existing.map((t) => t.nombre.trim().toLowerCase()))
    const existingSignatures = new Set(
      existing.map((t) =>
        `${t.canal}|${t.asunto ?? ''}|${t.cuerpo}`.toLowerCase()
      )
    )

    let imported = 0
    let skipped = 0
    let failed = 0

    const ensureUniqueName = (base: string) => {
      let name = base
      let suffix = 0
      while (existingNames.has(name.toLowerCase())) {
        suffix += 1
        name = suffix === 1 ? `${base} (importado)` : `${base} (importado ${suffix})`
      }
      existingNames.add(name.toLowerCase())
      return name
    }

    for (const legacy of legacyTemplates) {
      const signature = `${legacy.channel}|${legacy.subject ?? ''}|${legacy.message}`.toLowerCase()
      if (existingSignatures.has(signature)) {
        skipped += 1
        continue
      }
      const name = ensureUniqueName(legacy.label)
      const payload = {
        owner_id: session.user.id,
        org_id: currentUser?.organizacion ?? null,
        canal: legacy.channel,
        nombre: name,
        asunto: legacy.subject,
        cuerpo: legacy.message,
        category: legacy.category || 'general',
        scope: 'personal',
      }
      const { error } = await supabase.from('message_templates').insert(payload)
      if (error) {
        failed += 1
      } else {
        imported += 1
        existingSignatures.add(signature)
      }
    }

    setLegacyImporting(false)

    if (failed > 0) {
      setLegacyImportError(`No se pudieron importar ${failed} plantilla(s). Puedes reintentar.`)
      setLegacyImportSummary({ imported, skipped })
      return
    }

    setLegacyImportSummary({ imported, skipped })
    setShowLegacyImport(false)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LEGACY_MIGRATED_KEY, 'true')
    }
    setLegacyMigrated(true)
    void loadUserTemplates()
  }

  const handleSkipLegacyImport = () => {
    setShowLegacyImport(false)
  }

  const handleCleanLegacyTemplates = async () => {
    if (!configured || !session?.user.id) return
    if (legacyTemplates.length === 0) return
    setLegacyCleanError(null)

    const existingSignatures = new Set(
      cloudTemplates.map((t) =>
        `${t.canal}|${t.asunto ?? ''}|${t.cuerpo}`.toLowerCase()
      )
    )

    const missing = legacyTemplates.filter((legacy) => {
      const signature = `${legacy.channel}|${legacy.subject ?? ''}|${legacy.message}`.toLowerCase()
      return !existingSignatures.has(signature)
    })

    if (missing.length > 0) {
      setLegacyCleanError('Faltan plantillas en la nube. Reintenta la importación.')
      return
    }

    const ok = window.confirm(`Se eliminarán ${legacyTemplates.length} plantilla(s) locales. ¿Deseas continuar?`)
    if (!ok) return

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LEGACY_TEMPLATES_KEY)
      window.localStorage.setItem(LEGACY_CLEANED_KEY, 'true')
    }
    setLegacyCleaned(true)
    showToast('Plantillas locales eliminadas')
  }

  const saveOutboxMessage = useCallback(async (status: 'borrador' | 'programado' | 'enviado' | 'fallido' | 'cancelado', extra?: {
    scheduled_for?: string | null
    sent_at?: string | null
    failed_at?: string | null
    error_message?: string | null
  }) => {
    if (!configured || !session?.user.id) return
    const contactRef = getMessagingContactRef(activeContact)
    const destinatario =
      activeChannel === 'email'
        ? activeContact.email ?? null
        : activeChannel === 'telegram'
          ? telegramChatId
          : phoneValue || null
    const templateId = selectedTemplate?.source === 'cloud' ? selectedTemplate.id : null
    const payload = {
      owner_id: session.user.id,
      org_id: currentUser?.organizacion ?? null,
      contact_tipo: contactRef?.contacto_tipo ?? null,
      contact_id: contactRef?.contacto_id ?? null,
      canal: activeChannel,
      destinatario,
      asunto: activeChannel === 'email' ? (emailSubject.trim() || null) : null,
      mensaje: message.trim(),
      mensaje_resuelto: resolvedMessage.text.trim(),
      template_id: templateId,
      status,
      scheduled_for: extra?.scheduled_for ?? null,
      sent_at: extra?.sent_at ?? null,
      failed_at: extra?.failed_at ?? null,
      error_message: extra?.error_message ?? null,
    }
    await supabase.from('outbox_messages').insert(payload)
  }, [activeChannel, activeContact, configured, currentUser?.organizacion, emailSubject, message, phoneValue, resolvedMessage.text, selectedTemplate, session?.user.id, telegramChatId])

  // --- SEND ---
  const buildSenderName = useCallback(() => {
    const parts = [currentUser?.nombre, currentUser?.apellido].filter(Boolean)
    return parts.join(' ').trim() || currentUser?.email || ''
  }, [currentUser?.apellido, currentUser?.email, currentUser?.nombre])

  const saveMessageLog = useCallback(
    async (finalMessage: string, sentAt: string) => {
      if (!isSupabaseConfigured) return
      const senderId = session?.user.id ?? null
      const senderName = buildSenderName()
      const messageTypeLabel = MESSAGE_TYPE_LABELS[messageType]
      const summary = `Mensaje ${channelLabel} (${messageTypeLabel})${senderName ? ` por ${senderName}` : ''}.`
      const contactRef = getMessagingContactRef(activeContact)

      if (contactRef?.contacto_tipo === 'cliente') {
        const { error } = await supabase.from('notasrp').insert({
          cliente_id: contactRef.contacto_id,
          contenido: summary,
          canal: activeChannel,
          tipo_mensaje: messageType,
          enviado_por: senderId,
          enviado_en: sentAt,
          mensaje: finalMessage,
        })
        if (error) {
          showToast(error.message, 'error')
        }
      }

      if (contactRef?.contacto_tipo === 'lead' && senderId) {
        const { error } = await supabase.from('lead_notas').insert({
          lead_id: contactRef.contacto_id,
          usuario_id: senderId,
          nota: summary,
          tipo: 'mensajeria',
          canal: activeChannel,
          tipo_mensaje: messageType,
          mensaje: finalMessage,
        })
        if (error) {
          showToast(error.message, 'error')
        }
      }

      if (contactRef) {
        const activityType =
          activeChannel === 'whatsapp'
            ? 'whatsapp'
            : activeChannel === 'email'
              ? 'email'
              : 'nota'
        const { error: activityError } = await supabase.from('contacto_actividades').insert({
          contacto_tipo: contactRef.contacto_tipo,
          contacto_id: contactRef.contacto_id,
          tipo: activityType,
          resumen: summary,
          contenido: finalMessage,
          metadata: {
            canal: activeChannel,
            tipo_mensaje: messageType,
          },
          autor_id: senderId,
          fecha_actividad: sentAt,
        })
        if (activityError) {
          showToast(activityError.message, 'error')
        }
      }
    },
    [activeChannel, activeContact, buildSenderName, channelLabel, messageType, session?.user.id, showToast]
  )

  const updateLeadContact = useCallback(async () => {
    const contactRef = getMessagingContactRef(activeContact)
    if (contactRef?.contacto_tipo !== 'lead') return
    const { error } = await supabase
      .from('leads')
      .update({
        estado_pipeline: 'contactado',
        whatsapp_mensaje_enviado_at: new Date().toISOString(),
      })
      .eq('id', contactRef.contacto_id)
    if (error) showToast(error.message, 'error')
  }, [activeContact, showToast])

  const handleSend = async () => {
    if (!hasContact || !canSendMessage || warningMessage) return
    setSending(true)
    const finalMessage = imageUrl.trim()
      ? resolvedMessage.text.trim() + '\n\n' + imageUrl.trim()
      : resolvedMessage.text
    const sentAt = new Date().toISOString()
    try {
      if (activeChannel === 'telegram') {
        showToast('Telegram no está disponible para envío desde el CRM.', 'error')
        await saveOutboxMessage('fallido', { failed_at: sentAt, error_message: 'Telegram no habilitado' })
        return
      }
      if (activeChannel === 'whatsapp') {
        if (useEvolutionApi && configured) {
          try {
            const { data, error } = await supabase.functions.invoke('send-whatsapp', {
              body: {
                phone: phoneValue,
                message: finalMessage,
              },
            })
            if (error) throw error
            if (data?.error) throw new Error(data.error)
            showToast('Mensaje enviado por WhatsApp')
          } catch (error) {
            const message = error instanceof Error ? error.message : 'No se pudo enviar el mensaje.'
            showToast(message, 'error')
            await saveOutboxMessage('fallido', { failed_at: sentAt, error_message: message })
            return
          }
        } else {
          const url = activeContact.telefono ? buildWhatsappUrl(activeContact.telefono, finalMessage) : null
          if (url) window.open(url, '_blank', 'noopener,noreferrer')
        }
      }
      if (activeChannel === 'sms' && hasPhone) {
        window.open(`sms:${phoneValue}?&body=${encodeURIComponent(finalMessage)}`, '_blank', 'noopener,noreferrer')
      }
      if (activeChannel === 'email' && hasEmail && activeContact.email) {
        if (!isSupabaseConfigured || !session?.access_token) {
          showToast('Configura Supabase e inicia sesion para enviar correos.', 'error')
          await saveOutboxMessage('fallido', { failed_at: sentAt, error_message: 'Supabase no configurado' })
          return
        }

        const subject = emailSubject.trim() || t('messaging.emailSubject')
        const senderName = buildSenderName()
        const { data, error } = await supabase.functions.invoke('send-message-email', {
          body: {
            to: activeContact.email,
            subject,
            message: finalMessage,
            contactName: activeContact.nombre,
            replyTo: currentUser?.email ?? null,
            senderName: senderName || null,
          },
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })

        if (error || (data as { error?: string } | null)?.error) {
          const message = error?.message || (data as { error?: string } | null)?.error || 'No se pudo enviar el correo.'
          showToast(message, 'error')
          await saveOutboxMessage('fallido', { failed_at: sentAt, error_message: message })
          return
        }

        showToast('Correo enviado')
      }

      await saveMessageLog(finalMessage, sentAt)
      await updateLeadContact()
      await saveOutboxMessage('enviado', { sent_at: sentAt })
    } finally {
      setSending(false)
    }
  }

  const handleSaveDraft = async () => {
    if (!message.trim()) return
    await saveOutboxMessage('borrador')
    showToast('Borrador guardado')
    setMessageDirty(false)
    setSubjectDirty(false)
  }

  const handleSchedule = async () => {
    if (!scheduledFor) {
      showToast('Selecciona fecha y hora para programar.', 'error')
      return
    }
    const scheduledIso = new Date(scheduledFor).toISOString()
    await saveOutboxMessage('programado', { scheduled_for: scheduledIso })
    showToast('Envío programado')
  }

  return (
    <Modal
      open={open}
      title="Enviar mensaje"
      description=""
      onClose={onClose}
      size="xl"
      actions={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="ghost" type="button" onClick={handleSaveDraft} disabled={!message.trim()}>
            Guardar borrador
          </Button>
          <Button variant="ghost" type="button" onClick={handleSchedule} disabled={!message.trim() || !scheduledFor}>
            Programar
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSendMessage || Boolean(warningMessage) || sending || charOver}>
            {sending ? t('common.saving') : 'Enviar'}
          </Button>
        </>
      }
    >
      {!hasContact && (
        <div className="template-empty" style={{ marginBottom: '1rem' }}>
          Selecciona un contacto para enviar el mensaje.
        </div>
      )}
      {/* HEADER */}
      <div className="message-modal-header">
        <div>
          <div className="message-modal-contact">{activeContact.nombre || 'Contacto'}</div>
          <div className="message-modal-context">
            {contactContextLabel}{saludFinanciera ? ` · ${saludFinanciera}` : ''}
          </div>
        </div>
        <div className="message-modal-recipient">
          <div>Destinatario</div>
          <span>{activeChannel === 'email' ? (activeContact.email ?? '-') : (activeContact.telefono ?? '-')}</span>
        </div>
      </div>

      {/* CANAL TABS */}
      <div className="template-tabs messaging-tabs">
        {channelTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`template-tab ${activeChannel === tab ? 'active' : ''}`.trim()}
            onClick={() => setActiveChannel(tab)}
          >
            {CHANNEL_LABELS[tab] ?? tab}
          </button>
        ))}
      </div>

      <div className="message-modal-grid">
        {/* COLUMNA IZQUIERDA */}
        <div className="message-sidebar">
          <div className="message-card">
            <div className="message-card-title">Contacto</div>
            <div className="message-card-row"><span>Teléfono</span><strong>{activeContact.telefono ?? '-'}</strong></div>
            <div className="message-card-row"><span>Email</span><strong>{activeContact.email ?? '-'}</strong></div>
            <div className="message-card-row"><span>Responsable</span><strong>{activeContact.responsableNombre ?? activeContact.vendedorNombre ?? '-'}</strong></div>
            <div className="message-card-row"><span>Última interacción</span><strong>—</strong></div>
          </div>
          <div className="message-card message-card-history">
            <div className="message-card-title">Historial reciente</div>
            <div className="message-history-wrap">
              {contactRef ? (
                <ContactoTimeline
                  contactoTipo={contactRef.contacto_tipo}
                  contactoId={contactRef.contacto_id}
                  emptyLabel="Sin historial reciente"
                />
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)' }}>Sin historial disponible.</div>
              )}
            </div>
          </div>
        </div>

        {/* COLUMNA CENTRAL */}
        <div className="message-center">
          {showLegacyImport && (
            <div className="message-card">
              <div className="message-card-title">Importar plantillas locales</div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Encontramos plantillas guardadas localmente. ¿Quieres importarlas a tu cuenta?
              </p>
              {legacyImportSummary && (
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Importadas: {legacyImportSummary.imported} · Omitidas: {legacyImportSummary.skipped}
                </p>
              )}
              {legacyImportError && (
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#d97706' }}>
                  {legacyImportError}
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Button type="button" onClick={handleImportLegacyTemplates} disabled={legacyImporting || templatesLoading}>
                  {legacyImporting ? 'Importando...' : 'Importar'}
                </Button>
                <Button variant="ghost" type="button" onClick={handleSkipLegacyImport} disabled={legacyImporting}>
                  Omitir por ahora
                </Button>
              </div>
            </div>
          )}
          {!showLegacyImport && legacyMigrated && !legacyCleaned && legacyTemplates.length > 0 && (
            <div className="message-card">
              <div className="message-card-title">Limpiar plantillas locales</div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Tus plantillas ya fueron migradas. Puedes eliminar la copia local de forma segura.
              </p>
              {legacyCleanError && (
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#d97706' }}>
                  {legacyCleanError}
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Button type="button" onClick={handleCleanLegacyTemplates}>
                  Eliminar plantillas locales
                </Button>
                <Button variant="ghost" type="button" onClick={handleImportLegacyTemplates}>
                  Reintentar importación
                </Button>
              </div>
            </div>
          )}
          {legacyCleaned && (
            <div className="message-card">
              <div className="message-card-title">Plantillas locales</div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Limpieza completada. Tus plantillas ya están en la nube.
              </p>
            </div>
          )}
          <div className="message-card">
            <div className="message-card-title">Plantillas</div>
            <div className="message-template-filters">
              {activeChannel === 'email' && (
                <div className="message-filter-row">
                  <button type="button" onClick={() => setEmailCategoryFilter('all')} className={`message-filter ${emailCategoryFilter === 'all' ? 'active' : ''}`}>Todas</button>
                  {EMAIL_CATEGORIES.map((cat) => (
                    <button key={cat} type="button" onClick={() => setEmailCategoryFilter(cat)} className={`message-filter ${emailCategoryFilter === cat ? 'active' : ''}`}>
                      {EMAIL_CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>
              )}
              {activeChannel !== 'email' && (
                <div className="message-filter-row">
                  <button type="button" onClick={() => setCategoryFilter('all')} className={`message-filter ${categoryFilter === 'all' ? 'active' : ''}`}>Todas</button>
                  {CATEGORY_OPTIONS.map((category) => (
                    <button key={category.value} type="button" onClick={() => setCategoryFilter(category.value)} className={`message-filter ${categoryFilter === category.value ? 'active' : ''}`}>
                      {category.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="message-template-section">
              <button
                type="button"
                className="message-section-toggle"
                onClick={() => setShowUserTemplates((prev) => !prev)}
              >
                <span>Mis plantillas</span>
                <span className="message-section-count">{templatesLoading ? '...' : filteredTemplates.length}</span>
                <span className={`message-section-chevron ${showUserTemplates ? 'open' : ''}`}>▾</span>
              </button>
              {showUserTemplates && (
                <div className="message-section-body">
                  {templatesLoading && (
                    <div className="template-empty">Cargando plantillas...</div>
                  )}
                  {!templatesLoading && templatesError && (
                    <div className="template-empty">{templatesError}</div>
                  )}
                  {!templatesLoading && filteredTemplates.length === 0 && (
                    <div className="template-empty">No hay plantillas guardadas.</div>
                  )}
                  {!templatesLoading && filteredTemplates.map((template) =>
                    editingTemplateId === template.id ? (
                      <div key={template.id} className="message-template-edit">
                        <input
                          value={editingTemplateTitle}
                          onChange={(e) => setEditingTemplateTitle(e.target.value)}
                          placeholder="Titulo..."
                        />
                        {activeChannel === 'email' && (
                          <input
                            value={editingTemplateSubject}
                            onChange={(e) => setEditingTemplateSubject(e.target.value)}
                            placeholder="Asunto..."
                          />
                        )}
                        <select
                          value={editingTemplateCategory}
                          onChange={(e) => setEditingTemplateCategory(e.target.value)}
                        >
                          {(activeChannel === 'email'
                            ? EMAIL_CATEGORIES.map((cat) => ({ value: cat, label: EMAIL_CATEGORY_LABELS[cat] }))
                            : CATEGORY_OPTIONS).map((category) => (
                              <option key={category.value} value={category.value}>
                                {category.label}
                              </option>
                            ))}
                        </select>
                        <textarea
                          rows={3}
                          value={editingTemplateMessage}
                          onChange={(e) => setEditingTemplateMessage(e.target.value)}
                        />
                        <div className="message-template-edit-actions">
                          <button type="button" onClick={handleCancelEdit}>Cancelar</button>
                          <Button type="button" onClick={handleSaveEdit} disabled={!editingTemplateTitle.trim()}>
                            Guardar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={template.id}
                        className={`template-item ${selectedTemplateId === template.id ? 'active' : ''}`}
                        onClick={() => handleSelectTemplate(template)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectTemplate(template) }
                        }}
                      >
                        <div className="template-item-header">
                        <span className="template-title">{template.label}</span>
                        <div className="message-template-actions">
                            <span className="message-badge">
                              {activeChannel === 'email'
                                ? EMAIL_CATEGORY_LABELS[template.category as EmailTemplateCategory] ?? template.category
                                : CATEGORY_OPTIONS.find((c) => c.value === template.category)?.label ?? template.category}
                            </span>
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleStartEdit(template) }}>Editar</button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleDuplicateTemplate(template) }}>Duplicar</button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(template) }}>Eliminar</button>
                          </div>
                        </div>
                        <span className="template-snippet">{buildSubtitle(resolveTemplate(template.message, variables).text)}</span>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            <div className="message-template-section">
              <button
                type="button"
                className="message-section-toggle"
                onClick={() => setShowSystemTemplates((prev) => !prev)}
              >
                <span>Plantillas base</span>
                <span className="message-section-count">{filteredSystemTemplates.length}</span>
                <span className={`message-section-chevron ${showSystemTemplates ? 'open' : ''}`}>▾</span>
              </button>
              {showSystemTemplates && (
                <div className="message-section-body">
                  {filteredSystemTemplates.map((template) => (
                    <div
                      key={template.id}
                      className={`template-item ${selectedTemplateId === template.id ? 'active' : ''}`}
                      onClick={() => handleSelectTemplate(template)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectTemplate(template) }
                      }}
                    >
                      <div className="template-item-header">
                        <span className="template-title">{template.label}</span>
                        <span className="message-badge">Base</span>
                      </div>
                      <span className="template-snippet">{buildSubtitle(resolveTemplate(template.message, variables).text)}</span>
                    </div>
                  ))}
                  {filteredSystemTemplates.length === 0 && (
                    <div className="template-empty">No hay plantillas del sistema en esta categoría.</div>
                  )}
                </div>
              )}
            </div>

            {pendingTemplate && (
              <div className="message-template-guard">
                <div>Ya editaste el mensaje. ¿Qué deseas hacer?</div>
                <div className="message-template-guard-actions">
                  <Button type="button" onClick={() => applyTemplate(pendingTemplate, 'replace')}>Reemplazar todo</Button>
                  <Button variant="ghost" type="button" onClick={() => applyTemplate(pendingTemplate, 'insert')}>Insertar y conservar</Button>
                  <Button variant="ghost" type="button" onClick={() => setPendingTemplate(null)}>Cancelar</Button>
                </div>
              </div>
            )}
          </div>

          <div className="message-card">
            <div className="message-card-title">Editor</div>
            <label className="form-field">
              <span>Tipo de mensaje</span>
              <select
                value={messageType}
                onChange={(event) => setMessageType(event.target.value as MessageType)}
              >
                {MESSAGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {activeChannel === 'email' && (
              <label className="form-field">
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Asunto del email</span>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => { setEmailSubject(e.target.value); setSubjectDirty(true) }}
                  placeholder="Asunto del correo..."
                />
              </label>
            )}
            <label className="form-field template-message">
              <span>{t('messaging.messageLabel')}</span>
              <textarea
                ref={textareaRef}
                rows={4}
                value={message}
                onChange={(e) => { setMessage(e.target.value); setMessageDirty(true) }}
                placeholder={t('messaging.messagePlaceholder')}
              />
            </label>

            {activeChannel === 'sms' && (
              <div className="message-counter">
                {charCount} caracteres · {smsSegments} segmento{smsSegments === 1 ? '' : 's'}
              </div>
            )}

            <div className="message-recipient">
              <span>Destinatario</span>
              <strong>{activeChannel === 'email' ? (activeContact.email ?? '-') : (activeContact.telefono ?? '-')}</strong>
            </div>

            {warningMessage && <p className="template-warning">{warningMessage}</p>}

            {/* INSERTAR CAMPO */}
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.35rem' }}>
                Insertar campo
              </div>
              <input
                value={fieldSearch}
                onChange={(event) => setFieldSearch(event.target.value)}
                placeholder="Buscar campo..."
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.8rem',
                  width: '100%',
                }}
              />
              <div
                style={{
                  maxHeight: '160px',
                  overflow: 'auto',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  borderRadius: '0.5rem',
                  padding: '0.4rem',
                  background: 'var(--color-surface, #f9fafb)',
                  marginTop: '0.4rem',
                }}
              >
                {placeholderGroups.length === 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>
                    Sin resultados
                  </div>
                )}
                {placeholderGroups.map(([groupLabel, vars]) => (
                  <div key={groupLabel} style={{ marginBottom: '0.35rem' }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.25rem' }}>
                      {groupLabel}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      {vars.map((variable) => (
                        <button
                          key={variable.token}
                          type="button"
                          onClick={() => insertVariable(variable.token)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.35rem 0.5rem',
                            borderRadius: '0.4rem',
                            border: '1px solid var(--color-border, #e5e7eb)',
                            background: 'var(--color-surface, #ffffff)',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          <span>{variable.label}</span>
                          <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted, #6b7280)' }}>{variable.token}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {missingPlaceholders.length > 0 && (
                <span style={{ fontSize: '0.7rem', color: '#d97706' }}>
                  Faltan datos para: {missingPlaceholders.map((value) => `{${value}}`).join(', ')}
                </span>
              )}
            </div>

            {activeChannel === 'whatsapp' && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted, #6b7280)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    📎 {t('messaging.imagenLabel')}
                  </span>
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder={t('messaging.imagenPlaceholder')}
                  />
                  {imageUrl.trim() && (
                    <p style={{ margin: 0, fontSize: '0.7rem', color: '#10b981' }}>
                      ✓ El link se adjuntará al final del mensaje
                    </p>
                  )}
                </label>
              </div>
            )}

            {activeChannel === 'whatsapp' && configured && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.65rem', fontSize: '0.78rem', color: 'var(--color-text-muted, #6b7280)' }}>
                <input
                  type="checkbox"
                  checked={useEvolutionApi}
                  onChange={(event) => setUseEvolutionApi(event.target.checked)}
                />
                Enviar automáticamente con Evolution API
              </label>
            )}

            <div className="message-schedule">
              <label className="form-field">
                <span>Programar envío</span>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(event) => setScheduledFor(event.target.value)}
                />
              </label>
            </div>

            <div style={{ marginTop: '0.85rem', borderTop: '1px solid var(--color-border, #e5e7eb)', paddingTop: '0.75rem' }}>
              <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-muted, #6b7280)' }}>
                Guardar plantilla en la nube
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input
                  value={newTemplateTitle}
                  onChange={(e) => setNewTemplateTitle(e.target.value)}
                  placeholder="Nombre de la plantilla..."
                />
                <select
                  value={newTemplateCategory}
                  onChange={(e) => setNewTemplateCategory(e.target.value)}
                >
                  {(activeChannel === 'email'
                    ? EMAIL_CATEGORIES.map((cat) => ({ value: cat, label: EMAIL_CATEGORY_LABELS[cat] }))
                    : CATEGORY_OPTIONS).map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
                <Button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={!newTemplateTitle.trim() || !message.trim() || savingTemplate}
                >
                  {savingTemplate ? t('common.saving') : 'Guardar plantilla'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA */}
        <div className="message-preview-pane">
          <div className="message-card">
            <div className="message-card-title">Preview</div>
            {activeChannel === 'email' && (
              <>
                <div className="message-preview-subject">{emailSubject.trim() || '(Sin asunto)'}</div>
                <div className="message-preview-body">{resolvedMessage.text || 'Sin contenido'}</div>
              </>
            )}
            {activeChannel !== 'email' && (
              <div className="message-preview-body">{resolvedMessage.text || 'Sin contenido'}</div>
            )}
            {missingPlaceholders.length > 0 && (
              <div className="message-preview-warning">
                Faltan datos para: {missingPlaceholders.map((value) => `{${value}}`).join(', ')}
              </div>
            )}
            {activeChannel === 'sms' && (
              <div className="message-preview-meta">
                {charCount} caracteres · {smsSegments} segmento{smsSegments === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
