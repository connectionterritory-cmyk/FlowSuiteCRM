import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Badge } from '../components/ui/badge'

const getClientName = (client) =>
  client?.nombre || client?.name || client?.razon_social || client?.empresa || 'Cliente'

export default function Cliente360() {
  const { orgId } = useOrg()
  const [clients, setClients] = useState([])
  const [selectedId, setSelectedId] = useState(null)
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
        .from('clientes')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (fetchError) {
        setError(fetchError.message)
        setClients([])
      } else {
        setError(null)
        setClients(data ?? [])
        setSelectedId(data?.[0]?.id ?? null)
      }
      setLoading(false)
    }

    load()
  }, [orgId])

  const selectedClient = useMemo(() => {
    return clients.find((client) => client.id === selectedId) ?? null
  }, [clients, selectedId])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold font-display">Cliente / Contacto 360</h1>
        <p className="text-sm text-slate-600">
          Vista integral con tabs por oportunidades, ordenes, servicio, agua, cartera y notas.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-warning bg-white p-4 text-sm font-semibold text-warning">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-base">Clientes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-slate-600">Cargando...</p> : null}
            {!loading && clients.length === 0 ? (
              <p className="text-sm text-slate-600">Sin clientes</p>
            ) : null}
            {clients.map((client) => (
              <button
                key={client.id}
                onClick={() => setSelectedId(client.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  selectedId === client.id
                    ? 'border-ink bg-ink text-white'
                    : 'border-slate-200 bg-white text-ink hover:bg-slate-100'
                }`}
              >
                {getClientName(client)}
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{getClientName(selectedClient)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge>Org filtrada</Badge>
              <Badge variant="accent">Producto objetivo visible</Badge>
              <Badge>Contacto 360</Badge>
            </CardContent>
          </Card>

          <Tabs defaultValue="oportunidades">
            <TabsList>
              <TabsTrigger value="oportunidades">Oportunidades</TabsTrigger>
              <TabsTrigger value="ordenes">Ordenes</TabsTrigger>
              <TabsTrigger value="servicio">Servicio</TabsTrigger>
              <TabsTrigger value="agua">Agua</TabsTrigger>
              <TabsTrigger value="cartera">Cartera</TabsTrigger>
              <TabsTrigger value="notas">Notas/Mensajes</TabsTrigger>
            </TabsList>

            <TabsContent value="oportunidades">
              <Card>
                <CardContent>
                  <p className="text-sm text-slate-600">
                    Sin datos cargados. Conectar tabla `oportunidades` por cliente cuando el schema este listo.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ordenes">
              <Card>
                <CardContent>
                  <p className="text-sm text-slate-600">
                    Sin datos cargados. Conectar tabla `ordenesrp` al cliente seleccionado.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="servicio">
              <Card>
                <CardContent>
                  <p className="text-sm text-slate-600">
                    Sin tickets. Se habilitara con `servicios` y `servicio_items`.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="agua">
              <Card>
                <CardContent>
                  <p className="text-sm text-slate-600">
                    Sin sistemas registrados. Se habilitara con `cliente_sistemas` y `cliente_componentes`.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cartera">
              <Card>
                <CardContent>
                  <p className="text-sm text-slate-600">
                    Sin gestiones. Se habilitara con `cob_gestiones` y `cargo_vuelta_cases`.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notas">
              <Card>
                <CardContent>
                  <p className="text-sm text-slate-600">
                    Sin notas o mensajes. Conectar `notasrp` y `mensajescrm` por cliente.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
