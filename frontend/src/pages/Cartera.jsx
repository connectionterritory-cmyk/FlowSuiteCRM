import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

const getDaysOverdue = (row) =>
  row?.dias_mora || row?.dias_atraso || row?.days_overdue || row?.dias

export default function Cartera() {
  const { orgId } = useOrg()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const load = async () => {
      if (!supabase || !orgId) {
        setLoading(false)
        return
      }
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('cuentarp')
        .select('*')
        .eq('org_id', orgId)
        .limit(200)

      if (fetchError) {
        setError('Tabla cuentarp no disponible o sin permisos')
        setRows([])
      } else {
        setError(null)
        setRows(data ?? [])
      }
      setLoading(false)
    }

    load()
  }, [orgId])

  const buckets = useMemo(() => {
    const result = {
      '0-30': [],
      '31-60': [],
      '61-90': [],
      '90+': [],
    }
    rows.forEach((row) => {
      const days = Number(getDaysOverdue(row) ?? 0)
      if (days <= 30) result['0-30'].push(row)
      else if (days <= 60) result['31-60'].push(row)
      else if (days <= 90) result['61-90'].push(row)
      else result['90+'].push(row)
    })
    return result
  }, [rows])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold font-display">Cartera (Aging)</h1>
        <p className="text-sm text-slate-600">
          Buckets 0-30 / 31-60 / 61-90 / 90+ con proxima accion. >90 genera Cargo de vuelta + PTP.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-warning bg-white p-4 text-sm font-semibold text-warning">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {Object.entries(buckets).map(([label, list]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-base">{label} dias</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-ink">{list.length}</p>
              <p className="text-xs text-slate-600">Proxima accion requerida</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cargo de vuelta (>90 dias)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-slate-600">Cargando...</p> : null}
          {!loading && buckets['90+'].length === 0 ? (
            <p className="text-sm text-slate-600">Sin casos</p>
          ) : null}
          {buckets['90+'].slice(0, 6).map((row, index) => (
            <div key={row.id ?? `overdue-${index}`} className="flex items-center justify-between">
              <span className="text-sm text-ink">Cuenta #{row?.numero || row?.id || 'N/A'}</span>
              <Badge variant="warning">PTP requerido</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
