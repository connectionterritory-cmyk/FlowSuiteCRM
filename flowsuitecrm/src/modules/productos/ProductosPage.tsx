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

type ProductoRecord = {
  id: string
  codigo: string | null
  nombre: string | null
  categoria: string | null
  precio: number | null
  activo: boolean | null
  created_at: string | null
}

const initialForm = {
  codigo: '',
  nombre: '',
  categoria: '',
  precio: '',
  activo: true,
}

export function ProductosPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [productos, setProductos] = useState<ProductoRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedRow, setSelectedRow] = useState<DataTableRow | null>(null)
  const configured = isSupabaseConfigured

  const loadProductos = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('productos')
      .select('id, codigo, nombre, categoria, precio, activo, created_at')
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

  const numberFormat = useMemo(() => new Intl.NumberFormat(undefined), [])

  const rows = useMemo<DataTableRow[]>(() => {
    return productos.map((producto) => {
      const estadoLabel = producto.activo ? t('productos.estado.activo') : t('productos.estado.inactivo')
      return {
        id: producto.id,
        cells: [
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
        ],
      }
    })
  }, [numberFormat, productos, t])

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  const handleOpenForm = () => {
    setFormValues(initialForm)
    setFormError(null)
    setFormOpen(true)
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
    const payload = {
      codigo: toNull(formValues.codigo),
      nombre: toNull(formValues.nombre),
      categoria: toNull(formValues.categoria),
      precio: formValues.precio === '' ? 0 : Number(formValues.precio),
      activo: formValues.activo,
    }

    const { error: insertError } = await supabase.from('productos').insert(payload)

    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      setFormOpen(false)
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
        action={<Button onClick={handleOpenForm}>{t('common.newProducto')}</Button>}
      />
      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}
      {error && <div className="form-error">{error}</div>}
      <DataTable
        columns={[
          t('productos.columns.codigo'),
          t('productos.columns.nombre'),
          t('productos.columns.categoria'),
          t('productos.columns.precio'),
          t('productos.columns.activo'),
        ]}
        rows={rows}
        emptyLabel={emptyLabel}
        onRowClick={setSelectedRow}
      />
      <Modal
        open={formOpen}
        title={t('productos.form.title')}
        onClose={() => setFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
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
      />
    </div>
  )
}
