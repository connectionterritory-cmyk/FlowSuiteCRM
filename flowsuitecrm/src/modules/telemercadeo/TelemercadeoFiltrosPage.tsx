import { useMemo, useState } from 'react'
import { useMessaging } from '../../hooks/useMessaging'
import { ClienteCard, nombreCompleto, type Cliente } from './TelemercadeoShared'
import { TelemercadeoCallModal } from './TelemercadeoCallModal'
import { useTelemercadeoEquipos } from './telemercadeoData'

export function TelemercadeoFiltrosPage() {
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { equipos, loading } = useTelemercadeoEquipos()
  const [modalOpen, setModalOpen] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)

  const equiposFiltros = useMemo(() => {
    return equipos.filter((eq) => {
      if (!eq.fecha_instalacion) return false
      const instalacion = new Date(eq.fecha_instalacion)
      const mesesDesde =
        (new Date().getTime() - instalacion.getTime()) / (1000 * 60 * 60 * 24 * 30)
      return mesesDesde >= 6
    })
  }, [equipos])

  const abrirModal = (cliente: Cliente) => {
    setClienteSeleccionado(cliente)
    setModalOpen(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Cargando...</p>
      ) : equiposFiltros.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
          No hay filtros próximos a vencer
        </div>
      ) : (
        equiposFiltros.map((eq) => {
          const cliente = eq.cliente as unknown as Cliente
          if (!cliente) return null
          const instalacion = new Date(eq.fecha_instalacion!)
          const meses = Math.floor(
            (new Date().getTime() - instalacion.getTime()) / (1000 * 60 * 60 * 24 * 30)
          )
          return (
            <ClienteCard
              key={eq.id}
              cliente={cliente}
              extra={
                <p
                  style={{
                    margin: '0.3rem 0 0',
                    fontSize: '0.78rem',
                    color: meses >= 12 ? '#dc2626' : '#f59e0b',
                  }}
                >
                  🔧 {meses} meses desde instalación — {meses >= 12 ? 'Cambio urgente' : 'Cambio próximo'}
                </p>
              }
              onLlamar={() => abrirModal(cliente)}
              onWhatsApp={() => openWhatsapp({ nombre: nombreCompleto(cliente), telefono: cliente.telefono ?? '' })}
            />
          )
        })
      )}

      <TelemercadeoCallModal
        open={modalOpen}
        cliente={clienteSeleccionado}
        onClose={() => setModalOpen(false)}
      />
      <ModalRenderer />
    </div>
  )
}
