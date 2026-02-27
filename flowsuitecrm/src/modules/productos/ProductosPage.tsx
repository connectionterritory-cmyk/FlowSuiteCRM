import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  precio: number | null
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

export function ProductosPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { currentRole } = useUsers()
  const { viewMode, hasDistribuidorScope } = useViewMode()
  const [productos, setProductos] = useState<ProductoRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<(DataTableRow & { originalData?: ProductoRecord }) | null>(null)
  const [searchNombre, setSearchNombre] = useState('')
  const [searchCodigo, setSearchCodigo] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('todas')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const configured = isSupabaseConfigured
  const canManageProductos =
    (currentRole === 'admin' || currentRole === 'distribuidor') &&
    !(hasDistribuidorScope && viewMode === 'seller')

  const loadProductos = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('productos')
      .select('id, codigo, nombre, categoria, precio, activo, foto_url, created_at')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setProductos([])
    } else {
      setProductos(data ?? [])
    }
    setLoading(false)
  }, [configured])

  useEffect(() => {
    if (configured) {
      loadProductos()
    }
  }, [configured, loadProductos])

  const categoriasUnicas = useMemo(() => {
    const categorias = new Set<string>()
    productos.forEach((producto) => {
      if (producto.categoria) categorias.add(producto.categoria)
    })
    return Array.from(categorias).sort((a, b) => a.localeCompare(b))
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
        filtroCategoria === 'todas' || producto.categoria === filtroCategoria
      return matchNombre && matchCodigo && matchCategoria
    })
  }, [productos, searchNombre, searchCodigo, filtroCategoria])

  const rows = useMemo<DataTableRow[]>(() => {
    return productosFiltrados.map((producto) => {
      const estadoLabel = producto.activo ? t('productos.estado.activo') : t('productos.estado.inactivo')
      return {
        id: producto.id,
        originalData: producto,
        cells: [
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
          producto.categoria ?? '-',
          producto.precio != null ? numberFormat.format(producto.precio) : '-',
          estadoLabel,
        ],
        detail: [
          { label: t('productos.fields.codigo'), value: producto.codigo ?? '-' },
          { label: t('productos.fields.nombre'), value: producto.nombre ?? '-' },
          { label: t('productos.fields.categoria'), value: producto.categoria ?? '-' },
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
        categoria: producto.categoria ?? '',
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

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('productos.title')}
        subtitle={t('productos.subtitle')}
        action={
          canManageProductos ? (
            <Button onClick={() => handleOpenForm()}>{t('common.newProducto')}</Button>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setSearchNombre('')
                setSearchCodigo('')
                setFiltroCategoria('todas')
              }}
            >
              {t('common.clearFilters')}
            </Button>
          </div>
        </div>
      </div>
      <DataTable
        columns={[
          t('productos.columns.foto'),
          t('productos.columns.codigo'),
          t('productos.columns.nombre'),
          t('productos.columns.categoria'),
          t('productos.columns.precio'),
          t('productos.columns.activo'),
        ]}
        rows={rows}
        emptyLabel={emptyLabel}
        onRowClick={(row) => setSelectedRow(row as DataTableRow & { originalData?: ProductoRecord })}
      />
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
          items={selectedRow?.detail ?? []}
          onClose={() => setSelectedRow(null)}
          action={
            canManageProductos ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                type="button"
                onClick={() => handleOpenForm(selectedRow?.originalData)}
              >
                {t('common.edit')}
              </Button>
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
