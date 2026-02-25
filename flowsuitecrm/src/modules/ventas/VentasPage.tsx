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
import { useAuth } from '../../auth/AuthProvider'
import { useUsers } from '../../data/UsersProvider'

type VentaRecord = {
  id: string
  numero_nota_pedido: string | null
  cliente_id: string | null
  vendedor_id: string | null
  producto_id: string | null
  tipo_movimiento: string | null
  monto: number | null
  fecha_venta: string | null
  created_at: string | null
}

type ClienteOption = {
  id: string
  nombre: string | null
  apellido: string | null
}

type LeadOption = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  email?: string | null
  referido_por_cliente_id?: string | null
}

type ProductoOption = {
  id: string
  nombre: string | null
}

const initialForm = {
  numero_nota_pedido: '',
  cliente_id: '',
  vendedor_id: '',
  producto_id: '',
  tipo_movimiento: 'venta_inicial',
  monto: '',
  fecha_venta: '',
}

const initialClienteForm = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  direccion: '',
  apartamento: '',
  ciudad: '',
  estado_region: '',
  codigo_postal: '',
  numero_cuenta_financiera: '',
  saldo_actual: '',
  estado_morosidad: '',
  distribuidor_id: '',
  fecha_nacimiento: '',
  activo: true,
}

const initialProductoForm = {
  codigo: '',
  nombre: '',
  categoria: '',
  precio: '',
  activo: true,
}

function tipoBadgeStyle(tipo: string | null): { background: string; color: string } {
  if (tipo === 'venta_inicial') return { background: '#dbeafe', color: '#1e40af' }
  if (tipo === 'agregado') return { background: '#d1fae5', color: '#065f46' }
  return { background: '#f3f4f6', color: '#6b7280' }
}

