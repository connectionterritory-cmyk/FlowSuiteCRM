import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { formatProperName, formatProperText, formatStateRegion } from '../../lib/textFormat'

type AssignedOption = {
  id: string
  label: string
}

export type CitaForm = {
  id?: string
  start_at: string
  tipo: string
  estado: string
  notas: string
  direccion: string
  ciudad?: string
  estado_region?: string
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
  start_at: '',
  tipo: 'servicio',
  estado: 'programada',
  notas: '',
  direccion: '',
  ciudad: '',
  estado_region: '',
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
  { value: 'cancelada', label: 'Cancelada' },
]

const TIPO_OPTIONS = [
  { value: 'servicio', label: 'Servicio' },
  { value: 'demo', label: 'Demo' },
  { value: 'cobranza', label: 'Cobranza' },
  { value: 'reclutamiento', label: 'Reclutamiento' },
  { value: 'otro', label: 'Otro' },
]

const toIso = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function CitaModal({ open, onClose, onSaved, initialData, assignedOptions = [] }: CitaModalProps) {
  const { showToast } = useToast()
  const [form, setForm] = useState<CitaForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const next = { ...emptyForm, ...initialData }
    if (!next.assigned_to) {
      next.assigned_to = assignedOptions[0]?.id ?? ''
    }
    setForm(next)
  }, [assignedOptions, initialData, open])

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
    const payload = {
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      tipo: form.tipo.trim(),
      estado: form.estado.trim() || 'programada',
      notas: form.notas.trim() || null,
      direccion: form.direccion ? formatProperText(form.direccion) : null,
      ciudad: form.ciudad ? formatProperText(form.ciudad) : null,
      estado_region: form.estado_region ? formatStateRegion(form.estado_region) : null,
      assigned_to: form.assigned_to || null,
      nombre: form.contacto_nombre ? formatProperName(form.contacto_nombre) : null,
      telefono: form.contacto_telefono.trim() || null,
      contacto_tipo: form.contacto_tipo || null,
      contacto_id: form.contacto_id.trim() || null,
      campaign_id: form.campaign_id || null,
      message_id: form.message_id || null,
      response_id: form.response_id || null,
    }
    const request = form.id
      ? supabase.from('citas').update(payload).eq('id', form.id)
      : supabase.from('citas').insert(payload)
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
        <label className="form-field">
          <span>Contacto</span>
          <input
            value={form.contacto_nombre}
            onChange={(event) => setForm((prev) => ({ ...prev, contacto_nombre: event.target.value }))}
            placeholder="Nombre del cliente"
          />
        </label>
        <label className="form-field">
          <span>Teléfono</span>
          <input
            value={form.contacto_telefono}
            onChange={(event) => setForm((prev) => ({ ...prev, contacto_telefono: event.target.value }))}
            placeholder="+1 555 000 000"
          />
        </label>
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
