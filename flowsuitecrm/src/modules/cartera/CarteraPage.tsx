import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase/client'
import { useUsers } from '../../data/useUsers'
import { Modal } from '../../components/Modal'
import { INPUT_STYLE, LABEL_STYLE } from '../../components/formControlStyles'
import { RegistrarGestionModal, type GestionContactoRef, type GestionDraft, type GestionRole } from '../../components/RegistrarGestionModal'
import { useMessaging } from '../../hooks/useMessaging'
import type { MessagingChannel, MessagingContact } from '../../types/messaging'
import {
  calculatePaymentPlanSummary,
  generateInstallmentSchedule,
  validatePaymentPlanInput,
} from './services/PaymentPlanService'

// ── Types ─────────────────────────────────────────────────────────────────────

type EstadoCaso = 'Abierto' | 'En Negociación' | 'Acuerdo' | 'Cerrado'

function parseMontoCargoVueltaInput(value: string): number | null {
  const clean = value.replace(/[$,\s]/g, '').trim()
  if (!clean) return null
  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

type Case = {
  id: string
  org_id: string
  cliente_id: string
  tipo_caso: 'cargo_vuelta' | 'dfp' | null
  monto_total: number
  monto_devuelto: number | null
  fecha_cargo_vuelta: string | null
  dias_vencido: number
  estado: EstadoCaso
  acuerdo_tipo: string | null
  fecha_apertura: string
  fecha_cierre: string | null
  updated_by: string | null
  en_proceso_legal: boolean
  clientes: {
    nombre: string | null
    apellido: string | null
    telefono: string | null
    email: string | null
    hycite_id: string | null
    saldo_actual: number | null
  } | null
}

type ClienteResumen = NonNullable<Case['clientes']> & {
  id: string
}

type Gestion = {
  id: string
  tipo_gestion: string
  resultado: string | null
  monto_comprometido: number | null
  fecha_compromiso: string | null
  notas: string | null
  gestionado_por: string | null
  created_at: string
}

type PTP = {
  id: string
  monto: number
  fecha_compromiso: string
  estado: string
  canal: string | null
  notas: string | null
  creado_por: string | null
  fecha_cumplimiento: string | null
  cumplido_at: string | null
  incumplido_at: string | null
  created_at: string
}

type Pago = {
  id: string
  monto: number
  fecha_pago: string
  metodo_pago: string | null
  referencia_externa: string | null
  comprobante_url: string | null
  estado: string
  source: string
  notas: string | null
  created_by: string | null
  ptp_id: string | null
  created_at: string
}

type Plan = {
  id: string
  monto_total: number
  numero_cuotas: number
  estado: string
  tipo_plan: string | null
  balance_inicial: number | null
  tasa_anual_pct: number | null
  monto_cuota: number | null
  fecha_primer_pago: string | null
  metodo_pago_id: string | null
  notas: string | null
  created_at: string
  cuotas: Cuota[]
}

type Cuota = {
  id: string
  plan_id?: string
  plan_pago_id?: string
  numero_cuota: number
  monto: number
  monto_programado?: number
  principal_programado?: number
  interes_programado?: number
  fees_programados?: number
  monto_pagado?: number
  saldo_cuota?: number
  fecha_vencimiento: string
  fecha_pago: string | null
  pago_id?: string | null
  cob_pago_id?: string | null
  paid_at?: string | null
  estado: string
}

type MetodoPagoOption = {
  id: string
  provider: string | null
  brand: string | null
  last4: string | null
  is_default: boolean
  estado: string
}

type DfpAccount = {
  id: string
  case_id: string
  cliente_id: string
  apr_anual: number
  fecha_inicio: string
  fecha_ultimo_devengo: string
  saldo_principal_inicial: number
  saldo_principal_actual: number
  saldo_interes_actual: number
  saldo_fees_actual: number
  saldo_total_actual: number
  estado: string
}

type LedgerEntry = {
  id: string
  revolving_account_id: string
  case_id: string
  entry_date: string
  effective_date: string
  entry_type: string
  component_type: string
  debit_credit: string
  amount: number
  description: string | null
  balance_principal_after: number | null
  balance_interest_after: number | null
  balance_fees_after: number | null
  balance_total_after: number | null
  created_at: string
}

type HistorialEvent = {
  id: string
  timestamp: string
  tipo: 'apertura' | 'gestion' | 'ptp' | 'pago' | 'cierre'
  label: string
  monto: number | null
  estado: string | null
  notas: string | null
  actor: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function todayYmd() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function parseYmdLocal(ymd: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return new Date(ymd)
  const [, year, month, day] = match
  return new Date(Number(year), Number(month) - 1, Number(day))
}

function nombreCliente(c: Case['clientes']) {
  if (!c) return '—'
  return [c.nombre, c.apellido].filter(Boolean).join(' ') || '—'
}

function fmtMonto(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function fmtFecha(s: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseYmdLocal(s) : new Date(s)
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function diasColor(d: number) {
  if (d >= 91) return '#7c3aed'
  if (d >= 61) return '#dc2626'
  if (d >= 31) return '#ea580c'
  if (d > 0) return '#f59e0b'
  return '#6b7280'
}

function estadoColor(e: string) {
  if (e === 'Abierto') return '#3b82f6'
  if (e === 'En Negociación') return '#f59e0b'
  if (e === 'Acuerdo') return '#10b981'
  if (e === 'Cerrado') return '#6b7280'
  return '#6b7280'
}

function ptpEstadoColor(e: string) {
  if (e === 'cumplido') return '#10b981'
  if (e === 'vencido') return '#dc2626'
  if (e === 'incumplido') return '#ea580c'
  if (e === 'cancelado') return '#6b7280'
  return '#f59e0b'
}

function historialColor(tipo: HistorialEvent['tipo']) {
  if (tipo === 'apertura') return '#3b82f6'
  if (tipo === 'pago') return '#10b981'
  if (tipo === 'ptp') return '#f59e0b'
  if (tipo === 'cierre') return '#6b7280'
  return '#94a3b8'
}

function buildHistorial(gestiones: Gestion[], ptps: PTP[], pagos: Pago[], caso: Case): HistorialEvent[] {
  const events: HistorialEvent[] = []

  events.push({
    id: `case-open-${caso.id}`,
    timestamp: caso.fecha_apertura,
    tipo: 'apertura',
    label: 'Caso abierto',
    monto: caso.monto_devuelto ?? caso.monto_total,
    estado: caso.estado,
    notas: caso.acuerdo_tipo ?? null,
    actor: null,
  })

  if (caso.fecha_cierre) {
    events.push({
      id: `case-close-${caso.id}`,
      timestamp: caso.fecha_cierre,
      tipo: 'cierre',
      label: 'Caso cerrado',
      monto: null,
      estado: caso.estado,
      notas: null,
      actor: caso.updated_by,
    })
  }

  for (const g of gestiones) {
    events.push({
      id: `g-${g.id}`,
      timestamp: g.created_at,
      tipo: 'gestion',
      label: g.tipo_gestion,
      monto: g.monto_comprometido,
      estado: g.resultado,
      notas: g.notas,
      actor: g.gestionado_por,
    })
  }

  for (const p of ptps) {
    events.push({
      id: `ptp-${p.id}`,
      timestamp: p.created_at,
      tipo: 'ptp',
      label: p.estado === 'cumplido' ? 'Promesa cumplida' : 'Promesa de pago',
      monto: p.monto,
      estado: p.estado,
      notas: p.notas,
      actor: p.creado_por,
    })
  }

  for (const p of pagos) {
    events.push({
      id: `pago-${p.id}`,
      timestamp: p.fecha_pago,
      tipo: 'pago',
      label: 'Pago registrado',
      monto: p.monto,
      estado: null,
      notas: [p.metodo_pago, p.referencia_externa, p.notas].filter(Boolean).join(' · ') || null,
      actor: p.created_by,
    })
  }

  const TIPO_PRIORITY: Record<HistorialEvent['tipo'], number> = { pago: 0, ptp: 1, gestion: 2, apertura: 3, cierre: 4 }
  return events.sort((a, b) => {
    const dayA = a.timestamp.slice(0, 10)
    const dayB = b.timestamp.slice(0, 10)
    if (dayA !== dayB) return dayA < dayB ? 1 : -1
    const prioDiff = TIPO_PRIORITY[a.tipo] - TIPO_PRIORITY[b.tipo]
    if (prioDiff !== 0) return prioDiff
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
}

// ── PTP Modal ────────────────────────────────────────────────────────────────

type PTPModalProps = {
  open: boolean
  caseId: string
  clienteId: string
  orgId: string
  currentUserId: string | null
  onClose: () => void
  onSaved: () => void
}

function PTPModal({ open, caseId, clienteId, orgId, currentUserId, onClose, onSaved }: PTPModalProps) {
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState('')
  const [canal, setCanal] = useState('telefono')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setMonto(''); setFecha(''); setCanal('telefono'); setNotas(''); setError(null) }
  }, [open])

  const handleSave = async () => {
    const parsedMonto = Number(monto)
    if (!Number.isFinite(parsedMonto) || parsedMonto <= 0) { setError('El monto debe ser mayor a 0'); return }
    if (!fecha) { setError('La fecha compromiso es obligatoria'); return }
    if (!['telefono', 'whatsapp', 'email', 'sms', 'presencial', 'otro'].includes(canal)) {
      setError('Canal inválido')
      return
    }
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('cob_ptps').insert({
      org_id: orgId,
      cliente_id: clienteId,
      case_id: caseId,
      monto: parsedMonto,
      fecha_compromiso: fecha,
      estado: 'pendiente',
      canal,
      notas: notas || null,
      creado_por: currentUserId ?? null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} title="Registrar Promesa de Pago" onClose={onClose} size="sm"
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.875rem' }}>Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Guardando…' : 'Guardar PTP'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>{error}</p>}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Monto comprometido *</span>
          <input type="number" min="0" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Fecha compromiso *</span>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Canal *</span>
          <select value={canal} onChange={e => setCanal(e.target.value)} style={INPUT_STYLE}>
            <option value="telefono">Teléfono</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="presencial">Presencial</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Notas</span>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3} placeholder="Observaciones del acuerdo…" style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '72px' }} />
        </label>
      </div>
    </Modal>
  )
}

// ── Pago Modal ────────────────────────────────────────────────────────────────

type PagoModalProps = {
  open: boolean
  caseId: string
  clienteId: string
  orgId: string
  currentUserId: string | null
  ptps: PTP[]
  onClose: () => void
  onSaved: () => void
}

