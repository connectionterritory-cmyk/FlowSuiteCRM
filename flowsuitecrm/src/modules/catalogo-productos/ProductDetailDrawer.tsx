import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import type { CatalogProduct } from './CatalogoProductosPage'

type ProductImage = {
  id: string
  url: string
  orden: number
  alt_text: string | null
}

type ProductDetailDrawerProps = {
  product: CatalogProduct | null
  open: boolean
  onClose: () => void
  onViewReplacement: (productId: string | null) => void
}

const getStatusTone = (estado: CatalogProduct['estado']) => {
  if (estado === 'reemplazado') return 'blue'
  return 'neutral'
}

export function ProductDetailDrawer({ product, open, onClose, onViewReplacement }: ProductDetailDrawerProps) {
  const { t } = useTranslation()
  const [images, setImages] = useState<ProductImage[]>([])
  const [activeImageIndex, setActiveImageIndex] = useState(0)

  useEffect(() => {
    if (!open || !product || !isSupabaseConfigured) {
      setImages([])
      setActiveImageIndex(0)
      return
    }

    let active = true

    const loadImages = async () => {
      const imagesResult = await supabase
        .from('product_images')
        .select('id, url, orden, alt_text')
        .eq('product_id', product.id)
        .order('orden', { ascending: true })

      if (!active) return

      setImages((imagesResult.data as ProductImage[] | null) ?? [])
      setActiveImageIndex(0)
    }

    void loadImages()

    return () => {
      active = false
    }
  }, [open, product])

  const formatPrice = (value: number | null) => {
    if (value == null) return t('catalogo.contactSales')
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 2,
    }).format(value)
  }

  const gallery = useMemo(() => {
    if (!product) return []

    const remoteImages = images.map((image) => ({
      key: image.id,
      url: image.url,
      alt: image.alt_text || product.nombre || t('catalogo.productFallback'),
    }))

    if (remoteImages.length > 0) return remoteImages

    if (product.foto_principal_url) {
      return [
        {
          key: `${product.id}-principal`,
          url: product.foto_principal_url,
          alt: product.nombre || t('catalogo.productFallback'),
        },
      ]
    }

    return []
  }, [images, product, t])

  if (!open || !product) return null

  const activeImage = gallery[activeImageIndex] ?? gallery[0] ?? null

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="drawer" style={{ width: 'min(540px, 100vw)' }} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <h3 style={{ marginBottom: '0.25rem' }}>{product.nombre ?? t('catalogo.productFallback')}</h3>
            <div style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.9rem' }}>
              {product.categoria_principal ?? product.categoria ?? t('catalogo.noCategory')}
              {product.codigo ? ` · ${product.codigo}` : ''}
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </header>

        <div className="drawer-body" style={{ display: 'grid', gap: '1rem' }}>
          <div
            style={{
              borderRadius: '1rem',
              background: 'var(--color-surface-strong)',
              padding: '1rem',
              display: 'grid',
              gap: '0.8rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <Badge label={t(`catalogo.status.${product.estado ?? 'activo'}`)} tone={getStatusTone(product.estado)} />
              {product.cuota_minima != null && (
                <div style={{ color: '#1d4ed8', fontWeight: 700, fontSize: '0.9rem' }}>
                  {t('catalogo.fromPerMonth', { value: formatPrice(product.cuota_minima) })}
                </div>
              )}
            </div>

            <div
              style={{
                aspectRatio: '4 / 3',
                borderRadius: '0.9rem',
                background: 'var(--color-input)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {activeImage ? (
                <img
                  src={activeImage.url}
                  alt={activeImage.alt}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: '0.75rem' }}
                />
              ) : (
                <div style={{ color: '#94a3b8', fontWeight: 600 }}>{t('catalogo.noImage')}</div>
              )}
            </div>

            {gallery.length > 1 && (
              <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
                {gallery.map((image, index) => (
                  <button
                    key={image.key}
                    type="button"
                    onClick={() => setActiveImageIndex(index)}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: '0.8rem',
                      border:
                        index === activeImageIndex
                          ? '2px solid #0f766e'
                          : '1px solid var(--color-input-border)',
                      background: 'var(--color-input)',
                      overflow: 'hidden',
                      flex: '0 0 auto',
                      padding: '0.2rem',
                      cursor: 'pointer',
                    }}
                  >
                    <img
                      src={image.url}
                      alt={image.alt}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ display: 'grid', gap: '0.85rem' }}>
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#047857' }}>
                {formatPrice(product.precio_publico)}
              </div>
              {product.cuota_minima != null && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.92rem' }}>
                  {t('catalogo.fromPerMonth', { value: formatPrice(product.cuota_minima) })}
                </div>
              )}
            </div>

            {product.descripcion_corta && <p style={{ margin: 0 }}>{product.descripcion_corta}</p>}

            {product.descripcion_larga && (
              <p style={{ margin: 0, color: 'var(--color-text-muted, #6b7280)' }}>{product.descripcion_larga}</p>
            )}

            {product.beneficios && product.beneficios.length > 0 && (
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                <strong>{t('catalogo.benefits')}</strong>
                <ul style={{ margin: 0, paddingLeft: '1rem', color: 'var(--color-text-muted)' }}>
                  {product.beneficios.map((benefit: string) => (
                    <li key={benefit}>{benefit}</li>
                  ))}
                </ul>
              </div>
            )}

            {product.estado === 'reemplazado' && product.reemplazado_por_id && (
              <div
                style={{
                  display: 'grid',
                  gap: '0.7rem',
                  background: 'var(--color-surface-strong)',
                  border: '1px solid var(--color-input-border)',
                  borderRadius: '0.9rem',
                  padding: '0.9rem',
                }}
              >
                <div style={{ color: 'var(--color-text)', fontWeight: 600 }}>{t('catalogo.replacementNotice')}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                  {product.reemplazado_por_nombre
                    ? `${product.reemplazado_por_nombre}${product.reemplazado_por_codigo ? ` · ${product.reemplazado_por_codigo}` : ''}`
                    : t('catalogo.replacementPending')}
                </div>
                <Button type="button" onClick={() => onViewReplacement(product.reemplazado_por_id)}>
                  {t('catalogo.viewReplacement')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </aside>
      </div>
    </>
  )
}
