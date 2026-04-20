import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase/client'
import { Button } from '../../components/Button'
import { useToast } from '../../components/useToast'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/UsersProvider'

type Motivo = 'parse_error' | 'baja_confianza' | 'fileid_vacio'
type AccionTomada = 'creado_lead' | 'creado_cliente' | 'descartado' | 'pendiente'

interface Revision {
  id: string
  file_name: string | null
  file_id: string | null
  drive_url: string | null
  raw_data: Record<string, unknown>
  motivo: Motivo
  tipo_tentativo: 'lead' | 'cliente' | null
  confianza_ia: 'alta' | 'media' | 'baja' | null
  revisado: boolean
  accion_tomada: AccionTomada | null
  notas_revisor: string | null
  created_at: string
}

interface RevisionForm {
  nombre: string
  apellido: string
  telefono: string
  email: string
  direccion: string
  ciudad: string
  estado_region: string
  codigo_postal: string
  destino: 'lead' | 'cliente'
  notas: string
}

const MOTIVO_LABEL: Record<Motivo, string> = {
  parse_error: 'Error de parseo',
  baja_confianza: 'Baja confianza',
  fileid_vacio: 'Sin file ID',
}

const MOTIVO_COLOR: Record<Motivo, string> = {
  parse_error: '#dc2626',
  baja_confianza: '#f59e0b',
  fileid_vacio: '#6b7280',
}

interface ImportRevisionesProps {
  onRefreshCount?: () => void
}

function getDriveImageUrl(driveUrl: string | null): string | null {
  if (!driveUrl) return null
  const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? `https://lh3.googleusercontent.com/d/${match[1]}` : null
}

function strVal(v: unknown): string {
  if (v == null || v === 'null') return ''
  return String(v)
}

function initForm(r: Revision): RevisionForm {
  const d = r.raw_data
  return {
    nombre: strVal(d.nombre),
    apellido: strVal(d.apellido),
    telefono: strVal(d.telefono_1 ?? d.telefono),
    email: strVal(d.email),
    direccion: strVal(d.direccion),
    ciudad: strVal(d.ciudad),
    estado_region: strVal(d.estado_region),
    codigo_postal: strVal(d.codigo_postal),
    destino: (r.tipo_tentativo as 'lead' | 'cliente') ?? 'lead',
    notas: r.notas_revisor ?? '',
  }
}

function cleanPhone(v: string): string | null {
  const d = v.replace(/\D/g, '').slice(-10)
  return d.length >= 7 ? d : null
}