function PagoModal({ open, caseId, clienteId, orgId, currentUserId, ptps, onClose, onSaved }: PagoModalProps) {
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(todayYmd())
  const [metodo, setMetodo] = useState('cash')
  const [referenciaExterna, setReferenciaExterna] = useState('')
  const [comprobanteUrl, setComprobanteUrl] = useState('')
  const [notas, setNotas] = useState('')
  const [ptpId, setPtpId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ptpsPendientes = useMemo(() => ptps.filter(p => p.estado === 'pendiente' || p.estado === 'vencido'), [ptps])

  useEffect(() => {
    if (open) {
      setMonto(''); setFecha(todayYmd()); setMetodo('cash'); setReferenciaExterna(''); setComprobanteUrl(''); setNotas(''); setError(null)
      // Auto-seleccionar el único PTP pendiente para que operación lo vea pre-marcado
      setPtpId(ptpsPendientes.length === 1 ? ptpsPendientes[0].id : '')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const parsedMonto = Number(monto)
    if (!Number.isFinite(parsedMonto) || parsedMonto <= 0) { setError('El monto debe ser mayor a 0'); return }
    if (!fecha) { setError('La fecha de pago es obligatoria'); return }
    if (!['cash', 'check', 'zelle', 'ach', 'card', 'hycite', 'wire', 'otro'].includes(metodo)) {
      setError('Método de pago inválido')
      return
    }
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('cob_pagos').insert({
      org_id: orgId,
      cliente_id: clienteId,
      cargo_vuelta_case_id: caseId,
      ptp_id: ptpId || null,
      monto: parsedMonto,
      moneda: 'USD',
      fecha_pago: fecha,
      metodo_pago: metodo,
      referencia_externa: referenciaExterna.trim() || null,
      comprobante_url: comprobanteUrl.trim() || null,
      notas: notas.trim() || null,
      estado: 'registrado',
      source: 'manual',
      created_by: currentUserId ?? null,
    })
    if (err) { setSaving(false); setError(err.message); return }

    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} title="Registrar Pago" onClose={onClose} size="sm"
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.875rem' }}>Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Guardando…' : 'Registrar pago'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>{error}</p>}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Monto recibido *</span>
          <input type="number" min="0" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Fecha pago *</span>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Método de pago</span>
          <select value={metodo} onChange={e => setMetodo(e.target.value)} style={INPUT_STYLE}>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
            <option value="zelle">Zelle</option>
            <option value="ach">ACH</option>
            <option value="card">Card</option>
            <option value="hycite">Hycite</option>
            <option value="wire">Wire</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Referencia / N° confirmación</span>
          <input type="text" value={referenciaExterna} onChange={e => setReferenciaExterna(e.target.value)} placeholder="Ej. TRF-123456" style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Comprobante URL (opcional)</span>
          <input type="url" value={comprobanteUrl} onChange={e => setComprobanteUrl(e.target.value)} placeholder="https://..." style={INPUT_STYLE} />
        </label>
        {ptpsPendientes.length === 1 && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer', padding: '0.6rem 0.65rem', borderRadius: '0.45rem', border: `1px solid ${ptpId ? '#10b98155' : 'var(--color-border)'}`, background: ptpId ? '#10b98108' : 'transparent' }}>
            <input
              type="checkbox"
              checked={Boolean(ptpId)}
              onChange={e => setPtpId(e.target.checked ? ptpsPendientes[0].id : '')}
              style={{ marginTop: '0.15rem', accentColor: '#10b981', flexShrink: 0 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)' }}>Cerrar PTP asociado</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {fmtFecha(ptpsPendientes[0].fecha_compromiso)} · {fmtMonto(ptpsPendientes[0].monto)}
                {ptpsPendientes[0].estado === 'vencido' && <span style={{ marginLeft: '0.4rem', color: '#dc2626', fontWeight: 600 }}>vencido</span>}
              </span>
              {ptpId && <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>Se marcará como cumplido al guardar</span>}
            </div>
          </label>
        )}
        {ptpsPendientes.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={LABEL_STYLE}>Cerrar promesa de pago (opcional)</span>
            <select value={ptpId} onChange={e => setPtpId(e.target.value)} style={INPUT_STYLE}>
              <option value="">— No cerrar ningún PTP —</option>
              {ptpsPendientes.map(p => (
                <option key={p.id} value={p.id}>{fmtFecha(p.fecha_compromiso)} · {fmtMonto(p.monto)}{p.estado === 'vencido' ? ' · vencido' : ''}</option>
              ))}
            </select>
            {ptpId && <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>✓ Este PTP se marcará como cumplido al guardar</span>}
          </div>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Notas</span>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Observaciones del pago…" style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '56px' }} />
        </label>
      </div>
    </Modal>
  )
}

// ── Plan Modal ────────────────────────────────────────────────────────────────

type PlanModalProps = {
  open: boolean
  caseId: string
  clienteId: string
  orgId: string
  currentUserId: string | null
  onClose: () => void
  onSaved: () => void
}

function PlanModal({ open, caseId, clienteId, orgId, currentUserId, onClose, onSaved }: PlanModalProps) {
  const [modoCalculo, setModoCalculo] = useState<'cuotas' | 'pago_minimo'>('cuotas')
  const [balanceInicial, setBalanceInicial] = useState('')
  const [tasaAnual, setTasaAnual] = useState('0')
  const [numeroCuotas, setNumeroCuotas] = useState('6')
  const [pagoMinimo, setPagoMinimo] = useState('')
  const [diaDebito, setDiaDebito] = useState('15')
  const [fechaPrimerPago, setFechaPrimerPago] = useState('')
  const [feeSetup, setFeeSetup] = useState('0')
  const [feeLate, setFeeLate] = useState('0')
  const [metodoPagoId, setMetodoPagoId] = useState('')
  const [estadoPlan, setEstadoPlan] = useState<'borrador' | 'activo'>('borrador')
  const [metodosPago, setMetodosPago] = useState<MetodoPagoOption[]>([])
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBalanceInicial('')
    setTasaAnual('0')
    setNumeroCuotas('6')
    setPagoMinimo('')
    setModoCalculo('cuotas')
    setDiaDebito('15')
    setFechaPrimerPago('')
    setFeeSetup('0')
    setFeeLate('0')
    setMetodoPagoId('')
    setEstadoPlan('borrador')
    setNotas('')
    setError(null)
    setMetodosPago([])

    const loadMetodos = async () => {
      const { data } = await supabase
        .from('cob_metodos_pago')
        .select('id,provider,brand,last4,is_default,estado')
        .eq('org_id', orgId)
        .eq('cliente_id', clienteId)
        .eq('estado', 'activo')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
      const rows = (data ?? []) as MetodoPagoOption[]
      setMetodosPago(rows)
      if (rows.length === 1) setMetodoPagoId(rows[0].id)
      if (rows.length > 1) {
        const defaultRow = rows.find((r) => r.is_default)
        if (defaultRow) setMetodoPagoId(defaultRow.id)
      }
    }
    void loadMetodos()
  }, [open, orgId, clienteId])

  const numeroCuotasCalculado = useMemo(() => {
    const balance = Number(balanceInicial)
    const tasaAnualNum = Number(tasaAnual)
    const pagoMinimoNum = Number(pagoMinimo)
    if (modoCalculo !== 'pago_minimo') return null
    if (!Number.isFinite(balance) || balance <= 0) return null
    if (!Number.isFinite(pagoMinimoNum) || pagoMinimoNum <= 0) return null

    const r = tasaAnualNum / 100 / 12
    if (r === 0) return Math.min(120, Math.max(1, Math.ceil(balance / pagoMinimoNum)))

    const interesPrimerPeriodo = balance * r
    if (pagoMinimoNum <= interesPrimerPeriodo) return null

    const n = -Math.log(1 - (r * balance) / pagoMinimoNum) / Math.log(1 + r)
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.min(120, Math.max(1, Math.ceil(n)))
  }, [modoCalculo, balanceInicial, tasaAnual, pagoMinimo])

  const planInput = useMemo(() => ({
    balance: Number(balanceInicial),
    tasa_anual_pct: Number(tasaAnual),
    numero_cuotas: modoCalculo === 'pago_minimo' ? Number(numeroCuotasCalculado ?? 0) : Number(numeroCuotas),
    fecha_primer_pago: fechaPrimerPago,
    dia_debito: Number(diaDebito),
    fee_setup: Number(feeSetup || 0),
    fee_late: Number(feeLate || 0),
    estadoCuotaInicial: 'pendiente' as const,
  }), [balanceInicial, tasaAnual, numeroCuotas, modoCalculo, numeroCuotasCalculado, fechaPrimerPago, diaDebito, feeSetup, feeLate])

  const preview = useMemo(() => {
    try {
      if (modoCalculo === 'pago_minimo') {
        const pagoMinimoNum = Number(pagoMinimo)
        if (!Number.isFinite(pagoMinimoNum) || pagoMinimoNum <= 0) {
          throw new Error('pago_minimo debe ser mayor que 0')
        }
        if (!numeroCuotasCalculado) {
          throw new Error('El pago mínimo no cubre el interés del período o es inválido')
        }
      }
      validatePaymentPlanInput(planInput)
      return {
        summary: calculatePaymentPlanSummary(planInput),
        cuotas: generateInstallmentSchedule(planInput),
        error: null as string | null,
      }
    } catch (e) {
      return {
        summary: null,
        cuotas: [] as ReturnType<typeof generateInstallmentSchedule>,
        error: e instanceof Error ? e.message : 'Datos inválidos',
      }
    }
  }, [modoCalculo, pagoMinimo, numeroCuotasCalculado, planInput])

  const amortizationRows = useMemo(() => {
    if (!preview.summary) return []
    let remaining = Number(balanceInicial)
    if (!Number.isFinite(remaining) || remaining < 0) remaining = 0
    return preview.cuotas.map((c) => {
      const principal = Number(c.principal_programado || 0)
      remaining = Math.max(0, Math.round((remaining - principal) * 100) / 100)
      return {
        ...c,
        balance_restante: remaining,
      }
    })
  }, [preview.summary, preview.cuotas, balanceInicial])

  const handleSave = async () => {
    if (!currentUserId) { setError('No se pudo identificar el usuario actual.'); return }
    if (preview.error || !preview.summary || preview.cuotas.length === 0) {
      setError(preview.error ?? 'Corrige los datos del plan antes de guardar.')
      return
    }
    setSaving(true)
    setError(null)

    const balance = Number(balanceInicial)
    const tasaAnualNum = Number(tasaAnual)
    const numeroCuotasNum = modoCalculo === 'pago_minimo' ? Number(numeroCuotasCalculado ?? 0) : Number(numeroCuotas)
    const diaDebitoNum = Number(diaDebito)
    const feeSetupNum = Number(feeSetup || 0)
    const feeLateNum = Number(feeLate || 0)
    const tasaMensualPct = Number((tasaAnualNum / 12).toFixed(3))
    const montoCuota = preview.summary.monto_cuota_estimado
    const totalProgramado = preview.summary.total_programado

    const { data: planData, error: planErr } = await supabase.from('cob_plan_pagos').insert({
      org_id: orgId,
      cliente_id: clienteId,
      case_id: caseId,
      cargo_vuelta_case_id: caseId,
      metodo_pago_id: metodoPagoId || null,
      tipo_plan: 'refinanciamiento',
      estado: estadoPlan,
      principal_original: balance,
      balance_inicial: balance,
      tasa_anual_pct: tasaAnualNum,
      tasa_mensual_pct: tasaMensualPct,
      monto_cuota: montoCuota,
      dia_debito: diaDebitoNum,
      fecha_primer_pago: fechaPrimerPago,
      fecha_fin_estimada: preview.summary.fecha_fin_estimada,
      fee_setup: feeSetupNum,
      fee_late: feeLateNum,
      moneda: 'USD',
      created_by: currentUserId,
      updated_by: currentUserId,
      creado_por: currentUserId,
      monto_total: totalProgramado,
      numero_cuotas: numeroCuotasNum,
      notas: notas.trim() || null,
    }).select('id').single()

    if (planErr || !planData) { setSaving(false); setError(planErr?.message ?? 'Error al crear plan'); return }

    const cuotas = preview.cuotas.map((c) => ({
        org_id: orgId,
        plan_id: planData.id,
        plan_pago_id: planData.id,
        cargo_vuelta_case_id: caseId,
        cliente_id: clienteId,
        numero_cuota: c.numero_cuota,
        monto: c.monto_programado,
        fecha_vencimiento: c.fecha_vencimiento,
        estado: 'programada',
        monto_programado: c.monto_programado,
        principal_programado: c.principal_programado,
        interes_programado: c.interes_programado,
        fees_programados: c.fees_programados,
        monto_pagado: 0,
        saldo_cuota: c.monto_programado,
      }))

    const { error: cuotasErr } = await supabase.from('cob_plan_cuotas').insert(cuotas)
    if (cuotasErr) {
      await supabase
        .from('cob_plan_pagos')
        .update({
          estado: 'cancelado',
          updated_by: currentUserId,
          notas: `${notas.trim() || ''}\n[ERROR_CUOTAS] ${cuotasErr.message}`.trim(),
        })
        .eq('id', planData.id)
      setSaving(false)
      setError(`Plan creado pero falló la programación de cuotas. El plan se marcó como cancelado para revisión: ${cuotasErr.message}`)
      return
    }

    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} title="Crear acuerdo de pago (Refinanciar)" onClose={onClose} size="sm"
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.875rem' }}>Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving || Boolean(preview.error)} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Guardando…' : 'Crear acuerdo'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>{error}</p>}
        {preview.error && <p style={{ color: '#f59e0b', fontSize: '0.78rem', margin: 0 }}>{preview.error}</p>}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Balance inicial *</span>
          <input type="number" min="0" step="0.01" value={balanceInicial} onChange={e => setBalanceInicial(e.target.value)} placeholder="0.00" style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Modo de cálculo *</span>
          <select value={modoCalculo} onChange={e => setModoCalculo(e.target.value as 'cuotas' | 'pago_minimo')} style={INPUT_STYLE}>
            <option value="cuotas">Por número de cuotas</option>
            <option value="pago_minimo">Por pago mínimo</option>
          </select>
        </label>
        {modoCalculo === 'cuotas' ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={LABEL_STYLE}>Número de cuotas *</span>
            <input type="number" min="1" max="120" value={numeroCuotas} onChange={e => setNumeroCuotas(e.target.value)} style={INPUT_STYLE} />
          </label>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={LABEL_STYLE}>Pago mínimo mensual *</span>
            <input type="number" min="0.01" step="0.01" value={pagoMinimo} onChange={e => setPagoMinimo(e.target.value)} style={INPUT_STYLE} />
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              Sobre el saldo + interés, sin incluir cargos adicionales.
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              Cuotas estimadas: {numeroCuotasCalculado ?? '—'}
            </span>
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Tasa anual (%) *</span>
          <input type="number" min="0" max="36" step="0.001" value={tasaAnual} onChange={e => setTasaAnual(e.target.value)} style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Día de débito *</span>
          <input type="number" min="1" max="31" value={diaDebito} onChange={e => setDiaDebito(e.target.value)} style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Fecha primer pago *</span>
          <input type="date" value={fechaPrimerPago} onChange={e => setFechaPrimerPago(e.target.value)} style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Fee setup</span>
          <input type="number" min="0" step="0.01" value={feeSetup} onChange={e => setFeeSetup(e.target.value)} style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Fee late</span>
          <input type="number" min="0" step="0.01" value={feeLate} onChange={e => setFeeLate(e.target.value)} style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Método de pago (opcional)</span>
          <select value={metodoPagoId} onChange={(e) => setMetodoPagoId(e.target.value)} style={INPUT_STYLE}>
            <option value="">— Sin método asociado —</option>
            {metodosPago.map((m) => (
              <option key={m.id} value={m.id}>
                {(m.provider ?? 'manual')} · {(m.brand ?? 'other')} {m.last4 ? `****${m.last4}` : ''}{m.is_default ? ' · default' : ''}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Estado inicial del acuerdo</span>
          <select value={estadoPlan} onChange={(e) => setEstadoPlan(e.target.value as 'borrador' | 'activo')} style={INPUT_STYLE}>
            <option value="borrador">borrador</option>
            <option value="activo">activo</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Notas</span>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Condiciones del acuerdo…" style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '56px' }} />
        </label>
        {preview.summary && (
          <div style={{ border: '1px solid var(--color-border)', borderRadius: '0.55rem', padding: '0.65rem', background: 'var(--color-card)' }}>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', fontWeight: 700 }}>Previsualización</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem 0.8rem', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
              <span>Balance inicial:</span><strong style={{ color: 'var(--color-text)' }}>{fmtMonto(Number(balanceInicial) || 0)}</strong>
              <span>Tasa anual APR:</span><strong style={{ color: 'var(--color-text)' }}>{Number(tasaAnual || 0).toFixed(3)}%</strong>
              <span>Número de cuotas:</span><strong style={{ color: 'var(--color-text)' }}>{modoCalculo === 'pago_minimo' ? (numeroCuotasCalculado ?? '—') : (Number(numeroCuotas) || 0)}</strong>
              <span>Cuota estimada:</span><strong style={{ color: 'var(--color-text)' }}>{fmtMonto(preview.summary.monto_cuota_estimado)}</strong>
              <span>Fecha primer pago:</span><strong style={{ color: 'var(--color-text)' }}>{fechaPrimerPago ? fmtFecha(fechaPrimerPago) : '—'}</strong>
              <span>Fecha fin estimada:</span><strong style={{ color: 'var(--color-text)' }}>{fmtFecha(preview.summary.fecha_fin_estimada)}</strong>
              <span>Total principal:</span><strong style={{ color: 'var(--color-text)' }}>{fmtMonto(preview.summary.total_principal)}</strong>
              <span>Total interés:</span><strong style={{ color: 'var(--color-text)' }}>{fmtMonto(preview.summary.total_interes)}</strong>
              <span>Total fees:</span><strong style={{ color: 'var(--color-text)' }}>{fmtMonto(preview.summary.total_fees)}</strong>
              <span>Total a pagar:</span><strong style={{ color: 'var(--color-text)' }}>{fmtMonto(preview.summary.total_programado)}</strong>
            </div>
            <div style={{ marginTop: '0.55rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.4rem' }}>
              <p style={{ margin: '0 0 0.35rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text)' }}>Tabla de amortización</p>
              <div style={{ overflowX: 'auto', maxHeight: '220px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                  <thead>
                    <tr style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                      <th style={{ textAlign: 'left', padding: '0.25rem' }}>#</th>
                      <th style={{ textAlign: 'left', padding: '0.25rem' }}>Fecha programada</th>
                      <th style={{ textAlign: 'right', padding: '0.25rem' }}>Principal</th>
                      <th style={{ textAlign: 'right', padding: '0.25rem' }}>Interés</th>
                      <th style={{ textAlign: 'right', padding: '0.25rem' }}>Fees</th>
                      <th style={{ textAlign: 'right', padding: '0.25rem' }}>Total cuota</th>
                      <th style={{ textAlign: 'right', padding: '0.25rem' }}>Balance restante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amortizationRows.map((c) => (
                      <tr key={c.numero_cuota} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '0.25rem' }}>{c.numero_cuota}</td>
                        <td style={{ padding: '0.25rem' }}>{fmtFecha(c.fecha_vencimiento)}</td>
                        <td style={{ padding: '0.25rem', textAlign: 'right' }}>{fmtMonto(c.principal_programado)}</td>
                        <td style={{ padding: '0.25rem', textAlign: 'right' }}>{fmtMonto(c.interes_programado)}</td>
                        <td style={{ padding: '0.25rem', textAlign: 'right' }}>{fmtMonto(c.fees_programados)}</td>
                        <td style={{ padding: '0.25rem', textAlign: 'right' }}>{fmtMonto(c.monto_programado)}</td>
                        <td style={{ padding: '0.25rem', textAlign: 'right' }}>{fmtMonto(c.balance_restante)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Capturar Monto Cargo Vuelta Modal ─────────────────────────────────────────

type CapturarMontoModalProps = {
  open: boolean
  caseId: string
  clienteId: string
  orgId: string
  saldoHycite: number | null
  onClose: () => void
  onSaved: () => void
}

function CapturarMontoModal({ open, clienteId, saldoHycite, onClose, onSaved }: CapturarMontoModalProps) {
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState('')
  const [dias, setDias] = useState('')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setMonto(''); setFecha(''); setDias(''); setNotas(''); setError(null) }
  }, [open])

  const handleSave = async () => {
    const parsedMonto = parseMontoCargoVueltaInput(monto)
    if (parsedMonto === null || Number.isNaN(parsedMonto) || parsedMonto <= 0) { setError('El monto cargo de vuelta debe ser mayor a 0'); return }
    setSaving(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('fn_abrir_o_actualizar_cargo_vuelta_case', {
      p_cliente_id: clienteId,
      p_monto_cargo_vuelta: parsedMonto,
      p_fecha_cargo_vuelta: fecha || null,
      p_dias_vencido: dias ? parseInt(dias) : null,
      p_numero_cuenta_hycite: null,
      p_numero_orden_hycite: null,
      p_notas: notas.trim() || null,
    })
    setSaving(false)
    if (rpcErr) { setError(rpcErr.message); return }
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} title="Capturar Monto cargo de vuelta" onClose={onClose} size="sm"
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.875rem' }}>Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Guardando…' : 'Guardar monto'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {error && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>{error}</p>}
        {saldoHycite !== null && (
          <p style={{ margin: 0, padding: '0.5rem 0.65rem', borderRadius: '0.4rem', background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            Saldo Hy-Cite (referencia): <strong>${saldoHycite.toFixed(2)}</strong> — puede ser $0.00. El monto cargo de vuelta es el monto real que el cliente debe al distribuidor.
          </p>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Monto cargo de vuelta *</span>
          <input type="text" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.875rem', boxSizing: 'border-box' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Fecha cargo de vuelta</span>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.875rem', boxSizing: 'border-box' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Días vencido</span>
          <input type="number" min="0" step="1" value={dias} onChange={e => setDias(e.target.value)} placeholder="0" style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.875rem', boxSizing: 'border-box' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Notas</span>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Observaciones…" style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical', minHeight: '56px' }} />
        </label>
      </div>
    </Modal>
  )
}

// ── Próximo paso recomendado ──────────────────────────────────────────────────

type NextStepRec = {
  action: string
  motivo: string
  riesgo: 'alto' | 'medio' | 'bajo'
  fechaSugerida: string | null
  btnLabel: string
  btnColor: string
}

function computeNextStep(caso: Case, gestiones: Gestion[], ptps: PTP[]): NextStepRec {
  const today = todayYmd()

  if (caso.estado === 'Cerrado') {
    return { action: 'Caso cerrado', motivo: 'No requiere acciones adicionales', riesgo: 'bajo', fechaSugerida: null, btnLabel: 'Ver historial', btnColor: '#6b7280' }
  }

  if (caso.en_proceso_legal) {
    return { action: 'Coordinar con equipo legal', motivo: 'El caso está activo en proceso legal', riesgo: 'alto', fechaSugerida: today, btnLabel: '+ Gestión legal', btnColor: '#dc2626' }
  }

  const ptpVencido = ptps.find(p => p.estado === 'vencido' || (p.estado === 'pendiente' && p.fecha_compromiso < today))
  const ptpPendiente = ptps.find(p => p.estado === 'pendiente' && p.fecha_compromiso >= today)

  if (ptpVencido) {
    return {
      action: 'Seguimiento de PTP vencido',
      motivo: `${fmtMonto(ptpVencido.monto)} — vencimiento ${fmtFecha(ptpVencido.fecha_compromiso)}`,
      riesgo: 'alto',
      fechaSugerida: today,
      btnLabel: '+ Gestión',
      btnColor: '#dc2626',
    }
  }

  if (ptpPendiente) {
    return {
      action: 'Confirmar PTP próximo',
      motivo: `${fmtMonto(ptpPendiente.monto)} comprometido para el ${fmtFecha(ptpPendiente.fecha_compromiso)}`,
      riesgo: 'medio',
      fechaSugerida: ptpPendiente.fecha_compromiso,
      btnLabel: '+ Gestión',
      btnColor: '#f59e0b',
    }
  }

  if (gestiones.length === 0) {
    return {
      action: 'Primera gestión pendiente',
      motivo: 'Este caso no tiene gestiones registradas',
      riesgo: caso.dias_vencido >= 60 ? 'alto' : 'medio',
      fechaSugerida: today,
      btnLabel: '+ Gestión',
      btnColor: '#3b82f6',
    }
  }

  const lastGestion = gestiones[0]
  const daysSinceLast = Math.floor(
    (new Date(today).getTime() - new Date(lastGestion.created_at.slice(0, 10)).getTime()) / 86400000,
  )

  if (caso.dias_vencido >= 90) {
    return {
      action: 'Evaluar escalamiento urgente',
      motivo: `${caso.dias_vencido} días vencido — considerar legal o cargo de vuelta`,
      riesgo: 'alto',
      fechaSugerida: today,
      btnLabel: 'Escalar caso',
      btnColor: '#7c3aed',
    }
  }

  if (caso.dias_vencido >= 60 && daysSinceLast >= 3) {
    return {
      action: 'Gestión urgente requerida',
      motivo: `${caso.dias_vencido}d vencido · sin gestión hace ${daysSinceLast} día${daysSinceLast === 1 ? '' : 's'}`,
      riesgo: 'alto',
      fechaSugerida: today,
      btnLabel: '+ Gestión',
      btnColor: '#ea580c',
    }
  }

  if (daysSinceLast >= 7) {
    return {
      action: 'Seguimiento de rutina',
      motivo: `Última gestión hace ${daysSinceLast} días`,
      riesgo: 'medio',
      fechaSugerida: today,
      btnLabel: '+ Gestión',
      btnColor: '#f59e0b',
    }
  }

  return {
    action: 'Caso bajo seguimiento',
    motivo: `Última gestión hace ${daysSinceLast} día${daysSinceLast === 1 ? '' : 's'}`,
    riesgo: 'bajo',
    fechaSugerida: null,
    btnLabel: '+ Gestión',
    btnColor: '#6b7280',
  }
}

function ProximoPasoSection({ rec, onPrimaryAction }: { rec: NextStepRec; onPrimaryAction: () => void }) {
  const riesgoColor = rec.riesgo === 'alto' ? '#dc2626' : rec.riesgo === 'medio' ? '#f59e0b' : '#10b981'
  const riesgoLabel = rec.riesgo === 'alto' ? 'Riesgo alto' : rec.riesgo === 'medio' ? 'Riesgo medio' : 'Bajo riesgo'
  const riesgoIcon = rec.riesgo === 'alto' ? '🔴' : rec.riesgo === 'medio' ? '🟡' : '🟢'
  return (
    <div style={{ padding: '0.7rem 1.25rem', background: riesgoColor + '08', borderBottom: `2px solid ${riesgoColor}30` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>Próximo paso recomendado</span>
            <span style={{ padding: '0.08rem 0.4rem', borderRadius: '999px', fontSize: '0.62rem', fontWeight: 700, background: riesgoColor + '20', color: riesgoColor }}>
              {riesgoIcon} {riesgoLabel}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.3 }}>{rec.action}</p>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{rec.motivo}</p>
          {rec.fechaSugerida && (
            <p style={{ margin: '0.1rem 0 0', fontSize: '0.72rem', color: riesgoColor, fontWeight: 600 }}>
              📅 Fecha sugerida: {fmtFecha(rec.fechaSugerida)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onPrimaryAction}
          style={{ padding: '0.45rem 1rem', borderRadius: '0.5rem', border: 'none', background: rec.btnColor, color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, boxShadow: `0 2px 8px ${rec.btnColor}44` }}
        >
          {rec.btnLabel}
        </button>
      </div>
    </div>
  )
}

// ── Case Detail Panel ─────────────────────────────────────────────────────────

type DetailTab = 'historial' | 'estado_cuenta' | 'gestiones' | 'ptps' | 'pagos' | 'plan'

type CaseDetailProps = {
  caso: Case
  orgId: string
  role: GestionRole
  currentUserId: string | null
  usersById: Record<string, { nombre_completo?: string; email?: string } | undefined>
  onCaseUpdated: () => void
}

function formatGestionTipo(tipo: GestionDraft['tipo']) {
  const map: Record<GestionDraft['tipo'], string> = {
    llamada: 'Llamada',
    whatsapp: 'WhatsApp',
    nota: 'Nota',
    seguimiento: 'Seguimiento',
    visita: 'Visita',
    email: 'Email',
    cita_completada: 'Cita completada',
    venta: 'Venta',
    referidos: 'Referidos',
    envio_material: 'Envío de material',
  }
  return map[tipo] ?? tipo
}

function CaseDetail({ caso, orgId, role, currentUserId, usersById, onCaseUpdated }: CaseDetailProps) {
  const { openEmail, openWhatsapp, openSms } = useMessaging()
  const [tab, setTab] = useState<DetailTab>('historial')
  const [gestiones, setGestiones] = useState<Gestion[]>([])
  const [ptps, setPtps] = useState<PTP[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [planes, setPlanes] = useState<Plan[]>([])
  const [dfpAccount, setDfpAccount] = useState<DfpAccount | null>(null)
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [ptpOpen, setPtpOpen] = useState(false)
  const [pagoOpen, setPagoOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [gestionOpen, setGestionOpen] = useState(false)
  const [capturarMontoOpen, setCapturarMontoOpen] = useState(false)
  const [cierreOpen, setCierreOpen] = useState(false)
  const [cierreNota, setCierreNota] = useState('')
  const [cerrando, setCerrando] = useState(false)
  const detailLoadSeq = useRef(0)

  const loadDetail = async () => {
    const loadSeq = detailLoadSeq.current + 1
    detailLoadSeq.current = loadSeq
    setLoading(true)
    setDfpAccount(null)
    setLedgerEntries([])
    const [g, p, pg, pl, dfp] = await Promise.all([
      supabase.from('cob_gestiones').select('id,tipo_gestion,resultado,monto_comprometido,fecha_compromiso,notas,gestionado_por,created_at').eq('case_id', caso.id).order('created_at', { ascending: false }),
      supabase.from('cob_ptps').select('id,monto,fecha_compromiso,estado,canal,notas,creado_por,fecha_cumplimiento,cumplido_at,incumplido_at,created_at').eq('case_id', caso.id).order('created_at', { ascending: false }),
      supabase.from('cob_pagos').select('id,monto,fecha_pago,metodo_pago,referencia_externa,comprobante_url,estado,source,notas,created_by,ptp_id,created_at').eq('cargo_vuelta_case_id', caso.id).order('fecha_pago', { ascending: false }),
      supabase.from('cob_plan_pagos').select('id,monto_total,numero_cuotas,estado,tipo_plan,balance_inicial,tasa_anual_pct,monto_cuota,fecha_primer_pago,metodo_pago_id,notas,created_at').or(`case_id.eq.${caso.id},cargo_vuelta_case_id.eq.${caso.id}`).order('created_at', { ascending: false }),
      supabase
        .from('cob_revolving_accounts')
        .select('id,case_id,cliente_id,apr_anual,fecha_inicio,fecha_ultimo_devengo,saldo_principal_inicial,saldo_principal_actual,saldo_interes_actual,saldo_fees_actual,saldo_total_actual,estado')
        .eq('case_id', caso.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (loadSeq !== detailLoadSeq.current) return
    setGestiones((g.data ?? []) as Gestion[])
    setPtps((p.data ?? []) as PTP[])
    setPagos((pg.data ?? []) as Pago[])
    const loadedDfpAccount = (dfp.data ?? null) as DfpAccount | null
    setDfpAccount(loadedDfpAccount)

    // load cuotas for each plan
    const rawPlanes = (pl.data ?? []) as Omit<Plan, 'cuotas'>[]
    if (rawPlanes.length > 0) {
      const planIds = rawPlanes.map(rp => rp.id)
      const planIdsCsv = planIds.join(',')
      const { data: cuotasData } = await supabase
        .from('cob_plan_cuotas')
        .select('id,plan_id,plan_pago_id,numero_cuota,monto,monto_programado,principal_programado,interes_programado,fees_programados,monto_pagado,saldo_cuota,fecha_vencimiento,fecha_pago,pago_id,cob_pago_id,paid_at,estado,cargo_vuelta_case_id,cliente_id')
        .or(`cargo_vuelta_case_id.eq.${caso.id},plan_id.in.(${planIdsCsv}),plan_pago_id.in.(${planIdsCsv})`)
        .order('numero_cuota')
      if (loadSeq !== detailLoadSeq.current) return
      const cuotasByPlan: Record<string, Cuota[]> = {}
      for (const c of (cuotasData ?? []) as (Cuota & { plan_id?: string; plan_pago_id?: string })[]) {
        const ownerPlanId = c.plan_pago_id ?? c.plan_id
        if (!ownerPlanId) continue
        if (!cuotasByPlan[ownerPlanId]) cuotasByPlan[ownerPlanId] = []
        cuotasByPlan[ownerPlanId].push(c)
      }
      setPlanes(rawPlanes.map(rp => ({ ...rp, cuotas: cuotasByPlan[rp.id] ?? [] })))
    } else {
      setPlanes([])
    }

    if (loadedDfpAccount) {
      const { data: ledgerData } = await supabase
        .from('cob_financial_ledger')
        .select('id,revolving_account_id,case_id,entry_date,effective_date,entry_type,component_type,debit_credit,amount,description,balance_principal_after,balance_interest_after,balance_fees_after,balance_total_after,created_at')
        .eq('revolving_account_id', loadedDfpAccount.id)
        .eq('case_id', caso.id)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100)
      if (loadSeq !== detailLoadSeq.current) return
      setLedgerEntries((ledgerData ?? []) as LedgerEntry[])
    } else {
      setLedgerEntries([])
    }
    setLoading(false)
  }

  useEffect(() => { void loadDetail() }, [caso.id])

  const handleRefresh = () => { void loadDetail(); onCaseUpdated() }

  const handleCerrarCaso = async () => {
    setCerrando(true)
    const { error } = await supabase.rpc('fn_cerrar_cargo_vuelta_case', {
      p_case_id: caso.id,
      p_nota: cierreNota.trim() || null,
    })
    setCerrando(false)
    setCierreOpen(false)
    setCierreNota('')
    if (error) {
      alert(`Error al cerrar el caso: ${error.message}`)
    } else {
      handleRefresh()
    }
  }

  const handleGestionSubmit = async (draft: GestionDraft) => {
    if (!currentUserId) throw new Error('No se pudo identificar el usuario actual.')

    const montoComprometido = draft.montoPrometido.trim() ? parseFloat(draft.montoPrometido) : null
    const notas = draft.contenido.trim() || draft.resumen.trim() || null
    const resultado = draft.resultado ?? (draft.resumen.trim() || null)

    const { data: gestionData, error: gestionError } = await supabase.from('cob_gestiones').insert({
      org_id: orgId,
      cliente_id: caso.cliente_id,
      case_id: caso.id,
      tipo_gestion: formatGestionTipo(draft.tipo),
      resultado,
      monto_comprometido: Number.isFinite(montoComprometido ?? NaN) ? montoComprometido : null,
      fecha_compromiso: draft.followupAt || null,
      notas,
      gestionado_por: currentUserId,
    }).select('id').single()

    if (gestionError) throw gestionError
    if (!gestionData?.id) throw new Error('No se pudo crear la gestión.')

    if (draft.resultado === 'promesa_pago' && Number.isFinite(montoComprometido ?? NaN) && montoComprometido && draft.followupAt) {
      const canal = draft.canal === 'telefono' || draft.canal === 'whatsapp' || draft.canal === 'email' || draft.canal === 'presencial'
        ? draft.canal
        : draft.canal === 'sistema'
          ? 'otro'
          : 'otro'

      const { data: ptpData, error: ptpError } = await supabase
        .from('cob_ptps')
        .insert({
          org_id: orgId,
          cliente_id: caso.cliente_id,
          case_id: caso.id,
          gestion_id: gestionData.id,
          monto: montoComprometido,
          fecha_compromiso: draft.followupAt,
          estado: 'pendiente',
          canal,
          notas: notas ?? null,
          creado_por: currentUserId,
        })
        .select('id')
        .single()
      if (ptpError) throw ptpError

      if (ptpData?.id) {
        const { error: vinculoError } = await supabase.from('cob_gestiones').update({ ptp_id: ptpData.id }).eq('id', gestionData.id)
        if (vinculoError) throw vinculoError
      }
    }

    const { error: actividadError } = await supabase.from('contacto_actividades').insert({
      contacto_tipo: 'cliente',
      contacto_id: caso.cliente_id,
      tipo: draft.tipo,
      resumen: draft.resumen.trim() || `Gestión de cobranza: ${formatGestionTipo(draft.tipo)}`,
      contenido: draft.contenido.trim() || null,
      metadata: {
        resultado: draft.resultado,
        followup_at: draft.followupAt || null,
        monto_prometido: Number.isFinite(montoComprometido ?? NaN) ? montoComprometido : null,
        source: 'cartera',
        case_id: caso.id,
        modulo_origen: draft.moduloOrigen ?? 'cartera',
        origen_id: draft.origenId ?? caso.id,
      },
      autor_id: currentUserId,
      fecha_actividad: new Date().toISOString(),
    })

    if (actividadError) throw actividadError

    handleRefresh()
    setGestionOpen(false)
  }

  const totalPagado = useMemo(() => pagos.filter(p => p.estado !== 'reversado' && p.estado !== 'rechazado').reduce((s, p) => s + p.monto, 0), [pagos])
  const nextStepRec = useMemo(() => computeNextStep(caso, gestiones, ptps), [caso, gestiones, ptps])
  const handleNextStepAction = () => { setGestionOpen(true) }
  const safeDfpAccount = dfpAccount?.case_id === caso.id ? dfpAccount : null
  const isDfp = Boolean(safeDfpAccount)
  const saldoBase = caso.monto_devuelto ?? caso.monto_total
  const saldo = safeDfpAccount ? safeDfpAccount.saldo_total_actual : saldoBase - totalPagado
  const cliente = caso.clientes
  const contactName = nombreCliente(cliente)
  const cartaContact = useMemo<MessagingContact>(() => ({
    nombre: contactName,
    telefono: cliente?.telefono ?? null,
    email: cliente?.email ?? null,
    cuentaHycite: cliente?.hycite_id ?? '',
    saldoActual: cliente?.saldo_actual ?? 0,
    montoCargoVuelta: caso.monto_devuelto ?? caso.monto_total ?? 0,
    saldoOperativo: saldo,
    fechaCargoVuelta: caso.fecha_cargo_vuelta ?? '',
    diasAtraso: caso.dias_vencido,
    clienteId: caso.cliente_id,
  }), [caso.cliente_id, caso.dias_vencido, caso.fecha_cargo_vuelta, caso.monto_devuelto, caso.monto_total, cliente?.email, cliente?.hycite_id, cliente?.saldo_actual, cliente?.telefono, contactName, saldo])

  const openCarta = (channel: MessagingChannel) => {
    const contact = { ...cartaContact }
    const montoCarta = contact.montoCargoVuelta ?? contact.saldoOperativo ?? 0
    if (montoCarta <= 0) {
      window.alert('Primero captura el Monto cargo de vuelta antes de enviar la carta.')
      return
    }
    contact.montoCargoVuelta = montoCarta
    if (channel === 'email') {
      const email = window.prompt('Email del cliente para enviar la carta:', contact.email ?? '')
      if (!email) return
      contact.email = email.trim()
      openEmail(contact, 'sys_email_cartera.cargo_vuelta_oficina_local', 'cobranza', ['patrospi@hotmail.com'])
      return
    }
    if (!contact.telefono) {
      window.alert('Este cliente no tiene teléfono registrado.')
      return
    }
    if (channel === 'whatsapp') openWhatsapp(contact, 'sys_cartera.cargo_vuelta_oficina_local', 'cobranza')
    else openSms(contact, 'sys_cartera.cargo_vuelta_oficina_local', 'cobranza')
  }

  const gestionContacto: GestionContactoRef = {
    tipo: 'cliente',
    id: caso.cliente_id,
    nombre: nombreCliente(cliente),
    telefono: cliente?.telefono ?? null,
    subtitle: caso.acuerdo_tipo ? `Financiamiento del Distribuidor · ${caso.acuerdo_tipo}` : 'Financiamiento del Distribuidor',
  }
  const chips = [
    { label: `${caso.dias_vencido}d vencido`, color: diasColor(caso.dias_vencido) },
    { label: caso.estado, color: estadoColor(caso.estado) },
  ]
  if (caso.acuerdo_tipo) chips.push({ label: caso.acuerdo_tipo, color: '#7c3aed' })

  const TABS: { key: DetailTab; label: string }[] = [
    { key: 'historial', label: 'Historial' },
    { key: 'estado_cuenta', label: 'Estado de cuenta' },
    { key: 'gestiones', label: `Gestiones (${gestiones.length})` },
    { key: 'ptps', label: `PTPs (${ptps.length})` },
    { key: 'pagos', label: `Pagos (${pagos.length})` },
    { key: 'plan', label: `Plan (${planes.length})` },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.25rem 0.75rem', borderBottom: '1px solid var(--color-border)' }}>
        <p style={{ margin: '0 0 0.4rem', fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>
          {caso.en_proceso_legal && <span title="En proceso legal" style={{ marginRight: '0.4rem' }}>⚖️</span>}
          {nombreCliente(cliente)}
          {cliente?.hycite_id && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>#{cliente.hycite_id}</span>}
        </p>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          {chips.map(ch => (
            <span key={ch.label} style={{ padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, background: ch.color + '22', color: ch.color, border: `1px solid ${ch.color}44` }}>{ch.label}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
          {/* Saldo Hy-Cite siempre como referencia */}
          {cliente?.saldo_actual !== undefined && cliente?.saldo_actual !== null && (
            <span style={{ opacity: 0.65 }}>
              Saldo Hy-Cite (ref.): <strong style={{ color: 'var(--color-text-muted)' }}>{fmtMonto(cliente.saldo_actual)}</strong>
            </span>
          )}
          {/* Monto cargo de vuelta */}
          {caso.monto_devuelto !== null && caso.monto_devuelto !== undefined && caso.monto_devuelto > 0 ? (
            <span>Monto cargo de vuelta: <strong style={{ color: 'var(--color-text)' }}>{fmtMonto(caso.monto_devuelto)}</strong></span>
          ) : (
            <span style={{ color: '#d97706', fontWeight: 700 }}>⚠ Monto cargo de vuelta: pendiente de capturar</span>
          )}
          {!isDfp && <span>Pagado: <strong style={{ color: '#10b981' }}>{fmtMonto(totalPagado)}</strong></span>}
          <span>Saldo operativo: <strong style={{ color: saldo > 0 ? '#f87171' : '#10b981' }}>{fmtMonto(saldo)}</strong></span>
        </div>
        {/* Plan activo — resumen compacto */}
        {(() => {
          const planActivo = planes.find(p => p.estado === 'activo')
          if (!planActivo) return null
          const cuotasPendientes = planActivo.cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'vencida')
          const proxima = cuotasPendientes.sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0]
          const hayVencidas = cuotasPendientes.some(c => c.estado === 'vencida')
          const cuotasPagadas = planActivo.cuotas.filter(c => c.estado === 'pagada').length
          const total = planActivo.numero_cuotas
          return (
            <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.75rem' }}>
              <span style={{ padding: '0.1rem 0.45rem', borderRadius: '999px', fontWeight: 700, fontSize: '0.68rem', background: hayVencidas ? '#dc262622' : '#7c3aed22', color: hayVencidas ? '#dc2626' : '#7c3aed', border: `1px solid ${hayVencidas ? '#dc262644' : '#7c3aed44'}` }}>
                Plan activo
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {cuotasPagadas}/{total} cuotas pagadas
              </span>
              {proxima && (
                <span style={{ color: hayVencidas ? '#dc2626' : 'var(--color-text-muted)' }}>
                  · próxima: <strong style={{ color: hayVencidas ? '#dc2626' : 'var(--color-text)' }}>{fmtFecha(proxima.fecha_vencimiento)} · {fmtMonto(proxima.monto)}</strong>
                  {proxima.estado === 'vencida' && <span style={{ marginLeft: '0.3rem', fontWeight: 700, color: '#dc2626' }}>VENCIDA</span>}
                </span>
              )}
              {cuotasPendientes.length === 0 && (
                <span style={{ color: '#10b981', fontWeight: 600 }}>· Todas las cuotas pagadas</span>
              )}
            </div>
          )
        })()}
        {safeDfpAccount && <DfpSummary account={safeDfpAccount} />}
      </div>

      {/* Próximo paso recomendado */}
      {!loading && <ProximoPasoSection rec={nextStepRec} onPrimaryAction={handleNextStepAction} />}

      {/* CTA pendiente de monto */}
      {(caso.monto_devuelto === null || caso.monto_devuelto === undefined || caso.monto_devuelto === 0) && (
        <div style={{ padding: '0.55rem 1.25rem', background: 'rgba(217,119,6,0.08)', borderBottom: '1px solid rgba(217,119,6,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.78rem', color: '#d97706', fontWeight: 600 }}>
            ⚠ Monto cargo de vuelta pendiente — Hy-Cite reportó saldo 0 pero el cliente puede deber.
          </span>
          <button type="button" onClick={() => setCapturarMontoOpen(true)}
            style={{ padding: '0.25rem 0.75rem', borderRadius: '0.4rem', border: '1px solid rgba(217,119,6,0.5)', background: 'rgba(217,119,6,0.12)', color: '#d97706', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
            Capturar monto
          </button>
        </div>
      )}

      {/* Action bar — grouped */}
      <div style={{ padding: '0.5rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Registrar */}
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Registrar</span>
          <ActionBtn label="Llamada" color="#3b82f6" onClick={() => setGestionOpen(true)} />
          <ActionBtn label="PTP" color="#f59e0b" onClick={() => setPtpOpen(true)} />
          <ActionBtn label="Pago" color="#10b981" onClick={() => setPagoOpen(true)} disabled={loading} />
          <ActionBtn label="Refinanciar" color="#7c3aed" onClick={() => setPlanOpen(true)} />
        </div>
        <div style={{ width: '1px', background: 'var(--color-border)', alignSelf: 'stretch', flexShrink: 0 }} />
        {/* Enviar */}
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Enviar carta</span>
          <ActionBtn label="Email" color="#2563eb" onClick={() => openCarta('email')} />
          <ActionBtn label="WhatsApp" color="#16a34a" onClick={() => openCarta('whatsapp')} disabled={!cliente?.telefono} />
          <ActionBtn label="SMS" color="#6b7280" onClick={() => openCarta('sms')} disabled={!cliente?.telefono} />
        </div>
        <div style={{ width: '1px', background: 'var(--color-border)', alignSelf: 'stretch', flexShrink: 0 }} />
        {/* Escalar */}
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Escalar</span>
          <ActionBtn label="↩ Cargo vuelta" color="#7c3aed" onClick={() => setCapturarMontoOpen(true)} />
          <ActionBtn
            label={caso.en_proceso_legal ? '⚖️ Legal activo' : '⚖️ Legal'}
            color={caso.en_proceso_legal ? '#dc2626' : '#6b7280'}
            onClick={async () => {
              await supabase.from('cargo_vuelta_cases').update({ en_proceso_legal: !caso.en_proceso_legal }).eq('id', caso.id)
              onCaseUpdated()
            }}
          />
        </div>
        {caso.estado !== 'Cerrado' && (
          <>
            <div style={{ width: '1px', background: 'var(--color-border)', alignSelf: 'stretch', flexShrink: 0 }} />
            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Cerrar</span>
              <ActionBtn label="✓ Pago recibido" color="#059669" onClick={() => setCierreOpen(true)} />
            </div>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{ padding: '0 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '0', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ padding: '0.55rem 0.9rem', border: 'none', borderBottom: tab === t.key ? '2px solid #3b82f6' : '2px solid transparent', background: 'transparent', color: tab === t.key ? '#3b82f6' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Cargando…</p>
        ) : tab === 'historial' ? (
          <HistorialList events={buildHistorial(gestiones, ptps, pagos, caso)} usersById={usersById} />
        ) : tab === 'estado_cuenta' ? (
          <EstadoCuentaList account={safeDfpAccount} entries={ledgerEntries} />
        ) : tab === 'gestiones' ? (
          <GestionesList gestiones={gestiones} usersById={usersById} />
        ) : tab === 'ptps' ? (
          <PTPsList ptps={ptps} usersById={usersById} onRefresh={handleRefresh} currentUserId={currentUserId} />
        ) : tab === 'pagos' ? (
          <PagosList pagos={pagos} usersById={usersById} />
        ) : (
          <PlanesList planes={planes} />
        )}
      </div>

      {/* Modals */}
      <RegistrarGestionModal
        open={gestionOpen}
        role={role}
        onClose={() => setGestionOpen(false)}
        onSubmit={handleGestionSubmit}
        contacto={gestionContacto}
        tipoDefault="llamada"
        moduloOrigen="cartera"
        origenId={caso.id}
      />
      <PTPModal open={ptpOpen} caseId={caso.id} clienteId={caso.cliente_id} orgId={orgId} currentUserId={currentUserId} onClose={() => setPtpOpen(false)} onSaved={handleRefresh} />
      <PagoModal open={pagoOpen} caseId={caso.id} clienteId={caso.cliente_id} orgId={orgId} currentUserId={currentUserId} ptps={ptps} onClose={() => setPagoOpen(false)} onSaved={handleRefresh} />
      <PlanModal open={planOpen} caseId={caso.id} clienteId={caso.cliente_id} orgId={orgId} currentUserId={currentUserId} onClose={() => setPlanOpen(false)} onSaved={handleRefresh} />
      <CapturarMontoModal open={capturarMontoOpen} caseId={caso.id} clienteId={caso.cliente_id} orgId={orgId} saldoHycite={caso.clientes?.saldo_actual ?? null} onClose={() => setCapturarMontoOpen(false)} onSaved={handleRefresh} />

      {/* Confirmación cierre de caso */}
      {cierreOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--color-bg)', borderRadius: '0.75rem', padding: '1.5rem', width: '100%', maxWidth: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 700 }}>Cerrar caso</h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              Este botón <strong>no registra un pago financiero</strong>. Solo cerrará el caso porque el pago ya fue confirmado externamente.
            </p>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>Nota (opcional)</label>
            <textarea
              value={cierreNota}
              onChange={e => setCierreNota(e.target.value)}
              placeholder="Ej: Cliente pagó el 2026-05-05 según confirmación del distribuidor"
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', fontSize: '0.82rem', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" onClick={() => { setCierreOpen(false); setCierreNota('') }} disabled={cerrando}
                style={{ padding: '0.4rem 1rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: '0.82rem' }}>
                Cancelar
              </button>
              <button type="button" onClick={handleCerrarCaso} disabled={cerrando}
                style={{ padding: '0.4rem 1rem', borderRadius: '0.4rem', border: 'none', background: '#059669', color: '#fff', cursor: cerrando ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: 700, opacity: cerrando ? 0.7 : 1 }}>
                {cerrando ? 'Cerrando…' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionBtn({ label, color, onClick, disabled = false }: { label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ padding: '0.35rem 0.85rem', borderRadius: '0.4rem', border: `1px solid ${color}66`, background: color + '18', color, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.78rem', fontWeight: 700, opacity: disabled ? 0.55 : 1 }}>
      {label}
    </button>
  )
}

function DfpSummary({ account }: { account: DfpAccount }) {
  const aprPct = (account.apr_anual * 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })
  return (
    <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
      <DfpMetric label="Principal" value={fmtMonto(account.saldo_principal_actual)} color="#2563eb" />
      <DfpMetric label="Interés" value={fmtMonto(account.saldo_interes_actual)} color="#d97706" />
      <DfpMetric label="Fees" value={fmtMonto(account.saldo_fees_actual)} color="#dc2626" />
      <DfpMetric label="Saldo total" value={fmtMonto(account.saldo_total_actual)} color="#0f766e" />
      <DfpMetric label="Último devengo" value={fmtFecha(account.fecha_ultimo_devengo)} color="#6b7280" />
      <DfpMetric label="APR" value={`${aprPct}%`} color="#7c3aed" />
    </div>
  )
}

function DfpMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: '0.5rem 0.6rem', borderRadius: '0.45rem', border: `1px solid ${color}33`, background: color + '0d', minWidth: 0 }}>
      <p style={{ margin: '0 0 0.15rem', fontSize: '0.66rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 800, color, overflowWrap: 'anywhere' }}>{value}</p>
    </div>
  )
}

// ── Gestiones list ────────────────────────────────────────────────────────────

function GestionesList({ gestiones, usersById }: { gestiones: Gestion[]; usersById: Record<string, { nombre_completo?: string } | undefined> }) {
  if (gestiones.length === 0) return <Empty label="No hay gestiones vinculadas a este caso" icon="📞" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {gestiones.map(g => (
        <div key={g.id} style={{ padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>{g.tipo_gestion}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{fmtFecha(g.created_at)}</span>
          </div>
          {g.resultado && <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{g.resultado}</p>}
          {g.monto_comprometido && <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: '#f59e0b' }}>Prometido: {fmtMonto(g.monto_comprometido)}{g.fecha_compromiso ? ` · ${fmtFecha(g.fecha_compromiso)}` : ''}</p>}
          {g.notas && <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{g.notas}</p>}
          {g.gestionado_por && <p style={{ margin: '0.2rem 0 0', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{usersById[g.gestionado_por]?.nombre_completo ?? g.gestionado_por.slice(0, 8)}</p>}
        </div>
      ))}
    </div>
  )
}

// ── PTPs list ─────────────────────────────────────────────────────────────────

function PTPsList({
  ptps,
  onRefresh,
  currentUserId,
}: {
  ptps: PTP[]
  usersById?: Record<string, { nombre_completo?: string } | undefined>
  onRefresh: () => void
  currentUserId: string | null
}) {
  const [ptpError, setPtpError] = useState<string | null>(null)

  const handlePtpUpdate = async (id: string, payload: Record<string, unknown>) => {
    setPtpError(null)
    const { count, error } = await supabase
      .from('cob_ptps')
      .update(payload, { count: 'exact' })
      .eq('id', id)
      .in('estado', ['pendiente', 'renegociada'])
    if (error) { setPtpError(error.message); return }
    if (count === 0) { setPtpError('Esta promesa ya cambió de estado. Recarga el caso.'); return }
    onRefresh()
  }

  if (ptps.length === 0) return <Empty label="No hay promesas de pago para este caso" icon="🤝" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {ptpError && <p style={{ color: '#f87171', fontSize: '0.78rem', margin: '0 0 0.25rem' }}>{ptpError}</p>}
      {ptps.map(p => {
        const color = ptpEstadoColor(p.estado)
        return (
          <div key={p.id} style={{ padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${color}44`, background: color + '0d' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>{fmtMonto(p.monto)}</span>
              <span style={{ padding: '0.12rem 0.45rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 700, background: color + '22', color }}>{p.estado}</span>
            </div>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Vence: {fmtFecha(p.fecha_compromiso)}
              {p.canal ? ` · canal ${p.canal}` : ''}
            </p>
            {p.notas && <p style={{ margin: '0.2rem 0 0', fontSize: '0.73rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{p.notas}</p>}
            {p.fecha_cumplimiento && <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: '#10b981' }}>Fecha cumplimiento: {fmtFecha(p.fecha_cumplimiento)}</p>}
            {(p.estado === 'pendiente' || p.estado === 'renegociada') && (
              <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.4rem' }}>
                <SmallBtn label="Cumplido" color="#10b981" onClick={() => handlePtpUpdate(p.id, { estado: 'cumplido', fecha_cumplimiento: todayYmd(), cumplido_at: new Date().toISOString(), incumplido_at: null, updated_by: currentUserId })} />
                <SmallBtn label="Incumplido" color="#ea580c" onClick={() => handlePtpUpdate(p.id, { estado: 'incumplido', fecha_cumplimiento: null, cumplido_at: null, incumplido_at: new Date().toISOString(), updated_by: currentUserId })} />
                <SmallBtn label="Cancelar" color="#6b7280" onClick={() => handlePtpUpdate(p.id, { estado: 'cancelado', fecha_cumplimiento: null, cumplido_at: null, incumplido_at: null, updated_by: currentUserId })} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SmallBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: '0.2rem 0.6rem', borderRadius: '0.35rem', border: `1px solid ${color}55`, background: color + '18', color, cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>
      {label}
    </button>
  )
}

// ── Pagos list ────────────────────────────────────────────────────────────────

function PagosList({ pagos }: { pagos: Pago[]; usersById: Record<string, { nombre_completo?: string } | undefined> }) {
  if (pagos.length === 0) return <Empty label="No hay pagos registrados para este caso" icon="💳" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {pagos.map(p => (
        <div key={p.id} style={{ padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #10b98133', background: '#10b9810d' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981' }}>{fmtMonto(p.monto)}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{fmtFecha(p.fecha_pago)}</span>
          </div>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.73rem', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
            {p.metodo_pago ?? 'otro'}
            {p.referencia_externa ? ` · ${p.referencia_externa}` : ''}
            {p.ptp_id ? ' · vinculado a PTP' : ''}
          </p>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.71rem', color: 'var(--color-text-muted)' }}>
            Estado: {p.estado} · Source: {p.source}
          </p>
          {p.comprobante_url && <p style={{ margin: '0.2rem 0 0', fontSize: '0.71rem' }}><a href={p.comprobante_url} target="_blank" rel="noreferrer">Ver comprobante</a></p>}
          {p.notas && <p style={{ margin: '0.2rem 0 0', fontSize: '0.73rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{p.notas}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Planes list ───────────────────────────────────────────────────────────────

function PlanesList({ planes }: { planes: Plan[] }) {
  if (planes.length === 0) return <Empty label="No hay planes de pago para este caso" icon="📅" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {planes.map(plan => {
        const pagadas = plan.cuotas.filter(c => c.estado === 'pagada').length
        const color = plan.estado === 'completado' ? '#10b981' : plan.estado === 'cancelado' ? '#6b7280' : '#7c3aed'
        return (
          <div key={plan.id} style={{ borderRadius: '0.5rem', border: `1px solid ${color}44`, overflow: 'hidden' }}>
            <div style={{ padding: '0.65rem 0.75rem', background: color + '0d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>{fmtMonto(plan.monto_total)}</span>
                <span style={{ fontSize: '0.73rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>{pagadas}/{plan.numero_cuotas} cuotas pagadas</span>
              </div>
              <span style={{ padding: '0.12rem 0.45rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 700, background: color + '22', color }}>{plan.estado}</span>
            </div>
            <div style={{ padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {plan.cuotas.map(c => {
                const cc = c.estado === 'pagada' ? '#10b981' : c.estado === 'vencida' ? '#dc2626' : c.estado === 'cancelada' ? '#6b7280' : '#6b7280'
                return (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Cuota {c.numero_cuota}</span>
                    <span style={{ color: 'var(--color-text)' }}>{fmtMonto(c.monto)}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>{fmtFecha(c.fecha_vencimiento)}</span>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: '999px', fontSize: '0.67rem', fontWeight: 700, background: cc + '22', color: cc }}>{c.estado}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function lastCompleteMonth(): { inicio: string; fin: string } {
  const now = new Date()
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const m = now.getMonth() === 0 ? 12 : now.getMonth()
  const lastDay = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  return {
    inicio: `${y}-${mm}-01`,
    fin: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}

function GenerarStatementButton({ account }: { account: DfpAccount }) {
  const defaults = lastCompleteMonth()
  const [open, setOpen] = useState(false)
  const [periodoInicio, setPeriodoInicio] = useState(defaults.inicio)
  const [periodoFin, setPeriodoFin] = useState(defaults.fin)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)

  function handleOpen() {
    setOpen(true)
    setError(null)
    setSuccessId(null)
  }

  async function handleGenerar() {
    setLoading(true)
    setError(null)
    setSuccessId(null)
    const { data, error: rpcErr } = await supabase.rpc('fn_cob_statement_generar', {
      p_revolving_account_id: account.id,
      p_periodo_inicio: periodoInicio,
      p_periodo_fin: periodoFin,
      p_fecha_corte: periodoFin,
    })
    setLoading(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setSuccessId(data as string)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, borderRadius: '0.4rem', border: '1px solid #2563eb44', background: '#2563eb18', color: '#2563eb', cursor: 'pointer' }}
      >
        Generar statement
      </button>
    )
  }

  return (
    <div style={{ padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-card)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text)' }}>Generar estado de cuenta</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div>
          <label style={LABEL_STYLE}>Período inicio</label>
          <input
            type="date"
            value={periodoInicio}
            onChange={e => setPeriodoInicio(e.target.value)}
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Período fin (= fecha corte)</label>
          <input
            type="date"
            value={periodoFin}
            onChange={e => setPeriodoFin(e.target.value)}
            style={INPUT_STYLE}
          />
        </div>
      </div>
      {error && (
        <p style={{ margin: 0, fontSize: '0.72rem', color: '#dc2626', fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {error}
        </p>
      )}
      {successId && (
        <p style={{ margin: 0, fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>
          Statement generado: {successId}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={handleGenerar}
          disabled={loading}
          style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, borderRadius: '0.4rem', border: '1px solid #2563eb44', background: '#2563eb', color: '#fff', cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Generando...' : 'Confirmar'}
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

function EstadoCuentaList({ account, entries }: { account: DfpAccount | null; entries: LedgerEntry[] }) {
  if (!account) {
    return <Empty label="Este caso todavía no tiene cuenta DFP/revolving asociada" />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ padding: '0.7rem 0.85rem', borderRadius: '0.5rem', border: '1px solid #0f766e33', background: '#0f766e0d' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
          <GenerarStatementButton account={account} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
          <DfpMetric label="Principal" value={fmtMonto(account.saldo_principal_actual)} color="#2563eb" />
          <DfpMetric label="Interés" value={fmtMonto(account.saldo_interes_actual)} color="#d97706" />
          <DfpMetric label="Fees" value={fmtMonto(account.saldo_fees_actual)} color="#dc2626" />
          <DfpMetric label="Total" value={fmtMonto(account.saldo_total_actual)} color="#0f766e" />
        </div>
      </div>
      {entries.length === 0 ? (
        <Empty label="La cuenta DFP no tiene movimientos de ledger visibles" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {entries.map(entry => {
            const isCredit = entry.debit_credit === 'credit'
            const color = isCredit ? '#10b981' : '#ef4444'
            return (
              <div key={entry.id} style={{ padding: '0.65rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${color}33`, background: color + '0a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: 'var(--color-text)' }}>
                      {formatLedgerType(entry.entry_type)} · {formatLedgerComponent(entry.component_type)}
                    </p>
                    <p style={{ margin: '0.18rem 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                      {fmtFecha(entry.effective_date)} · {isCredit ? 'Crédito' : 'Cargo'}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color, flexShrink: 0 }}>
                    {isCredit ? '-' : '+'}{fmtMonto(entry.amount)}
                  </span>
                </div>
                {entry.description && <p style={{ margin: '0.35rem 0 0', fontSize: '0.73rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{entry.description}</p>}
                {entry.balance_total_after !== null && (
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                    Saldo después: <strong style={{ color: 'var(--color-text)' }}>{fmtMonto(entry.balance_total_after)}</strong>
                    {entry.balance_principal_after !== null && ` · Principal ${fmtMonto(entry.balance_principal_after)}`}
                    {entry.balance_interest_after !== null && ` · Interés ${fmtMonto(entry.balance_interest_after)}`}
                    {entry.balance_fees_after !== null && ` · Fees ${fmtMonto(entry.balance_fees_after)}`}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatLedgerType(type: string) {
  const map: Record<string, string> = {
    principal_initial: 'Principal inicial',
    finance_charge_accrual: 'Interés devengado',
    late_fee_assessed: 'Late fee',
    payment_applied: 'Pago aplicado',
    adjustment: 'Ajuste',
    writeoff: 'Write-off',
    reversal: 'Reverso',
  }
  return map[type] ?? type
}

function formatLedgerComponent(component: string) {
  const map: Record<string, string> = {
    principal: 'Principal',
    interest: 'Interés',
    fee: 'Fee',
  }
  return map[component] ?? component
}

function Empty({ label, icon = '📭' }: { label: string; icon?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
      <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>{icon}</div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>{label}</p>
    </div>
  )
}

// ── Historial list ────────────────────────────────────────────────────────────

function HistorialList({ events, usersById }: { events: HistorialEvent[]; usersById: Record<string, { nombre_completo?: string } | undefined> }) {
  if (events.length === 0) return <Empty label="Sin eventos registrados en este caso" icon="📋" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {events.map((ev, idx) => {
        const color = historialColor(ev.tipo)
        const isLast = idx === events.length - 1
        const TIPO_ICON: Record<HistorialEvent['tipo'], string> = { apertura: '🗂', gestion: '📞', ptp: '🤝', pago: '💳', cierre: '✅' }
        return (
          <div key={ev.id} style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start', paddingBottom: isLast ? 0 : '0.65rem' }}>
            {/* Timeline track */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: '0.25rem', width: '20px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: color, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.55rem' }}>
              </div>
              {!isLast && <div style={{ width: '2px', flex: 1, minHeight: '16px', background: `linear-gradient(to bottom, ${color}66, var(--color-border))`, marginTop: '2px' }} />}
            </div>
            {/* Event card */}
            <div style={{ flex: 1, padding: '0.5rem 0.65rem', borderRadius: '0.45rem', border: `1px solid ${color}33`, background: color + '0a', marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text)' }}>
                  <span style={{ marginRight: '0.3rem' }}>{TIPO_ICON[ev.tipo]}</span>{ev.label}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{fmtFecha(ev.timestamp)}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.2rem', alignItems: 'center' }}>
                {ev.monto !== null && <span style={{ fontSize: '0.75rem', fontWeight: 700, color }}>{fmtMonto(ev.monto)}</span>}
                {ev.estado && <span style={{ fontSize: '0.68rem', padding: '0.08rem 0.35rem', borderRadius: '999px', background: color + '22', color, border: `1px solid ${color}44` }}>{ev.estado}</span>}
                {ev.actor && <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>{usersById[ev.actor]?.nombre_completo ?? ev.actor.slice(0, 8)}</span>}
              </div>
              {ev.notas && <p style={{ margin: '0.22rem 0 0', fontSize: '0.73rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{ev.notas}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main CarteraPage ──────────────────────────────────────────────────────────

type QuickFilterKey =
  | 'para_llamar_hoy'
  | 'sin_gestion'
  | 'ptp_vencido'
  | 'en_negociacion'
  | 'acuerdo_activo'
  | '90_mas'
  | 'alto_monto'
  | 'cerrado'

const QUICK_FILTERS: { key: QuickFilterKey; label: string; color: string; icon: string }[] = [
  { key: 'para_llamar_hoy', label: 'Para llamar hoy', color: '#3b82f6', icon: '📞' },
  { key: 'sin_gestion', label: 'Sin gestión', color: '#f59e0b', icon: '⚠️' },
  { key: 'ptp_vencido', label: 'PTP vencido', color: '#dc2626', icon: '🔴' },
  { key: 'en_negociacion', label: 'En negociación', color: '#f59e0b', icon: '💬' },
  { key: 'acuerdo_activo', label: 'Acuerdo activo', color: '#10b981', icon: '✅' },
  { key: '90_mas', label: '90+ días', color: '#7c3aed', icon: '🚨' },
  { key: 'alto_monto', label: 'Alto monto', color: '#ea580c', icon: '💰' },
  { key: 'cerrado', label: 'Cerrado', color: '#6b7280', icon: '🔒' },
]

type LastGestionInfo = { created_at: string; tipo_gestion: string; resultado: string | null }

export function CarteraPage() {
  const { usersById } = useUsers()
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentRole, setCurrentRole] = useState<GestionRole>('telemercadeo')
  const [busqueda, setBusqueda] = useState('')
  const [responsableFiltro, setResponsableFiltro] = useState<string>('all')
  const [selectedCase, setSelectedCase] = useState<Case | null>(null)
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey | null>(null)
  const [lastGestionByCase, setLastGestionByCase] = useState<Record<string, LastGestionInfo>>({})
  const [ptpVencidoSet, setPtpVencidoSet] = useState<Set<string>>(new Set())

  const loadCases = async () => {
    setLoading(true)
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { setLoading(false); return }
    setCurrentUserId(userData.user.id)

    const { data: userRow } = await supabase.from('usuarios').select('org_id, rol').eq('id', userData.user.id).single()
    if (userRow) {
      setOrgId(userRow.org_id as string)
      const rol = userRow.rol as GestionRole | null
      if (rol === 'admin' || rol === 'distribuidor' || rol === 'vendedor' || rol === 'telemercadeo') {
        setCurrentRole(rol)
      }
    }

    const { data, error: casesError } = await supabase
      .from('cargo_vuelta_cases')
      .select('id,org_id,cliente_id,tipo_caso,monto_total,monto_devuelto,fecha_cargo_vuelta,dias_vencido,estado,acuerdo_tipo,fecha_apertura,fecha_cierre,updated_by,en_proceso_legal')
      .order('dias_vencido', { ascending: false })

    if (casesError) {
      console.error('[CarteraPage] error cargando casos:', casesError)
      setCases([])
      setLoading(false)
      return
    }

    const baseCases = ((data ?? []) as Omit<Case, 'clientes'>[]).map((row) => ({
      ...row,
      clientes: null,
    }))

    const clienteIds = Array.from(new Set(baseCases.map((row) => row.cliente_id).filter(Boolean)))

    if (clienteIds.length === 0) {
      setCases(baseCases)
      setSelectedCase((prev) => prev ? (baseCases.find((row) => row.id === prev.id) ?? null) : null)
      setLoading(false)
      return
    }

    const { data: clientesData, error: clientesError } = await supabase
      .from('clientes')
      .select('id,nombre,apellido,telefono,email,hycite_id,saldo_actual')
      .in('id', clienteIds)

    if (clientesError) {
      console.error('[CarteraPage] error cargando clientes de casos:', clientesError)
      setCases(baseCases)
      setSelectedCase((prev) => prev ? (baseCases.find((row) => row.id === prev.id) ?? null) : null)
      setLoading(false)
      return
    }

    const clientesMap = new Map<string, ClienteResumen>()
    ;((clientesData ?? []) as ClienteResumen[]).forEach((cliente) => {
      clientesMap.set(cliente.id, cliente)
    })

    const loadedCases = baseCases.map((row) => ({
      ...row,
      clientes: clientesMap.get(row.cliente_id) ?? null,
    }))

    setCases(loadedCases)
    setSelectedCase((prev) => prev ? (loadedCases.find((row) => row.id === prev.id) ?? null) : null)

    // Batch load last gestión and PTP status per case
    const allCaseIds = loadedCases.map(c => c.id)
    if (allCaseIds.length > 0) {
      const todayStr = todayYmd()
      const [gRes, ptpRes] = await Promise.all([
        supabase.from('cob_gestiones')
          .select('case_id,created_at,tipo_gestion,resultado')
          .in('case_id', allCaseIds)
          .order('created_at', { ascending: false }),
        supabase.from('cob_ptps')
          .select('case_id,estado,fecha_compromiso')
          .in('case_id', allCaseIds)
          .in('estado', ['pendiente', 'vencido']),
      ])
      const newLastGestion: Record<string, LastGestionInfo> = {}
      for (const g of ((gRes.data ?? []) as { case_id: string; created_at: string; tipo_gestion: string; resultado: string | null }[])) {
        if (!newLastGestion[g.case_id]) {
          newLastGestion[g.case_id] = { created_at: g.created_at, tipo_gestion: g.tipo_gestion, resultado: g.resultado }
        }
      }
      setLastGestionByCase(newLastGestion)
      const newVencidoSet = new Set<string>()
      for (const p of ((ptpRes.data ?? []) as { case_id: string; estado: string; fecha_compromiso: string }[])) {
        if (p.estado === 'vencido' || (p.estado === 'pendiente' && p.fecha_compromiso < todayStr)) {
          newVencidoSet.add(p.case_id)
        }
      }
      setPtpVencidoSet(newVencidoSet)
    }

    setLoading(false)
  }

  useEffect(() => { void loadCases() }, [])

  const responsableOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { id: string; nombre: string }[] = []
    for (const c of cases) {
      if (c.updated_by && !seen.has(c.updated_by)) {
        seen.add(c.updated_by)
        opts.push({ id: c.updated_by, nombre: usersById[c.updated_by] ?? c.updated_by.slice(0, 8) })
      }
    }
    return opts.sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [cases, usersById])

  const matchesQuickFilter = (c: Case, key: QuickFilterKey): boolean => {
    const todayStr = todayYmd()
    switch (key) {
      case 'para_llamar_hoy': {
        if (c.estado === 'Cerrado') return false
        const lastG = lastGestionByCase[c.id]
        if (lastG) {
          const daysSince = Math.floor((new Date(todayStr).getTime() - new Date(lastG.created_at.slice(0, 10)).getTime()) / 86400000)
          if (daysSince < 2) return false
        }
        return true
      }
      case 'sin_gestion': return !lastGestionByCase[c.id]
      case 'ptp_vencido': return ptpVencidoSet.has(c.id)
      case 'en_negociacion': return c.estado === 'En Negociación'
      case 'acuerdo_activo': return c.estado === 'Acuerdo'
      case '90_mas': return c.dias_vencido >= 90
      case 'alto_monto': return (c.monto_devuelto ?? c.monto_total) >= 500
      case 'cerrado': return c.estado === 'Cerrado'
    }
  }

  const quickFilterCounts = useMemo(() => {
    const counts: Partial<Record<QuickFilterKey, number>> = {}
    for (const f of QUICK_FILTERS) {
      counts[f.key] = cases.filter(c => matchesQuickFilter(c, f.key)).length
    }
    return counts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, lastGestionByCase, ptpVencidoSet])

  const filtered = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return cases.filter(c => {
      if (q) {
        const nombre = nombreCliente(c.clientes).toLowerCase()
        const hid = (c.clientes?.hycite_id ?? '').toLowerCase()
        if (!nombre.includes(q) && !hid.includes(q)) return false
      }
      if (responsableFiltro !== 'all' && c.updated_by !== responsableFiltro) return false
      if (quickFilter) return matchesQuickFilter(c, quickFilter)
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, busqueda, responsableFiltro, quickFilter, lastGestionByCase, ptpVencidoSet])

  const handleCaseUpdated = () => void loadCases()

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', gap: 0 }}>
      {/* Left: cases list */}
      <div style={{ width: '360px', minWidth: '300px', maxWidth: '400px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)', height: '100%', overflow: 'hidden', flexShrink: 0 }}>

        {/* Search + responsable */}
        <div style={{ padding: '0.75rem 1rem 0.6rem', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Cartera</h2>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              {loading ? '…' : `${filtered.length} de ${cases.length}`}
            </span>
          </div>
          <input
            type="search"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar cliente o #ID…"
            style={{ width: '100%', boxSizing: 'border-box', height: '34px', padding: '0 0.65rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-text)', fontSize: '0.82rem' }}
          />
          {responsableOptions.length > 0 && (
            <select
              value={responsableFiltro}
              onChange={e => setResponsableFiltro(e.target.value)}
              style={{ marginTop: '0.4rem', width: '100%', height: '30px', padding: '0 0.5rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-text)', fontSize: '0.78rem', boxSizing: 'border-box' }}
            >
              <option value="all">Responsable: Todos</option>
              {responsableOptions.map(u => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          )}
        </div>

        {/* Quick filters */}
        <div style={{ padding: '0.5rem 0.75rem 0.55rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
          <p style={{ margin: '0 0 0.35rem', fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filtros rápidos</p>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {quickFilter !== null && (
              <button
                type="button"
                onClick={() => setQuickFilter(null)}
                style={{ padding: '0.18rem 0.5rem', borderRadius: '0.35rem', border: '1px solid var(--color-border)', cursor: 'pointer', fontSize: '0.69rem', fontWeight: 600, background: 'transparent', color: 'var(--color-text-muted)' }}
              >
                ✕ Todos
              </button>
            )}
            {QUICK_FILTERS.map(f => {
              const active = quickFilter === f.key
              const count = quickFilterCounts[f.key] ?? 0
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setQuickFilter(active ? null : f.key)}
                  style={{ padding: '0.18rem 0.5rem', borderRadius: '0.35rem', border: `1px solid ${active ? f.color : 'var(--color-border)'}`, cursor: 'pointer', fontSize: '0.69rem', fontWeight: 600, background: active ? f.color + '22' : 'transparent', color: active ? f.color : count > 0 ? 'var(--color-text-muted)' : 'var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <span>{f.icon}</span>
                  <span>{f.label}</span>
                  {count > 0 && <span style={{ fontSize: '0.65rem', fontWeight: 800, background: active ? f.color + '33' : 'var(--color-border)', borderRadius: '999px', padding: '0 0.3rem' }}>{count}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Cases list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>Cargando casos…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>🔍</div>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>
                {quickFilter ? 'Sin casos con este filtro' : 'Sin casos en este filtro'}
              </p>
              {quickFilter && (
                <button
                  type="button"
                  onClick={() => setQuickFilter(null)}
                  style={{ marginTop: '0.5rem', padding: '0.25rem 0.75rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.78rem' }}
                >
                  Ver todos
                </button>
              )}
            </div>
          ) : (
            filtered.map(c => {
              const isSelected = selectedCase?.id === c.id
              const dColor = diasColor(c.dias_vencido)
              const displayAmount = c.monto_devuelto ?? c.monto_total
              const sinMonto = !c.monto_devuelto || c.monto_devuelto === 0
              const lastG = lastGestionByCase[c.id]
              const hasPtpVencido = ptpVencidoSet.has(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCase(c)}
                  style={{ width: '100%', textAlign: 'left', padding: '0.65rem 1rem', border: 'none', borderBottom: '1px solid var(--color-border)', background: isSelected ? 'var(--color-primary-subtle, rgba(59,130,246,0.08))' : 'transparent', cursor: 'pointer', borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent' }}
                >
                  {/* Row 1: nombre + monto */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      {c.en_proceso_legal && <span title="En proceso legal" style={{ marginRight: '0.3rem' }}>⚖️</span>}
                      {nombreCliente(c.clientes)}
                    </span>
                    {sinMonto ? (
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#d97706', flexShrink: 0, padding: '0.1rem 0.4rem', borderRadius: '0.3rem', background: 'rgba(217,119,6,0.1)' }}>Sin monto</span>
                    ) : (
                      <span style={{ fontSize: '0.78rem', fontWeight: 800, color: dColor, flexShrink: 0 }}>{fmtMonto(displayAmount)}</span>
                    )}
                  </div>
                  {/* Row 2: estado + días + PTP badge */}
                  <div style={{ marginTop: '0.22rem', display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ padding: '0.08rem 0.38rem', borderRadius: '999px', fontSize: '0.66rem', fontWeight: 700, background: dColor + '22', color: dColor }}>{c.dias_vencido}d</span>
                    <span style={{ padding: '0.08rem 0.38rem', borderRadius: '999px', fontSize: '0.66rem', fontWeight: 600, background: estadoColor(c.estado) + '22', color: estadoColor(c.estado) }}>{c.estado}</span>
                    <span
                      style={{
                        padding: '0.08rem 0.38rem',
                        borderRadius: '999px',
                        fontSize: '0.66rem',
                        fontWeight: 700,
                        background: c.tipo_caso === 'dfp' ? 'rgba(59,130,246,0.16)' : 'rgba(100,116,139,0.2)',
                        color: c.tipo_caso === 'dfp' ? '#2563eb' : '#475569',
                      }}
                    >
                      {c.tipo_caso === 'dfp' ? 'DFP' : 'Cargo de vuelta'}
                    </span>
                    {hasPtpVencido && <span style={{ padding: '0.08rem 0.38rem', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 700, background: '#dc262622', color: '#dc2626' }}>PTP vencido</span>}
                    {c.clientes?.hycite_id && <span style={{ fontSize: '0.67rem', color: 'var(--color-text-muted)' }}>#{c.clientes.hycite_id}</span>}
                  </div>
                  {/* Row 3: última gestión */}
                  {lastG ? (
                    <p style={{ margin: '0.18rem 0 0', fontSize: '0.69rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📞 {lastG.tipo_gestion}{lastG.resultado ? ` · ${lastG.resultado}` : ''} · {fmtFecha(lastG.created_at)}
                    </p>
                  ) : (
                    <p style={{ margin: '0.18rem 0 0', fontSize: '0.69rem', color: '#f59e0b', fontWeight: 600 }}>⚠️ Sin gestiones registradas</p>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right: case detail */}
      <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
        {selectedCase ? (
          <CaseDetail
            key={selectedCase.id}
            caso={selectedCase}
            orgId={orgId ?? selectedCase.org_id}
            role={currentRole}
            currentUserId={currentUserId}
            usersById={usersById as Record<string, { nombre_completo?: string } | undefined>}
            onCaseUpdated={handleCaseUpdated}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.5rem' }}>
            <div style={{ fontSize: '2.5rem' }}>👈</div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', margin: 0 }}>Selecciona un caso para ver el detalle</p>
          </div>
        )}
      </div>
    </div>
  )
}
