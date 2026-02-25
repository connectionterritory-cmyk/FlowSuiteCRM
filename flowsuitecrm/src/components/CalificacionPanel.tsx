import { type ClipboardEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase/client'
import { useToast } from './Toast'
import { IconRestore, IconSwap, IconTrash } from './icons'
import { parseUsAddress, buildMapsNavUrl, capitalizeProperName, type ParsedAddress } from '../lib/addressUtils'

type LeadCalificacion = {
  id: string
  nombre?: string | null
  apellido?: string | null
  email?: string | null
  telefono?: string | null
  direccion?: string | null
  apartamento?: string | null
  ciudad?: string | null
  estado_region?: string | null
  codigo_postal?: string | null
  fecha_nacimiento?: string | null
  fuente?: string | null
  owner_id?: string | null
  next_action?: string | null
  estado_civil?: string | null
  nombre_conyuge?: string | null
  telefono_conyuge?: string | null
  situacion_laboral?: string | null
  ninos_en_casa?: boolean | null
  cantidad_ninos?: number | null
  tiene_productos_rp?: boolean | null
  tipo_vivienda?: string | null
  deleted_at?: string | null
  deleted_reason?: string | null
}

type CalificacionPanelProps = {
  open: boolean
  lead: LeadCalificacion | null
  ownerName?: string | null
  fuenteLabel?: string | null
  canManage?: boolean
  onOpenManage?: (lead: LeadCalificacion, mode: 'delete' | 'reassign' | 'restore') => void
  onClose: () => void
  onSaved: () => Promise<void>
}

const initialForm = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  direccion: '',
  apartamento: '',
  ciudad: '',
  estado_region: '',
  codigo_postal: '',
  fecha_nacimiento: '',
  estado_civil: '',
  nombre_conyuge: '',
  telefono_conyuge: '',
  situacion_laboral: '',
  ninos_en_casa: 'no',
  cantidad_ninos: '',
  tiene_productos_rp: 'no',
  tipo_vivienda: '',
}

