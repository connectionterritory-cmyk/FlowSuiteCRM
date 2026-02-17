import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

export default function Cliente360() {
  const { orgId } = useOrg()
  const [searchParams] = useSearchParams()
  const clienteId = searchParams.get('id')

  const [loading, setLoading] = useState(true)
  const [cliente, setCliente] = useState(null)
  const [oportunidades, setOportunidades] = useState([])
  const [ordenes, setOrdenes] = useState([])
  const [servicios, setServicios] = useState([])
  const [aguaSistemas, setAguaSistemas] = useState([])
  const [cartera, setCartera] = useState([])
  const [notas, setNotas] = useState([])

  useEffect(() => {
    const load = async () => {
      if (!supabase || !orgId || !clienteId) {
        setLoading(false)
        return
      }

      setLoading(true)

      // Load cliente from contactos_canonical
      const { data: clienteData } = await supabase
        .from('contactos_canonical')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', clienteId)
        .maybeSingle()

      setCliente(clienteData)

      // Load related data in parallel
      const [oppRes, ordRes, svcRes, aguaRes, cartRes, notasRes] = await Promise.all([
        supabase.from('oportunidades').select('*').eq('org_id', orgId).eq('cliente_id', clienteId),
        supabase.from('ordenesrp').select('*').eq('org_id', orgId).eq('cliente_id', clienteId),
        supabase.from('servicios').select('*').eq('org_id', orgId).eq('cliente_id', clienteId),
        supabase.from('cliente_sistemas').select('*, cliente_componentes(*)').eq('org_id', orgId).eq('cliente_id', clienteId),
        supabase.from('transaccionesrp').select('*').eq('org_id', orgId).eq('cliente_id', clienteId),
        supabase.from('notasrp').select('*').eq('org_id', orgId).eq('cliente_id', clienteId),
      ])

      setOportunidades(oppRes.data ?? [])
      setOrdenes(ordRes.data ?? [])
      setServicios(svcRes.data ?? [])
      setAguaSistemas(aguaRes.data ?? [])
      setCartera(cartRes.data ?? [])
      setNotas(notasRes.data ?? [])

      setLoading(false)
    }

    load()
  }, [orgId, clienteId])

  if (loading) {
    return <div className="p-6">Cargando...</div>
  }

  if (!cliente) {
    return <div className="p-6">Cliente no encontrado</div>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{cliente.nombre || 'Cliente'}</CardTitle>
          <p className="text-sm text-slate-600">
            {cliente.email} • {cliente.telefono}
          </p>
        </CardHeader>
      </Card>

      <Tabs defaultValue="oportunidades">
        <TabsList>
          <TabsTrigger value="oportunidades">Oportunidades ({oportunidades.length})</TabsTrigger>
          <TabsTrigger value="ordenes">Órdenes ({ordenes.length})</TabsTrigger>
          <TabsTrigger value="servicio">Servicio ({servicios.length})</TabsTrigger>
          <TabsTrigger value="agua">Agua ({aguaSistemas.length})</TabsTrigger>
          <TabsTrigger value="cartera">Cartera ({cartera.length})</TabsTrigger>
          <TabsTrigger value="notas">Notas ({notas.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="oportunidades" className="space-y-3">
          {oportunidades.map((opp) => (
            <Card key={opp.id}>
              <CardHeader>
                <CardTitle className="text-base">{opp.titulo}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">Producto: {opp.producto_objetivo}</p>
                <p className="text-sm">Estado: {opp.estado}</p>
              </CardContent>
            </Card>
          ))}
          {oportunidades.length === 0 && <p className="text-sm text-slate-600">Sin oportunidades</p>}
        </TabsContent>

        <TabsContent value="ordenes" className="space-y-3">
          {ordenes.map((ord) => (
            <Card key={ord.id}>
              <CardHeader>
                <CardTitle className="text-base">Orden #{ord.numero_orden}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">Total: ${ord.total}</p>
                <p className="text-sm">Estado: {ord.estado}</p>
              </CardContent>
            </Card>
          ))}
          {ordenes.length === 0 && <p className="text-sm text-slate-600">Sin órdenes</p>}
        </TabsContent>

        <TabsContent value="servicio" className="space-y-3">
          {servicios.map((svc) => (
            <Card key={svc.id}>
              <CardHeader>
                <CardTitle className="text-base">{svc.titulo}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">Ticket: {svc.ticket_number}</p>
                <p className="text-sm">Estado: {svc.estado}</p>
              </CardContent>
            </Card>
          ))}
          {servicios.length === 0 && <p className="text-sm text-slate-600">Sin tickets de servicio</p>}
        </TabsContent>

        <TabsContent value="agua" className="space-y-3">
          {aguaSistemas.map((sistema) => (
            <Card key={sistema.id}>
              <CardHeader>
                <CardTitle className="text-base">{sistema.sistema}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm">Instalación: {sistema.fecha_instalacion}</p>
                {sistema.cliente_componentes?.map((comp) => (
                  <div key={comp.id} className="text-sm">
                    <strong>{comp.componente}</strong>: Próximo cambio {comp.next_change_at}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          {aguaSistemas.length === 0 && <p className="text-sm text-slate-600">Sin sistemas de agua</p>}
        </TabsContent>

        <TabsContent value="cartera" className="space-y-3">
          {cartera.map((trans) => (
            <Card key={trans.id}>
              <CardContent>
                <p className="text-sm">Monto: ${trans.monto}</p>
                <p className="text-sm">Fecha: {trans.fecha}</p>
              </CardContent>
            </Card>
          ))}
          {cartera.length === 0 && <p className="text-sm text-slate-600">Sin transacciones</p>}
        </TabsContent>

        <TabsContent value="notas" className="space-y-3">
          {notas.map((nota) => (
            <Card key={nota.id}>
              <CardContent>
                <p className="text-sm">{nota.contenido}</p>
                <p className="text-xs text-slate-600">{nota.created_at}</p>
              </CardContent>
            </Card>
          ))}
          {notas.length === 0 && <p className="text-sm text-slate-600">Sin notas</p>}
        </TabsContent>
      </Tabs>
    </div>
  )
}
