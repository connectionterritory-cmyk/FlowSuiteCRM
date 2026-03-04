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
import { useUsers } from '../../data/UsersProvider'

type ClienteOption = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  telefono_casa?: string | null
  hycite_id: string | null
  numero_cuenta_financiera: string | null
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
  tipo: string | null
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
}

const initialServiceForm = {
  cliente_id: '',
  equipo_instalado_id: '',
  vendedor_id: '',
  fecha_servicio: '',
  tipo: 'cambio_repuesto',
  observaciones: '',
  venta_id: '',
}

export function ServicioClientePage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { currentUser, usersById } = useUsers()
  const { showToast } = useToast()
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
            'id, nombre, apellido, telefono, telefono_casa, hycite_id, numero_cuenta_financiera, vendedor_id, distribuidor_id'
          ),
        supabase.from('productos').select('id, nombre'),
        supabase
          .from('equipos_instalados')
          .select('id, cliente_id, producto_id, numero_serie, fecha_instalacion, activo'),
        supabase
          .from('componentes_equipo')
          .select('id, equipo_instalado_id, nombre_componente, ciclo_meses, fecha_proximo_cambio, activo'),
        supabase
          .from('servicios')
          .select('id, cliente_id, equipo_instalado_id, fecha_servicio, tipo, observaciones, venta_id, vendedor_id'),
        supabase.from('ventas').select('id, cliente_id, numero_nota_pedido'),
        supabase.from('usuarios').select('id, nombre, apellido, rol, activo'),
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

  const serviciosRows = useMemo<DataTableRow[]>(() => {
    return serviciosFiltrados.map((servicio) => {
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
  }, [clienteMap, serviciosFiltrados, t, ventasMap])

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
        label: [user.nombre, user.apellido].filter(Boolean).join(' ').trim() || user.id,
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

  const handleOpenForm = () => {
    setFormValues({
      ...initialServiceForm,
      vendedor_id: '',
    })
    setFormError(null)
    setFormMode('servicio')
    setFormClienteSearch('')
    setFormOpen(true)
  }

  const handleOpenCitaForm = () => {
    setFormValues({
      ...initialServiceForm,
      vendedor_id: '',
      tipo: 'revision',
    })
    setFormError(null)
    setFormMode('cita')
    setFormClienteSearch('')
    setFormOpen(true)
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
          t('servicio.servicios.columns.tipo'),
          t('servicio.servicios.columns.observaciones'),
          t('servicio.servicios.columns.venta'),
        ]}
        rows={serviciosRows}
        emptyLabel={emptyLabel}
      />

      <Modal
        open={formOpen}
        title={formMode === 'cita' ? t('servicio.form.citaTitle') : t('servicio.form.title')}
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
              <select value={formValues.cliente_id} onChange={handleChange('cliente_id')}>
                <option value="">{t('common.select')}</option>
                {formClientesRemote.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
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
            <select value={formValues.vendedor_id} onChange={handleChange('vendedor_id')}>
              <option value="">{t('common.select')}</option>
              {usuariosAsignables.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.label} {user.rol === 'distribuidor' ? `(${t('usuarios.roles.distribuidor')})` : ''}
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
              <select value={noteValues.cliente_id} onChange={handleNoteChange('cliente_id')}>
                <option value="">{t('common.select')}</option>
                {noteClientesRemote.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
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