export function ImportRevisiones({ onRefreshCount }: ImportRevisionesProps) {
  const { session } = useAuth()
  const { showToast } = useToast()
  const { currentUser } = useUsers()
  const org_id = currentUser?.org_id

  const [revisiones, setRevisiones] = useState<Revision[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Revision | null>(null)
  const [form, setForm] = useState<RevisionForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [showRevisadas, setShowRevisadas] = useState(false)
  const [imgError, setImgError] = useState(false)

  const cargar = useCallback(async () => {
    if (!org_id) return
    setLoading(true)
    const baseQuery = supabase
      .from('import_revisiones')
      .select('*')
      .eq('org_id', org_id)
      .order('created_at', { ascending: false })
      .limit(100)

    const { data, error } = showRevisadas
      ? await baseQuery
      : await baseQuery.eq('revisado', false)

    if (error) showToast('Error cargando revisiones', 'error')
    setRevisiones((data as Revision[]) ?? [])
    setLoading(false)
  }, [showRevisadas, showToast, org_id])

  useEffect(() => { cargar() }, [cargar])

  const abrirDetalle = (r: Revision) => {
    setSelected(r)
    setForm(initForm(r))
    setImgError(false)
  }

  const cerrar = () => {
    setSelected(null)
    setForm(null)
  }

  const updateForm = <K extends keyof RevisionForm>(key: K, value: RevisionForm[K]) =>
    setForm(prev => prev ? { ...prev, [key]: value } : null)

  const aprobar = async (accion: 'creado_lead' | 'creado_cliente') => {
    if (!selected || !form || !session?.user.id || !org_id) return
    setSaving(true)
    try {
      const telefono = cleanPhone(form.telefono)
      const base = {
        org_id,
        nombre: form.nombre || null,
        apellido: form.apellido || null,
        telefono,
        email: form.email || null,
        direccion: form.direccion || null,
        ciudad: form.ciudad || null,
        fuente_import: 'import_imagen_gdrive',
        import_file_name: selected.file_name,
        import_drive_url: selected.drive_url,
      }

      const { error: insertError } = accion === 'creado_cliente'
        ? await supabase.from('clientes').insert({
            ...base,
            estado_region: form.estado_region || null,
            codigo_postal: form.codigo_postal || null,
          })
        : await supabase.from('leads').insert({
            ...base,
            fuente: 'Prospectos OCR',
            estado_pipeline: 'Nuevo',
          })

      if (insertError) {
        showToast(`Error: ${insertError.message}`, 'error')
        return
      }

      await supabase.from('import_revisiones').update({
        revisado: true,
        revisado_por: session.user.id,
        revisado_at: new Date().toISOString(),
        accion_tomada: accion,
        notas_revisor: form.notas || null,
      }).eq('id', selected.id)

      if (selected.file_id) {
        await supabase.from('import_processed_files').upsert(
          { 
            org_id,
            file_id: selected.file_id, 
            run_id: 'manual_review', 
            destino: accion === 'creado_cliente' ? 'cliente' : 'lead' 
          },
          { onConflict: 'org_id,file_id' }
        )
      }

      showToast(accion === 'creado_cliente' ? 'Aprobado como cliente' : 'Aprobado como lead')
      onRefreshCount?.()
      cerrar()
      cargar()
    } finally {
      setSaving(false)
    }
  }

  const descartar = async () => {
    if (!selected || !session?.user.id || !org_id) return
    setSaving(true)
    await supabase.from('import_revisiones').update({
      revisado: true,
      revisado_por: session.user.id,
      revisado_at: new Date().toISOString(),
      accion_tomada: 'descartado',
      notas_revisor: form?.notas || null,
    }).eq('id', selected.id)
    showToast('Registro descartado')
    onRefreshCount?.()
    cerrar()
    cargar()
    setSaving(false)
  }

  const pendingCount = revisiones.filter(r => !r.revisado).length
  const imgUrl = selected ? getDriveImageUrl(selected.drive_url) : null

  const inputStyle: React.CSSProperties = {
    padding: '0.35rem 0.5rem',
    borderRadius: '0.375rem',
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    fontSize: '0.8rem',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {!showRevisadas && pendingCount > 0 && (
            <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '9999px', color: '#92400e', fontWeight: 700 }}>
              {pendingCount} pendientes
            </span>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--color-text-muted)', userSelect: 'none' }}>
            <input type="checkbox" checked={showRevisadas} onChange={e => setShowRevisadas(e.target.checked)} />
            Mostrar revisadas
          </label>
        </div>
        <Button variant="ghost" type="button" onClick={cargar}>↺ Recargar</Button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          Cargando...
        </div>
      ) : revisiones.length === 0 ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
          <p style={{ margin: 0, fontWeight: 600 }}>Sin registros pendientes</p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>El workflow OCR no ha enviado imágenes para revisión manual.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {revisiones.map(r => (
            <div
              key={r.id}
              onClick={() => abrirDetalle(r)}
              className="card"
              style={{
                padding: '0.875rem 1.1rem',
                display: 'flex', alignItems: 'center', gap: '1rem',
                cursor: 'pointer',
                opacity: r.revisado ? 0.55 : 1,
                borderLeft: `3px solid ${r.revisado ? '#10b981' : MOTIVO_COLOR[r.motivo]}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.file_name ?? r.file_id ?? 'Archivo sin nombre'}
                </p>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  {new Date(r.created_at).toLocaleString('es-MX')}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', background: `${MOTIVO_COLOR[r.motivo]}22`, color: MOTIVO_COLOR[r.motivo], fontWeight: 700 }}>
                  {MOTIVO_LABEL[r.motivo]}
                </span>
                {r.confianza_ia && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                    {r.confianza_ia}
                  </span>
                )}
                {r.revisado ? (
                  <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>
                    ✓ {r.accion_tomada?.replace('_', ' ')}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>Pendiente</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail drawer */}
      {selected && form && (
        <div className="drawer-backdrop" onClick={cerrar} role="presentation">
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            onClick={e => e.stopPropagation()}
          >
            <header className="drawer-header">
              <h3 id="drawer-title" style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                {selected.file_name ?? 'Revisión OCR'}
              </h3>
              <button type="button" className="icon-button" onClick={cerrar} aria-label="Cerrar">✕</button>
            </header>

            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* Image preview */}
              {imgUrl && !imgError ? (
                <div style={{ borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid var(--color-border)', background: '#f9fafb', maxHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={imgUrl}
                    alt="Imagen fuente"
                    onError={() => setImgError(true)}
                    style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', display: 'block' }}
                  />
                </div>
              ) : selected.drive_url ? (
                <div style={{ padding: '0.65rem 0.875rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '0.5rem', fontSize: '0.8rem' }}>
                  {imgError && <span style={{ color: 'var(--color-text-muted)' }}>Imagen no disponible directamente · </span>}
                  <a href={selected.drive_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary, #3b82f6)' }}>
                    Ver en Google Drive ↗
                  </a>
                </div>
              ) : null}

              {/* Metadata badges */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '9999px', background: `${MOTIVO_COLOR[selected.motivo]}22`, color: MOTIVO_COLOR[selected.motivo], fontWeight: 700 }}>
                  {MOTIVO_LABEL[selected.motivo]}
                </span>
                {selected.confianza_ia && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                    Confianza IA: <strong>{selected.confianza_ia}</strong>
                  </span>
                )}
                {selected.tipo_tentativo && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                    IA sugirió: <strong>{selected.tipo_tentativo}</strong>
                  </span>
                )}
              </div>

              {/* Editable form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Datos extraídos — edita si es necesario
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {([
                    ['nombre', 'Nombre'],
                    ['apellido', 'Apellido'],
                    ['telefono', 'Teléfono'],
                    ['email', 'Email'],
                    ['ciudad', 'Ciudad'],
                    ['estado_region', 'Estado / Prov (Dirección)'],
                    ['codigo_postal', 'Código postal'],
                  ] as [keyof RevisionForm, string][]).map(([key, label]) => (
                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</label>
                      <input
                        type="text"
                        value={form[key] as string}
                        onChange={e => updateForm(key, e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Dirección</label>
                  <input
                    type="text"
                    value={form.direccion}
                    onChange={e => updateForm('direccion', e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Clasificar como</label>
                  <select
                    value={form.destino}
                    onChange={e => updateForm('destino', e.target.value as 'lead' | 'cliente')}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    <option value="lead">Lead (prospecto)</option>
                    <option value="cliente">Cliente (evidencia de compra)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Notas del revisor</label>
                  <textarea
                    value={form.notas}
                    onChange={e => updateForm('notas', e.target.value)}
                    rows={2}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>
              </div>

              {/* Actions */}
              {selected.revisado ? (
                <div style={{ padding: '0.75rem', background: 'rgba(16,185,129,0.08)', borderRadius: '0.5rem', border: '1px solid #6ee7b7', fontSize: '0.8rem', color: '#065f46' }}>
                  ✓ Revisado · {selected.accion_tomada?.replace(/_/g, ' ')}
                  {selected.notas_revisor && <span> · {selected.notas_revisor}</span>}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Button
                    type="button"
                    onClick={() => aprobar(form.destino === 'cliente' ? 'creado_cliente' : 'creado_lead')}
                    disabled={saving}
                    style={{ flex: 1 }}
                  >
                    {saving ? 'Guardando...' : form.destino === 'cliente' ? 'Aprobar como Cliente' : 'Aprobar como Lead'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={descartar}
                    disabled={saving}
                  >
                    Descartar
                  </Button>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
