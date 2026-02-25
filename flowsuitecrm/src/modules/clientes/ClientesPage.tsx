import { type ChangeEvent, type ClipboardEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { DetailPanel } from '../../components/DetailPanel'
import { EmptyState } from '../../components/EmptyState'
import { IconWhatsapp } from '../../components/icons'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useUsers } from '../../data/UsersProvider'
import { useMessaging } from '../../hooks/useMessaging'
import { parseUsAddress, buildMapsNavUrl, buildTelUrl, capitalizeProperName, type ParsedAddress } from '../../lib/addressUtils'

type ClienteRecord = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  telefono_casa: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
  numero_cuenta_financiera: string | null
  hycite_id: string | null
  saldo_actual: number | null
  monto_moroso: number | null
  dias_atraso: number | null
  estado_morosidad: string | null
  estado_cuenta: string | null
  nivel: number | null
  vendedor_id: string | null
  distribuidor_id: string | null
  codigo_vendedor_hycite: string | null
  fecha_nacimiento: string | null
  fecha_ultimo_pedido: string | null
  activo: boolean | null
  origen: string | null
  created_at: string | null
}

const initialForm = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  telefono_casa: '',
  direccion: '',
  ciudad: '',
  estado_region: '',
  codigo_postal: '',
  numero_cuenta_financiera: '',
  saldo_actual: '',
  vendedor_id: '',
  distribuidor_id: '',
  fecha_nacimiento: '',
  activo: true,
}

