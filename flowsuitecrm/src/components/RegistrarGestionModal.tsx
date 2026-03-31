import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from './Button'
import { LABEL_STYLE, INPUT_STYLE } from './formControlStyles'
import { GESTION_TYPES_BY_ROLE, buildGestionAutoSummary } from './gestionUtils'
import { Modal } from './Modal'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'

export type GestionRole = 'admin' | 'distribuidor' | 'vendedor' | 'telemercadeo'

export type GestionTipo =
  | 'llamada'
  | 'whatsapp'
  | 'nota'
  | 'seguimiento'
  | 'visita'
  | 'email'
  | 'cita_completada'
  | 'venta'
  | 'referidos'
  | 'envio_material'

export type GestionCanal = 'telefono' | 'whatsapp' | 'presencial' | 'email' | 'sistema'

export type GestionResultado =
  | 'contesto'
  | 'no_contesta'
  | 'ocupado'
  | 'buzon_voz'
  | 'numero_equivocado'
  | 'interesado'
  | 'no_interesado'
  | 'cita_agendada'
  | 'promesa_pago'
  | 'pago_realizado'
  | 'reagendado'
  | 'cancelado'
  | 'no_show'
  | 'mensaje_enviado'
  | 'respondio'
  | 'no_respondio'

export type GestionContactoRef = {
  tipo: 'cliente' | 'lead'
  id: string
  nombre: string
  telefono?: string | null
  email?: string | null
  subtitle?: string | null
  searchDisabled?: boolean
  searchDisabledReason?: string | null
}

export type GestionOrigen = {
  moduloOrigen?: string
  origenId?: string
}

export type GestionDraft = GestionOrigen & {
  contactoTipo: 'cliente' | 'lead'
  contactoId: string
  tipo: GestionTipo
  canal: GestionCanal | null
  resultado: GestionResultado | null
  resumen: string
  contenido: string
  followupAt: string
  montoPrometido: string
}

type ResultadoOption = {
  value: GestionResultado
  label: string
}

const TIPO_OPTIONS: { value: GestionTipo; label: string }[] = [
  { value: 'llamada', label: 'Llamada' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'nota', label: 'Nota' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'visita', label: 'Visita' },
  { value: 'email', label: 'Email' },
  { value: 'cita_completada', label: 'Cita completada' },
  { value: 'venta', label: 'Venta' },
  { value: 'referidos', label: 'Referidos' },
  { value: 'envio_material', label: 'Envío de material' },
]

const RESULTADO_OPTIONS_BY_TYPE: Partial<Record<GestionTipo, ResultadoOption[]>> = {
  llamada: [
    { value: 'contesto', label: 'Contestó' },
    { value: 'no_contesta', label: 'No contestó' },
    { value: 'ocupado', label: 'Ocupado' },
    { value: 'buzon_voz', label: 'Buzón de voz' },
    { value: 'numero_equivocado', label: 'Número equivocado' },
    { value: 'interesado', label: 'Interesado' },
    { value: 'no_interesado', label: 'No interesado' },
    { value: 'cita_agendada', label: 'Cita agendada' },
    { value: 'promesa_pago', label: 'Promesa de pago' },
    { value: 'pago_realizado', label: 'Pago realizado' },
  ],
  whatsapp: [
    { value: 'mensaje_enviado', label: 'Mensaje enviado' },
    { value: 'respondio', label: 'Respondió' },
    { value: 'no_respondio', label: 'No respondió' },
    { value: 'interesado', label: 'Interesado' },
    { value: 'no_interesado', label: 'No interesado' },
    { value: 'cita_agendada', label: 'Cita agendada' },
  ],
  seguimiento: [
    { value: 'contesto', label: 'Completado' },
    { value: 'reagendado', label: 'Reagendado' },
    { value: 'cancelado', label: 'Cancelado' },
    { value: 'no_show', label: 'No show' },
  ],
  visita: [
    { value: 'contesto', label: 'Realizada' },
    { value: 'reagendado', label: 'Reagendada' },
    { value: 'cancelado', label: 'Cancelada' },
    { value: 'no_show', label: 'No show' },
  ],
  email: [
    { value: 'mensaje_enviado', label: 'Correo enviado' },
    { value: 'respondio', label: 'Respondió' },
    { value: 'no_respondio', label: 'No respondió' },
  ],
  cita_completada: [
    { value: 'contesto', label: 'Completada' },
    { value: 'reagendado', label: 'Reagendada' },
    { value: 'cancelado', label: 'Cancelada' },
    { value: 'no_show', label: 'No show' },
  ],
  venta: [
    { value: 'pago_realizado', label: 'Pago realizado' },
  ],
}

