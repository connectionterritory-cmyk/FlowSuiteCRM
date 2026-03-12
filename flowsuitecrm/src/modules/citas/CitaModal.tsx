import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'
import { useToast } from '../../components/Toast'
import { isMissingLeadAddressColumnError, LEADS_SEARCH_BASE_SELECT, LEADS_SEARCH_EXTENDED_SELECT } from '../../lib/leadsSchema'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { formatProperName, formatProperText, formatStateRegion } from '../../lib/textFormat'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { buildContactRef, getContactTable } from '../../lib/contactRefs'
import type { ContactKind } from '../../types/contacts'

type AssignedOption = {
  id: string
  label: string
}

export type CitaForm = {
  id?: string
  owner_id?: string
  start_at: string
  tipo: string
  estado: string
  notas: string
  direccion: string
  ciudad?: string
  estado_region?: string
  zip?: string
  assigned_to: string
  contacto_nombre: string
  contacto_telefono: string
  contacto_tipo: ContactKind
  contacto_id: string
  campaign_id?: string
  message_id?: string
  response_id?: string
  resultado?: string
  resultado_notas?: string
  next_action_date?: string
}

type CitaModalProps = {
  open: boolean
  onClose: () => void
  onSaved?: (citaId?: string) => void
  initialData?: Partial<CitaForm>
  assignedOptions?: AssignedOption[]
}

const emptyForm: CitaForm = {
  owner_id: '',
  start_at: '',
  tipo: 'servicio',
  estado: 'programada',
  notas: '',
  direccion: '',
  ciudad: '',
  estado_region: '',
  zip: '',
  assigned_to: '',
  contacto_nombre: '',
  contacto_telefono: '',
  contacto_tipo: 'cliente',
  contacto_id: '',
  campaign_id: '',
  message_id: '',
  response_id: '',
  resultado: '',
  resultado_notas: '',
  next_action_date: '',
}

const ESTADO_OPTIONS = [
  { value: 'programada', label: 'Programada' },
  { value: 'confirmada', label: 'Confirmada' },
  { value: 'en_camino', label: 'En camino' },
  { value: 'completada', label: 'Completada' },
  { value: 'no_show', label: 'No show' },
  { value: 'cancelada', label: 'Cancelada' },
]

const TIPO_OPTIONS = [
  { value: 'servicio', label: 'Servicio' },
  { value: 'demo', label: 'Demo' },
  { value: 'cobranza', label: 'Cobranza' },
  { value: 'reclutamiento', label: 'Reclutamiento' },
  { value: 'otro', label: 'Otro' },
]

const CONTACTO_TIPO_OPTIONS = [
  { value: 'cliente', label: 'Cliente' },
  { value: 'lead', label: 'Lead / Prospecto' },
]

const RESULTADO_OPTIONS = [
  { value: 'realizada', label: 'Visita realizada' },
  { value: 'venta', label: 'Venta' },
  { value: 'no_contacto', label: 'No contacto' },
  { value: 'reagendar', label: 'Reagendar' },
  { value: 'no_interes', label: 'Sin interés' },
  { value: 'otro', label: 'Otro' },
]

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ContactSearchResult = {
  id: string
  tipo: ContactKind
  nombre: string
  telefono: string | null
  direccion?: string | null
  ciudad?: string | null
  estado_region?: string | null
  zip?: string | null
}

