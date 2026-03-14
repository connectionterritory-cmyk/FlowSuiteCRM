import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { StatCard } from '../../components/StatCard'
import { Badge } from '../../components/Badge'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/Button'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'
import { useDashboardCharts } from '../../hooks/useDashboardCharts'
import { useConversionKpis, type ConversionRange } from '../../hooks/useConversionKpis'
import { LineChart } from '../../components/LineChart'
import { DonutChart } from '../../components/DonutChart'
import { AgendaHoy } from '../../components/AgendaHoy'

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const {
    metrics,
    loading,
    configured,
    error: metricsError,
    scopePending: metricsScopePending,
  } = useDashboardMetrics()
  const {
    salesSeries,
    pipelineSeries,
    loading: chartsLoading,
    error: chartsError,
    scopePending: chartsScopePending,
  } = useDashboardCharts()
  const [conversionRange, setConversionRange] = useState<ConversionRange>('semana')
  const {
    data: conversionKpis,
    loading: conversionLoading,
    error: conversionError,
    scopePending: conversionScopePending,
  } = useConversionKpis(conversionRange)

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  )

  const percentFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }),
    [i18n.language],
  )

  const moneyFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }),
    [i18n.language],
  )

  const formatValue = (value: number) => numberFormat.format(value)
  const formatPercent = (value: number) => `${percentFormat.format(value)}%`
  const formatMoney = (value: number) => moneyFormat.format(value)

  const metricsBusy = loading || metricsScopePending
  const chartsBusy = chartsLoading || chartsScopePending
  const conversionBusy = conversionLoading || conversionScopePending
  const scopePendingLabel = 'Resolviendo alcance...'
  const metricsUnavailable = Boolean(metricsError) && !metricsBusy
  const conversionUnavailable = Boolean(conversionError) && !conversionBusy

  const renderMetricValue = (value: number) => {
    if (metricsScopePending) return scopePendingLabel
    if (loading) return t('common.loading')
    if (metricsUnavailable) return t('common.noData')
    return formatValue(value)
  }

  const renderConversionValue = (value: number, formatter: (next: number) => string) => {
    if (conversionScopePending) return scopePendingLabel
    if (conversionLoading) return t('common.loading')
    if (conversionUnavailable) return t('common.noData')
    return formatter(value)
  }

  const conversionRanges: { key: ConversionRange; label: string }[] = [
    { key: 'hoy', label: t('dashboard.conversion.ranges.hoy') },
    { key: 'semana', label: t('dashboard.conversion.ranges.semana') },
    { key: 'mes', label: t('dashboard.conversion.ranges.mes') },
  ]

  if (!configured) {
    return (
      <div className="page-stack">
        <SectionHeader
          title={t('dashboard.title')}
          subtitle={t('dashboard.subtitle')}
          action={<Badge label={t('dashboard.periodoActual')} tone="gold" />}
        />
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        action={<Badge label={t('dashboard.periodoActual')} tone="gold" />}
      />

      <div className="stat-grid">
        <StatCard
          label={t('dashboard.metrics.leadsNuevos')}
          value={renderMetricValue(metrics.leadsNew)}
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label={t('dashboard.metrics.oportunidadesActivas')}
          value={renderMetricValue(metrics.opportunitiesActive)}
          onClick={() => navigate('/pipeline')}
        />
        <StatCard
          label={t('dashboard.metrics.demos')}
          value={renderMetricValue(metrics.demos)}
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label={t('dashboard.metrics.ventasMes')}
          value={renderMetricValue(metrics.salesMonth)}
          onClick={() => navigate('/ventas')}
        />
        <StatCard
          label={t('dashboard.metrics.embajadoresSilver')}
          value={renderMetricValue(metrics.ambassadorsSilver)}
          accent="gold"
          onClick={() => navigate('/conexiones-infinitas')}
        />
        <StatCard
          label={t('dashboard.metrics.embajadoresGold')}
          value={renderMetricValue(metrics.ambassadorsGold)}
          accent="gold"
          onClick={() => navigate('/conexiones-infinitas')}
        />
        <StatCard
          label={t('dashboard.metrics.volumenAnual')}
          value={renderMetricValue(metrics.ambassadorsVolumeAnnual)}
          accent="gold"
          onClick={() => navigate('/conexiones-infinitas')}
        />
        <StatCard
          label={t('dashboard.metrics.ciclosActivos')}
          value={renderMetricValue(metrics.cyclesActive)}
          onClick={() => navigate('/4en14')}
        />
        <StatCard
          label={t('dashboard.metrics.serviciosVencidos')}
          value={renderMetricValue(metrics.servicesOverdue)}
          onClick={() => navigate('/telemercadeo/filtros')}
        />
        <StatCard
          label={t('dashboard.metrics.serviciosProximos')}
          value={renderMetricValue(metrics.servicesDueSoon)}
          onClick={() => navigate('/telemercadeo/filtros')}
        />
        <StatCard
          label={t('dashboard.metrics.cumpleanos')}
          value={renderMetricValue(metrics.birthdaysUpcoming)}
          onClick={() => navigate('/telemercadeo/cumpleanos')}
        />
      </div>

      <AgendaHoy />

      <div className="card" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>{t('dashboard.conversion.title')}</h3>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--color-text-muted, #6b7280)' }}>
              {t('dashboard.conversion.subtitle')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {conversionRanges.map((range) => {
              const selected = range.key === conversionRange
              return (
                <Button
                  key={range.key}
                  variant="ghost"
                  onClick={() => setConversionRange(range.key)}
                  style={selected ? { background: 'rgba(59,130,246,0.12)' } : undefined}
                >
                  {range.label}
                </Button>
              )
            })}
          </div>
        </div>
        <div className="stat-grid">
          <StatCard
            label={t('dashboard.conversion.metrics.programadas')}
            value={renderConversionValue(conversionKpis.citas.programadas, formatValue)}
            hint={t('dashboard.conversion.previous', { value: formatValue(conversionKpis.prev.citas_programadas) })}
          />
          <StatCard
            label={t('dashboard.conversion.metrics.completadas')}
            value={renderConversionValue(conversionKpis.citas.completadas, formatValue)}
            hint={t('dashboard.conversion.previous', { value: formatValue(conversionKpis.prev.citas_completadas) })}
          />
          <StatCard
            label={t('dashboard.conversion.metrics.noShow')}
            value={renderConversionValue(conversionKpis.citas.no_show, formatValue)}
            hint={t('dashboard.conversion.previous', { value: formatValue(conversionKpis.prev.citas_no_show) })}
          />
          <StatCard
            label={t('dashboard.conversion.metrics.tasaAsistencia')}
            value={renderConversionValue(conversionKpis.citas.tasa_asistencia, formatPercent)}
          />
          <StatCard
            label={t('dashboard.conversion.metrics.tasaConversion')}
            value={renderConversionValue(conversionKpis.conversion.tasa_conversion, formatPercent)}
          />
          <StatCard
            label={t('dashboard.conversion.metrics.ventasMonto')}
            value={renderConversionValue(conversionKpis.ventas.monto, formatMoney)}
            hint={t('dashboard.conversion.previous', { value: formatMoney(conversionKpis.prev.ventas_monto) })}
          />
        </div>
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
            data={chartsBusy || chartsError ? [] : salesSeries}
            emptyLabel={chartsScopePending ? scopePendingLabel : chartsLoading ? t('common.loading') : t('common.noData')}
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
            data={chartsBusy || chartsError ? [] : pipelineSeries}
            emptyLabel={chartsScopePending ? scopePendingLabel : chartsLoading ? t('common.loading') : t('common.noData')}
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
              <strong>{renderMetricValue(metrics.leadsNew)}</strong>
            </div>
            <div>
              <span>{t('dashboard.nextSteps.ciclos')}</span>
              <strong>{renderMetricValue(metrics.cyclesActive)}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
