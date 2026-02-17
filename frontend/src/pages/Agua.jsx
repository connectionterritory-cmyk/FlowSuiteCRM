import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

const getViewFilter = (view) => {
  const today = new Date().toISOString().split('T')[0]
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  switch (view) {
    case 'hoy':
      return { filter: 'eq', value: today }
    case '7dias':
      return { filter: 'lte', value: in7Days }
    case '30dias':
      return { filter: 'lte', value: in30Days }
    case 'vencidos':
      return { filter: 'lt', value: today }
    default:
      return null
  }
}

export default function Agua() {
  const { orgId } = useOrg()
  const [loading, setLoading] = useState(true)
  const [componentes, setComponentes] = useState([])
  const [activeView, setActiveView] = useState('hoy')

  useEffect(() => {
    const load = async () => {
      if (!supabase || !orgId) {
        setLoading(false)
        return
      }

      setLoading(true)
      const viewFilter = getViewFilter(activeView)

      let query = supabase
        .from('cliente_componentes')
        .select('*, cliente_sistemas(cliente_id, sistema, clientes(nombre))')
        .eq('org_id', orgId)

      if (viewFilter) {
        query = query[viewFilter.filter]('next_change_at', viewFilter.value)
      }

      const { data } = await query.order('next_change_at', { ascending: true })

      setComponentes(data ?? [])
      setLoading(false)
    }

    load()
  }, [orgId, activeView])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold font-display">Agua - Scheduler de Cambios</h1>

      <Tabs value={activeView} onValueChange={setActiveView}>
        <TabsList>
          <TabsTrigger value="hoy">Hoy</TabsTrigger>
          <TabsTrigger value="7dias">Próximos 7 días</TabsTrigger>
          <TabsTrigger value="30dias">Próximos 30 días</TabsTrigger>
          <TabsTrigger value="vencidos">Vencidos</TabsTrigger>
        </TabsList>

        <TabsContent value={activeView} className="space-y-3 mt-4">
          {loading && <p>Cargando...</p>}
          {componentes.map((comp) => (
            <Card key={comp.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {comp.cliente_sistemas?.clientes?.nombre || 'Cliente'}
                </CardTitle>
                <p className="text-sm text-slate-600">
                  Sistema: {comp.cliente_sistemas?.sistema}
                </p>
              </CardHeader>
              <CardContent>
                <p className="text-sm">
                  <strong>{comp.componente}</strong> - Próximo cambio: <strong>{comp.next_change_at}</strong>
                </p>
                <p className="text-xs text-slate-600">Último cambio: {comp.last_change_at}</p>
                <p className="text-xs text-slate-600">Intervalo: {comp.intervalo_meses} meses</p>
              </CardContent>
            </Card>
          ))}
          {!loading && componentes.length === 0 && (
            <p className="text-sm text-slate-600">No hay cambios programados para esta vista</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
