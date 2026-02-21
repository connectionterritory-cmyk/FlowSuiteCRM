import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'

type SalesPoint = {
  label: string
  key: string
  value: number
}

type PipelineSlice = {
  key: string
  label: string
  value: number
  color: string
}

const stageColors: Record<string, string> = {
  nuevo: '#60a5fa',
  contactado: '#3b82f6',
  cita: '#2563eb',
  demo: '#1d4ed8',
  cierre: '#1e40af',
  descartado: '#9ca3af',
}

export function useDashboardCharts() {
  const { t, i18n } = useTranslation()
  const configured = isSupabaseConfigured
  const [salesSeries, setSalesSeries] = useState<SalesPoint[]>([])
  const [pipelineSeries, setPipelineSeries] = useState<PipelineSlice[]>([])
  const [loading, setLoading] = useState(true)

  const months = useMemo(() => {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat(i18n.language, { month: 'short' })
    const result: SalesPoint[] = []

    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const label = `${formatter.format(date)} ${String(date.getFullYear()).slice(-2)}`
      result.push({ key, label, value: 0 })
    }
    return result
  }, [i18n.language])

  useEffect(() => {
    setSalesSeries(months)
  }, [months])

  useEffect(() => {
    const baseStages = ['nuevo', 'contactado', 'cita', 'demo', 'cierre', 'descartado']
    setPipelineSeries(
      baseStages.map((stage) => ({
        key: stage,
        label: t(`pipeline.columns.${stage}`),
        value: 0,
        color: stageColors[stage],
      }))
    )
  }, [t])

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }

    const fetchCharts = async () => {
      setLoading(true)
      const startDate = new Date()
      startDate.setMonth(startDate.getMonth() - 11)
      startDate.setDate(1)

      const { data: ventasData } = await supabase
        .from('ventas')
        .select('fecha_venta, monto')
        .gte('fecha_venta', startDate.toISOString().slice(0, 10))

      const totals = new Map<string, number>()
      ;(ventasData ?? []).forEach((row) => {
        const fecha = row.fecha_venta as string | null
        if (!fecha) return
        const key = fecha.slice(0, 7)
        const current = totals.get(key) ?? 0
        totals.set(key, current + (row.monto ?? 0))
      })

      setSalesSeries(
        months.map((month) => ({
          ...month,
          value: totals.get(month.key) ?? 0,
        }))
      )

      const { data: leadsData } = await supabase.from('leads').select('estado_pipeline')
      const stageTotals: Record<string, number> = {
        nuevo: 0,
        contactado: 0,
        cita: 0,
        demo: 0,
        cierre: 0,
        descartado: 0,
      }

      ;(leadsData ?? []).forEach((row) => {
        let stage = (row as { estado_pipeline?: string | null }).estado_pipeline ?? 'nuevo'
        if (stage === 'calificado') stage = 'cita'
        if (stage === 'demostracion') stage = 'demo'
        if (stageTotals[stage] === undefined) return
        stageTotals[stage] += 1
      })

      setPipelineSeries(
        Object.keys(stageTotals).map((stage) => ({
          key: stage,
          label: t(`pipeline.columns.${stage}`),
          value: stageTotals[stage] ?? 0,
          color: stageColors[stage],
        }))
      )
      setLoading(false)
    }

    fetchCharts()
  }, [configured, months, t])

  return { salesSeries, pipelineSeries, loading, configured }
}
