import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { DetailPanel } from '../../components/DetailPanel'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { ContactoTimeline } from '../../components/ContactoTimeline'
import { useToast } from '../../components/useToast'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { getCarteraOpportunityGuard, type CarteraOpportunityGuard } from '../../lib/carteraOpportunityGuard'
import {
  CLIENT_OPPORTUNITY_CHANNEL_OPTIONS,
  CLIENT_OPPORTUNITY_SOURCE_OPTIONS,
  CLIENT_OPPORTUNITY_STAGES,
  getClientOpportunityStageLabel,
  getClientOpportunityStatusLabel,
  type ClientOpportunityChannel,
  type ClientOpportunitySource,
  type ClientOpportunityStatus,
} from '../../constants/opportunities'
import { useClienteOpportunities, type ClienteOpportunityClient } from '../../hooks/useClienteOpportunities'

type ProductOption = {
  id: string
  nombre: string | null
  categoria: string | null
}

type OpportunityFormState = {
  id?: string
  cliente_id: string
  producto_recomendado: string
  categoria_producto: string
  etapa: string
  estado: string
  source: string
  canal: string
  valor: string
  probabilidad: string
  next_action: string
  next_action_date: string
  fecha_cierre_estimada: string
  notas: string
}

const initialForm: OpportunityFormState = {
  cliente_id: '',
  producto_recomendado: '',
  categoria_producto: '',
  etapa: 'nuevo',
  estado: 'abierta',
  source: 'cliente_existente',
  canal: 'manual',
  valor: '',
  probabilidad: '',
  next_action: '',
  next_action_date: '',
  fecha_cierre_estimada: '',
  notas: '',
}

const CLIENT_SOURCES = new Set<string>(CLIENT_OPPORTUNITY_SOURCE_OPTIONS)

