import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { StatCard } from '../../components/StatCard'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Modal } from '../../components/Modal'
import { MessageModal } from '../../components/MessageModal'
import { useToast } from '../../components/Toast'
import { CitaModal, type CitaForm } from '../citas/CitaModal'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'

type CampaignRecord = {
  id: string
  nombre: string | null
  estado: string | null
  segmento_key: string | null
  segment_params: Record<string, unknown> | null
}

type MkMessageRow = {
  id: string
  contacto_tipo: string | null
  contacto_id: string | null
  telefono: string | null
  nombre: string | null
  mensaje_texto: string | null
  status: string | null
  sent_at: string | null
  responded_at: string | null
  response_id: string | null
}

export function EnviosPage() {
  const { session } = useAuth()
  const [searchParams] = useSearchParams()
  const { showToast } = useToast()
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'pending'>('all')
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
    if (!configured || !session?.user.id) {
      setRole(null)
      return
    }
    const { data } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', session.user.id)
      .maybeSingle()
    setRole((data as { rol?: string } | null)?.rol ?? null)
  }, [configured, session?.user.id])

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
      .select('id, contacto_id, contacto_tipo, telefono, nombre, mensaje_texto, status, sent_at, responded_at, response_id')
      .eq('campaign_id', campaignId)
    if (!isMarketingManager && session?.user.id) {
      query = query.eq('owner_id', session.user.id)
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
  }, [campaignId, configured, isMarketingManager, selectedCampaign, session?.user.id])

  const loadCampaigns = useCallback(async () => {
    if (!configured || !session?.user.id) return
    let query = supabase
      .from('mk_campaigns')
      .select('id, nombre, estado, segmento_key, segment_params')
      .order('created_at', { ascending: false })
      .limit(200)
    if (!isMarketingManager) {
      query = query.eq('owner_id', session.user.id)
    }
    const { data, error: fetchError } = await query
    if (fetchError) {
      setCampaigns([])
    } else {
      setCampaigns((data as CampaignRecord[] | null) ?? [])
    }
  }, [configured, isMarketingManager, session?.user.id])

  useEffect(() => {
    if (configured) loadRole()
  }, [configured, loadRole])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  useEffect(() => {
    const campaignParam = searchParams.get('campana')
    if (campaignParam) {
      setCampaignId(campaignParam)
    }
  }, [searchParams])

  const canSend = Boolean(campaignId) && selectedCampaign?.estado === 'activa'

  const handleOpenMessage = (message: MkMessageRow) => {
    if (!canSend) return
    setActiveMessage(message)
    setMessageOpen(true)
  }

  const handleCloseMessage = async () => {
    setMessageOpen(false)
    if (!configured || !activeMessage) {
      setActiveMessage(null)
      return
    }
    if (!canSend) {
      showToast('Selecciona una campaña activa para enviar.', 'error')
      setActiveMessage(null)
      return
    }
    const nowIso = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('mk_messages')
      .update({
        sent_at: activeMessage.sent_at ?? nowIso,
        status: activeMessage.status ?? 'enviado',
        abierto_at: nowIso,
      })
      .eq('id', activeMessage.id)
    if (updateError) {
      showToast(updateError.message, 'error')
    } else {
      void loadMessages()
    }
    setActiveMessage(null)
  }

  const handleMarkSent = async (message: MkMessageRow) => {
    if (!configured || !canSend) return
    const nowIso = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('mk_messages')
      .update({ sent_at: message.sent_at ?? nowIso, status: message.status ?? 'enviado' })
      .eq('id', message.id)
    if (updateError) {
      showToast(updateError.message, 'error')
      return
    }
    showToast('Envio registrado')
    void loadMessages()
  }

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

  const openResponseModal = (message: MkMessageRow) => {
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
  }

  const closeResponseModal = () => {
    if (responseSaving) return
    setResponseOpen(false)
    setResponseMessageId('')
    setResponseContact(null)
  }

  const saveResponse = async () => {
    if (!configured || !responseMessageId || !responseForm.resultado) return null
    setResponseSaving(true)
    const payload = {
      message_id: responseMessageId,
      resultado: responseForm.resultado,
      notas: responseForm.notas.trim() || null,
      followup_at: responseForm.followup_at || null,
      monto_prometido: responseForm.monto_prometido ? Number(responseForm.monto_prometido) : null,
      registrado_por: session?.user.id ?? null,
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
      const { error: updateError } = await supabase
        .from('mk_messages')
        .update({ responded_at: new Date().toISOString(), response_id: responseId, status: 'respondido' })
        .eq('id', responseMessageId)
      if (updateError) {
        showToast(updateError.message, 'error')
      }
    }
    setRespondedMessageIds((prev) => new Set(prev).add(responseMessageId))
    setResponseSaving(false)
    return responseId
  }

  const handleSaveResponse = async () => {
    const responseId = await saveResponse()
    if (!responseId) return
    setResponseOpen(false)
    setResponseMessageId('')
    showToast('Respuesta registrada')
    void loadMessages()
  }

  const handleCreateCitaFromResponse = async () => {
    if (!responseContact) return
    const responseId = await saveResponse()
    if (!responseId) return
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

  const totalMessages = messages.length
  const sentCount = messages.filter((row) => Boolean(row.sent_at)).length
  const pendingCount = Math.max(0, totalMessages - sentCount)
  const hasResults = totalMessages > 0

  const toggleFilter = (next: 'sent' | 'pending') => {
    setStatusFilter((prev) => (prev === next ? 'all' : next))
  }

  const dayColumnIndex = isBirthdayCampaign ? 4 : null
  const handleSort = (colIndex: number) => {
    if (!isBirthdayCampaign || colIndex !== dayColumnIndex) return
    setDaySort((prev) => (prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'))
  }

  const displayedMessages = useMemo(() => {
    let list = messages
    if (statusFilter === 'sent') {
      list = list.filter((row) => Boolean(row.sent_at))
    }
    if (statusFilter === 'pending') {
      list = list.filter((row) => !row.sent_at)
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
  }, [birthDayByClienteId, daySort, isBirthdayCampaign, messages, statusFilter])

  const statusLabels: Record<string, string> = {
    pendiente: 'Pendiente',
    enviado: 'Enviado',
    respondido: 'Respondido',
  }

  const rows = useMemo<DataTableRow[]>(() => {
    return displayedMessages.map((message) => {
      const fullName = message.nombre ?? '-'
      const telefono = message.telefono ?? '-'
      const status = message.status ?? 'pendiente'
      const statusLabel = statusLabels[status] ?? status
      const responded = Boolean(message.response_id) || Boolean(message.responded_at) || respondedMessageIds.has(message.id)
      const alreadySent = Boolean(message.sent_at)
      const tipoLabel = message.contacto_tipo ?? '-'
      const birthDay = message.contacto_id ? birthDayByClienteId[message.contacto_id] : undefined
      const sendLabel = alreadySent ? 'Reenviar' : 'Enviar'
      const sendVariant = alreadySent ? 'ghost' : 'primary'
      return {
        id: message.id,
        cells: [
          fullName,
          telefono,
          tipoLabel,
          <Badge key={`${message.id}-status`} label={statusLabel} tone={status === 'respondido' ? 'gold' : status === 'enviado' ? 'blue' : 'neutral'} />,
          ...(isBirthdayCampaign ? [birthDay ? String(birthDay) : '—'] : []),
          <div key={`${message.id}-actions`} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant={sendVariant} onClick={() => handleOpenMessage(message)} disabled={!canSend}>
              {sendLabel}
            </Button>
            {!alreadySent && (
              <Button variant="ghost" onClick={() => handleMarkSent(message)} disabled={!canSend}>
                Marcar enviado
              </Button>
            )}
            <Button variant="ghost" onClick={() => openResponseModal(message)}>
              Registrar respuesta
            </Button>
            {responded && <Badge label="Respondido" tone="gold" />}
            {!responded && alreadySent && <Badge label="Enviado" tone="blue" />}
          </div>,
        ],
      }
    })
  }, [birthDayByClienteId, canSend, displayedMessages, isBirthdayCampaign, respondedMessageIds, statusLabels])

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
        {!canSend && (
          <Badge label={campaignId ? 'Campaña no activa' : 'Selecciona una campaña'} tone="gold" />
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="stat-grid">
        <div style={{ border: statusFilter === 'all' ? '2px solid var(--color-primary, #6366f1)' : '2px solid transparent', borderRadius: '0.75rem' }}>
          <StatCard label="Total" value={String(totalMessages)} accent="blue" onClick={() => setStatusFilter('all')} />
        </div>
        <div style={{ border: statusFilter === 'sent' ? '2px solid var(--color-primary, #6366f1)' : '2px solid transparent', borderRadius: '0.75rem' }}>
          <StatCard label="Enviados" value={String(sentCount)} accent="gold" onClick={() => toggleFilter('sent')} />
        </div>
        <div style={{ border: statusFilter === 'pending' ? '2px solid var(--color-primary, #6366f1)' : '2px solid transparent', borderRadius: '0.75rem' }}>
          <StatCard label="Pendientes" value={String(pendingCount)} accent="blue" onClick={() => toggleFilter('pending')} />
        </div>
      </div>

      {loading && <div className="card" style={{ padding: '1rem' }}>Cargando envios...</div>}
      {!loading && !hasResults && (
        <EmptyState
          title="Sin resultados"
          description={campaignId ? 'No hay envíos para esta campaña.' : 'Selecciona una campaña para ver los envíos.'}
        />
      )}
      {hasResults && (
        <DataTable
          columns={isBirthdayCampaign
            ? ['Nombre', 'Teléfono', 'Contacto', 'Estado', 'Día', 'Acciones']
            : ['Nombre', 'Teléfono', 'Contacto', 'Estado', 'Acciones']}
          rows={rows}
          sortableColumns={isBirthdayCampaign && dayColumnIndex !== null ? [dayColumnIndex] : undefined}
          sortColIndex={daySort && dayColumnIndex !== null ? dayColumnIndex : undefined}
          sortDir={daySort ?? undefined}
          onSort={handleSort}
        />
      )}

      <MessageModal
        open={messageOpen}
        channel="whatsapp"
        contact={
          activeMessage
            ? {
                nombre: activeMessage.nombre ?? 'Contacto',
                telefono: activeMessage.telefono ?? '',
                leadId: activeMessage.contacto_tipo === 'lead' ? activeMessage.contacto_id : null,
                clienteId: activeMessage.contacto_tipo === 'cliente' ? activeMessage.contacto_id : null,
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