const toIso = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function CitaModal({ open, onClose, onSaved, initialData, assignedOptions = [] }: CitaModalProps) {
  const { showToast } = useToast()
  const { session } = useAuth()
  const { distributionUserIds, hasDistribuidorScope, viewMode } = useViewMode()
  const [form, setForm] = useState<CitaForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>([])
  const [contactLoading, setContactLoading] = useState(false)
  const [showSearch, setShowSearch] = useState(true)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const next = { ...emptyForm, ...initialData }
    if (!next.assigned_to) {
      next.assigned_to = assignedOptions[0]?.id ?? ''
    }
    if (!next.owner_id) {
      next.owner_id = session?.user.id ?? ''
    }
    setForm(next)
    setContactSearch(next.contacto_nombre || '')
    setContactResults([])
    setShowSearch(!Boolean(next.contacto_id))
  }, [assignedOptions, initialData, open, session?.user.id])

  useEffect(() => {
    if (!open || !isSupabaseConfigured || !session?.user.id) {
      setRole(null)
      return
    }
    const loadRole = async () => {
      const { data } = await supabase
        .from('usuarios')
        .select('rol')
        .eq('id', session.user.id)
        .maybeSingle()
      setRole((data as { rol?: string } | null)?.rol ?? null)
    }
    void loadRole()
  }, [open, session?.user.id])

  const selectedContactLabel = useMemo(() => {
    if (!form.contacto_id) return ''
    const phone = form.contacto_telefono ? ` · ${form.contacto_telefono}` : ''
    return `${form.contacto_nombre || 'Contacto'}${phone}`
  }, [form.contacto_id, form.contacto_nombre, form.contacto_telefono])

  const scopeHint = useMemo(() => {
    if (role === 'distribuidor' && viewMode === 'seller') {
      return 'Estás en vista Vendedor. Si buscas contactos del equipo, cambia arriba a Distribuidor.'
    }
    return null
  }, [role, viewMode])

  useEffect(() => {
    if (!open) return
    const term = contactSearch.trim()
    if (!showSearch || term.length < 2) {
      setContactResults([])
      setContactLoading(false)
      return
    }
    let active = true
    const handle = setTimeout(async () => {
      setContactLoading(true)
      const searchValue = `%${term}%`
      if (form.contacto_tipo === 'cliente') {
        let query = supabase
          .from('clientes')
          .select('id, nombre, apellido, telefono, direccion, ciudad, estado_region, codigo_postal, vendedor_id, distribuidor_id')
          .or(`nombre.ilike.${searchValue},apellido.ilike.${searchValue},telefono.ilike.${searchValue}`)
          .limit(10)
        if (role && role !== 'admin' && role !== 'distribuidor' && role !== 'supervisor_telemercadeo' && role !== 'telemercadeo' && session?.user.id) {
          query = query.eq('vendedor_id', session.user.id)
        } else if (role === 'distribuidor' && viewMode === 'seller' && session?.user.id) {
          query = query.eq('vendedor_id', session.user.id)
        } else if (hasDistribuidorScope && distributionUserIds.length > 0 && role !== 'supervisor_telemercadeo') {
          query = query.in('vendedor_id', distributionUserIds)
        }
        const { data, error } = await query
        if (!active) return
        if (error) {
          setContactResults([])
        } else {
          const results = (data ?? []).map((row) => ({
            id: row.id,
            tipo: 'cliente' as const,
            nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Cliente',
            telefono: row.telefono ?? null,
            direccion: row.direccion ?? null,
            ciudad: row.ciudad ?? null,
            estado_region: row.estado_region ?? null,
            zip: row.codigo_postal ?? null,
          }))
          setContactResults(results)
        }
      } else {
        const buildLeadSearchQuery = (selectClause: string) => {
          let query = supabase
            .from('leads')
            .select(selectClause)
            .is('deleted_at', null)
            .or(`nombre.ilike.${searchValue},apellido.ilike.${searchValue},telefono.ilike.${searchValue}`)
            .limit(10)
          if (role && role !== 'admin' && role !== 'distribuidor' && role !== 'supervisor_telemercadeo' && role !== 'telemercadeo' && session?.user.id) {
            query = query.or(`vendedor_id.eq.${session.user.id},owner_id.eq.${session.user.id}`)
          } else if (role === 'distribuidor' && viewMode === 'seller' && session?.user.id) {
            query = query.or(`vendedor_id.eq.${session.user.id},owner_id.eq.${session.user.id}`)
          } else if (hasDistribuidorScope && distributionUserIds.length > 0 && role !== 'supervisor_telemercadeo') {
            query = query.in('vendedor_id', distributionUserIds)
          }
          return query
        }
        let { data, error } = await buildLeadSearchQuery(LEADS_SEARCH_EXTENDED_SELECT)
        if (error && isMissingLeadAddressColumnError(error.message)) {
          ;({ data, error } = await buildLeadSearchQuery(LEADS_SEARCH_BASE_SELECT))
        }
        if (!active) return
        if (error) {
          setContactResults([])
        } else {
          const results = ((data as Array<{
            id: string
            nombre: string | null
            apellido: string | null
            telefono: string | null
            direccion?: string | null
            ciudad?: string | null
            estado_region?: string | null
            codigo_postal?: string | null
          }> | null) ?? []).map((row) => ({
            id: row.id,
            tipo: 'lead' as const,
            nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Lead',
            telefono: row.telefono ?? null,
            direccion: row.direccion ?? null,
            ciudad: row.ciudad ?? null,
            estado_region: row.estado_region ?? null,
            zip: row.codigo_postal ?? null,
          }))
          setContactResults(results)
        }
      }
      setContactLoading(false)
    }, 300)

    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [contactSearch, distributionUserIds, form.contacto_tipo, hasDistribuidorScope, open, role, session?.user.id, showSearch, viewMode])

  const handleSelectContact = (contact: ContactSearchResult) => {
    setForm((prev) => ({
      ...prev,
      contacto_tipo: contact.tipo,
      contacto_id: contact.id,
      contacto_nombre: contact.nombre,
      contacto_telefono: contact.telefono ?? '',
      direccion: contact.direccion ?? prev.direccion,
      ciudad: contact.ciudad ?? prev.ciudad,
      estado_region: contact.estado_region ?? prev.estado_region,
      zip: contact.zip ?? prev.zip,
    }))
    setContactSearch(contact.nombre)
    setContactResults([])
    setShowSearch(false)
  }

  const title = useMemo(() => (form.id ? 'Editar cita' : 'Nueva cita'), [form.id])

  const handleSave = async () => {
    if (!isSupabaseConfigured) {
      showToast('Configura Supabase para guardar cambios.', 'error')
      return
    }
    if (!form.start_at || !form.tipo) {
      showToast('Completa fecha y tipo.', 'error')
      return
    }
    if (!form.contacto_tipo || !['cliente', 'lead'].includes(form.contacto_tipo)) {
      showToast('Selecciona el tipo de contacto (cliente o lead).', 'error')
      return
    }
    if (!form.contacto_id.trim()) {
      showToast('El ID de contacto es obligatorio.', 'error')
      return
    }
    if (!UUID_REGEX.test(form.contacto_id.trim())) {
      showToast('El ID de contacto debe ser un UUID válido (ej: 550e8400-…).', 'error')
      return
    }
    if (form.estado === 'completada' && !form.resultado?.trim()) {
      showToast('Selecciona el resultado de la cita antes de marcarla como completada.', 'error')
      return
    }
    const startIso = toIso(form.start_at)
    if (!startIso) {
      showToast('Fecha invalida.', 'error')
      return
    }
    const startDate = new Date(startIso)
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
    if (endDate.getTime() <= startDate.getTime()) {
      showToast('La hora de fin debe ser mayor a la de inicio.', 'error')
      return
    }
    setSaving(true)

    // owner_id is immutable after creation — only set on INSERT, never on UPDATE
    const basePayload = {
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      tipo: form.tipo.trim(),
      estado: form.estado.trim() || 'programada',
      notas: form.notas.trim() || null,
      direccion: form.direccion ? formatProperText(form.direccion) : null,
      ciudad: form.ciudad ? formatProperText(form.ciudad) : null,
      estado_region: form.estado_region ? formatStateRegion(form.estado_region) : null,
      zip: form.zip?.trim() || null,
      assigned_to: form.assigned_to || null,
      nombre: form.contacto_nombre ? formatProperName(form.contacto_nombre) : null,
      telefono: form.contacto_telefono.trim() || null,
      contacto_tipo: form.contacto_tipo,
      contacto_id: form.contacto_id.trim(),
      campaign_id: form.campaign_id || null,
      message_id: form.message_id || null,
      response_id: form.response_id || null,
      resultado: form.resultado?.trim() || null,
      resultado_notas: form.resultado_notas?.trim() || null,
    }
    const request = form.id
      ? supabase.from('citas').update(basePayload).eq('id', form.id).select('id').maybeSingle()
      : supabase.from('citas').insert({ ...basePayload, owner_id: session?.user.id ?? '' }).select('id').maybeSingle()
    const { data: savedData, error } = await request
    if (error) {
      showToast(error.message, 'error')
      setSaving(false)
      return
    }
    showToast(form.id ? 'Cita actualizada' : 'Cita creada')
    const contactRef = buildContactRef(form.contacto_tipo, form.contacto_id)

    // Set next action on contact when result requires follow-up
    if (
      (form.resultado === 'reagendar' || form.estado === 'no_show') &&
      contactRef &&
      form.next_action_date
    ) {
      const contactTable = getContactTable(contactRef.contacto_tipo)
      await supabase.from(contactTable).update({
        next_action: 'Reagendar cita',
        next_action_date: form.next_action_date,
      }).eq('id', contactRef.contacto_id)
    }

    // Sync address to contact only if contact has no address yet (never overwrite existing)
    const citaDireccion = basePayload.direccion
    if (citaDireccion && contactRef) {
      const table = getContactTable(contactRef.contacto_tipo)
      const { data: contactData } = await supabase
        .from(table)
        .select('direccion')
        .eq('id', contactRef.contacto_id)
        .maybeSingle()
      if ((contactData as { direccion?: string | null } | null)?.direccion == null) {
        await supabase.from(table).update({
          direccion: citaDireccion,
          ciudad: basePayload.ciudad ?? null,
          estado_region: basePayload.estado_region ?? null,
          codigo_postal: basePayload.zip ?? null,
        }).eq('id', contactRef.contacto_id)
      }
    }

    setSaving(false)
    onSaved?.((savedData as { id?: string } | null)?.id ?? form.id)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !form.start_at || !form.tipo}>
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <label className="form-field">
          <span>Fecha y hora</span>
          <input
            type="datetime-local"
            value={form.start_at}
            onChange={(event) => setForm((prev) => ({ ...prev, start_at: event.target.value }))}
          />
        </label>
        <label className="form-field">
          <span>Tipo</span>
          <select
            value={form.tipo}
            onChange={(event) => setForm((prev) => ({ ...prev, tipo: event.target.value }))}
          >
            {TIPO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Estado</span>
          <select
            value={form.estado}
            onChange={(event) => setForm((prev) => ({ ...prev, estado: event.target.value }))}
          >
            {ESTADO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {form.estado === 'completada' && (
          <>
            <label className="form-field">
              <span>Resultado <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span></span>
              <select
                value={form.resultado ?? ''}
                onChange={(event) => setForm((prev) => ({ ...prev, resultado: event.target.value }))}
              >
                <option value="">Selecciona un resultado…</option>
                {RESULTADO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Notas del resultado</span>
              <textarea
                rows={3}
                value={form.resultado_notas ?? ''}
                onChange={(event) => setForm((prev) => ({ ...prev, resultado_notas: event.target.value }))}
                placeholder="Detalle del resultado"
              />
            </label>
          </>
        )}
        {(form.resultado === 'reagendar' || form.estado === 'no_show') && (
          <label className="form-field">
            <span>
              Fecha del próximo paso <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span>
            </span>
            <input
              type="date"
              value={form.next_action_date ?? ''}
              onChange={(event) => setForm((prev) => ({ ...prev, next_action_date: event.target.value }))}
            />
            <div className="form-hint">Se asignará "Reagendar cita" como próxima acción en el contacto.</div>
          </label>
        )}
        {/* CONTACTO — obligatorio, ligado a cliente o lead real */}
        <div className="form-field">
          <span>Tipo de contacto</span>
          <select
            value={form.contacto_tipo}
            onChange={(event) => {
                const nextTipo = event.target.value as ContactKind
              setForm((prev) => ({
                ...prev,
                contacto_tipo: nextTipo,
                contacto_id: '',
                contacto_nombre: '',
                contacto_telefono: '',
              }))
              setContactSearch('')
              setContactResults([])
              setShowSearch(true)
            }}
          >
            {CONTACTO_TIPO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="form-hint">
            {form.contacto_tipo === 'cliente'
              ? '¿Buscas un prospecto? Cambia a Lead / Prospecto'
              : '¿Buscas un cliente convertido? Cambia a Cliente'}
          </div>
          {scopeHint && <div className="form-hint">{scopeHint}</div>}
        </div>
        <div className="form-field">
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span>Contacto</span>
            {!showSearch && form.contacto_id ? (
              <div className="card" style={{ padding: '0.5rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <span>{selectedContactLabel}</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowSearch(true)
                    setContactSearch('')
                    setContactResults([])
                  }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <>
                <input
                  value={contactSearch}
                  onChange={(event) => setContactSearch(event.target.value)}
                  onBlur={() => {
                    setTimeout(() => {
                      if (form.contacto_id) {
                        setShowSearch(false)
                        setContactSearch(form.contacto_nombre)
                        setContactResults([])
                      }
                    }, 150)
                  }}
                  placeholder={form.contacto_tipo === 'lead' ? 'Buscar prospecto por nombre o teléfono' : 'Buscar cliente por nombre o teléfono'}
                />
                {contactLoading && <div className="form-hint">Buscando...</div>}
                {!contactLoading && contactSearch.trim().length >= 2 && contactResults.length === 0 && (
                  <div className="form-hint">
                    Sin resultados.{' '}
                    {form.contacto_tipo === 'cliente'
                      ? 'Si buscas un prospecto, cambia el tipo a Lead / Prospecto.'
                      : 'Si buscas un cliente convertido, cambia el tipo a Cliente.'}
                    {scopeHint ? ` ${scopeHint}` : ''}
                  </div>
                )}
                {contactResults.length > 0 && (
                  <div className="card" style={{ marginTop: '0.5rem', maxHeight: 220, overflow: 'auto' }}>
                    {contactResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className="list-row"
                        onClick={() => handleSelectContact(result)}
                        style={{ width: '100%', textAlign: 'left' }}
                      >
                        <strong>{result.nombre}</strong>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)' }}>
                          {result.telefono || 'Sin telefono'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>
        </div>
        <label className="form-field">
          <span>Asignado a</span>
          <select
            value={form.assigned_to}
            onChange={(event) => setForm((prev) => ({ ...prev, assigned_to: event.target.value }))}
            disabled={assignedOptions.length <= 1}
          >
            {assignedOptions.length === 0 && <option value="">Sin asignar</option>}
            {assignedOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Dirección</span>
          <input
            value={form.direccion}
            onChange={(event) => setForm((prev) => ({ ...prev, direccion: event.target.value }))}
            placeholder="Calle y número"
          />
        </label>
        <label className="form-field">
          <span>Ciudad</span>
          <input
            value={form.ciudad ?? ''}
            onChange={(event) => setForm((prev) => ({ ...prev, ciudad: event.target.value }))}
            placeholder="Ciudad"
          />
        </label>
        <label className="form-field">
          <span>Estado / Región</span>
          <input
            value={form.estado_region ?? ''}
            onChange={(event) => setForm((prev) => ({ ...prev, estado_region: event.target.value }))}
            placeholder="Estado"
          />
        </label>
        <label className="form-field">
          <span>Notas</span>
          <textarea
            rows={3}
            value={form.notas}
            onChange={(event) => setForm((prev) => ({ ...prev, notas: event.target.value }))}
            placeholder="Notas internas o indicaciones"
          />
        </label>
      </div>
    </Modal>
  )
}
