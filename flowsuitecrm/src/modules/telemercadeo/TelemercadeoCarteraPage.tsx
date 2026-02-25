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
}

export function TelemercadeoCarteraPage() {
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { clientes, loading } = useTelemercadeoClientes()
  const [segmento, setSegmento] = useState<SegmentoTab>('todos')
  const [modalOpen, setModalOpen] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [lastCallMap, setLastCallMap] = useState<Record<string, LastCall>>({})

  // Batch-load the most recent call per client
  useEffect(() => {
    if (clientes.length === 0) {
      setLastCallMap({})
      return
    }
    const ids = clientes.map((c) => c.id)
    const load = async () => {
      const { data } = await supabase
        .from('llamadas_telemercadeo')
        .select('cliente_id, resultado, created_at')
        .in('cliente_id', ids)
        .order('created_at', { ascending: false })
      const map: Record<string, LastCall> = {}
      for (const row of (data ?? []) as { cliente_id: string; resultado: string; created_at: string }[]) {
        if (!map[row.cliente_id]) {
          map[row.cliente_id] = { resultado: row.resultado, created_at: row.created_at }
        }
      }
      setLastCallMap(map)
    }
    load()
  }, [clientes])

  const clientesCartera = useMemo(() => {
    return clientes.filter((c) => {
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

  const abrirModal = (cliente: Cliente) => {
    setClienteSeleccionado(cliente)
    setModalOpen(true)
  }

  const handleClose = () => {
    setModalOpen(false)
    // Refresh last calls after registering a new one
    if (clientes.length === 0) return
    const ids = clientes.map((c) => c.id)
    supabase
      .from('llamadas_telemercadeo')
      .select('cliente_id, resultado, created_at')
      .in('cliente_id', ids)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const map: Record<string, LastCall> = {}
        for (const row of (data ?? []) as { cliente_id: string; resultado: string; created_at: string }[]) {
          if (!map[row.cliente_id]) {
            map[row.cliente_id] = { resultado: row.resultado, created_at: row.created_at }
          }
        }
        setLastCallMap(map)
      })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {[
          { key: 'todos', label: 'Todos', color: '#6b7280' },
          { key: '0_30', label: '0-30 días', color: '#f59e0b' },
          { key: '31_60', label: '31-60 días', color: '#ea580c' },
          { key: '61_90', label: '61-90 días', color: '#dc2626' },
          { key: 'mas_90', label: '+90 días', color: '#7c3aed' },
        ].map((s) => (
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
                  openWhatsapp({ nombre: nombreCompleto(c), telefono: c.telefono ?? '' })
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