const BIRTH_YEAR_DEFAULT = 2000
const MONTH_OPTIONS = [
  { value: '01', label: 'Enero' },
  { value: '02', label: 'Febrero' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Mayo' },
  { value: '06', label: 'Junio' },
  { value: '07', label: 'Julio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' },
]
const DAY_OPTIONS = Array.from({ length: 31 }, (_, idx) => String(idx + 1).padStart(2, '0'))

const splitBirthDate = (value: string | null) => {
  if (!value) return { month: '', day: '' }
  const parts = value.split('-')
  return {
    month: parts[1] ?? '',
    day: parts[2] ?? '',
  }
}

const buildBirthDate = (month: string, day: string) => {
  if (!month || !day) return null
  const m = Number(month)
  const d = Number(day)
  if (!m || !d) return null
  const candidate = new Date(BIRTH_YEAR_DEFAULT, m - 1, d)
  if (candidate.getMonth() !== m - 1 || candidate.getDate() !== d) return null
  return `${BIRTH_YEAR_DEFAULT}-${month}-${day}`
}

// Segmento de atraso basado en dias_atraso
function segmentoAtraso(dias: number | null, moroso: number | null): string {
  if (!moroso || moroso === 0) return 'Al día'
  if (!dias) return 'Al día'
  if (dias >= 91) return '+90 días'
  if (dias >= 61) return '61-90 días'
  if (dias >= 31) return '31-60 días'
  if (dias >= 1) return '0-30 días'
  return 'Al día'
}

function badgeColor(segmento: string): string {
  if (segmento === 'Al día') return '#d1fae5'
  if (segmento === '0-30 días') return '#fef3c7'
  if (segmento === '31-60 días') return '#fed7aa'
  if (segmento === '61-90 días') return '#fecaca'
  if (segmento === '+90 días') return '#f3e8ff'
  return '#f3f4f6'
}

function badgeTextColor(segmento: string): string {
  if (segmento === 'Al día') return '#065f46'
  if (segmento === '0-30 días') return '#92400e'
  if (segmento === '31-60 días') return '#9a3412'
  if (segmento === '61-90 días') return '#991b1b'
  if (segmento === '+90 días') return '#6b21a8'
  return '#374151'
}

export function ClientesPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { usersById, currentRole } = useUsers()
  const { showToast } = useToast()
  const [clientes, setClientes] = useState<ClienteRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [birthMonth, setBirthMonth] = useState('')
  const [birthDay, setBirthDay] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [parsedAddr, setParsedAddr] = useState<ParsedAddress | null>(null)
  const [selectedRow, setSelectedRow] = useState<DataTableRow | null>(null)
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const configured = isSupabaseConfigured

  // --- FILTROS ---
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroAtraso, setFiltroAtraso] = useState('todos')
  const [filtroVendedor, setFiltroVendedor] = useState('todos')
  const [filtroCiudad, setFiltroCiudad] = useState('')
  const [filtroEstadoRegion, setFiltroEstadoRegion] = useState('')
  const [filtroCodigoPostal, setFiltroCodigoPostal] = useState('')
  const [filtrosVisible, setFiltrosVisible] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 720)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const loadClientes = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    let query = supabase.from('clientes').select('*').order('created_at', { ascending: false })
    if (currentRole === 'vendedor' && session?.user.id) {
      query = query.eq('vendedor_id', session.user.id)
    }
    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(fetchError.message)
      setClientes([])
    } else {
      setClientes((data ?? []) as ClienteRecord[])
    }
    setLoading(false)
  }, [configured, currentRole, session?.user.id])

  useEffect(() => {
    if (configured) loadClientes()
  }, [configured, loadClientes])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 720)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // --- VENDEDORES UNICOS para el filtro ---
  const vendedoresUnicos = useMemo(() => {
    const ids = [...new Set(clientes.map((c) => c.vendedor_id).filter(Boolean))] as string[]
    return ids.map((id) => ({
      id,
      nombre: usersById[id] ?? `${id.slice(0, 8)}...`,
    }))
  }, [clientes, usersById])

  // --- FILTRADO ---
  const clientesFiltrados = useMemo(() => {
    return clientes.filter((c) => {
      const fullName = `${c.nombre ?? ''} ${c.apellido ?? ''}`.toLowerCase()
      const tel = c.telefono ?? ''
      const cuenta = c.hycite_id ?? c.numero_cuenta_financiera ?? ''
      const matchBusqueda =
        !busqueda ||
        fullName.includes(busqueda.toLowerCase()) ||
        tel.includes(busqueda) ||
        cuenta.includes(busqueda)

      const segmento = segmentoAtraso(c.dias_atraso, c.monto_moroso)
      const matchAtraso =
        filtroAtraso === 'todos' ||
        (filtroAtraso === 'al_dia' && segmento === 'Al día') ||
        (filtroAtraso === '0_30' && segmento === '0-30 días') ||
        (filtroAtraso === '31_60' && segmento === '31-60 días') ||
        (filtroAtraso === '61_90' && segmento === '61-90 días') ||
        (filtroAtraso === 'mas_90' && segmento === '+90 días') ||
        (filtroAtraso === 'con_moroso' && segmento !== 'Al día')

      const matchEstado =
        filtroEstado === 'todos' ||
        (filtroEstado === 'actual' && (c.estado_cuenta === 'actual' || (!c.estado_cuenta && c.activo))) ||
        (filtroEstado === 'cancelacion_total' && c.estado_cuenta === 'cancelacion_total') ||
        (filtroEstado === 'inactivo' && (c.estado_cuenta === 'inactivo' || c.activo === false))

      const matchVendedor = filtroVendedor === 'todos' || c.vendedor_id === filtroVendedor
      const matchCiudad =
        !filtroCiudad || (c.ciudad ?? '').toLowerCase().includes(filtroCiudad.toLowerCase())
      const matchEstadoRegion =
        !filtroEstadoRegion || (c.estado_region ?? '').toLowerCase().includes(filtroEstadoRegion.toLowerCase())
      const matchCodigoPostal =
        !filtroCodigoPostal || (c.codigo_postal ?? '').toLowerCase().includes(filtroCodigoPostal.toLowerCase())

      return (
        matchBusqueda &&
        matchAtraso &&
        matchEstado &&
        matchVendedor &&
        matchCiudad &&
        matchEstadoRegion &&
        matchCodigoPostal
      )
    })
  }, [
    clientes,
    busqueda,
    filtroAtraso,
    filtroEstado,
    filtroVendedor,
    filtroCiudad,
    filtroEstadoRegion,
    filtroCodigoPostal,
  ])

  // --- ORDENACION ---
  const handleSort = (colIndex: number) => {
    if (sortCol === colIndex) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(colIndex)
      setSortDir('asc')
    }
  }

  const clientesOrdenados = useMemo(() => {
    if (sortCol === null) return clientesFiltrados
    return [...clientesFiltrados].sort((a, b) => {
      let valA: string | number = 0
      let valB: string | number = 0
      if (sortCol === 0) {
        valA = `${a.nombre ?? ''} ${a.apellido ?? ''}`.toLowerCase()
        valB = `${b.nombre ?? ''} ${b.apellido ?? ''}`.toLowerCase()
      } else if (sortCol === 4) {
        valA = a.saldo_actual ?? 0
        valB = b.saldo_actual ?? 0
      } else if (sortCol === 5) {
        valA = a.dias_atraso ?? 0
        valB = b.dias_atraso ?? 0
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [clientesFiltrados, sortCol, sortDir])

  // --- DUPLICADOS ---
  const [showDuplicados, setShowDuplicados] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const duplicateGroups = useMemo(() => {
    const phoneMap = new Map<string, ClienteRecord[]>()
    for (const c of clientes) {
      const normalized = (c.telefono ?? '').replace(/\D/g, '')
      if (!normalized) continue
      if (!phoneMap.has(normalized)) phoneMap.set(normalized, [])
      phoneMap.get(normalized)!.push(c)
    }
    return [...phoneMap.values()]
      .filter((group) => group.length > 1)
      .map((group) => group.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')))
  }, [clientes])

  const handleDeleteCliente = async (id: string) => {
    setDeletingId(id)
    const { error: delError } = await supabase.from('clientes').delete().eq('id', id)
    if (delError) {
      showToast(delError.message, 'error')
    } else {
      showToast('Cliente eliminado')
      await loadClientes()
    }
    setDeletingId(null)
  }

  // --- ESTADISTICAS ---
  const stats = useMemo(
    () => ({
      total: clientes.length,
      alDia: clientes.filter((c) => !c.monto_moroso || c.monto_moroso === 0).length,
      conMoroso: clientes.filter((c) => c.monto_moroso && c.monto_moroso > 0).length,
      cancelados: clientes.filter((c) => c.estado_cuenta === 'cancelacion_total').length,
    }),
    [clientes]
  )

  // --- ROWS ---
  const rows = useMemo<DataTableRow[]>(() => {
    return clientesOrdenados.map((cliente) => {
      const fullName = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || '-'
      const vendedorName = cliente.vendedor_id
        ? usersById[cliente.vendedor_id] ?? cliente.codigo_vendedor_hycite ?? `${cliente.vendedor_id.slice(0, 8)}...`
        : '-'
      const cuenta = cliente.hycite_id ?? cliente.numero_cuenta_financiera ?? '-'
      const segmento = segmentoAtraso(cliente.dias_atraso, cliente.monto_moroso)

      const morosidadBadge = (
        <span
          style={{
            padding: '0.2rem 0.6rem',
            borderRadius: '9999px',
            fontSize: '0.72rem',
            fontWeight: 600,
            background: badgeColor(segmento),
            color: badgeTextColor(segmento),
            whiteSpace: 'nowrap',
          }}
        >
          {segmento}
        </span>
      )

      const estadoBadge = (
        <span
          style={{
            padding: '0.2rem 0.6rem',
            borderRadius: '9999px',
            fontSize: '0.72rem',
            fontWeight: 600,
            background: cliente.estado_cuenta === 'cancelacion_total' ? '#f3f4f6' : '#d1fae5',
            color: cliente.estado_cuenta === 'cancelacion_total' ? '#6b7280' : '#065f46',
            whiteSpace: 'nowrap',
          }}
        >
          {cliente.estado_cuenta === 'cancelacion_total' ? 'Cancelado' : 'Actual'}
        </span>
      )

      const saldoDisplay = cliente.saldo_actual ? `$${Number(cliente.saldo_actual).toFixed(2)}` : '-'

      const whatsappAction = (
        <button
          type="button"
          className="whatsapp-button"
          aria-label="WhatsApp"
          onClick={(event) => {
            event.stopPropagation()
            openWhatsapp({
              nombre: fullName,
              telefono: cliente.telefono ?? '',
              email: cliente.email ?? '',
              vendedor: vendedorName === '-' ? '' : vendedorName,
            })
          }}
        >
          <IconWhatsapp className="whatsapp-icon" />
        </button>
      )

      return {
        id: cliente.id,
        cells: [
          fullName,
          cliente.telefono ?? '-',
          cuenta,
          vendedorName,
          saldoDisplay,
          morosidadBadge,
          estadoBadge,
          whatsappAction,
        ],
        detail: [
          { label: 'Nombre', value: cliente.nombre ?? '-' },
          { label: 'Apellido', value: cliente.apellido ?? '-' },
          { label: 'Email', value: cliente.email ?? '-' },
          {
            label: 'Telefono movil',
            value: cliente.telefono ? (
              <a href={buildTelUrl(cliente.telefono)} style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 600 }}>
                📞 {cliente.telefono}
              </a>
            ) : '-',
          },
          {
            label: 'Telefono casa',
            value: cliente.telefono_casa ? (
              <a href={buildTelUrl(cliente.telefono_casa)} style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 600 }}>
                📞 {cliente.telefono_casa}
              </a>
            ) : '-',
          },
          {
            label: 'Direccion',
            value: (() => {
              const mapsUrl = buildMapsNavUrl({ direccion: cliente.direccion, ciudad: cliente.ciudad, estado_region: cliente.estado_region, codigo_postal: cliente.codigo_postal })
              const addr = [cliente.direccion, cliente.ciudad, cliente.estado_region, cliente.codigo_postal].filter(Boolean).join(', ')
              return addr ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span>{addr}</span>
                  {mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700, whiteSpace: 'nowrap', textDecoration: 'none', padding: '0.1rem 0.5rem', border: '1px solid #10b98133', borderRadius: '9999px', background: '#10b98111' }}>
                      🗺 Navegar
                    </a>
                  )}
                </span>
              ) : '-'
            })(),
          },
          { label: 'Ciudad', value: cliente.ciudad ?? '-' },
          { label: 'Estado', value: cliente.estado_region ?? '-' },
          { label: 'Codigo postal', value: cliente.codigo_postal ?? '-' },
          { label: 'Cuenta Hycite', value: cliente.hycite_id ?? '-' },
          { label: 'Cuenta financiera', value: cliente.numero_cuenta_financiera ?? '-' },
          { label: 'Saldo actual', value: cliente.saldo_actual ? `$${Number(cliente.saldo_actual).toFixed(2)}` : '-' },
          { label: 'Monto moroso', value: cliente.monto_moroso ? `$${Number(cliente.monto_moroso).toFixed(2)}` : '-' },
          { label: 'Dias de atraso', value: segmento },
          { label: 'Nivel', value: cliente.nivel ? String(cliente.nivel) : '-' },
          { label: 'Estado', value: cliente.estado_cuenta ?? '-' },
          { label: 'Ultimo pedido', value: cliente.fecha_ultimo_pedido ?? '-' },
          { label: 'Vendedor', value: vendedorName },
          { label: 'Codigo vendedor', value: cliente.codigo_vendedor_hycite ?? '-' },
          { label: 'Origen', value: cliente.origen ?? '-' },
        ],
      }
    })
  }, [clientesOrdenados, openWhatsapp, usersById])

  const selectedCliente = selectedRow ? clientes.find((c) => c.id === selectedRow.id) ?? null : null

  const emptyLabel = loading ? t('common.loading') : 'Sin resultados'

  const handleOpenForm = () => {
    setEditingId(null)
    setFormValues({ ...initialForm, vendedor_id: session?.user.id ?? '' })
    setBirthMonth('')
    setBirthDay('')
    setFormError(null)
    setFormOpen(true)
  }

  const handleOpenEditForm = (cliente: ClienteRecord) => {
    const birth = splitBirthDate(cliente.fecha_nacimiento ?? null)
    setEditingId(cliente.id)
    setFormValues({
      nombre: cliente.nombre ?? '',
      apellido: cliente.apellido ?? '',
      email: cliente.email ?? '',
      telefono: cliente.telefono ?? '',
      telefono_casa: cliente.telefono_casa ?? '',
      direccion: cliente.direccion ?? '',
      ciudad: cliente.ciudad ?? '',
      estado_region: cliente.estado_region ?? '',
      codigo_postal: cliente.codigo_postal ?? '',
      numero_cuenta_financiera: cliente.numero_cuenta_financiera ?? '',
      saldo_actual: cliente.saldo_actual != null ? String(cliente.saldo_actual) : '',
      vendedor_id: cliente.vendedor_id ?? '',
      distribuidor_id: cliente.distribuidor_id ?? '',
      fecha_nacimiento: cliente.fecha_nacimiento ?? '',
      activo: cliente.activo ?? true,
    })
    setParsedAddr(null)
    setBirthMonth(birth.month)
    setBirthDay(birth.day)
    setFormError(null)
    setFormOpen(true)
  }

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditingId(null)
  }

  const vendedorName = session?.user.id ? usersById[session.user.id] ?? session.user.id : '-'
  const formVendedorName = editingId
    ? formValues.vendedor_id ? (usersById[formValues.vendedor_id] ?? formValues.vendedor_id) : '-'
    : vendedorName

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const toNull = (v: string) => (v.trim() === '' ? null : v.trim())
    const birthDate = buildBirthDate(birthMonth, birthDay)
    if ((birthMonth || birthDay) && !birthDate) {
      setFormError('Fecha de cumpleaños inválida.')
      setSubmitting(false)
      return
    }
    // Dedup: compare normalized phone (digits only) against existing clientes
    if (!editingId) {
      const normalizedNew = formValues.telefono.replace(/\D/g, '')
      if (normalizedNew) {
        const duplicate = clientes.find((c) => {
          const existing = (c.telefono ?? '').replace(/\D/g, '')
          return existing && existing === normalizedNew
        })
        if (duplicate) {
          const dupName = [duplicate.nombre, duplicate.apellido].filter(Boolean).join(' ') || 'Sin nombre'
          setFormError(`Ya existe un cliente con este teléfono: ${dupName} (${duplicate.telefono})`)
          setSubmitting(false)
          return
        }
      }
    }
    const basePayload = {
      nombre: toNull(formValues.nombre),
      apellido: toNull(formValues.apellido),
      email: toNull(formValues.email),
      telefono: toNull(formValues.telefono),
      telefono_casa: toNull(formValues.telefono_casa),
      direccion: toNull(formValues.direccion),
      ciudad: toNull(formValues.ciudad),
      estado_region: toNull(formValues.estado_region),
      codigo_postal: toNull(formValues.codigo_postal),
      numero_cuenta_financiera: toNull(formValues.numero_cuenta_financiera),
      saldo_actual: formValues.saldo_actual === '' ? 0 : Number(formValues.saldo_actual),
      distribuidor_id: toNull(formValues.distribuidor_id),
      fecha_nacimiento: birthDate,
      activo: formValues.activo,
    }
    const { error: opError } = editingId
      ? await supabase.from('clientes').update(basePayload).eq('id', editingId)
      : await supabase.from('clientes').insert({ ...basePayload, vendedor_id: session?.user.id ?? null, origen: 'manual' })
    if (opError) {
      setFormError(opError.message)
      showToast(opError.message, 'error')
    } else {
      handleCloseForm()
      await loadClientes()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const handleChange = (field: keyof typeof initialForm) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = event.target
    const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value
    setFormValues((prev) => ({ ...prev, [field]: value }))
  }

  const handleCapitalize = (field: 'nombre' | 'apellido') => () => {
    setFormValues((prev) => ({ ...prev, [field]: capitalizeProperName(prev[field] as string) }))
  }

  const handleDireccionPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text')
    const parsed = parseUsAddress(pasted)
    if (parsed) {
      event.preventDefault()
      setFormValues((prev) => ({
        ...prev,
        direccion: parsed.direccion,
        ciudad: parsed.ciudad,
        estado_region: parsed.estado_region,
        codigo_postal: parsed.codigo_postal,
      }))
      setParsedAddr(parsed)
    }
  }

  const limpiarFiltros = () => {
    setBusqueda('')
    setFiltroEstado('todos')
    setFiltroAtraso('todos')
    setFiltroVendedor('todos')
    setFiltroCiudad('')
    setFiltroEstadoRegion('')
    setFiltroCodigoPostal('')
  }

  const exportarCSV = () => {
    const headers = [
      'Nombre', 'Apellido', 'Telefono', 'Email', 'Cuenta Hycite',
      'Cuenta Financiera', 'Ciudad', 'Estado', 'ZIP',
      'Saldo', 'Monto Moroso', 'Dias Atraso', 'Estado Cuenta', 'Vendedor',
    ]
    const csvRows = clientesFiltrados.map((c) => [
      c.nombre ?? '',
      c.apellido ?? '',
      c.telefono ?? '',
      c.email ?? '',
      c.hycite_id ?? '',
      c.numero_cuenta_financiera ?? '',
      c.ciudad ?? '',
      c.estado_region ?? '',
      c.codigo_postal ?? '',
      c.saldo_actual ?? 0,
      c.monto_moroso ?? 0,
      c.dias_atraso ?? 0,
      c.estado_cuenta ?? '',
      c.vendedor_id ? (usersById[c.vendedor_id] ?? c.vendedor_id) : '',
    ])
    const csv = [headers, ...csvRows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hayFiltros =
    busqueda ||
    filtroEstado !== 'todos' ||
    filtroAtraso !== 'todos' ||
    filtroVendedor !== 'todos' ||
    filtroCiudad ||
    filtroEstadoRegion ||
    filtroCodigoPostal

  const cantFiltrosActivos = [
    busqueda,
    filtroEstado !== 'todos' ? '1' : '',
    filtroAtraso !== 'todos' ? '1' : '',
    filtroVendedor !== 'todos' ? '1' : '',
    filtroCiudad,
    filtroEstadoRegion,
    filtroCodigoPostal,
  ].filter(Boolean).length

  if (!configured) {
    return <EmptyState title={t('dashboard.missingConfigTitle')} description={t('dashboard.missingConfigDescription')} />
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('clientes.title')}
        subtitle={t('clientes.subtitle')}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {duplicateGroups.length > 0 && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => setShowDuplicados(true)}
                style={{ color: '#dc2626', borderColor: '#fca5a5' }}
              >
                ⚠ Duplicados ({duplicateGroups.length})
              </Button>
            )}
            <Button
              variant="ghost"
              type="button"
              onClick={exportarCSV}
              disabled={clientesFiltrados.length === 0}
            >
              Exportar CSV
            </Button>
            <Button onClick={handleOpenForm}>{t('common.newCliente')}</Button>
          </div>
        }
      />

      {/* ESTADISTICAS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Total', value: stats.total, color: '#3b82f6', onClick: limpiarFiltros },
          { label: 'Al día', value: stats.alDia, color: '#10b981', onClick: () => { limpiarFiltros(); setFiltroAtraso('al_dia') } },
          { label: 'Con morosidad', value: stats.conMoroso, color: '#f59e0b', onClick: () => { limpiarFiltros(); setFiltroAtraso('con_moroso') } },
          { label: 'Cancelados', value: stats.cancelados, color: '#6b7280', onClick: () => { limpiarFiltros(); setFiltroEstado('cancelacion_total') } },
        ].map((s) => (
          <div
            key={s.label}
            role="button"
            tabIndex={0}
            onClick={s.onClick}
            onKeyDown={(e) => e.key === 'Enter' && s.onClick()}
            title="Click para filtrar"
            style={{
              padding: '0.875rem 1rem',
              background: 'var(--color-surface, #f9fafb)',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-border, #e5e7eb)',
              textAlign: 'center',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* FILTROS */}
      <div
        style={{
          background: 'var(--color-surface, #f9fafb)',
          borderRadius: '0.75rem',
          border: '1px solid var(--color-border, #e5e7eb)',
        }}
      >
        {/* Header colapsable */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFiltrosVisible((v) => !v)}
          onKeyDown={(e) => e.key === 'Enter' && setFiltrosVisible((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: 'var(--color-text-muted, #6b7280)',
                letterSpacing: '0.05em',
              }}
            >
              FILTROS
            </span>
            {cantFiltrosActivos > 0 && (
              <span
                style={{
                  background: '#2563eb',
                  color: 'white',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.45rem',
                  borderRadius: '9999px',
                  lineHeight: 1.4,
                }}
              >
                {cantFiltrosActivos}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)' }}>
              {clientesFiltrados.length} de {clientes.length} clientes
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)' }}>
              {filtrosVisible ? '▲' : '▼'}
            </span>
          </div>
        </div>

        {/* Campos de filtro */}
        {filtrosVisible && (
          <div
            style={{
              padding: '0 1rem 1rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              alignItems: 'flex-end',
              borderTop: '1px solid var(--color-border, #e5e7eb)',
            }}
          >
            {/* Busqueda */}
            <div style={{ flex: '1', minWidth: '200px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                BUSCAR
              </label>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre, telefono, cuenta Hycite..."
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Filtro ciudad */}
            <div style={{ minWidth: '160px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                CIUDAD
              </label>
              <input
                value={filtroCiudad}
                onChange={(e) => setFiltroCiudad(e.target.value)}
                placeholder="Ciudad"
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Filtro estado region */}
            <div style={{ minWidth: '160px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                ESTADO / REGIÓN
              </label>
              <input
                value={filtroEstadoRegion}
                onChange={(e) => setFiltroEstadoRegion(e.target.value)}
                placeholder="Estado"
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Filtro ZIP */}
            <div style={{ minWidth: '140px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                ZIP
              </label>
              <input
                value={filtroCodigoPostal}
                onChange={(e) => setFiltroCodigoPostal(e.target.value)}
                placeholder="Zip Code"
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Filtro cuenta */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                CUENTA
              </label>
              <select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                }}
              >
                <option value="todos">Todos</option>
                <option value="actual">Actual</option>
                <option value="cancelacion_total">Cancelado</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>

            {/* Filtro atraso */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                MOROSIDAD
              </label>
              <select
                value={filtroAtraso}
                onChange={(e) => setFiltroAtraso(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                }}
              >
                <option value="todos">Todos</option>
                <option value="al_dia">Al día</option>
                <option value="con_moroso">Con morosidad</option>
                <option value="0_30">0-30 días</option>
                <option value="31_60">31-60 días</option>
                <option value="61_90">61-90 días</option>
                <option value="mas_90">+90 días</option>
              </select>
            </div>

            {/* Filtro vendedor */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                VENDEDOR
              </label>
              <select
                value={filtroVendedor}
                onChange={(e) => setFiltroVendedor(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                }}
              >
                <option value="todos">Todos</option>
                {vendedoresUnicos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                  </option>
                ))}
              </select>
            </div>

            {/* Limpiar filtros */}
            {hayFiltros && (
              <Button variant="ghost" type="button" onClick={limpiarFiltros}>
                Limpiar
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {clientesFiltrados.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2rem 1rem',
                color: 'var(--text-muted, #94a3b8)',
                background: 'var(--card-bg, #1e2d3d)',
                borderRadius: '0.75rem',
                border: '1px solid var(--card-border, rgba(255,255,255,0.08))',
              }}
            >
              {emptyLabel}
            </div>
          ) : (
            clientesFiltrados.map((cliente) => {
              const fullName = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || '-'
              const segmento = segmentoAtraso(cliente.dias_atraso, cliente.monto_moroso)
              const cardVendedor = cliente.vendedor_id
                ? usersById[cliente.vendedor_id] ?? cliente.codigo_vendedor_hycite ?? `${cliente.vendedor_id.slice(0, 8)}...`
                : '-'
              const matchingRow = rows.find((r) => r.id === cliente.id)
              return (
                <div
                  key={cliente.id}
                  onClick={() => matchingRow && setSelectedRow(matchingRow)}
                  style={{
                    padding: '0.875rem 1rem',
                    background: 'var(--card-bg, #1e2d3d)',
                    borderRadius: '0.75rem',
                    border: '1px solid var(--card-border, rgba(255,255,255,0.08))',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{fullName}</span>
                    <span
                      style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '9999px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: badgeColor(segmento),
                        color: badgeTextColor(segmento),
                        flexShrink: 0,
                      }}
                    >
                      {segmento}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.8rem',
                      color: 'var(--text-muted, #94a3b8)',
                    }}
                  >
                    <span>{cliente.telefono ?? '-'}</span>
                    <span>{cardVendedor}</span>
                  </div>
                  {((cliente.saldo_actual ?? 0) > 0 || (cliente.monto_moroso ?? 0) > 0) && (
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem' }}>
                      {(cliente.saldo_actual ?? 0) > 0 && (
                        <span>Saldo: ${Number(cliente.saldo_actual).toFixed(2)}</span>
                      )}
                      {(cliente.monto_moroso ?? 0) > 0 && (
                        <span style={{ color: '#f59e0b' }}>
                          Moroso: ${Number(cliente.monto_moroso).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                    <button
                      type="button"
                      className="whatsapp-button"
                      aria-label="WhatsApp"
                      onClick={(e) => {
                        e.stopPropagation()
                        openWhatsapp({
                          nombre: fullName,
                          telefono: cliente.telefono ?? '',
                          email: cliente.email ?? '',
                          vendedor: cardVendedor === '-' ? '' : cardVendedor,
                        })
                      }}
                    >
                      <IconWhatsapp className="whatsapp-icon" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        <DataTable
          columns={['Nombre', 'Telefono', 'Cuenta Hycite', 'Vendedor', 'Saldo', 'Morosidad', 'Estado', 'WhatsApp']}
          rows={rows}
          emptyLabel={emptyLabel}
          onRowClick={setSelectedRow}
          sortableColumns={[0, 4, 5]}
          sortColIndex={sortCol ?? undefined}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

      {/* MODAL NUEVO / EDITAR CLIENTE */}
      <Modal
        open={formOpen}
        title={editingId ? 'Editar cliente' : t('clientes.form.title')}
        onClose={handleCloseForm}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={handleCloseForm}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="cliente-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="cliente-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{t('clientes.fields.nombre')}</span>
            <input value={formValues.nombre} onChange={handleChange('nombre')} onBlur={handleCapitalize('nombre')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.apellido')}</span>
            <input value={formValues.apellido} onChange={handleChange('apellido')} onBlur={handleCapitalize('apellido')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.email')}</span>
            <input type="email" value={formValues.email} onChange={handleChange('email')} />
          </label>
          <label className="form-field">
            <span>Telefono movil</span>
            <input value={formValues.telefono} onChange={handleChange('telefono')} />
          </label>
          <label className="form-field">
            <span>Telefono casa</span>
            <input value={formValues.telefono_casa} onChange={handleChange('telefono_casa')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.direccion')}</span>
            <input
              value={formValues.direccion}
              onChange={handleChange('direccion')}
              onPaste={handleDireccionPaste}
              placeholder="Pega la dirección completa aquí para auto-rellenar"
            />
          </label>
          {parsedAddr && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '0.5rem 0.75rem',
                background: '#d1fae5',
                border: '1px solid #6ee7b7',
                borderRadius: '0.375rem',
                fontSize: '0.82rem',
                color: '#065f46',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              ✓ Dirección detectada — ciudad, estado y ZIP rellenados automáticamente
            </div>
          )}
          <label className="form-field">
            <span>Ciudad</span>
            <input value={formValues.ciudad} onChange={handleChange('ciudad')} />
          </label>
          <label className="form-field">
            <span>Estado</span>
            <input value={formValues.estado_region} onChange={handleChange('estado_region')} />
          </label>
          <label className="form-field">
            <span>Código postal</span>
            <input value={formValues.codigo_postal} onChange={handleChange('codigo_postal')} />
          </label>
          <label className="form-field">
            <span>Cuenta Hycite / Financiera</span>
            <input value={formValues.numero_cuenta_financiera} onChange={handleChange('numero_cuenta_financiera')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.saldoActual')}</span>
            <input type="number" value={formValues.saldo_actual} onChange={handleChange('saldo_actual')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.vendedorId')}</span>
            <input value={formVendedorName} readOnly />
          </label>
          <label className="form-field">
            <span>Cumpleaños (día y mes)</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select value={birthDay} onChange={(event) => setBirthDay(event.target.value)}>
                <option value="">Día</option>
                {DAY_OPTIONS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
              <select value={birthMonth} onChange={(event) => setBirthMonth(event.target.value)}>
                <option value="">Mes</option>
                {MONTH_OPTIONS.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="form-field checkbox-field">
            <span>{t('clientes.fields.activo')}</span>
            <input type="checkbox" checked={formValues.activo} onChange={handleChange('activo')} />
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>

      <DetailPanel
        open={Boolean(selectedRow)}
        title="Detalle del cliente"
        items={selectedRow?.detail ?? []}
        onClose={() => setSelectedRow(null)}
        action={
          selectedCliente ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className="whatsapp-button"
                aria-label="WhatsApp"
                onClick={() =>
                  openWhatsapp({
                    nombre: [selectedCliente.nombre, selectedCliente.apellido].filter(Boolean).join(' '),
                    telefono: selectedCliente.telefono ?? '',
                    email: selectedCliente.email ?? '',
                    vendedor: selectedCliente.vendedor_id ? (usersById[selectedCliente.vendedor_id] ?? '') : '',
                  })
                }
              >
                <IconWhatsapp className="whatsapp-icon" />
              </button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => handleOpenEditForm(selectedCliente)}
              >
                Editar
              </Button>
            </div>
          ) : null
        }
      />
      <ModalRenderer />

      {/* MODAL DUPLICADOS */}
      <Modal
        open={showDuplicados}
        title={`Clientes duplicados (${duplicateGroups.length} grupos)`}
        onClose={() => setShowDuplicados(false)}
        actions={
          <Button variant="ghost" type="button" onClick={() => setShowDuplicados(false)}>
            Cerrar
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted, #6b7280)', margin: 0 }}>
            Cada grupo comparte el mismo teléfono. El primero de cada grupo (más antiguo) está marcado como <strong>Original</strong>. Elimina los duplicados que no necesites.
          </p>
          {duplicateGroups.map((group, gi) => (
            <div
              key={gi}
              style={{
                border: '1px solid #fca5a5',
                borderRadius: '0.5rem',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: '#fef2f2',
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#dc2626',
                }}
              >
                Tel: {group[0].telefono} — {group.length} registros
              </div>
              {group.map((c, idx) => {
                const name = [c.nombre, c.apellido].filter(Boolean).join(' ') || 'Sin nombre'
                const vendorName = c.vendedor_id ? (usersById[c.vendedor_id] ?? c.vendedor_id.slice(0, 8)) : '-'
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.5rem 0.75rem',
                      borderTop: idx > 0 ? '1px solid #fee2e2' : undefined,
                      background: idx === 0 ? '#fff7ed' : 'white',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        {idx === 0 && (
                          <span style={{ fontSize: '0.7rem', background: '#d1fae5', color: '#065f46', padding: '0.1rem 0.4rem', borderRadius: '9999px', marginRight: '0.4rem' }}>
                            Original
                          </span>
                        )}
                        {name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                        {vendorName} · {c.created_at ? new Date(c.created_at).toLocaleDateString('es') : '-'}
                        {c.direccion ? ` · ${c.direccion}` : ''}
                      </div>
                    </div>
                    {idx > 0 && (
                      <button
                        type="button"
                        disabled={deletingId === c.id}
                        onClick={() => handleDeleteCliente(c.id)}
                        style={{
                          padding: '0.3rem 0.75rem',
                          borderRadius: '0.375rem',
                          border: '1px solid #fca5a5',
                          background: '#fee2e2',
                          color: '#dc2626',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {deletingId === c.id ? 'Eliminando…' : 'Eliminar'}
                      </button>
                    )}
                    {idx === 0 && (
                      <button
                        type="button"
                        disabled={deletingId === c.id}
                        onClick={() => handleDeleteCliente(c.id)}
                        style={{
                          padding: '0.3rem 0.75rem',
                          borderRadius: '0.375rem',
                          border: '1px solid #e5e7eb',
                          background: 'white',
                          color: '#6b7280',
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {deletingId === c.id ? 'Eliminando…' : 'Eliminar original'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {duplicateGroups.length === 0 && (
            <p style={{ textAlign: 'center', color: '#10b981', fontWeight: 600 }}>
              ✓ No hay duplicados
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
