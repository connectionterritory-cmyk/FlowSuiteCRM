import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'

export function ProgramasPage() {
  const { t } = useTranslation()

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('programas.title')}
        subtitle={t('programas.subtitle')}
      />
      <div className="grid-2">
        <div className="card">
          <h3>{t('programas.cards.conexiones.title')}</h3>
          <p>{t('programas.cards.conexiones.description')}</p>
          <Link to="/conexiones-infinitas">
            <Button variant="ghost">{t('common.verModulo')}</Button>
          </Link>
        </div>
        <div className="card">
          <h3>{t('programas.cards.cuatroEnCatorce.title')}</h3>
          <p>{t('programas.cards.cuatroEnCatorce.description')}</p>
          <Link to="/4en14">
            <Button variant="ghost">{t('common.verModulo')}</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
