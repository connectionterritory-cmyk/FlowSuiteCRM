import React, { startTransition, type ChangeEvent, type ClipboardEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { DetailPanel } from '../../components/DetailPanel'
import { PersonaPerfilPanel } from '../../components/PersonaPerfilPanel'
import { ContactoTimeline } from '../../components/ContactoTimeline'
import { EmptyState } from '../../components/EmptyState'
import { IconWhatsapp } from '../../components/icons'
import { useToast } from '../../components/useToast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'
import { useViewMode } from '../../data/useViewMode'
import { useMessaging } from '../../hooks/useMessaging'
import { useModalHost } from '../../modals/useModalHost'
import {
  parseUsAddress,
  buildMapsNavUrl,
  buildTelUrl,
  formatAddressLabel,
  type ParsedAddress,
} from '../../lib/addressUtils'
import { toCanonicalContactDraft } from '../../lib/contactRefs'
import { formatProperName, formatProperText, formatStateRegion } from '../../lib/textFormat'
import { diasParaCumple } from '../telemercadeo/telemercadeoSharedUtils'

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
  ultima_fecha_pago: string | null
  activo: boolean | null
  origen: string | null
  created_at: string | null
  persona_id: string | null
  next_action: string | null
  next_action_date: string | null
  estado_operativo: string | null
  fuente_import: string | null
}

type ClienteNota = {
  id: string
  contenido: string | null
  created_at: string | null
  canal: string | null
  tipo_mensaje: string | null
  enviado_en: string | null
  mensaje: string | null
  enviado_por: string | null
}

type ServicioResumen = {
  id: string
  fecha_servicio: string | null
  hora_cita: string | null
  tipo_servicio: string | null
  observaciones: string | null
}

const CLIENTES_LIST_SELECT = [
  'id',
  'nombre',
  'apellido',
  'email',
  'telefono',
  'telefono_casa',
  'direccion',
  'ciudad',
  'estado_region',
  'codigo_postal',
  'hycite_id',
  'nivel',
  'saldo_actual',
  'monto_moroso',
  'dias_atraso',
  'estado_morosidad',
  'vendedor_id',
  'distribuidor_id',
  'fecha_nacimiento',
  'ultima_fecha_pago',
  'fecha_ultimo_pedido',
  'activo',
  'estado_cuenta',  // account status (not financial — required for filtroEstado and stats)
  'origen',
  'created_at',
  'persona_id',
  'next_action',
  'next_action_date',
  'estado_operativo',
  'fuente_import',
  // Excluded (sensitive): numero_cuenta_financiera, codigo_vendedor_hycite
].join(', ')

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
  hycite_id: '',
  numero_cuenta_financiera: '',
  saldo_actual: '',
  vendedor_id: '',
  distribuidor_id: '',
  fecha_nacimiento: '',
  estado_cuenta: 'actual',
  next_action: '',
  next_action_date: '',
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

const CLIENTE_TABLE_COLUMNS = [
  { key: 'cliente', label: 'Cliente', sortable: true },
  { key: 'telefono', label: 'Teléfono', sortable: true },
  { key: 'cuenta', label: 'Cuenta financiera', sortable: true },
  { key: 'saldo', label: 'Saldo', sortable: true },
  { key: 'monto_moroso', label: 'Monto moroso', sortable: true },
  { key: 'morosidad', label: 'Morosidad', sortable: true },
  { key: 'ciudad', label: 'Ciudad', sortable: true },
  { key: 'vendedor', label: 'Vendedor', sortable: true },
]

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

const getBirthMonth = (value: string | null): number | null => {
  if (!value) return null
  const parts = value.split('-')
  if (parts.length < 2) return null
  const month = Number(parts[1])
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month : null
}

// Segmento de atraso basado en dias_atraso
function segmentoAtraso(dias: number | null, _moroso: number | null): string {
  if (!dias || dias <= 0) return 'Al día'
  if (dias >= 91) return '+90 días'
  if (dias >= 61) return '61-90 días'
  if (dias >= 31) return '31-60 días'
  if (dias >= 1) return '0-30 días'
  return 'Al día'
}

function isMoroso(dias: number | null): boolean {
  return (dias ?? 0) > 0
}

