import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

const getTicketTitle = (ticket) =>
  ticket?.titulo || ticket?.asunto || ticket?.subject || 'Ticket de servicio'

const getTicketStatus = (ticket) =>
  ticket?.estado || ticket?.status || 'Abierto'

export default function Servicio() {
  const { orgId } = useOrg()
  const [tickets, setTickets] = useState([])
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
        .from('servicios')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(30)

      if (fetchError) {
        setError('Tabla servicios no disponible o sin permisos')
        setTickets([])
      } else {
        setError(null)
        setTickets(data ?? [])
      }
      setLoading(false)
    }

    load()
  }, [orgId])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold font-display">Servicio / Postventa</h1>
        <p className="text-sm text-slate-600">
          Tickets multi-producto con items de filtros, ollas, electrodomesticos y otros.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-warning bg-white p-4 text-sm font-semibold text-warning">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {loading ? (
          <Card>
            <CardContent className="text-sm text-slate-600">Cargando...</CardContent>
          </Card>
        ) : null}
        {!loading && tickets.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-slate-600">Sin tickets activos</CardContent>
          </Card>
        ) : null}
        {tickets.map((ticket, index) => (
          <Card key={ticket.id ?? `ticket-${index}`}>
            <CardHeader>
              <CardTitle className="text-base">{getTicketTitle(ticket)}</CardTitle>
              <p className="text-xs text-slate-600">Producto objetivo: {ticket?.producto_objetivo || 'No definido'}</p>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <Badge>{getTicketStatus(ticket)}</Badge>
              <span className="text-sm text-slate-600">Items: {ticket?.items_count ?? 'N/A'}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
