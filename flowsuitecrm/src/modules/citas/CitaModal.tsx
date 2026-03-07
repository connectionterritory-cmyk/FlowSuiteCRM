import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { formatProperName, formatProperText, formatStateRegion } from '../../lib/textFormat'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'

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
  contacto_tipo: string
  contacto_id: string
  campaign_id?: string
  message_id?: string
  response_id?: string
}

type CitaModalProps = {
  open: boolean
  onClose: () => void
  onSaved?: () => void
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ContactSearchResult = {
  id: string
  tipo: 'cliente' | 'lead'
  nombre: string
  telefono: string | null
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
          .select('id, nombre, apellido, telefono, ciudad, estado_region, codigo_postal, vendedor_id, distribuidor_id')
          .or(`nombre.ilike.${searchValue},apellido.ilike.${searchValue},telefono.ilike.${searchValue}`)
          .limit(10)
        if (role && role !== 'admin' && role !== 'distribuidor' && session?.user.id) {
          query = query.eq('vendedor_id', session.user.id)
        } else if (role === 'distribuidor' && viewMode === 'seller' && session?.user.id) {
          query = query.eq('vendedor_id', session.user.id)
        } else if (hasDistribuidorScope && distributionUserIds.length > 0) {
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
            ciudad: row.ciudad ?? null,
            estado_region: row.estado_region ?? null,
            zip: row.codigo_postal ?? null,
          }))
          setContactResults(results)
        }
      } else {
        let query = supabase
          .from('leads')
          .select('id, nombre, apellido, telefono, vendedor_id, owner_id')
          .is('deleted_at', null)
          .or(`nombre.ilike.${searchValue},apellido.ilike.${searchValue},telefono.ilike.${searchValue}`)
          .limit(10)
        if (role && role !== 'admin' && role !== 'distribuidor' && session?.user.id) {
          query = query.or(`vendedor_id.eq.${session.user.id},owner_id.eq.${session.user.id}`)
        } else if (role === 'distribuidor' && viewMode === 'seller' && session?.user.id) {
          query = query.or(`vendedor_id.eq.${session.user.id},owner_id.eq.${session.user.id}`)
        } else if (hasDistribuidorScope && distributionUserIds.length > 0) {
          query = query.in('vendedor_id', distributionUserIds)
        }
        const { data, error } = await query
        if (!active) return
        if (error) {
          setContactResults([])
        } else {
          const results = (data ?? []).map((row) => ({
            id: row.id,
            tipo: 'lead' as const,
            nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Lead',
            telefono: row.telefono ?? null,
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
      ciudad: contact.tipo === 'cliente' ? (contact.ciudad ?? prev.ciudad) : prev.ciudad,
      estado_region: contact.tipo === 'cliente' ? (contact.estado_region ?? prev.estado_region) : prev.estado_region,
      zip: contact.tipo === 'cliente' ? (contact.zip ?? prev.zip) : prev.zip,
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
    }
    const request = form.id
      ? supabase.from('citas').update(basePayload).eq('id', form.id)
      : supabase.from('citas').insert({ ...basePayload, owner_id: session?.user.id ?? '' })
    const { error } = await request
    if (error) {
      showToast(error.message, 'error')
      setSaving(false)
      return
    }
    showToast(form.id ? 'Cita actualizada' : 'Cita creada')
    setSaving(false)
    onSaved?.()
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
        {/* CONTACTO — obligatorio, ligado a cliente o lead real */}
        <label className="form-field">
          <span>Tipo de contacto</span>
          <select
            value={form.contacto_tipo}
            onChange={(event) => {
              const nextTipo = event.target.value as 'cliente' | 'lead'
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
        </label>
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
                  placeholder={form.contacto_tipo === 'lead' ? 'Buscar lead por nombre o telefono' : 'Buscar cliente por nombre o telefono'}
                />
                {contactLoading && <div className="form-hint">Buscando...</div>}
                {!contactLoading && contactSearch.trim().length >= 2 && contactResults.length === 0 && (
                  <div className="form-hint">Sin resultados</div>
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
