import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

export default function Servicio() {
  const { orgId } = useOrg()
  const [loading, setLoading] = useState(true)
  const [servicios, setServicios] = useState([])
  const [showNewTicket, setShowNewTicket] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!supabase || !orgId) {
        setLoading(false)
        return
      }

      setLoading(true)
      const { data } = await supabase
        .from('servicios')
        .select('*, servicio_items(*)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      setServicios(data ?? [])
      setLoading(false)
    }

    load()
  }, [orgId])

  const handleCreateTicket = async (e) => {
    e.preventDefault()
    const formData = new FormData(e.target)

    const { data: newTicket, error } = await supabase
      .from('servicios')
      .insert({
        org_id: orgId,
        cliente_id: formData.get('cliente_id'),
        titulo: formData.get('titulo'),
        descripcion: formData.get('descripcion'),
        estado: 'Abierto',
        prioridad: formData.get('prioridad'),
      })
      .select()
      .single()

    if (!error) {
      setServicios([newTicket, ...servicios])
      setShowNewTicket(false)
      e.target.reset()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold font-display">Servicio / Postventa</h1>
        <button
          onClick={() => setShowNewTicket(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
        >
          + Nuevo Ticket
        </button>
      </div>

      {showNewTicket && (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo Ticket de Servicio</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateTicket} className="space-y-4">
              <input name="cliente_id" placeholder="ID Cliente" className="w-full rounded border p-2" required />
              <input name="titulo" placeholder="Título" className="w-full rounded border p-2" required />
              <textarea name="descripcion" placeholder="Descripción" className="w-full rounded border p-2" rows={3} />
              <select name="prioridad" className="w-full rounded border p-2">
                <option value="Baja">Baja</option>
                <option value="Media">Media</option>
                <option value="Alta">Alta</option>
                <option value="Urgente">Urgente</option>
              </select>
              <div className="flex gap-2">
                <button type="submit" className="rounded bg-primary px-4 py-2 text-white">Crear</button>
                <button type="button" onClick={() => setShowNewTicket(false)} className="rounded border px-4 py-2">Cancelar</button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {loading && <p>Cargando...</p>}
        {servicios.map((svc) => (
          <Card key={svc.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{svc.titulo}</CardTitle>
                <Badge>{svc.estado}</Badge>
              </div>
              <p className="text-sm text-slate-600">Ticket: {svc.ticket_number}</p>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{svc.descripcion}</p>
              <p className="text-xs text-slate-600 mt-2">Items: {svc.servicio_items?.length ?? 0}</p>
            </CardContent>
          </Card>
        ))}
        {!loading && servicios.length === 0 && <p className="text-sm text-slate-600">Sin tickets de servicio</p>}
      </div>
    </div>
  )
}
