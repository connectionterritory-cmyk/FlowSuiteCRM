import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

export default function TeamHub() {
  const { orgId } = useOrg()
  const [channels, setChannels] = useState([])
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
        .from('team_channels')
        .select('*')
        .eq('org_id', orgId)
        .limit(20)

      if (fetchError) {
        setError('Tablas Team Hub no disponibles o sin permisos')
        setChannels([])
      } else {
        setError(null)
        setChannels(data ?? [])
      }
      setLoading(false)
    }

    load()
  }, [orgId])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold font-display">Team Hub</h1>
        <p className="text-sm text-slate-600">Canales basicos y anuncios internos.</p>
      </div>

      {error ? (
        <div className="rounded-md border border-warning bg-white p-4 text-sm font-semibold text-warning">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-slate-600">Cargando...</p> : null}
            {!loading && channels.length === 0 ? (
              <p className="text-sm text-slate-600">Sin canales activos</p>
            ) : null}
            {channels.map((channel, index) => (
              <div key={channel.id ?? `channel-${index}`} className="flex items-center justify-between">
                <span className="text-sm text-ink">#{channel?.nombre || channel?.name || 'general'}</span>
                <Badge>Activo</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anuncios</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Publica comunicados breves para el equipo. Minimo viable para MVP.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
