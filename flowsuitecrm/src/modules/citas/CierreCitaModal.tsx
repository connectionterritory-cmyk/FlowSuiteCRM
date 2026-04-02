import type { CitaForm, CierreActividad, CierreTarea, AssignedOption } from './CitaModal'
import { PRODUCTOS_OPTIONS, RESULTADO_OPTIONS, TAREA_PRIORIDAD_OPTIONS, TAREA_TIPO_OPTIONS } from './CitaModal'

type CierreCitaModalProps = {
  estado: string
  resultado: string | null
  resultado_notas: string | null
  next_action_date: string | null
  cierreActividad: CierreActividad
  cierreTarea: CierreTarea
  assignedOptions: AssignedOption[]
  isFollowUpTaskInvalid: boolean
  onFormPatch: (patch: Partial<Pick<CitaForm, 'resultado' | 'resultado_notas' | 'next_action_date'>>) => void
  onCierreActividadChange: (updater: CierreActividad | ((prev: CierreActividad) => CierreActividad)) => void
  onCierreTareaChange: (updater: CierreTarea | ((prev: CierreTarea) => CierreTarea)) => void
}


export function CierreCitaModal({
  estado,
  resultado,
  resultado_notas,
  next_action_date,
  cierreActividad,
  cierreTarea,
  assignedOptions,
  isFollowUpTaskInvalid,
  onFormPatch,
  onCierreActividadChange,
  onCierreTareaChange,
}: CierreCitaModalProps) {
  if (estado !== 'completada') {
    return (
      <>
        {(resultado === 'reagendar' || estado === 'no_show') && (
          <label className="form-field">
            <span>
              Fecha del próximo paso <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span>
            </span>
            <input
              type="date"
              value={next_action_date ?? ''}
              onChange={(event) => onFormPatch({ next_action_date: event.target.value })}
            />
            <div className="form-hint">Se asignará "Reagendar cita" como próxima acción en el contacto.</div>
          </label>
        )}
      </>
    )
  }

  return (
    <>
      <label className="form-field">
        <span>Resultado <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span></span>
        <select
          value={resultado ?? ''}
          onChange={(event) => onFormPatch({ resultado: event.target.value })}
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
          value={resultado_notas ?? ''}
          onChange={(event) => onFormPatch({ resultado_notas: event.target.value })}
          placeholder="Detalle del resultado"
        />
      </label>

      {/* ── Resumen corto para el timeline ── */}
      <label className="form-field" style={{ gridColumn: 'span 2' }}>
        <span>Resumen de la visita</span>
        <input
          value={cierreActividad.resumen}
          onChange={(e) => onCierreActividadChange((prev) => ({ ...prev, resumen: e.target.value }))}
          placeholder="Ej: Demo realizada, 20 referidos, interés en purificador"
        />
      </label>

      {/* ── Checkboxes: qué pasó ── */}
      <div className="form-field" style={{ gridColumn: 'span 2' }}>
        <span>¿Qué pasó en la visita?</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem' }}>
          {(
            [
              { key: 'demo_realizada', label: 'Demo realizada' },
              { key: 'muestra_entregada', label: 'Muestra entregada' },
              { key: 'referidos_obtenidos', label: 'Referidos obtenidos' },
            ] as const
          ).map(({ key, label }) => (
            <label
              key={key}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={cierreActividad[key]}
                onChange={(e) =>
                  onCierreActividadChange((prev) => ({ ...prev, [key]: e.target.checked }))
                }
              />
              {label}
            </label>
          ))}
          {cierreActividad.referidos_obtenidos && (
            <input
              type="number"
              min="0"
              max="999"
              value={cierreActividad.referidos_count}
              onChange={(e) =>
                onCierreActividadChange((prev) => ({ ...prev, referidos_count: e.target.value }))
              }
              placeholder="Cantidad"
              style={{ width: 90 }}
            />
          )}
        </div>
      </div>

      {/* ── Productos de interés (solo si demo) ── */}
      {cierreActividad.demo_realizada && (
        <div className="form-field" style={{ gridColumn: 'span 2' }}>
          <span>Productos de interés</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem' }}>
            {PRODUCTOS_OPTIONS.map((producto) => (
              <label
                key={producto.value}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={cierreActividad.productos_interes.includes(producto.value)}
                  onChange={(e) =>
                    onCierreActividadChange((prev) => ({
                      ...prev,
                      productos_interes: e.target.checked
                        ? [...prev.productos_interes, producto.value]
                        : prev.productos_interes.filter((p) => p !== producto.value),
                    }))
                  }
                />
                {producto.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Tarea de seguimiento ── */}
      <div
        className="form-field"
        style={{
          gridColumn: 'span 2',
          borderTop: '1px solid var(--color-border, #374151)',
          paddingTop: '0.75rem',
        }}
      >
        <label
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 500 }}
        >
          <input
            type="checkbox"
            checked={cierreTarea.crear_tarea}
            onChange={(e) => onCierreTareaChange((prev) => ({ ...prev, crear_tarea: e.target.checked }))}
          />
          Crear tarea de seguimiento
        </label>
        {cierreTarea.crear_tarea && isFollowUpTaskInvalid && (
          <div
            style={{
              marginTop: '0.5rem',
              color: 'var(--color-error, #dc2626)',
              fontSize: '0.875rem',
            }}
          >
            Completa tipo, asignado y fecha para crear la tarea.
          </div>
        )}
      </div>

      {cierreTarea.crear_tarea && (
        <>
          <label className="form-field">
            <span>Tipo de tarea</span>
            <select
              value={cierreTarea.tipo}
              onChange={(e) => onCierreTareaChange((prev) => ({ ...prev, tipo: e.target.value }))}
            >
              {TAREA_TIPO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Asignar a</span>
            <select
              value={cierreTarea.asignado_a}
              onChange={(e) =>
                onCierreTareaChange((prev) => ({ ...prev, asignado_a: e.target.value }))
              }
            >
              {assignedOptions.length === 0 && <option value="">Sin opciones</option>}
              {assignedOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>
              Fecha <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span>
            </span>
            <input
              type="date"
              value={cierreTarea.fecha_vencimiento}
              onChange={(e) => onCierreTareaChange((prev) => ({ ...prev, fecha_vencimiento: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Hora (opcional)</span>
            <input
              type="time"
              value={cierreTarea.hora_vencimiento}
              onChange={(e) => onCierreTareaChange((prev) => ({ ...prev, hora_vencimiento: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Prioridad</span>
            <select
              value={cierreTarea.prioridad}
              onChange={(e) => onCierreTareaChange((prev) => ({ ...prev, prioridad: e.target.value }))}
            >
              {TAREA_PRIORIDAD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Descripción</span>
            <input
              value={cierreTarea.descripcion}
              onChange={(e) => onCierreTareaChange((prev) => ({ ...prev, descripcion: e.target.value }))}
              placeholder="Ej: Enviar videos de purificador y multipana"
            />
          </label>
        </>
      )}

      {(resultado === 'reagendar' || estado === 'no_show') && (
        <label className="form-field">
          <span>
            Fecha del próximo paso <span style={{ color: 'var(--color-error, #dc2626)' }}>*</span>
          </span>
          <input
            type="date"
            value={next_action_date ?? ''}
            onChange={(event) => onFormPatch({ next_action_date: event.target.value })}
          />
          <div className="form-hint">Se asignará "Reagendar cita" como próxima acción en el contacto.</div>
        </label>
      )}
    </>
  )
}
