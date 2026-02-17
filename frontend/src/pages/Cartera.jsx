import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

const getAgingBucket = (diasVencido) => {
  if (diasVencido <= 30) return '0-30'
  if (diasVencido <= 60) return '31-60'
  if (diasVencido <= 90) return '61-90'
  return '90+'
}

export default function Cartera() {
  const { orgId } = useOrg()
  const [loading, setLoading] = useState(true)
  const [transacciones, setTransacciones] = useState([])
  const [cargoVueltaCases, setCargoVueltaCases] = useState([])

  useEffect(() => {
    const load = async () => {
      if (!supabase || !orgId) {
        setLoading(false)
        return
      }

      setLoading(true)

      // Load pending transactions
      const { data: transData } = await supabase
        .from('transaccionesrp')
        .select('*, clientes(nombre)')
        .eq('org_id', orgId)
        .eq('estado', 'Pendiente')
        .order('fecha_vencimiento', { ascending: true })

      // Load cargo vuelta cases
      const { data: cargoData } = await supabase
        .from('cargo_vuelta_cases')
        .select('*, clientes(nombre)')
        .eq('org_id', orgId)
        .in('estado', ['Abierto', 'En Negociación'])

      setTransacciones(transData ?? [])
      setCargoVueltaCases(cargoData ?? [])
      setLoading(false)
    }

    load()
  }, [orgId])

  const buckets = {
    '0-30': [],
    '31-60': [],
    '61-90': [],
    '90+': [],
  }

  transacciones.forEach((trans) => {
    const today = new Date()
    const vencimiento = new Date(trans.fecha_vencimiento)
    const diasVencido = Math.floor((today - vencimiento) / (1000 * 60 * 60 * 24))

    if (diasVencido > 0) {
      const bucket = getAgingBucket(diasVencido)
      buckets[bucket].push({ ...trans, diasVencido })
    }
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold font-display">Cartera - Aging & Cobranza</h1>

      <div className="grid gap-4 md:grid-cols-4">
        {Object.entries(buckets).map(([bucket, items]) => (
          <Card key={bucket}>
            <CardHeader>
              <CardTitle className="text-base">
                {bucket} días
                <Badge className="ml-2">{items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">
                ${items.reduce((sum, t) => sum + (t.monto || 0), 0).toFixed(2)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Casos Cargo de Vuelta (&gt;90 días)</h2>
        <div className="space-y-3">
          {cargoVueltaCases.map((caso) => (
            <Card key={caso.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{caso.clientes?.nombre}</CardTitle>
                  <Badge>{caso.estado}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">Monto: ${caso.monto_total}</p>
                <p className="text-sm">Días vencido: {caso.dias_vencido}</p>
                {caso.acuerdo_tipo && <p className="text-sm">Acuerdo: {caso.acuerdo_tipo}</p>}
              </CardContent>
            </Card>
          ))}
          {cargoVueltaCases.length === 0 && <p className="text-sm text-slate-600">Sin casos activos</p>}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Todas las Cuentas Vencidas</h2>
        <div className="space-y-3">
          {loading && <p>Cargando...</p>}
          {Object.entries(buckets).map(([bucket, items]) =>
            items.map((trans) => (
              <Card key={trans.id}>
                <CardHeader>
                  <CardTitle className="text-base">{trans.clientes?.nombre}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">Monto: ${trans.monto}</p>
                  <p className="text-sm">Vencido: {trans.diasVencido} días (Bucket: {bucket})</p>
                  <p className="text-sm">Vencimiento: {trans.fecha_vencimiento}</p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
