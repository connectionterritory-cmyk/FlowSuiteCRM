import { type ChangeEvent, type FormEvent, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableColumn, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { DetailPanel } from '../../components/DetailPanel'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/useToast'
import { LABEL_STYLE } from '../../components/formControlStyles'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useUsers } from '../../data/useUsers'
import { useViewMode } from '../../data/useViewMode'
import { ProductDetailEditPanel } from './ProductDetailEditPanel'
import {
  type PriceEntry,
  extractEntries,
  inferCategoriaPrincipal,
  inferSubcategoria,
  inferLinea,
  computeCosts,
} from './productImportUtils'

type ProductoRecord = {
  id: string
  codigo: string | null
  nombre: string | null
  categoria: string | null
  categoria_compra: string | null
  categoria_principal: string | null
  subcategoria: string | null
  linea_producto: string | null
  precio: number | null
  costo_n1: number | null
  costo_n2: number | null
  costo_n3: number | null
  costo_n4: number | null
  recargo_arancelario: number | null
  activo: boolean | null
  foto_url: string | null
  created_at: string | null
}

type DetailValues = {
  nombre: string
  categoria_principal: string
  subcategoria: string
  linea_producto: string
  categoria_compra: string
  costo_n1: string
  costo_n2: string
  costo_n3: string
  costo_n4: string
  recargo_arancelario: string
  precio: string
  activo: boolean
}

const initialForm = {
  codigo: '',
  nombre: '',
  categoria: '',
  precio: '',
  activo: true,
  foto_url: '' as string | null,
}

const GRID_TWO_COL_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '1rem',
}

