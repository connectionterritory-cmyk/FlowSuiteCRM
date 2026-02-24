import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'

type EstadoCuenta = 'actual' | 'cancelacion_total' | 'inactivo'

interface ClienteImport {
  hycite_id: string
  tipo_cliente: string
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  telefono_casa: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
  saldo_actual: number
  monto_moroso: number
  dias_atraso: number
  nivel: number
  estado_cuenta: EstadoCuenta
  elegible_addon: boolean
  fecha_ultimo_pedido: string | null
  origen: 'hycite_import'
  codigo_vendedor_hycite: string | null
  codigo_dist_hycite: string | null
  updated_at: string
}

interface Importacion {
  id: string
  archivo_nombre: string | null
  total_registros: number
  registros_nuevos: number
  registros_error: number
  created_at: string
}

type Step = 'idle' | 'preview' | 'importing' | 'done'

function limpiarTelefono(raw?: string): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, '')
  return d.length >= 7 ? d : null
}

function limpiarEmail(raw?: string): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  return e.includes('@') ? e : null
}

function parsearFecha(raw?: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function parsearMonto(raw?: string): number {
  if (!raw) return 0
  const n = parseFloat(raw.replace(/[$,\s]/g, ''))
  return isNaN(n) ? 0 : Math.abs(n)
}

function normalizarHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toUpperCase()
}

function buildNormalizedRow(row: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  Object.entries(row).forEach(([key, value]) => {
    const normalizedKey = normalizarHeader(key)
    if (!(normalizedKey in normalized)) {
      normalized[normalizedKey] = value
    }
  })
  return normalized
}

function obtenerCampo(
  row: Record<string, string>,
  normalizedRow: Record<string, string>,
  aliases: string[],
): string {
  for (const alias of aliases) {
    const raw = row[alias]
    if (raw && raw.trim()) return raw
    const normalized = normalizedRow[normalizarHeader(alias)]
    if (normalized && normalized.trim()) return normalized
  }
  return ''
}

