import { BusinessUnitCard } from './BusinessUnitCard'
import type { BusinessUnit } from './hub.types'

type BusinessUnitGridProps = {
  units: BusinessUnit[]
}

export function BusinessUnitGrid({ units }: BusinessUnitGridProps) {
  return (
    <section className="page-stack">
      <div className="hub-section-heading">
        <p className="hub-section-kicker">Mis lineas de negocio</p>
        <h3>Accesos por unidad</h3>
      </div>
      <div className="hub-business-grid">
        {units.map((unit) => (
          <BusinessUnitCard key={unit.title} unit={unit} />
        ))}
      </div>
    </section>
  )
}
