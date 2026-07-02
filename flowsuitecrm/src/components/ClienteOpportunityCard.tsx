import { Button } from './Button'
import { getClientOpportunityStageLabel, getClientOpportunityStatusLabel } from '../constants/opportunities'
import type { CarteraOpportunityGuard } from '../lib/carteraOpportunityGuard'

type ClienteOpportunityCardOpportunity = {
  id: string
  owner_id: string | null
  etapa: string | null
  estado?: string | null
  producto_recomendado?: string | null
  categoria_producto?: string | null
  next_action?: string | null
  next_action_date?: string | null
  blocked_by_cartera?: boolean | null
  motivo_bloqueo?: string | null
}

type ClienteOpportunityCardProps = {
  opportunity: ClienteOpportunityCardOpportunity | null
  guard: CarteraOpportunityGuard | null
  loading?: boolean
  onOpen: () => void
  onCreate: () => void
  onRefer: () => void
  onResolveCartera: () => void
}

function toneFromGuard(status: CarteraOpportunityGuard['status'] | null | undefined) {
  if (status === 'blocked') {
    return {
      border: '#dc2626',
      bg: '#fef2f2',
      text: '#991b1b',
      label: 'Bloqueada por cartera',
    }
  }
  if (status === 'warning') {
    return {
      border: '#f59e0b',
      bg: '#fff7ed',
      text: '#9a3412',
      label: 'Revisar cartera',
    }
  }
  return {
    border: '#10b981',
    bg: '#ecfdf5',
    text: '#065f46',
    label: 'Lista para conversion',
  }
}

export function ClienteOpportunityCard({
  opportunity,
  guard,
  loading = false,
  onOpen,
  onCreate,
  onRefer,
  onResolveCartera,
}: ClienteOpportunityCardProps) {
  const tone = toneFromGuard(guard?.status)

  return (
    <div
      style={{
        border: `1px solid ${tone.border}33`,
        borderLeft: `4px solid ${tone.border}`,
        borderRadius: '0.8rem',
        padding: '0.9rem 1rem',
        background: 'var(--color-surface, #fff)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-muted, #6b7280)', textTransform: 'uppercase' }}>
            Oportunidad activa
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignSelf: 'flex-start',
              padding: '0.2rem 0.55rem',
              borderRadius: '999px',
              background: tone.bg,
              color: tone.text,
              fontSize: '0.72rem',
              fontWeight: 700,
            }}
          >
            {tone.label}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {guard?.status === 'blocked' ? (
            <Button type="button" onClick={onResolveCartera}>
              Resolver cuenta primero
            </Button>
          ) : (
            <Button type="button" onClick={opportunity ? onOpen : onCreate}>
              {opportunity ? 'Abrir oportunidad' : 'Nueva oportunidad'}
            </Button>
          )}
          <Button variant="ghost" type="button" onClick={onRefer}>
            Capturar referido
          </Button>
        </div>
      </div>

      {loading ? (
        <span style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.86rem' }}>Cargando oportunidad...</span>
      ) : opportunity ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem 1rem' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.15rem' }}>Producto recomendado</div>
            <div style={{ fontWeight: 700 }}>{opportunity.producto_recomendado ?? 'Sin definir'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.15rem' }}>Categoria</div>
            <div>{opportunity.categoria_producto ?? 'Sin categoria'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.15rem' }}>Etapa</div>
            <div>{getClientOpportunityStageLabel(opportunity.etapa)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.15rem' }}>Estado</div>
            <div>{getClientOpportunityStatusLabel(opportunity.estado)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.15rem' }}>Proximo paso</div>
            <div>{opportunity.next_action ?? 'Sin proxima accion'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.15rem' }}>Fecha proxima accion</div>
            <div>{opportunity.next_action_date ?? 'Sin fecha'}</div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '0.15rem' }}>Motivo cartera</div>
            <div>{guard?.reason ?? opportunity.motivo_bloqueo ?? 'Sin bloqueos'}</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <span style={{ fontWeight: 700 }}>No hay oportunidad activa para este cliente.</span>
          <span style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.84rem' }}>
            Usa este bloque para abrir una conversion comercial sin mezclarla con cartera.
          </span>
          {guard?.status !== 'clear' && (
            <span style={{ color: tone.text, fontSize: '0.82rem' }}>{guard?.reason}</span>
          )}
        </div>
      )}
    </div>
  )
}