export function OportunidadesClientePage() {
  const configured = isSupabaseConfigured
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { session } = useAuth()
  const { usersById, currentUser } = useUsers()
  const { showToast } = useToast()
  const {
    opportunities,
    loading,
    error,
    refresh,
    findActiveByClient,
    upsertOpportunity,
    closeOpportunity,
    getClientOpportunityDetail,
  } = useClienteOpportunities()

  const [clients, setClients] = useState<ClienteOpportunityClient[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [supportLoading, setSupportLoading] = useState(false)
  const [supportError, setSupportError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState<OpportunityFormState>(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailData, setDetailData] = useState<Awaited<ReturnType<typeof getClientOpportunityDetail>>>(null)
  const [guardPreview, setGuardPreview] = useState<CarteraOpportunityGuard | null>(null)

  const preselectedClientId = searchParams.get('clienteId')

  useEffect(() => {
    if (!configured) return
    let active = true
    const loadSupport = async () => {
      setSupportLoading(true)
      setSupportError(null)
      const [clientsRes, productsRes] = await Promise.all([
        supabase
          .from('clientes')
          .select('id, org_id, nombre, apellido, telefono, email, persona_id, saldo_actual, monto_moroso, dias_atraso, hycite_id')
          .order('nombre'),
        supabase
          .from('v_productos_publicos')
          .select('id, nombre, categoria')
          .order('nombre'),
      ])
      if (!active) return
      setClients((clientsRes.data as ClienteOpportunityClient[] | null) ?? [])
      setProducts((productsRes.data as ProductOption[] | null) ?? [])
      const supportErrors = [clientsRes.error?.message, productsRes.error?.message].filter(Boolean)
      setSupportError(supportErrors.length > 0 ? supportErrors.join(' | ') : null)
      setSupportLoading(false)
    }
    void loadSupport()
    return () => {
      active = false
    }
  }, [configured])

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients])

  const clientOpportunities = useMemo(
    () => opportunities.filter((row) => row.cliente_id || (row.source && CLIENT_SOURCES.has(row.source))),
    [opportunities],
  )

  const rows = useMemo<DataTableRow[]>(() => {
    return clientOpportunities.map((row) => {
      const client = row.cliente_id ? clientMap.get(row.cliente_id) ?? null : null
      const clientName = client ? [client.nombre, client.apellido].filter(Boolean).join(' ') || row.cliente_id : row.nombre ?? row.cliente_id ?? 'Sin cliente'
      const ownerName = row.owner_id ? usersById[row.owner_id] ?? row.owner_id : '-'
      const carteraLabel = row.blocked_by_cartera ? 'Bloqueada' : row.motivo_bloqueo ? 'Warning' : 'Clear'
      return {
        id: row.id,
        cells: [
          clientName,
          row.producto_recomendado ?? '-',
          row.categoria_producto ?? '-',
          getClientOpportunityStageLabel(row.etapa),
          getClientOpportunityStatusLabel(row.estado),
          ownerName,
          row.next_action ?? '-',
          carteraLabel,
          row.valor != null ? `$${Number(row.valor).toFixed(2)}` : '-',
          row.fecha_cierre_estimada ?? '-',
        ],
        detail: [
          { label: 'Cliente', value: clientName },
          { label: 'Producto recomendado', value: row.producto_recomendado ?? '-' },
          { label: 'Categoria', value: row.categoria_producto ?? '-' },
          { label: 'Etapa', value: getClientOpportunityStageLabel(row.etapa) },
          { label: 'Estado', value: getClientOpportunityStatusLabel(row.estado) },
          { label: 'Owner', value: ownerName },
          { label: 'Proxima accion', value: row.next_action ?? '-' },
          { label: 'Cierre estimado', value: row.fecha_cierre_estimada ?? '-' },
        ],
      }
    })
  }, [clientMap, clientOpportunities, usersById])

  useEffect(() => {
    if (!preselectedClientId || loading) return
    const run = async () => {
      const existing = await findActiveByClient(preselectedClientId)
      if (existing) {
        setSelectedId(existing.id)
      } else {
        setFormValues({ ...initialForm, cliente_id: preselectedClientId })
        setFormOpen(true)
      }
    }
    void run()
  }, [findActiveByClient, loading, preselectedClientId])

  useEffect(() => {
    if (!selectedId) {
      setDetailData(null)
      return
    }
    let active = true
    const loadDetail = async () => {
      setDetailLoading(true)
      const detail = await getClientOpportunityDetail(selectedId)
      if (!active) return
      setDetailData(detail)
      setDetailLoading(false)
    }
    void loadDetail()
    return () => {
      active = false
    }
  }, [getClientOpportunityDetail, selectedId])

  useEffect(() => {
    if (!formValues.cliente_id) {
      setGuardPreview(null)
      return
    }
    let active = true
    const loadGuard = async () => {
      const guard = await getCarteraOpportunityGuard(formValues.cliente_id)
      if (active) setGuardPreview(guard)
    }
    void loadGuard()
    return () => {
      active = false
    }
  }, [formValues.cliente_id])

  const handleFormChange = (field: keyof OpportunityFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value
      setFormValues((prev) => ({ ...prev, [field]: value }))

      if (field === 'producto_recomendado') {
        const product = products.find((item) => item.nombre === value)
        if (product) {
          setFormValues((prev) => ({ ...prev, producto_recomendado: value, categoria_producto: product.categoria ?? prev.categoria_producto }))
        }
      }
    }

  const openNewForClient = (clienteId?: string | null) => {
    setFormError(null)
    setFormValues({ ...initialForm, cliente_id: clienteId ?? '' })
    setFormOpen(true)
  }

  const openEdit = () => {
    if (!detailData) return
    const row = detailData.opportunity
    setFormError(null)
    setFormValues({
      id: row.id,
      cliente_id: row.cliente_id ?? '',
      producto_recomendado: row.producto_recomendado ?? '',
      categoria_producto: row.categoria_producto ?? '',
      etapa: row.etapa ?? 'nuevo',
      estado: row.estado ?? 'abierta',
      source: row.source ?? 'cliente_existente',
      canal: row.canal ?? 'manual',
      valor: row.valor != null ? String(row.valor) : '',
      probabilidad: row.probabilidad != null ? String(row.probabilidad) : '',
      next_action: row.next_action ?? '',
      next_action_date: row.next_action_date ?? '',
      fecha_cierre_estimada: row.fecha_cierre_estimada ?? '',
      notas: row.notas ?? '',
    })
    setFormOpen(true)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session?.user.id) {
      setFormError('No hay sesion activa')
      return
    }
    if (!formValues.cliente_id && CLIENT_SOURCES.has(formValues.source)) {
      setFormError('cliente_id es obligatorio para oportunidades de cliente')
      return
    }

    const client = clientMap.get(formValues.cliente_id) ?? null
    const orgId = client?.org_id ?? currentUser?.org_id ?? null
    if (!orgId) {
      setFormError('No se pudo determinar la organizacion de la oportunidad. Revisa el cliente o tu perfil antes de guardar.')
      return
    }
    const guard = formValues.cliente_id ? await getCarteraOpportunityGuard(formValues.cliente_id) : null

    if (guard?.status === 'blocked' && !formValues.id) {
      setFormError(`Resolver cartera primero: ${guard.reason}`)
      return
    }

    if (!formValues.id) {
      const existing = await findActiveByClient(formValues.cliente_id, formValues.categoria_producto || null)
      if (existing) {
        showToast('Ya existe una oportunidad activa para este cliente/categoria', 'error')
        setFormOpen(false)
        setSelectedId(existing.id)
        return
      }
    }

    setFormSaving(true)
    setFormError(null)

    const result = await upsertOpportunity({
      id: formValues.id,
      cliente_id: formValues.cliente_id,
      org_id: orgId,
      persona_id: client?.persona_id ?? null,
      nombre: client ? [client.nombre, client.apellido].filter(Boolean).join(' ') : null,
      producto_recomendado: formValues.producto_recomendado || null,
      categoria_producto: formValues.categoria_producto || null,
      etapa: formValues.etapa,
      estado: (guard?.status === 'blocked' ? 'bloqueada' : formValues.estado) as ClientOpportunityStatus,
      owner_id: session.user.id,
      source: formValues.source as ClientOpportunitySource,
      canal: formValues.canal as ClientOpportunityChannel,
      valor: formValues.valor ? Number(formValues.valor) : 0,
      probabilidad: formValues.probabilidad ? Number(formValues.probabilidad) : null,
      next_action: formValues.next_action || null,
      next_action_date: formValues.next_action_date || null,
      blocked_by_cartera: guard?.status === 'blocked',
      motivo_bloqueo: guard && guard.status !== 'clear' ? guard.reason : null,
      fecha_cierre_estimada: formValues.fecha_cierre_estimada || null,
      notas: formValues.notas || null,
    })

    setFormSaving(false)

    if (result.error) {
      setFormError(result.error.message)
      showToast(result.error.message, 'error')
      return
    }

    setFormOpen(false)
    showToast('Oportunidad guardada')
    await refresh()
    if (result.data?.id) {
      setSelectedId(result.data.id)
    }
  }

  const handleCloseOpportunity = async (outcome: 'ganada' | 'perdida' | 'cerrada') => {
    if (!detailData) return
    const result = await closeOpportunity(detailData.opportunity.id, outcome, detailData.opportunity.notas ?? null)
    if (result.error) {
      showToast(result.error.message, 'error')
      return
    }
    showToast('Oportunidad actualizada')
    await refresh()
    setSelectedId(detailData.opportunity.id)
  }

  const selectedClientName = detailData?.client
    ? [detailData.client.nombre, detailData.client.apellido].filter(Boolean).join(' ')
    : 'Cliente'

  if (!configured) {
    return <EmptyState title="Supabase requerido" description="Configura Supabase para gestionar oportunidades de cliente." />
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title="Oportunidades de Cliente"
        subtitle="Convierte clientes existentes sin mezclar el flujo comercial con cartera."
        action={
          <Button type="button" onClick={() => openNewForClient(preselectedClientId)}>
            Nueva oportunidad
          </Button>
        }
      />

      {error && <div className="form-error">{error}</div>}
      {supportError && <div className="form-error">No se pudo cargar parte del soporte operativo: {supportError}</div>}

      <DataTable
        columns={[
          'Cliente',
          'Producto',
          'Categoria',
          'Etapa',
          'Estado',
          'Owner',
          'Proxima accion',
          'Cartera',
          'Valor estimado',
          'Cierre estimado',
        ]}
        rows={rows}
        emptyLabel={loading || supportLoading ? 'Cargando...' : 'Sin oportunidades de cliente'}
        loading={loading || supportLoading}
        onRowClick={(row) => setSelectedId(row.id)}
        mobileConfig={{
          titleColumn: 0,
          subtitleColumn: 1,
          badgeColumns: [3, 4, 7],
          metaColumns: [5, 8],
          detailColumns: [2, 6, 9],
        }}
      />

      <DetailPanel
        open={Boolean(selectedId)}
        title={selectedClientName}
        onClose={() => {
          setSelectedId(null)
          if (searchParams.get('clienteId')) {
            const next = new URLSearchParams(searchParams)
            next.delete('clienteId')
            setSearchParams(next)
          }
        }}
        action={
          detailData ? (
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <Button variant="ghost" type="button" onClick={openEdit}>
                Editar
              </Button>
              <Button variant="ghost" type="button" onClick={() => handleCloseOpportunity('ganada')}>
                Ganada
              </Button>
              <Button variant="ghost" type="button" onClick={() => handleCloseOpportunity('perdida')}>
                Perdida
              </Button>
              <Button variant="ghost" type="button" onClick={() => navigate('/conexiones-infinitas')}>
                Capturar referido
              </Button>
              {detailData.guard?.status === 'blocked' && (
                <Button type="button" onClick={() => navigate('/cartera')}>
                  Resolver cuenta primero
                </Button>
              )}
            </div>
          ) : null
        }
        items={[
          {
            label: '',
            value: detailLoading ? (
              <span style={{ color: 'var(--color-text-muted, #6b7280)' }}>Cargando detalle...</span>
            ) : detailData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem 1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>Producto recomendado</div>
                    <div style={{ fontWeight: 700 }}>{detailData.opportunity.producto_recomendado ?? 'Sin definir'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>Categoria</div>
                    <div>{detailData.opportunity.categoria_producto ?? 'Sin categoria'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>Etapa</div>
                    <div>{getClientOpportunityStageLabel(detailData.opportunity.etapa)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>Estado</div>
                    <div>{getClientOpportunityStatusLabel(detailData.opportunity.estado)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>Owner</div>
                    <div>{detailData.opportunity.owner_id ? usersById[detailData.opportunity.owner_id] ?? detailData.opportunity.owner_id : '-'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>Valor estimado</div>
                    <div>{detailData.opportunity.valor != null ? `$${Number(detailData.opportunity.valor).toFixed(2)}` : '-'}</div>
                  </div>
                </section>

                <section style={{ padding: '0.85rem 1rem', borderRadius: '0.8rem', border: '1px solid var(--color-border, #e5e7eb)', background: 'var(--color-surface, #f8fafc)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.45rem' }}>
                    Resumen financiero / cartera
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem 1rem' }}>
                    <div>Saldo Hy-Cite: {detailData.client?.saldo_actual != null ? `$${Number(detailData.client.saldo_actual).toFixed(2)}` : '-'}</div>
                    <div>Monto moroso: {detailData.client?.monto_moroso != null ? `$${Number(detailData.client.monto_moroso).toFixed(2)}` : '-'}</div>
                    <div>Dias atraso: {detailData.client?.dias_atraso ?? 0}</div>
                    <div>Guard: {detailData.guard?.status ?? 'clear'}</div>
                  </div>
                  <div style={{ marginTop: '0.5rem', color: detailData.guard?.status === 'blocked' ? '#991b1b' : detailData.guard?.status === 'warning' ? '#9a3412' : '#065f46' }}>
                    {detailData.guard?.reason ?? 'Sin bloqueos'}
                  </div>
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem 1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.25rem' }}>Seguimiento</div>
                    <div>Proxima accion: {detailData.opportunity.next_action ?? 'Sin definir'}</div>
                    <div>Fecha: {detailData.opportunity.next_action_date ?? 'Sin fecha'}</div>
                    <div>Source: {detailData.opportunity.source ?? '-'}</div>
                    <div>Canal: {detailData.opportunity.canal ?? '-'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.25rem' }}>Referidos relacionados</div>
                    <div>{detailData.relatedReferrals} referidos vinculados</div>
                    <Button variant="ghost" type="button" onClick={() => navigate('/conexiones-infinitas')}>
                      Abrir Conexiones Infinitas
                    </Button>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.25rem' }}>Ventas y productos</div>
                    <div>Ventas previas: {detailData.salesSummary.ventasCount}</div>
                    <div>Ultima venta: {detailData.salesSummary.ultimaFecha ?? 'Sin ventas'}</div>
                    <div style={{ marginTop: '0.25rem' }}>
                      {detailData.installedProducts.length > 0
                        ? detailData.installedProducts.map((item) => item.nombre).join(', ')
                        : 'Sin productos instalados'}
                    </div>
                  </div>
                </section>

                <section>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.45rem' }}>Timeline comercial</div>
                  {detailData.opportunity.cliente_id ? (
                    <ContactoTimeline contactoTipo="cliente" contactoId={detailData.opportunity.cliente_id} emptyLabel="Sin historial de contacto para este cliente" />
                  ) : (
                    <span style={{ color: 'var(--color-text-muted, #6b7280)' }}>Sin cliente vinculado</span>
                  )}
                </section>
              </div>
            ) : (
              '-'
            ),
          },
        ]}
      />

      <Modal
        open={formOpen}
        title={formValues.id ? 'Editar oportunidad de cliente' : 'Nueva oportunidad de cliente'}
        onClose={() => setFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="cliente-opportunity-form" disabled={formSaving}>
              {formSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </>
        }
      >
        <form id="cliente-opportunity-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Cliente</span>
            <select value={formValues.cliente_id} onChange={handleFormChange('cliente_id')}>
              <option value="">Selecciona</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {[client.nombre, client.apellido].filter(Boolean).join(' ') || client.id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Producto recomendado</span>
            <input list="cliente-opportunity-products" value={formValues.producto_recomendado} onChange={handleFormChange('producto_recomendado')} />
            <datalist id="cliente-opportunity-products">
              {products.map((product) => (
                <option key={product.id} value={product.nombre ?? ''} />
              ))}
            </datalist>
          </label>
          <label className="form-field">
            <span>Categoria</span>
            <input value={formValues.categoria_producto} onChange={handleFormChange('categoria_producto')} placeholder="Ej. Filtracion" />
          </label>
          <label className="form-field">
            <span>Etapa</span>
            <select value={formValues.etapa} onChange={handleFormChange('etapa')}>
              {CLIENT_OPPORTUNITY_STAGES.map((stage) => (
                <option key={stage} value={stage}>{getClientOpportunityStageLabel(stage)}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Estado</span>
            <select value={formValues.estado} onChange={handleFormChange('estado')}>
              <option value="abierta">Abierta</option>
              <option value="en_seguimiento">En seguimiento</option>
              <option value="pospuesta">Pospuesta</option>
              <option value="bloqueada">Bloqueada</option>
            </select>
          </label>
          <label className="form-field">
            <span>Source</span>
            <select value={formValues.source} onChange={handleFormChange('source')}>
              {CLIENT_OPPORTUNITY_SOURCE_OPTIONS.map((source) => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Canal</span>
            <select value={formValues.canal} onChange={handleFormChange('canal')}>
              {CLIENT_OPPORTUNITY_CHANNEL_OPTIONS.map((channel) => (
                <option key={channel} value={channel}>{channel}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Valor estimado</span>
            <input type="number" value={formValues.valor} onChange={handleFormChange('valor')} />
          </label>
          <label className="form-field">
            <span>Probabilidad</span>
            <input type="number" value={formValues.probabilidad} onChange={handleFormChange('probabilidad')} />
          </label>
          <label className="form-field">
            <span>Proxima accion</span>
            <input value={formValues.next_action} onChange={handleFormChange('next_action')} />
          </label>
          <label className="form-field">
            <span>Fecha proxima accion</span>
            <input type="date" value={formValues.next_action_date} onChange={handleFormChange('next_action_date')} />
          </label>
          <label className="form-field">
            <span>Fecha cierre estimada</span>
            <input type="date" value={formValues.fecha_cierre_estimada} onChange={handleFormChange('fecha_cierre_estimada')} />
          </label>
          <label className="form-field" style={{ gridColumn: '1 / -1' }}>
            <span>Notas</span>
            <textarea rows={3} value={formValues.notas} onChange={handleFormChange('notas')} />
          </label>
          {guardPreview && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '0.7rem 0.85rem',
                borderRadius: '0.7rem',
                border: `1px solid ${guardPreview.status === 'blocked' ? '#fecaca' : guardPreview.status === 'warning' ? '#fed7aa' : '#bbf7d0'}`,
                background: guardPreview.status === 'blocked' ? '#fef2f2' : guardPreview.status === 'warning' ? '#fff7ed' : '#ecfdf5',
                color: guardPreview.status === 'blocked' ? '#991b1b' : guardPreview.status === 'warning' ? '#9a3412' : '#065f46',
                fontSize: '0.84rem',
              }}
            >
              Guard cartera: <strong>{guardPreview.status}</strong> · {guardPreview.reason}
            </div>
          )}
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
    </div>
  )
}
