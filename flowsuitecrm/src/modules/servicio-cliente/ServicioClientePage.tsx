import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { normalizeTimeValue } from '../../lib/timeUtils'
import { useAuth } from '../../auth/AuthProvider'
import { useUsers } from '../../data/UsersProvider'
import { useModalHost } from '../../modals/ModalProvider'

type ClienteOption = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  telefono_casa?: string | null
  hycite_id: string | null
  numero_cuenta_financiera: string | null
  org_id?: string | null
  vendedor_id?: string | null
  distribuidor_id?: string | null
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
  hora_cita?: string | null
  tipo_servicio: string | null
  observaciones: string | null
  venta_id: string | null
  vendedor_id?: string | null
}

type VentaOption = {
  id: string
  cliente_id: string | null
  numero_nota_pedido: string | null
}

type UsuarioOption = {
  id: string
  nombre: string | null
  apellido: string | null
  rol: string | null
  activo?: boolean | null
  codigo_vendedor?: string | null
  codigo_distribuidor?: string | null
}

const initialServiceForm = {
  cliente_id: '',
  equipo_instalado_id: '',
  vendedor_id: '',
  fecha_servicio: '',
  hora_cita: '',
  tipo_servicio: 'cambio_repuesto',
  observaciones: '',
  venta_id: '',
}

