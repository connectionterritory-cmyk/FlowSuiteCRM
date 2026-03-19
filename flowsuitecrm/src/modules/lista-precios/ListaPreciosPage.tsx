import { useEffect, useState, useMemo } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'

const SUPABASE_PROJECT = 'rxiarmbosgivaplygqug'
const STORAGE_BASE = `https://${SUPABASE_PROJECT}.supabase.co/storage/v1/object/public/productos`

const PRODUCT_IMAGE_URLS = Array.from({ length: 20 }, (_, i) => `${STORAGE_BASE}/2026/${i + 1}.png`)

type Producto = {
  id: string
  codigo: string
  nombre: string
  categoria: string | null
  categoria_principal: string | null
  subcategoria: string | null
  linea_producto: string | null
  precio: number | null
  foto_url: string | null
  activo: boolean
}

const CATEGORIAS = [
  { value: '', label: 'Todas las categorías' },
  { value: 'purificadores', label: 'Purificadores' },
  { value: 'filtros', label: 'Filtros' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'accesorios', label: 'Accesorios' },
  { value: 'otro', label: 'Otros' },
]

const LINEAS = [
  { value: '', label: 'Todas las líneas' },
  { value: 'purificador_aire', label: 'Purificador de aire' },
  { value: 'multipana', label: 'Multipana' },
  { value: 'filtro_agua', label: 'Filtro de agua' },
  { value: 'suavizador', label: 'Suavizador de agua' },
  { value: 'otro', label: 'Otro' },
]

export function ListaPreciosPage() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [linea, setLinea] = useState('')

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      setError('Supabase no configurado')
      return
    }

    const loadProductos = async () => {
      const { data, error: fetchError } = await supabase
        .from('v_productos_publicos')
        .select('id, codigo, nombre, categoria, categoria_principal, subcategoria, linea_producto, precio, foto_url, activo')
        .eq('activo', true)
        .order('nombre')

      if (fetchError) {
        setError(fetchError.message)
      } else {
        setProductos(data ?? [])
      }
      setLoading(false)
    }

    loadProductos()
  }, [])

  const productosFiltrados = useMemo(() => {
    return productos.filter((p) => {
      const matchesSearch = !search || p.nombre.toLowerCase().includes(search.toLowerCase()) || p.codigo?.toLowerCase().includes(search.toLowerCase())
      const matchesCategoria = !categoria || p.categoria === categoria || p.categoria_principal === categoria
      const matchesLinea = !linea || p.linea_producto === linea
      return matchesSearch && matchesCategoria && matchesLinea
    })
  }, [productos, search, categoria, linea])

  const formatPrice = (price: number | null) => {
    if (price == null) return 'Consultar'
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(price)
  }

  const getImageUrl = (index: number) => PRODUCT_IMAGE_URLS[index % PRODUCT_IMAGE_URLS.length]

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Cargando...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#dc2626' }}>Error: {error}</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '1rem 2rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>FlowSuite</div>
          <div style={{ fontSize: '1rem', color: '#6b7280' }}>Lista de Precios 2026</div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 200px', padding: '0.75rem 1rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '1rem' }}
          />
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            style={{ padding: '0.75rem 1rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '1rem', minWidth: 180 }}
          >
            {CATEGORIAS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            value={linea}
            onChange={(e) => setLinea(e.target.value)}
            style={{ padding: '0.75rem 1rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '1rem', minWidth: 180 }}
          >
            {LINEAS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        {productosFiltrados.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>No se encontraron productos</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {productosFiltrados.map((producto, index) => (
              <div
                key={producto.id}
                style={{
                  background: '#fff',
                  borderRadius: '0.75rem',
                  border: '1px solid #e5e7eb',
                  overflow: 'hidden',
                  transition: 'box-shadow 0.2s',
                }}
              >
                <div style={{ aspectRatio: '1', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={producto.foto_url || getImageUrl(index)}
                    alt={producto.nombre}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: '1rem' }}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                    }}
                  />
                </div>
                <div style={{ padding: '1rem' }}>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                    {producto.codigo}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '1rem', color: '#111827', marginBottom: '0.5rem' }}>
                    {producto.nombre}
                  </div>
                  {producto.linea_producto && (
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.5rem' }}>
                      {LINEAS.find(l => l.value === producto.linea_producto)?.label ?? producto.linea_producto}
                    </div>
                  )}
                  <div style={{ fontWeight: 700, fontSize: '1.25rem', color: '#059669' }}>
                    {formatPrice(producto.precio)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer style={{ background: '#111827', color: '#fff', padding: '3rem 2rem', marginTop: '3rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>¿Interesado en nuestros productos?</div>
          <div style={{ color: '#9ca3af', marginBottom: '2rem' }}>Contáctanos para mayor información y pedidos</div>
          <a
            href="https://wa.me/17862913042"
            style={{
              display: 'inline-block',
              background: '#10b981',
              color: '#fff',
              padding: '0.75rem 2rem',
              borderRadius: '0.5rem',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Contáctanos
          </a>
        </div>
      </footer>
    </div>
  )
}