export function CalificacionPanel({
  open,
  lead,
  ownerName,
  fuenteLabel,
  canManage = false,
  onOpenManage,
  onClose,
  onSaved,
}: CalificacionPanelProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [formValues, setFormValues] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [parsedAddr, setParsedAddr] = useState<ParsedAddress | null>(null)

  useEffect(() => {
    if (!lead) return
    setFormValues({
      nombre: lead.nombre ?? '',
      apellido: lead.apellido ?? '',
      email: lead.email ?? '',
      telefono: lead.telefono ?? '',
      direccion: lead.direccion ?? '',
      apartamento: lead.apartamento ?? '',
      ciudad: lead.ciudad ?? '',
      estado_region: lead.estado_region ?? '',
      codigo_postal: lead.codigo_postal ?? '',
      fecha_nacimiento: lead.fecha_nacimiento ?? '',
      estado_civil: lead.estado_civil ?? '',
      nombre_conyuge: lead.nombre_conyuge ?? '',
      telefono_conyuge: lead.telefono_conyuge ?? '',
      situacion_laboral: lead.situacion_laboral ?? '',
      ninos_en_casa: lead.ninos_en_casa ? 'si' : 'no',
      cantidad_ninos: lead.cantidad_ninos ? String(lead.cantidad_ninos) : '',
      tiene_productos_rp: lead.tiene_productos_rp ? 'si' : 'no',
      tipo_vivienda: lead.tipo_vivienda ?? '',
    })
    setShowActions(false)
    setParsedAddr(null)
  }, [lead])

  const fullName = useMemo(() => {
    if (!lead) return '-'
    return [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
  }, [lead])

  const isDeleted = Boolean(lead?.deleted_at)

  if (!open || !lead) return null

  const handleChange = (field: keyof typeof initialForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value
      setFormValues((prev) => ({
        ...prev,
        [field]: value,
      }))
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

  const handleSave = async () => {
    if (!lead) return
    setSaving(true)
    setError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const isCasado = formValues.estado_civil === 'casado'
    const hasKids = formValues.ninos_en_casa === 'si'
    const payload: Record<string, unknown> = {
      nombre: toNull(formValues.nombre),
      apellido: toNull(formValues.apellido),
      email: toNull(formValues.email),
      telefono: toNull(formValues.telefono),
      estado_civil: formValues.estado_civil || null,
      nombre_conyuge: isCasado ? toNull(formValues.nombre_conyuge) : null,
      telefono_conyuge: isCasado ? toNull(formValues.telefono_conyuge) : null,
      situacion_laboral: formValues.situacion_laboral || null,
      ninos_en_casa: hasKids,
      cantidad_ninos: hasKids ? Number(formValues.cantidad_ninos) || null : null,
      tiene_productos_rp: formValues.tiene_productos_rp === 'si',
      tipo_vivienda: formValues.tipo_vivienda || null,
    }

    if (lead.direccion !== undefined) payload.direccion = toNull(formValues.direccion)
    if (lead.apartamento !== undefined) payload.apartamento = toNull(formValues.apartamento)
    if (lead.ciudad !== undefined) payload.ciudad = toNull(formValues.ciudad)
    if (lead.estado_region !== undefined) payload.estado_region = toNull(formValues.estado_region)
    if (lead.codigo_postal !== undefined) payload.codigo_postal = toNull(formValues.codigo_postal)
    if (lead.fecha_nacimiento !== undefined) payload.fecha_nacimiento = formValues.fecha_nacimiento || null

    const { error: updateError } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', lead.id)

    if (updateError) {
      setError(updateError.message)
      showToast(updateError.message, 'error')
    } else {
      await onSaved()
      showToast(t('toast.success'))
      setShowActions(true)
    }
    setSaving(false)
  }

  const handleQuickAction = (action: 'schedule' | 'add4en14' | 'done') => {
    setShowActions(false)
    if (action === 'done') {
      onClose()
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calificacion-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <h3 id="calificacion-title">{t('leads.calificacion.title')}</h3>
            <p className="drawer-subtitle">{fullName}</p>
            {(fuenteLabel || ownerName || lead.next_action) && (
              <p className="drawer-subtitle calificacion-meta">
                {(fuenteLabel ?? lead.fuente ?? '-')}
                {' · '}
                {(ownerName ?? lead.owner_id ?? '-')}
                {' · '}
                {(lead.next_action ?? '-')}
              </p>
            )}
            {isDeleted && (
              <p className="drawer-subtitle" style={{ color: '#b91c1c', fontWeight: 600 }}>
                Eliminado: {lead.deleted_reason ?? '-'}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {canManage && onOpenManage && !isDeleted && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onOpenManage(lead, 'reassign')}
                  aria-label="Reasignar"
                  title="Reasignar"
                >
                  <IconSwap />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onOpenManage(lead, 'delete')}
                  aria-label="Eliminar"
                  title="Eliminar"
                >
                  <IconTrash />
                </button>
              </>
            )}
            {canManage && onOpenManage && isDeleted && (
              <button
                type="button"
                className="icon-button"
                onClick={() => onOpenManage(lead, 'restore')}
                aria-label="Restaurar"
                title="Restaurar"
              >
                <IconRestore />
              </button>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              x
            </button>
          </div>
        </header>

        <div className="drawer-body">
          <div className="drawer-section">
            <h4>{t('leads.calificacion.generalTitle')}</h4>
            <div className="form-grid">
              <label className="form-field">
                <span>{t('leads.fields.nombre')}</span>
                <input value={formValues.nombre} onChange={handleChange('nombre')} onBlur={handleCapitalize('nombre')} />
              </label>
              <label className="form-field">
                <span>{t('leads.fields.apellido')}</span>
                <input value={formValues.apellido} onChange={handleChange('apellido')} onBlur={handleCapitalize('apellido')} />
              </label>
              <label className="form-field">
                <span>{t('leads.fields.email')}</span>
                <input type="email" value={formValues.email} onChange={handleChange('email')} />
              </label>
              <label className="form-field">
                <span>{t('leads.fields.telefono')}</span>
                <input value={formValues.telefono} onChange={handleChange('telefono')} />
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.general.direccion')}</span>
                <input
                  value={formValues.direccion}
                  onChange={handleChange('direccion')}
                  onPaste={handleDireccionPaste}
                  placeholder="Pega la dirección completa para auto-rellenar"
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
                <span>{t('leads.calificacion.general.apartamento')}</span>
                <input value={formValues.apartamento} onChange={handleChange('apartamento')} />
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.general.ciudad')}</span>
                <input value={formValues.ciudad} onChange={handleChange('ciudad')} />
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.general.estadoRegion')}</span>
                <input value={formValues.estado_region} onChange={handleChange('estado_region')} />
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.general.codigoPostal')}</span>
                <input value={formValues.codigo_postal} onChange={handleChange('codigo_postal')} />
              </label>
              {(formValues.direccion || formValues.ciudad) && (() => {
                const mapsUrl = buildMapsNavUrl({
                  direccion: formValues.direccion || null,
                  ciudad: formValues.ciudad || null,
                  estado_region: formValues.estado_region || null,
                  codigo_postal: formValues.codigo_postal || null,
                })
                return mapsUrl ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '0.82rem',
                        color: '#10b981',
                        fontWeight: 700,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        padding: '0.25rem 0.75rem',
                        border: '1px solid #10b98133',
                        borderRadius: '9999px',
                        background: '#10b98111',
                      }}
                    >
                      🗺 Ver en mapa / Navegar
                    </a>
                  </div>
                ) : null
              })()}
              <label className="form-field">
                <span>{t('leads.calificacion.general.fechaNacimiento')}</span>
                <input
                  type="date"
                  value={formValues.fecha_nacimiento}
                  onChange={handleChange('fecha_nacimiento')}
                />
              </label>
            </div>
          </div>

          <div className="drawer-section">
            <h4>{t('leads.calificacion.ventaTitle')}</h4>
            <div className="form-grid">
              <label className="form-field">
                <span>{t('leads.calificacion.estadoCivil')}</span>
                <select value={formValues.estado_civil} onChange={handleChange('estado_civil')}>
                  <option value="">{t('common.select')}</option>
                  <option value="soltero">{t('leads.calificacion.estados.soltero')}</option>
                  <option value="casado">{t('leads.calificacion.estados.casado')}</option>
                  <option value="viudo">{t('leads.calificacion.estados.viudo')}</option>
                  <option value="divorciado">{t('leads.calificacion.estados.divorciado')}</option>
                </select>
              </label>
              {formValues.estado_civil === 'casado' && (
                <>
                  <label className="form-field">
                    <span>{t('leads.calificacion.nombreConyuge')}</span>
                    <input value={formValues.nombre_conyuge} onChange={handleChange('nombre_conyuge')} />
                  </label>
                  <label className="form-field">
                    <span>{t('leads.calificacion.telefonoConyuge')}</span>
                    <input value={formValues.telefono_conyuge} onChange={handleChange('telefono_conyuge')} />
                  </label>
                </>
              )}
              <label className="form-field">
                <span>{t('leads.calificacion.situacionLaboral')}</span>
                <select value={formValues.situacion_laboral} onChange={handleChange('situacion_laboral')}>
                  <option value="">{t('common.select')}</option>
                  <option value="solo">{t('leads.calificacion.laboral.solo')}</option>
                  <option value="ambos">{t('leads.calificacion.laboral.ambos')}</option>
                  <option value="ninguno">{t('leads.calificacion.laboral.ninguno')}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.ninosCasa')}</span>
                <select value={formValues.ninos_en_casa} onChange={handleChange('ninos_en_casa')}>
                  <option value="no">{t('common.no')}</option>
                  <option value="si">{t('common.yes')}</option>
                </select>
              </label>
              {formValues.ninos_en_casa === 'si' && (
                <label className="form-field">
                  <span>{t('leads.calificacion.cantidadNinos')}</span>
                  <input type="number" value={formValues.cantidad_ninos} onChange={handleChange('cantidad_ninos')} />
                </label>
              )}
              <label className="form-field">
                <span>{t('leads.calificacion.productosRp')}</span>
                <select value={formValues.tiene_productos_rp} onChange={handleChange('tiene_productos_rp')}>
                  <option value="no">{t('common.no')}</option>
                  <option value="si">{t('common.yes')}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{t('leads.calificacion.vivienda')}</span>
                <select value={formValues.tipo_vivienda} onChange={handleChange('tipo_vivienda')}>
                  <option value="">{t('common.select')}</option>
                  <option value="duenos">{t('leads.calificacion.viviendaOptions.duenos')}</option>
                  <option value="rentan">{t('leads.calificacion.viviendaOptions.rentan')}</option>
                </select>
              </label>
            </div>
            {error && <div className="form-error">{error}</div>}
          </div>
          {showActions && (
            <div className="drawer-section">
              <div className="calificacion-next-actions">
                <span className="calificacion-next-title">{t('leads.calificacion.actions.title')}</span>
                <div className="calificacion-next-buttons">
                  <button type="button" className="btn ghost" onClick={() => handleQuickAction('schedule')}>
                    {t('leads.calificacion.actions.schedule')}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => handleQuickAction('add4en14')}>
                    {t('leads.calificacion.actions.add4en14')}
                  </button>
                  <button type="button" className="btn primary" onClick={() => handleQuickAction('done')}>
                    {t('leads.calificacion.actions.done')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('leads.calificacion.saveAll')}
          </button>
        </div>
      </aside>
    </div>
  )
}
