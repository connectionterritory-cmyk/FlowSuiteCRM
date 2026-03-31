import { useEffect, useMemo, useState } from 'react'
import { Button } from './Button'
import { LABEL_STYLE, INPUT_STYLE } from './FormControls'
import { Modal } from './Modal'

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

type TipoOption = {
  value: GestionTipo
  label: string
}

export const GESTION_TYPES_BY_ROLE: Record<GestionRole, GestionTipo[]> = {
  admin: ['llamada', 'whatsapp', 'nota', 'seguimiento', 'visita', 'email', 'cita_completada', 'venta', 'referidos', 'envio_material'],
  distribuidor: ['llamada', 'whatsapp', 'nota', 'seguimiento', 'visita', 'email', 'venta'],
  vendedor: ['llamada', 'whatsapp', 'nota', 'seguimiento', 'visita', 'email', 'cita_completada', 'venta', 'referidos', 'envio_material'],
  telemercadeo: ['llamada', 'whatsapp', 'nota', 'seguimiento'],
}

const TIPO_OPTIONS: TipoOption[] = [
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

export function buildGestionAutoSummary(tipo: GestionTipo, resultado: GestionResultado | null) {
  const tipoLabel = TIPO_OPTIONS.find((option) => option.value === tipo)?.label ?? tipo
  const resultadoLabel = Object.values(RESULTADO_OPTIONS_BY_TYPE)
    .flat()
    .find((option) => option.value === resultado)?.label
  return resultadoLabel ? `${tipoLabel} — ${resultadoLabel}` : tipoLabel
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
  const [showFollowup, setShowFollowup] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(createInitialDraft({ contacto, role, tipoDefault, moduloOrigen, origenId }))
    setShowFollowup(false)
  }, [contacto, moduloOrigen, open, origenId, role, tipoDefault])

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
          {contacto ? (
            <div style={{ marginTop: '0.45rem', display: 'grid', gap: '0.2rem' }}>
              <strong>{contacto.nombre}</strong>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
                {contacto.tipo.toUpperCase()}
                {contacto.telefono ? ` · ${contacto.telefono}` : ''}
                {contacto.email ? ` · ${contacto.email}` : ''}
              </span>
            </div>
          ) : (
            <div style={{ marginTop: '0.45rem', color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
              La búsqueda global del contacto se conectará en la siguiente fase.
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
