import { useMemo, useState } from 'react'
import { useMessaging } from '../../hooks/useMessaging'
import { ClienteCard, diasParaCumple, nombreCompleto, type Cliente } from './TelemercadeoShared'
import { TelemercadeoCallModal } from './TelemercadeoCallModal'
import { useTelemercadeoClientes } from './telemercadeoData'

export function TelemercadeoCumpleanosPage() {
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { clientes } = useTelemercadeoClientes()
  const [modalOpen, setModalOpen] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)

  const clientesCumpleanos = useMemo(() => {
    return clientes
      .filter((c) => {
        const dias = diasParaCumple(c.fecha_nacimiento)
        return dias <= 30
      })
      .sort((a, b) => diasParaCumple(a.fecha_nacimiento) - diasParaCumple(b.fecha_nacimiento))
  }, [clientes])

  const abrirModal = (cliente: Cliente) => {
    setClienteSeleccionado(cliente)
    setModalOpen(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {clientesCumpleanos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
          No hay cumpleaños en los próximos 30 días
        </div>
      ) : (
        clientesCumpleanos.map((c) => {
          const dias = diasParaCumple(c.fecha_nacimiento)
          const esHoy = dias === 0
          return (
            <ClienteCard
              key={c.id}
              cliente={c}
              extra={
                <p
                  style={{
                    margin: '0.3rem 0 0',
                    fontSize: '0.78rem',
                    color: esHoy ? '#f59e0b' : 'var(--color-text-muted)',
                  }}
                >
                  {esHoy ? '🎉 ¡Hoy es su cumpleaños!' : `🎂 Cumple en ${dias} días`}
                </p>
              }
              onLlamar={() => abrirModal(c)}
              onWhatsApp={() => openWhatsapp({ nombre: nombreCompleto(c), telefono: c.telefono ?? '' })}
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
