import { Button } from '../../components/Button'

type ActivacionCardProps = {
  clienteNombre: string
  clienteTelefono?: string | null
  programaNombre: string
  estado: string
  onWhatsapp: () => void
  labels: {
    cliente: string
    programa: string
    telefono: string
    whatsapp: string
  }
}

export function ActivacionCard({
  clienteNombre,
  clienteTelefono,
  programaNombre,
  estado,
  onWhatsapp,
  labels,
}: ActivacionCardProps) {
  return (
    <article className="activation-card">
      <div className="activation-card-header">
        <div>
          <p className="activation-card-kicker">{labels.cliente}</p>
          <h3>{clienteNombre}</h3>
        </div>
        <span className={`activation-card-state state-${estado}`}>{estado}</span>
      </div>
      <div className="activation-card-meta">
        <div>
          <p className="activation-card-kicker">{labels.programa}</p>
          <strong>{programaNombre}</strong>
        </div>
        <div>
          <p className="activation-card-kicker">{labels.telefono}</p>
          <span>{clienteTelefono ?? '-'}</span>
        </div>
      </div>
      <div className="activation-card-actions">
        <Button type="button" onClick={onWhatsapp} className="activation-card-btn">
          {labels.whatsapp}
        </Button>
      </div>
    </article>
  )
}