export function ServicioClientePage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { currentUser, usersById } = useUsers()
  const { showToast } = useToast()
  const { openCitaModal } = useModalHost()
  const configured = isSupabaseConfigured
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [productos, setProductos] = useState<ProductoOption[]>([])
  const [equipos, setEquipos] = useState<EquipoInstalado[]>([])
  const [componentes, setComponentes] = useState<ComponenteEquipo[]>([])
  const [servicios, setServicios] = useState<ServicioRecord[]>([])
  const [ventas, setVentas] = useState<VentaOption[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialServiceForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formMode, setFormMode] = useState<'servicio' | 'cita'>('servicio')
  const [formAction, setFormAction] = useState<'create' | 'edit'>('create')
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteServicioId, setDeleteServicioId] = useState<string | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [formClienteSearch, setFormClienteSearch] = useState('')
  const [clienteSearch, setClienteSearch] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteValues, setNoteValues] = useState({ cliente_id: '', nota: '' })
  const [noteError, setNoteError] = useState<string | null>(null)
  const [noteSubmitting, setNoteSubmitting] = useState(false)
  const [noteClienteSearch, setNoteClienteSearch] = useState('')
  const maxModalResultados = 50
  const [formClientesRemote, setFormClientesRemote] = useState<ClienteOption[]>([])
  const [noteClientesRemote, setNoteClientesRemote] = useState<ClienteOption[]>([])
  const [assignedVendedorIds, setAssignedVendedorIds] = useState<string[]>([])

  const loadData = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const [clientesResult, productosResult, equiposResult, componentesResult, serviciosResult, ventasResult, usuariosResult] =
      await Promise.all([
        supabase
          .from('clientes')
          .select(
            'id, nombre, apellido, telefono, telefono_casa, hycite_id, numero_cuenta_financiera, org_id, vendedor_id, distribuidor_id'
          ),
        supabase.from('v_productos_publicos').select('id, nombre'),
        supabase
          .from('equipos_instalados')
          .select('id, cliente_id, producto_id, numero_serie, fecha_instalacion, activo'),
        supabase
          .from('componentes_equipo')
          .select('id, equipo_instalado_id, nombre_componente, ciclo_meses, fecha_proximo_cambio, activo'),
        supabase
          .from('servicios')
          .select('id, cliente_id, equipo_instalado_id, fecha_servicio, hora_cita, tipo_servicio, observaciones, venta_id, vendedor_id'),
        supabase.from('ventas').select('id, cliente_id, numero_nota_pedido'),
        supabase.from('usuarios').select('id, nombre, apellido, rol, activo, codigo_vendedor, codigo_distribuidor'),
      ])

    if (
      clientesResult.error ||
      productosResult.error ||
      equiposResult.error ||
      componentesResult.error ||
      serviciosResult.error ||
      ventasResult.error ||
      usuariosResult.error
    ) {
      setError(
        clientesResult.error?.message ||
        productosResult.error?.message ||
        equiposResult.error?.message ||
        componentesResult.error?.message ||
        serviciosResult.error?.message ||
        ventasResult.error?.message ||
        usuariosResult.error?.message ||
        t('common.noData')
      )
    }

    setClientes((clientesResult.data as ClienteOption[]) ?? [])
    setProductos((productosResult.data as ProductoOption[]) ?? [])
    setEquipos((equiposResult.data as EquipoInstalado[]) ?? [])
    setComponentes((componentesResult.data as ComponenteEquipo[]) ?? [])
    setServicios((serviciosResult.data as ServicioRecord[]) ?? [])
    setVentas((ventasResult.data as VentaOption[]) ?? [])
    setUsuarios((usuariosResult.data as UsuarioOption[]) ?? [])
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

  const clienteById = useMemo(() => {
    return new Map(clientes.map((cliente) => [cliente.id, cliente]))
  }, [clientes])

  const clientesFiltrados = useMemo(() => {
    const search = clienteSearch.trim().toLowerCase()
    if (!search) return clientes
    return clientes.filter((cliente) => {
      const fullName = `${cliente.nombre ?? ''} ${cliente.apellido ?? ''}`.trim().toLowerCase()
      const phone = (cliente.telefono ?? '').toLowerCase()
      const hycite = (cliente.hycite_id ?? '').toLowerCase()
      const cuenta = (cliente.numero_cuenta_financiera ?? '').toLowerCase()
      return (
        fullName.includes(search) ||
        phone.includes(search) ||
        hycite.includes(search) ||
        cuenta.includes(search)
      )
    })
  }, [clienteSearch, clientes])

  const clientesFiltradosIds = useMemo(() => {
    return new Set(clientesFiltrados.map((cliente) => cliente.id))
  }, [clientesFiltrados])

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

  const equiposFiltrados = useMemo(() => {
    if (!clienteSearch.trim()) return equipos
    return equipos.filter((equipo) => (equipo.cliente_id ? clientesFiltradosIds.has(equipo.cliente_id) : false))
  }, [clienteSearch, clientesFiltradosIds, equipos])

  const equiposRows = useMemo<DataTableRow[]>(() => {
    return equiposFiltrados.map((equipo) => {
      const clienteLabel = equipo.cliente_id ? clienteMap.get(equipo.cliente_id) ?? equipo.cliente_id : '-'
      const productoLabel = equipo.producto_id ? productoMap.get(equipo.producto_id) ?? equipo.producto_id : '-'
      const estadoLabel = equipo.activo ? t('clientes.estado.activo') : t('clientes.estado.inactivo')
      return {
        id: equipo.id,
        cells: [clienteLabel, productoLabel, equipo.fecha_instalacion ?? '-', equipo.numero_serie ?? '-', estadoLabel],
      }
    })
  }, [clienteMap, equiposFiltrados, productoMap, t])

  const componentesFiltrados = useMemo(() => {
    if (!clienteSearch.trim()) return componentes
    const equiposIds = new Set(equiposFiltrados.map((equipo) => equipo.id))
    return componentes.filter((componente) => (componente.equipo_instalado_id ? equiposIds.has(componente.equipo_instalado_id) : false))
  }, [clienteSearch, componentes, equiposFiltrados])

  const componentesRows = useMemo<DataTableRow[]>(() => {
    return componentesFiltrados.map((componente) => {
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
  }, [componentesFiltrados, equipoMap, t])

  const serviciosFiltrados = useMemo(() => {
    if (!clienteSearch.trim()) return servicios
    return servicios.filter((servicio) => (servicio.cliente_id ? clientesFiltradosIds.has(servicio.cliente_id) : false))
  }, [clienteSearch, clientesFiltradosIds, servicios])

  const canEditServicios = useMemo(() => {
    const role = currentUser?.rol ?? null
    return (
      role === 'telemercadeo' ||
      role === 'supervisor_telemercadeo' ||
      role === 'admin' ||
      role === 'distribuidor' ||
      role === 'vendedor'
    )
  }, [currentUser?.rol])

  const canDeleteServicios = useMemo(() => {
    const role = currentUser?.rol ?? null
    return role === 'admin' || role === 'distribuidor'
  }, [currentUser?.rol])

  // NOTE: defined before serviciosRows to avoid temporal dead zone in useMemo callback
  const handleOpenEditForm = useCallback((servicio: ServicioRecord) => {
    const cliente = servicio.cliente_id ? clienteById.get(servicio.cliente_id) ?? null : null
    const clienteLabel = cliente ? [cliente.nombre, cliente.apellido].filter(Boolean).join(' ').trim() : ''
    setFormValues({
      cliente_id: servicio.cliente_id ?? '',
      equipo_instalado_id: servicio.equipo_instalado_id ?? '',
      vendedor_id: servicio.vendedor_id ?? '',
      fecha_servicio: servicio.fecha_servicio ?? '',
      hora_cita: normalizeTimeValue(servicio.hora_cita),
      tipo_servicio: servicio.tipo_servicio ?? 'cambio_repuesto',
      observaciones: servicio.observaciones ?? '',
      venta_id: servicio.venta_id ?? '',
    })
    setFormClientesRemote(cliente ? [cliente] : [])
    setFormError(null)
    setFormAction('edit')
    setEditingServiceId(servicio.id)
    setFormMode(servicio.hora_cita ? 'cita' : 'servicio')
    setFormClienteSearch(clienteLabel || servicio.cliente_id || '')
    setFormOpen(true)
  }, [clienteById, normalizeTimeValue])

  const handleOpenDeleteConfirm = useCallback((servicioId: string) => {
    setDeleteServicioId(servicioId)
    setDeleteConfirmOpen(true)
  }, [])

  const handleConfirmDelete = async () => {
    if (!deleteServicioId) return
    setDeleteSubmitting(true)
    const { error: deleteError } = await supabase.from('servicios').delete().eq('id', deleteServicioId)
    if (deleteError) {
      showToast(deleteError.message, 'error')
    } else {
      setDeleteConfirmOpen(false)
      setDeleteServicioId(null)
      await loadData()
      showToast(t('toast.success'))
    }
    setDeleteSubmitting(false)
  }

  const serviciosRows = useMemo<DataTableRow[]>(() => {
    return serviciosFiltrados.map((servicio) => {
      const clienteLabel = servicio.cliente_id ? clienteMap.get(servicio.cliente_id) ?? servicio.cliente_id : '-'
      const ventaLabel = servicio.venta_id ? ventasMap.get(servicio.venta_id) ?? servicio.venta_id : '-'
      const tipoLabel = servicio.tipo_servicio ? t(`servicio.types.${servicio.tipo_servicio}`) : '-'
      const actionsCell = (
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {canEditServicios && (
            <Button
              variant="ghost"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                handleOpenEditForm(servicio)
              }}
            >
              ✏️
            </Button>
          )}
          {canDeleteServicios && (
            <Button
              variant="ghost"
              type="button"
              style={{ color: '#ef4444' }}
              onClick={(event) => {
                event.stopPropagation()
                handleOpenDeleteConfirm(servicio.id)
              }}
            >
              🗑️
            </Button>
          )}
        </div>
      )
      return {
        id: servicio.id,
        cells: [
          clienteLabel,
          servicio.fecha_servicio ?? '-',
          normalizeTimeValue(servicio.hora_cita) || '-',
          tipoLabel,
          servicio.observaciones ?? '-',
          ventaLabel,
          actionsCell,
        ],
      }
    })
  }, [canDeleteServicios, canEditServicios, clienteMap, handleOpenDeleteConfirm, handleOpenEditForm, serviciosFiltrados, t, ventasMap])

  const equiposOptions = useMemo(() => {
    return equipos.filter((equipo) => equipo.cliente_id === formValues.cliente_id)
  }, [equipos, formValues.cliente_id])

  const ventasOptions = useMemo(() => {
    return ventas.filter((venta) => venta.cliente_id === formValues.cliente_id)
  }, [formValues.cliente_id, ventas])

  const usuariosAsignables = useMemo(() => {
    const base = usuarios
      .filter((user) => user.rol === 'vendedor' || user.rol === 'distribuidor')
      .filter((user) => user.activo !== false)
      .map((user) => ({
        id: user.id,
        label: [
          [user.nombre, user.apellido].filter(Boolean).join(' ').trim() || user.id,
          user.codigo_vendedor || user.codigo_distribuidor || null,
        ]
          .filter(Boolean)
          .join(' - '),
        rol: user.rol,
      }))

    const byId = new Map(base.map((item) => [item.id, item]))

    if (currentUser?.id) {
      if (!byId.has(currentUser.id)) {
        const label = [currentUser.nombre, currentUser.apellido].filter(Boolean).join(' ').trim() || currentUser.id
        byId.set(currentUser.id, { id: currentUser.id, label, rol: currentUser.rol })
      }
    }

    if (byId.size > 0) return Array.from(byId.values())

    if (assignedVendedorIds.length > 0) {
      return assignedVendedorIds.map((id) => ({ id, label: usersById[id] || id, rol: null }))
    }

    const ids = new Set<string>()
    clientes.forEach((cliente) => {
      if (cliente.vendedor_id) ids.add(cliente.vendedor_id)
      if (cliente.distribuidor_id) ids.add(cliente.distribuidor_id)
    })
    return [...ids].map((id) => ({ id, label: usersById[id] || id, rol: null }))
  }, [assignedVendedorIds, clientes, currentUser, usuarios, usersById])

  const defaultVendedorId = currentUser?.rol === 'vendedor' ? (currentUser.id ?? '') : ''

  const closeForm = useCallback(() => {
    setFormOpen(false)
    setFormAction('create')
    setEditingServiceId(null)
    setFormError(null)
  }, [])

  const handleOpenForm = () => {
    setFormValues({
      ...initialServiceForm,
      vendedor_id: defaultVendedorId,
    })
    setFormError(null)
    setFormAction('create')
    setEditingServiceId(null)
    setFormMode('servicio')
    setFormClienteSearch('')
    setFormOpen(true)
  }

  const handleOpenCitaForm = () => {
    openCitaModal({
      initialData: { tipo: 'servicio', assigned_to: defaultVendedorId || session?.user.id || '' },
      assignedOptions: usuariosAsignables.map((u) => ({ id: u.id, label: u.label })),
      onSaved: () => {
        void loadData()
      },
    })
  }

  const handleOpenNoteForm = () => {
    setNoteValues({ cliente_id: '', nota: '' })
    setNoteError(null)
    setNoteClienteSearch('')
    setNoteOpen(true)
  }

  const handleChange = (field: keyof typeof initialServiceForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value
      if (field === 'cliente_id') {
        const cliente = clienteById.get(value)
        setFormValues((prev) => ({
          ...prev,
          cliente_id: value,
          equipo_instalado_id: '',
          venta_id: '',
          vendedor_id: cliente?.vendedor_id ?? cliente?.distribuidor_id ?? prev.vendedor_id,
        }))
        return
      }
      if (field === 'hora_cita') {
        setFormValues((prev) => ({ ...prev, [field]: normalizeTimeValue(value) }))
        return
      }
      setFormValues((prev) => ({ ...prev, [field]: value }))
    }

  const handleNoteChange = (field: keyof typeof noteValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value
      setNoteValues((prev) => ({ ...prev, [field]: value }))
    }

  const fetchClientesForModal = useCallback(
    async (searchValue: string) => {
      if (!configured) return []
      const search = searchValue.trim()
      if (!search) return []
      const pattern = `%${search}%`
      const { data, error } = await supabase
        .from('clientes')
        .select(
          'id, nombre, apellido, telefono, telefono_casa, hycite_id, numero_cuenta_financiera, vendedor_id, distribuidor_id'
        )
        .or(
          `nombre.ilike.${pattern},apellido.ilike.${pattern},telefono.ilike.${pattern},telefono_casa.ilike.${pattern},hycite_id.ilike.${pattern},numero_cuenta_financiera.ilike.${pattern}`
        )
        .limit(maxModalResultados)
      if (error) {
        showToast(error.message, 'error')
        return []
      }
      const rows = (data as ClienteOption[]) ?? []
      if (rows.length > 0) return rows
      if (clientes.length === 0) return []
      const localSearch = search.toLowerCase()
      return clientes
        .filter((cliente) => {
          const fullName = `${cliente.nombre ?? ''} ${cliente.apellido ?? ''}`.trim().toLowerCase()
          const phone = (cliente.telefono ?? '').toLowerCase()
          const phoneCasa = (cliente.telefono_casa ?? '').toLowerCase()
          const hycite = (cliente.hycite_id ?? '').toLowerCase()
          const cuenta = (cliente.numero_cuenta_financiera ?? '').toLowerCase()
          return (
            fullName.includes(localSearch) ||
            phone.includes(localSearch) ||
            phoneCasa.includes(localSearch) ||
            hycite.includes(localSearch) ||
            cuenta.includes(localSearch)
          )
        })
        .slice(0, maxModalResultados)
    },
    [clientes, configured, maxModalResultados, showToast]
  )

  useEffect(() => {
    let active = true
    const run = async () => {
      if (!configured || !session?.user.id) return
      const { data, error } = await supabase
        .from('tele_vendedor_assignments')
        .select('vendedor_id')
        .eq('tele_id', session.user.id)
      if (!active) return
      if (error) {
        setAssignedVendedorIds([])
        return
      }
      const ids = ((data ?? []) as { vendedor_id: string }[]).map((row) => row.vendedor_id)
      setAssignedVendedorIds(ids)
    }
    run()
    return () => {
      active = false
    }
  }, [configured, session?.user.id])

  useEffect(() => {
    let active = true
    const run = async () => {
      if (formClienteSearch.trim().length < 2) {
        setFormClientesRemote([])
        return
      }
      const results = await fetchClientesForModal(formClienteSearch)
      if (!active) return
      setFormClientesRemote(results)
    }
    run()
    return () => {
      active = false
    }
  }, [fetchClientesForModal, formClienteSearch])

  useEffect(() => {
    let active = true
    const run = async () => {
      if (noteClienteSearch.trim().length < 2) {
        setNoteClientesRemote([])
        return
      }
      const results = await fetchClientesForModal(noteClienteSearch)
      if (!active) return
      setNoteClientesRemote(results)
    }
    run()
    return () => {
      active = false
    }
  }, [fetchClientesForModal, noteClienteSearch])

  const formSearchActive = formClienteSearch.trim().length >= 2
  const noteSearchActive = noteClienteSearch.trim().length >= 2

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const vendedorId = toNull(formValues.vendedor_id) ?? session?.user.id ?? null

    // Conflict check — servicios + citas (exclude current service on edit)
    if (vendedorId && formValues.fecha_servicio && formValues.hora_cita) {
      const normalizedHora = normalizeTimeValue(formValues.hora_cita)
      const startAtIso = normalizedHora
        ? new Date(`${formValues.fecha_servicio}T${normalizedHora}:00`).toISOString()
        : null

      if (startAtIso) {
        let serviciosQuery = supabase
          .from('servicios')
          .select('id')
          .eq('vendedor_id', vendedorId)
          .eq('fecha_servicio', formValues.fecha_servicio)
          .eq('hora_cita', normalizedHora)
          .limit(1)

        if (formAction === 'edit' && editingServiceId) {
          serviciosQuery = serviciosQuery.neq('id', editingServiceId)
        }

        const citasQuery = supabase
          .from('citas')
          .select('id')
          .eq('start_at', startAtIso)
          .or(`owner_id.eq.${vendedorId},assigned_to.eq.${vendedorId}`)
          .limit(1)

        const [serviciosResult, citasResult] = await Promise.all([serviciosQuery, citasQuery])

        if (serviciosResult.error || citasResult.error) {
          const message =
            serviciosResult.error?.message ||
            citasResult.error?.message ||
            t('common.unknownError', 'No se pudo validar el horario.')
          setFormError(message)
          showToast(message, 'error')
          setSubmitting(false)
          return
        }

        if ((serviciosResult.data?.length ?? 0) > 0 || (citasResult.data?.length ?? 0) > 0) {
          const conflictMessage = t('servicio.form.errors.conflict')
          setFormError(conflictMessage)
          showToast(conflictMessage, 'error')
          setSubmitting(false)
          return
        }
      }
    }

    const payload = {
      cliente_id: toNull(formValues.cliente_id),
      equipo_instalado_id: toNull(formValues.equipo_instalado_id),
      vendedor_id: vendedorId,
      fecha_servicio: formValues.fecha_servicio || null,
      hora_cita: normalizeTimeValue(formValues.hora_cita) || null,
      tipo_servicio: formValues.tipo_servicio,
      observaciones: toNull(formValues.observaciones),
      venta_id: toNull(formValues.venta_id),
    }

    const { error: saveError } =
      formAction === 'edit' && editingServiceId
        ? await supabase.from('servicios').update(payload).eq('id', editingServiceId)
        : await supabase.from('servicios').insert(payload)

    if (saveError) {
      setFormError(saveError.message)
      showToast(saveError.message, 'error')
    } else {
      closeForm()
      await loadData()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const handleSubmitNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setNoteError(t('common.supabaseRequired'))
      return
    }
    if (!noteValues.cliente_id || !noteValues.nota.trim()) {
      setNoteError(t('servicio.note.errors.required'))
      return
    }
    setNoteSubmitting(true)
    setNoteError(null)
    const { error: insertError } = await supabase.from('notasrp').insert({
      cliente_id: noteValues.cliente_id,
      contenido: noteValues.nota.trim(),
      mensaje: noteValues.nota.trim(),
      canal: 'nota',
      tipo_mensaje: 'nota',
      enviado_por: session?.user.id ?? null,
      enviado_en: new Date().toISOString(),
    })

    if (insertError) {
      setNoteError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      setNoteOpen(false)
      showToast(t('toast.success'))
    }
    setNoteSubmitting(false)
  }

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  const formTitle =
    formAction === 'edit'
      ? (formMode === 'cita' ? t('servicio.form.editCitaTitle') : t('servicio.form.editTitle'))
      : formMode === 'cita'
        ? t('servicio.form.citaTitle')
        : t('servicio.form.title')

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('servicio.title')}
        subtitle={t('servicio.subtitle')}
        action={(
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={handleOpenNoteForm}>
              {t('servicio.newNote')}
            </Button>
            <Button variant="ghost" onClick={handleOpenCitaForm}>
              {t('servicio.newCita')}
            </Button>
            <Button onClick={handleOpenForm}>{t('servicio.newService')}</Button>
          </div>
        )}
      />

      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <label className="form-field" style={{ flex: 1 }}>
          <span>{t('servicio.search.label')}</span>
          <input
            type="search"
            placeholder={t('servicio.search.placeholder')}
            value={clienteSearch}
            onChange={(event) => setClienteSearch(event.target.value)}
          />
        </label>
      </div>

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
          t('servicio.servicios.columns.hora'),
          t('servicio.servicios.columns.tipo'),
          t('servicio.servicios.columns.observaciones'),
          t('servicio.servicios.columns.venta'),
          t('servicio.servicios.columns.acciones'),
        ]}
        rows={serviciosRows}
        emptyLabel={emptyLabel}
      />

      <Modal
        open={formOpen}
        title={formTitle}
        onClose={closeForm}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={closeForm}>
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
            <span>{t('servicio.search.label')}</span>
            <input
              type="search"
              placeholder={t('servicio.search.placeholder')}
              value={formClienteSearch}
              onChange={(event) => setFormClienteSearch(event.target.value)}
            />
          </label>
          {formSearchActive ? (
            <label className="form-field">
              <span>{t('servicio.form.fields.cliente')}</span>
              <select
                value={formValues.cliente_id}
                onChange={handleChange('cliente_id')}
                style={{ color: '#111827', background: '#ffffff' }}
              >
                <option value="" style={{ color: '#111827', background: '#ffffff' }}>{t('common.select')}</option>
                {formClientesRemote.map((cliente) => (
                  <option key={cliente.id} value={cliente.id} style={{ color: '#111827', background: '#ffffff' }}>
                    {[
                      [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.id,
                      cliente.telefono ? `Tel: ${cliente.telefono}` : null,
                      cliente.hycite_id || cliente.numero_cuenta_financiera
                        ? `Cuenta: ${cliente.hycite_id ?? cliente.numero_cuenta_financiera}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="form-hint">{t('servicio.search.helper')}</div>
          )}
          <label className="form-field">
            <span>{t('servicio.form.fields.asignado')}</span>
            <select
              value={formValues.vendedor_id}
              onChange={handleChange('vendedor_id')}
              disabled={currentUser?.rol === 'vendedor'}
              style={{ color: '#111827', background: '#ffffff' }}
            >
              <option value="" style={{ color: '#111827', background: '#ffffff' }}>{t('common.select')}</option>
              {usuariosAsignables.map((user) => (
                <option key={user.id} value={user.id} style={{ color: '#111827', background: '#ffffff' }}>
                  {user.label} ({t(`usuarios.roles.${user.rol}`, user.rol ?? '')})
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
            <span>{t('servicio.form.fields.hora') || 'Hora'}</span>
            <input
              type="time"
              value={formValues.hora_cita ? normalizeTimeValue(formValues.hora_cita) : ''}
              onChange={handleChange('hora_cita')}
            />
          </label>
          <label className="form-field">
            <span>{t('servicio.form.fields.tipo')}</span>
            <select value={formValues.tipo_servicio} onChange={handleChange('tipo_servicio')}>
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

      <Modal
        open={deleteConfirmOpen}
        title={t('servicio.delete.title', 'Eliminar servicio')}
        onClose={() => { setDeleteConfirmOpen(false); setDeleteServicioId(null) }}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => { setDeleteConfirmOpen(false); setDeleteServicioId(null) }}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              style={{ background: '#ef4444', color: '#fff', borderColor: '#ef4444' }}
              disabled={deleteSubmitting}
              onClick={handleConfirmDelete}
            >
              {deleteSubmitting ? t('common.saving') : t('servicio.delete.submit', '🗑️ Eliminar')}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          {t('servicio.delete.description', '¿Estás seguro de eliminar este servicio? Esta acción no se puede deshacer.')}
        </p>
      </Modal>

      <Modal
        open={noteOpen}
        title={t('servicio.note.title')}
        onClose={() => setNoteOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setNoteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="servicio-nota-form" disabled={noteSubmitting}>
              {noteSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="servicio-nota-form" className="form-grid" onSubmit={handleSubmitNote}>
          <label className="form-field">
            <span>{t('servicio.search.label')}</span>
            <input
              type="search"
              placeholder={t('servicio.search.placeholder')}
              value={noteClienteSearch}
              onChange={(event) => setNoteClienteSearch(event.target.value)}
            />
          </label>
          {noteSearchActive ? (
            <label className="form-field">
              <span>{t('servicio.note.fields.cliente')}</span>
              <select
                value={noteValues.cliente_id}
                onChange={handleNoteChange('cliente_id')}
                style={{ color: '#111827', background: '#ffffff' }}
              >
                <option value="" style={{ color: '#111827', background: '#ffffff' }}>{t('common.select')}</option>
                {noteClientesRemote.map((cliente) => (
                  <option key={cliente.id} value={cliente.id} style={{ color: '#111827', background: '#ffffff' }}>
                    {[
                      [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.id,
                      cliente.telefono ? `Tel: ${cliente.telefono}` : null,
                      cliente.hycite_id || cliente.numero_cuenta_financiera
                        ? `Cuenta: ${cliente.hycite_id ?? cliente.numero_cuenta_financiera}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="form-hint">{t('servicio.search.helper')}</div>
          )}
          <label className="form-field">
            <span>{t('servicio.note.fields.nota')}</span>
            <textarea rows={4} value={noteValues.nota} onChange={handleNoteChange('nota')} />
          </label>
          {noteError && <div className="form-error">{noteError}</div>}
        </form>
      </Modal>
    </div>
  )
}