export function VentasPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { usersById, currentRole } = useUsers()
  const { showToast } = useToast()
  const [ventas, setVentas] = useState<VentaRecord[]>([])
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [leads, setLeads] = useState<LeadOption[]>([])
  const [productos, setProductos] = useState<ProductoOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [ventaOwnerType, setVentaOwnerType] = useState<'cliente' | 'prospecto'>('cliente')
  const [prospectoId, setProspectoId] = useState('')
  const [prospectoCuenta, setProspectoCuenta] = useState('')
  const [clienteFormOpen, setClienteFormOpen] = useState(false)
  const [clienteFormValues, setClienteFormValues] = useState(initialClienteForm)
  const [clienteFormError, setClienteFormError] = useState<string | null>(null)
  const [clienteSubmitting, setClienteSubmitting] = useState(false)
  const [productoFormOpen, setProductoFormOpen] = useState(false)
  const [productoFormValues, setProductoFormValues] = useState(initialProductoForm)
  const [productoFormError, setProductoFormError] = useState<string | null>(null)
  const [productoSubmitting, setProductoSubmitting] = useState(false)
  const [selectedRow, setSelectedRow] = useState<DataTableRow | null>(null)
  const configured = isSupabaseConfigured

  // --- FILTROS ---
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroVendedor, setFiltroVendedor] = useState('todos')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const [filtrosVisible, setFiltrosVisible] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 720)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const loadVentas = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    let query = supabase
      .from('ventas')
      .select('id, numero_nota_pedido, cliente_id, vendedor_id, producto_id, tipo_movimiento, monto, fecha_venta, created_at')
      .order('created_at', { ascending: false })
    if (currentRole === 'vendedor' && session?.user.id) {
      query = query.eq('vendedor_id', session.user.id)
    }
    const { data, error: fetchError } = await query
    if (fetchError) {
      setError(fetchError.message)
      setVentas([])
    } else {
      setVentas(data ?? [])
    }
    setLoading(false)
  }, [configured, currentRole, session?.user.id])

  const loadOptions = useCallback(async () => {
    if (!configured) return
    setLoadingOptions(true)
    const [clientesResult, productosResult, leadsResult] = await Promise.all([
      supabase.from('clientes').select('id, nombre, apellido').order('nombre'),
      supabase.from('productos').select('id, nombre').order('nombre'),
      supabase
        .from('leads')
        .select('id, nombre, apellido, telefono, email, referido_por_cliente_id')
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ])
    setClientes(clientesResult.data ?? [])
    setProductos(productosResult.data ?? [])
    setLeads((leadsResult.data as LeadOption[]) ?? [])
    setLoadingOptions(false)
  }, [configured])

  useEffect(() => {
    if (configured) {
      loadVentas()
      loadOptions()
    }
  }, [configured, loadVentas, loadOptions])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 720)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const numberFormat = useMemo(() => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }), [])

  const clienteMap = useMemo(() => {
    return new Map(
      clientes.map((c) => [c.id, [c.nombre, c.apellido].filter(Boolean).join(' ') || c.id])
    )
  }, [clientes])

  const productoMap = useMemo(() => {
    return new Map(productos.map((p) => [p.id, p.nombre ?? p.id]))
  }, [productos])

  // --- VENDEDORES ÚNICOS ---
  const vendedoresUnicos = useMemo(() => {
    const ids = [...new Set(ventas.map((v) => v.vendedor_id).filter(Boolean))] as string[]
    return ids.map((id) => ({ id, nombre: usersById[id] ?? id }))
  }, [ventas, usersById])

  // --- FILTRADO ---
  const ventasFiltradas = useMemo(() => {
    return ventas.filter((v) => {
      const nota = (v.numero_nota_pedido ?? '').toLowerCase()
      const clienteNombre = v.cliente_id ? (clienteMap.get(v.cliente_id) ?? '').toLowerCase() : ''
      const matchBusqueda = !busqueda || nota.includes(busqueda.toLowerCase()) || clienteNombre.includes(busqueda.toLowerCase())
      const matchTipo = filtroTipo === 'todos' || v.tipo_movimiento === filtroTipo
      const matchVendedor = filtroVendedor === 'todos' || v.vendedor_id === filtroVendedor
      const matchDesde = !filtroFechaDesde || (v.fecha_venta ?? '') >= filtroFechaDesde
      const matchHasta = !filtroFechaHasta || (v.fecha_venta ?? '') <= filtroFechaHasta
      return matchBusqueda && matchTipo && matchVendedor && matchDesde && matchHasta
    })
  }, [ventas, busqueda, filtroTipo, filtroVendedor, filtroFechaDesde, filtroFechaHasta, clienteMap])

  // --- ORDENACIÓN ---
  const handleSort = (colIndex: number) => {
    if (sortCol === colIndex) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(colIndex)
      setSortDir('asc')
    }
  }

  const ventasOrdenadas = useMemo(() => {
    if (sortCol === null) return ventasFiltradas
    return [...ventasFiltradas].sort((a, b) => {
      let valA: string | number = 0
      let valB: string | number = 0
      if (sortCol === 4) {
        valA = a.monto ?? 0
        valB = b.monto ?? 0
      } else if (sortCol === 6) {
        valA = a.fecha_venta ?? ''
        valB = b.fecha_venta ?? ''
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [ventasFiltradas, sortCol, sortDir])

  // --- ESTADISTICAS ---
  const stats = useMemo(() => {
    const montoTotal = ventas.reduce((acc, v) => acc + (v.monto ?? 0), 0)
    return {
      total: ventas.length,
      montoTotal,
      ventaInicial: ventas.filter((v) => v.tipo_movimiento === 'venta_inicial').length,
      agregado: ventas.filter((v) => v.tipo_movimiento === 'agregado').length,
    }
  }, [ventas])

  // --- ROWS ---
  const rows = useMemo<DataTableRow[]>(() => {
    return ventasOrdenadas.map((venta) => {
      const tipoLabel = venta.tipo_movimiento ? t(`ventas.tipo.${venta.tipo_movimiento}`) : '-'
      const clienteLabel = venta.cliente_id ? clienteMap.get(venta.cliente_id) ?? venta.cliente_id : '-'
      const productoLabel = venta.producto_id ? productoMap.get(venta.producto_id) ?? venta.producto_id : '-'
      const vendedorLabel = venta.vendedor_id ? usersById[venta.vendedor_id] ?? venta.vendedor_id : '-'
      return {
        id: venta.id,
        cells: [
          venta.numero_nota_pedido ?? '-',
          clienteLabel,
          productoLabel,
          vendedorLabel,
          venta.monto != null ? numberFormat.format(venta.monto) : '-',
          tipoLabel,
          venta.fecha_venta ?? '-',
        ],
        detail: [
          { label: t('ventas.fields.numeroNotaPedido'), value: venta.numero_nota_pedido ?? '-' },
          { label: t('ventas.fields.clienteId'), value: clienteLabel },
          { label: t('ventas.fields.vendedorId'), value: vendedorLabel },
          { label: t('ventas.fields.productoId'), value: productoLabel },
          { label: t('ventas.fields.tipoMovimiento'), value: tipoLabel },
          { label: t('ventas.fields.monto'), value: venta.monto != null ? numberFormat.format(venta.monto) : '-' },
          { label: t('ventas.fields.fechaVenta'), value: venta.fecha_venta ?? '-' },
        ],
      }
    })
  }, [clienteMap, numberFormat, productoMap, t, usersById, ventasOrdenadas])

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  // --- FILTROS HELPERS ---
  const limpiarFiltros = () => {
    setBusqueda('')
    setFiltroTipo('todos')
    setFiltroVendedor('todos')
    setFiltroFechaDesde('')
    setFiltroFechaHasta('')
  }

  const cantFiltrosActivos = [
    busqueda,
    filtroTipo !== 'todos' ? '1' : '',
    filtroVendedor !== 'todos' ? '1' : '',
    filtroFechaDesde,
    filtroFechaHasta,
  ].filter(Boolean).length

  // --- CSV EXPORT ---
  const exportarCSV = () => {
    const headers = ['Nota Pedido', 'Cliente', 'Producto', 'Vendedor', 'Monto', 'Tipo', 'Fecha']
    const csvRows = ventasFiltradas.map((v) => [
      v.numero_nota_pedido ?? '',
      v.cliente_id ? clienteMap.get(v.cliente_id) ?? '' : '',
      v.producto_id ? productoMap.get(v.producto_id) ?? '' : '',
      v.vendedor_id ? usersById[v.vendedor_id] ?? v.vendedor_id : '',
      v.monto ?? 0,
      v.tipo_movimiento ? t(`ventas.tipo.${v.tipo_movimiento}`) : '',
      v.fecha_venta ?? '',
    ])
    const csv = [headers, ...csvRows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ventas_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // --- FORM HANDLERS ---
  const handleOpenForm = () => {
    setFormValues({ ...initialForm, vendedor_id: session?.user.id ?? '' })
    setVentaOwnerType('cliente')
    setProspectoId('')
    setProspectoCuenta('')
    setFormError(null)
    setFormOpen(true)
  }

  const handleOwnerTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === 'prospecto' ? 'prospecto' : 'cliente'
    setVentaOwnerType(value)
    if (value === 'cliente') {
      setProspectoId('')
      setProspectoCuenta('')
    } else {
      setFormValues((prev) => ({ ...prev, cliente_id: '' }))
    }
  }

  const vendedorName = session?.user.id ? (usersById[session.user.id] ?? session.user.id) : '-'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) { setFormError(t('common.supabaseRequired')); return }
    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const vendedorId = session?.user.id ?? null
    let clienteIdFinal = toNull(formValues.cliente_id)

    if (ventaOwnerType === 'cliente') {
      if (!clienteIdFinal) { setFormError(t('ventas.errors.selectCliente')); setSubmitting(false); return }
    } else {
      if (!prospectoId) { setFormError(t('ventas.errors.selectProspecto')); setSubmitting(false); return }
      const cuenta = prospectoCuenta.trim()
      if (!cuenta) { setFormError(t('ventas.errors.accountRequired')); setSubmitting(false); return }
      const prospecto = leads.find((lead) => lead.id === prospectoId)
      if (!prospecto) { setFormError(t('ventas.errors.prospectoMissing')); setSubmitting(false); return }
      const clientePayload = {
        nombre: toNull(prospecto.nombre ?? ''),
        apellido: toNull(prospecto.apellido ?? ''),
        email: toNull(prospecto.email ?? ''),
        telefono: toNull(prospecto.telefono ?? ''),
        numero_cuenta_financiera: toNull(cuenta),
        vendedor_id: vendedorId,
        referido_por_cliente_id: prospecto.referido_por_cliente_id ?? null,
        activo: true,
      }
      const { data: clienteData, error: clienteError } = await supabase
        .from('clientes').insert(clientePayload).select('id').single()
      if (clienteError || !clienteData) {
        setFormError(clienteError?.message ?? t('toast.error'))
        showToast(clienteError?.message ?? t('toast.error'), 'error')
        setSubmitting(false)
        return
      }
      clienteIdFinal = clienteData.id
      const { error: leadUpdateError } = await supabase
        .from('leads').update({ estado_pipeline: 'cierre', next_action: 'Convertido' }).eq('id', prospectoId)
      if (leadUpdateError) showToast(leadUpdateError.message, 'error')
    }

    const payload = {
      numero_nota_pedido: toNull(formValues.numero_nota_pedido),
      cliente_id: clienteIdFinal,
      vendedor_id: vendedorId,
      producto_id: toNull(formValues.producto_id),
      tipo_movimiento: formValues.tipo_movimiento,
      monto: formValues.monto === '' ? 0 : Number(formValues.monto),
      fecha_venta: formValues.fecha_venta || null,
    }

    const { error: insertError } = await supabase.from('ventas').insert(payload)
    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      setFormOpen(false)
      setProspectoId('')
      setProspectoCuenta('')
      setVentaOwnerType('cliente')
      await loadOptions()
      await loadVentas()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const handleChange = (field: keyof typeof initialForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFormValues((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleClienteChange = (field: keyof typeof initialClienteForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target
      const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value
      setClienteFormValues((prev) => ({ ...prev, [field]: value }))
    }

  const handleProductoChange = (field: keyof typeof initialProductoForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target
      const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value
      setProductoFormValues((prev) => ({ ...prev, [field]: value }))
    }

  const buildDireccionValue = () => {
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const direccionPayload = {
      direccion: toNull(clienteFormValues.direccion),
      apartamento: toNull(clienteFormValues.apartamento),
      ciudad: toNull(clienteFormValues.ciudad),
      estado_region: toNull(clienteFormValues.estado_region),
      codigo_postal: toNull(clienteFormValues.codigo_postal),
    }
    return Object.values(direccionPayload).some((value) => value) ? JSON.stringify(direccionPayload) : null
  }

  const handleCreateCliente = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) { setClienteFormError(t('common.supabaseRequired')); return }
    setClienteSubmitting(true)
    setClienteFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const vendedorId = session?.user.id ?? null
    const payload = {
      nombre: toNull(clienteFormValues.nombre),
      apellido: toNull(clienteFormValues.apellido),
      email: toNull(clienteFormValues.email),
      telefono: toNull(clienteFormValues.telefono),
      direccion: buildDireccionValue(),
      numero_cuenta_financiera: toNull(clienteFormValues.numero_cuenta_financiera),
      saldo_actual: clienteFormValues.saldo_actual === '' ? 0 : Number(clienteFormValues.saldo_actual),
      estado_morosidad: clienteFormValues.estado_morosidad || null,
      vendedor_id: vendedorId,
      distribuidor_id: toNull(clienteFormValues.distribuidor_id),
      fecha_nacimiento: clienteFormValues.fecha_nacimiento || null,
      activo: clienteFormValues.activo,
    }
    const { data, error: insertError } = await supabase.from('clientes').insert(payload).select('id, nombre, apellido').single()
    if (insertError) {
      setClienteFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else if (data) {
      await loadOptions()
      setFormValues((prev) => ({ ...prev, cliente_id: data.id }))
      setClienteFormOpen(false)
      showToast(t('toast.success'))
    }
    setClienteSubmitting(false)
  }

  const handleCreateProducto = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) { setProductoFormError(t('common.supabaseRequired')); return }
    setProductoSubmitting(true)
    setProductoFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const payload = {
      codigo: toNull(productoFormValues.codigo),
      nombre: toNull(productoFormValues.nombre),
      categoria: toNull(productoFormValues.categoria),
      precio: productoFormValues.precio === '' ? 0 : Number(productoFormValues.precio),
      activo: productoFormValues.activo,
    }
    const { data, error: insertError } = await supabase.from('productos').insert(payload).select('id, nombre').single()
    if (insertError) {
      setProductoFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else if (data) {
      await loadOptions()
      setFormValues((prev) => ({ ...prev, producto_id: data.id }))
      setProductoFormOpen(false)
      showToast(t('toast.success'))
    }
    setProductoSubmitting(false)
  }

  if (!configured) {
    return <EmptyState title={t('dashboard.missingConfigTitle')} description={t('dashboard.missingConfigDescription')} />
  }

  const inputStyle = {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
    border: '1px solid var(--color-border, #e5e7eb)', fontSize: '0.875rem',
    background: 'white', boxSizing: 'border-box' as const,
  }
  const labelStyle = {
    display: 'block', fontSize: '0.75rem', fontWeight: 600,
    marginBottom: '0.3rem', color: 'var(--color-text-muted, #6b7280)',
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('ventas.title')}
        subtitle={t('ventas.subtitle')}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="ghost" type="button" onClick={exportarCSV} disabled={ventasFiltradas.length === 0}>
              Exportar CSV
            </Button>
            <Button onClick={handleOpenForm}>{t('common.newVenta')}</Button>
          </div>
        }
      />

      {error && <div className="form-error">{error}</div>}

      {/* ESTADISTICAS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Total ventas', value: stats.total, display: String(stats.total), color: '#3b82f6', onClick: limpiarFiltros },
          { label: 'Monto total', value: stats.montoTotal, display: numberFormat.format(stats.montoTotal), color: '#10b981', onClick: limpiarFiltros },
          { label: 'Ventas iniciales', value: stats.ventaInicial, display: String(stats.ventaInicial), color: '#6366f1', onClick: () => { limpiarFiltros(); setFiltroTipo('venta_inicial') } },
          { label: 'Agregados', value: stats.agregado, display: String(stats.agregado), color: '#f59e0b', onClick: () => { limpiarFiltros(); setFiltroTipo('agregado') } },
        ].map((s) => (
          <div
            key={s.label}
            role="button"
            tabIndex={0}
            onClick={s.onClick}
            onKeyDown={(e) => e.key === 'Enter' && s.onClick()}
            title="Click para filtrar"
            style={{
              padding: '0.875rem 1rem', background: 'var(--color-surface, #f9fafb)',
              borderRadius: '0.5rem', border: '1px solid var(--color-border, #e5e7eb)',
              textAlign: 'center', cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: s.label === 'Monto total' ? '1.1rem' : '1.5rem', fontWeight: 700, color: s.color }}>{s.display}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* FILTROS */}
      <div style={{ background: 'var(--color-surface, #f9fafb)', borderRadius: '0.75rem', border: '1px solid var(--color-border, #e5e7eb)' }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFiltrosVisible((v) => !v)}
          onKeyDown={(e) => e.key === 'Enter' && setFiltrosVisible((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-muted, #6b7280)', letterSpacing: '0.05em' }}>
              FILTROS
            </span>
            {cantFiltrosActivos > 0 && (
              <span style={{ background: '#2563eb', color: 'white', fontSize: '0.7rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '9999px', lineHeight: 1.4 }}>
                {cantFiltrosActivos}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)' }}>
              {ventasFiltradas.length} de {ventas.length} ventas
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)' }}>
              {filtrosVisible ? '▲' : '▼'}
            </span>
          </div>
        </div>

        {filtrosVisible && (
          <div style={{ padding: '0 1rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', borderTop: '1px solid var(--color-border, #e5e7eb)' }}>
            <div style={{ flex: '1', minWidth: '200px' }}>
              <label style={labelStyle}>BUSCAR</label>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nota de pedido, cliente..."
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>TIPO</label>
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--color-border, #e5e7eb)', fontSize: '0.875rem', background: 'white' }}
              >
                <option value="todos">Todos</option>
                <option value="venta_inicial">{t('ventas.tipo.venta_inicial')}</option>
                <option value="agregado">{t('ventas.tipo.agregado')}</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>VENDEDOR</label>
              <select
                value={filtroVendedor}
                onChange={(e) => setFiltroVendedor(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--color-border, #e5e7eb)', fontSize: '0.875rem', background: 'white' }}
              >
                <option value="todos">Todos</option>
                {vendedoresUnicos.map((v) => (
                  <option key={v.id} value={v.id}>{v.nombre}</option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: '140px' }}>
              <label style={labelStyle}>DESDE</label>
              <input
                type="date"
                value={filtroFechaDesde}
                onChange={(e) => setFiltroFechaDesde(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ minWidth: '140px' }}>
              <label style={labelStyle}>HASTA</label>
              <input
                type="date"
                value={filtroFechaHasta}
                onChange={(e) => setFiltroFechaHasta(e.target.value)}
                style={inputStyle}
              />
            </div>
            {cantFiltrosActivos > 0 && (
              <Button variant="ghost" type="button" onClick={limpiarFiltros}>Limpiar</Button>
            )}
          </div>
        )}
      </div>

      {/* TABLA / CARDS */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {ventasOrdenadas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted, #94a3b8)', background: 'var(--card-bg, #1e2d3d)', borderRadius: '0.75rem', border: '1px solid var(--card-border, rgba(255,255,255,0.08))' }}>
              {emptyLabel}
            </div>
          ) : (
            ventasOrdenadas.map((venta) => {
              const clienteLabel = venta.cliente_id ? clienteMap.get(venta.cliente_id) ?? '-' : '-'
              const tipoLabel = venta.tipo_movimiento ? t(`ventas.tipo.${venta.tipo_movimiento}`) : '-'
              const vendedorLabel = venta.vendedor_id ? usersById[venta.vendedor_id] ?? '-' : '-'
              const badgeStyle = tipoBadgeStyle(venta.tipo_movimiento)
              const matchingRow = rows.find((r) => r.id === venta.id)
              return (
                <div
                  key={venta.id}
                  onClick={() => matchingRow && setSelectedRow(matchingRow)}
                  style={{ padding: '0.875rem 1rem', background: 'var(--card-bg, #1e2d3d)', borderRadius: '0.75rem', border: '1px solid var(--card-border, rgba(255,255,255,0.08))', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{clienteLabel}</span>
                      {venta.numero_nota_pedido && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', marginLeft: '0.5rem' }}>#{venta.numero_nota_pedido}</span>
                      )}
                    </div>
                    <span style={{ padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, ...badgeStyle, flexShrink: 0 }}>
                      {tipoLabel}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: '#10b981' }}>
                      {venta.monto != null ? numberFormat.format(venta.monto) : '-'}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)' }}>
                      {venta.fecha_venta ?? '-'}
                    </span>
                  </div>
                  {vendedorLabel !== '-' && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)' }}>
                      {vendedorLabel}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      ) : (
        <DataTable
          columns={[
            t('ventas.columns.nota'),
            t('ventas.columns.cliente'),
            t('ventas.columns.producto'),
            t('ventas.columns.vendedor'),
            t('ventas.columns.monto'),
            t('ventas.columns.tipo'),
            t('ventas.columns.fecha'),
          ]}
          rows={rows}
          emptyLabel={emptyLabel}
          onRowClick={setSelectedRow}
          sortableColumns={[4, 6]}
          sortColIndex={sortCol ?? undefined}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

      {/* DETAIL PANEL */}
      <DetailPanel
        open={Boolean(selectedRow)}
        title={t('ventas.detailsTitle')}
        items={selectedRow?.detail ?? []}
        onClose={() => setSelectedRow(null)}
      />

      {/* MODAL NUEVA VENTA */}
      <Modal
        open={formOpen}
        title={t('ventas.form.title')}
        onClose={() => setFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="venta-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="venta-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{t('ventas.fields.numeroNotaPedido')}</span>
            <input value={formValues.numero_nota_pedido} onChange={handleChange('numero_nota_pedido')} />
          </label>
          <label className="form-field">
            <span>{t('ventas.fields.ownerType')}</span>
            <select value={ventaOwnerType} onChange={handleOwnerTypeChange}>
              <option value="cliente">{t('ventas.ownerTypes.cliente')}</option>
              <option value="prospecto">{t('ventas.ownerTypes.prospecto')}</option>
            </select>
          </label>
          {ventaOwnerType === 'cliente' ? (
            <label className="form-field">
              <span>{t('ventas.fields.clienteId')}</span>
              <select value={formValues.cliente_id} onChange={handleChange('cliente_id')}>
                <option value="">{t('common.select')}</option>
                {loadingOptions && <option value="">{t('common.loading')}</option>}
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {[cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.id}
                  </option>
                ))}
              </select>
              {clientes.length === 0 && (
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => {
                    setClienteFormValues(initialClienteForm)
                    setClienteFormError(null)
                    setClienteFormOpen(true)
                  }}
                >
                  + {t('common.createCliente')}
                </button>
              )}
            </label>
          ) : (
            <>
              <label className="form-field">
                <span>{t('ventas.fields.prospectoId')}</span>
                <select value={prospectoId} onChange={(e) => setProspectoId(e.target.value)}>
                  <option value="">{t('common.select')}</option>
                  {loadingOptions && <option value="">{t('common.loading')}</option>}
                  {leads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {[lead.nombre, lead.apellido].filter(Boolean).join(' ') || lead.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.numeroCuentaFinanciera')}</span>
                <input value={prospectoCuenta} onChange={(e) => setProspectoCuenta(e.target.value)} />
              </label>
            </>
          )}
          <label className="form-field">
            <span>{t('ventas.fields.vendedorId')}</span>
            <input value={vendedorName} readOnly />
          </label>
          <label className="form-field">
            <span>{t('ventas.fields.productoId')}</span>
            <select value={formValues.producto_id} onChange={handleChange('producto_id')}>
              <option value="">{t('common.select')}</option>
              {loadingOptions && <option value="">{t('common.loading')}</option>}
              {productos.map((producto) => (
                <option key={producto.id} value={producto.id}>{producto.nombre ?? producto.id}</option>
              ))}
            </select>
            {productos.length === 0 && (
              <button type="button" className="inline-link" onClick={() => { setProductoFormValues(initialProductoForm); setProductoFormError(null); setProductoFormOpen(true) }}>
                + {t('common.createProducto')}
              </button>
            )}
          </label>
          <label className="form-field">
            <span>{t('ventas.fields.tipoMovimiento')}</span>
            <select value={formValues.tipo_movimiento} onChange={handleChange('tipo_movimiento')}>
              <option value="venta_inicial">{t('ventas.tipo.venta_inicial')}</option>
              <option value="agregado">{t('ventas.tipo.agregado')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t('ventas.fields.monto')}</span>
            <input type="number" value={formValues.monto} onChange={handleChange('monto')} />
          </label>
          <label className="form-field">
            <span>{t('ventas.fields.fechaVenta')}</span>
            <input type="date" value={formValues.fecha_venta} onChange={handleChange('fecha_venta')} />
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>

      {/* MODAL CREAR CLIENTE */}
      <Modal
        open={clienteFormOpen}
        title={t('clientes.form.title')}
        onClose={() => setClienteFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setClienteFormOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="cliente-quick-form" disabled={clienteSubmitting}>
              {clienteSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="cliente-quick-form" className="form-grid" onSubmit={handleCreateCliente}>
          <label className="form-field"><span>{t('clientes.fields.nombre')}</span><input value={clienteFormValues.nombre} onChange={handleClienteChange('nombre')} /></label>
          <label className="form-field"><span>{t('clientes.fields.apellido')}</span><input value={clienteFormValues.apellido} onChange={handleClienteChange('apellido')} /></label>
          <label className="form-field"><span>{t('clientes.fields.email')}</span><input type="email" value={clienteFormValues.email} onChange={handleClienteChange('email')} /></label>
          <label className="form-field"><span>{t('clientes.fields.telefono')}</span><input value={clienteFormValues.telefono} onChange={handleClienteChange('telefono')} /></label>
          <label className="form-field"><span>{t('clientes.fields.direccion')}</span><input value={clienteFormValues.direccion} onChange={handleClienteChange('direccion')} /></label>
          <label className="form-field"><span>{t('clientes.fields.apartamento')}</span><input value={clienteFormValues.apartamento} onChange={handleClienteChange('apartamento')} /></label>
          <label className="form-field"><span>{t('clientes.fields.ciudad')}</span><input value={clienteFormValues.ciudad} onChange={handleClienteChange('ciudad')} /></label>
          <label className="form-field"><span>{t('clientes.fields.estadoRegion')}</span><input value={clienteFormValues.estado_region} onChange={handleClienteChange('estado_region')} /></label>
          <label className="form-field"><span>{t('clientes.fields.codigoPostal')}</span><input value={clienteFormValues.codigo_postal} onChange={handleClienteChange('codigo_postal')} /></label>
          <label className="form-field"><span>{t('clientes.fields.numeroCuentaFinanciera')}</span><input value={clienteFormValues.numero_cuenta_financiera} onChange={handleClienteChange('numero_cuenta_financiera')} /></label>
          <label className="form-field"><span>{t('clientes.fields.saldoActual')}</span><input type="number" value={clienteFormValues.saldo_actual} onChange={handleClienteChange('saldo_actual')} /></label>
          <label className="form-field">
            <span>{t('clientes.fields.estadoMorosidad')}</span>
            <select value={clienteFormValues.estado_morosidad} onChange={handleClienteChange('estado_morosidad')}>
              <option value="">-</option>
              <option value="0-30">{t('clientes.morosidad.0-30')}</option>
              <option value="31-60">{t('clientes.morosidad.31-60')}</option>
              <option value="61-90">{t('clientes.morosidad.61-90')}</option>
              <option value="91+">{t('clientes.morosidad.91+')}</option>
            </select>
          </label>
          <label className="form-field"><span>{t('clientes.fields.distribuidorId')}</span><input value={clienteFormValues.distribuidor_id} onChange={handleClienteChange('distribuidor_id')} /></label>
          <label className="form-field"><span>{t('clientes.fields.fechaNacimiento')}</span><input type="date" value={clienteFormValues.fecha_nacimiento} onChange={handleClienteChange('fecha_nacimiento')} /></label>
          <label className="form-field checkbox-field"><span>{t('clientes.fields.activo')}</span><input type="checkbox" checked={clienteFormValues.activo} onChange={handleClienteChange('activo')} /></label>
          {clienteFormError && <div className="form-error">{clienteFormError}</div>}
        </form>
      </Modal>

      {/* MODAL CREAR PRODUCTO */}
      <Modal
        open={productoFormOpen}
        title={t('productos.form.title')}
        onClose={() => setProductoFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setProductoFormOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="producto-quick-form" disabled={productoSubmitting}>
              {productoSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="producto-quick-form" className="form-grid" onSubmit={handleCreateProducto}>
          <label className="form-field"><span>{t('productos.fields.codigo')}</span><input value={productoFormValues.codigo} onChange={handleProductoChange('codigo')} /></label>
          <label className="form-field"><span>{t('productos.fields.nombre')}</span><input value={productoFormValues.nombre} onChange={handleProductoChange('nombre')} /></label>
          <label className="form-field"><span>{t('productos.fields.categoria')}</span><input value={productoFormValues.categoria} onChange={handleProductoChange('categoria')} /></label>
          <label className="form-field"><span>{t('productos.fields.precio')}</span><input type="number" value={productoFormValues.precio} onChange={handleProductoChange('precio')} /></label>
          <label className="form-field checkbox-field"><span>{t('productos.fields.activo')}</span><input type="checkbox" checked={productoFormValues.activo} onChange={handleProductoChange('activo')} /></label>
          {productoFormError && <div className="form-error">{productoFormError}</div>}
        </form>
      </Modal>
    </div>
  )
}
