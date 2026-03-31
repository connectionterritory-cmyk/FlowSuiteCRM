import { startTransition, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import type { CatalogProduct } from './CatalogoProductosPage'
import { ProductEditForm } from './ProductEditForm'
import type { EditForm } from './ProductEditForm'
import { buildEditForm } from './productEditFormUtils'

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
  canEdit: boolean
  onSaved: (updated: CatalogProduct) => void
}

const getStatusTone = (estado: CatalogProduct['estado']) => {
  if (estado === 'reemplazado') return 'blue'
  return 'neutral'
}

export function ProductDetailDrawer({
  product,
  open,
  onClose,
  onViewReplacement,
  canEdit,
  onSaved,
}: ProductDetailDrawerProps) {
  const { t } = useTranslation()
  const [images, setImages] = useState<ProductImage[]>([])
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const resetTimeoutId = window.setTimeout(() => {
      startTransition(() => {
        setIsEditing(false)
        setSaveError(null)
      })
    }, 0)

    if (!open || !product || !isSupabaseConfigured) {
      const emptyTimeoutId = window.setTimeout(() => {
        startTransition(() => {
          setImages([])
          setActiveImageIndex(0)
        })
      }, 0)
      return () => {
        window.clearTimeout(resetTimeoutId)
        window.clearTimeout(emptyTimeoutId)
      }
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
      window.clearTimeout(resetTimeoutId)
    }
  }, [open, product])

  const formatPrice = (value: number | null) => {
    if (value == null) return t('catalogo.contactSales')
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
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

  const handleFormSave = async (values: EditForm) => {
    if (!product || !isSupabaseConfigured) return
    setSaving(true)
    setSaveError(null)

    const precioNum = values.precio_publico !== '' ? parseFloat(values.precio_publico) : null
    const cuotaNum = values.cuota_minima !== '' ? parseFloat(values.cuota_minima) : null
    const beneficiosArr = values.beneficios
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean)

    const { error } = await supabase
      .from('productos')
      .update({
        nombre: values.nombre || null,
        estado: values.estado,
        // precio_publico es alias de v_catalogo_vendedor → columna real: productos.precio
        precio: precioNum != null && !isNaN(precioNum) ? precioNum : null,
        cuota_minima: cuotaNum != null && !isNaN(cuotaNum) ? cuotaNum : null,
        con_financiamiento: values.con_financiamiento,
        visible_catalogo: values.visible_catalogo,
        descripcion_corta: values.descripcion_corta || null,
        descripcion_larga: values.descripcion_larga || null,
        beneficios: beneficiosArr,
      })
      .eq('id', product.id)

    setSaving(false)

    if (error) {
      setSaveError(error.message)
    } else {
      setIsEditing(false)
      const updatedProduct: CatalogProduct = {
        ...product,
        nombre: values.nombre || null,
        estado: values.estado,
        precio_publico: precioNum ?? null,
        cuota_minima: cuotaNum ?? null,
        con_financiamiento: values.con_financiamiento,
        visible_catalogo: values.visible_catalogo,
        descripcion_corta: values.descripcion_corta || null,
        descripcion_larga: values.descripcion_larga || null,
        beneficios: beneficiosArr,
      }
      onSaved(updatedProduct)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    setSaveError(null)
  }

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {canEdit && !isEditing && (
              <Button type="button" variant="ghost" onClick={() => { setIsEditing(true); setSaveError(null) }}>
                {t('common.edit')}
              </Button>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
              ×
            </button>
          </div>
        </header>

        <div className="drawer-body" style={{ display: 'grid', gap: '1rem' }}>
          {/* Galería — siempre visible */}
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
              {product.cuota_minima != null && !isEditing && (
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

          {isEditing ? (
            <ProductEditForm
              initialValues={buildEditForm(product)}
              onSave={handleFormSave}
              onCancel={handleCancel}
              saving={saving}
              error={saveError}
            />
          ) : (
            /* Vista de solo lectura */
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', padding: '1.25rem', background: 'linear-gradient(135deg, rgba(4, 120, 87, 0.05) 0%, rgba(4, 120, 87, 0.15) 100%)', borderRadius: '0.75rem', border: '1px solid rgba(4, 120, 87, 0.2)' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                  {t('catalogo.fields.precioPublico')}
                </span>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#064e3b', lineHeight: 1.1 }}>
                  {formatPrice(product.precio_publico)}
                </div>
                {product.cuota_minima != null && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#047857', fontWeight: 500 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <path d="M2 10h20" />
                    </svg>
                    {t('catalogo.fromPerMonth', { value: formatPrice(product.cuota_minima) })}
                  </div>
                )}
              </div>

              {(product.descripcion_corta || product.descripcion_larga) && (
                <div style={{ display: 'grid', gap: '0.5rem', color: 'var(--color-text)', lineHeight: 1.6 }}>
                  {product.descripcion_corta && <p style={{ margin: 0, fontWeight: 500 }}>{product.descripcion_corta}</p>}
                  {product.descripcion_larga && <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{product.descripcion_larga}</p>}
                </div>
              )}

              {product.beneficios && product.beneficios.length > 0 && (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <strong style={{ fontSize: '0.95rem', color: 'var(--color-text)' }}>{t('catalogo.benefits')}</strong>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.5rem' }}>
                    {product.beneficios.map((benefit: string) => (
                      <li key={benefit} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: 'var(--color-text-muted)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.15rem' }}>
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                        <span style={{ lineHeight: 1.4 }}>{benefit}</span>
                      </li>
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
          )}
        </div>
      </aside>
      </div>
    </>
  )
}