export function ProductosPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const { currentRole, loading: usersLoading } = useUsers()
  const { viewMode } = useViewMode()
  const [productos, setProductos] = useState<ProductoRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<(DataTableRow & { originalData?: ProductoRecord }) | null>(null)
  const [detailEditMode, setDetailEditMode] = useState(false)
  const [detailValues, setDetailValues] = useState<DetailValues>({
    nombre: '',
    categoria_principal: '',
    subcategoria: '',
    linea_producto: '',
    categoria_compra: '',
    costo_n1: '',
    costo_n2: '',
    costo_n3: '',
    costo_n4: '',
    recargo_arancelario: '',
    precio: '',
    activo: true,
  })
  const [detailPhotoFile, setDetailPhotoFile] = useState<File | null>(null)
  const [detailPhotoPreview, setDetailPhotoPreview] = useState<string | null>(null)
  const [searchNombre, setSearchNombre] = useState('')
  const [searchCodigo, setSearchCodigo] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('todas')
  const [filtroLinea, setFiltroLinea] = useState('todas')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<{ total: number; procesados: number; errores: number } | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const configured = isSupabaseConfigured
  const canAccessProductos =
    (currentRole === 'admin' || currentRole === 'distribuidor') && viewMode !== 'seller'
  const canManageProductos = canAccessProductos
  const canViewCostos = canAccessProductos

  const loadProductos = useCallback(async () => {
    if (!configured) return
    if (!canAccessProductos) return
    setLoading(true)
    setError(null)
  const { data, error: fetchError } = await supabase
      .from('productos')
      .select('id, codigo, nombre, categoria, categoria_compra, categoria_principal, subcategoria, linea_producto, precio, costo_n1, costo_n2, costo_n3, costo_n4, recargo_arancelario, activo, foto_url, created_at')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setProductos([])
    } else {
      setProductos(data ?? [])
    }
    setLoading(false)
  }, [configured, canAccessProductos])

  useEffect(() => {
    if (configured) {
      loadProductos()
    }
  }, [configured, loadProductos])

  useEffect(() => {
    if (!configured) return
    if (usersLoading) return
    if (canAccessProductos) return
    showToast(t('productos.errors.noAccess'), 'error')
    navigate('/dashboard', { replace: true })
  }, [canAccessProductos, configured, navigate, showToast, t, usersLoading])

  useEffect(() => {
    const producto = selectedRow?.originalData
    if (!producto) return
    setDetailValues({
      nombre: producto.nombre ?? '',
      categoria_principal: producto.categoria_principal ?? producto.categoria ?? '',
      subcategoria: producto.subcategoria ?? '',
      linea_producto: producto.linea_producto ?? '',
      categoria_compra: producto.categoria_compra ?? '',
      costo_n1: producto.costo_n1 != null ? String(producto.costo_n1) : '',
      costo_n2: producto.costo_n2 != null ? String(producto.costo_n2) : '',
      costo_n3: producto.costo_n3 != null ? String(producto.costo_n3) : '',
      costo_n4: producto.costo_n4 != null ? String(producto.costo_n4) : '',
      recargo_arancelario: producto.recargo_arancelario != null ? String(producto.recargo_arancelario) : '',
      precio: producto.precio != null ? String(producto.precio) : '',
      activo: Boolean(producto.activo),
    })
    if (detailPhotoPreview && detailPhotoPreview.startsWith('blob:')) {
      URL.revokeObjectURL(detailPhotoPreview)
    }
    setDetailPhotoPreview(producto.foto_url ?? null)
    setDetailPhotoFile(null)
    setDetailEditMode(false)
  }, [selectedRow, detailPhotoPreview])

  const categoriasUnicas = useMemo(() => {
    const categorias = new Set<string>()
    productos.forEach((producto) => {
      if (producto.categoria_principal) categorias.add(producto.categoria_principal)
    })
    return Array.from(categorias).sort((a, b) => a.localeCompare(b))
  }, [productos])

  const lineasUnicas = useMemo(() => {
    const lineas = new Set<string>()
    productos.forEach((producto) => {
      if (producto.linea_producto) lineas.add(producto.linea_producto)
    })
    return Array.from(lineas).sort((a, b) => a.localeCompare(b))
  }, [productos])

  const numberFormat = useMemo(() => new Intl.NumberFormat(undefined), [])

  const productosFiltrados = useMemo(() => {
    const nombre = searchNombre.trim().toLowerCase()
    const codigo = searchCodigo.trim().toLowerCase()
    return productos.filter((producto) => {
      const matchNombre = nombre
        ? (producto.nombre ?? '').toLowerCase().includes(nombre)
        : true
      const matchCodigo = codigo
        ? (producto.codigo ?? '').toLowerCase().includes(codigo)
        : true
      const matchCategoria =
        filtroCategoria === 'todas' || producto.categoria_principal === filtroCategoria
      const matchLinea =
        filtroLinea === 'todas' || producto.linea_producto === filtroLinea
      return matchNombre && matchCodigo && matchCategoria && matchLinea
    })
  }, [productos, searchNombre, searchCodigo, filtroCategoria, filtroLinea])

  const createDetailValues = useMemo(
    () => ({
      nombre: formValues.nombre,
      categoria_principal: formValues.categoria,
      subcategoria: '',
      linea_producto: '',
      categoria_compra: '',
      costo_n1: '',
      costo_n2: '',
      costo_n3: '',
      costo_n4: '',
      recargo_arancelario: '',
      precio: formValues.precio,
      activo: formValues.activo,
    }),
    [formValues]
  )

  const setCreateDetailValues = useCallback(
    (next: SetStateAction<DetailValues>) => {
      const updated = typeof next === 'function' ? next(createDetailValues) : next
      setFormValues((prev) => ({
        ...prev,
        nombre: updated.nombre,
        categoria: updated.categoria_principal,
        precio: updated.precio,
        activo: updated.activo,
      }))
    },
    [createDetailValues]
  )

  const rows = useMemo<DataTableRow[]>(() => {
    return productosFiltrados.map((producto) => {
      const estadoLabel = producto.activo ? t('productos.estado.activo') : t('productos.estado.inactivo')
      const baseCells = [
        producto.foto_url ? (
            <img
              src={producto.foto_url}
              alt={producto.nombre ?? t('productos.fields.foto')}
            style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'rgba(148,163,184,0.25)',
            }}
          />
        ),
        producto.codigo ?? '-',
        producto.nombre ?? '-',
        producto.categoria_principal ?? producto.categoria ?? '-',
        producto.subcategoria ?? '-',
      ]
      const costCells = canViewCostos
        ? [
            producto.categoria_compra ?? '-',
            producto.linea_producto ?? '-',
            producto.costo_n3 != null ? numberFormat.format(producto.costo_n3) : '-',
            producto.recargo_arancelario != null ? numberFormat.format(producto.recargo_arancelario) : '-',
          ]
        : []
      return {
        id: producto.id,
        originalData: producto,
        cells: [
          ...baseCells,
          ...costCells,
          producto.precio != null ? numberFormat.format(producto.precio) : '-',
          estadoLabel,
        ],
        detail: [
          { label: t('productos.fields.codigo'), value: producto.codigo ?? '-' },
          { label: t('productos.fields.nombre'), value: producto.nombre ?? '-' },
          { label: t('productos.fields.categoria'), value: producto.categoria_principal ?? producto.categoria ?? '-' },
          { label: t('productos.fields.subcategoria'), value: producto.subcategoria ?? '-' },
          { label: t('productos.fields.linea'), value: producto.linea_producto ?? '-' },
          ...(canViewCostos
            ? [
                { label: t('productos.fields.categoriaCompra'), value: producto.categoria_compra ?? '-' },
                { label: t('productos.fields.costoN1'), value: producto.costo_n1 ?? '-' },
                { label: t('productos.fields.costoN2'), value: producto.costo_n2 ?? '-' },
                { label: t('productos.fields.costoN3'), value: producto.costo_n3 ?? '-' },
                { label: t('productos.fields.costoN4'), value: producto.costo_n4 ?? '-' },
                { label: t('productos.fields.recargo'), value: producto.recargo_arancelario ?? '-' },
              ]
            : []),
          { label: t('productos.fields.precio'), value: producto.precio ?? '-' },
          { label: t('productos.fields.activo'), value: estadoLabel },
          {
            label: t('productos.fields.foto'),
            value: producto.foto_url ? (
              <img
                src={producto.foto_url}
                alt={producto.nombre ?? 'Producto'}
                style={{ maxWidth: '100%', borderRadius: 8 }}
              />
            ) : (
              '-'
            ),
          },
        ],
      }
    })
  }, [numberFormat, productosFiltrados, canViewCostos, t])


  const handleDelete = async () => {
    if (!selectedRow || !canManageProductos) return
    setDeleting(true)
    const { error: delError } = await supabase
      .from('productos')
      .delete()
      .eq('id', selectedRow.id)
    if (delError) {
      showToast(delError.message, 'error')
      setDeleting(false)
      return
    }
    setSelectedRow(null)
    await loadProductos()
    showToast(t('toast.success'))
    setDeleting(false)
  }

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  const handleOpenForm = (producto?: ProductoRecord) => {
    if (!canManageProductos) return
    if (producto) {
      setEditingProductId(producto.id)
      setFormValues({
        codigo: producto.codigo ?? '',
        nombre: producto.nombre ?? '',
        categoria: producto.categoria_principal ?? producto.categoria ?? '',
        precio: producto.precio != null ? String(producto.precio) : '',
        activo: Boolean(producto.activo),
        foto_url: producto.foto_url ?? null,
      })
      if (producto.foto_url) {
        if (photoPreview) URL.revokeObjectURL(photoPreview)
        setPhotoPreview(producto.foto_url)
      }
    } else {
      setEditingProductId(null)
      setFormValues(initialForm)
      if (photoPreview) URL.revokeObjectURL(photoPreview)
      setPhotoPreview(null)
    }
    setFormError(null)
    setPhotoFile(null)
    setFormOpen(true)
  }

  const handleCloseForm = () => {
    if (submitting) return
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
    setPhotoFile(null)
    setEditingProductId(null)
    setFormOpen(false)
  }

  const handlePhotoChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setPhotoFile(file)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }, [photoPreview])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    let foto_url: string | null = formValues.foto_url || null
    if (photoFile) {
      setUploadStatus(t('productos.status.subiendo'))
      const extension = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
      const { error: uploadError } = await supabase
        .storage
        .from('productos')
        .upload(fileName, photoFile, { upsert: false })
      if (uploadError) {
        setFormError(uploadError.message)
        showToast(uploadError.message, 'error')
        setSubmitting(false)
        setUploadStatus(null)
        return
      }
      setUploadStatus(t('productos.status.guardando'))
      const { data: publicUrl } = supabase.storage.from('productos').getPublicUrl(fileName)
      foto_url = publicUrl.publicUrl
    }

    const payload = {
      codigo: toNull(formValues.codigo),
      nombre: toNull(formValues.nombre),
      categoria: toNull(formValues.categoria),
      categoria_principal: toNull(formValues.categoria),
      precio: formValues.precio === '' ? 0 : Number(formValues.precio),
      activo: formValues.activo,
      foto_url,
    }

    const { error: insertError } = editingProductId
      ? await supabase.from('productos').update(payload).eq('id', editingProductId)
      : await supabase.from('productos').insert(payload)

    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      handleCloseForm()
      await loadProductos()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
    setUploadStatus(null)
  }

  const handleChange = useCallback((field: keyof typeof initialForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target
      const value =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
        : target.value
      setFormValues((prev) => ({ ...prev, [field]: value }))
    }, [])

  const handleCreateDetailChange = useCallback(
    (field: keyof DetailValues) =>
      (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const target = event.target
        const value =
          target instanceof HTMLInputElement && target.type === 'checkbox'
            ? target.checked
            : target.value
        setCreateDetailValues((prev) => ({ ...prev, [field]: value }))
      },
    [setCreateDetailValues]
  )

  const handleDetailChange = useCallback((field: keyof typeof detailValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target
      const value =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
        : target.value
      setDetailValues((prev) => ({ ...prev, [field]: value }))
    }, [])

  const handleDetailPhotoChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setDetailPhotoFile(file)
    if (detailPhotoPreview && detailPhotoPreview.startsWith('blob:')) {
      URL.revokeObjectURL(detailPhotoPreview)
    }
    setDetailPhotoPreview(file ? URL.createObjectURL(file) : detailPhotoPreview)
  }, [detailPhotoPreview])

  const createPanelItems = useMemo(() => {
    const productoForCreate = {
      codigo: formValues.codigo || null,
      nombre: formValues.nombre || null,
      categoria: formValues.categoria || null,
      categoria_compra: null,
      categoria_principal: formValues.categoria || null,
      subcategoria: null,
      linea_producto: null,
      precio: formValues.precio ? Number(formValues.precio) : null,
      costo_n1: null,
      costo_n2: null,
      costo_n3: null,
      costo_n4: null,
      recargo_arancelario: null,
      activo: formValues.activo,
      foto_url: photoPreview,
    }

    return ProductDetailEditPanel({
      producto: productoForCreate,
      detailValues: createDetailValues,
      setDetailValues: setCreateDetailValues,
      canViewCostos: false,
      categoriaCompraOptions: [],
      handleDetailChange: handleCreateDetailChange,
      handleDetailPhotoChange: handlePhotoChange,
      detailPhotoPreview: photoPreview,
      t,
      gridStyle: GRID_TWO_COL_STYLE,
      mode: 'create',
      showAdvancedFields: false,
      codigoValue: formValues.codigo,
      onCodigoChange: handleChange('codigo'),
    })
  }, [createDetailValues, formValues, handleCreateDetailChange, handlePhotoChange, handleChange, photoPreview, setCreateDetailValues, t])

  const handleSaveDetail = async () => {
    if (!selectedRow || !canManageProductos) return
    if (!configured) {
      showToast(t('common.supabaseRequired'), 'error')
      return
    }
    setSubmitting(true)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const toNumber = (value: string) => (value.trim() === '' ? null : Number(value))
    let foto_url: string | null = selectedRow.originalData?.foto_url ?? null
    if (detailPhotoFile) {
      setUploadStatus(t('productos.status.subiendo'))
      const extension = detailPhotoFile.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
      const { error: uploadError } = await supabase
        .storage
        .from('productos')
        .upload(fileName, detailPhotoFile, { upsert: false })
      if (uploadError) {
        showToast(uploadError.message, 'error')
        setSubmitting(false)
        setUploadStatus(null)
        return
      }
      setUploadStatus(t('productos.status.actualizando'))
      const { data: publicUrl } = supabase.storage.from('productos').getPublicUrl(fileName)
      foto_url = publicUrl.publicUrl
    }

    const payload = {
      nombre: toNull(detailValues.nombre),
      categoria: toNull(detailValues.categoria_principal),
      categoria_principal: toNull(detailValues.categoria_principal),
      subcategoria: toNull(detailValues.subcategoria),
      linea_producto: toNull(detailValues.linea_producto),
      categoria_compra: toNull(detailValues.categoria_compra),
      costo_n1: toNumber(detailValues.costo_n1),
      costo_n2: toNumber(detailValues.costo_n2),
      costo_n3: toNumber(detailValues.costo_n3),
      costo_n4: toNumber(detailValues.costo_n4),
      recargo_arancelario: toNumber(detailValues.recargo_arancelario),
      precio: toNumber(detailValues.precio) ?? 0,
      activo: Boolean(detailValues.activo),
      foto_url,
    }
    const { error: updateError } = await supabase
      .from('productos')
      .update(payload)
      .eq('id', selectedRow.id)
    if (updateError) {
      showToast(updateError.message, 'error')
      setSubmitting(false)
      setUploadStatus(null)
      return
    }

    const original = selectedRow.originalData
    if (!original) {
      setSubmitting(false)
      setUploadStatus(null)
      return
    }

    const updatedProduct: ProductoRecord = {
      ...original,
      nombre: payload.nombre ?? original.nombre,
      categoria: payload.categoria ?? original.categoria,
      categoria_principal: payload.categoria_principal ?? original.categoria_principal,
      subcategoria: payload.subcategoria ?? original.subcategoria,
      linea_producto: payload.linea_producto ?? original.linea_producto,
      categoria_compra: payload.categoria_compra ?? original.categoria_compra,
      costo_n1: payload.costo_n1 ?? original.costo_n1,
      costo_n2: payload.costo_n2 ?? original.costo_n2,
      costo_n3: payload.costo_n3 ?? original.costo_n3,
      costo_n4: payload.costo_n4 ?? original.costo_n4,
      recargo_arancelario: payload.recargo_arancelario ?? original.recargo_arancelario,
      precio: payload.precio ?? original.precio ?? 0,
      activo: Boolean(payload.activo),
      foto_url,
    }

    setProductos((prev) => prev.map((producto) => (producto.id === selectedRow.id ? updatedProduct : producto)))
    setSelectedRow((prev) => (prev ? { ...prev, originalData: updatedProduct } : prev))
    setDetailEditMode(false)
    setDetailPhotoFile(null)
    setDetailPhotoPreview(foto_url)
    showToast(t('toast.success'))
    setSubmitting(false)
    setUploadStatus(null)
  }

  const detailItems = useMemo(() => {
    if (!selectedRow?.originalData) return []
    const producto = selectedRow.originalData
    const categoriaCompraOptions = ['mercaderia', 'premium', 'miscelaneos']

    const baseItems = [
      {
        label: t('productos.fields.codigo'),
        value: producto.codigo ?? '-',
      },
      {
        label: t('productos.fields.nombre'),
        value: producto.nombre ?? '-',
      },
      {
        label: t('productos.fields.categoria'),
        value: producto.categoria_principal ?? producto.categoria ?? '-',
      },
      {
        label: t('productos.fields.subcategoria'),
        value: producto.subcategoria ?? '-',
      },
      {
        label: t('productos.fields.linea'),
        value: producto.linea_producto ?? '-',
      },
    ]

    const costoItems = canViewCostos
      ? [
          {
            label: t('productos.fields.categoriaCompra'),
            value: producto.categoria_compra ?? '-',
          },
          {
            label: t('productos.fields.costoN1'),
            value: producto.costo_n1 ?? '-',
          },
          {
            label: t('productos.fields.costoN2'),
            value: producto.costo_n2 ?? '-',
          },
          {
            label: t('productos.fields.costoN3'),
            value: producto.costo_n3 ?? '-',
          },
          {
            label: t('productos.fields.costoN4'),
            value: producto.costo_n4 ?? '-',
          },
          {
            label: t('productos.fields.recargo'),
            value: producto.recargo_arancelario ?? '-',
          },
        ]
      : []

    const editBanner = detailEditMode
      ? [{ label: t('productos.editingLabel'), value: t('productos.editingHelp') }]
      : []

    const photoValue = producto.foto_url ? (
      <img
        src={producto.foto_url}
        alt={producto.nombre ?? t('productos.fields.foto')}
        style={{ maxWidth: '100%', borderRadius: 8 }}
      />
    ) : (
      '-'
    )

    if (detailEditMode) {
      const editItems = ProductDetailEditPanel({
        producto,
        detailValues,
        setDetailValues,
        canViewCostos,
        categoriaCompraOptions,
        handleDetailChange,
        handleDetailPhotoChange,
        detailPhotoPreview,
        t,
        gridStyle: GRID_TWO_COL_STYLE,
      })
      return [...editBanner, ...editItems]
    }

    return [
      ...editBanner,
      ...baseItems,
      ...costoItems,
      {
        label: t('productos.fields.precio'),
        value: producto.precio ?? '-',
      },
      {
        label: t('productos.fields.activo'),
        value: producto.activo ? t('productos.estado.activo') : t('productos.estado.inactivo'),
      },
      {
        label: t('productos.fields.foto'),
        value: photoValue,
      },
    ]
  }, [selectedRow, detailEditMode, detailValues, canViewCostos, t, detailPhotoPreview, handleDetailChange, handleDetailPhotoChange])

  const columns = useMemo<DataTableColumn[]>(() => {
    const base: DataTableColumn[] = [
      { label: t('productos.columns.foto'), hideOnMobile: true, hideOnTablet: true, priority: 9 },
      { label: t('productos.columns.codigo'), priority: 2 },
      { label: t('productos.columns.nombre'), priority: 1 },
      { label: t('productos.columns.categoria'), priority: 3 },
      { label: t('productos.columns.subcategoria'), hideOnMobile: true, hideOnTablet: true, priority: 7 },
    ]
    const costoColumns = canViewCostos
      ? [
          { label: t('productos.columns.categoriaCompra'), hideOnMobile: true, hideOnTablet: true, priority: 8 },
          { label: t('productos.columns.linea'), hideOnMobile: true, priority: 6 },
          { label: t('productos.columns.costoN3'), hideOnMobile: true, hideOnTablet: true, priority: 10 },
          { label: t('productos.columns.recargo'), hideOnMobile: true, hideOnTablet: true, priority: 11 },
        ]
      : []
    return [
      ...base,
      ...costoColumns,
      { label: t('productos.columns.precio'), priority: 4 },
      { label: t('productos.columns.activo'), priority: 5 },
    ]
  }, [canViewCostos, t])

  const procesarListaPrecios = async (file: File) => {
    if (!configured) {
      setImportError(t('common.supabaseRequired'))
      return
    }
    setImportLoading(true)
    setImportError(null)
    setImportSummary(null)
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
      const entries = extractEntries(rows)
      if (entries.length === 0) {
        setImportError(t('productos.import.errors.noRecords'))
        setImportLoading(false)
        return
      }

      const uniqueEntries = Array.from(
        entries.reduce((map, entry) => map.set(entry.codigo, entry), new Map<string, PriceEntry>()).values()
      )

      const payloads = uniqueEntries.map((entry) => {
        const categoriaPrincipal = inferCategoriaPrincipal(entry.descripcion, entry.categoria_compra)
        const subcategoria = inferSubcategoria(categoriaPrincipal, entry.descripcion)
        const linea = inferLinea(entry.descripcion)
        const costos = computeCosts(entry.categoria_compra, entry.precio_base)
        return {
          codigo: entry.codigo,
          nombre: entry.descripcion,
          categoria: categoriaPrincipal,
          categoria_principal: categoriaPrincipal,
          categoria_compra: entry.categoria_compra,
          subcategoria,
          linea_producto: linea,
          recargo_arancelario: entry.recargo_arancelario,
          ...costos,
          activo: true,
        }
      })

      let errores = 0
      const chunkSize = 200
      for (let i = 0; i < payloads.length; i += chunkSize) {
        const chunk = payloads.slice(i, i + chunkSize)
        const { error: upsertError } = await supabase
          .from('productos')
          .upsert(chunk, { onConflict: 'codigo' })
        if (upsertError) {
          errores += chunk.length
          setImportError(upsertError.message)
        }
      }

      setImportSummary({
        total: payloads.length,
        procesados: payloads.length - errores,
        errores,
      })
      await loadProductos()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('productos.import.errors.process'))
    }
    setImportLoading(false)
  }

  if (configured && usersLoading) {
    return <div className="page">{t('common.loading')}</div>
  }

  if (configured && !usersLoading && !canAccessProductos) {
    return null
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('productos.title')}
        subtitle={t('productos.subtitle')}
        action={
          canManageProductos ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" type="button" onClick={() => setImportOpen(true)}>
                {t('productos.import.action')}
              </Button>
              <Button onClick={() => handleOpenForm()}>{t('common.newProducto')}</Button>
            </div>
          ) : undefined
        }
      />
      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div
          style={{
            display: 'grid',
            gap: '10px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            alignItems: 'end',
          }}
        >
          <label className="form-field">
            <span>{t('productos.fields.nombre')}</span>
            <input
              value={searchNombre}
              onChange={(event) => setSearchNombre(event.target.value)}
              placeholder={t('productos.fields.nombre')}
            />
          </label>
          <label className="form-field">
            <span>{t('productos.fields.codigo')}</span>
            <input
              value={searchCodigo}
              onChange={(event) => setSearchCodigo(event.target.value)}
              placeholder={t('productos.fields.codigo')}
            />
          </label>
          <label className="form-field">
            <span>{t('productos.fields.categoria')}</span>
            <select
              value={filtroCategoria}
              onChange={(event) => setFiltroCategoria(event.target.value)}
            >
              <option value="todas">{t('common.select')}</option>
              {categoriasUnicas.map((categoria) => (
                <option key={categoria} value={categoria}>
                  {categoria}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('productos.fields.linea')}</span>
            <select
              value={filtroLinea}
              onChange={(event) => setFiltroLinea(event.target.value)}
            >
              <option value="todas">{t('common.select')}</option>
              {lineasUnicas.map((linea) => (
                <option key={linea} value={linea}>
                  {linea}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setSearchNombre('')
                setSearchCodigo('')
                setFiltroCategoria('todas')
                setFiltroLinea('todas')
              }}
            >
              {t('common.clearFilters')}
            </Button>
          </div>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        emptyLabel={emptyLabel}
        onRowClick={(row) => setSelectedRow(row as DataTableRow & { originalData?: ProductoRecord })}
      />
      <Modal
        open={importOpen}
        title={t('productos.import.title')}
        description={t('productos.import.subtitle')}
        onClose={() => setImportOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setImportOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importLoading}
            >
              {importLoading ? t('common.saving') : t('productos.import.upload')}
            </Button>
          </>
        }
      >
        <div className="form-grid" style={{ gap: '0.75rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            {t('productos.import.instructions')}
          </p>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void procesarListaPrecios(file)
              }
              event.currentTarget.value = ''
            }}
          />
          {importError && <div className="form-error">{importError}</div>}
          {importSummary && (
            <div className="card" style={{ padding: '12px 14px' }}>
              <strong>{t('productos.import.summaryTitle')}</strong>
              <div style={{ marginTop: 6, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                {t('productos.import.summary', importSummary)}
              </div>
            </div>
          )}
        </div>
      </Modal>
      <Modal
        open={formOpen}
        title={t('productos.form.title')}
        onClose={handleCloseForm}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={handleCloseForm}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="producto-form" disabled={!!submitting}>
              {uploadStatus ?? (submitting ? t('common.saving') : t('common.save'))}
            </Button>
          </>
        }
      >
        <form id="producto-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.25rem' }}>
          {createPanelItems.map((item) => (
            <div key={item.label} style={{ display: 'grid', gap: '0.6rem' }}>
              <span style={{ ...LABEL_STYLE, fontSize: '0.8rem', fontWeight: 700 }}>{item.label}</span>
              {item.value}
            </div>
          ))}
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
        <DetailPanel
          open={Boolean(selectedRow)}
          title={t('productos.detailsTitle')}
          items={detailItems}
          onClose={() => {
            if (submitting) return
            setSelectedRow(null)
            setDetailEditMode(false)
            setDetailPhotoFile(null)
          }}
          action={
            canManageProductos ? (
            <div className="flex items-center gap-2">
              {detailEditMode ? (
                <>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setDetailEditMode(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button type="button" onClick={handleSaveDetail} disabled={!!submitting}>
                    {uploadStatus ?? (submitting ? t('common.saving') : t('common.save'))}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setDetailEditMode(true)}
                >
                  {t('common.edit')}
                </Button>
              )}
              <Button
                variant="ghost"
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="text-red-500 hover:text-red-600"
              >
                {deleting ? t('common.saving') : t('common.delete')}
              </Button>
            </div>
            ) : null
          }
        />
    </div>
  )
}
