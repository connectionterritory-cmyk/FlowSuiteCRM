import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useOrg } from '../contexts/org'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

export default function TeamHub() {
  const { orgId } = useOrg()
  const [loading, setLoading] = useState(true)
  const [canales, setCanales] = useState([])
  const [selectedCanal, setSelectedCanal] = useState(null)
  const [anuncios, setAnuncios] = useState([])

  useEffect(() => {
    const load = async () => {
      if (!supabase || !orgId) {
        setLoading(false)
        return
      }

      setLoading(true)
      const { data } = await supabase
        .from('canales')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      setCanales(data ?? [])
      if (data && data.length > 0) {
        setSelectedCanal(data[0].id)
      }
      setLoading(false)
    }

    load()
  }, [orgId])

  useEffect(() => {
    const loadAnuncios = async () => {
      if (!supabase || !orgId || !selectedCanal) return

      const { data } = await supabase
        .from('anuncios')
        .select('*')
        .eq('org_id', orgId)
        .eq('canal_id', selectedCanal)
        .order('created_at', { ascending: false })

      setAnuncios(data ?? [])
    }

    loadAnuncios()
  }, [orgId, selectedCanal])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold font-display">Team Hub</h1>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Canales</h2>
          {loading && <p>Cargando...</p>}
          {canales.map((canal) => (
            <Card
              key={canal.id}
              className={`cursor-pointer ${selectedCanal === canal.id ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setSelectedCanal(canal.id)}
            >
              <CardHeader>
                <CardTitle className="text-base">{canal.nombre}</CardTitle>
                <p className="text-sm text-slate-600">{canal.descripcion}</p>
              </CardHeader>
            </Card>
          ))}
          {!loading && canales.length === 0 && <p className="text-sm text-slate-600">Sin canales</p>}
        </div>

        <div className="md:col-span-2 space-y-3">
          <h2 className="text-lg font-semibold">Anuncios</h2>
          {anuncios.map((anuncio) => (
            <Card key={anuncio.id}>
              <CardHeader>
                <CardTitle className="text-base">{anuncio.titulo}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{anuncio.contenido}</p>
                <p className="text-xs text-slate-600 mt-2">{anuncio.created_at}</p>
              </CardContent>
            </Card>
          ))}
          {anuncios.length === 0 && <p className="text-sm text-slate-600">Sin anuncios en este canal</p>}
        </div>
      </div>
    </div>
  )
}
