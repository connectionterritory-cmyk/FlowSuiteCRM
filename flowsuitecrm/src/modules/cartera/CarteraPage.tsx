import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase/client'
import { useUsers } from '../../data/useUsers'
import { Modal } from '../../components/Modal'
import { INPUT_STYLE, LABEL_STYLE } from '../../components/formControlStyles'
import { RegistrarGestionModal, type GestionContactoRef, type GestionDraft, type GestionRole } from '../../components/RegistrarGestionModal'

// ── Types ─────────────────────────────────────────────────────────────────────

type EstadoCaso = 'Abierto' | 'En Negociación' | 'Acuerdo' | 'Cerrado'

type Case = {
  id: string
  org_id: string
  cliente_id: string
  monto_total: number
  dias_vencido: number
  estado: EstadoCaso
  acuerdo_tipo: string | null
  fecha_apertura: string
  fecha_cierre: string | null
  updated_by: string | null
  clientes: {
    nombre: string | null
    apellido: string | null
    telefono: string | null
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
  notas: string | null
  creado_por: string | null
  created_at: string
}

type Pago = {
  id: string
  monto: number
  fecha_pago: string
  metodo_pago: string | null
  referencia: string | null
  notas: string | null
  creado_por: string | null
  created_at: string
}

type Plan = {
  id: string
  monto_total: number
  numero_cuotas: number
  estado: string
  notas: string | null
  created_at: string
  cuotas: Cuota[]
}

type Cuota = {
  id: string
  plan_id?: string
  numero_cuota: number
  monto: number
  fecha_vencimiento: string
  fecha_pago: string | null
  pago_id?: string | null
  estado: string
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

function formatYmdLocal(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function addMonthsClamped(ymd: string, monthsToAdd: number) {
  const base = parseYmdLocal(ymd)
  const baseDay = base.getDate()
  const targetYear = base.getFullYear()
  const targetMonthIndex = base.getMonth() + monthsToAdd
  const targetMonthStart = new Date(targetYear, targetMonthIndex, 1)
  const lastDayOfTargetMonth = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate()
  return formatYmdLocal(new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), Math.min(baseDay, lastDayOfTargetMonth)))
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

function dateOnly(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 10)
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
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setMonto(''); setFecha(''); setNotas(''); setError(null) }
  }, [open])

  const handleSave = async () => {
    if (!monto || !fecha) { setError('Monto y fecha son obligatorios'); return }
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('cob_ptps').insert({
      org_id: orgId,
      cliente_id: clienteId,
      case_id: caseId,
      monto: parseFloat(monto),
      fecha_compromiso: fecha,
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
  ptps: PTP[]
  cuotas: Cuota[]
  onClose: () => void
  onSaved: () => void
}

function PagoModal({ open, caseId, clienteId, orgId, ptps, cuotas, onClose, onSaved }: PagoModalProps) {
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(todayYmd())
  const [metodo, setMetodo] = useState('efectivo')
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')
  const [ptpId, setPtpId] = useState('')
  const [selectedCuotaIds, setSelectedCuotaIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ptpsPendientes = useMemo(() => ptps.filter(p => p.estado === 'pendiente'), [ptps])
  const cuotasAbiertas = useMemo(() => cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'vencida'), [cuotas])

  useEffect(() => {
    if (open) { setMonto(''); setFecha(todayYmd()); setMetodo('efectivo'); setReferencia(''); setNotas(''); setPtpId(''); setSelectedCuotaIds([]); setError(null) }
  }, [open])

  const toggleCuota = (cuotaId: string) => {
    setSelectedCuotaIds(prev => (prev.includes(cuotaId) ? prev.filter(id => id !== cuotaId) : [...prev, cuotaId]))
  }

  const handleSave = async () => {
    if (!monto || !fecha) { setError('Monto y fecha son obligatorios'); return }
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.rpc('fn_registrar_pago', {
      p_org_id: orgId,
      p_cliente_id: clienteId,
      p_case_id: caseId,
      p_monto: parseFloat(monto),
      p_fecha_pago: fecha,
      p_metodo_pago: metodo || null,
      p_referencia: referencia || null,
      p_notas: notas || null,
      p_ptp_id: ptpId || null,
      p_cuota_ids: selectedCuotaIds.length > 0 ? selectedCuotaIds : null,
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
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Referencia / N° confirmación</span>
          <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Ej. TRF-123456" style={INPUT_STYLE} />
        </label>
        {ptpsPendientes.length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={LABEL_STYLE}>Aplica a promesa de pago (opcional)</span>
            <select value={ptpId} onChange={e => setPtpId(e.target.value)} style={INPUT_STYLE}>
              <option value="">— Sin PTP —</option>
              {ptpsPendientes.map(p => (
                <option key={p.id} value={p.id}>{fmtFecha(p.fecha_compromiso)} · {fmtMonto(p.monto)}</option>
              ))}
            </select>
          </label>
        )}
        {cuotasAbiertas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <span style={LABEL_STYLE}>Aplicar a cuotas del plan (opcional)</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '180px', overflowY: 'auto', padding: '0.55rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
              {cuotasAbiertas.map(c => {
                const checked = selectedCuotaIds.includes(c.id)
                const color = c.estado === 'vencida' ? '#dc2626' : '#6b7280'
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCuota(c.id)} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text)' }}>
                      Cuota {c.numero_cuota} · {fmtMonto(c.monto)} · {fmtFecha(c.fecha_vencimiento)}
                    </span>
                    <span style={{ marginLeft: 'auto', padding: '0.08rem 0.35rem', borderRadius: '999px', fontSize: '0.66rem', fontWeight: 700, background: color + '22', color }}>
                      {c.estado}
                    </span>
                  </label>
                )
              })}
            </div>
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
  onClose: () => void
  onSaved: () => void
}

function PlanModal({ open, caseId, clienteId, orgId, onClose, onSaved }: PlanModalProps) {
  const [montoTotal, setMontoTotal] = useState('')
  const [numeroCuotas, setNumeroCuotas] = useState('3')
  const [primerVencimiento, setPrimerVencimiento] = useState('')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setMontoTotal(''); setNumeroCuotas('3'); setPrimerVencimiento(''); setNotas(''); setError(null) }
  }, [open])

  const montoCuota = useMemo(() => {
    const total = parseFloat(montoTotal)
    const n = parseInt(numeroCuotas)
    if (!total || !n || n < 1) return null
    return total / n
  }, [montoTotal, numeroCuotas])

  const handleSave = async () => {
    const total = parseFloat(montoTotal)
    const n = parseInt(numeroCuotas)
    if (!total || !n || !primerVencimiento) { setError('Monto, cuotas y primer vencimiento son obligatorios'); return }
    setSaving(true)
    setError(null)

    const { data: planData, error: planErr } = await supabase.from('cob_plan_pagos').insert({
      org_id: orgId,
      cliente_id: clienteId,
      case_id: caseId,
      monto_total: total,
      numero_cuotas: n,
      notas: notas || null,
    }).select('id').single()

    if (planErr || !planData) { setSaving(false); setError(planErr?.message ?? 'Error al crear plan'); return }

    const totalCentavos = Math.round(total * 100)
    const baseCuotaCentavos = Math.floor(totalCentavos / n)
    const remainder = totalCentavos - (baseCuotaCentavos * n)
    const cuotas = Array.from({ length: n }, (_, i) => {
      return {
        org_id: orgId,
        plan_id: planData.id,
        numero_cuota: i + 1,
        monto: (baseCuotaCentavos + (i === n - 1 ? remainder : 0)) / 100,
        fecha_vencimiento: addMonthsClamped(primerVencimiento, i),
      }
    })

    const { error: cuotasErr } = await supabase.from('cob_plan_cuotas').insert(cuotas)
    setSaving(false)
    if (cuotasErr) { setError(cuotasErr.message); return }

    onSaved()
    onClose()
  }

  return (
    <Modal open={open} title="Crear Plan de Pagos" onClose={onClose} size="sm"
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.875rem' }}>Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Guardando…' : 'Crear plan'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>{error}</p>}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Monto total a financiar *</span>
          <input type="number" min="0" step="0.01" value={montoTotal} onChange={e => setMontoTotal(e.target.value)} placeholder="0.00" style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Número de cuotas *</span>
          <input type="number" min="1" max="60" value={numeroCuotas} onChange={e => setNumeroCuotas(e.target.value)} style={INPUT_STYLE} />
        </label>
        {montoCuota !== null && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Cuota mensual estimada: <strong style={{ color: 'var(--color-text)' }}>{fmtMonto(montoCuota)}</strong>
          </p>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Vencimiento primera cuota *</span>
          <input type="date" value={primerVencimiento} onChange={e => setPrimerVencimiento(e.target.value)} style={INPUT_STYLE} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={LABEL_STYLE}>Notas</span>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Condiciones del acuerdo…" style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '56px' }} />
        </label>
      </div>
    </Modal>
  )
}

