import { useEffect, useMemo, useState } from 'react'
import { useMessaging } from '../../hooks/useMessaging'
import {
  ClienteCard,
  nombreCompleto,
  resultadoLabel,
  resultadoColor,
  formatFechaCorta,
  type Cliente,
  type SegmentoTab,
} from './TelemercadeoShared'
import { TelemercadeoCallModal } from './TelemercadeoCallModal'
import { useTelemercadeoClientes } from './telemercadeoData'
import { supabase } from '../../lib/supabase/client'

type LastCall = {
  resultado: string
  created_at: string
  followup_at: string | null
}

export function TelemercadeoCarteraPage() {
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { clientes, loading } = useTelemercadeoClientes({ balanceOnly: true })
  const [segmento, setSegmento] = useState<SegmentoTab>('todos')
  const [modalOpen, setModalOpen] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [lastCallMap, setLastCallMap] = useState<Record<string, LastCall>>({})
  const [busqueda, setBusqueda] = useState('')
  const [sinContacto, setSinContacto] = useState(false)
  const [seguimientosHoyIds, setSeguimientosHoyIds] = useState<Set<string>>(new Set())
  const [promesasVencidasIds, setPromesasVencidasIds] = useState<Set<string>>(new Set())

  // Batch-load the most recent call per client
  useEffect(() => {
    if (clientes.length === 0) {
      setLastCallMap({})
      return
    }
    const ids = clientes.map((c) => c.id)
    const load = async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('llamadas_telemercadeo')
        .select('cliente_id, resultado, created_at, followup_at')
        .in('cliente_id', ids)
        .order('created_at', { ascending: false })

      type Row = { cliente_id: string; resultado: string; created_at: string; followup_at: string | null }
      const rows = (data ?? []) as Row[]

      const map: Record<string, LastCall> = {}
      const hoy = new Set<string>()
      const byClient: Record<string, Row[]> = {}

      for (const row of rows) {
        if (!map[row.cliente_id]) {
          map[row.cliente_id] = {
            resultado: row.resultado,
            created_at: row.created_at,
            followup_at: row.followup_at,
          }
        }
        if (row.followup_at === today) hoy.add(row.cliente_id)
        if (!byClient[row.cliente_id]) byClient[row.cliente_id] = []
        byClient[row.cliente_id].push(row)
      }

      const vencidas = new Set<string>()
      for (const [clienteId, calls] of Object.entries(byClient)) {
        for (const call of calls) {
          if (call.resultado === 'pago_prometido' && call.followup_at && call.followup_at < today) {
            const hasPago = calls.some(
              (c) => c.resultado === 'pago_realizado' && c.created_at > call.created_at,
            )
            if (!hasPago) vencidas.add(clienteId)
            break
          }
        }
      }

      setLastCallMap(map)
      setSeguimientosHoyIds(hoy)
      setPromesasVencidasIds(vencidas)
    }
    load()
  }, [clientes])

  // Count per segment (unfiltered, for badges)
  const segmentCounts = useMemo(() => {
    const counts = {
      todos: clientes.length,
      '0_30': 0,
      '31_60': 0,
      '61_90': 0,
      mas_90: 0,
      hoy: 0,
      promesas_vencidas: 0,
    }
    for (const c of clientes) {
      const d = c.dias_atraso ?? 0
      const m = c.monto_moroso ?? 0
      if (m > 0 && d < 31) counts['0_30']++
      if (d >= 31 && d < 61) counts['31_60']++
      if (d >= 61 && d < 91) counts['61_90']++
      if (d >= 91) counts.mas_90++
      if (seguimientosHoyIds.has(c.id)) counts.hoy++
      if (promesasVencidasIds.has(c.id)) counts.promesas_vencidas++
    }
    return counts
  }, [clientes, seguimientosHoyIds, promesasVencidasIds])

  const clientesCartera = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return clientes.filter((c) => {
      const d = c.dias_atraso ?? 0
      const m = c.monto_moroso ?? 0
      if (segmento === '0_30' && !(m > 0 && d < 31)) return false
      if (segmento === '31_60' && !(d >= 31 && d < 61)) return false
      if (segmento === '61_90' && !(d >= 61 && d < 91)) return false
      if (segmento === 'mas_90' && !(d >= 91)) return false
      if (segmento === 'hoy' && !seguimientosHoyIds.has(c.id)) return false
      if (segmento === 'promesas_vencidas' && !promesasVencidasIds.has(c.id)) return false
      if (sinContacto && lastCallMap[c.id]) return false
      if (q) {
        const nombre = `${c.nombre ?? ''} ${c.apellido ?? ''}`.toLowerCase()
        const tel = (c.telefono ?? c.telefono_casa ?? '').toLowerCase()
        const hid = (c.hycite_id ?? '').toLowerCase()
        if (!nombre.includes(q) && !tel.includes(q) && !hid.includes(q)) return false
      }
      return true
    })
  }, [clientes, segmento, busqueda, sinContacto, lastCallMap, seguimientosHoyIds, promesasVencidasIds])

  const abrirModal = (cliente: Cliente) => {
    setClienteSeleccionado(cliente)
    setModalOpen(true)
  }

  const handleClose = () => {
    setModalOpen(false)
    // Refresh last calls after registering a new one
    if (clientes.length === 0) return
    const ids = clientes.map((c) => c.id)
    const today = new Date().toISOString().split('T')[0]
    supabase
      .from('llamadas_telemercadeo')
      .select('cliente_id, resultado, created_at, followup_at')
      .in('cliente_id', ids)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        type Row = { cliente_id: string; resultado: string; created_at: string; followup_at: string | null }
        const rows = (data ?? []) as Row[]
        const map: Record<string, LastCall> = {}
        const hoy = new Set<string>()
        const byClient: Record<string, Row[]> = {}
        for (const row of rows) {
          if (!map[row.cliente_id]) {
            map[row.cliente_id] = {
              resultado: row.resultado,
              created_at: row.created_at,
              followup_at: row.followup_at,
            }
          }
          if (row.followup_at === today) hoy.add(row.cliente_id)
          if (!byClient[row.cliente_id]) byClient[row.cliente_id] = []
          byClient[row.cliente_id].push(row)
        }
        const vencidas = new Set<string>()
        for (const [clienteId, calls] of Object.entries(byClient)) {
          for (const call of calls) {
            if (call.resultado === 'pago_prometido' && call.followup_at && call.followup_at < today) {
              const hasPago = calls.some(
                (c) => c.resultado === 'pago_realizado' && c.created_at > call.created_at,
              )
              if (!hasPago) vencidas.add(clienteId)
              break
            }
          }
        }
        setLastCallMap(map)
        setSeguimientosHoyIds(hoy)
        setPromesasVencidasIds(vencidas)
      })
  }

  const SEGMENTOS = [
    { key: 'hoy', label: 'Hoy', color: '#3b82f6' },
    { key: 'promesas_vencidas', label: 'Promesas venc.', color: '#f59e0b' },
    { key: 'todos', label: 'Todos', color: '#6b7280' },
    { key: '0_30', label: '0-30 días', color: '#f59e0b' },
    { key: '31_60', label: '31-60 días', color: '#ea580c' },
    { key: '61_90', label: '61-90 días', color: '#dc2626' },
    { key: 'mas_90', label: '+90 días', color: '#7c3aed' },
  ] as const

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Segment tabs with count badges */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {SEGMENTOS.map((s) => {
          const count = segmentCounts[s.key as keyof typeof segmentCounts]
          const active = segmento === s.key
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setSegmento(s.key as SegmentoTab)}
              style={{
                padding: '0.3rem 0.75rem',
                borderRadius: '0.375rem',
                border: `1px solid ${active ? s.color : 'var(--color-border)'}`,
                cursor: 'pointer',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: active ? s.color + '22' : 'transparent',
                color: active ? s.color : 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              {s.label}
              {count > 0 && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '18px',
                    height: '18px',
                    padding: '0 4px',
                    borderRadius: '9999px',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    background: active ? s.color + '33' : 'var(--color-border)',
                    color: active ? s.color : 'var(--color-text-muted)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search + Sin contacto row */}
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, teléfono o #ID…"
          style={{
            flex: '1',
            minWidth: '200px',
            height: '36px',
            padding: '0 0.75rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--color-border, #2b3244)',
            background: 'var(--color-card, #1b2230)',
            color: 'var(--color-text)',
            fontSize: '0.85rem',
          }}
        />
        <button
          type="button"
          onClick={() => setSinContacto((v) => !v)}
          style={{
            padding: '0.3rem 0.85rem',
            height: '36px',
            borderRadius: '0.5rem',
            border: `1px solid ${sinContacto ? '#f59e0b' : 'var(--color-border)'}`,
            cursor: 'pointer',
            fontSize: '0.78rem',
            fontWeight: 600,
            background: sinContacto ? 'rgba(245,158,11,0.12)' : 'transparent',
            color: sinContacto ? '#f59e0b' : 'var(--color-text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          Sin contacto
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Cargando...</p>
      ) : clientesCartera.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '2rem',
            color: 'var(--color-text-muted)',
          }}
        >
          Sin clientes en este segmento
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {clientesCartera.map((c) => {
            const last = lastCallMap[c.id]
            const color = last ? resultadoColor(last.resultado) : null
            return (
              <ClienteCard
                key={c.id}
                cliente={c}
                extra={
                  last ? (
                    <p
                      style={{
                        margin: '0.25rem 0 0',
                        fontSize: '0.73rem',
                        color: 'var(--color-text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: color ?? '#6b7280',
                          flexShrink: 0,
                        }}
                      />
                      {resultadoLabel(last.resultado)} · {formatFechaCorta(last.created_at)}
                    </p>
                  ) : (
                    <p
                      style={{
                        margin: '0.25rem 0 0',
                        fontSize: '0.73rem',
                        color: 'var(--color-text-muted)',
                        fontStyle: 'italic',
                      }}
                    >
                      Sin contacto previo
                    </p>
                  )
                }
                onLlamar={() => abrirModal(c)}
                onWhatsApp={() =>
                  openWhatsapp({
                    nombre: nombreCompleto(c),
                    telefono: c.telefono ?? '',
                    cuentaHycite: c.hycite_id ?? '',
                    saldoActual: c.saldo_actual,
                    montoMoroso: c.monto_moroso,
                    diasAtraso: c.dias_atraso,
                    estadoMorosidad: null,
                  })
                }
              />
            )
          })}
        </div>
      )}

      <TelemercadeoCallModal
        open={modalOpen}
        cliente={clienteSeleccionado}
        onClose={handleClose}
      />
      <ModalRenderer />
    </div>
  )
}