function calcularMoroso(row: Record<string, string>): number {
  return (
    parsearMonto(row['0-30 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['31-60 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['61-90 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD'])
  )
}

function calcularAtraso(row: Record<string, string>): number {
  if (parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD']) > 0) return 91
  if (parsearMonto(row['61-90 DÍAS DE MOROSIDAD']) > 0) return 61
  if (parsearMonto(row['31-60 DÍAS DE MOROSIDAD']) > 0) return 31
  if (parsearMonto(row['0-30 DÍAS DE MOROSIDAD']) > 0) return 1
  return 0
}

function mapearEstado(s?: string): EstadoCuenta {
  const u = (s ?? '').toUpperCase()
  if (u === 'PURGED') return 'cancelacion_total'
  if (u === 'INACTIVE') return 'inactivo'
  return 'actual'
}

function parsearFila(row: Record<string, string>): ClienteImport | null {
  const normalizedRow = buildNormalizedRow(row)
  const hyciteId = obtenerCampo(row, normalizedRow, [
    '# DE CLIENTE',
    'Numero de cuenta hycite',
    'Numero de cuenta',
    'Cuenta',
    'Hycite ID',
  ]).trim()
  if (!hyciteId) return null
  const nivel = parseInt(obtenerCampo(row, normalizedRow, ['NIVEL']) || '1')
  const nombreRaw = obtenerCampo(row, normalizedRow, ['NOMBRE_1', 'NOMBRE', 'Nombre']).trim()
  const ap1 = obtenerCampo(row, normalizedRow, ['APELLIDO PATERNO', 'Apellido', 'Apellidos']).trim()
  const ap2 = obtenerCampo(row, normalizedRow, ['APELLIDO MATERNO']).trim()
  const apellidoRaw = [ap1, ap2].filter(Boolean).join(' ').trim()
  let nombre = nombreRaw || null
  let apellido = apellidoRaw || null
  if (!nombre && apellido) {
    nombre = apellido
    apellido = null
  }
  const ciudad = obtenerCampo(row, normalizedRow, ['CIUDAD', 'Ciudad']).trim() || null
  const estadoRegion = obtenerCampo(row, normalizedRow, ['ESTADO', 'Estado', 'Estado / Provincia']).trim() || null
  const codigoPostal = obtenerCampo(row, normalizedRow, ['ZIP CODE', 'ZIP', 'Codigo Postal', 'Codigo postal']).trim() || null
  const direccionRaw = obtenerCampo(row, normalizedRow, ['DIRECCIÓN', 'Direccion', 'Dirección']).replace(/\n/g, ', ').trim()
  const direccion = direccionRaw || [ciudad, estadoRegion, codigoPostal].filter(Boolean).join(', ') || null
  return {
    hycite_id: hyciteId,
    tipo_cliente: obtenerCampo(row, normalizedRow, ['CLIENTE']).trim() || 'HC',
    nombre,
    apellido,
    email: limpiarEmail(obtenerCampo(row, normalizedRow, ['CORREO ELECTRÓNICO', 'Correo', 'Email', 'email', 'E-mail'])),
    telefono: limpiarTelefono(obtenerCampo(row, normalizedRow, ['TELÉFONO MÓVIL', 'Telefono', 'Teléfono', 'Celular', 'Móvil'])),
    telefono_casa: limpiarTelefono(obtenerCampo(row, normalizedRow, ['TELÉFONO DE CASA'])),
    direccion,
    ciudad,
    estado_region: estadoRegion,
    codigo_postal: codigoPostal,
    saldo_actual: parsearMonto(obtenerCampo(row, normalizedRow, ['SALDO ACTUAL'])),
    monto_moroso: calcularMoroso(row),
    dias_atraso: calcularAtraso(row),
    nivel: isNaN(nivel) || nivel < 1 ? 1 : Math.min(nivel, 9),
    estado_cuenta: mapearEstado(obtenerCampo(row, normalizedRow, ['STATUS'])),
    elegible_addon: true,
    fecha_ultimo_pedido: parsearFecha(obtenerCampo(row, normalizedRow, ['ÚLTIMA FECHA DE COMPRA'])),
    origen: 'hycite_import',
    codigo_vendedor_hycite: obtenerCampo(row, normalizedRow, ['VENDEDOR']).trim() || null,
    codigo_dist_hycite: obtenerCampo(row, normalizedRow, ['DISTRIBUIDOR']).trim() || null,
    updated_at: new Date().toISOString(),
  }
}

function segmento(dias: number, moroso: number): string {
  if (!moroso) return 'Al día'
  if (dias >= 91) return '+90 días'
  if (dias >= 61) return '61-90 días'
  if (dias >= 31) return '31-60 días'
  if (dias >= 1) return '0-30 días'
  return 'Al día'
}

export function ImportacionesPage() {
  const { session } = useAuth()
  const { showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)

  const [step, setStep] = useState<Step>('idle')
  const [fileName, setFileName] = useState('')
  const [clientes, setClientes] = useState<ClienteImport[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importados, setImportados] = useState(0)
  const [errores, setErrores] = useState(0)
  const [historial, setHistorial] = useState<Importacion[]>([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)

  useEffect(() => {
    let active = true
    if (!configured || !session?.user.id) {
      setRole(null)
      return
    }
    setRoleLoading(true)
    const cargarRol = async () => {
      try {
        const { data } = await supabase
          .from('usuarios')
          .select('rol')
          .eq('id', session.user.id)
          .maybeSingle()
        if (!active) return
        setRole((data as { rol?: string } | null)?.rol ?? null)
      } finally {
        if (!active) return
        setRoleLoading(false)
      }
    }
    cargarRol()
    return () => {
      active = false
    }
  }, [configured, session?.user.id])

  const stats = {
    total: clientes.length,
    actuales: clientes.filter(c => c.estado_cuenta === 'actual').length,
    cancelados: clientes.filter(c => c.estado_cuenta === 'cancelacion_total').length,
    conMoroso: clientes.filter(c => c.monto_moroso > 0).length,
  }

  const cargarHistorial = useCallback(async () => {
    if (!configured) return
    setLoadingHistorial(true)
    const { data } = await supabase
      .from('importaciones_hycite')
      .select('id, archivo_nombre, total_registros, registros_nuevos, registros_error, created_at')
      .order('created_at', { ascending: false })
      .limit(10)
    setHistorial((data as Importacion[]) ?? [])
    setLoadingHistorial(false)
  }, [configured])

  useEffect(() => { cargarHistorial() }, [cargarHistorial])

  const procesarArchivo = useCallback((file: File) => {
    setParseError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary', raw: false, cellDates: false })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false })
        if (raw.length < 2) { setParseError('El archivo no tiene datos.'); return }
        const seen = new Map<string, number>()
        const headers = (raw[0] as string[]).map(h => {
          const c = seen.get(h) ?? 0; seen.set(h, c + 1)
          return c === 0 ? h : `${h}_${c}`
        })
        const rows: Record<string, string>[] = raw.slice(1).map(row =>
          Object.fromEntries(headers.map((h, i) => [h, String((row as string[])[i] ?? '').trim()]))
        )
        const validos = rows.map(parsearFila).filter((c): c is ClienteImport => c !== null)
        if (validos.length === 0) { setParseError('No se encontraron registros válidos.'); return }
        const uniq = new Map<string, ClienteImport>()
        validos.forEach((cliente) => {
          uniq.set(cliente.hycite_id, cliente)
        })
        setClientes(Array.from(uniq.values()))
        setStep('preview')
      } catch {
        setParseError('Error al leer el archivo.')
      }
    }
    reader.readAsBinaryString(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) procesarArchivo(file)
  }, [procesarArchivo])

  const handleImportar = async () => {
    if (!session?.user.id || clientes.length === 0) return
    setStep('importing')
    let imp = 0, err = 0
    for (let i = 0; i < clientes.length; i += 50) {
      const lote = clientes.slice(i, i + 50)
      const { data, error } = await supabase.from('clientes').upsert(lote, { onConflict: 'hycite_id' }).select('id')
      if (error) {
        for (const row of lote) {
          const { error: rowError } = await supabase
            .from('clientes')
            .upsert([row], { onConflict: 'hycite_id' })
            .select('id')
          if (rowError) {
            err += 1
          } else {
            imp += 1
          }
        }
      } else {
        imp += data?.length ?? 0
      }
    }
    await supabase.from('importaciones_hycite').insert({
      importado_por: session.user.id,
      tipo_cuenta: 'customer_list',
      total_registros: clientes.length,
      registros_nuevos: imp,
      registros_actualizados: 0,
      registros_error: err,
      archivo_nombre: fileName,
    })
    setImportados(imp); setErrores(err); setStep('done')
    if (err === 0) showToast(`✅ ${imp} clientes importados`)
    else showToast(`⚠️ ${imp} importados, ${err} errores`, 'error')
    cargarHistorial()
  }

  const resetear = () => { setStep('idle'); setClientes([]); setFileName(''); setParseError(null) }

  return (
    <div className="page-stack">
      {roleLoading ? (
        <div className="page">Cargando...</div>
      ) : role && role !== 'admin' && role !== 'distribuidor' ? (
        <div>
          <SectionHeader
            title="Importaciones"
            subtitle="Importaciones Hy-Cite"
          />
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Acceso restringido</p>
            <p style={{ fontSize: '0.9rem' }}>Solo administradores y distribuidores pueden usar este módulo.</p>
          </div>
        </div>
      ) : (
        <>
          <SectionHeader title="Importaciones Hy-Cite" subtitle="Importa tu cartera de clientes desde el archivo CustomerList de Hy-Cite" />
          <div className="card" style={{ padding: '1.5rem' }}>
            {step === 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                  Exporta desde <strong>Hy-Cite → Búsqueda de Cuenta → Exportar → Excel</strong> y sube el archivo aquí.
                </p>
                <div onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onClick={() => fileInputRef.current?.click()}
                  style={{ border: `2px dashed ${dragOver ? 'var(--color-primary, #3b82f6)' : 'var(--color-border, #374151)'}`, borderRadius: '0.75rem', padding: '3rem', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(59,130,246,0.05)' : 'var(--color-surface)', transition: 'all 0.2s' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📂</div>
                  <p style={{ margin: 0, fontWeight: 600 }}>Arrastra el archivo aquí</p>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>o haz clic para seleccionar — .xls / .xlsx</p>
                  <input ref={fileInputRef} type="file" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivo(f) }} />
                </div>
                {parseError && <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#dc2626', fontSize: '0.875rem' }}>❌ {parseError}</div>}
              </div>
            )}
            {step === 'preview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ padding: '0.75rem 1rem', background: 'var(--color-surface)', borderRadius: '0.5rem', fontSize: '0.875rem' }}>📄 <strong>{fileName}</strong></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                  {[{ label: 'Total', value: stats.total, color: '#3b82f6' }, { label: 'Actuales', value: stats.actuales, color: '#10b981' }, { label: 'Cancelados', value: stats.cancelados, color: '#6b7280' }, { label: 'Con morosidad', value: stats.conMoroso, color: '#f59e0b' }].map(s => (
                    <div key={s.label} style={{ padding: '0.875rem', background: 'var(--color-surface)', borderRadius: '0.5rem', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ overflowX: 'auto', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead><tr style={{ background: 'var(--color-surface)' }}>{['# Cliente', 'Nombre', 'Estado', 'Saldo', 'Morosidad'].map(h => <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600 }}>{h}</th>)}</tr></thead>
                    <tbody>{clientes.slice(0, 5).map(c => (
                      <tr key={c.hycite_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>{c.hycite_id}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{[c.nombre, c.apellido].filter(Boolean).join(' ') || '—'}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{c.estado_cuenta}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>${c.saldo_actual.toFixed(2)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: c.monto_moroso > 0 ? '#dc2626' : 'inherit' }}>{segmento(c.dias_atraso, c.monto_moroso)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {clientes.length > 5 && <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>+ {clientes.length - 5} registros más</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <Button variant="ghost" type="button" onClick={resetear}>← Cancelar</Button>
                  <Button type="button" onClick={handleImportar}>Importar {stats.total} clientes</Button>
                </div>
              </div>
            )}
            {step === 'importing' && (
              <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⏳</div>
                <p style={{ fontWeight: 600, margin: 0 }}>Importando {clientes.length} clientes...</p>
              </div>
            )}
            {step === 'done' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>{errores === 0 ? '✅' : '⚠️'}</div>
                  <p style={{ fontWeight: 700, fontSize: '1.1rem', margin: 0 }}>{errores === 0 ? 'Importación exitosa' : 'Completado con errores'}</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                  {[{ label: 'Total', value: clientes.length, color: '#3b82f6' }, { label: 'Importados', value: importados, color: '#10b981' }, { label: 'Errores', value: errores, color: errores > 0 ? '#dc2626' : '#6b7280' }].map(s => (
                    <div key={s.label} style={{ padding: '1rem', background: 'var(--color-surface)', borderRadius: '0.5rem', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <Button variant="ghost" type="button" onClick={resetear}>Nueva importación</Button>
                  <Button type="button" onClick={() => window.location.href = '/clientes'}>Ver clientes</Button>
                </div>
              </div>
            )}
          </div>
          <div>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Historial de importaciones</h3>
            {loadingHistorial ? <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Cargando...</p> : historial.length === 0 ? (
              <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No hay importaciones anteriores</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {historial.map(imp => (
                  <div key={imp.id} className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>{imp.archivo_nombre ?? 'Archivo sin nombre'}</p>
                      <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{new Date(imp.created_at).toLocaleString('es-MX')}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem' }}>
                      <span style={{ color: '#3b82f6' }}><strong>{imp.total_registros}</strong> total</span>
                      <span style={{ color: '#10b981' }}><strong>{imp.registros_nuevos}</strong> importados</span>
                      {imp.registros_error > 0 && <span style={{ color: '#dc2626' }}><strong>{imp.registros_error}</strong> errores</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