// ── Case Detail Panel ─────────────────────────────────────────────────────────

type DetailTab = 'gestiones' | 'ptps' | 'pagos' | 'plan'

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

function buildCobranzaNextAction(draft: GestionDraft) {
  if (draft.resultado === 'cita_agendada') return 'Cita agendada'
  if (draft.resultado === 'promesa_pago') return 'Cobrar promesa de pago'
  if (draft.resultado === 'pago_realizado') return 'Verificar pago de cobranza'
  if (draft.resultado === 'no_contesta' || draft.resultado === 'ocupado' || draft.resultado === 'buzon_voz') {
    return 'Llamar de nuevo'
  }
  if (draft.tipo === 'whatsapp') return 'Seguimiento por WhatsApp'
  if (draft.tipo === 'email') return 'Seguimiento por email'
  return `Seguimiento cobranza: ${formatGestionTipo(draft.tipo)}`
}

function CaseDetail({ caso, orgId, role, currentUserId, usersById, onCaseUpdated }: CaseDetailProps) {
  const [tab, setTab] = useState<DetailTab>('gestiones')
  const [gestiones, setGestiones] = useState<Gestion[]>([])
  const [ptps, setPtps] = useState<PTP[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [planes, setPlanes] = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)
  const [ptpOpen, setPtpOpen] = useState(false)
  const [pagoOpen, setPagoOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [gestionOpen, setGestionOpen] = useState(false)
  const [gestionSaving, setGestionSaving] = useState(false)
  const [gestionError, setGestionError] = useState<string | null>(null)

  const loadDetail = async () => {
    setLoading(true)
    const [g, p, pg, pl] = await Promise.all([
      supabase.from('cob_gestiones').select('id,tipo_gestion,resultado,monto_comprometido,fecha_compromiso,notas,gestionado_por,created_at').eq('case_id', caso.id).order('created_at', { ascending: false }),
      supabase.from('cob_ptps').select('id,monto,fecha_compromiso,estado,notas,creado_por,created_at').eq('case_id', caso.id).order('created_at', { ascending: false }),
      supabase.from('cob_pagos').select('id,monto,fecha_pago,metodo_pago,referencia,notas,creado_por,created_at').eq('case_id', caso.id).order('fecha_pago', { ascending: false }),
      supabase.from('cob_plan_pagos').select('id,monto_total,numero_cuotas,estado,notas,created_at').eq('case_id', caso.id).order('created_at', { ascending: false }),
    ])
    setGestiones((g.data ?? []) as Gestion[])
    setPtps((p.data ?? []) as PTP[])
    setPagos((pg.data ?? []) as Pago[])

    // load cuotas for each plan
    const rawPlanes = (pl.data ?? []) as Omit<Plan, 'cuotas'>[]
    if (rawPlanes.length > 0) {
      const planIds = rawPlanes.map(rp => rp.id)
      const { data: cuotasData } = await supabase
        .from('cob_plan_cuotas')
        .select('id,plan_id,numero_cuota,monto,fecha_vencimiento,fecha_pago,pago_id,estado')
        .in('plan_id', planIds)
        .order('numero_cuota')
      const cuotasByPlan: Record<string, Cuota[]> = {}
      for (const c of (cuotasData ?? []) as (Cuota & { plan_id: string })[]) {
        if (!cuotasByPlan[c.plan_id]) cuotasByPlan[c.plan_id] = []
        cuotasByPlan[c.plan_id].push(c)
      }
      setPlanes(rawPlanes.map(rp => ({ ...rp, cuotas: cuotasByPlan[rp.id] ?? [] })))
    } else {
      setPlanes([])
    }
    setLoading(false)
  }

  useEffect(() => { void loadDetail() }, [caso.id])

  const handleRefresh = () => { void loadDetail(); onCaseUpdated() }

  const handleGestionSubmit = async (draft: GestionDraft) => {
    if (!currentUserId) throw new Error('No se pudo identificar el usuario actual.')

    const montoComprometido = draft.montoPrometido.trim() ? parseFloat(draft.montoPrometido) : null
    const notas = draft.contenido.trim() || draft.resumen.trim() || null
    const resultado = draft.resultado ?? (draft.resumen.trim() || null)
    const fechaCompromiso = dateOnly(draft.followupAt)

    setGestionSaving(true)
    setGestionError(null)
    try {
      const { data: gestionData, error: gestionInsertError } = await supabase
        .from('cob_gestiones')
        .insert({
          org_id: orgId,
          cliente_id: caso.cliente_id,
          case_id: caso.id,
          tipo_gestion: formatGestionTipo(draft.tipo),
          resultado,
          monto_comprometido: Number.isFinite(montoComprometido ?? NaN) ? montoComprometido : null,
          fecha_compromiso: fechaCompromiso,
          notas,
          gestionado_por: currentUserId,
        })
        .select('id')
        .single()

      if (gestionInsertError) throw gestionInsertError

      const { error: actividadError } = await supabase.from('contacto_actividades').insert({
        org_id: orgId,
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
          cob_gestion_id: gestionData?.id ?? null,
          modulo_origen: draft.moduloOrigen ?? 'cartera',
          origen_id: draft.origenId ?? caso.id,
        },
        autor_id: currentUserId,
        fecha_actividad: new Date().toISOString(),
      })

      if (actividadError) {
        console.warn('[CarteraPage] gestión guardada sin actividad de timeline:', actividadError.message)
      }

      if (fechaCompromiso) {
        const { error: clienteError } = await supabase
          .from('clientes')
          .update({
            next_action: buildCobranzaNextAction(draft),
            next_action_date: fechaCompromiso,
          })
          .eq('id', caso.cliente_id)

        if (clienteError) {
          console.warn('[CarteraPage] gestión guardada sin actualizar próxima acción:', clienteError.message)
        }
      }

      handleRefresh()
      setGestionOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la gestión.'
      setGestionError(message)
      throw error
    } finally {
      setGestionSaving(false)
    }
  }

  const totalPagado = useMemo(() => pagos.reduce((s, p) => s + p.monto, 0), [pagos])
  const saldo = caso.monto_total - totalPagado
  const cuotasAbiertas = useMemo(
    () => planes.flatMap(plan => plan.cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'vencida')),
    [planes],
  )

  const cliente = caso.clientes
  const gestionContacto: GestionContactoRef = {
    tipo: 'cliente',
    id: caso.cliente_id,
    nombre: nombreCliente(cliente),
    telefono: cliente?.telefono ?? null,
    subtitle: caso.acuerdo_tipo ? `Caso de cartera · ${caso.acuerdo_tipo}` : 'Caso de cartera',
  }
  const chips = [
    { label: `${caso.dias_vencido}d vencido`, color: diasColor(caso.dias_vencido) },
    { label: caso.estado, color: estadoColor(caso.estado) },
  ]
  if (caso.acuerdo_tipo) chips.push({ label: caso.acuerdo_tipo, color: '#7c3aed' })

  const TABS: { key: DetailTab; label: string }[] = [
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
          {nombreCliente(cliente)}
          {cliente?.hycite_id && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>#{cliente.hycite_id}</span>}
        </p>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          {chips.map(ch => (
            <span key={ch.label} style={{ padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, background: ch.color + '22', color: ch.color, border: `1px solid ${ch.color}44` }}>{ch.label}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          <span>Deuda: <strong style={{ color: 'var(--color-text)' }}>{fmtMonto(caso.monto_total)}</strong></span>
          <span>Pagado: <strong style={{ color: '#10b981' }}>{fmtMonto(totalPagado)}</strong></span>
          <span>Saldo: <strong style={{ color: saldo > 0 ? '#f87171' : '#10b981' }}>{fmtMonto(saldo)}</strong></span>
        </div>
      </div>

      {/* Action bar */}
      <div style={{ padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <ActionBtn label="+ Gestión" color="#3b82f6" onClick={() => { setGestionError(null); setGestionOpen(true) }} />
        <ActionBtn label="+ PTP" color="#f59e0b" onClick={() => setPtpOpen(true)} />
        <ActionBtn label="+ Pago" color="#10b981" onClick={() => setPagoOpen(true)} />
        <ActionBtn label="+ Plan" color="#7c3aed" onClick={() => setPlanOpen(true)} />
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
        ) : tab === 'gestiones' ? (
          <GestionesList gestiones={gestiones} usersById={usersById} />
        ) : tab === 'ptps' ? (
          <PTPsList ptps={ptps} usersById={usersById} onRefresh={handleRefresh} />
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
        onClose={() => { setGestionError(null); setGestionOpen(false) }}
        onSubmit={handleGestionSubmit}
        submitting={gestionSaving}
        errorMessage={gestionError}
        contacto={gestionContacto}
        tipoDefault="llamada"
        moduloOrigen="cartera"
        origenId={caso.id}
      />
      <PTPModal open={ptpOpen} caseId={caso.id} clienteId={caso.cliente_id} orgId={orgId} currentUserId={currentUserId} onClose={() => setPtpOpen(false)} onSaved={handleRefresh} />
      <PagoModal open={pagoOpen} caseId={caso.id} clienteId={caso.cliente_id} orgId={orgId} ptps={ptps} cuotas={cuotasAbiertas} onClose={() => setPagoOpen(false)} onSaved={handleRefresh} />
      <PlanModal open={planOpen} caseId={caso.id} clienteId={caso.cliente_id} orgId={orgId} onClose={() => setPlanOpen(false)} onSaved={handleRefresh} />
    </div>
  )
}

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: '0.35rem 0.85rem', borderRadius: '0.4rem', border: `1px solid ${color}66`, background: color + '18', color, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>
      {label}
    </button>
  )
}

// ── Gestiones list ────────────────────────────────────────────────────────────

function GestionesList({ gestiones, usersById }: { gestiones: Gestion[]; usersById: Record<string, { nombre_completo?: string } | undefined> }) {
  if (gestiones.length === 0) return <Empty label="No hay gestiones vinculadas a este caso" />
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

function PTPsList({ ptps, onRefresh }: { ptps: PTP[]; usersById?: Record<string, { nombre_completo?: string } | undefined>; onRefresh: () => void }) {
  if (ptps.length === 0) return <Empty label="No hay promesas de pago para este caso" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {ptps.map(p => {
        const color = ptpEstadoColor(p.estado)
        return (
          <div key={p.id} style={{ padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${color}44`, background: color + '0d' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>{fmtMonto(p.monto)}</span>
              <span style={{ padding: '0.12rem 0.45rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 700, background: color + '22', color }}>{p.estado}</span>
            </div>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Vence: {fmtFecha(p.fecha_compromiso)}</p>
            {p.notas && <p style={{ margin: '0.2rem 0 0', fontSize: '0.73rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{p.notas}</p>}
            {(p.estado === 'pendiente' || p.estado === 'vencido') && (
              <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.4rem' }}>
                <SmallBtn label="Cumplido" color="#10b981" onClick={async () => { await supabase.from('cob_ptps').update({ estado: 'cumplido', fecha_cumplimiento: todayYmd() }).eq('id', p.id); onRefresh() }} />
                <SmallBtn label="Incumplido" color="#ea580c" onClick={async () => { await supabase.from('cob_ptps').update({ estado: 'incumplido' }).eq('id', p.id); onRefresh() }} />
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
  if (pagos.length === 0) return <Empty label="No hay pagos registrados para este caso" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {pagos.map(p => (
        <div key={p.id} style={{ padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #10b98133', background: '#10b9810d' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981' }}>{fmtMonto(p.monto)}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{fmtFecha(p.fecha_pago)}</span>
          </div>
          {p.metodo_pago && <p style={{ margin: '0.2rem 0 0', fontSize: '0.73rem', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{p.metodo_pago}{p.referencia ? ` · ${p.referencia}` : ''}</p>}
          {p.notas && <p style={{ margin: '0.2rem 0 0', fontSize: '0.73rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{p.notas}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Planes list ───────────────────────────────────────────────────────────────

function PlanesList({ planes }: { planes: Plan[] }) {
  if (planes.length === 0) return <Empty label="No hay planes de pago para este caso" />
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

function Empty({ label }: { label: string }) {
  return <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>{label}</p>
}

// ── Main CarteraPage ──────────────────────────────────────────────────────────

const ESTADO_TABS = [
  { key: 'all', label: 'Todos' },
  { key: 'Abierto', label: 'Abierto' },
  { key: 'En Negociación', label: 'En Negociación' },
  { key: 'Acuerdo', label: 'Acuerdo' },
  { key: 'Cerrado', label: 'Cerrado' },
] as const

type EstadoTab = (typeof ESTADO_TABS)[number]['key']

export function CarteraPage() {
  const { usersById } = useUsers()
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentRole, setCurrentRole] = useState<GestionRole>('telemercadeo')
  const [busqueda, setBusqueda] = useState('')
  const [estadoTab, setEstadoTab] = useState<EstadoTab>('all')
  const [diasRango, setDiasRango] = useState<string>('all')
  const [responsableFiltro, setResponsableFiltro] = useState<string>('all')
  const [selectedCase, setSelectedCase] = useState<Case | null>(null)

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
      .select('id,org_id,cliente_id,monto_total,dias_vencido,estado,acuerdo_tipo,fecha_apertura,fecha_cierre,updated_by')
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
      setLoading(false)
      return
    }

    const { data: clientesData, error: clientesError } = await supabase
      .from('clientes')
      .select('id,nombre,apellido,telefono,hycite_id,saldo_actual')
      .in('id', clienteIds)

    if (clientesError) {
      console.error('[CarteraPage] error cargando clientes de casos:', clientesError)
      setCases(baseCases)
      setLoading(false)
      return
    }

    const clientesMap = new Map<string, ClienteResumen>()
    ;((clientesData ?? []) as ClienteResumen[]).forEach((cliente) => {
      clientesMap.set(cliente.id, cliente)
    })

    setCases(
      baseCases.map((row) => ({
        ...row,
        clientes: clientesMap.get(row.cliente_id) ?? null,
      })),
    )
    setLoading(false)
  }

  useEffect(() => { void loadCases() }, [])

  const estadoCounts = useMemo(() => {
    const m: Record<string, number> = { all: cases.length }
    for (const c of cases) { m[c.estado] = (m[c.estado] ?? 0) + 1 }
    return m
  }, [cases])

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

  const filtered = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return cases.filter(c => {
      if (estadoTab !== 'all' && c.estado !== estadoTab) return false
      if (diasRango !== 'all') {
        const d = c.dias_vencido
        if (diasRango === '1-30' && !(d >= 1 && d <= 30)) return false
        if (diasRango === '31-60' && !(d >= 31 && d <= 60)) return false
        if (diasRango === '61-90' && !(d >= 61 && d <= 90)) return false
        if (diasRango === '90+' && d <= 90) return false
      }
      if (responsableFiltro !== 'all' && c.updated_by !== responsableFiltro) return false
      if (q) {
        const nombre = nombreCliente(c.clientes).toLowerCase()
        const hid = (c.clientes?.hycite_id ?? '').toLowerCase()
        if (!nombre.includes(q) && !hid.includes(q)) return false
      }
      return true
    })
  }, [cases, estadoTab, busqueda, diasRango, responsableFiltro])

  const handleCaseUpdated = () => void loadCases()

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', gap: 0 }}>
      {/* Left: cases list */}
      <div style={{ width: '340px', minWidth: '280px', maxWidth: '380px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)', height: '100%', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ margin: '0 0 0.6rem', fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Cartera</h2>
          <input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar cliente o #ID…"
            style={{ width: '100%', boxSizing: 'border-box', height: '34px', padding: '0 0.65rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-text)', fontSize: '0.82rem' }} />
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.69rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>Días:</span>
            {(['all', '1-30', '31-60', '61-90', '90+'] as const).map(r => {
              const active = diasRango === r
              return (
                <button key={r} type="button" onClick={() => setDiasRango(r)}
                  style={{ padding: '0.15rem 0.45rem', borderRadius: '0.35rem', border: `1px solid ${active ? '#6b7280' : 'var(--color-border)'}`, cursor: 'pointer', fontSize: '0.69rem', fontWeight: 600, background: active ? '#6b728022' : 'transparent', color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {r === 'all' ? 'Todos' : r}
                </button>
              )
            })}
          </div>
          {responsableOptions.length > 0 && (
            <select value={responsableFiltro} onChange={e => setResponsableFiltro(e.target.value)}
              style={{ marginTop: '0.4rem', width: '100%', height: '30px', padding: '0 0.5rem', borderRadius: '0.4rem', border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-text)', fontSize: '0.78rem', boxSizing: 'border-box' }}>
              <option value="all">Último responsable: Todos</option>
              {responsableOptions.map(u => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          )}
        </div>
        {/* Estado tabs */}
        <div style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
          {ESTADO_TABS.map(t => {
            const count = estadoCounts[t.key] ?? 0
            const active = estadoTab === t.key
            const color = t.key === 'all' ? '#6b7280' : estadoColor(t.key)
            return (
              <button key={t.key} type="button" onClick={() => setEstadoTab(t.key)}
                style={{ padding: '0.2rem 0.55rem', borderRadius: '0.35rem', border: `1px solid ${active ? color : 'var(--color-border)'}`, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, background: active ? color + '22' : 'transparent', color: active ? color : 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                {t.label}
                {count > 0 && <span style={{ fontSize: '0.67rem', fontWeight: 700 }}>{count}</span>}
              </button>
            )
          })}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ padding: '1rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
          ) : filtered.length === 0 ? (
            <p style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Sin casos en este filtro</p>
          ) : (
            filtered.map(c => {
              const isSelected = selectedCase?.id === c.id
              const dColor = diasColor(c.dias_vencido)
              return (
                <button key={c.id} type="button" onClick={() => setSelectedCase(c)}
                  style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem', border: 'none', borderBottom: '1px solid var(--color-border)', background: isSelected ? 'var(--color-primary-subtle, rgba(59,130,246,0.08))' : 'transparent', cursor: 'pointer', borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.3 }}>{nombreCliente(c.clientes)}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: dColor, flexShrink: 0 }}>{fmtMonto(c.monto_total)}</span>
                  </div>
                  <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: '999px', fontSize: '0.67rem', fontWeight: 700, background: dColor + '22', color: dColor }}>{c.dias_vencido}d</span>
                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: '999px', fontSize: '0.67rem', fontWeight: 600, background: estadoColor(c.estado) + '22', color: estadoColor(c.estado) }}>{c.estado}</span>
                    {c.clientes?.hycite_id && <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>#{c.clientes.hycite_id}</span>}
                  </div>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            Selecciona un caso para ver el detalle
          </div>
        )}
      </div>
    </div>
  )
}
