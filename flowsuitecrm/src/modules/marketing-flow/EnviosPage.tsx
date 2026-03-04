import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { StatCard } from '../../components/StatCard'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { MessageModal } from '../../components/MessageModal'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { fetchLeadsForSegment, SEGMENTS, type LeadRow, type SegmentKey } from './leadSegments'

type CampaignRecord = {
  id: string
  nombre: string | null
  estado: string | null
}

export function EnviosPage() {
  const { session } = useAuth()
  const { viewMode, hasDistribuidorScope, distributionUserIds } = useViewMode()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [segment, setSegment] = useState<SegmentKey>('nuevos')
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([])
  const [campaignId, setCampaignId] = useState<string>('')
  const [sentLeadIds, setSentLeadIds] = useState<Set<string>>(new Set())
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [activeLead, setActiveLead] = useState<LeadRow | null>(null)
  const [messageOpen, setMessageOpen] = useState(false)

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

  const scope = useMemo(() => ({
    role,
    viewMode,
    hasDistribuidorScope,
    distributionUserIds,
    userId: session?.user.id ?? null,
  }), [distributionUserIds, hasDistribuidorScope, role, session?.user.id, viewMode])

  const loadLeads = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const rows = await fetchLeadsForSegment(segment, scope)
    if (campaignId) {
      const { data } = await supabase
        .from('mk_messages')
        .select('lead_id, estado')
        .eq('campaign_id', campaignId)
        .eq('segmento_key', segment)
      const sentIds = new Set<string>()
      ;((data as { lead_id: string; estado?: string | null }[] | null) ?? []).forEach((row) => {
        if (row.lead_id && row.estado === 'enviado') sentIds.add(row.lead_id)
      })
      setSentLeadIds(sentIds)
      setLeads(rows)
    } else {
      setSentLeadIds(new Set())
      setLeads(rows)
    }
    setLoading(false)
  }, [campaignId, configured, segment, scope])

  const loadCampaigns = useCallback(async () => {
    if (!configured || !session?.user.id) return
    const { data, error: fetchError } = await supabase
      .from('mk_campaigns')
      .select('id, nombre, estado')
      .eq('owner_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(200)
    if (fetchError) {
      setCampaigns([])
    } else {
      setCampaigns((data as CampaignRecord[] | null) ?? [])
    }
  }, [configured, session?.user.id])

  useEffect(() => {
    if (configured) loadRole()
  }, [configured, loadRole])

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  const selectedCampaign = useMemo(
    () => campaigns.find((camp) => camp.id === campaignId) ?? null,
    [campaignId, campaigns]
  )

  const canSend = Boolean(campaignId) && selectedCampaign?.estado === 'activa'

  const handleOpenMessage = (lead: LeadRow) => {
    if (!canSend) return
    setActiveLead(lead)
    setMessageOpen(true)
  }

  const handleCloseMessage = async () => {
    setMessageOpen(false)
    if (!configured || !activeLead) {
      setActiveLead(null)
      return
    }
    if (!canSend) {
      showToast('Selecciona una campana activa para enviar.', 'error')
      setActiveLead(null)
      return
    }
    const payload = {
      campaign_id: campaignId || null,
      target_tipo: 'lead',
      lead_id: activeLead.id,
      telefono: activeLead.telefono ?? null,
      nombre: [activeLead.nombre, activeLead.apellido].filter(Boolean).join(' ') || null,
      canal: 'whatsapp',
      segmento_key: segment,
      estado: 'enviado',
      owner_id: session?.user.id ?? null,
      sent_at: new Date().toISOString(),
    }
    const { error: insertError } = await supabase
      .from('mk_messages')
      .upsert(payload, { onConflict: 'campaign_id,telefono', ignoreDuplicates: true })
    if (insertError && !insertError.message.includes('duplicate')) {
      showToast(insertError.message, 'error')
    }
    setActiveLead(null)
  }

  const handleMarkSent = async (lead: LeadRow) => {
    if (!configured || !canSend) return
    const payload = {
      campaign_id: campaignId || null,
      target_tipo: 'lead',
      lead_id: lead.id,
      telefono: lead.telefono ?? null,
      nombre: [lead.nombre, lead.apellido].filter(Boolean).join(' ') || null,
      canal: 'whatsapp',
      segmento_key: segment,
      estado: 'enviado',
      owner_id: session?.user.id ?? null,
      sent_at: new Date().toISOString(),
    }
    const { error: insertError } = await supabase
      .from('mk_messages')
      .upsert(payload, { onConflict: 'campaign_id,telefono', ignoreDuplicates: true })
    if (insertError && !insertError.message.includes('duplicate')) {
      showToast(insertError.message, 'error')
      return
    }
    showToast('Envio registrado')
  }

  const totalLeads = leads.length
  const sentCount = sentLeadIds.size
  const pendingCount = Math.max(0, totalLeads - sentCount)
  const hasResults = totalLeads > 0

  const rows = useMemo<DataTableRow[]>(() => {
    return leads.map((lead) => {
      const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
      const estado = lead.estado_pipeline ?? '-'
      const alreadySent = sentLeadIds.has(lead.id)
      return {
        id: lead.id,
        cells: [
          fullName,
          lead.telefono ?? '-',
          <Badge key={`${lead.id}-estado`} label={estado} />,
          lead.next_action ?? '-',
          lead.next_action_date ?? '-',
          <div key={`${lead.id}-send`} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <Button variant="ghost" onClick={() => handleOpenMessage(lead)} disabled={alreadySent || !canSend}>
              Enviar
            </Button>
            <Button variant="ghost" onClick={() => handleMarkSent(lead)} disabled={alreadySent || !canSend}>
              Marcar enviado
            </Button>
            {alreadySent && <Badge label="Enviado" tone="blue" />}
          </div>,
        ],
      }
    })
  }, [canSend, handleOpenMessage, handleMarkSent, leads, sentLeadIds])

  return (
    <div className="page-stack">
      <SectionHeader title="Envios" subtitle="Lista por segmento" />

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {SEGMENTS.map((item) => (
          <Button
            key={item.key}
            variant={segment === item.key ? 'primary' : 'ghost'}
            type="button"
            onClick={() => setSegment(item.key)}
          >
            {item.label}
          </Button>
        ))}
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
          <option value="">Selecciona campana</option>
          {campaigns.map((camp) => (
            <option key={camp.id} value={camp.id}>
              {camp.nombre ?? camp.id}
            </option>
          ))}
        </select>
        {selectedCampaign && (
          <Badge label={`Campana ${selectedCampaign.estado ?? 'borrador'}`} tone="blue" />
        )}
        {!canSend && (
          <Badge label={campaignId ? 'Campana no activa' : 'Campana requerida'} tone="gold" />
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="stat-grid">
        <StatCard label="Total" value={String(totalLeads)} accent="blue" />
        <StatCard label="Enviados" value={String(sentCount)} accent="gold" />
        <StatCard label="Pendientes" value={String(pendingCount)} accent="blue" />
      </div>

      {loading && <div className="card" style={{ padding: '1rem' }}>Cargando envios...</div>}
      {!loading && !hasResults && (
        <EmptyState
          title="Sin resultados"
          description="No hay leads para este segmento."
        />
      )}
      {hasResults && (
        <DataTable
          columns={['Nombre', 'Telefono', 'Estado', 'Proxima accion', 'Fecha', 'Acciones']}
          rows={rows}
        />
      )}

      <MessageModal
        open={messageOpen}
        channel="whatsapp"
        contact={
          activeLead
            ? {
                nombre: [activeLead.nombre, activeLead.apellido].filter(Boolean).join(' ') || 'Lead',
                telefono: activeLead.telefono ?? '',
                leadId: activeLead.id,
              }
            : null
        }
        onClose={handleCloseMessage}
      />
    </div>
  )
}
