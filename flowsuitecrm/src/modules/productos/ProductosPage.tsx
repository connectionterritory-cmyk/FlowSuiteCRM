import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { DetailPanel } from '../../components/DetailPanel'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useUsers } from '../../data/UsersProvider'
import { useViewMode } from '../../data/ViewModeProvider'

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

const initialForm = {
  codigo: '',
  nombre: '',
  categoria: '',
  precio: '',
  activo: true,
  foto_url: '' as string | null,
}

type PriceEntry = {
  categoria_compra: 'mercaderia' | 'premium' | 'miscelaneos'
  codigo: string
  descripcion: string
  precio_base: number
  recargo_arancelario: number
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
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<(DataTableRow & { originalData?: ProductoRecord }) | null>(null)
  const [detailEditMode, setDetailEditMode] = useState(false)
  const [detailValues, setDetailValues] = useState({
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
    showToast('No tienes acceso a Productos.', 'error')
    navigate('/dashboard', { replace: true })
  }, [canAccessProductos, configured, navigate, showToast, usersLoading])

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
  }, [selectedRow])

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

  const rows = useMemo<DataTableRow[]>(() => {
    return productosFiltrados.map((producto) => {
      const estadoLabel = producto.activo ? t('productos.estado.activo') : t('productos.estado.inactivo')
      const baseCells = [
        producto.foto_url ? (
          <img
            src={producto.foto_url}
            alt={producto.nombre ?? 'Producto'}
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
  }, [numberFormat, productosFiltrados, t])


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
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
    setPhotoFile(null)
    setEditingProductId(null)
    setFormOpen(false)
  }

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setPhotoFile(file)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

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
        return
      }
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
  }

  const handleChange = (field: keyof typeof initialForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target
      const value =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
        : target.value
      setFormValues((prev) => ({ ...prev, [field]: value }))
    }

  const handleDetailChange = (field: keyof typeof detailValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target
      const value =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
          : target.value
      setDetailValues((prev) => ({ ...prev, [field]: value }))
    }

  const handleDetailPhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setDetailPhotoFile(file)
    if (detailPhotoPreview && detailPhotoPreview.startsWith('blob:')) {
      URL.revokeObjectURL(detailPhotoPreview)
    }
    setDetailPhotoPreview(file ? URL.createObjectURL(file) : detailPhotoPreview)
  }

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
      const extension = detailPhotoFile.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
      const { error: uploadError } = await supabase
        .storage
        .from('productos')
        .upload(fileName, detailPhotoFile, { upsert: false })
      if (uploadError) {
        showToast(uploadError.message, 'error')
        setSubmitting(false)
        return
      }
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
    } else {
      setDetailEditMode(false)
      setDetailPhotoFile(null)
      await loadProductos()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const detailItems = useMemo(() => {
    if (!selectedRow?.originalData) return []
    const producto = selectedRow.originalData
    const renderInput = (value: string, onChange: (event: ChangeEvent<HTMLInputElement>) => void, placeholder?: string) => (
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '0.35rem 0.5rem',
          borderRadius: 6,
          border: '1px solid rgba(148,163,184,0.35)',
          background: 'rgba(255,255,255,0.06)',
          color: 'var(--text-primary)',
        }}
      />
    )
    const renderSelect = (value: string, options: string[], onChange: (event: ChangeEvent<HTMLSelectElement>) => void) => (
      <select
        value={value}
        onChange={onChange}
        style={{
          width: '100%',
          padding: '0.35rem 0.5rem',
          borderRadius: 6,
          border: '1px solid rgba(148,163,184,0.35)',
          background: 'rgba(255,255,255,0.06)',
          color: 'var(--text-primary)',
        }}
      >
        <option value="">{t('common.select')}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
    const renderNumber = (value: string, onChange: (event: ChangeEvent<HTMLInputElement>) => void) => (
      <input
        type="number"
        value={value}
        onChange={onChange}
        style={{
          width: '100%',
          padding: '0.35rem 0.5rem',
          borderRadius: 6,
          border: '1px solid rgba(148,163,184,0.35)',
          background: 'rgba(255,255,255,0.06)',
          color: 'var(--text-primary)',
        }}
      />
    )
    const categoriaCompraOptions = ['mercaderia', 'premium', 'miscelaneos']

    const baseItems = [
      {
        label: t('productos.fields.codigo'),
        value: producto.codigo ?? '-',
      },
      {
        label: t('productos.fields.nombre'),
        value: detailEditMode
          ? renderInput(detailValues.nombre, handleDetailChange('nombre'))
          : producto.nombre ?? '-',
      },
      {
        label: t('productos.fields.categoria'),
        value: detailEditMode
          ? renderInput(detailValues.categoria_principal, handleDetailChange('categoria_principal'), 'Ej. Filtracion')
          : producto.categoria_principal ?? producto.categoria ?? '-',
      },
      {
        label: t('productos.fields.subcategoria'),
        value: detailEditMode
          ? renderInput(detailValues.subcategoria, handleDetailChange('subcategoria'), 'Ej. Repuestos filtros')
          : producto.subcategoria ?? '-',
      },
      {
        label: t('productos.fields.linea'),
        value: detailEditMode
          ? renderInput(detailValues.linea_producto, handleDetailChange('linea_producto'), 'Ej. Innove')
          : producto.linea_producto ?? '-',
      },
    ]

    const costoItems = canViewCostos
      ? [
          {
            label: t('productos.fields.categoriaCompra'),
            value: detailEditMode
              ? renderSelect(detailValues.categoria_compra, categoriaCompraOptions, handleDetailChange('categoria_compra'))
              : producto.categoria_compra ?? '-',
          },
          {
            label: t('productos.fields.costoN1'),
            value: detailEditMode ? renderNumber(detailValues.costo_n1, handleDetailChange('costo_n1')) : producto.costo_n1 ?? '-',
          },
          {
            label: t('productos.fields.costoN2'),
            value: detailEditMode ? renderNumber(detailValues.costo_n2, handleDetailChange('costo_n2')) : producto.costo_n2 ?? '-',
          },
          {
            label: t('productos.fields.costoN3'),
            value: detailEditMode ? renderNumber(detailValues.costo_n3, handleDetailChange('costo_n3')) : producto.costo_n3 ?? '-',
          },
          {
            label: t('productos.fields.costoN4'),
            value: detailEditMode ? renderNumber(detailValues.costo_n4, handleDetailChange('costo_n4')) : producto.costo_n4 ?? '-',
          },
          {
            label: t('productos.fields.recargo'),
            value: detailEditMode
              ? renderNumber(detailValues.recargo_arancelario, handleDetailChange('recargo_arancelario'))
              : producto.recargo_arancelario ?? '-',
          },
        ]
      : []

    const editBanner = detailEditMode
      ? [{ label: t('productos.editingLabel'), value: t('productos.editingHelp') }]
      : []

    const photoValue = detailEditMode ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input type="file" accept="image/*" onChange={handleDetailPhotoChange} />
        {(detailPhotoPreview || producto.foto_url) && (
          <img
            src={detailPhotoPreview ?? producto.foto_url ?? ''}
            alt={producto.nombre ?? 'Producto'}
            style={{ maxWidth: '100%', borderRadius: 8 }}
          />
        )}
      </div>
    ) : (
      producto.foto_url ? (
        <img
          src={producto.foto_url}
          alt={producto.nombre ?? 'Producto'}
          style={{ maxWidth: '100%', borderRadius: 8 }}
        />
      ) : (
        '-'
      )
    )

    return [
      ...editBanner,
      ...baseItems,
      ...costoItems,
      {
        label: t('productos.fields.precio'),
        value: detailEditMode ? renderNumber(detailValues.precio, handleDetailChange('precio')) : producto.precio ?? '-',
      },
      {
        label: t('productos.fields.activo'),
        value: detailEditMode ? (
          <label className="checkbox-field" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={detailValues.activo} onChange={handleDetailChange('activo')} />
            {detailValues.activo ? t('productos.estado.activo') : t('productos.estado.inactivo')}
          </label>
        ) : (
          producto.activo ? t('productos.estado.activo') : t('productos.estado.inactivo')
        ),
      },
      {
        label: t('productos.fields.foto'),
        value: photoValue,
      },
    ]
  }, [selectedRow, detailEditMode, detailValues, canViewCostos, t, detailPhotoPreview])

  const columns = useMemo(() => {
    const base = [
      t('productos.columns.foto'),
      t('productos.columns.codigo'),
      t('productos.columns.nombre'),
      t('productos.columns.categoria'),
      t('productos.columns.subcategoria'),
    ]
    const costoColumns = canViewCostos
      ? [
          t('productos.columns.categoriaCompra'),
          t('productos.columns.linea'),
          t('productos.columns.costoN3'),
          t('productos.columns.recargo'),
        ]
      : []
    return [...base, ...costoColumns, t('productos.columns.precio'), t('productos.columns.activo')]
  }, [canViewCostos, t])

  const normalizeText = (value: unknown) => String(value ?? '').trim()

  const parseMoney = (value: unknown) => {
    const cleaned = normalizeText(value).replace(/\$/g, '').replace(/,/g, '')
    if (!cleaned) return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }

  const parseCategoriaCompra = (value: unknown) => {
    const code = normalizeText(value).toUpperCase()
    if (code === 'MRCH') return 'mercaderia'
    if (code === 'PREM') return 'premium'
    if (code === 'MISC') return 'miscelaneos'
    return null
  }

  const inferLinea = (descripcion: string) => {
    const upper = descripcion.toUpperCase()
    if (upper.includes('NOVEL')) return 'Novel'
    if (upper.includes('INNOVE')) return 'Innove'
    if (upper.includes('5 CAPAS') || upper.includes('5 CPS') || upper.includes('5CPS') || upper.includes('5CPAS')) return '5 Capas'
    if (upper.includes('EASY RELEASE')) return 'Easy Release'
    if (upper.includes('GOURMET') || upper.includes('GOURMT')) return 'Gourmet'
    if (upper.includes('PRECISION')) return 'Precision'
    return 'General'
  }

  const inferCategoriaPrincipal = (descripcion: string, categoriaCompra: PriceEntry['categoria_compra']) => {
    const upper = descripcion.toUpperCase()
    const has = (term: string) => upper.includes(term)

    if (has('FILTRO') || has('FRESCAPURE') || has('FRESCAFLOW') || has('OSMOSIS') || has('MINERAL') || has('ULTRAVIOLETA') || has('PURIFIC')) {
      return 'Filtracion'
    }
    if (has('CUCHILLO') || has('CUCHILL') || has('SANTOKU') || has('AFILADOR') || has('HACHA') || has('BLOQUE')) {
      return 'Cuchillos'
    }
    if (
      categoriaCompra === 'miscelaneos' &&
      (has('VALVULA') || has('VÁLVULA') || has('MANGO') || has('AGARR') || has('ASA') || has('ARO') || has('EMPAQUE') || has('PIEZA') || has('CUBIERTA'))
    ) {
      return 'Repuestos'
    }
    if (has('TAPA') || has('PARRILLA') || has('COLADOR') || has('ARO') || has('COVER')) {
      return 'Tapas y Parrillas'
    }
    if (has('BARISTA') || has('EXPERTEA') || has('ESPRESSO') || has('CHOCOLATERA') || has('BLENDER') || has('JUICER') || has('EXTRACTOR') || has('PRECISION COOK')) {
      return 'Electrodomesticos'
    }
    if (has('VASO') || has('COPA') || has('VAJILLA') || has('TAZON') || has('CRISTAL') || has('BAMBÚ') || has('BAMBU')) {
      return 'Vajilla'
    }
    if (has('FOLLETO') || has('CATALOGO') || has('RECETARIO') || has('LITERATURA') || has('BROCHURE') || has('TRIPTICO') || has('REVISTA') || has('LAMINAS')) {
      return 'Literatura'
    }
    if (has('MALETA') || has('MALETIN') || has('BOLSA') || has('MANTEL') || has('PRENDEDOR') || has('POSTER') || has('KIT DE PRESENTACION') || has('TARJETAS')) {
      return 'Materiales'
    }
    if (has('JUEGO') || has('JGO') || has('SIST') || has('SET')) {
      return 'Juegos de Ollas'
    }
    if (has('OLLA') || has('SARTEN') || has('PAELLERA') || has('WOK') || has('MULTIPAN') || has('CACEROLA') || has('PRESION')) {
      return 'Ollas y Sartenes'
    }
    if (categoriaCompra === 'miscelaneos') {
      return 'Accesorios'
    }
    if (categoriaCompra === 'premium') {
      return 'Accesorios'
    }
    return 'Accesorios'
  }

  const inferSubcategoria = (categoriaPrincipal: string, descripcion: string) => {
    const upper = descripcion.toUpperCase()
    const has = (term: string) => upper.includes(term)

    if (categoriaPrincipal === 'Filtracion') {
      if (has('CARTUCHO') || has('REPUEST') || has('REEMPLAZO')) return 'Repuestos filtros'
      if (has('FRESCAPURE')) return 'FrescaPure'
      if (has('FRESCAFLOW')) return 'FrescaFlow'
      if (has('ULTRA')) return 'Ultra'
      return 'General'
    }
    if (categoriaPrincipal === 'Tapas y Parrillas') {
      if (has('TAPA ALTA')) return 'Tapa alta'
      if (has('TAPA')) return 'Tapa'
      if (has('PARRILLA')) return 'Parrilla'
      if (has('COLADOR')) return 'Colador'
      if (has('ARO')) return 'Aro'
      return 'General'
    }
    if (categoriaPrincipal === 'Ollas y Sartenes') {
      if (has('OLLA')) return 'Olla'
      if (has('SARTEN')) return 'Sarten'
      if (has('PAELLERA')) return 'Paellera'
      if (has('WOK')) return 'Wok'
      if (has('MULTIPAN')) return 'MultiPan'
      if (has('PRESION')) return 'Olla presion'
      return 'General'
    }
    if (categoriaPrincipal === 'Electrodomesticos') {
      if (has('BLENDER')) return 'Blender'
      if (has('JUICER') || has('EXTRACTOR')) return 'Extractor'
      if (has('PRECISION COOK')) return 'Precision Cook'
      if (has('BARISTA') || has('ESPRESSO')) return 'Cafe'
      if (has('EXPERTEA')) return 'Te'
      if (has('CHOCOLATERA')) return 'Chocolate'
      return 'General'
    }
    if (categoriaPrincipal === 'Cuchillos') {
      if (has('SANTOKU')) return 'Santoku'
      if (has('AFILADOR')) return 'Afilador'
      if (has('BLOQUE')) return 'Bloque'
      if (has('HACHA')) return 'Hacha'
      if (has('JUEGO') || has('SET')) return 'Set'
      return 'General'
    }
    if (categoriaPrincipal === 'Vajilla') {
      if (has('VASO')) return 'Vasos'
      if (has('COPA')) return 'Copas'
      if (has('TAZON')) return 'Tazones'
      if (has('TABLA')) return 'Tablas'
      if (has('RECIPIENTE')) return 'Recipientes'
      return 'General'
    }
    if (categoriaPrincipal === 'Accesorios') {
      if (has('PERFECT POP')) return 'Perfect Pop'
      if (has('SMART TEMP')) return 'Smart Temp'
      if (has('WARMER')) return 'Warmer Pro'
      if (has('UTENSIL')) return 'Utensilios'
      return 'General'
    }
    if (categoriaPrincipal === 'Repuestos') {
      if (has('VALVULA') || has('VÁLVULA')) return 'Valvulas'
      if (has('MANGO') || has('AGARR') || has('ASA')) return 'Mangos y agarraderas'
      if (has('ARO')) return 'Aros'
      if (has('EMPAQUE')) return 'Empaques'
      return 'General'
    }
    if (categoriaPrincipal === 'Juegos de Ollas') {
      return 'Juegos'
    }
    return 'General'
  }

  const computeCosts = (categoriaCompra: PriceEntry['categoria_compra'], base: number) => {
    if (categoriaCompra !== 'mercaderia') {
      return {
        costo_n1: base,
        costo_n2: base,
        costo_n3: base,
        costo_n4: base,
      }
    }
    return {
      costo_n1: Number((base * 0.9).toFixed(2)),
      costo_n2: Number((base * 0.95).toFixed(2)),
      costo_n3: Number(base.toFixed(2)),
      costo_n4: Number((base * 1.1).toFixed(2)),
    }
  }

  const extractEntries = (rows: unknown[][]) => {
    const entries: PriceEntry[] = []
    const extractBlock = (row: unknown[], offset: number) => {
      const categoriaCompra = parseCategoriaCompra(row[offset])
      if (!categoriaCompra) return
      const codigo = normalizeText(row[offset + 1])
      const descripcion = normalizeText(row[offset + 3])
      const precio = parseMoney(row[offset + 7])
      const recargo = parseMoney(row[offset + 9]) ?? 0
      if (!codigo || !descripcion || precio == null) return
      entries.push({
        categoria_compra: categoriaCompra,
        codigo,
        descripcion,
        precio_base: precio,
        recargo_arancelario: recargo,
      })
    }

    rows.forEach((row) => {
      extractBlock(row, 0)
      extractBlock(row, 12)
    })

    return entries
  }

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
        setImportError('No se encontraron registros validos.')
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
      setImportError(err instanceof Error ? err.message : 'Error al procesar el archivo.')
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
            <Button type="submit" form="producto-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="producto-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{t('productos.fields.codigo')}</span>
            <input value={formValues.codigo} onChange={handleChange('codigo')} />
          </label>
          <label className="form-field">
            <span>{t('productos.fields.nombre')}</span>
            <input value={formValues.nombre} onChange={handleChange('nombre')} />
          </label>
          <label className="form-field">
            <span>{t('productos.fields.categoria')}</span>
            <input value={formValues.categoria} onChange={handleChange('categoria')} />
          </label>
          <label className="form-field">
            <span>{t('productos.fields.precio')}</span>
            <input type="number" value={formValues.precio} onChange={handleChange('precio')} />
          </label>
          <label className="form-field" style={{ gridColumn: '1 / -1' }}>
            <span>{t('productos.fields.foto')}</span>
            <input type="file" accept="image/*" onChange={handlePhotoChange} />
            {photoPreview && (
              <img
                src={photoPreview}
                alt={t('productos.fields.foto')}
                style={{ marginTop: 8, maxWidth: '220px', borderRadius: 8 }}
              />
            )}
          </label>
          <label className="form-field checkbox-field">
            <span>{t('productos.fields.activo')}</span>
            <input type="checkbox" checked={formValues.activo} onChange={handleChange('activo')} />
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
        <DetailPanel
          open={Boolean(selectedRow)}
          title={t('productos.detailsTitle')}
          items={detailItems}
          onClose={() => {
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
                  <Button type="button" onClick={handleSaveDetail} disabled={submitting}>
                    {submitting ? t('common.saving') : t('common.save')}
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
