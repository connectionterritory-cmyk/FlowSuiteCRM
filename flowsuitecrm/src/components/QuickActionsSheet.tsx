import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { useToast } from './Toast'
import { useAuth } from '../auth/AuthProvider'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'

type QuickActionsSheetProps = {
  open: boolean
  onClose: () => void
  initialAction?: ActionKey | null
}

type LeadOption = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
}

type ClienteOption = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
}

type ProductoOption = {
  id: string
  nombre: string | null
}

export type ActionKey = 'newLead' | 'note' | 'nextAction' | 'opportunity' | 'venta'

const actionOrder: ActionKey[] = ['newLead', 'note', 'nextAction', 'opportunity', 'venta']

export function QuickActionsSheet({ open, onClose, initialAction = null }: QuickActionsSheetProps) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured

  const [activeAction, setActiveAction] = useState<ActionKey | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([])
  const [clienteOptions, setClienteOptions] = useState<ClienteOption[]>([])
  const [productoOptions, setProductoOptions] = useState<ProductoOption[]>([])

  const [leadForm, setLeadForm] = useState({ nombre: '', apellido: '', telefono: '', email: '', referidoPorClienteId: '' })
  const [noteForm, setNoteForm] = useState({ leadId: '', nota: '' })
  const [nextActionForm, setNextActionForm] = useState({ leadId: '', nextAction: '', nextDate: '' })
  const [opportunityForm, setOpportunityForm] = useState({
    leadId: '',
    clienteId: '',
    etapa: 'nuevo',
    valor: '',
    probabilidad: '',
    fecha: '',
  })
  const [ventaForm, setVentaForm] = useState({
    clienteId: '',
    productoId: '',
    tipo: 'venta_inicial',
    monto: '',
    fecha: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const actions = useMemo(
    () => ({
      newLead: {
        label: t('quickActions.newLead'),
        description: t('quickActions.newLeadDesc'),
      },
      note: {
        label: t('quickActions.note'),
        description: t('quickActions.noteDesc'),
      },
      nextAction: {
        label: t('quickActions.nextAction'),
        description: t('quickActions.nextActionDesc'),
      },
      opportunity: {
        label: t('quickActions.opportunity'),
        description: t('quickActions.opportunityDesc'),
      },
      venta: {
        label: t('quickActions.venta'),
        description: t('quickActions.ventaDesc'),
      },
    }),
    [t]
  )

  const loadOptions = useCallback(async () => {
    if (!configured || !session?.user.id) return
    setLoadingOptions(true)
    const vendedorId = session.user.id

    const [leadsRes, clientesRes, productosRes] = await Promise.all([
      supabase
        .from('leads')
        .select('id, nombre, apellido, telefono')
        .eq('vendedor_id', vendedorId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('clientes')
        .select('id, nombre, apellido, telefono')
        .eq('vendedor_id', vendedorId)
        .order('updated_at', { ascending: false })
        .limit(200),
      supabase
        .from('productos')
        .select('id, nombre')
        .eq('activo', true)
        .order('nombre', { ascending: true })
        .limit(200),
    ])

    setLeadOptions((leadsRes.data as LeadOption[] | null) ?? [])
    setClienteOptions((clientesRes.data as ClienteOption[] | null) ?? [])
    setProductoOptions((productosRes.data as ProductoOption[] | null) ?? [])
    setLoadingOptions(false)
  }, [configured, session?.user.id])

  useEffect(() => {
    if (!open) return
    setActiveAction(initialAction)
    loadOptions()
  }, [open, initialAction, loadOptions])

  const getLabel = (row: { nombre: string | null; apellido?: string | null; telefono?: string | null }) => {
    const name = [row.nombre, row.apellido].filter(Boolean).join(' ').trim()
    if (row.telefono) return `${name || t('common.noData')} · ${row.telefono}`
    return name || t('common.noData')
  }

  const resetForms = () => {
    setLeadForm({ nombre: '', apellido: '', telefono: '', email: '', referidoPorClienteId: '' })
    setNoteForm({ leadId: '', nota: '' })
    setNextActionForm({ leadId: '', nextAction: '', nextDate: '' })
    setOpportunityForm({ leadId: '', clienteId: '', etapa: 'nuevo', valor: '', probabilidad: '', fecha: '' })
    setVentaForm({ clienteId: '', productoId: '', tipo: 'venta_inicial', monto: '', fecha: '' })
  }

  const handleSuccess = () => {
    resetForms()
    setActiveAction(null)
    onClose()
  }

  const handleCreateLead = async () => {
    if (!leadForm.nombre.trim() || !leadForm.telefono.trim()) {
      showToast(t('quickActions.requiredLead'), 'error')
      return
    }
    if (!session?.user.id) return
    setSubmitting(true)
    const { error } = await supabase.from('leads').insert({
      nombre: leadForm.nombre.trim(),
      apellido: leadForm.apellido.trim() || null,
      telefono: leadForm.telefono.trim(),
      email: leadForm.email.trim() || null,
      estado_pipeline: 'nuevo',
      owner_id: session.user.id,
      vendedor_id: session.user.id,
      referido_por_cliente_id: leadForm.referidoPorClienteId || null,
    })
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast(t('toast.success'))
      handleSuccess()
    }
    setSubmitting(false)
  }

  const handleCreateNote = async () => {
    if (!noteForm.leadId || !noteForm.nota.trim() || !session?.user.id) {
      showToast(t('quickActions.requiredNote'), 'error')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('lead_notas').insert({
      lead_id: noteForm.leadId,
      usuario_id: session.user.id,
      nota: noteForm.nota.trim(),
      tipo: 'seguimiento',
    })
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast(t('toast.success'))
      handleSuccess()
    }
    setSubmitting(false)
  }

  const handleNextAction = async () => {
    if (!nextActionForm.leadId || !nextActionForm.nextDate) {
      showToast(t('quickActions.requiredNextAction'), 'error')
      return
    }
    setSubmitting(true)
    const { error } = await supabase
      .from('leads')
      .update({
        next_action: nextActionForm.nextAction.trim() || null,
        next_action_date: nextActionForm.nextDate,
      })
      .eq('id', nextActionForm.leadId)
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast(t('toast.success'))
      handleSuccess()
    }
    setSubmitting(false)
  }

  const handleCreateOpportunity = async () => {
    if (!session?.user.id) return
    if (!opportunityForm.leadId && !opportunityForm.clienteId) {
      showToast(t('quickActions.requiredOpportunity'), 'error')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('oportunidades').insert({
      lead_id: opportunityForm.leadId || null,
      cliente_id: opportunityForm.clienteId || null,
      etapa: opportunityForm.etapa,
      valor: Number(opportunityForm.valor || 0),
      probabilidad: opportunityForm.probabilidad ? Number(opportunityForm.probabilidad) : null,
      fecha_cierre_estimada: opportunityForm.fecha || null,
      owner_id: session.user.id,
    })
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast(t('toast.success'))
      handleSuccess()
    }
    setSubmitting(false)
  }

  const handleCreateVenta = async () => {
    if (!session?.user.id) return
    if (!ventaForm.clienteId || !ventaForm.fecha || !ventaForm.monto) {
      showToast(t('quickActions.requiredVenta'), 'error')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('ventas').insert({
      cliente_id: ventaForm.clienteId,
      producto_id: ventaForm.productoId || null,
      vendedor_id: session.user.id,
      monto: Number(ventaForm.monto || 0),
      tipo_movimiento: ventaForm.tipo,
      fecha_venta: ventaForm.fecha,
    })
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast(t('toast.success'))
      handleSuccess()
    }
    setSubmitting(false)
  }

  if (!open) return null

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-header">
          <div>
            <h3>{t('quickActions.title')}</h3>
            <p>{t('quickActions.subtitle')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            x
          </button>
        </header>

        {!configured && (
          <div className="sheet-warning">{t('common.supabaseRequired')}</div>
        )}

        {activeAction === null && (
          <div className="sheet-actions">
            {actionOrder.map((key) => (
              <button
                key={key}
                type="button"
                className="sheet-action"
                onClick={() => setActiveAction(key)}
              >
                <span className="sheet-action-title">{actions[key].label}</span>
                <span className="sheet-action-subtitle">{actions[key].description}</span>
              </button>
            ))}
          </div>
        )}

        {activeAction !== null && (
          <div className="sheet-form">
            <button type="button" className="sheet-back" onClick={() => setActiveAction(null)}>
              {t('common.previous')}
            </button>

            {activeAction === 'newLead' && (
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('leads.fields.nombre')}</span>
                  <input value={leadForm.nombre} onChange={(event) => setLeadForm((prev) => ({ ...prev, nombre: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{t('leads.fields.apellido')}</span>
                  <input value={leadForm.apellido} onChange={(event) => setLeadForm((prev) => ({ ...prev, apellido: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{t('leads.fields.telefono')}</span>
                  <input value={leadForm.telefono} onChange={(event) => setLeadForm((prev) => ({ ...prev, telefono: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{t('leads.fields.email')}</span>
                  <input value={leadForm.email} onChange={(event) => setLeadForm((prev) => ({ ...prev, email: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{t('leads.fields.referidoPor')}</span>
                  <select
                    value={leadForm.referidoPorClienteId}
                    onChange={(event) => setLeadForm((prev) => ({ ...prev, referidoPorClienteId: event.target.value }))}
                  >
                    <option value="">{t('common.select')}</option>
                    {clienteOptions.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {getLabel(cliente)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button onClick={handleCreateLead} disabled={submitting}>
                  {t('quickActions.create')}
                </Button>
              </div>
            )}

            {activeAction === 'note' && (
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('leads.title')}</span>
                  <select value={noteForm.leadId} onChange={(event) => setNoteForm((prev) => ({ ...prev, leadId: event.target.value }))}>
                    <option value="">{loadingOptions ? t('common.loading') : t('common.select')}</option>
                    {leadOptions.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {getLabel(lead)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>{t('hoy.noteLabel')}</span>
                  <textarea rows={4} value={noteForm.nota} onChange={(event) => setNoteForm((prev) => ({ ...prev, nota: event.target.value }))} />
                </label>
                <Button onClick={handleCreateNote} disabled={submitting}>
                  {t('quickActions.create')}
                </Button>
              </div>
            )}

            {activeAction === 'nextAction' && (
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('leads.title')}</span>
                  <select value={nextActionForm.leadId} onChange={(event) => setNextActionForm((prev) => ({ ...prev, leadId: event.target.value }))}>
                    <option value="">{loadingOptions ? t('common.loading') : t('common.select')}</option>
                    {leadOptions.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {getLabel(lead)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>{t('hoy.nextAction')}</span>
                  <input value={nextActionForm.nextAction} onChange={(event) => setNextActionForm((prev) => ({ ...prev, nextAction: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{t('hoy.nextDate')}</span>
                  <input type="date" value={nextActionForm.nextDate} onChange={(event) => setNextActionForm((prev) => ({ ...prev, nextDate: event.target.value }))} />
                </label>
                <Button onClick={handleNextAction} disabled={submitting}>
                  {t('quickActions.create')}
                </Button>
              </div>
            )}

            {activeAction === 'opportunity' && (
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('leads.title')}</span>
                  <select value={opportunityForm.leadId} onChange={(event) => setOpportunityForm((prev) => ({ ...prev, leadId: event.target.value }))}>
                    <option value="">{t('common.select')}</option>
                    {leadOptions.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {getLabel(lead)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>{t('clientes.title')}</span>
                  <select value={opportunityForm.clienteId} onChange={(event) => setOpportunityForm((prev) => ({ ...prev, clienteId: event.target.value }))}>
                    <option value="">{t('common.select')}</option>
                    {clienteOptions.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {getLabel(cliente)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>{t('oportunidades.form.valor')}</span>
                  <input type="number" value={opportunityForm.valor} onChange={(event) => setOpportunityForm((prev) => ({ ...prev, valor: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{t('oportunidades.form.probabilidad')}</span>
                  <input type="number" value={opportunityForm.probabilidad} onChange={(event) => setOpportunityForm((prev) => ({ ...prev, probabilidad: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{t('oportunidades.form.fecha')}</span>
                  <input type="date" value={opportunityForm.fecha} onChange={(event) => setOpportunityForm((prev) => ({ ...prev, fecha: event.target.value }))} />
                </label>
                <Button onClick={handleCreateOpportunity} disabled={submitting}>
                  {t('quickActions.create')}
                </Button>
              </div>
            )}

            {activeAction === 'venta' && (
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('clientes.title')}</span>
                  <select value={ventaForm.clienteId} onChange={(event) => setVentaForm((prev) => ({ ...prev, clienteId: event.target.value }))}>
                    <option value="">{t('common.select')}</option>
                    {clienteOptions.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {getLabel(cliente)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>{t('ventas.fields.productoId')}</span>
                  <select value={ventaForm.productoId} onChange={(event) => setVentaForm((prev) => ({ ...prev, productoId: event.target.value }))}>
                    <option value="">{t('common.select')}</option>
                    {productoOptions.map((producto) => (
                      <option key={producto.id} value={producto.id}>
                        {producto.nombre ?? producto.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>{t('ventas.fields.tipoMovimiento')}</span>
                  <select value={ventaForm.tipo} onChange={(event) => setVentaForm((prev) => ({ ...prev, tipo: event.target.value }))}>
                    <option value="venta_inicial">{t('ventas.tipo.venta_inicial')}</option>
                    <option value="agregado">{t('ventas.tipo.agregado')}</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>{t('ventas.fields.monto')}</span>
                  <input type="number" value={ventaForm.monto} onChange={(event) => setVentaForm((prev) => ({ ...prev, monto: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{t('ventas.fields.fecha')}</span>
                  <input type="date" value={ventaForm.fecha} onChange={(event) => setVentaForm((prev) => ({ ...prev, fecha: event.target.value }))} />
                </label>
                <Button onClick={handleCreateVenta} disabled={submitting}>
                  {t('quickActions.create')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
