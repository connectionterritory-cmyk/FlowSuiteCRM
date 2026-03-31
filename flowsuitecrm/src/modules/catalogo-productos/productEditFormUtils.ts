import type { CatalogProduct } from './CatalogoProductosPage'
import type { EditForm } from './ProductEditForm'

// precio_publico viene del alias de v_catalogo_vendedor (campo real en tabla: productos.precio)
export const buildEditForm = (product: CatalogProduct): EditForm => ({
  nombre: product.nombre ?? '',
  estado: product.estado ?? 'activo',
  precio_publico: product.precio_publico != null ? String(product.precio_publico) : '',
  cuota_minima: product.cuota_minima != null ? String(product.cuota_minima) : '',
  con_financiamiento: product.con_financiamiento ?? false,
  visible_catalogo: product.visible_catalogo ?? true,
  descripcion_corta: product.descripcion_corta ?? '',
  descripcion_larga: product.descripcion_larga ?? '',
  beneficios: (product.beneficios ?? []).join('\n'),
})
