import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { DetailPanel } from '../../components/DetailPanel'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/useToast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'
import { useViewMode } from '../../data/useViewMode'
import { toCanonicalContactDraft } from '../../lib/contactRefs'

type VentaRecord = {
  id: string
  numero_nota_pedido: string | null
  cliente_id: string | null
  vendedor_id: string | null
  producto_id: string | null
  tipo_movimiento: string | null
  monto: number | null
  fecha_venta: string | null
  estado: string | null
  subtotal: number | null
  impuesto: number | null
  cargo_envio: number | null
  descuento: number | null
  total: number | null
  pago_inicial: number | null
  saldo_pendiente: number | null
  created_at: string | null
}

type VentaItem = {
  id: string
  venta_id: string
  linea: number
  producto_id: string | null
  codigo_articulo: string | null
  descripcion: string | null
  cantidad: number
  precio_unitario: number
  subtotal: number
}

type VentaTransaccion = {
  id: string
  venta_id: string
  fecha: string
  descripcion: string | null
  cantidad: number
  saldo: number | null
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
  codigo: string | null
  precio: number | null
}

type FormItem = {
  id: string
  producto_id: string
  codigo: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

const initialForm = {
  numero_nota_pedido: '',
  cliente_id: '',
  vendedor_id: '',
  tipo_movimiento: 'venta_inicial',
  fecha_venta: '',
  estado: 'borrador',
  impuesto: '0',
  cargo_envio: '0',
  descuento: '0',
  pago_inicial: '0',
  notas: '',
}

const initialItem: FormItem = {
  id: '',
  producto_id: '',
  codigo: '',
  descripcion: '',
  cantidad: 1,
  precio_unitario: 0,
  subtotal: 0,
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

function estadoBadgeStyle(estado: string | null): { background: string; color: string } {
  switch (estado) {
    case 'borrador': return { background: '#f3f4f6', color: '#6b7280' }
    case 'confirmada': return { background: '#dbeafe', color: '#1d4ed8' }
    case 'procesando': return { background: '#fef3c7', color: '#b45309' }
    case 'entregada': return { background: '#d1fae5', color: '#047857' }
    case 'cancelada': return { background: '#fee2e2', color: '#b91c1c' }
    default: return { background: '#f3f4f6', color: '#6b7280' }
  }
}

export function VentasPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { usersById, currentRole, currentUser } = useUsers()
  const { viewMode, hasDistribuidorScope, distributionUserIds } = useViewMode()
  const { showToast } = useToast()
  const [ventas, setVentas] = useState<VentaRecord[]>([])
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [leads, setLeads] = useState<LeadOption[]>([])
  const [productos, setProductos] = useState<ProductoOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formStep, setFormStep] = useState(1)
  const [formValues, setFormValues] = useState(initialForm)
  const [formItems, setFormItems] = useState<FormItem[]>([{ ...initialItem, id: crypto.randomUUID() }])
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
  const [selectedVenta, setSelectedVenta] = useState<VentaRecord | null>(null)
  const [selectedVentaItems, setSelectedVentaItems] = useState<VentaItem[]>([])
  const [selectedVentaTransacciones, setSelectedVentaTransacciones] = useState<VentaTransaccion[]>([])
  const [detailTab, setDetailTab] = useState<'resumen' | 'articulos' | 'transacciones'>('resumen')
  const configured = isSupabaseConfigured
  const sessionUserId = session?.user.id ?? null
  const sessionOrgId = useMemo(() => {
    const userMetadata = session?.user.user_metadata as Record<string, unknown> | undefined
    const appMetadata = session?.user.app_metadata as Record<string, unknown> | undefined
    const metadataOrg = typeof userMetadata?.org_id === 'string' ? userMetadata.org_id : null
    const appOrg = typeof appMetadata?.org_id === 'string' ? appMetadata.org_id : null
    return metadataOrg ?? appOrg
  }, [session])
  const currentOrgId = currentUser?.org_id ?? sessionOrgId ?? null

  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroVendedor, setFiltroVendedor] = useState('todos')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const [filtrosVisible, setFiltrosVisible] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 720)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [productoSearch, setProductoSearch] = useState<Record<string, string>>({})
  const [productoDropdownOpen, setProductoDropdownOpen] = useState<Record<string, boolean>>({})
  const [clienteSearch, setClienteSearch] = useState('')
  const [clienteDropdownOpen, setClienteDropdownOpen] = useState(false)
  const [leadSearch, setLeadSearch] = useState('')
  const [leadDropdownOpen, setLeadDropdownOpen] = useState(false)

  const loadVentas = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    let query = supabase
      .from('ventas')
      .select('id, numero_nota_pedido, cliente_id, vendedor_id, producto_id, tipo_movimiento, monto, fecha_venta, estado, subtotal, impuesto, cargo_envio, descuento, total, pago_inicial, saldo_pendiente, created_at')
      .order('created_at', { ascending: false })
    if ((currentRole === 'vendedor' || (hasDistribuidorScope && viewMode === 'seller')) && sessionUserId) {
      query = query.eq('vendedor_id', sessionUserId)
    }
    if (hasDistribuidorScope && viewMode === 'distributor') {
      if (distributionUserIds.length === 0) {
        setVentas([])
        setLoading(false)
        return
      }
      query = query.in('vendedor_id', distributionUserIds)
    }
    const { data, error: fetchError } = await query
    if (fetchError) {
      setError(fetchError.message)
      setVentas([])
    } else {
      setVentas(data ?? [])
    }
    setLoading(false)
  }, [configured, currentRole, sessionUserId, distributionUserIds, hasDistribuidorScope, viewMode])

  const loadOptions = useCallback(async () => {
    if (!configured) return
    setLoadingOptions(true)
    let clientesQuery = supabase.from('clientes').select('id, nombre, apellido').order('nombre')
    let leadsQuery = supabase
      .from('leads')
      .select('id, nombre, apellido, telefono, email, referido_por_cliente_id, vendedor_id, owner_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (currentOrgId) {
      clientesQuery = clientesQuery.eq('org_id', currentOrgId)
      leadsQuery = leadsQuery.eq('org_id', currentOrgId)
    }
    if ((currentRole === 'vendedor' || (hasDistribuidorScope && viewMode === 'seller')) && sessionUserId) {
      clientesQuery = clientesQuery.eq('vendedor_id', sessionUserId)
      leadsQuery = leadsQuery.or(`owner_id.eq.${sessionUserId},vendedor_id.eq.${sessionUserId}`)
    }
    if (hasDistribuidorScope && viewMode === 'distributor') {
      if (distributionUserIds.length === 0) {
        setClientes([])
        setLeads([])
        setProductos([])
        setLoadingOptions(false)
        return
      }
      clientesQuery = clientesQuery.in('vendedor_id', distributionUserIds)
      leadsQuery = leadsQuery.in('vendedor_id', distributionUserIds)
    }
    const [clientesResult, productosResult, leadsResult] = await Promise.all([
      clientesQuery,
      supabase.from('v_productos_publicos').select('id, nombre, codigo, precio').order('nombre'),
      leadsQuery,
    ])
    setClientes(clientesResult.data ?? [])
    setProductos(productosResult.data ?? [])
    setLeads((leadsResult.data as LeadOption[]) ?? [])
    setLoadingOptions(false)
  }, [configured, currentOrgId, currentRole, sessionUserId, hasDistribuidorScope, viewMode, distributionUserIds])

  const loadVentaDetails = useCallback(async (ventaId: string) => {
    const [itemsResult, transaccionesResult] = await Promise.all([
      supabase.from('venta_items').select('*').eq('venta_id', ventaId).order('linea'),
      supabase.from('venta_transacciones').select('*').eq('venta_id', ventaId).order('fecha', { ascending: false }),
    ])
    setSelectedVentaItems(itemsResult.data ?? [])
    setSelectedVentaTransacciones(transaccionesResult.data ?? [])
  }, [])

  useEffect(() => {
    if (!configured) return
    const handle = window.setTimeout(() => {
      void loadVentas()
      void loadOptions()
    }, 0)
    return () => window.clearTimeout(handle)
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
    return new Map(productos.map((p) => [p.id, { nombre: p.nombre ?? p.id, codigo: p.codigo ?? '', precio: p.precio ?? 0 }]))
  }, [productos])

  const vendedoresUnicos = useMemo(() => {
    const ids = [...new Set(ventas.map((v) => v.vendedor_id).filter(Boolean))] as string[]
    return ids.map((id) => ({ id, nombre: usersById[id] ?? id }))
  }, [ventas, usersById])

  const ventasFiltradas = useMemo(() => {
    return ventas.filter((v) => {
      const nota = (v.numero_nota_pedido ?? '').toLowerCase()
      const clienteNombre = v.cliente_id ? (clienteMap.get(v.cliente_id) ?? '').toLowerCase() : ''
      const matchBusqueda = !busqueda || nota.includes(busqueda.toLowerCase()) || clienteNombre.includes(busqueda.toLowerCase())
      const matchTipo = filtroTipo === 'todos' || v.tipo_movimiento === filtroTipo
      const matchEstado = filtroEstado === 'todos' || v.estado === filtroEstado
      const matchVendedor = filtroVendedor === 'todos' || v.vendedor_id === filtroVendedor
      const matchDesde = !filtroFechaDesde || (v.fecha_venta ?? '') >= filtroFechaDesde
      const matchHasta = !filtroFechaHasta || (v.fecha_venta ?? '') <= filtroFechaHasta
      return matchBusqueda && matchTipo && matchEstado && matchVendedor && matchDesde && matchHasta
    })
  }, [ventas, busqueda, filtroTipo, filtroEstado, filtroVendedor, filtroFechaDesde, filtroFechaHasta, clienteMap])

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
      if (sortCol === 3) {
        valA = a.total ?? a.monto ?? 0
        valB = b.total ?? b.monto ?? 0
      } else if (sortCol === 6) {
        valA = a.fecha_venta ?? ''
        valB = b.fecha_venta ?? ''
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [ventasFiltradas, sortCol, sortDir])

  const stats = useMemo(() => {
    const montoTotal = ventas.reduce((acc, v) => acc + (v.total ?? v.monto ?? 0), 0)
    return {
      total: ventas.length,
      montoTotal,
      ventaInicial: ventas.filter((v) => v.tipo_movimiento === 'venta_inicial').length,
      agregado: ventas.filter((v) => v.tipo_movimiento === 'agregado').length,
      confirmadas: ventas.filter((v) => v.estado === 'confirmada').length,
    }
  }, [ventas])

  const rows = useMemo<DataTableRow[]>(() => {
    return ventasOrdenadas.map((venta) => {
      const tipoLabel = venta.tipo_movimiento ? t(`ventas.tipo.${venta.tipo_movimiento}`) : '-'
      const estadoLabel = venta.estado ? t(`ventas.estado.${venta.estado}`) : '-'
      const clienteLabel = venta.cliente_id ? clienteMap.get(venta.cliente_id) ?? venta.cliente_id : '-'
      const vendedorLabel = venta.vendedor_id ? usersById[venta.vendedor_id] ?? venta.vendedor_id : '-'
      const monto = venta.total ?? venta.monto ?? 0
      return {
        id: venta.id,
        cells: [
          venta.numero_nota_pedido ?? '-',
          clienteLabel,
          vendedorLabel,
          monto != null ? numberFormat.format(monto) : '-',
          tipoLabel,
          estadoLabel,
          venta.fecha_venta ?? '-',
        ],
        detail: [
          { label: t('ventas.fields.numeroNotaPedido'), value: venta.numero_nota_pedido ?? '-' },
          { label: t('ventas.fields.clienteId'), value: clienteLabel },
          { label: t('ventas.fields.vendedorId'), value: vendedorLabel },
          { label: t('ventas.fields.tipoMovimiento'), value: tipoLabel },
          { label: t('ventas.fields.estado'), value: estadoLabel },
          { label: t('ventas.fields.subtotal'), value: numberFormat.format(venta.subtotal ?? 0) },
          { label: t('ventas.fields.impuesto'), value: numberFormat.format(venta.impuesto ?? 0) },
          { label: t('ventas.fields.cargoEnvio'), value: numberFormat.format(venta.cargo_envio ?? 0) },
          { label: t('ventas.fields.descuento'), value: numberFormat.format(venta.descuento ?? 0) },
          { label: t('ventas.fields.total'), value: numberFormat.format(venta.total ?? monto) },
          { label: t('ventas.fields.pagoInicial'), value: numberFormat.format(venta.pago_inicial ?? 0) },
          { label: t('ventas.fields.saldoPendiente'), value: numberFormat.format(venta.saldo_pendiente ?? monto) },
          { label: t('ventas.fields.fechaVenta'), value: venta.fecha_venta ?? '-' },
        ],
      }
    })
  }, [clienteMap, numberFormat, t, usersById, ventasOrdenadas])

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  const limpiarFiltros = () => {
    setBusqueda('')
    setFiltroTipo('todos')
    setFiltroEstado('todos')
    setFiltroVendedor('todos')
    setFiltroFechaDesde('')
    setFiltroFechaHasta('')
  }

  const cantFiltrosActivos = [
    busqueda,
    filtroTipo !== 'todos' ? '1' : '',
    filtroEstado !== 'todos' ? '1' : '',
    filtroVendedor !== 'todos' ? '1' : '',
    filtroFechaDesde,
    filtroFechaHasta,
  ].filter(Boolean).length

  const exportarCSV = () => {
    const headers = ['Nota Pedido', 'Cliente', 'Vendedor', 'Monto', 'Tipo', 'Estado', 'Fecha']
    const csvRows = ventasFiltradas.map((v) => [
      v.numero_nota_pedido ?? '',
      v.cliente_id ? clienteMap.get(v.cliente_id) ?? '' : '',
      v.vendedor_id ? usersById[v.vendedor_id] ?? v.vendedor_id : '',
      v.total ?? v.monto ?? 0,
      v.tipo_movimiento ? t(`ventas.tipo.${v.tipo_movimiento}`) : '',
      v.estado ? t(`ventas.estado.${v.estado}`) : '',
      v.fecha_venta ?? '',
    ])
    const csv = [headers, ...csvRows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ventas_${new Date().toLocaleDateString('en-CA')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOpenForm = () => {
    setFormValues({ ...initialForm, vendedor_id: session?.user.id ?? '' })
    setFormItems([{ ...initialItem, id: crypto.randomUUID() }])
    setProductoSearch({})
    setProductoDropdownOpen({})
    setClienteSearch('')
    setClienteDropdownOpen(false)
    setLeadSearch('')
    setLeadDropdownOpen(false)
    setVentaOwnerType('cliente')
    setProspectoId('')
    setProspectoCuenta('')
    setFormError(null)
    setFormStep(1)
    setFormOpen(true)
  }

  const handleOwnerTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === 'prospecto' ? 'prospecto' : 'cliente'
    setVentaOwnerType(value)
    if (value === 'cliente') {
      setProspectoId('')
      setProspectoCuenta('')
      setLeadSearch('')
      setLeadDropdownOpen(false)
    } else {
      setFormValues((prev) => ({ ...prev, cliente_id: '' }))
      setClienteSearch('')
      setClienteDropdownOpen(false)
    }
  }

  const selectProducto = (itemId: string, productoId: string) => {
    const prod = productoMap.get(productoId)
    setFormItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item
        return {
          ...item,
          producto_id: productoId,
          codigo: prod?.codigo ?? '',
          descripcion: prod?.nombre ?? '',
          precio_unitario: prod?.precio ?? 0,
          subtotal: item.cantidad * (prod?.precio ?? 0),
        }
      })
    )
    setProductoSearch((prev) => ({ ...prev, [itemId]: prod?.nombre ?? '' }))
    setProductoDropdownOpen((prev) => ({ ...prev, [itemId]: false }))
  }

  const handleItemChange = (id: string, field: keyof FormItem) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value
      setFormItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item
          const updates: Partial<FormItem> = { [field]: value }
          if (field === 'producto_id') {
            const prod = productoMap.get(value)
            if (prod) {
              updates.codigo = prod.codigo
              updates.descripcion = prod.nombre ?? ''
              updates.precio_unitario = prod.precio
              updates.subtotal = item.cantidad * prod.precio
            }
          } else if (field === 'cantidad') {
            const qty = parseFloat(value) || 0
            updates.cantidad = qty
            updates.subtotal = qty * item.precio_unitario
          } else if (field === 'precio_unitario') {
            const price = parseFloat(value) || 0
            updates.precio_unitario = price
            updates.subtotal = item.cantidad * price
          }
          return { ...item, ...updates } as FormItem
        })
      )
    }

  const addItem = () => {
    setFormItems((prev) => [...prev, { ...initialItem, id: crypto.randomUUID() }])
  }

  const removeItem = (id: string) => {
    if (formItems.length > 1) {
      setFormItems((prev) => prev.filter((item) => item.id !== id))
    }
  }

  const calcularTotales = useMemo(() => {
    const subtotal = formItems.reduce((acc, item) => acc + (item.subtotal || 0), 0)
    const impuesto = parseFloat(formValues.impuesto) || 0
    const cargo_envio = parseFloat(formValues.cargo_envio) || 0
    const descuento = parseFloat(formValues.descuento) || 0
    const total = subtotal + impuesto + cargo_envio - descuento
    const pago_inicial = parseFloat(formValues.pago_inicial) || 0
    const saldo_pendiente = total - pago_inicial
    return { subtotal, impuesto, cargo_envio, descuento, total, pago_inicial, saldo_pendiente }
  }, [formItems, formValues.impuesto, formValues.cargo_envio, formValues.descuento, formValues.pago_inicial])

  const validateStep = (step: number): boolean => {
    if (step === 1) {
      if (ventaOwnerType === 'cliente' && !formValues.cliente_id) return false
      if (ventaOwnerType === 'prospecto' && !prospectoId) return false
    }
    if (step === 2) {
      const hasItems = formItems.some((item) => item.producto_id && item.cantidad > 0)
      if (!hasItems) return false
    }
    return true
  }

  const nextStep = () => {
    if (validateStep(formStep)) {
      setFormStep((s) => Math.min(s + 1, 3))
    } else {
      setFormError(t('ventas.errors.completeRequired'))
    }
  }

  const prevStep = () => setFormStep((s) => Math.max(s - 1, 1))

  const handleRowClick = async (row: DataTableRow) => {
    const venta = ventas.find((v) => v.id === row.id)
    if (venta) {
      setSelectedVenta(venta)
      await loadVentaDetails(venta.id)
    }
  }

  const vendedorName = session?.user.id ? (usersById[session.user.id] ?? session.user.id) : '-'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) { setFormError(t('common.supabaseRequired')); return }
    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const rollbackVenta = async (ventaId: string) => {
      await supabase.from('venta_transacciones').delete().eq('venta_id', ventaId)
      await supabase.from('venta_items').delete().eq('venta_id', ventaId)
      await supabase.from('ventas').delete().eq('id', ventaId)
    }
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
        org_id: currentOrgId,
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
      if (leadUpdateError) {
        setFormError(leadUpdateError.message)
        showToast(leadUpdateError.message, 'error')
        setSubmitting(false)
        return
      }
    }

    const payload = {
      numero_nota_pedido: toNull(formValues.numero_nota_pedido),
      cliente_id: clienteIdFinal,
      vendedor_id: vendedorId,
      tipo_movimiento: formValues.tipo_movimiento,
      fecha_venta: formValues.fecha_venta || null,
      estado: formValues.estado,
      subtotal: calcularTotales.subtotal,
      impuesto: calcularTotales.impuesto,
      cargo_envio: calcularTotales.cargo_envio,
      descuento: calcularTotales.descuento,
      total: calcularTotales.total,
      pago_inicial: calcularTotales.pago_inicial,
      saldo_pendiente: calcularTotales.saldo_pendiente,
      notas: toNull(formValues.notas),
    }

    const { data: ventaData, error: insertError } = await supabase.from('ventas').insert(payload).select('id').single()
    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
      setSubmitting(false)
      return
    }

    const itemsPayload = formItems
      .filter((item) => item.producto_id && item.cantidad > 0)
      .map((item, index) => ({
        venta_id: ventaData.id,
        linea: index + 1,
        producto_id: item.producto_id,
        codigo_articulo: item.codigo,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        // subtotal omitido — es columna GENERATED ALWAYS (cantidad * precio_unitario)
      }))

    if (itemsPayload.length > 0) {
      const { error: itemsError } = await supabase.from('venta_items').insert(itemsPayload)
      if (itemsError) {
        await rollbackVenta(ventaData.id)
        setFormError(itemsError.message)
        showToast(itemsError.message, 'error')
        setSubmitting(false)
        return
      }
    }

    let saldoAcum = 0
    const transaccionesPayload: Array<{ venta_id: string; descripcion: string; cantidad: number; saldo: number }> = []

    saldoAcum += calcularTotales.subtotal
    transaccionesPayload.push({ venta_id: ventaData.id, descripcion: 'SALES PRICE', cantidad: calcularTotales.subtotal, saldo: saldoAcum })

    saldoAcum += calcularTotales.impuesto
    transaccionesPayload.push({ venta_id: ventaData.id, descripcion: 'SALES TAX CHARGE', cantidad: calcularTotales.impuesto, saldo: saldoAcum })

    if (calcularTotales.pago_inicial > 0) {
      saldoAcum -= calcularTotales.pago_inicial
      transaccionesPayload.push({ venta_id: ventaData.id, descripcion: 'CONSUMER DOWN PAYMENT', cantidad: -calcularTotales.pago_inicial, saldo: saldoAcum })
    }

    const { error: transaccionesError } = await supabase.from('venta_transacciones').insert(transaccionesPayload)
    if (transaccionesError) {
      await rollbackVenta(ventaData.id)
      setFormError(transaccionesError.message)
      showToast(transaccionesError.message, 'error')
      setSubmitting(false)
      return
    }

    setFormOpen(false)
    setProspectoId('')
    setProspectoCuenta('')
    setVentaOwnerType('cliente')
    await loadOptions()
    await loadVentas()
    showToast(t('toast.success'))
    setSubmitting(false)
  }

  const handleChange = (field: keyof typeof initialForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
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

  const buildClienteDraft = () => {
    const direccion = [clienteFormValues.direccion.trim(), clienteFormValues.apartamento.trim()].filter(Boolean).join(', ')
    return toCanonicalContactDraft({
      nombre: clienteFormValues.nombre,
      apellido: clienteFormValues.apellido,
      email: clienteFormValues.email,
      telefono: clienteFormValues.telefono,
      direccion,
      ciudad: clienteFormValues.ciudad,
      estado_region: clienteFormValues.estado_region,
      codigo_postal: clienteFormValues.codigo_postal,
    })
  }

  const handleCreateCliente = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) { setClienteFormError(t('common.supabaseRequired')); return }
    setClienteSubmitting(true)
    setClienteFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const vendedorId = session?.user.id ?? null
    const clienteDraft = buildClienteDraft()
    const payload = {
      org_id: currentOrgId,
      nombre: toNull(clienteDraft.nombre),
      apellido: clienteDraft.apellido,
      email: clienteDraft.email,
      telefono: clienteDraft.telefono,
      direccion: clienteDraft.direccion,
      ciudad: clienteDraft.ciudad,
      estado_region: clienteDraft.estado_region,
      codigo_postal: clienteDraft.codigo_postal,
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
    const { data, error: insertError } = await supabase.from('productos').insert(payload).select('id, nombre, codigo, precio').single()
    if (insertError) {
      setProductoFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else if (data) {
      await loadOptions()
      setFormItems((prev) => {
        const newItems = [...prev]
        if (newItems.length > 0 && !newItems[0].producto_id) {
          newItems[0].producto_id = data.id
          newItems[0].codigo = data.codigo ?? ''
          newItems[0].descripcion = data.nombre ?? ''
          newItems[0].precio_unitario = data.precio ?? 0
          newItems[0].subtotal = newItems[0].cantidad * (data.precio ?? 0)
        }
        return newItems
      })
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
    background: 'var(--color-input)', color: 'var(--color-text)', boxSizing: 'border-box' as const,
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Total ventas', value: stats.total, display: String(stats.total), color: '#3b82f6', onClick: limpiarFiltros },
          { label: 'Monto total', value: stats.montoTotal, display: numberFormat.format(stats.montoTotal), color: '#10b981', onClick: limpiarFiltros },
          { label: 'Ventas iniciales', value: stats.ventaInicial, display: String(stats.ventaInicial), color: '#6366f1', onClick: () => { limpiarFiltros(); setFiltroTipo('venta_inicial') } },
          { label: 'Agregados', value: stats.agregado, display: String(stats.agregado), color: '#f59e0b', onClick: () => { limpiarFiltros(); setFiltroTipo('agregado') } },
          { label: 'Confirmadas', value: stats.confirmadas, display: String(stats.confirmadas), color: '#8b5cf6', onClick: () => { limpiarFiltros(); setFiltroEstado('confirmada') } },
        ].map((s) => (
          <div
            key={s.label}
            role="button"
            tabIndex={0}
            onClick={s.onClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                s.onClick()
              }
            }}
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

      <div style={{ background: 'var(--color-surface, #f9fafb)', borderRadius: '0.75rem', border: '1px solid var(--color-border, #e5e7eb)' }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFiltrosVisible((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setFiltrosVisible((v) => !v)
            }
          }}
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
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nota de pedido, cliente..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>TIPO</label>
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--color-border, #e5e7eb)', fontSize: '0.875rem', background: 'var(--color-input)', color: 'var(--color-text)' }}>
                <option value="todos">Todos</option>
                <option value="venta_inicial">{t('ventas.tipo.venta_inicial')}</option>
                <option value="agregado">{t('ventas.tipo.agregado')}</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>ESTADO</label>
              <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--color-border, #e5e7eb)', fontSize: '0.875rem', background: 'var(--color-input)', color: 'var(--color-text)' }}>
                <option value="todos">Todos</option>
                <option value="borrador">{t('ventas.estado.borrador')}</option>
                <option value="confirmada">{t('ventas.estado.confirmada')}</option>
                <option value="procesando">{t('ventas.estado.procesando')}</option>
                <option value="entregada">{t('ventas.estado.entregada')}</option>
                <option value="cancelada">{t('ventas.estado.cancelada')}</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>VENDEDOR</label>
              <select value={filtroVendedor} onChange={(e) => setFiltroVendedor(e.target.value)} style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--color-border, #e5e7eb)', fontSize: '0.875rem', background: 'var(--color-input)', color: 'var(--color-text)' }}>
                <option value="todos">Todos</option>
                {vendedoresUnicos.map((v) => (<option key={v.id} value={v.id}>{v.nombre}</option>))}
              </select>
            </div>
            <div style={{ minWidth: '140px' }}>
              <label style={labelStyle}>DESDE</label>
              <input type="date" value={filtroFechaDesde} onChange={(e) => setFiltroFechaDesde(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ minWidth: '140px' }}>
              <label style={labelStyle}>HASTA</label>
              <input type="date" value={filtroFechaHasta} onChange={(e) => setFiltroFechaHasta(e.target.value)} style={inputStyle} />
            </div>
            {cantFiltrosActivos > 0 && (<Button variant="ghost" type="button" onClick={limpiarFiltros}>Limpiar</Button>)}
          </div>
        )}
      </div>

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
              const estadoLabel = venta.estado ? t(`ventas.estado.${venta.estado}`) : '-'
              const vendedorLabel = venta.vendedor_id ? usersById[venta.vendedor_id] ?? '-' : '-'
              const badgeStyle = tipoBadgeStyle(venta.tipo_movimiento)
              const estadoStyle = estadoBadgeStyle(venta.estado)
              const matchingRow = rows.find((r) => r.id === venta.id)
              const monto = venta.total ?? venta.monto ?? 0
              return (
                <div
                  key={venta.id}
                  onClick={() => matchingRow && handleRowClick(matchingRow)}
                  style={{ padding: '0.875rem 1rem', background: 'var(--card-bg, #1e2d3d)', borderRadius: '0.75rem', border: '1px solid var(--card-border, rgba(255,255,255,0.08))', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{clienteLabel}</span>
                      {venta.numero_nota_pedido && (<span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', marginLeft: '0.5rem' }}>#{venta.numero_nota_pedido}</span>)}
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <span style={{ padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, ...badgeStyle }}>{tipoLabel}</span>
                      <span style={{ padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, ...estadoStyle }}>{estadoLabel}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: '#10b981' }}>{numberFormat.format(monto)}</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)' }}>{venta.fecha_venta ?? '-'}</span>
                  </div>
                  {vendedorLabel !== '-' && (<div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)' }}>{vendedorLabel}</div>)}
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
            t('ventas.columns.vendedor'),
            t('ventas.columns.monto'),
            t('ventas.columns.tipo'),
            t('ventas.columns.estado'),
            t('ventas.columns.fecha'),
          ]}
          rows={rows}
          emptyLabel={emptyLabel}
          onRowClick={handleRowClick}
          sortableColumns={[3, 6]}
          sortColIndex={sortCol ?? undefined}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

      <DetailPanel
        open={Boolean(selectedVenta)}
        title={t('ventas.detailsTitle')}
        items={selectedVenta ? [
          { label: t('ventas.fields.numeroNotaPedido'), value: selectedVenta.numero_nota_pedido ?? '-' },
          { label: t('ventas.fields.clienteId'), value: selectedVenta.cliente_id ? clienteMap.get(selectedVenta.cliente_id) ?? '-' : '-' },
          { label: t('ventas.fields.vendedorId'), value: selectedVenta.vendedor_id ? usersById[selectedVenta.vendedor_id] ?? '-' : '-' },
          { label: t('ventas.fields.tipoMovimiento'), value: selectedVenta.tipo_movimiento ? t(`ventas.tipo.${selectedVenta.tipo_movimiento}`) : '-' },
          { label: t('ventas.fields.estado'), value: selectedVenta.estado ? t(`ventas.estado.${selectedVenta.estado}`) : '-' },
          { label: t('ventas.fields.total'), value: numberFormat.format(selectedVenta.total ?? selectedVenta.monto ?? 0) },
          { label: t('ventas.fields.fechaVenta'), value: selectedVenta.fecha_venta ?? '-' },
        ] : []}
        onClose={() => setSelectedVenta(null)}
      />

      <Modal
        open={formOpen}
        title={`${t('ventas.form.title')} - Paso ${formStep} de 3`}
        onClose={() => setFormOpen(false)}
        size="lg"
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
            {formStep > 1 && <Button variant="secondary" type="button" onClick={prevStep}>Atrás</Button>}
            {formStep < 3 && <Button type="button" onClick={nextStep}>Siguiente</Button>}
            {formStep === 3 && (<Button type="submit" form="venta-form" disabled={submitting}>{submitting ? t('common.saving') : t('common.save')}</Button>)}
          </>
        }
      >
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
          {[1, 2, 3].map((step) => (
            <div
              key={step}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '0.5rem',
                borderRadius: '0.375rem',
                background: formStep === step ? '#3b82f6' : formStep > step ? '#10b981' : 'transparent',
                color: formStep >= step ? 'white' : 'var(--color-text-muted)',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
            >
              {step === 1 ? 'Cliente' : step === 2 ? 'Artículos' : 'Financiero'}
            </div>
          ))}
        </div>

        <form id="venta-form" onSubmit={handleSubmit}>
          {formStep === 1 && (
            <div className="form-grid">
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
                  <div style={{ position: 'relative' }}>
                    <input
                      value={clienteSearch}
                      onChange={(e) => {
                        const val = e.target.value
                        setClienteSearch(val)
                        setClienteDropdownOpen(true)
                        if (!val) setFormValues((prev) => ({ ...prev, cliente_id: '' }))
                      }}
                      onFocus={() => setClienteDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setClienteDropdownOpen(false), 150)}
                      placeholder={loadingOptions ? t('common.loading') : 'Buscar cliente...'}
                      style={{ width: '100%', padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid var(--color-border)', boxSizing: 'border-box' }}
                    />
                    {clienteDropdownOpen && (() => {
                      const q = clienteSearch.toLowerCase().trim()
                      const filtered = q.length > 0
                        ? clientes.filter((c) => [c.nombre, c.apellido].filter(Boolean).join(' ').toLowerCase().includes(q))
                        : clientes.slice(0, 50)
                      return filtered.length > 0 ? (
                        <ul style={{ position: 'absolute', zIndex: 200, top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)', borderRadius: '0.25rem', margin: 0, padding: 0, listStyle: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.15)' }}>
                          {filtered.map((c) => {
                            const label = [c.nombre, c.apellido].filter(Boolean).join(' ') || c.id
                            return (
                              <li
                                key={c.id}
                                onMouseDown={() => {
                                  setFormValues((prev) => ({ ...prev, cliente_id: c.id }))
                                  setClienteSearch(label)
                                  setClienteDropdownOpen(false)
                                }}
                                style={{ padding: '0.375rem 0.625rem', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--color-border, #e5e7eb)' }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary-light, #eff6ff)' }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                              >
                                {label}
                              </li>
                            )
                          })}
                        </ul>
                      ) : null
                    })()}
                  </div>
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
                </label>
              ) : (
                <>
                  <label className="form-field">
                    <span>{t('ventas.fields.prospectoId')}</span>
                    <div style={{ position: 'relative' }}>
                      <input
                        value={leadSearch}
                        onChange={(e) => {
                          const val = e.target.value
                          setLeadSearch(val)
                          setLeadDropdownOpen(true)
                          if (!val) setProspectoId('')
                        }}
                        onFocus={() => setLeadDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setLeadDropdownOpen(false), 150)}
                        placeholder={loadingOptions ? t('common.loading') : 'Buscar prospecto...'}
                        style={{ width: '100%', padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid var(--color-border)', boxSizing: 'border-box' }}
                      />
                      {leadDropdownOpen && (() => {
                        const q = leadSearch.toLowerCase().trim()
                        const filtered = q.length > 0
                          ? leads.filter((l) => [l.nombre, l.apellido].filter(Boolean).join(' ').toLowerCase().includes(q))
                          : leads.slice(0, 50)
                        return filtered.length > 0 ? (
                          <ul style={{ position: 'absolute', zIndex: 200, top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)', borderRadius: '0.25rem', margin: 0, padding: 0, listStyle: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.15)' }}>
                            {filtered.map((l) => {
                              const label = [l.nombre, l.apellido].filter(Boolean).join(' ') || l.id
                              return (
                                <li
                                  key={l.id}
                                  onMouseDown={() => {
                                    setProspectoId(l.id)
                                    setLeadSearch(label)
                                    setLeadDropdownOpen(false)
                                  }}
                                  style={{ padding: '0.375rem 0.625rem', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--color-border, #e5e7eb)' }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary-light, #eff6ff)' }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                                >
                                  {label}
                                </li>
                              )
                            })}
                          </ul>
                        ) : null
                      })()}
                    </div>
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
                <span>{t('ventas.fields.fechaVenta')}</span>
                <input type="date" value={formValues.fecha_venta} onChange={handleChange('fecha_venta')} />
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.tipoMovimiento')}</span>
                <select value={formValues.tipo_movimiento} onChange={handleChange('tipo_movimiento')}>
                  <option value="venta_inicial">{t('ventas.tipo.venta_inicial')}</option>
                  <option value="agregado">{t('ventas.tipo.agregado')}</option>
                </select>
              </label>
            </div>
          )}

          {formStep === 2 && (
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem', width: '40%' }}>Producto</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', width: '15%' }}>Código</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem', width: '10%' }}>Cant</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem', width: '15%' }}>Precio</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem', width: '15%' }}>Subtotal</th>
                    <th style={{ width: '5%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {formItems.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
                      <td style={{ padding: '0.5rem' }}>
                        <div style={{ position: 'relative', width: '100%' }}>
                          <input
                            value={productoSearch[item.id] ?? (item.producto_id ? (productos.find((p) => p.id === item.producto_id)?.nombre ?? '') : '')}
                            onChange={(e) => {
                              const val = e.target.value
                              setProductoSearch((prev) => ({ ...prev, [item.id]: val }))
                              setProductoDropdownOpen((prev) => ({ ...prev, [item.id]: true }))
                              if (!val) {
                                setFormItems((prev) => prev.map((fi) =>
                                  fi.id === item.id ? { ...fi, producto_id: '', codigo: '', descripcion: '', precio_unitario: 0, subtotal: 0 } : fi
                                ))
                              }
                            }}
                            onFocus={() => setProductoDropdownOpen((prev) => ({ ...prev, [item.id]: true }))}
                            onBlur={() => setTimeout(() => setProductoDropdownOpen((prev) => ({ ...prev, [item.id]: false })), 150)}
                            placeholder="Buscar producto..."
                            style={{ width: '100%', padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid var(--color-border)', boxSizing: 'border-box' }}
                          />
                          {productoDropdownOpen[item.id] && (() => {
                            const q = (productoSearch[item.id] ?? '').toLowerCase().trim()
                            const filtered = q.length > 0
                              ? productos.filter((p) => (p.nombre ?? '').toLowerCase().includes(q) || (p.codigo ?? '').toLowerCase().includes(q))
                              : productos.slice(0, 50)
                            return filtered.length > 0 ? (
                              <ul style={{ position: 'absolute', zIndex: 200, top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)', borderRadius: '0.25rem', margin: 0, padding: 0, listStyle: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.15)' }}>
                                {filtered.map((p) => (
                                  <li
                                    key={p.id}
                                    onMouseDown={() => selectProducto(item.id, p.id)}
                                    style={{ padding: '0.375rem 0.625rem', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--color-border, #e5e7eb)' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary-light, #eff6ff)' }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                                  >
                                    <span style={{ fontWeight: 600, marginRight: '0.25rem' }}>{p.codigo}</span>
                                    <span>{p.nombre}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null
                          })()}
                        </div>
                        <button
                          type="button"
                          className="inline-link"
                          style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}
                          onClick={() => { setProductoFormValues(initialProductoForm); setProductoFormError(null); setProductoFormOpen(true) }}
                        >
                          + {t('common.createProducto')}
                        </button>
                      </td>
                      <td style={{ padding: '0.5rem' }}>
                        <input value={item.codigo} onChange={handleItemChange(item.id, 'codigo')} style={{ width: '100%', padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid var(--color-border)' }} />
                      </td>
                      <td style={{ padding: '0.5rem' }}>
                        <input type="number" min="1" value={item.cantidad} onChange={handleItemChange(item.id, 'cantidad')} style={{ width: '100%', padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid var(--color-border)', textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '0.5rem' }}>
                        <input type="number" min="0" step="0.01" value={item.precio_unitario} onChange={handleItemChange(item.id, 'precio_unitario')} style={{ width: '100%', padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid var(--color-border)', textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>
                        {numberFormat.format(item.subtotal)}
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <button type="button" onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.25rem' }} disabled={formItems.length === 1}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button type="button" variant="ghost" onClick={addItem} style={{ marginTop: '0.75rem' }}>+ Agregar línea</Button>
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--color-surface)', borderRadius: '0.375rem', textAlign: 'right' }}>
                <span style={{ fontWeight: 600 }}>Subtotal: {numberFormat.format(calcularTotales.subtotal)}</span>
              </div>
            </div>
          )}

          {formStep === 3 && (
            <div className="form-grid">
              <label className="form-field">
                <span>{t('ventas.fields.subtotal')}</span>
                <input value={numberFormat.format(calcularTotales.subtotal)} readOnly style={{ background: 'var(--color-surface)' }} />
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.impuesto')}</span>
                <input type="number" min="0" step="0.01" value={formValues.impuesto} onChange={handleChange('impuesto')} />
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.cargoEnvio')}</span>
                <input type="number" min="0" step="0.01" value={formValues.cargo_envio} onChange={handleChange('cargo_envio')} />
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.descuento')}</span>
                <input type="number" min="0" step="0.01" value={formValues.descuento} onChange={handleChange('descuento')} />
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.total')}</span>
                <input value={numberFormat.format(calcularTotales.total)} readOnly style={{ background: 'var(--color-surface)', fontWeight: 700, color: '#10b981' }} />
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.pagoInicial')}</span>
                <input type="number" min="0" step="0.01" value={formValues.pago_inicial} onChange={handleChange('pago_inicial')} />
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.saldoPendiente')}</span>
                <input value={numberFormat.format(calcularTotales.saldo_pendiente)} readOnly style={{ background: 'var(--color-surface)', fontWeight: 700, color: calcularTotales.saldo_pendiente > 0 ? '#f59e0b' : '#10b981' }} />
              </label>
              <label className="form-field">
                <span>{t('ventas.fields.estado')}</span>
                <select value={formValues.estado} onChange={handleChange('estado')}>
                  <option value="borrador">{t('ventas.estado.borrador')}</option>
                  <option value="confirmada">{t('ventas.estado.confirmada')}</option>
                  <option value="procesando">{t('ventas.estado.procesando')}</option>
                  <option value="entregada">{t('ventas.estado.entregada')}</option>
                  <option value="cancelada">{t('ventas.estado.cancelada')}</option>
                </select>
              </label>
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>Notas</span>
                <textarea value={formValues.notas} onChange={handleChange('notas')} rows={3} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--color-border)', fontSize: '0.875rem', background: 'var(--color-input)', color: 'var(--color-text)' }} />
              </label>
              {formError && <div className="form-error" style={{ gridColumn: '1 / -1' }}>{formError}</div>}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(selectedVenta)}
        title={selectedVenta ? `Venta ${selectedVenta.numero_nota_pedido || selectedVenta.id.slice(0, 8)}` : ''}
        onClose={() => setSelectedVenta(null)}
        size="lg"
      >
        {selectedVenta && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
              {(['resumen', 'articulos', 'transacciones'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: '0.375rem',
                    border: 'none',
                    background: detailTab === tab ? '#3b82f6' : 'transparent',
                    color: detailTab === tab ? 'white' : 'var(--color-text)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {tab === 'resumen' ? 'Resumen' : tab === 'articulos' ? 'Artículos' : 'Transacciones'}
                </button>
              ))}
            </div>

            {detailTab === 'resumen' && (
              <div className="form-grid">
                <div className="form-field"><span>Cliente</span><strong>{selectedVenta.cliente_id ? clienteMap.get(selectedVenta.cliente_id) ?? '-' : '-'}</strong></div>
                <div className="form-field"><span>Vendedor</span><strong>{selectedVenta.vendedor_id ? usersById[selectedVenta.vendedor_id] ?? '-' : '-'}</strong></div>
                <div className="form-field"><span>Tipo</span><strong>{selectedVenta.tipo_movimiento ? t(`ventas.tipo.${selectedVenta.tipo_movimiento}`) : '-'}</strong></div>
                <div className="form-field"><span>Estado</span><span style={{ padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, ...estadoBadgeStyle(selectedVenta.estado) }}>{selectedVenta.estado ? t(`ventas.estado.${selectedVenta.estado}`) : '-'}</span></div>
                <div className="form-field"><span>Fecha</span><strong>{selectedVenta.fecha_venta ?? '-'}</strong></div>
                <div className="form-field"><span>Subtotal</span><strong>{numberFormat.format(selectedVenta.subtotal ?? 0)}</strong></div>
                <div className="form-field"><span>Impuesto</span><strong>{numberFormat.format(selectedVenta.impuesto ?? 0)}</strong></div>
                <div className="form-field"><span>Envío</span><strong>{numberFormat.format(selectedVenta.cargo_envio ?? 0)}</strong></div>
                <div className="form-field"><span>Descuento</span><strong>{numberFormat.format(selectedVenta.descuento ?? 0)}</strong></div>
                <div className="form-field"><span>Total</span><strong style={{ color: '#10b981', fontSize: '1.1rem' }}>{numberFormat.format(selectedVenta.total ?? selectedVenta.monto ?? 0)}</strong></div>
                <div className="form-field"><span>Pago Inicial</span><strong>{numberFormat.format(selectedVenta.pago_inicial ?? 0)}</strong></div>
                <div className="form-field"><span>Saldo Pendiente</span><strong style={{ color: (selectedVenta.saldo_pendiente ?? 0) > 0 ? '#f59e0b' : '#10b981' }}>{numberFormat.format(selectedVenta.saldo_pendiente ?? 0)}</strong></div>
              </div>
            )}

            {detailTab === 'articulos' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem' }}>#</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem' }}>Código</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem' }}>Descripción</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Cant</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Precio</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedVentaItems.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No hay artículos</td></tr>
                  ) : (
                    selectedVentaItems.map((item) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
                        <td style={{ padding: '0.5rem' }}>{item.linea}</td>
                        <td style={{ padding: '0.5rem' }}>{item.codigo_articulo ?? '-'}</td>
                        <td style={{ padding: '0.5rem' }}>{item.descripcion ?? '-'}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{item.cantidad}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{numberFormat.format(item.precio_unitario)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>{numberFormat.format(item.subtotal)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {detailTab === 'transacciones' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem' }}>Fecha</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem' }}>Descripción</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Cantidad</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedVentaTransacciones.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No hay transacciones</td></tr>
                  ) : (
                    selectedVentaTransacciones.map((tx) => (
                      <tr key={tx.id} style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
                        <td style={{ padding: '0.5rem' }}>{tx.fecha ? new Date(tx.fecha).toLocaleDateString('es-MX') : '-'}</td>
                        <td style={{ padding: '0.5rem' }}>{tx.descripcion ?? '-'}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', color: tx.cantidad < 0 ? '#10b981' : '#374151', fontWeight: 500 }}>
                          {tx.cantidad < 0 ? `(${numberFormat.format(Math.abs(tx.cantidad))})` : numberFormat.format(tx.cantidad)}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>{tx.saldo != null ? numberFormat.format(tx.saldo) : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </>
        )}
      </Modal>

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
