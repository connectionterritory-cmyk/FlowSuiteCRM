import { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '../../components/Button'
import { useToast } from '../../components/useToast'
import { supabase } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/UsersProvider'

type TargetTable = 'clientes' | 'leads'
type Step = 'upload' | 'mapping' | 'preview' | 'confirm' | 'importing' | 'result'
type SheetRow = (string | number | boolean | Date | null | undefined)[]

interface ImportErrorRow {
  rowNumber: number
  registro: string
  campo: string
  valor: string
  mensaje: string
  recomendacion: string
}

// ── Parsed row types ──────────────────────────────────────────────────────────

interface ClienteGeneral {
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  telefono_casa: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
  tipo_cliente: string | null
  estado_cuenta: string | null
  estado_morosidad: string | null
  dias_atraso: number
  saldo_actual: number
  emprendedor_raw: string | null
  origen: 'manual'
}

interface LeadGeneral {
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
  fuente: string | null
  estado_pipeline: string
}

// ── Field definitions ─────────────────────────────────────────────────────────

interface FieldDef {
  key: string
  label: string
  aliases: string[]
}

const CLIENTE_FIELDS: FieldDef[] = [
  { key: 'nombre_completo', label: 'Nombre completo', aliases: ['NOMBRE', 'NOMBRE COMPLETO', 'FULL NAME', 'CUSTOMER NAME'] },
  { key: 'nombre', label: 'Nombre (solo)', aliases: ['PRIMER NOMBRE', 'FIRST NAME', 'NOMBRE 1'] },
  { key: 'apellido', label: 'Apellido', aliases: ['APELLIDO', 'APELLIDOS', 'LAST NAME', 'APELLIDO PATERNO'] },
  { key: 'telefono', label: 'Teléfono Móvil', aliases: ['TEL MOVIL', 'TELEFONO MOVIL', 'MOVIL', 'CELULAR', 'MOBILE', 'TEL MOVIL'] },
  { key: 'telefono_casa', label: 'Tel. Casa / Trabajo', aliases: ['TEL CASA', 'TELEFONO CASA', 'HOME PHONE', 'TEL TRABAJO', 'TRABAJO'] },
  { key: 'email', label: 'Email', aliases: ['EMAIL', 'CORREO', 'CORREO ELECTRONICO', 'E-MAIL'] },
  { key: 'direccion', label: 'Dirección', aliases: ['DIRECCION', 'DIRECCION', 'ADDRESS', 'DOMICILIO'] },
  { key: 'ciudad', label: 'Ciudad', aliases: ['CIUDAD', 'CITY', 'LOCALIDAD'] },
  { key: 'estado_region', label: 'Estado / Región', aliases: ['ESTADO', 'REGION', 'STATE', 'PROVINCIA'] },
  { key: 'codigo_postal', label: 'ZIP / Código Postal', aliases: ['ZIP', 'CODIGO POSTAL', 'POSTAL CODE', 'CP'] },
  { key: 'tipo_cuenta', label: 'Tipo de Cuenta', aliases: ['TIPO CUENTA', 'TIPO DE CUENTA', 'ACCOUNT TYPE'] },
  { key: 'estado_cuenta', label: 'Estado de Cuenta', aliases: ['ESTADO CUENTA', 'ESTADO DE CUENTA', 'ACCOUNT STATUS'] },
  { key: 'saldo_actual', label: 'Saldo Actual', aliases: ['SALDO ACTUAL', 'SALDO', 'BALANCE', 'CUSTOMER BALANCE'] },
  { key: 'emprendedor', label: 'Emprendedor / Vendedor', aliases: ['EMPRENDEDOR', 'EMPRENDEDORES', 'VENDEDOR', 'ENTREPRENEUR'] },
]

const LEAD_FIELDS: FieldDef[] = [
  { key: 'nombre_completo', label: 'Nombre completo', aliases: ['NOMBRE', 'NOMBRE COMPLETO', 'FULL NAME'] },
  { key: 'nombre', label: 'Nombre (solo)', aliases: ['PRIMER NOMBRE', 'FIRST NAME'] },
  { key: 'apellido', label: 'Apellido', aliases: ['APELLIDO', 'LAST NAME'] },
  { key: 'telefono', label: 'Teléfono', aliases: ['TEL MOVIL', 'TELEFONO', 'PHONE', 'CELULAR', 'MOVIL', 'TEL CASA', 'TELEFONO CASA'] },
  { key: 'email', label: 'Email', aliases: ['EMAIL', 'CORREO', 'CORREO ELECTRONICO'] },
  { key: 'direccion', label: 'Dirección', aliases: ['DIRECCION', 'ADDRESS', 'DOMICILIO'] },
  { key: 'ciudad', label: 'Ciudad', aliases: ['CIUDAD', 'CITY'] },
  { key: 'estado_region', label: 'Estado / Región', aliases: ['ESTADO', 'STATE', 'REGION', 'PROVINCIA'] },
  { key: 'codigo_postal', label: 'ZIP', aliases: ['ZIP', 'CODIGO POSTAL', 'POSTAL CODE'] },
  { key: 'fuente', label: 'Fuente', aliases: ['FUENTE', 'SOURCE', 'ESTADO LEAD', 'ORIGEN', 'CAMPAIGN'] },
  { key: 'estado_lead', label: 'Estado del Lead', aliases: ['ESTADO LEAD', 'STATUS', 'ESTADO'] },
]

// ── Utilities ─────────────────────────────────────────────────────────────────

function normHeader(v: string): string {
  return v
    .replace(/\uFEFF/g, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase()
}

function limpiarTel(raw?: string): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, '')
  return d.length >= 7 ? d : null
}

