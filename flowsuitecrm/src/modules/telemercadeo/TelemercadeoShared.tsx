import type { ReactNode } from 'react'
import { buildTelUrl } from '../../lib/addressUtils'
import { nombreCompleto, segmentoColor, segmentoLabel } from './telemercadeoSharedUtils'

export type Cliente = {
  id: string
  org_id?: string | null
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
  ultima_fecha_pago: string | null
  hycite_id: string | null
  estado_cuenta: string | null
  nivel: number | null
  next_action: string | null
  next_action_date: string | null
  vendedor_id: string | null
}

export type EquipoInstalado = {
  id: string
  cliente_id: string
  fecha_instalacion: string | null
  activo: boolean | null
  cliente?: Cliente
  ultimo_servicio?: string | null
}

export type ResultadoLlamada =
  | 'no_contesta'
  | 'cita_agendada'
  | 'pago_prometido'
  | 'pago_realizado'
  | 'no_interesado'
  | 'numero_equivocado'

export type SegmentoTab = 'todos' | '0_30' | '31_60' | '61_90' | 'mas_90' | 'hoy' | 'promesas_vencidas'

export function ClienteCard({
  cliente,
  vendedor,
  extra,
  onLlamar,
  onWhatsApp,
}: {
  cliente: Cliente
  vendedor?: string | null
  extra?: ReactNode
  onLlamar: () => void
  onWhatsApp: () => void
}) {
  const seg = segmentoLabel(cliente.dias_atraso, cliente.monto_moroso)
  const color = segmentoColor(cliente.dias_atraso, cliente.monto_moroso)

  return (
    <div
      style={{
        padding: '1rem 1.25rem',
        background: 'var(--color-card, #1b2230)',
        borderRadius: '0.75rem',
        border: '1px solid var(--color-border, #2b3244)',
        color: 'var(--color-text, #f8fafc)',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.18)',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: '200px' }}>
        <p
          style={{
            margin: 0,
            fontWeight: 700,
            fontSize: '0.98rem',
            color: 'var(--color-text, #f8fafc)',
          }}
        >
          {nombreCompleto(cliente)}
        </p>
        <p
          style={{
            margin: '0.2rem 0 0',
            fontSize: '0.8rem',
            color: 'var(--color-text-muted, #cbd5f5)',
          }}
        >
          {cliente.telefono ?? cliente.telefono_casa ?? 'Sin teléfono'}
          {cliente.hycite_id && ` · #${cliente.hycite_id}`}
          {vendedor && <span style={{ opacity: 0.8 }}> · 👤 {vendedor}</span>}
        </p>
        {extra}
      </div>

      <div style={{ textAlign: 'center' }}>
        {cliente.saldo_actual !== null && (
          <p
            style={{
              margin: 0,
              fontWeight: 700,
              fontSize: '0.9rem',
              color: 'var(--color-text, #f8fafc)',
            }}
          >
            ${Number(cliente.saldo_actual).toFixed(2)}
          </p>
        )}
        {(cliente.monto_moroso ?? 0) > 0 && (
          <p
            style={{
              margin: '0.1rem 0 0',
              fontWeight: 700,
              fontSize: '0.78rem',
              color: '#ef4444',
            }}
          >
            ${Number(cliente.monto_moroso).toFixed(2)} moroso
          </p>
        )}
        <span
          style={{
            display: 'inline-block',
            padding: '0.15rem 0.6rem',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 700,
            background: color + '22',
            color,
            marginTop: '0.25rem',
            border: `1px solid ${color}44`,
          }}
        >
          {seg}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onWhatsApp}
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '0.55rem',
            border: '1px solid rgba(34, 197, 94, 0.35)',
            background: 'rgba(34, 197, 94, 0.16)',
            color: '#22c55e',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.8rem',
          }}
        >
          WhatsApp
        </button>
        {(cliente.telefono || cliente.telefono_casa) && (
          <a
            href={buildTelUrl(cliente.telefono ?? cliente.telefono_casa ?? '')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.5rem 0.75rem',
              borderRadius: '0.55rem',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              background: 'rgba(16, 185, 129, 0.16)',
              color: '#10b981',
              fontWeight: 600,
              fontSize: '0.8rem',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Llamar
          </a>
        )}
        <button
          type="button"
          onClick={onLlamar}
          style={{
            padding: '0.5rem 0.8rem',
            borderRadius: '0.55rem',
            border: '1px solid rgba(59, 130, 246, 0.55)',
            background: 'var(--color-primary, #3b82f6)',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.8rem',
            boxShadow: '0 6px 14px rgba(59, 130, 246, 0.25)',
          }}
        >
          Registrar
        </button>
      </div>
    </div>
  )
}
