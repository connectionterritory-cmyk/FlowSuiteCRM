import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useMessaging } from '../../hooks/useMessaging'

// ─── TIPOS ────────────────────────────────────────────────

type TabKey = 'cartera' | 'cumpleanos' | 'filtros' | 'referidos'

type Cliente = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  telefono_casa: string | null
  email: string | null
  saldo_actual: number | null
  monto_moroso: number | null
  dias_atraso: number | null
  fecha_nacimiento: string | null
  fecha_ultimo_pedido: string | null
  hycite_id: string | null
  estado_cuenta: string | null
  nivel: number | null
}

type EquipoInstalado = {
  id: string
  cliente_id: string
  fecha_instalacion: string | null
  activo: boolean | null
  cliente?: Cliente
  ultimo_servicio?: string | null
}

type ResultadoLlamada =
  | 'no_contesta'
  | 'cita_agendada'
  | 'pago_prometido'
  | 'pago_realizado'
  | 'no_interesado'
  | 'numero_equivocado'

type SegmentoTab = 'todos' | '0_30' | '31_60' | '61_90' | 'mas_90'

// ─── HELPERS ──────────────────────────────────────────────

function nombreCompleto(c: Cliente): string {
  return [c.nombre, c.apellido].filter(Boolean).join(' ') || 'Sin nombre'
}

function segmentoColor(dias: number | null, moroso: number | null): string {
  if (!moroso || moroso === 0) return '#10b981'
  if (!dias) return '#10b981'
  if (dias >= 91) return '#7c3aed'
  if (dias >= 61) return '#dc2626'
  if (dias >= 31) return '#ea580c'
  return '#f59e0b'
}

function segmentoLabel(dias: number | null, moroso: number | null): string {
  if (!moroso || moroso === 0) return 'Al día'
  if (!dias) return 'Al día'
  if (dias >= 91) return '+90 días'
  if (dias >= 61) return '61-90 días'
  if (dias >= 31) return '31-60 días'
  return '0-30 días'
}

function cumpleEstesMes(fechaNacimiento: string | null): boolean {
  if (!fechaNacimiento) return false
  const mes = new Date().getMonth()
  const diaNac = new Date(fechaNacimiento + 'T00:00:00')
  return diaNac.getMonth() === mes
}

