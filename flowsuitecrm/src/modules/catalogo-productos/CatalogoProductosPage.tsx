import { startTransition, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/Badge'
import { EmptyState } from '../../components/EmptyState'
import { SectionHeader } from '../../components/SectionHeader'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useUsers } from '../../data/useUsers'
import { useViewMode } from '../../data/useViewMode'
import { ProductDetailDrawer } from './ProductDetailDrawer'

export type CatalogProduct = {
  id: string
  codigo: string | null
  nombre: string | null
  categoria: string | null
  categoria_principal: string | null
  subcategoria: string | null
  linea_producto: string | null
  precio_publico: number | null
  foto_principal_url: string | null
  activo: boolean
  estado: 'activo' | 'borrador' | 'descontinuado' | 'reemplazado' | null
  descripcion_corta: string | null
  descripcion_larga: string | null
  beneficios: string[] | null
  reemplazado_por_id: string | null
  reemplazado_por_codigo: string | null
  reemplazado_por_nombre: string | null
  cuota_minima: number | null
  con_financiamiento: boolean | null
  visible_catalogo: boolean
}

const STATUS_FILTERS = ['all', 'activo', 'descontinuado', 'reemplazado'] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]

const getStatusTone = (estado: CatalogProduct['estado']) => {
  if (estado === 'reemplazado') return 'blue'
  return 'neutral'
}

