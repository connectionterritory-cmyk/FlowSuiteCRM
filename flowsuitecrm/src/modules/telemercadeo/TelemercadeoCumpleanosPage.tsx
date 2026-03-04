import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { useMessaging } from '../../hooks/useMessaging'
import { ClienteCard, diasParaCumple, nombreCompleto, type Cliente } from './TelemercadeoShared'
import { TelemercadeoCallModal } from './TelemercadeoCallModal'
import { useTelemercadeoClientes } from './telemercadeoData'

export function TelemercadeoCumpleanosPage() {
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { clientes } = useTelemercadeoClientes()
  const [modalOpen, setModalOpen] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [dayFilter, setDayFilter] = useState('')
  const [onlyToday, setOnlyToday] = useState(false)

  const monthLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('es-MX', { month: 'long' })
    const label = formatter.format(new Date())
    return label.charAt(0).toUpperCase() + label.slice(1)
  }, [])

  const clientesCumpleanos = useMemo(() => {
    const hoy = new Date()
    const mesActual = hoy.getMonth()
    const todayDay = String(hoy.getDate()).padStart(2, '0')
    const targetDay = onlyToday ? todayDay : dayFilter
    return clientes
      .filter((c) => {
        if (!c.fecha_nacimiento) return false
        const nacimiento = new Date(`${c.fecha_nacimiento}T00:00:00`)
        if (nacimiento.getMonth() !== mesActual) return false
        if (!targetDay) return true
        const day = String(nacimiento.getDate()).padStart(2, '0')
        return day === targetDay
      })
      .sort((a, b) => {
        const dayA = new Date(`${a.fecha_nacimiento}T00:00:00`).getDate()
        const dayB = new Date(`${b.fecha_nacimiento}T00:00:00`).getDate()
        return dayA - dayB
      })
  }, [clientes, dayFilter, onlyToday])

  const abrirModal = (cliente: Cliente) => {
    setClienteSeleccionado(cliente)
    setModalOpen(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Cumpleaños en {monthLabel}</h3>
      <div
        style={{
          display: 'flex',
          gap: '0.8rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '0.35rem 0.6rem',
          border: '1px solid var(--color-border, #e5e7eb)',
          borderRadius: '0.6rem',
          background: 'var(--color-surface, #f9fafb)',
          width: 'fit-content',
        }}
      >
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            setOnlyToday(true)
            setDayFilter('')
          }}
          style={{
            padding: '0.35rem 0.9rem',
            borderRadius: '999px',
            fontWeight: 700,
            height: '36px',
            borderColor: onlyToday ? 'var(--color-primary, #3b82f6)' : undefined,
            background: onlyToday ? 'rgba(59, 130, 246, 0.12)' : undefined,
            color: onlyToday ? 'var(--color-primary, #3b82f6)' : undefined,
            boxShadow: onlyToday ? '0 6px 12px rgba(59, 130, 246, 0.18)' : undefined,
          }}
        >
          Hoy
        </Button>
        <span style={{ width: '1px', height: '24px', background: 'var(--color-border, #e5e7eb)' }} />
        <select
          value={dayFilter}
          onChange={(event) => {
            setDayFilter(event.target.value)
            setOnlyToday(false)
          }}
          style={{
            minWidth: '120px',
            height: '36px',
            borderRadius: '0.55rem',
            border: '1px solid var(--color-border, #e5e7eb)',
            padding: '0 0.6rem',
            background: 'var(--color-input, #ffffff)',
            color: 'var(--color-text, #111827)',
            boxShadow: 'none',
            fontSize: '0.85rem',
          }}
        >
          <option value="">Día del mes</option>
          {Array.from({ length: 31 }, (_, idx) => String(idx + 1).padStart(2, '0')).map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
      </div>
      {clientesCumpleanos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
          No hay cumpleaños este mes
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
                  {esHoy ? '🎉 ¡Hoy es su cumpleaños!' : `🎂 Cumple el ${String(new Date(`${c.fecha_nacimiento}T00:00:00`).getDate()).padStart(2, '0')}`}
                </p>
              }
              onLlamar={() => abrirModal(c)}
              onWhatsApp={() => openWhatsapp({ nombre: nombreCompleto(c), telefono: c.telefono ?? '', clienteId: c.id }, 'client.cumpleanos')}
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