function diasParaCumple(fechaNacimiento: string | null): number {
  if (!fechaNacimiento) return 999
  const hoy = new Date()
  const nac = new Date(fechaNacimiento + 'T00:00:00')
  const proxCumple = new Date(hoy.getFullYear(), nac.getMonth(), nac.getDate())
  if (proxCumple < hoy) proxCumple.setFullYear(hoy.getFullYear() + 1)
  return Math.ceil((proxCumple.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
}

// ─── COMPONENTE TARJETA CLIENTE ───────────────────────────

function ClienteCard({
  cliente,
  extra,
  onLlamar,
  onWhatsApp,
}: {
  cliente: Cliente
  extra?: React.ReactNode
  onLlamar: () => void
  onWhatsApp: () => void
}) {
  const seg = segmentoLabel(cliente.dias_atraso, cliente.monto_moroso)
  const color = segmentoColor(cliente.dias_atraso, cliente.monto_moroso)

  return (
    <div style={{
      padding: '1rem 1.25rem',
      background: 'var(--color-card, #1e2330)',
      borderRadius: '0.75rem',
      border: '1px solid var(--color-border, #2d3348)',
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      flexWrap: 'wrap',
    }}>
      {/* Info principal */}
      <div style={{ flex: 1, minWidth: '200px' }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>{nombreCompleto(cliente)}</p>
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          {cliente.telefono ?? cliente.telefono_casa ?? 'Sin teléfono'}
          {cliente.hycite_id && ` · #${cliente.hycite_id}`}
        </p>
        {extra}
      </div>

      {/* Saldo y morosidad */}
      <div style={{ textAlign: 'center' }}>
        {cliente.saldo_actual !== null && (
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>
            ${Number(cliente.saldo_actual).toFixed(2)}
          </p>
        )}
        <span style={{
          display: 'inline-block',
          padding: '0.15rem 0.6rem',
          borderRadius: '9999px',
          fontSize: '0.7rem',
          fontWeight: 700,
          background: color + '22',
          color,
          marginTop: '0.25rem',
        }}>
          {seg}
        </span>
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={onWhatsApp}
          style={{ padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: 'none', background: '#25d36622', color: '#25d366', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}
        >
          WhatsApp
        </button>
        <button
          type="button"
          onClick={onLlamar}
          style={{ padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: 'none', background: 'var(--color-primary, #3b82f6)', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}
        >
          Registrar
        </button>
      </div>
    </div>
  )
}

// ─── PÁGINA PRINCIPAL ─────────────────────────────────────

export function TelemercadeoPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { showToast } = useToast()
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const configured = isSupabaseConfigured

  const [activeTab, setActiveTab] = useState<TabKey>('cartera')
  const [segmento, setSegmento] = useState<SegmentoTab>('todos')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [equipos, setEquipos] = useState<EquipoInstalado[]>([])
  const [loading, setLoading] = useState(false)

  // Modal llamada
  const [modalOpen, setModalOpen] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [resultado, setResultado] = useState<ResultadoLlamada>('no_contesta')
  const [notas, setNotas] = useState('')
  const [fechaFollowup, setFechaFollowup] = useState('')
  const [montoProme, setMontoProme] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargarClientes = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    const { data } = await supabase
      .from('clientes')
      .select('id, nombre, apellido, telefono, telefono_casa, email, saldo_actual, monto_moroso, dias_atraso, fecha_nacimiento, fecha_ultimo_pedido, hycite_id, estado_cuenta, nivel')
      .order('dias_atraso', { ascending: false })
    setClientes((data as Cliente[]) ?? [])
    setLoading(false)
  }, [configured])

  const cargarEquipos = useCallback(async () => {
    if (!configured) return
    const { data } = await supabase
      .from('equipos_instalados')
      .select(`
        id, cliente_id, fecha_instalacion, activo,
        cliente:clientes(id, nombre, apellido, telefono, telefono_casa, email, saldo_actual, monto_moroso, dias_atraso, fecha_nacimiento, fecha_ultimo_pedido, hycite_id, estado_cuenta, nivel)
      `)
      .eq('activo', true)
    setEquipos((data as EquipoInstalado[]) ?? [])
  }, [configured])

  useEffect(() => {
    cargarClientes()
    cargarEquipos()
  }, [cargarClientes, cargarEquipos])

  // ─── LISTAS FILTRADAS ──────────────────────────────────

  const clientesCartera = useMemo(() => {
    return clientes.filter(c => {
      if (segmento === 'todos') return true
      const d = c.dias_atraso ?? 0
      const m = c.monto_moroso ?? 0
      if (segmento === '0_30') return m > 0 && d < 31
      if (segmento === '31_60') return d >= 31 && d < 61
      if (segmento === '61_90') return d >= 61 && d < 91
      if (segmento === 'mas_90') return d >= 91
      return true
    })
  }, [clientes, segmento])

  const clientesCumpleanos = useMemo(() => {
    return clientes
      .filter(c => {
        const dias = diasParaCumple(c.fecha_nacimiento)
        return dias <= 30
      })
      .sort((a, b) => diasParaCumple(a.fecha_nacimiento) - diasParaCumple(b.fecha_nacimiento))
  }, [clientes])

  const equiposFiltros = useMemo(() => {
    return equipos.filter(eq => {
      if (!eq.fecha_instalacion) return false
      const instalacion = new Date(eq.fecha_instalacion)
      const mesesDesde = (new Date().getTime() - instalacion.getTime()) / (1000 * 60 * 60 * 24 * 30)
      return mesesDesde >= 6
    })
  }, [equipos])

  // ─── REGISTRAR LLAMADA ─────────────────────────────────

  const abrirModal = (cliente: Cliente) => {
    setClienteSeleccionado(cliente)
    setResultado('no_contesta')
    setNotas('')
    setFechaFollowup('')
    setMontoProme('')
    setModalOpen(true)
  }

  const guardarLlamada = async () => {
    if (!clienteSeleccionado || !session?.user.id) return
    setGuardando(true)
    const { error } = await supabase.from('llamadas_telemercadeo').insert({
      cliente_id: clienteSeleccionado.id,
      telemercadista_id: session.user.id,
      resultado,
      notas: notas || null,
      followup_at: fechaFollowup || null,
      monto_prometido: montoProme ? parseFloat(montoProme) : null,
    })
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast('✅ Llamada registrada')
      setModalOpen(false)
    }
    setGuardando(false)
  }

  // ─── TABS ──────────────────────────────────────────────

  const tabs: { key: TabKey; label: string; count: number; emoji: string }[] = [
    { key: 'cartera', label: 'Cartera', count: clientesCartera.length, emoji: '📋' },
    { key: 'cumpleanos', label: 'Cumpleaños', count: clientesCumpleanos.length, emoji: '🎂' },
    { key: 'filtros', label: 'Filtros de agua', count: equiposFiltros.length, emoji: '🔧' },
    { key: 'referidos', label: 'Referidos', count: 0, emoji: '👥' },
  ]

  return (
    <div className="page-stack">
      <SectionHeader
        title="Telemercadeo"
        subtitle="Gestión de cartera, cumpleaños, filtros y referidos"
      />

      {/* TABS */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '9999px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              background: activeTab === tab.key ? 'var(--color-primary, #3b82f6)' : 'var(--color-surface)',
              color: activeTab === tab.key ? 'white' : 'var(--color-text-muted)',
              transition: 'all 0.15s',
            }}
          >
            {tab.emoji} {tab.label} <span style={{ opacity: 0.7 }}>({tab.count})</span>
          </button>
        ))}
      </div>

      {/* ─── TAB CARTERA ─── */}
      {activeTab === 'cartera' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Subtabs de segmento */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { key: 'todos', label: 'Todos', color: '#6b7280' },
              { key: '0_30', label: '0-30 días', color: '#f59e0b' },
              { key: '31_60', label: '31-60 días', color: '#ea580c' },
              { key: '61_90', label: '61-90 días', color: '#dc2626' },
              { key: 'mas_90', label: '+90 días', color: '#7c3aed' },
            ].map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSegmento(s.key as SegmentoTab)}
                style={{
                  padding: '0.3rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: `1px solid ${segmento === s.key ? s.color : 'var(--color-border)'}`,
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: segmento === s.key ? s.color + '22' : 'transparent',
                  color: segmento === s.key ? s.color : 'var(--color-text-muted)',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Cargando...</p>
          ) : clientesCartera.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>Sin clientes en este segmento</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {clientesCartera.map(c => (
                <ClienteCard
                  key={c.id}
                  cliente={c}
                  onLlamar={() => abrirModal(c)}
                  onWhatsApp={() => openWhatsapp({ nombre: nombreCompleto(c), telefono: c.telefono ?? '' })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB CUMPLEAÑOS ─── */}
      {activeTab === 'cumpleanos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {clientesCumpleanos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>No hay cumpleaños en los próximos 30 días</div>
          ) : clientesCumpleanos.map(c => {
            const dias = diasParaCumple(c.fecha_nacimiento)
            const esHoy = dias === 0
            return (
              <ClienteCard
                key={c.id}
                cliente={c}
                extra={
                  <p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', color: esHoy ? '#f59e0b' : 'var(--color-text-muted)' }}>
                    {esHoy ? '🎉 ¡Hoy es su cumpleaños!' : `🎂 Cumple en ${dias} días`}
                  </p>
                }
                onLlamar={() => abrirModal(c)}
                onWhatsApp={() => openWhatsapp({ nombre: nombreCompleto(c), telefono: c.telefono ?? '' })}
              />
            )
          })}
        </div>
      )}

      {/* ─── TAB FILTROS ─── */}
      {activeTab === 'filtros' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {equiposFiltros.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>No hay filtros próximos a vencer</div>
          ) : equiposFiltros.map(eq => {
            const cliente = eq.cliente as unknown as Cliente
            if (!cliente) return null
            const instalacion = new Date(eq.fecha_instalacion!)
            const meses = Math.floor((new Date().getTime() - instalacion.getTime()) / (1000 * 60 * 60 * 24 * 30))
            return (
              <ClienteCard
                key={eq.id}
                cliente={cliente}
                extra={
                  <p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', color: meses >= 12 ? '#dc2626' : '#f59e0b' }}>
                    🔧 {meses} meses desde instalación — {meses >= 12 ? 'Cambio urgente' : 'Cambio próximo'}
                  </p>
                }
                onLlamar={() => abrirModal(cliente)}
                onWhatsApp={() => openWhatsapp({ nombre: nombreCompleto(cliente), telefono: cliente.telefono ?? '' })}
              />
            )
          })}
        </div>
      )}

      {/* ─── TAB REFERIDOS ─── */}
      {activeTab === 'referidos' && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
          <p style={{ fontSize: '2rem' }}>👥</p>
          <p style={{ fontWeight: 600 }}>Módulo de referidos próximamente</p>
          <p style={{ fontSize: '0.875rem' }}>Aquí verás los referidos pendientes de contactar</p>
        </div>
      )}

      {/* ─── MODAL REGISTRO LLAMADA ─── */}
      <Modal
        open={modalOpen}
        title="Registrar llamada"
        description={clienteSeleccionado ? nombreCompleto(clienteSeleccionado) : ''}
        onClose={() => setModalOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={guardarLlamada} disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <label className="form-field">
            <span>Resultado</span>
            <select value={resultado} onChange={e => setResultado(e.target.value as ResultadoLlamada)}>
              <option value="no_contesta">No contestó</option>
              <option value="cita_agendada">Cita agendada</option>
              <option value="pago_prometido">Promesa de pago</option>
              <option value="pago_realizado">Pagó</option>
              <option value="no_interesado">No interesado</option>
              <option value="numero_equivocado">Número equivocado</option>
            </select>
          </label>

          {resultado === 'pago_prometido' && (
            <label className="form-field">
              <span>Monto prometido ($)</span>
              <input type="number" value={montoProme} onChange={e => setMontoProme(e.target.value)} placeholder="0.00" />
            </label>
          )}

          <label className="form-field">
            <span>Fecha de seguimiento</span>
            <input type="date" value={fechaFollowup} onChange={e => setFechaFollowup(e.target.value)} />
          </label>

          <label className="form-field">
            <span>Notas</span>
            <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Observaciones opcionales..." />
          </label>
        </div>
      </Modal>

      <ModalRenderer />
    </div>
  )
}
