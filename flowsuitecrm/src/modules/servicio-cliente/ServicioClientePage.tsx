import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'

type ClienteOption = {
  id: string
  nombre: string | null
  apellido: string | null
}

type ProductoOption = {
  id: string
  nombre: string | null
}

type EquipoInstalado = {
  id: string
  cliente_id: string | null
  producto_id: string | null
  numero_serie: string | null
  fecha_instalacion: string | null
  activo: boolean | null
}

type ComponenteEquipo = {
  id: string
  equipo_instalado_id: string | null
  nombre_componente: string | null
  ciclo_meses: number | null
  fecha_proximo_cambio: string | null
  activo: boolean | null
}

type ServicioRecord = {
  id: string
  cliente_id: string | null
  equipo_instalado_id: string | null
  fecha_servicio: string | null
  tipo: string | null
  observaciones: string | null
  venta_id: string | null
}

type VentaOption = {
  id: string
  cliente_id: string | null
  numero_nota_pedido: string | null
}

const initialServiceForm = {
  cliente_id: '',
  equipo_instalado_id: '',
  fecha_servicio: '',
  tipo: 'cambio_repuesto',
  observaciones: '',
  venta_id: '',
}

export function ServicioClientePage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [productos, setProductos] = useState<ProductoOption[]>([])
  const [equipos, setEquipos] = useState<EquipoInstalado[]>([])
  const [componentes, setComponentes] = useState<ComponenteEquipo[]>([])
  const [servicios, setServicios] = useState<ServicioRecord[]>([])
  const [ventas, setVentas] = useState<VentaOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialServiceForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadData = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const [clientesResult, productosResult, equiposResult, componentesResult, serviciosResult, ventasResult] =
      await Promise.all([
        supabase.from('clientes').select('id, nombre, apellido'),
        supabase.from('productos').select('id, nombre'),
        supabase
          .from('equipos_instalados')
          .select('id, cliente_id, producto_id, numero_serie, fecha_instalacion, activo'),
        supabase
          .from('componentes_equipo')
          .select('id, equipo_instalado_id, nombre_componente, ciclo_meses, fecha_proximo_cambio, activo'),
        supabase
          .from('servicios')
          .select('id, cliente_id, equipo_instalado_id, fecha_servicio, tipo, observaciones, venta_id'),
        supabase.from('ventas').select('id, cliente_id, numero_nota_pedido'),
      ])

    if (clientesResult.error || productosResult.error || equiposResult.error || componentesResult.error || serviciosResult.error || ventasResult.error) {
      setError(
        clientesResult.error?.message ||
          productosResult.error?.message ||
          equiposResult.error?.message ||
          componentesResult.error?.message ||
          serviciosResult.error?.message ||
          ventasResult.error?.message ||
          t('common.noData')
      )
    }

    setClientes((clientesResult.data as ClienteOption[]) ?? [])
    setProductos((productosResult.data as ProductoOption[]) ?? [])
    setEquipos((equiposResult.data as EquipoInstalado[]) ?? [])
    setComponentes((componentesResult.data as ComponenteEquipo[]) ?? [])
    setServicios((serviciosResult.data as ServicioRecord[]) ?? [])
    setVentas((ventasResult.data as VentaOption[]) ?? [])
    setLoading(false)
  }, [configured, t])

  useEffect(() => {
    if (configured) {
      loadData()
    }
  }, [configured, loadData])

  const clienteMap = useMemo(() => {
    return new Map(
      clientes.map((cliente) => [
        cliente.id,
        [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.id,
      ])
    )
  }, [clientes])

  const productoMap = useMemo(() => {
    return new Map(productos.map((producto) => [producto.id, producto.nombre ?? producto.id]))
  }, [productos])

  const equipoMap = useMemo(() => {
    return new Map(
      equipos.map((equipo) => {
        const producto = equipo.producto_id ? productoMap.get(equipo.producto_id) : null
        const serie = equipo.numero_serie ? `#${equipo.numero_serie}` : ''
        const label = [producto, serie].filter(Boolean).join(' ')
        return [equipo.id, label || equipo.id]
      })
    )
  }, [equipos, productoMap])

  const ventasMap = useMemo(() => {
    return new Map(
      ventas.map((venta) => [
        venta.id,
        venta.numero_nota_pedido ? `${venta.numero_nota_pedido}` : venta.id,
      ])
    )
  }, [ventas])

  const equiposRows = useMemo<DataTableRow[]>(() => {
    return equipos.map((equipo) => {
      const clienteLabel = equipo.cliente_id ? clienteMap.get(equipo.cliente_id) ?? equipo.cliente_id : '-'
      const productoLabel = equipo.producto_id ? productoMap.get(equipo.producto_id) ?? equipo.producto_id : '-'
      const estadoLabel = equipo.activo ? t('clientes.estado.activo') : t('clientes.estado.inactivo')
      return {
        id: equipo.id,
        cells: [clienteLabel, productoLabel, equipo.fecha_instalacion ?? '-', equipo.numero_serie ?? '-', estadoLabel],
      }
    })
  }, [clienteMap, equipos, productoMap, t])

  const componentesRows = useMemo<DataTableRow[]>(() => {
    return componentes.map((componente) => {
      const equipoLabel = componente.equipo_instalado_id
        ? equipoMap.get(componente.equipo_instalado_id) ?? componente.equipo_instalado_id
        : '-'
      const estadoLabel = componente.activo ? t('clientes.estado.activo') : t('clientes.estado.inactivo')
      return {
        id: componente.id,
        cells: [
          equipoLabel,
          componente.nombre_componente ?? '-',
          componente.ciclo_meses ?? '-',
          componente.fecha_proximo_cambio ?? '-',
          estadoLabel,
        ],
      }
    })
  }, [componentes, equipoMap, t])

  const serviciosRows = useMemo<DataTableRow[]>(() => {
    return servicios.map((servicio) => {
      const clienteLabel = servicio.cliente_id ? clienteMap.get(servicio.cliente_id) ?? servicio.cliente_id : '-'
      const ventaLabel = servicio.venta_id ? ventasMap.get(servicio.venta_id) ?? servicio.venta_id : '-'
      const tipoLabel = servicio.tipo ? t(`servicio.types.${servicio.tipo}`) : '-'
      return {
        id: servicio.id,
        cells: [
          clienteLabel,
          servicio.fecha_servicio ?? '-',
          tipoLabel,
          servicio.observaciones ?? '-',
          ventaLabel,
        ],
      }
    })
  }, [clienteMap, servicios, t, ventasMap])

  const equiposOptions = useMemo(() => {
    return equipos.filter((equipo) => equipo.cliente_id === formValues.cliente_id)
  }, [equipos, formValues.cliente_id])

  const ventasOptions = useMemo(() => {
    return ventas.filter((venta) => venta.cliente_id === formValues.cliente_id)
  }, [formValues.cliente_id, ventas])

  const handleOpenForm = () => {
    setFormValues(initialServiceForm)
    setFormError(null)
    setFormOpen(true)
  }

  const handleChange = (field: keyof typeof initialServiceForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value
      if (field === 'cliente_id') {
        setFormValues((prev) => ({
          ...prev,
          cliente_id: value,
          equipo_instalado_id: '',
          venta_id: '',
        }))
        return
      }
      setFormValues((prev) => ({ ...prev, [field]: value }))
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
    const vendedorId = session?.user.id ?? null
    const payload = {
      cliente_id: toNull(formValues.cliente_id),
      equipo_instalado_id: toNull(formValues.equipo_instalado_id),
      vendedor_id: vendedorId,
      fecha_servicio: formValues.fecha_servicio || null,
      tipo: formValues.tipo,
      observaciones: toNull(formValues.observaciones),
      venta_id: toNull(formValues.venta_id),
    }

    const { error: insertError } = await supabase.from('servicios').insert(payload)

    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      setFormOpen(false)
      await loadData()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('servicio.title')}
        subtitle={t('servicio.subtitle')}
        action={<Button onClick={handleOpenForm}>{t('servicio.newService')}</Button>}
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
          t('servicio.equipos.columns.cliente'),
          t('servicio.equipos.columns.producto'),
          t('servicio.equipos.columns.instalacion'),
          t('servicio.equipos.columns.numeroSerie'),
          t('servicio.equipos.columns.activo'),
        ]}
        rows={equiposRows}
        emptyLabel={emptyLabel}
      />

      <DataTable
        columns={[
          t('servicio.componentes.columns.equipo'),
          t('servicio.componentes.columns.componente'),
          t('servicio.componentes.columns.ciclo'),
          t('servicio.componentes.columns.proximo'),
          t('servicio.componentes.columns.activo'),
        ]}
        rows={componentesRows}
        emptyLabel={emptyLabel}
      />

      <DataTable
        columns={[
          t('servicio.servicios.columns.cliente'),
          t('servicio.servicios.columns.fecha'),
          t('servicio.servicios.columns.tipo'),
          t('servicio.servicios.columns.observaciones'),
          t('servicio.servicios.columns.venta'),
        ]}
        rows={serviciosRows}
        emptyLabel={emptyLabel}
      />

      <Modal
        open={formOpen}
        title={t('servicio.form.title')}
        onClose={() => setFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="servicio-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="servicio-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{t('servicio.form.fields.cliente')}</span>
            <select value={formValues.cliente_id} onChange={handleChange('cliente_id')}>
              <option value="">{t('common.select')}</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {[cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('servicio.form.fields.equipo')}</span>
            <select value={formValues.equipo_instalado_id} onChange={handleChange('equipo_instalado_id')}>
              <option value="">{t('common.select')}</option>
              {equiposOptions.map((equipo) => (
                <option key={equipo.id} value={equipo.id}>
                  {equipoMap.get(equipo.id) ?? equipo.id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('servicio.form.fields.fecha')}</span>
            <input type="date" value={formValues.fecha_servicio} onChange={handleChange('fecha_servicio')} />
          </label>
          <label className="form-field">
            <span>{t('servicio.form.fields.tipo')}</span>
            <select value={formValues.tipo} onChange={handleChange('tipo')}>
              <option value="cambio_repuesto">{t('servicio.types.cambio_repuesto')}</option>
              <option value="revision">{t('servicio.types.revision')}</option>
              <option value="garantia">{t('servicio.types.garantia')}</option>
              <option value="queja">{t('servicio.types.queja')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t('servicio.form.fields.observaciones')}</span>
            <textarea rows={3} value={formValues.observaciones} onChange={handleChange('observaciones')} />
          </label>
          <label className="form-field">
            <span>{t('servicio.form.fields.venta')}</span>
            <select value={formValues.venta_id} onChange={handleChange('venta_id')}>
              <option value="">{t('common.select')}</option>
              {ventasOptions.map((venta) => (
                <option key={venta.id} value={venta.id}>
                  {ventasMap.get(venta.id) ?? venta.id}
                </option>
              ))}
            </select>
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
    </div>
  )
}