function limpiarEmail(raw?: string): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  return e.includes('@') ? e : null
}

function parseMonto(raw?: string): number {
  if (!raw) return 0
  const n = parseFloat(raw.replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : Math.abs(n)
}

function splitNombre(full: string): { nombre: string | null; apellido: string | null } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return { nombre: null, apellido: null }
  if (parts.length === 1) return { nombre: parts[0], apellido: null }
  return { nombre: parts[0], apellido: parts.slice(1).join(' ') }
}

function getCell(row: Record<string, string>, mapping: Record<string, string>, key: string): string {
  const col = mapping[key]
  if (!col) return ''
  return row[col]?.trim() ?? ''
}

function parseEstadoCuenta(raw: string): { estado_cuenta: string | null; estado_morosidad: string | null; dias_atraso: number } {
  const u = raw.toUpperCase()
  if (u.includes('CANCELACI') || u.includes('PURGADO') || u.includes('PURGED')) {
    return { estado_cuenta: 'cancelacion_total', estado_morosidad: null, dias_atraso: 0 }
  }
  if (u.includes('CARGO DE VUELTA') || u.includes('CHARGE BACK') || u.includes('CHARGEBACK')) {
    return { estado_cuenta: 'cancelacion_total', estado_morosidad: null, dias_atraso: 0 }
  }
  if (u.includes('INACTIV')) {
    return { estado_cuenta: 'inactivo', estado_morosidad: null, dias_atraso: 0 }
  }
  if (u.includes('0 A 30') || u.includes('0-30')) {
    return { estado_cuenta: 'actual', estado_morosidad: '0-30', dias_atraso: 1 }
  }
  if (u.includes('31 A 60') || u.includes('31-60')) {
    return { estado_cuenta: 'actual', estado_morosidad: '31-60', dias_atraso: 31 }
  }
  if (u.includes('61 A 90') || u.includes('61-90')) {
    return { estado_cuenta: 'actual', estado_morosidad: '61-90', dias_atraso: 61 }
  }
  if (u.includes('90') || u.includes('91')) {
    return { estado_cuenta: 'actual', estado_morosidad: '91+', dias_atraso: 91 }
  }
  if (u.includes('ACTUAL') || u.includes('CURRENT') || u.includes('AL DIA') || u.includes('AL DÍA')) {
    return { estado_cuenta: 'actual', estado_morosidad: null, dias_atraso: 0 }
  }
  return { estado_cuenta: null, estado_morosidad: null, dias_atraso: 0 }
}

function parseTipoCuenta(raw: string): string | null {
  const u = raw.toUpperCase()
  if (u.includes('REVOLVING') || u.includes('REVOLV')) return 'revolving'
  if (u.includes('EFECTIVO') || u.includes('CASH')) return 'efectivo'
  if (u.includes('CLOSED') || u.includes('CERRADO')) return 'closed_end'
  return raw.trim() || null
}

function parseEmprendedorCode(raw: string): string | null {
  if (!raw) return null
  // "RODA0627 - ANDRES RODRIGUEZ" → "RODA0627"
  const match = raw.match(/^([A-Z0-9]+)\s*[-–]/)
  if (match) return match[1].trim()
  // "RAMJ0791" (sin nombre) → "RAMJ0791"
  if (/^[A-Z]{3,5}\d{4}/.test(raw.trim())) return raw.trim().split(/\s/)[0]
  return null
}

function getRegistroLabel(row: Pick<ClienteGeneral | LeadGeneral, 'nombre' | 'apellido' | 'telefono' | 'email'>): string {
  return [row.nombre, row.apellido].filter(Boolean).join(' ') || row.telefono || row.email || 'Sin nombre'
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'vacío'
  return String(value)
}

