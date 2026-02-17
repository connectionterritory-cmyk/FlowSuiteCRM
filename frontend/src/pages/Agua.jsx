import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Badge } from '../components/ui/badge'

const getDueDate = (row) =>
  row?.proxima_fecha || row?.proximo_cambio || row?.next_due_date || row?.fecha_proxima

const toDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const getSystemName = (row) =>
  row?.sistema || row?.sistema_nombre || row?.system || 'Sistema'

const getComponentName = (row) =>
  row?.componente || row?.componente_nombre || row?.component || 'Componente'

export default function Agua() {
  const { orgId } = useOrg()
  const [items, setItems] = useState([])
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
        .from('cliente_componentes')
        .select('*')
        .eq('org_id', orgId)
        .limit(200)

      if (fetchError) {
        setError('Tablas de agua no disponibles o sin permisos')
        setItems([])
      } else {
        setError(null)
        setItems(data ?? [])
      }
      setLoading(false)
    }

    load()
  }, [orgId])

  const grouped = useMemo(() => {
    const now = new Date()
    const seven = new Date(now)
    seven.setDate(now.getDate() + 7)
    const thirty = new Date(now)
    thirty.setDate(now.getDate() + 30)

    const groups = {
      hoy: [],
      siete: [],
      treinta: [],
      vencidos: [],
    }

    items.forEach((item) => {
      const due = toDate(getDueDate(item))
      if (!due) return
      if (due < now) {
        groups.vencidos.push(item)
      } else if (due.toDateString() === now.toDateString()) {
        groups.hoy.push(item)
      } else if (due <= seven) {
        groups.siete.push(item)
      } else if (due <= thirty) {
        groups.treinta.push(item)
      }
    })

    return groups
  }, [items])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold font-display">Agua - Scheduler</h1>
        <p className="text-sm text-slate-600">
          Reglas por sistema: FrescaFlow, FrescaPure 3000/5500, Ducha.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-warning bg-white p-4 text-sm font-semibold text-warning">
          {error}
        </div>
      ) : null}

      <Tabs defaultValue="hoy">
        <TabsList>
          <TabsTrigger value="hoy">Hoy</TabsTrigger>
          <TabsTrigger value="siete">7 dias</TabsTrigger>
          <TabsTrigger value="treinta">30 dias</TabsTrigger>
          <TabsTrigger value="vencidos">Vencidos</TabsTrigger>
        </TabsList>

        {['hoy', 'siete', 'treinta', 'vencidos'].map((key) => (
          <TabsContent key={key} value={key}>
            <div className="grid gap-4 md:grid-cols-2">
              {loading ? (
                <Card>
                  <CardContent className="text-sm text-slate-600">Cargando...</CardContent>
                </Card>
              ) : null}
              {!loading && grouped[key].length === 0 ? (
                <Card>
                  <CardContent className="text-sm text-slate-600">Sin registros</CardContent>
                </Card>
              ) : null}
              {grouped[key].map((item, index) => (
                <Card key={item.id ?? `${key}-${index}`}>
                  <CardHeader>
                    <CardTitle className="text-base">{getSystemName(item)}</CardTitle>
                    <p className="text-xs text-slate-600">Componente: {getComponentName(item)}</p>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <Badge variant={key === 'vencidos' ? 'warning' : 'default'}>
                      {getDueDate(item) ?? 'Sin fecha'}
                    </Badge>
                    <span className="text-sm text-slate-600">Cliente: {item?.cliente_nombre || 'N/A'}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