const DEFAULT_TIPO_BY_ROLE: Record<GestionRole, GestionTipo> = {
  admin: 'llamada',
  distribuidor: 'llamada',
  vendedor: 'llamada',
  telemercadeo: 'llamada',
}

const FIELD_GROUP_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
}

function createInitialDraft({
  contacto,
  role,
  tipoDefault,
  moduloOrigen,
  origenId,
}: {
  contacto: GestionContactoRef | null
  role: GestionRole
  tipoDefault?: GestionTipo
  moduloOrigen?: string
  origenId?: string
}): GestionDraft {
  const tipo = tipoDefault ?? DEFAULT_TIPO_BY_ROLE[role]
  return {
    contactoTipo: contacto?.tipo ?? 'cliente',
    contactoId: contacto?.id ?? '',
    tipo,
    canal: tipo === 'whatsapp' ? 'whatsapp' : tipo === 'email' ? 'email' : tipo === 'nota' ? 'sistema' : 'telefono',
    resultado: null,
    resumen: '',
    contenido: '',
    followupAt: '',
    montoPrometido: '',
    moduloOrigen,
    origenId,
  }
}

type RegistrarGestionModalProps = {
  open: boolean
  role: GestionRole
  onClose: () => void
  onSubmit: (draft: GestionDraft) => void | Promise<void>
  submitting?: boolean
  contacto?: GestionContactoRef | null
  tipoDefault?: GestionTipo
  moduloOrigen?: string
  origenId?: string
}

type SearchResultRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono?: string | null
  telefono_casa?: string | null
  email?: string | null
  hycite_id?: string | null
  estado_pipeline?: string | null
  vendedor_id?: string | null
  lead_id?: string | null
  estado?: string | null
  estado_presentacion?: string | null
  activacion_id?: string | null
  programa_id?: string | null
  representante_id?: string | null
  cliente_id?: string | null
  propietario_tipo?: string | null
  propietario_id?: string | null
  ciclo_numero?: number | null
}