function inferErrorDetail(message: string, payload: Record<string, unknown>): Pick<ImportErrorRow, 'campo' | 'valor' | 'recomendacion'> {
  const lower = message.toLowerCase()
  const quotedColumn = message.match(/column "([^"]+)"/i)?.[1]
  const nullColumn = message.match(/null value in column "([^"]+)"/i)?.[1]
  const keyColumn = message.match(/key \(([^)]+)\)=/i)?.[1]?.split(',')[0]?.trim()
  const invalidEnumValue = message.match(/invalid input value for enum [^:]+: "([^"]+)"/i)?.[1]
  const invalidEnumField = invalidEnumValue
    ? Object.entries(payload).find(([, value]) => String(value) === invalidEnumValue)?.[0]
    : null
  const campo = nullColumn || quotedColumn || keyColumn || 'registro'

  if (invalidEnumValue) {
    return {
      campo: invalidEnumField || campo,
      valor: invalidEnumValue,
      recomendacion: 'Usa un valor permitido por el enum de Supabase o guarda este dato en una columna de trazabilidad.',
    }
  }

  if (lower.includes('row-level security') || lower.includes('rls')) {
    return {
      campo: 'permisos',
      valor: 'RLS',
      recomendacion: 'Verifica que el usuario tenga permiso para insertar o actualizar este registro en su organización.',
    }
  }

  if (lower.includes('duplicate key')) {
    return {
      campo,
      valor: compactValue(payload[campo]),
      recomendacion: 'Revisa duplicados o define una regla de actualización para este identificador.',
    }
  }

  if (lower.includes('violates not-null constraint') || lower.includes('null value in column')) {
    return {
      campo,
      valor: compactValue(payload[campo]),
      recomendacion: `Completa el campo obligatorio ${campo} antes de importar.`,
    }
  }

  if (lower.includes('invalid input syntax')) {
    return {
      campo,
      valor: compactValue(payload[campo]),
      recomendacion: 'Revisa el formato del valor en el archivo o en el mapeo.',
    }
  }

  if (lower.includes('violates check constraint')) {
    return {
      campo,
      valor: compactValue(payload[campo]),
      recomendacion: 'El valor no coincide con los valores permitidos por la base de datos.',
    }
  }

  if (lower.includes('foreign key constraint')) {
    return {
      campo,
      valor: compactValue(payload[campo]),
      recomendacion: 'Verifica que el ID relacionado exista y pertenezca a la organización correcta.',
    }
  }

  return {
    campo,
    valor: compactValue(payload[campo]),
    recomendacion: 'Revisa el mensaje técnico y el valor enviado a Supabase.',
  }
}

