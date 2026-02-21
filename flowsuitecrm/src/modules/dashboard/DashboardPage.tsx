import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { StatCard } from '../../components/StatCard'
import { Badge } from '../../components/Badge'
import { EmptyState } from '../../components/EmptyState'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'
import { useDashboardCharts } from '../../hooks/useDashboardCharts'
import { LineChart } from '../../components/LineChart'
import { DonutChart } from '../../components/DonutChart'

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const { metrics, loading, configured } = useDashboardMetrics()
  const { salesSeries, pipelineSeries, loading: chartsLoading } = useDashboardCharts()

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  )

  const formatValue = (value: number) => numberFormat.format(value)

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        action={<Badge label={t('dashboard.periodoActual')} tone="gold" />}
      />

      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}

      <div className="stat-grid">
        <StatCard
          label={t('dashboard.metrics.leadsNuevos')}
          value={loading ? t('common.loading') : formatValue(metrics.leadsNew)}
        />
        <StatCard
          label={t('dashboard.metrics.oportunidadesActivas')}
          value={loading ? t('common.loading') : formatValue(metrics.opportunitiesActive)}
        />
        <StatCard
          label={t('dashboard.metrics.demos')}
          value={loading ? t('common.loading') : formatValue(metrics.demos)}
        />
        <StatCard
          label={t('dashboard.metrics.ventasMes')}
          value={loading ? t('common.loading') : formatValue(metrics.salesMonth)}
        />
        <StatCard
          label={t('dashboard.metrics.embajadoresSilver')}
          value={loading ? t('common.loading') : formatValue(metrics.ambassadorsSilver)}
          accent="gold"
        />
        <StatCard
          label={t('dashboard.metrics.embajadoresGold')}
          value={loading ? t('common.loading') : formatValue(metrics.ambassadorsGold)}
          accent="gold"
        />
        <StatCard
          label={t('dashboard.metrics.volumenAnual')}
          value={loading ? t('common.loading') : formatValue(metrics.ambassadorsVolumeAnnual)}
          accent="gold"
        />
        <StatCard
          label={t('dashboard.metrics.ciclosActivos')}
          value={loading ? t('common.loading') : formatValue(metrics.cyclesActive)}
        />
        <StatCard
          label={t('dashboard.metrics.serviciosVencidos')}
          value={loading ? t('common.loading') : formatValue(metrics.servicesOverdue)}
        />
        <StatCard
          label={t('dashboard.metrics.serviciosProximos')}
          value={loading ? t('common.loading') : formatValue(metrics.servicesDueSoon)}
        />
        <StatCard
          label={t('dashboard.metrics.cumpleanos')}
          value={loading ? t('common.loading') : formatValue(metrics.birthdaysUpcoming)}
        />
      </div>

      <div className="grid-2">
        <div className="card chart-card">
          <div className="chart-header">
            <div>
              <h3>{t('dashboard.charts.salesTitle')}</h3>
              <p>{t('dashboard.charts.salesSubtitle')}</p>
            </div>
          </div>
          <LineChart
            data={chartsLoading ? [] : salesSeries}
            emptyLabel={chartsLoading ? t('common.loading') : t('common.noData')}
          />
        </div>
        <div className="card chart-card">
          <div className="chart-header">
            <div>
              <h3>{t('dashboard.charts.pipelineTitle')}</h3>
              <p>{t('dashboard.charts.pipelineSubtitle')}</p>
            </div>
            <Badge label={t('dashboard.charts.pipelineBadge')} tone="blue" />
          </div>
          <DonutChart
            data={chartsLoading ? [] : pipelineSeries}
            emptyLabel={chartsLoading ? t('common.loading') : t('common.noData')}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>{t('dashboard.highlights.title')}</h3>
          <p>{t('dashboard.highlights.description')}</p>
          <div className="badge-row">
            <Badge label={t('dashboard.highlights.pipeline')} tone="blue" />
            <Badge label={t('dashboard.highlights.servicio')} />
            <Badge label={t('dashboard.highlights.programas')} />
          </div>
        </div>
        <div className="card">
          <h3>{t('dashboard.nextSteps.title')}</h3>
          <p>{t('dashboard.nextSteps.description')}</p>
          <div className="stat-list">
            <div>
              <span>{t('dashboard.nextSteps.leads')}</span>
              <strong>{loading ? t('common.loading') : formatValue(metrics.leadsNew)}</strong>
            </div>
            <div>
              <span>{t('dashboard.nextSteps.ciclos')}</span>
              <strong>{loading ? t('common.loading') : formatValue(metrics.cyclesActive)}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
