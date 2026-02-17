import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

const columns = [
  { id: 'prospect', label: 'Prospeccion' },
  { id: 'followup', label: 'Seguimiento' },
  { id: 'proposal', label: 'Propuesta' },
  { id: 'closing', label: 'Cierre' },
  { id: 'won', label: 'Ganado' },
]

const normalizeStage = (value) => {
  const stage = String(value ?? '').toLowerCase()
  if (stage.includes('ganado') || stage.includes('won')) return 'won'
  if (stage.includes('cierre') || stage.includes('closing')) return 'closing'
  if (stage.includes('propuesta') || stage.includes('proposal')) return 'proposal'
  if (stage.includes('seguimiento') || stage.includes('follow')) return 'followup'
  return 'prospect'
}

const getProductObjective = (opp) =>
  opp?.producto_objetivo ||
  opp?.productoObjetivo ||
  opp?.producto ||
  opp?.product ||
  opp?.objetivo_producto ||
  opp?.objetivo ||
  'Sin producto objetivo'

const getNextAction = (opp) =>
  opp?.proxima_accion ||
  opp?.next_action ||
  opp?.accion_siguiente ||
  'Sin proxima accion'

const getNextActionDate = (opp) =>
  opp?.proxima_accion_fecha ||
  opp?.next_action_date ||
  opp?.fecha_proxima_accion ||
  null

const getAmount = (opp) =>
  opp?.monto || opp?.amount || opp?.valor || opp?.valor_total || opp?.total

const shouldShowAmount = (opp) => {
  const stage = String(opp?.estado || opp?.stage || opp?.status || '').toLowerCase()
  const isWon = stage.includes('ganado') || stage.includes('won') || stage.includes('cerrado')
  const orderConfirmed = Boolean(opp?.orden_confirmada || opp?.order_confirmed)
  return isWon || orderConfirmed
}

export default function Pipeline() {
  const { orgId } = useOrg()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [opportunities, setOpportunities] = useState([])

  useEffect(() => {
    const load = async () => {
      if (!supabase || !orgId) {
        setLoading(false)
        return
      }

      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('oportunidades')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(60)

      if (fetchError) {
        setError(fetchError.message)
        setOpportunities([])
      } else {
        setError(null)
        setOpportunities(data ?? [])
      }

      setLoading(false)
    }

    load()
  }, [orgId])

  const grouped = useMemo(() => {
    const map = new Map(columns.map((col) => [col.id, []]))
    opportunities.forEach((opp) => {
      const stage = normalizeStage(opp?.etapa || opp?.estado || opp?.stage)
      map.get(stage)?.push(opp)
    })
    return map
  }, [opportunities])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold font-display">Pipeline Kanban</h1>
        <p className="text-sm text-slate-600">
          Producto objetivo siempre visible. Monto solo si cierre=Ganado o hay orden confirmada.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-warning bg-white p-4 text-sm font-semibold text-warning">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        {columns.map((col) => (
          <div key={col.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">{col.label}</h2>
              <Badge>{grouped.get(col.id)?.length ?? 0}</Badge>
            </div>
            <div className="space-y-3">
              {loading ? (
                <Card>
                  <CardContent className="text-sm text-slate-600">Cargando...</CardContent>
                </Card>
              ) : null}
              {!loading && (grouped.get(col.id)?.length ?? 0) === 0 ? (
                <Card>
                  <CardContent className="text-sm text-slate-600">Sin oportunidades</CardContent>
                </Card>
              ) : null}
              {(grouped.get(col.id) ?? []).map((opp, index) => (
                <Card key={opp.id ?? `${col.id}-${index}`}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {opp?.titulo || opp?.nombre || opp?.name || 'Oportunidad'}
                    </CardTitle>
                    <p className="text-xs text-slate-600">
                      Producto objetivo: <strong>{getProductObjective(opp)}</strong>
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Proxima accion</p>
                      <p className="text-sm text-ink">{getNextAction(opp)}</p>
                      {getNextActionDate(opp) ? (
                        <p className="text-xs text-slate-600">Fecha: {getNextActionDate(opp)}</p>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Monto</p>
                      {shouldShowAmount(opp) && getAmount(opp) ? (
                        <p className="text-sm font-semibold text-ink">${getAmount(opp)}</p>
                      ) : (
                        <p className="text-sm text-slate-600">Monto reservado</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
