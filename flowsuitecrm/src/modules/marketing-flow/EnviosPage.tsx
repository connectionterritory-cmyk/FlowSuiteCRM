import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableColumn, type DataTableRow } from '../../components/DataTable'
import { StatCard } from '../../components/StatCard'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Modal } from '../../components/Modal'
import { MessageModal } from '../../components/MessageModal'
import { useToast } from '../../components/useToast'
import { CitaModal, type CitaForm } from '../citas/CitaModal'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'
import { useViewMode } from '../../data/useViewMode'

type CampaignRecord = {
  id: string
  nombre: string | null
  estado: string | null
  segmento_key: string | null
  segment_params: Record<string, unknown> | null
  owner_id: string | null
  dispatched_at: string | null
}

type MkMessageRow = {
  id: string
  contacto_tipo: string | null
  contacto_id: string | null
  owner_id: string | null
  telefono: string | null
  nombre: string | null
  mensaje_texto: string | null
  status: string | null
  sent_at: string | null
  responded_at: string | null
  response_id: string | null
  outbox_message_id: string | null
}

export function EnviosPage() {
  const { session } = useAuth()
  const { currentUser } = useUsers() // eslint-disable-line @typescript-eslint/no-unused-vars
  const sessionUserId = session?.user.id ?? null
  const [searchParams] = useSearchParams()
  const { showToast } = useToast()
  const { hasDistribuidorScope, viewMode } = useViewMode()
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([])
  const [campaignId, setCampaignId] = useState<string>('')
  const [messages, setMessages] = useState<MkMessageRow[]>([])
  const [respondedMessageIds, setRespondedMessageIds] = useState<Set<string>>(new Set())
  const [activeMessage, setActiveMessage] = useState<MkMessageRow | null>(null)
  const [messageOpen, setMessageOpen] = useState(false)
  const [responseOpen, setResponseOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pendiente' | 'programado' | 'fallido' | 'enviado' | 'respondido'>('all')
  const [whatsappFilter, setWhatsappFilter] = useState<'all' | 'whatsapp'>('all')
  const [birthDayByClienteId, setBirthDayByClienteId] = useState<Record<string, number>>({})
  const [daySort, setDaySort] = useState<'asc' | 'desc' | null>(null)
  const [responseMessageId, setResponseMessageId] = useState('')
  const [responseForm, setResponseForm] = useState({
    resultado: '',
    notas: '',
    followup_at: '',
    monto_prometido: '',
  })
  const [responseSaving, setResponseSaving] = useState(false)
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [dispatching, setDispatching] = useState(false)
  const [dispatchRemaining, setDispatchRemaining] = useState<number | null>(null)
  const [responseContact, setResponseContact] = useState<{
    nombre: string
    telefono: string
    contacto_tipo: 'cliente' | 'lead'
    contacto_id: string
  } | null>(null)
  const [citaOpen, setCitaOpen] = useState(false)
  const [citaInitial, setCitaInitial] = useState<Partial<CitaForm> | null>(null)

  const selectedCampaign = useMemo(
    () => campaigns.find((camp) => camp.id === campaignId) ?? null,
    [campaignId, campaigns]
  )

  const isBirthdayCampaign = selectedCampaign?.segmento_key === 'cumpleanos_clientes'

  const loadRole = useCallback(async () => {
    if (!configured || !sessionUserId) {
      setRole(null)
      return
    }
    const { data } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', sessionUserId)
      .maybeSingle()
    setRole((data as { rol?: string } | null)?.rol ?? null)
  }, [configured, sessionUserId])

  const isMarketingManager = role === 'admin' || role === 'distribuidor' || role === 'supervisor_telemercadeo'

  const loadMessages = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    if (!campaignId) {
      setMessages([])
      setLoading(false)
      return
    }

    let query = supabase
      .from('mk_messages')
      .select('id, contacto_id, contacto_tipo, owner_id, telefono, nombre, mensaje_texto, status, sent_at, responded_at, response_id, outbox_message_id')
      .eq('campaign_id', campaignId)
    if (!isMarketingManager && sessionUserId) {
      query = query.eq('owner_id', sessionUserId)
    }
    const { data, error: msgError } = await query.order('created_at', { ascending: true })
    if (msgError) {
      setError(msgError.message)
      setMessages([])
      setBirthDayByClienteId({})
      setLoading(false)
      return
    }
    const rows = (data as MkMessageRow[] | null) ?? []
    const messageIds = rows.map((row) => row.id)
    if (messageIds.length > 0) {
      const { data: responseData, error: responseError } = await supabase
        .from('mk_responses')
        .select('message_id')
        .in('message_id', messageIds)
      if (!responseError) {
        const respondedIds = new Set<string>()
        ;((responseData as { message_id: string }[] | null) ?? []).forEach((row) => {
          if (row.message_id) respondedIds.add(row.message_id)
        })
        setRespondedMessageIds(respondedIds)
      }
    }
    const isBirthdayCampaign = selectedCampaign?.segmento_key === 'cumpleanos_clientes'
    if (isBirthdayCampaign) {
      const clienteIds = Array.from(
        new Set(
          rows
            .filter((row) => row.contacto_tipo === 'cliente' && row.contacto_id)
            .map((row) => row.contacto_id as string)
        )
      )
      if (clienteIds.length > 0) {
        const { data: clientesData } = await supabase
          .from('clientes')
          .select('id, fecha_nacimiento')
          .in('id', clienteIds)
        const map: Record<string, number> = {}
        ;((clientesData as { id: string; fecha_nacimiento: string | null }[] | null) ?? []).forEach((row) => {
          if (!row.fecha_nacimiento) return
          const parts = row.fecha_nacimiento.split('-')
          if (parts.length < 3) return
          const day = Number(parts[2])
          if (!Number.isFinite(day)) return
          map[row.id] = day
        })
        setBirthDayByClienteId(map)
      } else {
        setBirthDayByClienteId({})
      }
    } else {
      setBirthDayByClienteId({})
    }
    setMessages(rows)
    setLoading(false)
  }, [campaignId, configured, isMarketingManager, selectedCampaign, sessionUserId, showToast])

  const loadCampaigns = useCallback(async () => {
    if (!configured || !sessionUserId) return
    let query = supabase
      .from('mk_campaigns')
      .select('id, nombre, estado, segmento_key, segment_params, owner_id, dispatched_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (!isMarketingManager) {
      query = query.eq('owner_id', sessionUserId)
    }
    const { data, error: fetchError } = await query
    if (fetchError) {
      setCampaigns([])
    } else {
      setCampaigns((data as CampaignRecord[] | null) ?? [])
    }
  }, [configured, isMarketingManager, sessionUserId])

  useEffect(() => {
    if (!configured) return
    const handle = window.setTimeout(() => {
      void loadRole()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [configured, loadRole])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadMessages()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [loadMessages])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadCampaigns()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [loadCampaigns])

  useEffect(() => {
    const campaignParam = searchParams.get('campana')
    if (campaignParam) {
      const handle = window.setTimeout(() => {
        setCampaignId(campaignParam)
      }, 0)
      return () => window.clearTimeout(handle)
    }
  }, [searchParams])

  const isOwner = Boolean(selectedCampaign?.owner_id && selectedCampaign?.owner_id === sessionUserId)
  const canWriteCampaign =
    isOwner
    || (hasDistribuidorScope && viewMode === 'distributor')
  const canSend = Boolean(campaignId) && selectedCampaign?.estado === 'activa' && canWriteCampaign
  const permissionTooltip = !canWriteCampaign ? 'Solo el responsable de la campaña puede ejecutar envíos' : undefined
  const currentUserName = [currentUser?.nombre, currentUser?.apellido].filter(Boolean).join(' ').trim()
  // Dispatch allowed from borrador or pausada (DB function guards against re-dispatch)
  const canDispatch = Boolean(campaignId)
    && ['borrador', 'pausada', 'activa'].includes(selectedCampaign?.estado ?? '')
    && canWriteCampaign

  const handleOpenMessage = useCallback((message: MkMessageRow) => {
    if (!canSend) return
    setActiveMessage(message)
    setMessageOpen(true)
  }, [canSend])

  const handleCloseMessage = async () => {
    setMessageOpen(false)
    setActiveMessage(null)
  }

  const handleMarkSent = useCallback(async (message: MkMessageRow) => {
    if (!configured || !canSend) return
    const nowIso = new Date().toISOString()
    const sentAt = message.sent_at ?? nowIso
    const { data: updatedRows, error: updateError } = await supabase
      .from('mk_messages')
      .update({ sent_at: sentAt, status: 'enviado' })
      .eq('id', message.id)
      .select('id')
    if (updateError) {
      showToast(updateError.message, 'error')
      return
    }
    if (!updatedRows || updatedRows.length === 0) {
      showToast('No se pudo actualizar el envío. Revisa permisos o responsable de la campaña.', 'error')
      return
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? { ...m, sent_at: sentAt, status: 'enviado' } : m))
    )
    showToast('Envio registrado')
    void loadMessages()
  }, [canSend, configured, loadMessages, showToast])

  const handleRetryMessage = useCallback(async (message: MkMessageRow) => {
    if (!configured || !canSend) return
    if (!message.outbox_message_id) {
      showToast('Este envío no está vinculado a outbox.', 'error')
      return
    }
    if (message.owner_id && sessionUserId && message.owner_id !== sessionUserId) {
      showToast('Solo el responsable puede reintentar este envío.', 'error')
      return
    }
    if (retryingIds.has(message.id)) return
    setRetryingIds((prev) => new Set(prev).add(message.id))
    try {
      const { data: outboxRows, error: outboxError } = await supabase
        .from('outbox_messages')
        .update({
          status: 'programado',
          retry_after: null,
          locked_at: null,
          locked_by: null,
        })
        .eq('id', message.outbox_message_id)
        .eq('status', 'fallido')
        .select('id')
      if (outboxError) {
        showToast(outboxError.message, 'error')
        return
      }
      if (!outboxRows || outboxRows.length === 0) {
        showToast('No se pudo reintentar el envío. Revisa permisos o estado actual.', 'error')
        return
      }
      const { error: mkError } = await supabase
        .from('mk_messages')
        .update({ status: 'programado' })
        .eq('id', message.id)
        .neq('status', 'respondido')
        .neq('status', 'cancelado')
      if (mkError) {
        showToast(mkError.message, 'error')
        return
      }
      const { error: invokeError } = await supabase.functions.invoke('process-outbox')
      if (invokeError) {
        showToast('Reintento en cola. El worker lo procesará en breve.')
      } else {
        showToast('Reintento en cola', 'success')
      }
      void loadMessages()
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(message.id)
        return next
      })
    }
  }, [canSend, configured, loadMessages, retryingIds, sessionUserId, showToast])

  const handleDispatchCampaign = useCallback(async () => {
    if (!configured || !campaignId || !canDispatch) return
    setDispatching(true)
    setDispatchRemaining(null)
    try {
      const { data, error } = await supabase.functions.invoke('dispatch-campaign', {
        body: { campaign_id: campaignId },
      })
      if (error) {
        showToast(error.message, 'error')
        return
      }
      const result = data as { ok?: boolean; dispatched?: number; error?: string; estado?: string } | null
      if (result?.error) {
        const msg = result.error === 'campaign_already_dispatched'
          ? `La campaña ya fue despachada (estado: ${result.estado ?? 'activa'})`
          : result.error
        showToast(msg, 'error')
        return
      }
      const dispatched = Number(result?.dispatched ?? 0)
      setDispatchRemaining(dispatched)
      showToast(`${dispatched} mensajes en cola`)
      void loadCampaigns()
      void loadMessages()
    } finally {
      setDispatching(false)
    }
  }, [campaignId, canDispatch, configured, loadCampaigns, loadMessages, showToast])

  useEffect(() => {
    setDispatching(false)
    setDispatchRemaining(null)
  }, [campaignId])

  const RESULTADO_OPTIONS = [
    { value: 'sin_respuesta', label: 'Sin respuesta' },
    { value: 'buzon', label: 'Buzon de voz' },
    { value: 'cita_agendada', label: 'Cita agendada' },
    { value: 'pago_prometido', label: 'Pago prometido' },
    { value: 'pago_realizado', label: 'Pago realizado' },
    { value: 'reagendar', label: 'Reagendar' },
    { value: 'solicita_info', label: 'Solicita info' },
    { value: 'no_interesado', label: 'No interesado' },
    { value: 'numero_incorrecto', label: 'Numero incorrecto' },
    { value: 'disputa', label: 'En disputa' },
    { value: 'ya_pago', label: 'Ya pago' },
    { value: 'demo_calificada', label: 'Demo calificada' },
    { value: 'venta_cerrada', label: 'Venta cerrada' },
  ]

  const openResponseModal = useCallback((message: MkMessageRow) => {
    if (!message.id) return
    if (!message.contacto_id) {
      showToast('Este mensaje no tiene contacto asociado.', 'error')
      return
    }
    const nombre = message.nombre ?? 'Contacto'
    const telefono = message.telefono ?? ''
    const contacto_tipo: 'cliente' | 'lead' = message.contacto_tipo === 'lead' ? 'lead' : 'cliente'
    const contacto_id = message.contacto_id
    setResponseContact({ nombre, telefono, contacto_tipo, contacto_id })
    setResponseMessageId(message.id)
    setResponseForm({ resultado: '', notas: '', followup_at: '', monto_prometido: '' })
    setResponseOpen(true)
  }, [showToast])

  const closeResponseModal = () => {
    if (responseSaving) return
    setResponseOpen(false)
    setResponseMessageId('')
    setResponseContact(null)
  }

  const runAutoActions = useCallback(async (
    resultado: string,
    contact: { contacto_tipo: 'cliente' | 'lead'; contacto_id: string } | null,
    followupAt: string | null,
    montoPrm: number | null,
    notasText: string | null,
  ) => {
    if (!configured || !contact || !sessionUserId) return
    const { contacto_tipo, contacto_id } = contact

    if (resultado === 'cita_agendada') {
      if (contacto_tipo === 'lead') {
        await supabase.from('leads').update({
          next_action: 'Cita agendada via campaña',
          next_action_date: followupAt,
        }).eq('id', contacto_id)
        await supabase.from('lead_notas').insert({
          lead_id: contacto_id,
          usuario_id: sessionUserId,
          nota: ['Cita agendada via campaña', notasText].filter(Boolean).join(': '),
          tipo: 'seguimiento',
        })
      } else {
        await supabase.from('clientes').update({
          next_action: 'Cita agendada via campaña',
          next_action_date: followupAt,
        }).eq('id', contacto_id)
        await supabase.from('notasrp').insert({
          cliente_id: contacto_id,
          contenido: ['Cita agendada via campaña', notasText].filter(Boolean).join(': '),
          canal: 'whatsapp',
          enviado_por: sessionUserId,
        })
      }
    }

    if (resultado === 'pago_prometido' && contacto_tipo === 'cliente') {
      await supabase.from('llamadas_telemercadeo').insert({
        cliente_id: contacto_id,
        telemercadista_id: sessionUserId,
        resultado: 'pago_prometido',
        notas: notasText,
        followup_at: followupAt,
        monto_prometido: montoPrm,
      })
      if (followupAt) {
        await supabase.from('clientes').update({
          next_action: 'Pago prometido',
          next_action_date: followupAt,
        }).eq('id', contacto_id)
      }
    }
  }, [configured, sessionUserId])

  const saveResponse = async () => {
    if (!configured || !responseMessageId || !responseForm.resultado) return null
    setResponseSaving(true)
    const payload = {
      message_id: responseMessageId,
      resultado: responseForm.resultado,
      notas: responseForm.notas.trim() || null,
      followup_at: responseForm.followup_at || null,
      monto_prometido: responseForm.monto_prometido ? Number(responseForm.monto_prometido) : null,
      registrado_por: sessionUserId,
    }
    const { data, error: upsertError } = await supabase
      .from('mk_responses')
      .upsert(payload, { onConflict: 'message_id' })
      .select('id')
      .maybeSingle()
    if (upsertError) {
      showToast(upsertError.message, 'error')
      setResponseSaving(false)
      return null
    }
    const responseId = (data as { id?: string } | null)?.id ?? null
    if (responseId) {
      const { data: updatedRows, error: updateError } = await supabase
        .from('mk_messages')
        .update({ responded_at: new Date().toISOString(), response_id: responseId, status: 'respondido' })
        .eq('id', responseMessageId)
        .select('id')
      if (updateError) {
        showToast(updateError.message, 'error')
      } else if (!updatedRows || updatedRows.length === 0) {
        showToast('No se pudo actualizar el mensaje respondido. Revisa permisos.', 'error')
      }
    }
    setRespondedMessageIds((prev) => new Set(prev).add(responseMessageId))
    setResponseSaving(false)
    return responseId
  }

  const handleSaveResponse = async () => {
    const responseId = await saveResponse()
    if (!responseId) return
    await runAutoActions(
      responseForm.resultado,
      responseContact,
      responseForm.followup_at || null,
      responseForm.monto_prometido ? Number(responseForm.monto_prometido) : null,
      responseForm.notas.trim() || null,
    )
    setResponseOpen(false)
    setResponseMessageId('')
    showToast('Respuesta registrada')
    void loadMessages()
  }

  const handleCreateCitaFromResponse = async () => {
    if (!responseContact) return
    const responseId = await saveResponse()
    if (!responseId) return
    await runAutoActions(
      responseForm.resultado,
      responseContact,
      responseForm.followup_at || null,
      responseForm.monto_prometido ? Number(responseForm.monto_prometido) : null,
      responseForm.notas.trim() || null,
    )
    const startAt = responseForm.followup_at
      ? `${responseForm.followup_at}T09:00`
      : new Date().toISOString().slice(0, 16)
    setCitaInitial({
      start_at: startAt,
      tipo: 'servicio',
      estado: 'programada',
      assigned_to: session?.user.id ?? '',
      contacto_nombre: responseContact.nombre,
      contacto_telefono: responseContact.telefono,
      contacto_tipo: responseContact.contacto_tipo,
      contacto_id: responseContact.contacto_id,
      campaign_id: campaignId,
      message_id: responseMessageId,
      response_id: responseId,
    })
    setResponseOpen(false)
    setResponseMessageId('')
    setCitaOpen(true)
  }

  const normalizeStatus = useCallback((row: MkMessageRow) => {
    const raw = row.status ?? ''
    if (!raw) return row.sent_at ? 'enviado' : 'pendiente'
    // Legacy aliases
    if (raw === 'sent') return 'enviado'
    if (raw === 'procesando') return 'pendiente'
    return raw
  }, [])
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      pendiente: 0,
      programado: 0,
      enviado: 0,
      fallido: 0,
      respondido: 0,
    }
    messages.forEach((row) => {
      const status = normalizeStatus(row)
      if (status === 'programado') {
        counts.programado += 1
      } else if (['pendiente', 'en_proceso', 'retry_pending'].includes(status)) {
        counts.pendiente += 1
      } else if (status in counts) {
        counts[status] += 1
      }
    })
    return counts
  }, [messages, normalizeStatus])

  const totalMessages = messages.length
  const hasResults = totalMessages > 0

  const dayColumnIndex = isBirthdayCampaign ? 5 : null
  const handleSort = (colIndex: number) => {
    if (!isBirthdayCampaign || colIndex !== dayColumnIndex) return
    setDaySort((prev) => (prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'))
  }

  const displayedMessages = useMemo(() => {
    let list = messages
    if (statusFilter !== 'all') {
      list = list.filter((row) => {
        const status = normalizeStatus(row)
        if (statusFilter === 'pendiente') {
          return ['pendiente', 'en_proceso', 'retry_pending'].includes(status)
        }
        return status === statusFilter
      })
    }
    if (whatsappFilter === 'whatsapp') {
      list = list.filter((row) => Boolean(row.telefono && row.telefono.replace(/\D/g, '').length >= 10))
    }
    if (isBirthdayCampaign && daySort) {
      const sorted = [...list]
      sorted.sort((a, b) => {
        const dayA = a.contacto_id ? birthDayByClienteId[a.contacto_id] : undefined
        const dayB = b.contacto_id ? birthDayByClienteId[b.contacto_id] : undefined
        const aMissing = dayA == null
        const bMissing = dayB == null
        if (aMissing && bMissing) return 0
        if (aMissing) return 1
        if (bMissing) return -1
        return daySort === 'asc' ? dayA - dayB : dayB - dayA
      })
      return sorted
    }
    return list
  }, [birthDayByClienteId, daySort, isBirthdayCampaign, messages, normalizeStatus, statusFilter, whatsappFilter])

  const statusLabels = useMemo<Record<string, string>>(() => ({
    pendiente: 'Pendiente',
    programado: 'Programado',
    en_proceso: 'En proceso',
    retry_pending: 'Reintento',
    enviado: 'Enviado',
    respondido: 'Respondido',
    fallido: 'Fallido',
  }), [])

  const statusOrder = useMemo(() => ([
    'pendiente',
    'programado',
    'fallido',
    'enviado',
    'respondido',
  ]), [])

  const rows = useMemo<DataTableRow[]>(() => {
    return displayedMessages.map((message) => {
      const fullName = message.nombre ?? '-'
      const telefono = message.telefono ?? '-'
      const status = normalizeStatus(message)
      const statusLabel = statusLabels[status] ?? status
      const responded = Boolean(message.response_id) || Boolean(message.responded_at) || respondedMessageIds.has(message.id)
      const alreadySent = Boolean(message.sent_at)
      const isOwner = Boolean(message.owner_id && sessionUserId && message.owner_id === sessionUserId)
      const canRetry = status === 'fallido' && Boolean(message.outbox_message_id) && isOwner
      const retrying = retryingIds.has(message.id)
      const tipoLabel = message.contacto_tipo ?? '-'
      const birthDay = message.contacto_id ? birthDayByClienteId[message.contacto_id] : undefined
      const sendLabel = alreadySent ? 'Reenviar' : 'Enviar'
      const sendVariant = alreadySent ? 'ghost' : 'primary'
      const hasWhatsapp = Boolean(message.telefono && message.telefono.replace(/\D/g, '').length >= 10)
      return {
        id: message.id,
        cells: [
          fullName,
          telefono,
          tipoLabel,
          <Badge key={`${message.id}-whatsapp`} label={hasWhatsapp ? 'WhatsApp' : 'Sin WhatsApp'} tone={hasWhatsapp ? 'blue' : 'neutral'} />,
          <Badge key={`${message.id}-status`} label={statusLabel} tone={status === 'respondido' ? 'gold' : status === 'enviado' ? 'blue' : status === 'fallido' ? 'gold' : 'neutral'} />,
          ...(isBirthdayCampaign ? [birthDay ? String(birthDay) : '—'] : []),
          <div key={`${message.id}-actions`} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant={sendVariant}
              onClick={() => handleOpenMessage(message)}
              disabled={!canSend}
              title={permissionTooltip}
            >
              {sendLabel}
            </Button>
            {!alreadySent && (
              <Button
                variant="ghost"
                onClick={() => handleMarkSent(message)}
                disabled={!canSend}
                title={permissionTooltip}
              >
                Marcar enviado
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => openResponseModal(message)}
              disabled={!canSend}
              title={permissionTooltip}
            >
              Registrar respuesta
            </Button>
            {canRetry && (
              <Button
                variant="ghost"
                onClick={() => handleRetryMessage(message)}
                disabled={!canSend || retrying}
                title={permissionTooltip}
              >
                {retrying ? 'Reintentando...' : 'Reintentar'}
              </Button>
            )}
            {responded && <Badge label="Respondido" tone="gold" />}
            {!responded && alreadySent && <Badge label="Enviado" tone="blue" />}
          </div>,
        ],
      }
    })
  }, [
    birthDayByClienteId,
    canSend,
    displayedMessages,
    handleMarkSent,
    handleOpenMessage,
    handleRetryMessage,
    isBirthdayCampaign,
    normalizeStatus,
    openResponseModal,
    permissionTooltip,
    respondedMessageIds,
    retryingIds,
    sessionUserId,
    statusLabels,
  ])

  const columns = useMemo<DataTableColumn[]>(() => {
    const base: DataTableColumn[] = [
      { label: 'Nombre', priority: 1 },
      { label: 'Teléfono', priority: 2 },
      { label: 'Contacto', hideOnMobile: true, hideOnTablet: true, priority: 5 },
      { label: 'WhatsApp', priority: 4 },
      { label: 'Estado', priority: 3 },
    ]
    return isBirthdayCampaign
      ? [...base, { label: 'Día', priority: 6 }, { label: 'Acciones', priority: 7 }]
      : [...base, { label: 'Acciones', priority: 6 }]
  }, [isBirthdayCampaign])

  return (
    <div className="page-stack">
      <SectionHeader title="Envíos" subtitle="Seguimiento por campaña" />

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}
          style={{
            height: '36px',
            padding: '0 0.6rem',
            borderRadius: '0.4rem',
            border: '1px solid var(--color-border, #e5e7eb)',
            background: 'var(--color-input)',
            color: 'var(--color-text)',
            fontSize: '0.85rem',
          }}
        >
          <option value="">Selecciona campaña</option>
          {campaigns.map((camp) => (
            <option key={camp.id} value={camp.id}>
              {camp.nombre ?? camp.id}
            </option>
          ))}
        </select>
        {selectedCampaign && (
          <Badge label={`Campaña ${selectedCampaign.estado ?? 'borrador'}`} tone="blue" />
        )}
        <Button
          type="button"
          variant={dispatching ? 'ghost' : 'primary'}
          disabled={!canDispatch || dispatching}
          onClick={handleDispatchCampaign}
          title={permissionTooltip}
        >
          {dispatching ? 'Despachando...' : 'Lanzar campaña'}
        </Button>
        {!dispatching && dispatchRemaining != null && dispatchRemaining > 0 && (
          <Badge label={`${dispatchRemaining} en cola`} tone="blue" />
        )}
        {!canSend && (
          <Badge label={campaignId ? 'Campaña no activa' : 'Selecciona una campaña'} tone="gold" />
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          type="button"
          variant={whatsappFilter === 'all' ? 'primary' : 'ghost'}
          onClick={() => setWhatsappFilter('all')}
        >
          Todos
        </Button>
        <Button
          type="button"
          variant={whatsappFilter === 'whatsapp' ? 'primary' : 'ghost'}
          onClick={() => setWhatsappFilter('whatsapp')}
        >
          Solo con WhatsApp
        </Button>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="stat-grid">
        <div style={{ border: statusFilter === 'all' ? '2px solid var(--color-primary, #6366f1)' : '2px solid transparent', borderRadius: '0.75rem' }}>
          <StatCard label="Total" value={String(totalMessages)} accent="blue" onClick={() => setStatusFilter('all')} />
        </div>
        {statusOrder.map((status) => (
          <div
            key={status}
            style={{ border: statusFilter === status ? '2px solid var(--color-primary, #6366f1)' : '2px solid transparent', borderRadius: '0.75rem' }}
          >
            <StatCard
              label={statusLabels[status] ?? status}
              value={String(statusCounts[status] ?? 0)}
              accent={status === 'fallido' || status === 'respondido' ? 'gold' : 'blue'}
              onClick={() => setStatusFilter(status as typeof statusFilter)}
            />
          </div>
        ))}
      </div>

      {loading && <div className="card" style={{ padding: '1rem' }}>Cargando envios...</div>}
      {!loading && !hasResults && (
        <EmptyState
          title="Sin resultados"
          description={campaignId ? 'No hay envíos para esta campaña.' : 'Selecciona una campaña para ver los envíos.'}
        />
      )}
      {hasResults && (
        <div className="marketing-envios-mobile">
          {displayedMessages.map((message) => {
            const fullName = message.nombre ?? '-'
            const telefono = message.telefono ?? '-'
            const status = normalizeStatus(message)
            const statusLabel = statusLabels[status] ?? status
            const responded = Boolean(message.response_id) || Boolean(message.responded_at) || respondedMessageIds.has(message.id)
            const alreadySent = Boolean(message.sent_at)
            const isOwner = Boolean(message.owner_id && sessionUserId && message.owner_id === sessionUserId)
            const canRetry = status === 'fallido' && Boolean(message.outbox_message_id) && isOwner
            const retrying = retryingIds.has(message.id)
            const tipoLabel = message.contacto_tipo ?? '-'
            const birthDay = message.contacto_id ? birthDayByClienteId[message.contacto_id] : undefined
            const sendLabel = alreadySent ? 'Reenviar' : 'Enviar'
            const sendVariant = alreadySent ? 'ghost' : 'primary'
            const hasWhatsapp = Boolean(message.telefono && message.telefono.replace(/\D/g, '').length >= 10)
            return (
              <div key={message.id} className="marketing-envio-card">
                <div className="marketing-envio-header">
                  <div>
                    <div className="marketing-envio-name">{fullName}</div>
                    <div className="marketing-envio-meta">{telefono} · {tipoLabel}</div>
                  </div>
                  <Badge label={statusLabel} tone={status === 'respondido' ? 'gold' : status === 'enviado' ? 'blue' : status === 'fallido' ? 'gold' : 'neutral'} />
                </div>
                {isBirthdayCampaign && (
                  <div className="marketing-envio-meta">Día: {birthDay ? String(birthDay) : '—'}</div>
                )}
                <div style={{ marginTop: '0.35rem' }}>
                  <Badge label={hasWhatsapp ? 'WhatsApp' : 'Sin WhatsApp'} tone={hasWhatsapp ? 'blue' : 'neutral'} />
                </div>
                <div className="marketing-envio-actions">
                  <Button
                    variant={sendVariant}
                    onClick={() => handleOpenMessage(message)}
                    disabled={!canSend}
                    title={permissionTooltip}
                  >
                    {sendLabel}
                  </Button>
                  {!alreadySent && (
                    <Button
                      variant="ghost"
                      onClick={() => handleMarkSent(message)}
                      disabled={!canSend}
                      title={permissionTooltip}
                    >
                      Marcar enviado
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => openResponseModal(message)}
                    disabled={!canSend}
                    title={permissionTooltip}
                  >
                    Registrar respuesta
                  </Button>
                  {canRetry && (
                    <Button
                      variant="ghost"
                      onClick={() => handleRetryMessage(message)}
                      disabled={!canSend || retrying}
                      title={permissionTooltip}
                    >
                      {retrying ? 'Reintentando...' : 'Reintentar'}
                    </Button>
                  )}
                  {responded && <Badge label="Respondido" tone="gold" />}
                  {!responded && alreadySent && <Badge label="Enviado" tone="blue" />}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {hasResults && (
        <div className="marketing-envios-table">
          <DataTable
            columns={columns}
            rows={rows}
            sortableColumns={isBirthdayCampaign && dayColumnIndex !== null ? [dayColumnIndex] : undefined}
            sortColIndex={daySort && dayColumnIndex !== null ? dayColumnIndex : undefined}
            sortDir={daySort ?? undefined}
            onSort={handleSort}
            mobileConfig={{
              titleColumn: 0,
              subtitleColumn: 1,
              metaColumns: isBirthdayCampaign ? [2, 5] : [2],
              badgeColumns: [3, 4],
              actionColumn: isBirthdayCampaign ? 6 : 5,
            }}
          />
        </div>
      )}

      <MessageModal
        open={messageOpen}
        channel="whatsapp"
        contextType="campaign"
        mkMessageId={activeMessage?.id ?? null}
        contact={
          activeMessage
            ? {
                nombre: activeMessage.nombre ?? 'Contacto',
                telefono: activeMessage.telefono ?? '',
                leadId: activeMessage.contacto_tipo === 'lead' ? activeMessage.contacto_id : null,
                clienteId: activeMessage.contacto_tipo === 'cliente' ? activeMessage.contacto_id : null,
                vendedorNombre: currentUserName || null,
                vendedorTelefono: currentUser?.telefono ?? null,
                responsableNombre: currentUserName || null,
              }
            : null
        }
        onClose={handleCloseMessage}
      />

      <Modal
        open={responseOpen}
        title="Registrar respuesta"
        onClose={closeResponseModal}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={closeResponseModal}>
              Cancelar
            </Button>
            {['cita_agendada', 'cita_servicio'].includes(responseForm.resultado) && (
              <Button type="button" onClick={handleCreateCitaFromResponse} disabled={responseSaving}>
                Crear cita
              </Button>
            )}
            <Button type="button" onClick={handleSaveResponse} disabled={!responseForm.resultado || responseSaving}>
              {responseSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <label className="form-field">
            <span>Resultado</span>
            <select
              value={responseForm.resultado}
              onChange={(event) => setResponseForm((prev) => ({ ...prev, resultado: event.target.value }))}
            >
              <option value="">Selecciona resultado</option>
              {RESULTADO_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Notas</span>
            <textarea
              rows={3}
              value={responseForm.notas}
              onChange={(event) => setResponseForm((prev) => ({ ...prev, notas: event.target.value }))}
              placeholder="Detalle corto de la respuesta"
            />
          </label>
          <label className="form-field">
            <span>Seguimiento</span>
            <input
              type="date"
              value={responseForm.followup_at}
              onChange={(event) => setResponseForm((prev) => ({ ...prev, followup_at: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Monto prometido</span>
            <input
              type="number"
              inputMode="decimal"
              value={responseForm.monto_prometido}
              onChange={(event) => setResponseForm((prev) => ({ ...prev, monto_prometido: event.target.value }))}
              placeholder="0.00"
            />
          </label>
        </div>
      </Modal>

      <CitaModal
        open={citaOpen}
        onClose={() => setCitaOpen(false)}
        onSaved={loadMessages}
        initialData={citaInitial ?? undefined}
        assignedOptions={
          session?.user.id
            ? [{ id: session.user.id, label: 'Yo' }]
            : []
        }
      />
    </div>
  )
}