function normalizeSearch(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeStateRegionFilter(value: string): string {
  const formatted = formatStateRegion(value)
  return formatted.trim()
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


const getClientesPermissionError = (error: { code?: string | null; message?: string | null } | null) => {
  if (!error) return null
  if (error.code === '42501') return 'Acción no permitida: solo Admin/Distribuidor puede editar clientes.'
  const message = error.message?.toLowerCase() ?? ''
  if (message.includes('row level security') || message.includes('permission denied')) {
    return 'Acción no permitida: solo Admin/Distribuidor puede editar clientes.'
  }
  return null
}

export function ClientesPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { usersById, currentRole, currentUser } = useUsers()
  const { viewMode, hasDistribuidorScope, distributionUserIds } = useViewMode()
  const navigate = useNavigate()
  const VENDEDOR_UNASSIGNED = 'sin_asignar'
  const currentUserLabel = useMemo(() => {
    if (!session?.user) return null
    const metadata = session.user.user_metadata as Record<string, string> | undefined
    const name =
      [metadata?.first_name, metadata?.last_name].filter(Boolean).join(' ').trim() ||
      metadata?.full_name ||
      metadata?.name ||
      ''
    return name || usersById[session.user.id] || session.user.email || null
  }, [session?.user, usersById])
  const isSellerView = hasDistribuidorScope && viewMode === 'seller'
  const canManageClientes = (currentRole === 'admin' || currentRole === 'distribuidor') && !isSellerView
  const canReassignVendedor = currentRole === 'supervisor_telemercadeo' && !isSellerView
  const canEditClientes = canManageClientes || canReassignVendedor
  const isReassignOnly = canReassignVendedor && !canManageClientes
  const canDelete = (currentRole === 'admin' || currentRole === 'distribuidor') && !isSellerView
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
  const [perfilPersonaId, setPerfilPersonaId] = useState<string | null>(null)
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { openGestionModal, openCitaModal } = useModalHost()
  const configured = isSupabaseConfigured
  const sessionUserId = session?.user.id ?? null

  // --- FILTROS ---
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroAtraso, setFiltroAtraso] = useState('todos')
  const [filtroVendedor, setFiltroVendedor] = useState('todos')
  const [filtroCiudad, setFiltroCiudad] = useState('')
  const [filtroEstadoRegion, setFiltroEstadoRegion] = useState('')
  const [estadoRegionExact, setEstadoRegionExact] = useState(true)
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() =>
    CLIENTE_TABLE_COLUMNS.reduce<Record<string, boolean>>((acc, col) => {
      acc[col.key] = true
      return acc
    }, {})
  )
  const [filtroCodigoPostal, setFiltroCodigoPostal] = useState('')
  const [filtroEstadoOperativo, setFiltroEstadoOperativo] = useState('todos')
  const [filtroMesCumple, setFiltroMesCumple] = useState('todos')
  const [filtroCartuchos, setFiltroCartuchos] = useState<'todos' | 'vencidos' | 'proximos_30'>('todos')
  const [filtroFuenteImport, setFiltroFuenteImport] = useState('todos')
  const [cartuchosVencidosIds, setCartuchosVencidosIds] = useState<Set<string>>(new Set())
  const [cartuchosProximosIds, setCartuchosProximosIds] = useState<Set<string>>(new Set())
  const [filtrosVisible, setFiltrosVisible] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 720)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [detailCliente, setDetailCliente] = useState<ClienteRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [clienteNotas, setClienteNotas] = useState<ClienteNota[]>([])
  const [notasLoading, setNotasLoading] = useState(false)
  const [clienteServicios, setClienteServicios] = useState<ServicioResumen[]>([])
  const [serviciosLoading, setServiciosLoading] = useState(false)
  const [detailTab, setDetailTab] = useState<'info' | 'notas' | 'historial' | 'cartera' | 'servicios'>('info')
  const [assignableUsers, setAssignableUsers] = useState<Array<{ id: string; label: string; rol: string | null }>>([])
  const [citaAssignedOptions, setCitaAssignedOptions] = useState<Array<{ id: string; label: string }>>([])
  const [editingNextAction, setEditingNextAction] = useState(false)
  const [nextActionDraft, setNextActionDraft] = useState('')
  const [nextActionDateDraft, setNextActionDateDraft] = useState('')
  const [savingNextAction, setSavingNextAction] = useState(false)

  const loadClientes = useCallback(async () => {
    if (!configured || !sessionUserId || !currentRole) return
    setLoading(true)
    const userId = sessionUserId
    setError(null)
    const buildQuery = (from: number) => {
      let q = supabase
        .from('clientes')
        .select(CLIENTES_LIST_SELECT)
        .order('created_at', { ascending: false })
        .range(from, from + 999)
      if (isSellerView || currentRole === 'vendedor') {
        q = q.eq('vendedor_id', userId)
      } else if (currentRole === 'admin') {
        // ADMIN_SCOPE: ALL | SELF
        // Default (single-tenant): admin sees ALL clients — no vendedor_id filter applied.
        // To restrict admin to their distributor scope, replace with:
        // const teamIds = distributionUserIds.length > 0 ? distributionUserIds : [userId]
        // q = q.in('vendedor_id', teamIds)
      } else if (currentRole === 'distribuidor' || currentRole === 'supervisor_telemercadeo') {
        // Distribuidor y supervisor_telemercadeo ven todos los clientes (sin filtro de vendedor).
      } else if (hasDistribuidorScope && viewMode === 'distributor') {
        const teamIds = distributionUserIds.length > 0 ? distributionUserIds : [userId]
        const teamFilter = teamIds.length > 0
          ? `vendedor_id.in.(${teamIds.join(',')})`
          : `vendedor_id.eq.${userId}`
        q = q.or(`distribuidor_id.eq.${userId},${teamFilter}`)
      }
      return q
    }

    let allData: ClienteRecord[] = []
    let page = 0
    while (true) {
      const { data, error: fetchError } = await buildQuery(page * 1000)
      if (fetchError) {
        setError(fetchError.message)
        setClientes([])
        setLoading(false)
        return
      }
      allData = [...allData, ...((data ?? []) as unknown as ClienteRecord[])]
      if ((data ?? []).length < 1000) break
      page++
    }
    setClientes(allData)
    setLoading(false)
  }, [configured, currentRole, distributionUserIds, hasDistribuidorScope, isSellerView, sessionUserId, viewMode])

  useEffect(() => {
    if (!configured) return
    const handle = window.setTimeout(() => {
      void loadClientes()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [configured, loadClientes])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 720)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // --- CARTUCHOS: carga IDs de clientes con componentes vencidos o próximos ---
  useEffect(() => {
    if (!configured) return
    const today = new Date().toISOString().split('T')[0]
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

    type CartuchoRow = { equipo?: { cliente?: { id: string } | null } | null }

    const extractIds = (rows: CartuchoRow[]): Set<string> => {
      const ids = new Set<string>()
      for (const row of rows) {
        const id = row.equipo?.cliente?.id
        if (id) ids.add(id)
      }
      return ids
    }

    void (async () => {
      const [{ data: vData }, { data: pData }] = await Promise.all([
        supabase
          .from('componentes_equipo')
          .select('equipo:equipos_instalados(cliente:clientes(id))')
          .eq('activo', true)
          .not('fecha_proximo_cambio', 'is', null)
          .lte('fecha_proximo_cambio', today),
        supabase
          .from('componentes_equipo')
          .select('equipo:equipos_instalados(cliente:clientes(id))')
          .eq('activo', true)
          .not('fecha_proximo_cambio', 'is', null)
          .gt('fecha_proximo_cambio', today)
          .lte('fecha_proximo_cambio', in30),
      ])
      setCartuchosVencidosIds(extractIds((vData ?? []) as CartuchoRow[]))
      setCartuchosProximosIds(extractIds((pData ?? []) as CartuchoRow[]))
    })()
  }, [configured])

  useEffect(() => {
    if (!configured || !currentUser) return
    let active = true
    const loadAssignableUsers = async () => {
      let query = supabase
        .from('usuarios')
        .select('id, nombre, apellido, rol, activo, codigo_vendedor, codigo_distribuidor, organizacion')
      if (currentUser.organizacion) {
        query = query.eq('organizacion', currentUser.organizacion)
      } else {
        query = query.is('organizacion', null)
      }
      const { data, error } = await query
      if (!active) return
      if (error) {
        setAssignableUsers([])
        return
      }
      const base = ((data as Array<{
        id: string
        nombre: string | null
        apellido: string | null
        rol: string | null
        activo: boolean | null
        codigo_vendedor?: string | null
        codigo_distribuidor?: string | null
      }>) ?? [])
        .filter((user) => (user.rol === 'vendedor' || user.rol === 'distribuidor') && user.activo !== false)
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
      if (currentUser.id && !byId.has(currentUser.id)) {
        const label = [currentUser.nombre, currentUser.apellido].filter(Boolean).join(' ').trim() || currentUser.id
        byId.set(currentUser.id, { id: currentUser.id, label, rol: currentUser.rol ?? null })
      }
      setAssignableUsers(Array.from(byId.values()))
    }
    void loadAssignableUsers()
    return () => {
      active = false
    }
  }, [configured, currentUser])

  useEffect(() => {
    if (!configured || !sessionUserId || !currentRole) return
    let active = true
    const loadCitaAssignedOptions = async () => {
      if (currentRole === 'admin' || currentRole === 'distribuidor') {
        let query = supabase
          .from('usuarios')
          .select('id, nombre, apellido, email')
          .eq('activo', true)
        if (hasDistribuidorScope && distributionUserIds.length > 0) {
          query = query.in('id', distributionUserIds)
        }
        const { data, error } = await query
        if (!active) return
        if (error) {
          setCitaAssignedOptions([{ id: sessionUserId, label: 'Yo' }])
          return
        }
        const options = (data ?? []).map((row) => {
          const name = [row.nombre, row.apellido].filter(Boolean).join(' ').trim()
          return {
            id: row.id,
            label: name || row.email || row.id,
          }
        })
        setCitaAssignedOptions(options.length > 0 ? options : [{ id: sessionUserId, label: 'Yo' }])
        return
      }

      if (currentRole === 'telemercadeo') {
        const { data: assignments } = await supabase
          .from('tele_vendedor_assignments')
          .select('vendedor_id')
          .eq('tele_id', sessionUserId)
        if (!active) return
        const vendedorIds = (assignments ?? []).map((a: { vendedor_id: string }) => a.vendedor_id)
        if (vendedorIds.length > 0) {
          const { data: vendedores } = await supabase
            .from('usuarios')
            .select('id, nombre, apellido, email')
            .in('id', vendedorIds)
            .eq('activo', true)
          if (!active) return
          const options = [
            { id: sessionUserId, label: 'Yo' },
            ...(vendedores ?? []).map((row: { id: string; nombre: string | null; apellido: string | null; email: string | null }) => ({
              id: row.id,
              label: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || row.email || row.id,
            })),
          ]
          setCitaAssignedOptions(options)
          return
        }
      }

      if (currentRole === 'supervisor_telemercadeo') {
        const { data } = await supabase
          .from('usuarios')
          .select('id, nombre, apellido, email')
          .eq('activo', true)
        if (!active) return
        const options = (data ?? []).map((row: { id: string; nombre: string | null; apellido: string | null; email: string | null }) => ({
          id: row.id,
          label: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || row.email || row.id,
        }))
        setCitaAssignedOptions(options.length > 0 ? options : [{ id: sessionUserId, label: 'Yo' }])
        return
      }

      setCitaAssignedOptions([{ id: sessionUserId, label: 'Yo' }])
    }
    void loadCitaAssignedOptions()
    return () => {
      active = false
    }
  }, [configured, currentRole, distributionUserIds, hasDistribuidorScope, sessionUserId])

  // --- VENDEDORES UNICOS para el filtro ---
  const getClienteVendedorLabel = useCallback(
    (userId: string | null) => {
      if (!userId) return 'Sin asignar'
      if (userId === sessionUserId && currentUserLabel) return currentUserLabel
      return usersById[userId] ?? 'Sin nombre'
    },
    [currentUserLabel, sessionUserId, usersById]
  )

  const getClienteResponsableId = useCallback(
    (cliente: ClienteRecord) => cliente.vendedor_id ?? cliente.distribuidor_id ?? null,
    [],
  )

  const getClienteVendedorKey = useCallback(
    (cliente: ClienteRecord) => getClienteResponsableId(cliente) ?? VENDEDOR_UNASSIGNED,
    [getClienteResponsableId],
  )

  const vendedoresUnicos = useMemo(() => {
    const ids = [...new Set(clientes.map((c) => getClienteVendedorKey(c)))] as string[]
    return ids.map((id) => ({
      id,
      nombre: id === VENDEDOR_UNASSIGNED ? 'Sin asignar' : getClienteVendedorLabel(id),
    }))
  }, [clientes, getClienteVendedorKey, getClienteVendedorLabel])

  const fuentesUnicas = useMemo(() => {
    const vals = [...new Set(clientes.map((c) => c.fuente_import).filter(Boolean))] as string[]
    return vals.sort()
  }, [clientes])

  // --- FILTRADO ---
  const clientesFiltrados = useMemo(() => {
    return clientes.filter((c) => {
      const fullName = normalizeSearch(`${c.nombre ?? ''} ${c.apellido ?? ''}`)
      const tel = c.telefono ?? ''
      const cuenta = c.hycite_id ?? ''
      const busquedaNorm = normalizeSearch(busqueda)
      const matchBusqueda =
        !busquedaNorm ||
        fullName.includes(busquedaNorm) ||
        tel.includes(busquedaNorm) ||
        cuenta.includes(busquedaNorm)

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

      const matchVendedor = filtroVendedor === 'todos' || getClienteVendedorKey(c) === filtroVendedor
      const matchCiudad =
        !filtroCiudad || (c.ciudad ?? '').toLowerCase().includes(filtroCiudad.toLowerCase())
      const estadoRegionFilter = normalizeStateRegionFilter(filtroEstadoRegion)
      const estadoRegionValue = normalizeStateRegionFilter(c.estado_region ?? '')
      const matchEstadoRegion =
        !estadoRegionFilter ||
        (estadoRegionExact
          ? estadoRegionValue === estadoRegionFilter
          : estadoRegionValue.includes(estadoRegionFilter))
      const matchCodigoPostal =
        !filtroCodigoPostal || (c.codigo_postal ?? '').toLowerCase().includes(filtroCodigoPostal.toLowerCase())

      const matchEstadoOperativo =
        filtroEstadoOperativo === 'todos' || c.estado_operativo === filtroEstadoOperativo

      const birthMonth = getBirthMonth(c.fecha_nacimiento)
      const matchCumple =
        filtroMesCumple === 'todos' ||
        (filtroMesCumple === 'hoy' && c.fecha_nacimiento && diasParaCumple(c.fecha_nacimiento) === 0) ||
        (filtroMesCumple === 'mes_actual' && birthMonth === new Date().getMonth() + 1) ||
        (filtroMesCumple.startsWith('mes_') &&
          birthMonth === Number(filtroMesCumple.replace('mes_', '')))

      const matchCartuchos =
        filtroCartuchos === 'todos' ||
        (filtroCartuchos === 'vencidos' && cartuchosVencidosIds.has(c.id)) ||
        (filtroCartuchos === 'proximos_30' && cartuchosProximosIds.has(c.id))

      const matchFuenteImport =
        filtroFuenteImport === 'todos' ||
        (filtroFuenteImport === '_sin_fuente' ? !c.fuente_import : c.fuente_import === filtroFuenteImport)

      return (
        matchBusqueda &&
        matchAtraso &&
        matchEstado &&
        matchVendedor &&
        matchCiudad &&
        matchEstadoRegion &&
        matchCodigoPostal &&
        matchEstadoOperativo &&
        matchCumple &&
        matchCartuchos &&
        matchFuenteImport
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
    estadoRegionExact,
    filtroCodigoPostal,
    filtroEstadoOperativo,
    filtroMesCumple,
    filtroCartuchos,
    filtroFuenteImport,
    cartuchosVencidosIds,
    cartuchosProximosIds,
    getClienteVendedorKey,
  ])

  const visibleColumns = useMemo(
    () => CLIENTE_TABLE_COLUMNS.filter((col) => columnVisibility[col.key]),
    [columnVisibility]
  )

  const visibleSortableColumns = useMemo(
    () => visibleColumns.flatMap((col, idx) => (col.sortable ? [idx] : [])),
    [visibleColumns]
  )

  const sortColIndex = useMemo(() => {
    if (!sortKey) return -1
    return visibleColumns.findIndex((col) => col.key === sortKey)
  }, [sortKey, visibleColumns])

  useEffect(() => {
    if (sortKey && !columnVisibility[sortKey]) {
      setSortKey(null)
    }
  }, [columnVisibility, sortKey])

  // --- ORDENACION ---
  const handleSort = (colIndex: number) => {
    const colKey = visibleColumns[colIndex]?.key ?? null
    if (!colKey) return
    if (sortKey === colKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(colKey)
      setSortDir('asc')
    }
  }

  const clientesOrdenados = useMemo(() => {
    if (!sortKey) return clientesFiltrados
    return [...clientesFiltrados].sort((a, b) => {
      let valA: string | number = 0
      let valB: string | number = 0
      if (sortKey === 'cliente') {
        valA = `${a.nombre ?? ''} ${a.apellido ?? ''}`.toLowerCase()
        valB = `${b.nombre ?? ''} ${b.apellido ?? ''}`.toLowerCase()
      } else if (sortKey === 'telefono') {
        valA = (a.telefono ?? '').replace(/\D/g, '')
        valB = (b.telefono ?? '').replace(/\D/g, '')
      } else if (sortKey === 'cuenta') {
        valA = (a.hycite_id ?? '').toLowerCase()
        valB = (b.hycite_id ?? '').toLowerCase()
      } else if (sortKey === 'saldo') {
        valA = a.saldo_actual ?? 0
        valB = b.saldo_actual ?? 0
      } else if (sortKey === 'monto_moroso') {
        valA = a.monto_moroso ?? 0
        valB = b.monto_moroso ?? 0
      } else if (sortKey === 'morosidad') {
        valA = a.dias_atraso ?? 0
        valB = b.dias_atraso ?? 0
      } else if (sortKey === 'ciudad') {
        valA = (a.ciudad ?? '').toLowerCase()
        valB = (b.ciudad ?? '').toLowerCase()
      } else if (sortKey === 'vendedor') {
        valA = getClienteVendedorLabel(getClienteVendedorKey(a)).toLowerCase()
        valB = getClienteVendedorLabel(getClienteVendedorKey(b)).toLowerCase()
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [clientesFiltrados, sortDir, sortKey, getClienteVendedorKey, getClienteVendedorLabel])

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
    if (!canDelete) {
      showToast('Solo Admin/Distribuidor puede eliminar clientes.', 'error')
      return
    }
    setDeletingId(id)
    const { error: delError } = await supabase.from('clientes').delete().eq('id', id)
    if (delError) {
      showToast(getClientesPermissionError(delError) ?? delError.message, 'error')
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
      alDia: clientes.filter((c) => !isMoroso(c.dias_atraso)).length,
      conMoroso: clientes.filter((c) => isMoroso(c.dias_atraso)).length,
      cancelados: clientes.filter((c) => c.estado_cuenta === 'cancelacion_total').length,
      cumpleHoy: clientes.filter((c) => c.fecha_nacimiento && diasParaCumple(c.fecha_nacimiento) === 0).length,
      cartuchosVencidos: clientes.filter((c) => cartuchosVencidosIds.has(c.id)).length,
      cartuchosProximos: clientes.filter((c) => cartuchosProximosIds.has(c.id)).length,
    }),
    [clientes, cartuchosVencidosIds, cartuchosProximosIds]
  )

  // --- ROWS ---
  const rows = useMemo<DataTableRow[]>(() => {
    return clientesOrdenados.map((cliente) => {
      const fullName = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || '-'
      const vendedorName = getClienteVendedorLabel(getClienteResponsableId(cliente))
      const vendedorDisplay = vendedorName !== '-' ? vendedorName : (cliente.codigo_vendedor_hycite ?? '-')
      const cuenta = cliente.hycite_id ?? cliente.numero_cuenta_financiera ?? '-'
      const segmento = segmentoAtraso(cliente.dias_atraso, cliente.monto_moroso)
      const telefonoDisplay = cliente.telefono ?? cliente.telefono_casa ?? '-'

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

      const ciudadDisplay = cliente.ciudad ?? '-'

      const saldoDisplay = cliente.saldo_actual ? `$${Number(cliente.saldo_actual).toFixed(2)}` : '-'
      const montoMorosoDisplay = (cliente.monto_moroso ?? 0) > 0 ? `$${Number(cliente.monto_moroso).toFixed(2)}` : '-'

      const cellMap: Record<string, React.ReactNode> = {
        cliente: fullName,
        telefono: telefonoDisplay,
        cuenta,
        saldo: saldoDisplay,
        monto_moroso: montoMorosoDisplay,
        morosidad: morosidadBadge,
        ciudad: ciudadDisplay,
        vendedor: vendedorDisplay,
      }

      return {
        id: cliente.id,
        cells: visibleColumns.map((col) => cellMap[col.key]),
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
              const mapsUrl = buildMapsNavUrl({
                direccion: cliente.direccion,
                ciudad: cliente.ciudad,
                estado_region: cliente.estado_region,
                codigo_postal: cliente.codigo_postal,
              })
              const addr = formatAddressLabel({
                direccion: cliente.direccion,
                ciudad: cliente.ciudad,
                estado_region: cliente.estado_region,
                codigo_postal: cliente.codigo_postal,
              })
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
          { label: 'Estado / Prov (Dirección)', value: cliente.estado_region ?? '-' },
          { label: 'Codigo postal', value: cliente.codigo_postal ?? '-' },
          { label: 'Cuenta Hycite', value: cliente.hycite_id ?? '-' },
          { label: 'Cuenta financiera', value: cliente.numero_cuenta_financiera ?? '-' },
          { label: 'Saldo actual', value: cliente.saldo_actual ? `$${Number(cliente.saldo_actual).toFixed(2)}` : '-' },
          { label: 'Monto moroso', value: cliente.monto_moroso ? `$${Number(cliente.monto_moroso).toFixed(2)}` : '-' },
          { label: 'Dias de atraso', value: segmento },
          { label: 'Nivel', value: cliente.nivel ? String(cliente.nivel) : '-' },
          { label: 'Estado cuenta', value: cliente.estado_cuenta ?? '-' },
          { label: 'Ultimo pedido', value: cliente.fecha_ultimo_pedido ?? '-' },
          { label: 'Vendedor', value: vendedorName },
          { label: 'Codigo vendedor', value: cliente.codigo_vendedor_hycite ?? '-' },
          { label: 'Origen', value: cliente.origen ?? '-' },
        ],
      }
    })
  }, [clientesOrdenados, getClienteResponsableId, getClienteVendedorLabel, openWhatsapp, visibleColumns])

  const selectedCliente = selectedRow ? clientes.find((c) => c.id === selectedRow.id) ?? null : null
  const selectedClienteDetail = detailCliente ?? selectedCliente
  const editingCliente = editingId ? clientes.find((c) => c.id === editingId) ?? null : null

  useEffect(() => {
    if (!configured || !selectedRow?.id) {
      startTransition(() => {
        setDetailCliente(null)
        setClienteNotas([])
        setClienteServicios([])
        setServiciosLoading(false)
      })
      return
    }
    let active = true
    startTransition(() => {
      setDetailLoading(true)
      setNotasLoading(true)
      setServiciosLoading(true)
      setDetailTab('info')
    })
    const loadDetail = async () => {
      const [detailRes, notasRes, serviciosRes] = await Promise.all([
        supabase
          .from('clientes')
          .select(
            'id, nombre, apellido, email, telefono, telefono_casa, direccion, ciudad, estado_region, codigo_postal, hycite_id, numero_cuenta_financiera, saldo_actual, monto_moroso, dias_atraso, estado_morosidad, nivel, vendedor_id, distribuidor_id, fecha_nacimiento, ultima_fecha_pago, fecha_ultimo_pedido, estado_cuenta, codigo_vendedor_hycite, origen, persona_id, next_action, next_action_date',
          )
          .eq('id', selectedRow.id)
          .maybeSingle(),
        supabase
          .from('notasrp')
          .select('id, contenido, created_at, canal, tipo_mensaje, enviado_en, mensaje, enviado_por')
          .eq('cliente_id', selectedRow.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('servicios')
          .select('id, fecha_servicio, hora_cita, tipo_servicio, observaciones')
          .eq('cliente_id', selectedRow.id)
          .order('fecha_servicio', { ascending: false })
          .order('hora_cita', { ascending: false, nullsFirst: false })
          .limit(3),
      ])
      if (!active) return
      if (detailRes.error) {
        setDetailCliente(null)
      } else {
        setDetailCliente((detailRes.data as ClienteRecord | null) ?? null)
      }
      if (notasRes.error) {
        setClienteNotas([])
      } else {
        setClienteNotas((notasRes.data as ClienteNota[]) ?? [])
      }
      if (serviciosRes.error) {
        setClienteServicios([])
      } else {
        setClienteServicios((serviciosRes.data as ServicioResumen[]) ?? [])
      }
      setDetailLoading(false)
      setNotasLoading(false)
      setServiciosLoading(false)
    }
    const handle = window.setTimeout(() => {
      void loadDetail()
    }, 0)
    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [configured, selectedRow?.id])

  const emptyLabel = loading ? t('common.loading') : 'Sin resultados'

  const notasContent = notasLoading ? (
    <span style={{ color: 'var(--color-text-muted, #6b7280)' }}>Cargando...</span>
  ) : clienteNotas.length === 0 ? (
    <span style={{ color: 'var(--color-text-muted, #6b7280)' }}>Sin notas</span>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {clienteNotas.map((nota) => {
        const senderName = nota.enviado_por ? usersById[nota.enviado_por] ?? '' : ''
        const when = nota.enviado_en || nota.created_at
        const typeLabel = nota.tipo_mensaje ? nota.tipo_mensaje.replace(/_/g, ' ') : 'general'
        return (
          <div
            key={nota.id}
            style={{
              border: '1px solid rgba(148,163,184,0.2)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.6rem',
              background: 'rgba(15,23,42,0.04)',
            }}
          >
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)' }}>
              {(nota.canal || 'mensaje').toString().toUpperCase()} · {typeLabel}
              {senderName ? ` · ${senderName}` : ''}
              {when ? ` · ${new Date(when).toLocaleString('es')}` : ''}
            </div>
            <div style={{ marginTop: '0.2rem', fontSize: '0.8rem' }}>
              {nota.mensaje || nota.contenido || '-'}
            </div>
          </div>
        )
      })}
    </div>
  )

  const formatDateValue = (value: string | null) => {
    if (!value) return '-'
    const dateValue = value.includes('T') ? value : `${value}T00:00:00`
    return new Date(dateValue).toLocaleDateString('es')
  }

  const copyToClipboard = useCallback((text: string, label = 'Copiado') => {
    void navigator.clipboard.writeText(text).then(() => showToast(label))
  }, [showToast])

  const saveNextAction = useCallback(async () => {
    if (!selectedClienteDetail || savingNextAction) return
    setSavingNextAction(true)
    const { error } = await supabase
      .from('clientes')
      .update({
        next_action: nextActionDraft.trim() || null,
        next_action_date: nextActionDateDraft || null,
      })
      .eq('id', selectedClienteDetail.id)
    setSavingNextAction(false)
    if (error) { showToast(`Error: ${error.message}`, 'error'); return }
    setDetailCliente((prev) =>
      prev ? { ...prev, next_action: nextActionDraft.trim() || null, next_action_date: nextActionDateDraft || null } : prev,
    )
    setEditingNextAction(false)
    showToast('Próxima acción actualizada')
  }, [nextActionDraft, nextActionDateDraft, savingNextAction, selectedClienteDetail, showToast])

  const riskChip = (diasAtraso: number | null, montoMoroso: number | null) => {
    if (!montoMoroso || montoMoroso === 0) return { color: '#10b981', bg: '#d1fae5', label: 'Al día' }
    if (!diasAtraso || diasAtraso <= 30) return { color: '#f59e0b', bg: '#fef3c7', label: `${diasAtraso ?? 0}d mora` }
    if (diasAtraso <= 60) return { color: '#f97316', bg: '#ffedd5', label: `${diasAtraso}d mora` }
    if (diasAtraso <= 90) return { color: '#ef4444', bg: '#fee2e2', label: `${diasAtraso}d mora` }
    return { color: '#7c3aed', bg: '#ede9fe', label: `+90d mora` }
  }

  const noReg = <span style={{ color: 'var(--color-text-muted, #9ca3af)', fontStyle: 'italic', fontSize: '0.82rem' }}>No registrado</span>

  // micro-style helpers for detail panel v2 (avoids repeating inline objects)
  const chip = (color: string, bg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.6rem',
    borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 600,
    background: bg, color, border: `1px solid ${color}33`, whiteSpace: 'nowrap',
  })
  const blockTitle: React.CSSProperties = {
    margin: 0, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--color-muted, #9ca3af)',
  }
  const fieldLbl: React.CSSProperties = {
    display: 'block', fontSize: '0.72rem', color: 'var(--color-muted, #9ca3af)',
    marginBottom: '0.1rem', fontWeight: 500,
  }
  const fieldVal: React.CSSProperties = { fontSize: '0.86rem', color: 'var(--color-text)' }
  const inlineBtn = (color: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.5rem',
    borderRadius: '9999px', border: `1px solid ${color}44`, background: `${color}11`,
    color, cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600, textDecoration: 'none',
  })

  const serviciosContent = serviciosLoading ? (
    <span style={{ color: 'var(--color-text-muted, #6b7280)' }}>Cargando...</span>
  ) : clienteServicios.length === 0 ? (
    <span style={{ color: 'var(--color-text-muted, #6b7280)' }}>Sin servicios recientes</span>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {clienteServicios.map((servicio) => {
        const fecha = servicio.fecha_servicio ? formatDateValue(servicio.fecha_servicio) : '-'
        const hora = servicio.hora_cita ?? ''
        const tipo = servicio.tipo_servicio ? servicio.tipo_servicio.replace(/_/g, ' ') : 'Servicio'
        const observaciones = servicio.observaciones ?? ''
        return (
          <div
            key={servicio.id}
            style={{
              border: '1px solid rgba(148,163,184,0.2)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.6rem',
              background: 'rgba(15,23,42,0.04)',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>
              {fecha}{hora ? ` · ${hora}` : ''} · {tipo}
            </div>
            <div style={{ marginTop: '0.2rem', fontSize: '0.82rem' }}>
              {observaciones.length > 60 ? `${observaciones.slice(0, 60)}…` : (observaciones || 'Sin notas')}
            </div>
          </div>
        )
      })}
      <div>
        <Button variant="ghost" type="button" onClick={() => navigate('/servicio-cliente')}>
          Ver todos los servicios
        </Button>
      </div>
    </div>
  )

  const handleOpenForm = () => {
    if (!canManageClientes) {
      showToast('Solo Admin/Distribuidor puede crear clientes.', 'error')
      return
    }
    setEditingId(null)
    setFormValues({ ...initialForm, vendedor_id: session?.user.id ?? '' })
    setBirthMonth('')
    setBirthDay('')
    setFormError(null)
    setFormOpen(true)
  }

  const handleOpenEditForm = (cliente: ClienteRecord) => {
    if (!canEditClientes) {
      showToast('No tienes permisos para editar clientes.', 'error')
      return
    }
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
      hycite_id: cliente.hycite_id ?? '',
      numero_cuenta_financiera: cliente.numero_cuenta_financiera ?? '',
      saldo_actual: cliente.saldo_actual != null ? String(cliente.saldo_actual) : '',
      vendedor_id: cliente.vendedor_id ?? '',
      distribuidor_id: cliente.distribuidor_id ?? '',
      fecha_nacimiento: cliente.fecha_nacimiento ?? '',
      estado_cuenta: cliente.estado_cuenta ?? 'actual',
      next_action: cliente.next_action ?? '',
      next_action_date: cliente.next_action_date ?? '',
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
    ? getClienteVendedorLabel(formValues.vendedor_id || null)
    : vendedorName

  const vendorSelectOptions = useMemo(() => {
    const base = assignableUsers
    const currentId = formValues.vendedor_id
    if (currentId && !base.some((u) => u.id === currentId)) {
      return [
        ...base,
        { id: currentId, label: usersById[currentId] || currentId, rol: null },
      ]
    }
    return base
  }, [assignableUsers, formValues.vendedor_id, usersById])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canEditClientes) {
      showToast('No tienes permisos para editar clientes.', 'error')
      return
    }
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const toNull = (v: string) => (v.trim() === '' ? null : v.trim())
    if (isReassignOnly && !editingId) {
      setFormError('No tienes permisos para crear clientes.')
      setSubmitting(false)
      return
    }
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
    const canonicalDraft = toCanonicalContactDraft({
      nombre: formatProperName(formValues.nombre),
      apellido: formatProperName(formValues.apellido),
      email: formValues.email,
      telefono: formValues.telefono,
      direccion: formatProperText(formValues.direccion),
      ciudad: formatProperText(formValues.ciudad),
      estado_region: formatStateRegion(formValues.estado_region),
      codigo_postal: formValues.codigo_postal,
    })
    const basePayload = {
      nombre: toNull(canonicalDraft.nombre),
      apellido: canonicalDraft.apellido,
      email: canonicalDraft.email,
      telefono: canonicalDraft.telefono,
      telefono_casa: toNull(formValues.telefono_casa),
      direccion: canonicalDraft.direccion,
      ciudad: canonicalDraft.ciudad,
      estado_region: canonicalDraft.estado_region,
      codigo_postal: canonicalDraft.codigo_postal,
      hycite_id: toNull(formValues.hycite_id),
      numero_cuenta_financiera: toNull(formValues.numero_cuenta_financiera),
      saldo_actual: formValues.saldo_actual === '' ? 0 : Number(formValues.saldo_actual),
      vendedor_id: toNull(formValues.vendedor_id),
      distribuidor_id: toNull(formValues.distribuidor_id),
      fecha_nacimiento: birthDate,
      estado_cuenta: formValues.estado_cuenta,
      activo: formValues.estado_cuenta === 'actual',
      next_action: toNull(formValues.next_action as string),
      next_action_date: toNull(formValues.next_action_date as string),
    }
    const payload = isReassignOnly ? { vendedor_id: toNull(formValues.vendedor_id) } : basePayload
    const { error: opError } = editingId
      ? await supabase.from('clientes').update(payload).eq('id', editingId)
      : await supabase.from('clientes').insert({
        ...payload,
        vendedor_id: (payload as { vendedor_id?: string | null }).vendedor_id ?? session?.user.id ?? null,
        origen: 'manual',
      })
    if (opError) {
      const permissionMessage = getClientesPermissionError(opError)
      const errorMessage = permissionMessage ?? opError.message
      setFormError(errorMessage)
      showToast(errorMessage, 'error')
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
    setFormValues((prev) => ({ ...prev, [field]: formatProperName(prev[field] as string) }))
  }

  const handleFormatText = (field: 'direccion' | 'ciudad') => () => {
    setFormValues((prev) => ({ ...prev, [field]: formatProperText(prev[field] as string) }))
  }

  const handleFormatState = () => {
    setFormValues((prev) => ({ ...prev, estado_region: formatStateRegion(prev.estado_region as string) }))
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
    setFiltroEstadoOperativo('todos')
    setFiltroMesCumple('todos')
    setFiltroCartuchos('todos')
    setFiltroFuenteImport('todos')
    setEstadoRegionExact(true)
  }

  const exportarCSV = () => {
    const headers = [
      'Nombre', 'Apellido', 'Telefono', 'Email', 'Cuenta Hycite',
      'Ciudad', 'Estado', 'ZIP',
      'Saldo', 'Monto Moroso', 'Dias Atraso', 'Estado Cuenta', 'Vendedor',
    ]
    const csvRows = clientesFiltrados.map((c) => [
      c.nombre ?? '',
      c.apellido ?? '',
      c.telefono ?? '',
      c.email ?? '',
      c.hycite_id ?? '',
      c.ciudad ?? '',
      c.estado_region ?? '',
      c.codigo_postal ?? '',
      c.saldo_actual ?? 0,
      c.monto_moroso ?? 0,
      c.dias_atraso ?? 0,
      c.estado_cuenta ?? '',
      getClienteVendedorLabel(getClienteResponsableId(c)),
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
    filtroCodigoPostal ||
    filtroEstadoOperativo !== 'todos' ||
    filtroMesCumple !== 'todos' ||
    filtroCartuchos !== 'todos' ||
    filtroFuenteImport !== 'todos'

  const cantFiltrosActivos = [
    busqueda,
    filtroEstado !== 'todos' ? '1' : '',
    filtroAtraso !== 'todos' ? '1' : '',
    filtroVendedor !== 'todos' ? '1' : '',
    filtroCiudad,
    filtroEstadoRegion,
    filtroCodigoPostal,
    filtroEstadoOperativo !== 'todos' ? '1' : '',
    filtroMesCumple !== 'todos' ? '1' : '',
    filtroCartuchos !== 'todos' ? '1' : '',
    filtroFuenteImport !== 'todos' ? '1' : '',
  ].filter(Boolean).length

  const handleOpenDuplicados = () => {
    if (!canManageClientes) {
      showToast('Solo Admin/Distribuidor puede gestionar duplicados.', 'error')
      return
    }
    setShowDuplicados(true)
  }

  if (!configured) {
    return <EmptyState title={t('dashboard.missingConfigTitle')} description={t('dashboard.missingConfigDescription')} />
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('clientes.title')}
        subtitle={t('clientes.subtitle')}
        action={
          canManageClientes ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {duplicateGroups.length > 0 && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={handleOpenDuplicados}
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
          ) : undefined
        }
      />

      {/* ESTADISTICAS — tarjetas clickables */}
      <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total clientes', value: stats.total, color: '#3b82f6', active: !hayFiltros, onClick: limpiarFiltros },
          { label: 'Al día', value: stats.alDia, color: '#10b981', active: filtroAtraso === 'al_dia', onClick: () => { limpiarFiltros(); setFiltroAtraso('al_dia') } },
          { label: 'Con morosidad', value: stats.conMoroso, color: '#f59e0b', active: filtroAtraso === 'con_moroso', onClick: () => { limpiarFiltros(); setFiltroAtraso('con_moroso') } },
          { label: 'Cancelados', value: stats.cancelados, color: '#6b7280', active: filtroEstado === 'cancelacion_total', onClick: () => { limpiarFiltros(); setFiltroEstado('cancelacion_total') } },
          ...(stats.cumpleHoy > 0 ? [{ label: '🎂 Cumpleaños hoy', value: stats.cumpleHoy, color: '#8b5cf6', active: filtroMesCumple === 'hoy', onClick: () => { limpiarFiltros(); setFiltroMesCumple('hoy') } }] : []),
          ...(stats.cartuchosVencidos > 0 ? [{ label: '🔴 Filtros vencidos', value: stats.cartuchosVencidos, color: '#ef4444', active: filtroCartuchos === 'vencidos', onClick: () => { limpiarFiltros(); setFiltroCartuchos('vencidos') } }] : []),
          ...(stats.cartuchosProximos > 0 ? [{ label: '🟡 Filtros próximos', value: stats.cartuchosProximos, color: '#f97316', active: filtroCartuchos === 'proximos_30', onClick: () => { limpiarFiltros(); setFiltroCartuchos('proximos_30') } }] : []),
        ].map((s) => (
          <div
            key={s.label}
            role="button"
            tabIndex={0}
            onClick={s.onClick}
            onKeyDown={(e) => e.key === 'Enter' && s.onClick()}
            title="Click para filtrar"
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '0.625rem 1rem',
              background: s.active ? `${s.color}15` : 'var(--color-surface, #f9fafb)',
              borderRadius: '0.5rem',
              border: `1px solid ${s.active ? s.color : 'var(--color-border, #e5e7eb)'}`,
              borderLeft: `3px solid ${s.color}`,
              cursor: 'pointer',
              minWidth: '110px',
              transition: 'box-shadow 0.15s',
            }}
          >
            <span style={{ fontSize: '1.375rem', fontWeight: 700, color: s.color, lineHeight: 1.2 }}>{s.value}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginTop: '0.2rem', whiteSpace: 'nowrap' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* BARRA DE BÚSQUEDA + CONTEO */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted, #9ca3af)', fontSize: '0.9rem', pointerEvents: 'none' }}>
            🔍
          </span>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, teléfono, cuenta Hycite..."
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem 0.625rem 2.25rem',
              borderRadius: '0.5rem',
              border: busqueda ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)',
              fontSize: '0.875rem',
              background: 'var(--color-input)',
              color: 'var(--color-text)',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)', whiteSpace: 'nowrap' }}>
          {clientesFiltrados.length} de {clientes.length}
        </span>
        {hayFiltros && (
          <Button variant="ghost" type="button" onClick={limpiarFiltros} style={{ whiteSpace: 'nowrap' }}>
            ✕ Limpiar
          </Button>
        )}
      </div>

      {/* FILTROS AVANZADOS */}
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
            padding: '0.625rem 1rem',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted, #6b7280)', letterSpacing: '0.05em' }}>
              FILTROS AVANZADOS
            </span>
            {cantFiltrosActivos > 0 && (
              <span style={{ background: '#2563eb', color: 'white', fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '9999px', lineHeight: 1.4 }}>
                {cantFiltrosActivos}
              </span>
            )}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)' }}>
            {filtrosVisible ? '▲ ocultar' : '▼ mostrar'}
          </span>
        </div>

        {filtrosVisible && (
          <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid var(--color-border, #e5e7eb)' }}>

            {/* Grupo: Ubicación */}
            <div style={{ marginTop: '0.875rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted, #9ca3af)', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                UBICACIÓN
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem', alignItems: 'flex-start' }}>
                <div style={{ flex: '1', minWidth: '140px' }}>
                  <input
                    value={filtroCiudad}
                    onChange={(e) => setFiltroCiudad(e.target.value)}
                    placeholder="Ciudad"
                    style={{ width: '100%', padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroCiudad ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ flex: '1', minWidth: '120px' }}>
                  <input
                    value={filtroEstadoRegion}
                    onChange={(e) => setFiltroEstadoRegion(e.target.value)}
                    placeholder="Estado / Prov"
                    style={{ width: '100%', padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroEstadoRegion ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', marginTop: '0.3rem', color: 'var(--color-text-muted, #6b7280)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={estadoRegionExact} onChange={(e) => setEstadoRegionExact(e.target.checked)} />
                    Exacto (CA ≠ FL)
                  </label>
                </div>
                <div style={{ minWidth: '100px' }}>
                  <input
                    value={filtroCodigoPostal}
                    onChange={(e) => setFiltroCodigoPostal(e.target.value)}
                    placeholder="ZIP"
                    style={{ width: '100%', padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroCodigoPostal ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            {/* Grupo: Estado y segmentación */}
            <div style={{ marginTop: '0.875rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted, #9ca3af)', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                SEGMENTACIÓN
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem', alignItems: 'flex-end' }}>
                {/* Cuenta */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #6b7280)' }}>Cuenta</div>
                  <select
                    value={filtroEstado}
                    onChange={(e) => setFiltroEstado(e.target.value)}
                    style={{ padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroEstado !== 'todos' ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)' }}
                  >
                    <option value="todos">Todos</option>
                    <option value="actual">Actual</option>
                    <option value="cancelacion_total">Cancelado</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </div>
                {/* Operativo */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #6b7280)' }}>Operativo</div>
                  <select
                    value={filtroEstadoOperativo}
                    onChange={(e) => setFiltroEstadoOperativo(e.target.value)}
                    style={{ padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroEstadoOperativo !== 'todos' ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)' }}
                  >
                    <option value="todos">Todos</option>
                    <option value="activo">Activo</option>
                    <option value="en_riesgo">En riesgo</option>
                    <option value="recuperacion">Recuperación</option>
                    <option value="inactivo">Inactivo</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
                {/* Morosidad */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #6b7280)' }}>Morosidad</div>
                  <select
                    value={filtroAtraso}
                    onChange={(e) => setFiltroAtraso(e.target.value)}
                    style={{ padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroAtraso !== 'todos' ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)' }}
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
                {/* Cumpleaños */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #6b7280)' }}>Cumpleaños</div>
                  <select
                    value={filtroMesCumple}
                    onChange={(e) => setFiltroMesCumple(e.target.value)}
                    style={{ padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroMesCumple !== 'todos' ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)' }}
                  >
                    <option value="todos">Todos</option>
                    <option value="hoy">Hoy</option>
                    <option value="mes_actual">Mes actual</option>
                    <option value="mes_1">Enero</option>
                    <option value="mes_2">Febrero</option>
                    <option value="mes_3">Marzo</option>
                    <option value="mes_4">Abril</option>
                    <option value="mes_5">Mayo</option>
                    <option value="mes_6">Junio</option>
                    <option value="mes_7">Julio</option>
                    <option value="mes_8">Agosto</option>
                    <option value="mes_9">Septiembre</option>
                    <option value="mes_10">Octubre</option>
                    <option value="mes_11">Noviembre</option>
                    <option value="mes_12">Diciembre</option>
                  </select>
                </div>
                {/* Filtros/cartuchos */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #6b7280)' }}>Filtros agua</div>
                  <select
                    value={filtroCartuchos}
                    onChange={(e) => setFiltroCartuchos(e.target.value as typeof filtroCartuchos)}
                    style={{ padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroCartuchos !== 'todos' ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)' }}
                  >
                    <option value="todos">Todos</option>
                    <option value="vencidos">Vencidos</option>
                    <option value="proximos_30">Próximos 30 días</option>
                  </select>
                </div>
                {/* Fuente import */}
                {fuentesUnicas.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #6b7280)' }}>Fuente import</div>
                    <select
                      value={filtroFuenteImport}
                      onChange={(e) => setFiltroFuenteImport(e.target.value)}
                      style={{ padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroFuenteImport !== 'todos' ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)' }}
                    >
                      <option value="todos">Todos</option>
                      {fuentesUnicas.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                      <option value="_sin_fuente">Sin fuente</option>
                    </select>
                  </div>
                )}
                {/* Vendedor */}
                {currentRole !== 'vendedor' && !isSellerView && (
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted, #6b7280)' }}>Vendedor</div>
                    <select
                      value={filtroVendedor}
                      onChange={(e) => setFiltroVendedor(e.target.value)}
                      style={{ padding: '0.5rem 0.625rem', borderRadius: '0.375rem', border: filtroVendedor !== 'todos' ? '1.5px solid #2563eb' : '1px solid var(--color-border, #e5e7eb)', fontSize: '0.8rem', background: 'var(--color-input)', color: 'var(--color-text)' }}
                    >
                      <option value="todos">Todos</option>
                      {vendedoresUnicos.map((v) => (
                        <option key={v.id} value={v.id}>{v.nombre}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Grupo: Columnas visibles */}
            <div style={{ marginTop: '0.875rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--color-border, #e5e7eb)' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted, #9ca3af)', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                COLUMNAS VISIBLES
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1rem' }}>
                {CLIENTE_TABLE_COLUMNS.map((col) => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={columnVisibility[col.key]}
                      onChange={(e) =>
                        setColumnVisibility((prev) => {
                          const next = { ...prev, [col.key]: e.target.checked }
                          return Object.values(next).some(Boolean) ? next : prev
                        })
                      }
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {loading && (
            <div className="seller-skeleton-grid">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="seller-card skeleton-card">
                  <div className="skeleton-line wide" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                </div>
              ))}
            </div>
          )}
          {!loading && clientesFiltrados.length === 0 ? (
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
              <p>{emptyLabel}</p>
              <div className="empty-actions">
                <Button variant="ghost" type="button" onClick={() => window.location.assign('/leads')}>
                  {t('clientes.emptyViewLeads')}
                </Button>
                <Button variant="ghost" type="button" onClick={() => setFiltrosVisible(true)}>
                  {t('clientes.emptySearch')}
                </Button>
              </div>
            </div>
          ) : (
            clientesFiltrados.map((cliente) => {
              const cardVendedor = getClienteVendedorLabel(getClienteResponsableId(cliente))
              const matchingRow = rows.find((r) => r.id === cliente.id)
              const fullName = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || '-'
              const segmento = segmentoAtraso(cliente.dias_atraso, cliente.monto_moroso)
              const diasCumple = cliente.fecha_nacimiento ? diasParaCumple(cliente.fecha_nacimiento) : null
              const cumpleBadge =
                diasCumple === null
                  ? null
                  : diasCumple <= 0
                    ? '🎂 Hoy'
                    : diasCumple <= 7
                      ? `🎂 En ${diasCumple} días`
                      : diasCumple <= 30
                        ? `En ${diasCumple} días`
                        : null
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{fullName}</span>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
                      {cumpleBadge && (
                        <span
                          style={{
                            padding: '0.15rem 0.5rem',
                            borderRadius: '9999px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            background: diasCumple === 0 ? '#fef3c7' : '#e0f2fe',
                            color: diasCumple === 0 ? '#92400e' : '#1e3a8a',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {cumpleBadge}
                        </span>
                      )}
                    </div>
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
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }} title={`ID: ${getClienteResponsableId(cliente)}`}>
                      👤 {cardVendedor}
                    </span>
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
                          vendedor: cardVendedor === 'Sin asignar' ? '' : cardVendedor,
                          cuentaHycite: cliente.hycite_id ?? cliente.numero_cuenta_financiera ?? '',
                          saldoActual: cliente.saldo_actual,
                          montoMoroso: cliente.monto_moroso,
                          diasAtraso: cliente.dias_atraso,
                          estadoMorosidad: cliente.estado_morosidad,
                          clienteId: cliente.id,
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
          columns={visibleColumns.map((col) => col.label)}
          rows={rows}
          emptyLabel={emptyLabel}
          onRowClick={setSelectedRow}
          sortableColumns={visibleSortableColumns}
          sortColIndex={sortColIndex >= 0 ? sortColIndex : undefined}
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
              onBlur={handleFormatText('direccion')}
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
            <input value={formValues.ciudad} onChange={handleChange('ciudad')} onBlur={handleFormatText('ciudad')} />
          </label>
          <label className="form-field">
            <span>Estado (Dirección)</span>
            <input value={formValues.estado_region} onChange={handleChange('estado_region')} onBlur={handleFormatState} />
          </label>
          <label className="form-field">
            <span>Código postal</span>
            <input value={formValues.codigo_postal} onChange={handleChange('codigo_postal')} />
          </label>
          <label className="form-field">
            <span>No. Hycite</span>
            <input value={formValues.hycite_id} onChange={handleChange('hycite_id')} placeholder="Número de cliente Hycite" />
          </label>
          <label className="form-field">
            <span>No. Financiero</span>
            <input value={formValues.numero_cuenta_financiera} onChange={handleChange('numero_cuenta_financiera')} placeholder="Número de cuenta financiera" />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.saldoActual')}</span>
            <input type="number" value={formValues.saldo_actual} onChange={handleChange('saldo_actual')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.vendedorId')}</span>
            {canEditClientes && !isSellerView ? (
              <select value={formValues.vendedor_id} onChange={handleChange('vendedor_id')}>
                <option value="">Sin asignar</option>
                {vendorSelectOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.label}
                  </option>
                ))}
              </select>
            ) : (
              <input value={formVendedorName} readOnly />
            )}
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
          <label className="form-field">
            <span>Estado de cuenta</span>
            <select value={formValues.estado_cuenta} onChange={handleChange('estado_cuenta')}>
              <option value="actual">Actual</option>
              <option value="cancelacion_total">Cancelado</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </label>
          <label className="form-field">
            <span>Próxima acción</span>
            <input value={formValues.next_action as string} onChange={handleChange('next_action')} placeholder="Ej: Llamar para confirmar pedido" />
          </label>
          <label className="form-field">
            <span>Fecha próxima acción</span>
            <input type="date" value={formValues.next_action_date as string} onChange={handleChange('next_action_date')} />
          </label>
          {editingCliente && (editingCliente.nivel || (editingCliente.monto_moroso ?? 0) > 0 || (editingCliente.dias_atraso ?? 0) > 0 || editingCliente.fecha_ultimo_pedido) && (
            <div style={{ gridColumn: '1 / -1', padding: '0.75rem', background: 'var(--color-surface, #f8fafc)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: '0.375rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted, #94a3b8)', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                DATOS DEL SISTEMA HYCITE (solo lectura)
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                {editingCliente.nivel ? <span><strong>Nivel:</strong> {editingCliente.nivel}</span> : null}
                {(editingCliente.monto_moroso ?? 0) > 0 ? <span><strong>Moroso:</strong> ${Number(editingCliente.monto_moroso).toFixed(2)}</span> : null}
                {(editingCliente.dias_atraso ?? 0) > 0 ? <span><strong>Días atraso:</strong> {editingCliente.dias_atraso}</span> : null}
                {editingCliente.fecha_ultimo_pedido ? <span><strong>Último pedido:</strong> {editingCliente.fecha_ultimo_pedido}</span> : null}
              </div>
            </div>
          )}
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>

      <DetailPanel
        open={Boolean(selectedRow)}
        title="Detalle del cliente"
        items={(() => {
          if (!selectedClienteDetail) return selectedRow?.detail ?? []
          if (detailTab === 'notas') {
            return [{ label: 'Notas', value: notasContent }]
          }
          if (detailTab === 'historial') {
            return [{
              label: 'Historial',
              value: selectedClienteDetail ? (
                <ContactoTimeline
                  contactoTipo="cliente"
                  contactoId={selectedClienteDetail.id}
                  emptyLabel="Sin historial de actividades para este cliente"
                />
              ) : '-',
            }]
          }
          if (detailTab === 'cartera') {
            return [
              {
                label: 'Saldo actual',
                value: selectedClienteDetail.saldo_actual !== null && selectedClienteDetail.saldo_actual !== undefined
                  ? `$${Number(selectedClienteDetail.saldo_actual).toFixed(2)}`
                  : '-',
              },
              {
                label: 'Monto moroso',
                value: selectedClienteDetail.monto_moroso !== null && selectedClienteDetail.monto_moroso !== undefined
                  ? `$${Number(selectedClienteDetail.monto_moroso).toFixed(2)}`
                  : '-',
              },
              {
                label: 'Días de atraso',
                value: segmentoAtraso(
                  selectedClienteDetail.dias_atraso,
                  selectedClienteDetail.monto_moroso,
                ),
              },
              { label: 'Última fecha de pago', value: formatDateValue(selectedClienteDetail.ultima_fecha_pago) },
              { label: 'Último pedido', value: formatDateValue(selectedClienteDetail.fecha_ultimo_pedido) },
            ]
          }
          if (detailTab === 'servicios') {
            return [{ label: 'Servicios recientes', value: serviciosContent }]
          }
          {
            // ── helpers locales ───────────────────────────────────────
            const c = selectedClienteDetail
            const risk = riskChip(c.dias_atraso, c.monto_moroso)

            const phoneActions = (phone: string) => (
              <span style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>{phone}</span>
                <a href={buildTelUrl(phone)} style={inlineBtn('#3b82f6')}>Llamar</a>
                <button type="button" style={inlineBtn('#6b7280')} onClick={() => copyToClipboard(phone, 'Teléfono copiado')}>Copiar</button>
                <button
                  type="button"
                  style={inlineBtn('#16a34a')}
                  onClick={() => openWhatsapp({
                    nombre: [c.nombre, c.apellido].filter(Boolean).join(' '),
                    telefono: phone,
                    email: c.email ?? '',
                    vendedor: c.vendedor_id ? (usersById[c.vendedor_id] ?? '') : '',
                    cuentaHycite: c.hycite_id ?? c.numero_cuenta_financiera ?? '',
                    saldoActual: c.saldo_actual,
                    montoMoroso: c.monto_moroso,
                    diasAtraso: c.dias_atraso,
                    estadoMorosidad: c.estado_morosidad,
                    clienteId: c.id,
                  })}
                >
                  WhatsApp
                </button>
              </span>
            )

            const fullAddr = formatAddressLabel({ direccion: c.direccion, ciudad: c.ciudad, estado_region: c.estado_region, codigo_postal: c.codigo_postal })
            const mapsUrl = buildMapsNavUrl({ direccion: c.direccion, ciudad: c.ciudad, estado_region: c.estado_region, codigo_postal: c.codigo_postal })

            const dirBlock = fullAddr ? (
              <span style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.86rem' }}>{fullAddr}</span>
                <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                  {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={inlineBtn('#10b981')}>🗺 Navegar</a>}
                  <button type="button" style={inlineBtn('#6b7280')} onClick={() => copyToClipboard(fullAddr, 'Dirección copiada')}>Copiar</button>
                </span>
              </span>
            ) : noReg

            const cumpleBlock = (() => {
              if (!c.fecha_nacimiento) return noReg
              const dias = diasParaCumple(c.fecha_nacimiento)
              const fechaLabel = new Date(`${c.fecha_nacimiento}T00:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short' })
              return (
                <span style={{ padding: '0.15rem 0.6rem', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 600, background: dias === 0 ? '#fef3c7' : '#e0f2fe', color: dias === 0 ? '#92400e' : '#1e3a8a', whiteSpace: 'nowrap' }}>
                  {dias === 0 ? `Hoy (${fechaLabel})` : `${fechaLabel} · en ${dias}d`}
                </span>
              )
            })()

            return [{
              label: '',
              value: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                  {/* ── CHIPS de estado ── */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: '1px solid var(--card-border, #e5e7eb)' }}>
                    <span style={chip('#6b7280', '#f3f4f6')}>{c.estado_cuenta ?? 'Sin estado'}</span>
                    {c.saldo_actual !== null && (
                      <span style={chip('#1d4ed8', '#dbeafe')}>Saldo ${Number(c.saldo_actual).toFixed(2)}</span>
                    )}
                    {(c.monto_moroso ?? 0) > 0 && (
                      <span style={chip('#dc2626', '#fee2e2')}>Moroso ${Number(c.monto_moroso).toFixed(2)}</span>
                    )}
                    <span style={chip(risk.color, risk.bg)}>{risk.label}</span>
                    {c.next_action_date && (
                      <span style={chip('#7c3aed', '#ede9fe')}>
                        Próx. acción: {new Date(c.next_action_date + 'T00:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                      </span>
                    )}
                  </div>

                  {/* ── GRID 2 columnas ── */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem 1.5rem' }}>

                    {/* CONTACTO */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <p style={blockTitle}>Contacto</p>
                      <div>
                        <label style={fieldLbl}>Nombre</label>
                        <span style={fieldVal}>{c.nombre && c.apellido ? `${c.nombre} ${c.apellido}` : c.nombre ?? c.apellido ?? noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Móvil</label>
                        {c.telefono ? phoneActions(c.telefono) : noReg}
                      </div>
                      <div>
                        <label style={fieldLbl}>Casa</label>
                        {c.telefono_casa ? phoneActions(c.telefono_casa) : noReg}
                      </div>
                      <div>
                        <label style={fieldLbl}>Email</label>
                        {c.email
                          ? <a href={`mailto:${c.email}`} style={{ color: '#3b82f6', fontSize: '0.86rem', textDecoration: 'none' }}>{c.email}</a>
                          : noReg}
                      </div>
                      <div>
                        <label style={fieldLbl}>Cumpleaños</label>
                        {cumpleBlock}
                      </div>
                    </div>

                    {/* DIRECCIÓN */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <p style={blockTitle}>Dirección</p>
                      <div>
                        <label style={fieldLbl}>Dirección</label>
                        {dirBlock}
                      </div>
                      <div>
                        <label style={fieldLbl}>Ciudad</label>
                        <span style={fieldVal}>{c.ciudad ?? noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Estado</label>
                        <span style={fieldVal}>{c.estado_region ?? noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>ZIP</label>
                        <span style={fieldVal}>{c.codigo_postal ?? noReg}</span>
                      </div>
                    </div>

                    {/* CUENTA */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <p style={blockTitle}>Cuenta</p>
                      <div>
                        <label style={fieldLbl}>Hycite ID</label>
                        <span style={fieldVal}>{c.hycite_id ?? noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Cta. financiera</label>
                        <span style={fieldVal}>{c.numero_cuenta_financiera ?? noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Vendedor</label>
                        <span style={fieldVal}>{c.vendedor_id ? usersById[c.vendedor_id] ?? noReg : noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Nivel</label>
                        <span style={fieldVal}>{c.nivel ? String(c.nivel) : noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Origen</label>
                        <span style={fieldVal}>{c.origen ?? noReg}</span>
                      </div>
                    </div>

                    {/* COBRANZA */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <p style={blockTitle}>Cobranza</p>
                      <div>
                        <label style={fieldLbl}>Saldo</label>
                        <span style={fieldVal}>{c.saldo_actual !== null ? `$${Number(c.saldo_actual).toFixed(2)}` : noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Moroso</label>
                        <span style={{ ...fieldVal, color: (c.monto_moroso ?? 0) > 0 ? '#ef4444' : 'inherit', fontWeight: (c.monto_moroso ?? 0) > 0 ? 700 : 400 }}>
                          {c.monto_moroso !== null ? `$${Number(c.monto_moroso).toFixed(2)}` : noReg}
                        </span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Morosidad</label>
                        {segmentoAtraso(c.dias_atraso, c.monto_moroso)}
                      </div>
                      <div>
                        <label style={fieldLbl}>Últ. pago</label>
                        <span style={fieldVal}>{c.ultima_fecha_pago ? formatDateValue(c.ultima_fecha_pago) : noReg}</span>
                      </div>
                      <div>
                        <label style={fieldLbl}>Últ. pedido</label>
                        <span style={fieldVal}>{c.fecha_ultimo_pedido ? formatDateValue(c.fecha_ultimo_pedido) : noReg}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── SEGUIMIENTO ── */}
                  <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--card-border, #e5e7eb)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <p style={blockTitle}>Seguimiento</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {/* Próxima acción — editable inline */}
                      <div>
                        <label style={fieldLbl}>Próxima acción</label>
                        {editingNextAction ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.25rem' }}>
                            <input
                              value={nextActionDraft}
                              onChange={(e) => setNextActionDraft(e.target.value)}
                              placeholder="Ej: Llamar el viernes"
                              style={{ padding: '0.35rem 0.6rem', borderRadius: '6px', border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--color-text)', fontSize: '0.84rem' }}
                            />
                            <input
                              type="date"
                              value={nextActionDateDraft}
                              onChange={(e) => setNextActionDateDraft(e.target.value)}
                              style={{ padding: '0.35rem 0.6rem', borderRadius: '6px', border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--color-text)', fontSize: '0.84rem' }}
                            />
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button type="button" disabled={savingNextAction} onClick={() => void saveNextAction()} style={{ ...inlineBtn('#2563eb'), padding: '0.3rem 0.75rem' }}>
                                {savingNextAction ? 'Guardando…' : 'Guardar'}
                              </button>
                              <button type="button" onClick={() => setEditingNextAction(false)} style={{ ...inlineBtn('#6b7280'), padding: '0.3rem 0.75rem' }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.15rem' }}>
                            <span style={fieldVal}>{c.next_action ?? noReg}</span>
                            <button
                              type="button"
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '0.78rem', padding: 0 }}
                              onClick={() => {
                                setNextActionDraft(c.next_action ?? '')
                                setNextActionDateDraft(c.next_action_date ?? '')
                                setEditingNextAction(true)
                              }}
                            >
                              ✏️ editar
                            </button>
                          </div>
                        )}
                      </div>
                      {!editingNextAction && c.next_action_date && (
                        <div>
                          <label style={fieldLbl}>Fecha</label>
                          <span style={fieldVal}>{new Date(c.next_action_date + 'T00:00:00').toLocaleDateString('es')}</span>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              ),
            }]
          }
        })()}
        tabs={selectedClienteDetail ? [
          { key: 'info', label: 'Información' },
          { key: 'historial', label: 'Historial' },
          { key: 'notas', label: 'Notas' },
          { key: 'cartera', label: 'Cartera' },
          { key: 'servicios', label: 'Servicios' },
        ] : undefined}
        activeTab={selectedClienteDetail ? detailTab : undefined}
        onTabChange={selectedClienteDetail ? (key) => setDetailTab(key as 'info' | 'notas' | 'historial' | 'cartera' | 'servicios') : undefined}
        onClose={() => setSelectedRow(null)}
        action={
          selectedClienteDetail ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                type="button"
                onClick={() =>
                  openCitaModal({
                    initialData: {
                      contacto_tipo: 'cliente',
                      contacto_id: selectedClienteDetail.id,
                      contacto_nombre: [selectedClienteDetail.nombre, selectedClienteDetail.apellido].filter(Boolean).join(' ') || 'Cliente',
                      contacto_telefono: selectedClienteDetail.telefono ?? selectedClienteDetail.telefono_casa ?? '',
                      direccion: selectedClienteDetail.direccion ?? '',
                      ciudad: selectedClienteDetail.ciudad ?? '',
                      estado_region: selectedClienteDetail.estado_region ?? '',
                      zip: selectedClienteDetail.codigo_postal ?? '',
                      assigned_to: selectedClienteDetail.vendedor_id ?? '',
                    },
                    assignedOptions:
                      citaAssignedOptions.length > 0
                        ? citaAssignedOptions
                        : [{ id: selectedClienteDetail.vendedor_id ?? sessionUserId ?? '', label: 'Responsable actual' }].filter(
                            (option): option is { id: string; label: string } => Boolean(option.id),
                          ),
                    onSaved: () => showToast('Cita creada'),
                  })
                }
                disabled={detailLoading}
              >
                Agendar cita
              </Button>

              <Button
                variant="ghost"
                type="button"
                onClick={() =>
                  openGestionModal({
                    contacto: {
                      tipo: 'cliente',
                      id: selectedClienteDetail.id,
                      nombre: [selectedClienteDetail.nombre, selectedClienteDetail.apellido].filter(Boolean).join(' ') || 'Cliente',
                      telefono: selectedClienteDetail.telefono ?? selectedClienteDetail.telefono_casa ?? null,
                      email: selectedClienteDetail.email ?? null,
                      subtitle: selectedClienteDetail.vendedor_id
                        ? usersById[selectedClienteDetail.vendedor_id] ?? 'Cliente'
                        : 'Cliente',
                    },
                    moduloOrigen: 'clientes',
                    origenId: selectedClienteDetail.id,
                    onSubmit: async (draft) => {
                      showToast(`Gestión preparada: ${draft.resumen || draft.tipo}`)
                    },
                  })
                }
              >
                Registrar gestión
              </Button>

              {canEditClientes && (
                <Button variant="ghost" type="button" onClick={() => handleOpenEditForm(selectedClienteDetail)} disabled={detailLoading}>
                  Editar
                </Button>
              )}
              {selectedClienteDetail.persona_id && (
                <Button variant="ghost" type="button" onClick={() => setPerfilPersonaId(selectedClienteDetail.persona_id ?? null)}>
                  Ver perfil
                </Button>
              )}
            </div>
          ) : null
        }
      />
      <ModalRenderer />

      <PersonaPerfilPanel
        personaId={perfilPersonaId}
        onClose={() => setPerfilPersonaId(null)}
      />

      {/* MODAL DUPLICADOS */}
      <Modal
        open={canManageClientes && showDuplicados}
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
                const vendorName = getClienteVendedorLabel(getClienteResponsableId(c))
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      padding: '0.65rem 0.85rem',
                      borderTop: idx > 0 ? '1px solid #fee2e2' : undefined,
                      background: idx === 0 ? '#fff7ed' : 'white',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {idx === 0 && (
                          <span style={{ fontSize: '0.7rem', background: '#d1fae5', color: '#065f46', padding: '0.12rem 0.45rem', borderRadius: '9999px', fontWeight: 700 }}>
                            Original
                          </span>
                        )}
                        <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#111827' }}>{name}</span>
                      </div>
                      <div
                        style={{
                          marginTop: '0.25rem',
                          display: 'grid',
                          gap: '0.2rem',
                          fontSize: '0.78rem',
                          color: '#4b5563',
                          lineHeight: 1.35,
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600, color: '#374151' }}>Vendedor:</span> {vendorName}
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: '#374151' }}>Fecha:</span>{' '}
                          {c.created_at ? new Date(c.created_at).toLocaleDateString('es') : '-'}
                          {c.estado_cuenta ? ` · ${c.estado_cuenta === 'cancelacion_total' ? 'Cancelado' : 'Actual'}` : ''}
                        </div>
                        {(c.hycite_id || c.numero_cuenta_financiera) && (
                          <div>
                            <span style={{ fontWeight: 600, color: '#374151' }}>Cuenta:</span>{' '}
                            {c.hycite_id || c.numero_cuenta_financiera}
                          </div>
                        )}
                        {c.direccion && (
                          <div>
                            <span style={{ fontWeight: 600, color: '#374151' }}>Direccion:</span>{' '}
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '0.05rem 0.4rem',
                                borderRadius: '0.4rem',
                                background: '#f3f4f6',
                                color: '#1f2937',
                              }}
                            >
                              {c.direccion}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    {canDelete && idx > 0 && (
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
                    {canDelete && idx === 0 && (
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