export function RegistrarGestionModal({
  open,
  role,
  onClose,
  onSubmit,
  submitting = false,
  contacto = null,
  tipoDefault,
  moduloOrigen,
  origenId,
}: RegistrarGestionModalProps) {
  const [draft, setDraft] = useState<GestionDraft>(() =>
    createInitialDraft({ contacto, role, tipoDefault, moduloOrigen, origenId }),
  )
  const [selectedContacto, setSelectedContacto] = useState<GestionContactoRef | null>(contacto)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<GestionContactoRef[]>([])
  const [showFollowup, setShowFollowup] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    startTransition(() => {
      setDraft(createInitialDraft({ contacto, role, tipoDefault, moduloOrigen, origenId }))
      setSelectedContacto(contacto)
      setSearchQuery('')
      setSearchResults([])
      setShowFollowup(false)
    })
  }, [contacto, moduloOrigen, open, origenId, role, tipoDefault])

  useEffect(() => {
    if (!open || selectedContacto) return
    const handle = window.setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 40)
    return () => window.clearTimeout(handle)
  }, [open, selectedContacto])

  useEffect(() => {
    if (!open || selectedContacto || !isSupabaseConfigured) return
    const term = searchQuery.trim()
    if (term.length < 2) {
      startTransition(() => {
        setSearchResults([])
      })
      return
    }

    let cancelled = false
    const handle = window.setTimeout(async () => {
      setSearching(true)
      const pattern = `%${term}%`
      const [clientesRes, leadsRes, ciReferidosRes, referidos4en14Res] = await Promise.all([
        supabase
          .from('clientes')
          .select('id, nombre, apellido, telefono, telefono_casa, email, hycite_id, vendedor_id')
          .or(`nombre.ilike.${pattern},apellido.ilike.${pattern},telefono.ilike.${pattern},telefono_casa.ilike.${pattern},email.ilike.${pattern},hycite_id.ilike.${pattern}`)
          .limit(6),
        supabase
          .from('leads')
          .select('id, nombre, apellido, telefono, email, estado_pipeline, vendedor_id')
          .or(`nombre.ilike.${pattern},apellido.ilike.${pattern},telefono.ilike.${pattern},email.ilike.${pattern}`)
          .limit(6),
        supabase
          .from('ci_referidos')
          .select('id, nombre, telefono, lead_id, estado, activacion_id')
          .or(`nombre.ilike.${pattern},telefono.ilike.${pattern}`)
          .limit(4),
        supabase
          .from('programa_4en14_referidos')
          .select('id, nombre, telefono, lead_id, estado_presentacion, programa_id')
          .or(`nombre.ilike.${pattern},telefono.ilike.${pattern}`)
          .limit(4),
      ])

      if (cancelled) return

      const ciRows = (ciReferidosRes.data as SearchResultRow[] | null) ?? []
      const referidos4en14Rows = (referidos4en14Res.data as SearchResultRow[] | null) ?? []
      const activacionIds = [...new Set(ciRows.map((row) => row.activacion_id).filter((value): value is string => Boolean(value)))]
      const programaIds = [...new Set(referidos4en14Rows.map((row) => row.programa_id).filter((value): value is string => Boolean(value)))]

      const [activacionesRes, programasRes] = await Promise.all([
        activacionIds.length > 0
          ? supabase
              .from('ci_activaciones')
              .select('id, representante_id, cliente_id, lead_id')
              .in('id', activacionIds)
          : Promise.resolve({ data: [] as SearchResultRow[] }),
        programaIds.length > 0
          ? supabase
              .from('programa_4en14')
              .select('id, propietario_tipo, propietario_id, vendedor_id, ciclo_numero')
              .in('id', programaIds)
          : Promise.resolve({ data: [] as SearchResultRow[] }),
      ])

      if (cancelled) return

      const activaciones = ((activacionesRes.data as SearchResultRow[] | null) ?? [])
      const programas = ((programasRes.data as SearchResultRow[] | null) ?? [])
      const activacionMap = new Map(activaciones.map((row) => [row.id, row]))
      const programaMap = new Map(programas.map((row) => [row.id, row]))

      const userIds = [
        ...new Set([
          ...((clientesRes.data as SearchResultRow[] | null) ?? []).map((row) => row.vendedor_id ?? null),
          ...((leadsRes.data as SearchResultRow[] | null) ?? []).map((row) => row.vendedor_id ?? null),
          ...activaciones.map((row) => row.representante_id ?? null),
          ...programas.map((row) => row.vendedor_id ?? null),
          ...programas.map((row) =>
            row.propietario_tipo === 'vendedor' || row.propietario_tipo === 'usuario' ? row.propietario_id ?? null : null,
          ),
        ].filter((value): value is string => Boolean(value))),
      ]
      const clienteOwnerIds = [
        ...new Set([
          ...activaciones.map((row) => row.cliente_id ?? null),
          ...programas.map((row) => (row.propietario_tipo === 'cliente' ? row.propietario_id ?? null : null)),
        ].filter((value): value is string => Boolean(value))),
      ]
      const leadOwnerIds = [
        ...new Set([
          ...activaciones.map((row) => row.lead_id ?? null),
          ...programas.map((row) => (row.propietario_tipo === 'lead' ? row.propietario_id ?? null : null)),
        ].filter((value): value is string => Boolean(value))),
      ]
      const embajadorIds = [
        ...new Set(programas
          .map((row) => (row.propietario_tipo === 'embajador' ? row.propietario_id ?? null : null))
          .filter((value): value is string => Boolean(value))),
      ]

      const [usuariosRes, clientesOwnersRes, leadsOwnersRes, embajadoresRes] = await Promise.all([
        userIds.length > 0
          ? supabase.from('usuarios').select('id, nombre, apellido').in('id', userIds)
          : Promise.resolve({ data: [] as SearchResultRow[] }),
        clienteOwnerIds.length > 0
          ? supabase.from('clientes').select('id, nombre, apellido').in('id', clienteOwnerIds)
          : Promise.resolve({ data: [] as SearchResultRow[] }),
        leadOwnerIds.length > 0
          ? supabase.from('leads').select('id, nombre, apellido').in('id', leadOwnerIds)
          : Promise.resolve({ data: [] as SearchResultRow[] }),
        embajadorIds.length > 0
          ? supabase.from('embajadores').select('id, nombre, apellido').in('id', embajadorIds)
          : Promise.resolve({ data: [] as SearchResultRow[] }),
      ])

      if (cancelled) return

      const buildNameMap = (rows: SearchResultRow[] | null | undefined) =>
        new Map(
          (rows ?? []).map((row) => [
            row.id,
            [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || row.id,
          ]),
        )

      const userMap = buildNameMap(usuariosRes.data as SearchResultRow[] | null)
      const clienteMap = buildNameMap(clientesOwnersRes.data as SearchResultRow[] | null)
      const leadMap = buildNameMap(leadsOwnersRes.data as SearchResultRow[] | null)
      const embajadorMap = buildNameMap(embajadoresRes.data as SearchResultRow[] | null)

      const clientes = ((clientesRes.data as SearchResultRow[] | null) ?? []).map((row) => ({
        tipo: 'cliente' as const,
        id: row.id,
        nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Cliente',
        telefono: row.telefono ?? row.telefono_casa ?? null,
        email: row.email ?? null,
        subtitle: [
          row.hycite_id ? `Cliente · Hycite ${row.hycite_id}` : 'Cliente',
          row.vendedor_id ? `Vendedor ${userMap.get(row.vendedor_id) ?? row.vendedor_id}` : null,
        ].filter(Boolean).join(' · '),
      }))

      const leads = ((leadsRes.data as SearchResultRow[] | null) ?? []).map((row) => ({
        tipo: 'lead' as const,
        id: row.id,
        nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Lead',
        telefono: row.telefono ?? null,
        email: row.email ?? null,
        subtitle: [
          row.estado_pipeline ? `Lead · ${row.estado_pipeline}` : 'Lead',
          row.vendedor_id ? `Vendedor ${userMap.get(row.vendedor_id) ?? row.vendedor_id}` : null,
        ].filter(Boolean).join(' · '),
      }))

      const referidosConexiones = ciRows.map((row) => {
        const activacion = row.activacion_id ? activacionMap.get(row.activacion_id) : null
        const referidoPor = activacion?.cliente_id
          ? clienteMap.get(activacion.cliente_id)
          : activacion?.lead_id
            ? leadMap.get(activacion.lead_id)
            : null
        const vendedor = activacion?.representante_id ? userMap.get(activacion.representante_id) : null
        return {
          tipo: 'lead' as const,
          id: row.lead_id ?? row.id,
          nombre: row.nombre?.trim() || 'Referido sin nombre',
          telefono: row.telefono ?? null,
          email: null,
          subtitle: [
            row.lead_id ? `Conexiones · ${row.estado ?? 'pendiente'}` : 'Conexiones · sin lead vinculado',
            referidoPor ? `Referido por ${referidoPor}` : null,
            vendedor ? `Vendedor ${vendedor}` : null,
          ].filter(Boolean).join(' · '),
          searchDisabled: !row.lead_id,
          searchDisabledReason: row.lead_id ? null : 'Este referido aún no está vinculado a un lead.',
        }
      })

      const referidos4en14 = referidos4en14Rows.map((row) => {
        const programa = row.programa_id ? programaMap.get(row.programa_id) : null
        const referidoPor = programa?.propietario_id
          ? programa.propietario_tipo === 'cliente'
            ? clienteMap.get(programa.propietario_id)
            : programa.propietario_tipo === 'lead'
              ? leadMap.get(programa.propietario_id)
              : programa.propietario_tipo === 'embajador'
                ? embajadorMap.get(programa.propietario_id)
                : userMap.get(programa.propietario_id)
          : null
        const vendedor = programa?.vendedor_id ? userMap.get(programa.vendedor_id) : null
        return {
          tipo: 'lead' as const,
          id: row.lead_id ?? row.id,
          nombre: row.nombre?.trim() || 'Referido sin nombre',
          telefono: row.telefono ?? null,
          email: null,
          subtitle: [
            row.lead_id
              ? `4 en 14 · ${programa?.ciclo_numero ? `Ciclo ${programa.ciclo_numero}` : row.estado_presentacion ?? 'pendiente'}`
              : '4 en 14 · sin lead vinculado',
            referidoPor ? `Referido por ${referidoPor}` : null,
            vendedor ? `Vendedor ${vendedor}` : null,
          ].filter(Boolean).join(' · '),
          searchDisabled: !row.lead_id,
          searchDisabledReason: row.lead_id ? null : 'Este referido de 4 en 14 aún no está vinculado a un lead.',
        }
      })

      setSearchResults([...clientes, ...leads, ...referidosConexiones, ...referidos4en14])
      setSearching(false)
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, searchQuery, selectedContacto])

  const allowedTypes = useMemo(() => {
    const allowed = new Set(GESTION_TYPES_BY_ROLE[role])
    return TIPO_OPTIONS.filter((option) => allowed.has(option.value))
  }, [role])

  const resultOptions = useMemo(
    () => RESULTADO_OPTIONS_BY_TYPE[draft.tipo] ?? [],
    [draft.tipo],
  )

  const requiresResultado = draft.tipo !== 'nota'
  const showMontoPrometido = draft.resultado === 'promesa_pago'
  const canSubmit = Boolean(draft.contactoId && (!requiresResultado || draft.resultado))

  const handleSelectContacto = (nextContacto: GestionContactoRef) => {
    setSelectedContacto(nextContacto)
    setDraft((current) => ({
      ...current,
      contactoTipo: nextContacto.tipo,
      contactoId: nextContacto.id,
    }))
    setSearchResults([])
    setSearchQuery('')
  }

  const handleSubmit = async () => {
    const nextDraft = {
      ...draft,
      resumen: draft.resumen.trim() || buildGestionAutoSummary(draft.tipo, draft.resultado),
      contenido: draft.contenido.trim(),
    }
    await onSubmit(nextDraft)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar gestión"
      description={contacto ? `${contacto.nombre}${contacto.subtitle ? ` · ${contacto.subtitle}` : ''}` : 'Registrar acción comercial o de seguimiento'}
      size="lg"
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting || !canSubmit}>
            {submitting ? 'Guardando...' : 'Registrar gestión'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ padding: '0.85rem', borderRadius: '0.75rem', border: '1px solid var(--color-input-border)', background: 'var(--color-surface-strong)' }}>
          <div style={LABEL_STYLE}>Contacto</div>
          {selectedContacto ? (
            <div style={{ marginTop: '0.45rem', display: 'grid', gap: '0.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <strong>{selectedContacto.nombre}</strong>
                {!contacto && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedContacto(null)
                      setDraft((current) => ({ ...current, contactoId: '', contactoTipo: 'cliente' }))
                    }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 700 }}
                  >
                    Cambiar
                  </button>
                )}
              </div>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
                {selectedContacto.tipo.toUpperCase()}
                {selectedContacto.telefono ? ` · ${selectedContacto.telefono}` : ''}
                {selectedContacto.email ? ` · ${selectedContacto.email}` : ''}
              </span>
              {selectedContacto.subtitle && (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>{selectedContacto.subtitle}</span>
              )}
            </div>
          ) : (
            <div style={{ marginTop: '0.6rem', display: 'grid', gap: '0.65rem' }}>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar cliente o lead por nombre, teléfono, email o cuenta"
                style={INPUT_STYLE}
              />
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                Busca desde aquí sin entrar primero al módulo.
              </div>
              {searching && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Buscando contactos...</div>
              )}
              {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No encontré coincidencias todavía.</div>
              )}
              {searchResults.length > 0 && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {searchResults.map((result) => (
                    <button
                      key={`${result.tipo}-${result.id}`}
                      type="button"
                      onClick={() => {
                        if (result.searchDisabled) return
                        handleSelectContacto(result)
                      }}
                      disabled={result.searchDisabled}
                      style={{
                        textAlign: 'left',
                        padding: '0.8rem 0.9rem',
                        borderRadius: '0.75rem',
                        border: '1px solid var(--color-input-border)',
                        background: result.searchDisabled ? 'var(--color-surface-strong)' : 'var(--color-surface)',
                        color: 'var(--color-text)',
                        cursor: result.searchDisabled ? 'not-allowed' : 'pointer',
                        display: 'grid',
                        gap: '0.2rem',
                        opacity: result.searchDisabled ? 0.72 : 1,
                      }}
                    >
                      <strong>{result.nombre}</strong>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.84rem' }}>
                        {result.tipo.toUpperCase()}
                        {result.telefono ? ` · ${result.telefono}` : ''}
                        {result.email ? ` · ${result.email}` : ''}
                      </span>
                      {result.subtitle && (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{result.subtitle}</span>
                      )}
                      {result.searchDisabledReason && (
                        <span style={{ color: '#f59e0b', fontSize: '0.78rem', fontWeight: 600 }}>
                          {result.searchDisabledReason}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={FIELD_GROUP_STYLE}>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={LABEL_STYLE}>Tipo de gestión</span>
            <select
              value={draft.tipo}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  tipo: event.target.value as GestionTipo,
                  resultado: null,
                  canal:
                    event.target.value === 'whatsapp'
                      ? 'whatsapp'
                      : event.target.value === 'email'
                        ? 'email'
                        : event.target.value === 'nota'
                          ? 'sistema'
                          : 'telefono',
                }))
              }
              style={INPUT_STYLE}
            >
              {allowedTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={LABEL_STYLE}>Canal</span>
            <select
              value={draft.canal ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  canal: (event.target.value || null) as GestionCanal | null,
                }))
              }
              style={INPUT_STYLE}
            >
              <option value="">Seleccionar canal</option>
              <option value="telefono">Teléfono</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="presencial">Presencial</option>
              <option value="email">Email</option>
              <option value="sistema">Sistema</option>
            </select>
          </label>
        </div>

        <div style={FIELD_GROUP_STYLE}>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={LABEL_STYLE}>Resultado{requiresResultado ? ' *' : ''}</span>
            <select
              value={draft.resultado ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  resultado: (event.target.value || null) as GestionResultado | null,
                }))
              }
              style={INPUT_STYLE}
            >
              <option value="">{requiresResultado ? 'Seleccionar resultado' : 'No aplica'}</option>
              {resultOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {showMontoPrometido ? (
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={LABEL_STYLE}>Monto prometido</span>
              <input
                value={draft.montoPrometido}
                onChange={(event) => setDraft((current) => ({ ...current, montoPrometido: event.target.value }))}
                placeholder="$0.00"
                style={INPUT_STYLE}
              />
            </label>
          ) : (
            <div style={{ display: 'grid', alignContent: 'end' }}>
              <button
                type="button"
                onClick={() => setShowFollowup((current) => !current)}
                style={{
                  ...INPUT_STYLE,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {showFollowup ? 'Ocultar seguimiento' : 'Programar seguimiento'}
              </button>
            </div>
          )}
        </div>

        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span style={LABEL_STYLE}>Resumen</span>
          <input
            value={draft.resumen}
            onChange={(event) => setDraft((current) => ({ ...current, resumen: event.target.value.slice(0, 140) }))}
            placeholder="Se genera automáticamente si lo dejas vacío"
            style={INPUT_STYLE}
          />
        </label>

        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span style={LABEL_STYLE}>Nota completa</span>
          <textarea
            value={draft.contenido}
            onChange={(event) => setDraft((current) => ({ ...current, contenido: event.target.value }))}
            rows={5}
            style={{ ...INPUT_STYLE, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Escribe el detalle completo de la gestión"
          />
        </label>

        {showFollowup && (
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={LABEL_STYLE}>Seguimiento</span>
            <input
              type="datetime-local"
              value={draft.followupAt}
              onChange={(event) => setDraft((current) => ({ ...current, followupAt: event.target.value }))}
              style={INPUT_STYLE}
            />
          </label>
        )}
      </div>
    </Modal>
  )
}