export function CatalogoProductosPage() {
  const { t } = useTranslation()
  const { currentRole } = useUsers()
  const { viewMode } = useViewMode()
  const canEdit = (currentRole === 'admin' || currentRole === 'distribuidor') && viewMode !== 'seller'

  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const timeoutId = window.setTimeout(() => {
        startTransition(() => {
          setError(t('catalogo.errors.notConfigured'))
          setLoading(false)
        })
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }

    let active = true

    const loadProducts = async () => {
      setLoading(true)
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('v_catalogo_vendedor')
        .select('*')
        .order('categoria_principal', { ascending: true })
        .order('nombre', { ascending: true })

      if (!active) return

      if (fetchError) {
        setProducts([])
        setError(fetchError.message)
      } else {
        setProducts((data as CatalogProduct[] | null) ?? [])
      }

      setLoading(false)
    }

    void loadProducts()

    return () => {
      active = false
    }
  }, [t])

  const categories = useMemo(() => {
    const unique = new Set<string>()
    products.forEach((product) => {
      const next = product.categoria_principal ?? product.categoria
      if (next) unique.add(next)
    })
    return ['all', ...Array.from(unique).sort((a, b) => a.localeCompare(b))]
  }, [products])

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return products.filter((product) => {
      const haystack = [
        product.nombre,
        product.codigo,
        product.categoria,
        product.categoria_principal,
        product.subcategoria,
        product.linea_producto,
        product.descripcion_corta,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const productCategory = product.categoria_principal ?? product.categoria
      const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch)
      const matchesCategory = category === 'all' || productCategory === category
      const matchesStatus = status === 'all' || product.estado === status

      return matchesSearch && matchesCategory && matchesStatus
    })
  }, [category, products, search, status])

  const formatPrice = (value: number | null) => {
    if (value == null) return t('catalogo.contactSales')
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value)
  }

  const openProduct = (product: CatalogProduct) => {
    setSelectedProduct(product)
    setDrawerOpen(true)
  }

  const handleProductSaved = (updated: CatalogProduct) => {
    setProducts((ps) => ps.map((p) => (p.id === updated.id ? updated : p)))
    setDrawerOpen(false)
  }

  const handleViewReplacement = (productId: string | null) => {
    if (!productId) return
    const replacement = products.find((product) => product.id === productId)
    if (!replacement) return
    setSelectedProduct(replacement)
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('catalogo.title')}
        subtitle={t('catalogo.subtitle')}
        action={canEdit ? undefined : <Badge label={t('catalogo.readOnly')} tone="blue" />}
      />

      <div
        className="card"
        style={{
          display: 'grid',
          gap: '1rem',
          position: 'sticky',
          top: '0.75rem',
          zIndex: 2,
          background: 'var(--color-surface-strong)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('catalogo.searchPlaceholder')}
            style={{
              width: '100%',
              padding: '0.85rem 1rem',
              borderRadius: '0.85rem',
              border: '1px solid var(--color-input-border)',
              fontSize: '1rem',
              background: 'var(--color-input)',
              color: 'var(--color-text)',
              outline: 'none',
            }}
          />

          <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', paddingBottom: '0.2rem' }}>
            {categories.map((option) => {
              const active = category === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  style={{
                    border: active ? '1px solid #0f766e' : '1px solid var(--color-input-border)',
                    background: active ? '#ccfbf1' : 'var(--color-input)',
                    color: active ? '#134e4a' : 'var(--color-text)',
                    borderRadius: '999px',
                    padding: '0.55rem 0.9rem',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  {option === 'all' ? t('catalogo.filters.allCategories') : option}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            style={{
              minWidth: 180,
              padding: '0.7rem 0.85rem',
              borderRadius: '0.75rem',
              border: '1px solid var(--color-input-border)',
              background: 'var(--color-input)',
              color: 'var(--color-text)',
            }}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option} value={option}>
                {t(`catalogo.filters.status.${option}`)}
              </option>
            ))}
          </select>

          <div style={{ marginLeft: 'auto', color: 'var(--color-text-muted, #6b7280)', fontSize: '0.9rem' }}>
            {t('catalogo.results', { count: filteredProducts.length })}
          </div>
        </div>
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          {t('common.loading')}
        </div>
      )}

      {!loading && error && <EmptyState title={t('catalogo.errors.title')} description={error} />}

      {!loading && !error && filteredProducts.length === 0 && (
        <EmptyState title={t('catalogo.emptyTitle')} description={t('catalogo.emptyDescription')} />
      )}

      {!loading && !error && filteredProducts.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
          }}
        >
          {filteredProducts.map((product) => {
            const categoryLabel = product.categoria_principal ?? product.categoria ?? t('catalogo.noCategory')
            const isMuted = product.estado === 'descontinuado'

            return (
              <article
                key={product.id}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  display: 'grid',
                  gap: 0,
                  opacity: isMuted ? 0.7 : 1,
                }}
              >
                <button
                  type="button"
                  onClick={() => openProduct(product)}
                  style={{
                    border: 0,
                    padding: 0,
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      aspectRatio: '4 / 3',
                      background: '#f8fafc',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {product.estado && product.estado !== 'activo' && (
                      <div style={{ position: 'absolute', top: '0.5rem', left: '0.5rem', zIndex: 1 }}>
                        <Badge label={t(`catalogo.status.${product.estado}`)} tone={getStatusTone(product.estado)} />
                      </div>
                    )}
                    {product.foto_principal_url ? (
                      <img
                        src={product.foto_principal_url}
                        alt={product.nombre ?? t('catalogo.productFallback')}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: '0.75rem' }}
                        loading="lazy"
                      />
                    ) : (
                      <div style={{ color: '#94a3b8', fontSize: '0.95rem', fontWeight: 600 }}>
                        {t('catalogo.noImage')}
                      </div>
                    )}
                  </div>

                  <div style={{ padding: '1rem', display: 'grid', gap: '0.55rem' }}>
                    <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted, #6b7280)' }}>
                      {categoryLabel} {product.codigo ? `· ${product.codigo}` : ''}
                    </div>

                    <div
                      style={{
                        fontSize: '1rem',
                        fontWeight: 700,
                        lineHeight: 1.3,
                        minHeight: '2.6em',
                        color: 'var(--color-text)',
                      }}
                    >
                      {product.nombre ?? t('catalogo.productFallback')}
                    </div>

                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#047857' }}>
                      {formatPrice(product.precio_publico)}
                    </div>

                    {product.cuota_minima != null && (
                      <div style={{ fontSize: '0.86rem', color: '#1d4ed8', fontWeight: 600 }}>
                        {t('catalogo.fromPerMonth', { value: formatPrice(product.cuota_minima) })}
                      </div>
                    )}

                    <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted, #475569)' }}>
                      {product.descripcion_corta || t('catalogo.tapToView')}
                    </div>
                  </div>
                </button>

                <div style={{ padding: '0 1rem 1rem' }}>
                  {product.estado === 'reemplazado' && (
                    <div style={{ fontSize: '0.75rem', color: '#2563eb', marginTop: '0.5rem' }}>
                      → {product.reemplazado_por_codigo || 'Ver reemplazo'}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <ProductDetailDrawer
        open={drawerOpen}
        product={selectedProduct}
        onClose={() => setDrawerOpen(false)}
        onViewReplacement={handleViewReplacement}
        canEdit={canEdit}
        onSaved={handleProductSaved}
      />
    </div>
  )
}