function autoDetectMapping(headers: string[], fields: FieldDef[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  fields.forEach(field => {
    for (const header of headers) {
      const nh = normHeader(header)
      const matched = field.aliases.some(alias => {
        const na = normHeader(alias)
        return na === nh || (na.length >= 4 && nh.includes(na)) || (nh.length >= 4 && na.includes(nh))
      })
      if (matched && !mapping[field.key]) {
        mapping[field.key] = header
        break
      }
    }
  })
  return mapping
}

function parseClienteRow(row: Record<string, string>, mapping: Record<string, string>): ClienteGeneral | null {
  const nombreCompleto = getCell(row, mapping, 'nombre_completo')
  const nombreSolo = getCell(row, mapping, 'nombre')
  const apellidoSolo = getCell(row, mapping, 'apellido')

  let nombre: string | null = null
  let apellido: string | null = null

  if (nombreSolo) {
    nombre = nombreSolo || null
    apellido = apellidoSolo || null
  } else if (nombreCompleto) {
    const split = splitNombre(nombreCompleto)
    nombre = split.nombre
    apellido = apellidoSolo || split.apellido
  }

  if (!nombre && !getCell(row, mapping, 'telefono') && !getCell(row, mapping, 'telefono_casa')) return null

  const estadoCuentaRaw = getCell(row, mapping, 'estado_cuenta')
  const { estado_cuenta, estado_morosidad, dias_atraso } = parseEstadoCuenta(estadoCuentaRaw)

  const telMovil = limpiarTel(getCell(row, mapping, 'telefono'))
  const telCasa = limpiarTel(getCell(row, mapping, 'telefono_casa'))

  return {
    nombre,
    apellido,
    email: limpiarEmail(getCell(row, mapping, 'email')),
    telefono: telMovil || telCasa || null,
    telefono_casa: telCasa || null,
    direccion: getCell(row, mapping, 'direccion') || null,
    ciudad: getCell(row, mapping, 'ciudad') || null,
    estado_region: getCell(row, mapping, 'estado_region') || null,
    codigo_postal: getCell(row, mapping, 'codigo_postal') || null,
    tipo_cliente: parseTipoCuenta(getCell(row, mapping, 'tipo_cuenta')),
    estado_cuenta,
    estado_morosidad,
    dias_atraso,
    saldo_actual: parseMonto(getCell(row, mapping, 'saldo_actual')),
    emprendedor_raw: getCell(row, mapping, 'emprendedor') || null,
    origen: 'manual',
  }
}

function parseLeadRow(row: Record<string, string>, mapping: Record<string, string>): LeadGeneral | null {
  const nombreCompleto = getCell(row, mapping, 'nombre_completo')
  const nombreSolo = getCell(row, mapping, 'nombre')
  const apellidoSolo = getCell(row, mapping, 'apellido')

  let nombre: string | null = null
  let apellido: string | null = null

  if (nombreSolo) {
    nombre = nombreSolo || null
    apellido = apellidoSolo || null
  } else if (nombreCompleto) {
    const split = splitNombre(nombreCompleto)
    nombre = split.nombre
    apellido = apellidoSolo || split.apellido
  }

  const estadoLeadRaw = getCell(row, mapping, 'estado_lead').toUpperCase()
  // Skip rows that are already clients
  if (estadoLeadRaw.includes('YA ES CLIENTE') || estadoLeadRaw.includes('CLIENTE')) {
    return null
  }

  const tel = limpiarTel(getCell(row, mapping, 'telefono'))

  if (!nombre && !tel) return null

  return {
    nombre,
    apellido,
    email: limpiarEmail(getCell(row, mapping, 'email')),
    telefono: tel,
    direccion: getCell(row, mapping, 'direccion') || null,
    ciudad: getCell(row, mapping, 'ciudad') || null,
    estado_region: getCell(row, mapping, 'estado_region') || null,
    codigo_postal: getCell(row, mapping, 'codigo_postal') || null,
    fuente: getCell(row, mapping, 'fuente') || null,
    estado_pipeline: 'nuevo',
  }
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ['Tipo & Archivo', 'Mapeo', 'Vista previa', 'Resultado']
const STEP_IDX: Record<Step, number> = { upload: 0, mapping: 1, preview: 2, confirm: 2, importing: 2, result: 3 }

function StepBar({ step }: { step: Step }) {
  const cur = STEP_IDX[step]
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.5rem' }}>
      {STEPS.map((label, i) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
            <div style={{
              width: '1.75rem', height: '1.75rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.75rem', fontWeight: 700,
              background: i < cur ? '#10b981' : i === cur ? 'var(--color-primary, #3b82f6)' : 'var(--color-surface)',
              border: `2px solid ${i < cur ? '#10b981' : i === cur ? 'var(--color-primary, #3b82f6)' : 'var(--color-border)'}`,
              color: i <= cur ? '#fff' : 'var(--color-text-muted)',
            }}>
              {i < cur ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: '0.65rem', whiteSpace: 'nowrap', color: i === cur ? 'var(--color-primary, #3b82f6)' : i < cur ? '#10b981' : 'var(--color-text-muted)', fontWeight: i === cur ? 700 : 400 }}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 1, height: '2px', background: i < cur ? '#10b981' : 'var(--color-border)', margin: '0 0.25rem', marginBottom: '1rem' }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImportGeneral() {
  const { session } = useAuth()
  const { showToast } = useToast()
  const { currentUser } = useUsers()
  const org_id = currentUser?.org_id
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [target, setTarget] = useState<TargetTable>('clientes')
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})

  const [clienteRows, setClienteRows] = useState<ClienteGeneral[]>([])
  const [leadRows, setLeadRows] = useState<LeadGeneral[]>([])
  const [skipped, setSkipped] = useState(0)

  const [importados, setImportados] = useState(0)
  const [actualizados, setActualizados] = useState(0)
  const [errores, setErrores] = useState(0)
  const [errorRows, setErrorRows] = useState<ImportErrorRow[]>([])
  const [showErrorDetails, setShowErrorDetails] = useState(false)

  const fields = target === 'clientes' ? CLIENTE_FIELDS : LEAD_FIELDS

  // ── File parsing ──────────────────────────────────────────────────────────

  const procesarArchivo = useCallback((file: File) => {
    setParseError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary', raw: false, cellDates: false })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const allRows = XLSX.utils.sheet_to_json<SheetRow>(ws, { header: 1, defval: '', raw: false })

        // Find header row
        const keywords = ['NOMBRE', 'TELEFONO', 'EMAIL', 'CORREO', 'DIRECCION', 'CIUDAD', 'ESTADO', 'ZIP', 'FUENTE']
        let headerIndex = -1
        for (let i = 0; i < Math.min(allRows.length, 20); i++) {
          const row = allRows[i]
          if (!row || row.length < 2) continue
          const rowStr = row.map(c => normHeader(String(c ?? ''))).join('|')
          if (keywords.some(k => rowStr.includes(k))) { headerIndex = i; break }
        }
        if (headerIndex === -1) { setParseError('No se detectó fila de encabezados.'); return }

        const raw = allRows.slice(headerIndex)
        const seen = new Map<string, number>()
        const headers = raw[0].map(cell => {
          const s = String(cell || '').trim()
          const c = seen.get(s) ?? 0; seen.set(s, c + 1)
          return c === 0 ? s : `${s}_${c}`
        })
        const rows: Record<string, string>[] = raw.slice(1)
          .map(row => Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '').trim()])))
          .filter(row => Object.values(row).some(v => v.trim()))

        if (rows.length === 0) { setParseError('No se encontraron filas de datos.'); return }

        const visibleHeaders = headers.filter(h => h.trim())
        setRawHeaders(visibleHeaders)
        setRawRows(rows)
        setMapping(autoDetectMapping(visibleHeaders, fields))
        setStep('mapping')
      } catch {
        setParseError('Error al leer el archivo.')
      }
    }
    reader.readAsBinaryString(file)
  }, [fields])

  // ── Apply mapping → preview ───────────────────────────────────────────────

  const procesarConMapping = useCallback(() => {
    if (target === 'clientes') {
      const parsed = rawRows.map(row => parseClienteRow(row, mapping)).filter((r): r is ClienteGeneral => r !== null)
      if (parsed.length === 0) { showToast('Sin registros válidos con el mapeo actual.', 'error'); return }
      setClienteRows(parsed)
      setSkipped(rawRows.length - parsed.length)
      setStep('preview')
    } else {
      let skip = 0
      const parsed: LeadGeneral[] = []
      for (const row of rawRows) {
        const estadoLeadRaw = (mapping['estado_lead'] ? row[mapping['estado_lead']] ?? '' : '').toUpperCase()
        if (estadoLeadRaw.includes('YA ES CLIENTE') || estadoLeadRaw.includes('YA ES C')) {
          skip++
          continue
        }
        const r = parseLeadRow(row, mapping)
        if (r) parsed.push(r)
        else skip++
      }
      if (parsed.length === 0) { showToast('Sin registros válidos. Si todos son "Ya es cliente", no hay leads para importar.', 'error'); return }
      setLeadRows(parsed)
      setSkipped(skip)
      setStep('preview')
    }
  }, [rawRows, mapping, target, showToast])

  // ── Import clientes ───────────────────────────────────────────────────────

  const importarClientes = async () => {
    if (!session?.user.id || !org_id) return
    setStep('importing')
    let imp = 0, up = 0, err = 0
    const nextErrorRows: ImportErrorRow[] = []

    // Build emprendedor code → vendedor_id map
    const codes = [...new Set(clienteRows.map(r => parseEmprendedorCode(r.emprendedor_raw ?? '')).filter(Boolean))] as string[]
    const vendedorMap = new Map<string, string>()
    if (codes.length > 0) {
      const { data: vendedores } = await supabase
        .from('usuarios')
        .select('id, codigo_vendedor_hycite')
        .eq('org_id', org_id)
        .in('codigo_vendedor_hycite', codes)
      for (const v of vendedores ?? []) {
        if (v.codigo_vendedor_hycite) vendedorMap.set(v.codigo_vendedor_hycite, v.id)
      }
    }

    for (let i = 0; i < clienteRows.length; i += 50) {
      const lote = clienteRows.slice(i, i + 50)
      const tels = lote.map(r => r.telefono).filter(Boolean) as string[]

      // Check existing by telefono
      const existingMap = new Map<string, string>()
      if (tels.length > 0) {
        const { data: existentes } = await supabase
          .from('clientes')
          .select('id, telefono')
          .eq('org_id', org_id)
          .in('telefono', tels)
        for (const e of existentes ?? []) {
          if (e.telefono) existingMap.set(e.telefono, e.id)
        }
      }

      const payloads = lote.map(r => {
        const code = parseEmprendedorCode(r.emprendedor_raw ?? '')
        const vendedorId = (code && vendedorMap.get(code)) || session!.user.id
        const existingId = r.telefono ? existingMap.get(r.telefono) : undefined
        const base = {
          org_id,
          nombre: r.nombre,
          apellido: r.apellido,
          email: r.email,
          telefono: r.telefono,
          telefono_casa: r.telefono_casa,
          direccion: r.direccion,
          ciudad: r.ciudad,
          estado_region: r.estado_region,
          codigo_postal: r.codigo_postal,
          tipo_cliente: r.tipo_cliente ?? 'HC',
          estado_cuenta: r.estado_cuenta,
          estado_morosidad: r.estado_morosidad,
          dias_atraso: r.dias_atraso,
          saldo_actual: r.saldo_actual,
          vendedor_id: vendedorId,
          codigo_vendedor_hycite: code,
          origen: 'manual' as const,
          fuente_import: 'general_import',
          import_file_name: fileName,
          updated_at: new Date().toISOString(),
        }
        if (existingId) return { ...base, id: existingId }
        return base
      })

      const toInsert = payloads
        .map((payload, sourceIndex) => ({ payload, sourceIndex }))
        .filter(item => !('id' in item.payload))
      const toUpdate = payloads
        .map((payload, sourceIndex) => ({ payload, sourceIndex }))
        .filter(item => 'id' in item.payload)

      if (toInsert.length > 0) {
        const { error } = await supabase.from('clientes').insert(toInsert.map(item => item.payload))
        if (error) {
          console.error('Insert batch error:', error)
          for (let j = 0; j < toInsert.length; j++) {
            const { payload, sourceIndex } = toInsert[j]
            const { error: singleError } = await supabase.from('clientes').insert(payload)
            if (singleError) {
              console.error('Insert row error:', singleError)
              err++
              const detail = inferErrorDetail(singleError.message, payload as Record<string, unknown>)
              const row = lote[sourceIndex]
              nextErrorRows.push({
                rowNumber: i + sourceIndex + 2,
                registro: getRegistroLabel(row),
                mensaje: singleError.message,
                ...detail,
              })
            } else {
              imp++
            }
          }
        } else imp += toInsert.length
      }

      for (const { payload, sourceIndex } of toUpdate) {
        const { id, ...rest } = payload as typeof payload & { id: string }
        const { error } = await supabase.from('clientes').update(rest).eq('id', id)
        if (error) {
          err++
          console.error('Update error:', error)
          const detail = inferErrorDetail(error.message, rest as Record<string, unknown>)
          nextErrorRows.push({
            rowNumber: i + sourceIndex + 2,
            registro: getRegistroLabel(lote[sourceIndex]),
            mensaje: error.message,
            ...detail,
          })
        }
        else up++
      }
    }

    setErrorRows(nextErrorRows)
    setShowErrorDetails(nextErrorRows.length > 0)
    setImportados(imp)
    setActualizados(up)
    setErrores(err)
    setStep('result')
    if (err === 0) showToast(`✅ ${imp} nuevos, ${up} actualizados`)
    else showToast(`⚠️ ${imp} nuevos, ${up} actualizados, ${err} errores`, 'error')
  }

  // ── Import leads ──────────────────────────────────────────────────────────

  const importarLeads = async () => {
    if (!session?.user.id || !org_id) return
    setStep('importing')
    let imp = 0, err = 0
    const nextErrorRows: ImportErrorRow[] = []

    for (let i = 0; i < leadRows.length; i += 50) {
      const lote = leadRows.slice(i, i + 50)
      const payloads = lote.map(r => ({
        org_id,
        nombre: r.nombre,
        apellido: r.apellido,
        email: r.email,
        telefono: r.telefono,
        direccion: r.direccion,
        ciudad: r.ciudad,
        estado_region: r.estado_region,
        codigo_postal: r.codigo_postal,
        fuente: r.fuente,
        estado_pipeline: r.estado_pipeline,
        owner_id: session!.user.id,
        vendedor_id: session!.user.id,
        fuente_import: 'general_import',
        import_file_name: fileName,
      }))

      const { error } = await supabase.from('leads').insert(payloads)
      if (error) {
        console.error('Lead insert batch error:', error)
        for (let j = 0; j < payloads.length; j++) {
          const payload = payloads[j] as Record<string, unknown>
          const { error: singleError } = await supabase.from('leads').insert(payload)
          if (singleError) {
            console.error('Lead insert row error:', singleError)
            err++
            const detail = inferErrorDetail(singleError.message, payload)
            nextErrorRows.push({
              rowNumber: i + j + 2,
              registro: getRegistroLabel(lote[j]),
              mensaje: singleError.message,
              ...detail,
            })
          } else {
            imp++
          }
        }
      }
      else imp += lote.length
    }

    setErrorRows(nextErrorRows)
    setShowErrorDetails(nextErrorRows.length > 0)
    setImportados(imp)
    setErrores(err)
    setStep('result')
    if (err === 0) showToast(`✅ ${imp} leads importados`)
    else showToast(`⚠️ ${imp} importados, ${err} errores`, 'error')
  }

  const handleImportar = () => target === 'clientes' ? importarClientes() : importarLeads()

  const resetear = () => {
    setStep('upload')
    setFileName('')
    setParseError(null)
    setRawHeaders([])
    setRawRows([])
    setMapping({})
    setClienteRows([])
    setLeadRows([])
    setSkipped(0)
    setImportados(0)
    setActualizados(0)
    setErrores(0)
    setErrorRows([])
    setShowErrorDetails(false)
  }

  const previewRows = target === 'clientes' ? clienteRows : leadRows
  const totalRows = previewRows.length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      {step !== 'upload' && step !== 'importing' && <StepBar step={step} />}

      {/* ── Step 1: Upload ──────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {(['clientes', 'leads'] as TargetTable[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTarget(t)}
                style={{
                  flex: 1, padding: '0.75rem', borderRadius: '0.5rem', cursor: 'pointer',
                  border: `2px solid ${target === t ? 'var(--color-primary, #3b82f6)' : 'var(--color-border)'}`,
                  background: target === t ? 'rgba(59,130,246,0.08)' : 'var(--color-surface)',
                  color: target === t ? 'var(--color-primary, #3b82f6)' : 'inherit',
                  fontWeight: target === t ? 700 : 400, fontSize: '0.9rem',
                }}
              >
                {t === 'clientes' ? '👥 Clientes' : '🎯 Leads / Prospectos'}
              </button>
            ))}
          </div>

          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            {target === 'clientes'
              ? 'Importa clientes desde Excel o CSV. Sin necesidad de ID Hy-Cite.'
              : 'Importa prospectos desde Excel o CSV. Los registros "Ya es cliente" se omitirán.'}
          </p>

          <div
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f) }}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'var(--color-primary, #3b82f6)' : 'var(--color-border)'}`,
              borderRadius: '0.75rem', padding: '3rem', textAlign: 'center', cursor: 'pointer',
              background: dragOver ? 'rgba(59,130,246,0.05)' : 'var(--color-surface)', transition: 'all 0.2s',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📂</div>
            <p style={{ margin: 0, fontWeight: 600 }}>Arrastra el archivo aquí</p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>o haz clic — .xls / .xlsx / .csv</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,.csv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivo(f) }}
            />
          </div>

          {parseError && (
            <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#dc2626', fontSize: '0.875rem' }}>
              ❌ {parseError}
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Mapping ─────────────────────────────────────────────── */}
      {step === 'mapping' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', gap: '1rem' }}>
            <span>📄 <strong>{fileName}</strong></span>
            <span>·</span>
            <span><strong>{rawRows.length}</strong> filas</span>
            <span>·</span>
            <span>Destino: <strong>{target === 'clientes' ? 'Clientes' : 'Leads'}</strong></span>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface)' }}>
                  <th style={{ padding: '0.6rem 0.875rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: '45%' }}>Campo del sistema</th>
                  <th style={{ padding: '0.6rem 0.875rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Columna del archivo</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(field => (
                  <tr key={field.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.5rem 0.875rem' }}>{field.label}</td>
                    <td style={{ padding: '0.5rem 0.875rem' }}>
                      <select
                        value={mapping[field.key] ?? ''}
                        onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                        style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '0.375rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.8rem' }}
                      >
                        <option value="">— No mapear —</option>
                        {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Se requiere al menos <strong>Nombre</strong> o <strong>Teléfono</strong> para identificar cada registro.
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="ghost" type="button" onClick={resetear}>← Cancelar</Button>
            <Button type="button" onClick={procesarConMapping}>Vista previa →</Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Preview ─────────────────────────────────────────────── */}
      {(step === 'preview' || step === 'confirm') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            📄 <strong>{fileName}</strong>
          </div>

          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
            {[
              { label: 'A importar', value: totalRows, color: '#3b82f6', icon: '📋' },
              { label: 'Omitidos', value: skipped, color: skipped > 0 ? '#f59e0b' : '#6b7280', icon: '⏭️' },
              { label: 'Sin teléfono', value: previewRows.filter(r => !r.telefono).length, color: '#dc2626', icon: '📵' },
            ].map(s => (
              <div key={s.label} style={{ padding: '0.75rem', background: 'var(--color-surface)', borderRadius: '0.5rem', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: '0.9rem', marginBottom: '0.15rem' }}>{s.icon}</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {skipped > 0 && target === 'leads' && (
            <div style={{ padding: '0.6rem 1rem', background: 'rgba(245,158,11,0.08)', border: '1px solid #fcd34d', borderRadius: '0.5rem', fontSize: '0.8rem', color: '#92400e' }}>
              ⏭️ {skipped} fila{skipped !== 1 ? 's' : ''} omitida{skipped !== 1 ? 's' : ''}: "Ya es cliente" o sin datos mínimos.
            </div>
          )}

          {/* Preview table */}
          <div style={{ overflowX: 'auto', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface)' }}>
                  {target === 'clientes'
                    ? ['Nombre', 'Teléfono', 'Ciudad', 'Estado Cuenta', 'Saldo', 'Emprendedor'].map(h => (
                        <th key={h} style={{ padding: '0.45rem 0.65rem', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))
                    : ['Nombre', 'Teléfono', 'Ciudad', 'Fuente'].map(h => (
                        <th key={h} style={{ padding: '0.45rem 0.65rem', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))
                  }
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 15).map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.4rem 0.65rem' }}>{[r.nombre, r.apellido].filter(Boolean).join(' ') || <span style={{ color: '#f59e0b', fontStyle: 'italic' }}>sin nombre</span>}</td>
                    <td style={{ padding: '0.4rem 0.65rem', fontFamily: 'monospace', fontSize: '0.72rem', color: !r.telefono ? '#dc2626' : 'inherit' }}>{r.telefono ?? '—'}</td>
                    <td style={{ padding: '0.4rem 0.65rem' }}>{r.ciudad ?? '—'}</td>
                    {target === 'clientes' && (
                      <>
                        <td style={{ padding: '0.4rem 0.65rem' }}>{(r as ClienteGeneral).estado_cuenta ?? '—'}</td>
                        <td style={{ padding: '0.4rem 0.65rem' }}>${((r as ClienteGeneral).saldo_actual ?? 0).toFixed(2)}</td>
                        <td style={{ padding: '0.4rem 0.65rem', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{parseEmprendedorCode((r as ClienteGeneral).emprendedor_raw ?? '') ?? '—'}</td>
                      </>
                    )}
                    {target === 'leads' && (
                      <td style={{ padding: '0.4rem 0.65rem', fontSize: '0.72rem' }}>{(r as LeadGeneral).fuente ?? '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalRows > 15 && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>+ {totalRows - 15} registros más</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="ghost" type="button" onClick={() => setStep('mapping')}>← Mapeo</Button>
            <Button type="button" onClick={handleImportar} disabled={totalRows === 0}>
              Importar {totalRows} registros
            </Button>
          </div>
        </div>
      )}

      {/* ── Importing ───────────────────────────────────────────────────── */}
      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⏳</div>
          <p style={{ fontWeight: 600 }}>Importando {totalRows} registros...</p>
          <p style={{ fontSize: '0.8rem' }}>No cierres esta ventana.</p>
        </div>
      )}

      {/* ── Result ──────────────────────────────────────────────────────── */}
      {step === 'result' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <h3 style={{ margin: 0, fontWeight: 700 }}>
            {errores === 0 ? '✅ Importación completada' : '⚠️ Importación con errores'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
            {[
              { label: 'Nuevos', value: importados, color: '#10b981', icon: '✨' },
              ...(target === 'clientes' ? [{ label: 'Actualizados', value: actualizados, color: '#6366f1', icon: '🔄' }] : []),
              { label: 'Errores', value: errores, color: errores > 0 ? '#dc2626' : '#6b7280', icon: '❌' },
            ].map(s => (
              <div key={s.label} style={{ padding: '1rem', background: 'var(--color-surface)', borderRadius: '0.5rem', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: '0.9rem' }}>{s.icon}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {errores > 0 && errorRows.length > 0 && (
            <div style={{ border: '1px solid #fecaca', borderRadius: '0.5rem', overflow: 'hidden', background: '#fef2f2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#991b1b' }}>
                    {errorRows.length} error{errorRows.length !== 1 ? 'es' : ''} con detalle
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#b91c1c', marginTop: '0.15rem' }}>
                    Supabase devolvió el mensaje técnico por fila.
                  </div>
                </div>
                <Button variant="ghost" type="button" onClick={() => setShowErrorDetails(prev => !prev)}>
                  {showErrorDetails ? 'Ocultar errores' : 'Ver errores'}
                </Button>
              </div>

              {showErrorDetails && (
                <div style={{ overflowX: 'auto', background: 'var(--color-surface)', borderTop: '1px solid #fecaca' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr>
                        {['Fila', 'Registro', 'Campo', 'Valor', 'Mensaje técnico', 'Recomendación'].map(h => (
                          <th key={h} style={{ padding: '0.55rem 0.65rem', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {errorRows.slice(0, 100).map((row, i) => (
                        <tr key={`${row.rowNumber}-${i}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '0.5rem 0.65rem', fontFamily: 'monospace' }}>{row.rowNumber}</td>
                          <td style={{ padding: '0.5rem 0.65rem', minWidth: '9rem' }}>{row.registro}</td>
                          <td style={{ padding: '0.5rem 0.65rem', fontFamily: 'monospace', color: '#dc2626' }}>{row.campo}</td>
                          <td style={{ padding: '0.5rem 0.65rem', maxWidth: '12rem', wordBreak: 'break-word' }}>{row.valor}</td>
                          <td style={{ padding: '0.5rem 0.65rem', maxWidth: '20rem', wordBreak: 'break-word' }}>{row.mensaje}</td>
                          <td style={{ padding: '0.5rem 0.65rem', minWidth: '14rem' }}>{row.recomendacion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {errorRows.length > 100 && (
                    <p style={{ margin: 0, padding: '0.6rem 0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                      Mostrando los primeros 100 errores de {errorRows.length}.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {errores > 0 && errorRows.length === 0 && (
            <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#b91c1c', fontSize: '0.85rem' }}>
              La importación falló antes de recibir detalles por fila. Revisa sesión, organización y permisos.
            </div>
          )}

          <Button type="button" onClick={resetear}>Nueva importación</Button>
        </div>
      )}
    </div>
  )
}
