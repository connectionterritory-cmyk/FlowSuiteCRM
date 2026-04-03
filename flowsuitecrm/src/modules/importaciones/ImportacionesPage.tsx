import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { useToast } from '../../components/useToast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'

type EstadoCuenta = 'actual' | 'cancelacion_total' | 'inactivo'
type Step = 'upload' | 'mapping' | 'preview' | 'confirm' | 'importing' | 'result'
type ReportType = 'customer_list' | 'birthday_report'
type SheetCell = string | number | boolean | Date | null | undefined
type SheetRow = SheetCell[]

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
  estado_morosidad: string | null
  nivel: number
  estado_cuenta: EstadoCuenta
  elegible_addon: boolean
  fecha_ultimo_pedido: string | null
  ultima_fecha_pago: string | null
  origen: 'hycite_import'
  codigo_vendedor_hycite: string | null
  codigo_dist_hycite: string | null
  updated_at: string
  fecha_nacimiento?: string | null
  estado_operativo?: string
}

interface Importacion {
  id: string
  archivo_nombre: string | null
  total_registros: number
  registros_nuevos: number
  registros_error: number
  created_at: string
}

interface PreviewKpis {
  existentes: number
  nuevos: number
  conFechaNac: number
  conMoroso: number
  sinTelefono: number
}

interface SystemFieldDef {
  key: string
  label: string
  required: boolean
  canonicalAlias: string
  aliases: string[]
}

// ─── System field definitions ────────────────────────────────────────────────

const SYSTEM_FIELDS_DEF: SystemFieldDef[] = [
  {
    key: 'hycite_id',
    label: '# Cliente (Hy-Cite ID)',
    required: true,
    canonicalAlias: '# DE CLIENTE',
    aliases: [
      '# DE CLIENTE', 'HYCITE ID', 'HYCITEID', 'CUSTOMER NO', 'CUSTOMER #', 'CUSTOMER#',
      'N DE CLIENTE', 'NUMERO DE CLIENTE', 'CUENTA', 'CUENTA HYCITE', 'CUENTA FINANCIERA',
      'N DE CLIEN', 'N DE CLI', 'NO DE CLIENTE', 'CLIENTE #',
    ],
  },
  {
    key: 'nombre',
    label: 'Nombre',
    required: false,
    canonicalAlias: 'NOMBRE',
    aliases: ['NOMBRE', 'NOMBRE 1', 'NOMBRE1', 'CUSTOMER NAME', 'NOMBRE COMPLETO', 'FIRST NAME'],
  },
  {
    key: 'apellido',
    label: 'Apellido',
    required: false,
    canonicalAlias: 'APELLIDO PATERNO',
    aliases: ['APELLIDO PATERNO', 'APELLIDO', 'APELLIDOS', 'LAST NAME', 'APELLIDO MATERNO'],
  },
  {
    key: 'telefono',
    label: 'Teléfono (móvil)',
    required: false,
    canonicalAlias: 'TELÉFONO MÓVIL',
    aliases: ['TELEFONO MOVIL', 'TELEFONO MOVIL', 'CELULAR', 'MOVIL', 'MOBILE PHONE', 'MOBILE', 'TELEFONO', 'HOME PHONE'],
  },
  {
    key: 'email',
    label: 'Email',
    required: false,
    canonicalAlias: 'CORREO ELECTRÓNICO',
    aliases: ['CORREO ELECTRONICO', 'CORREO ELECTRONICO', 'EMAIL', 'E-MAIL', 'CORREO'],
  },
  {
    key: 'estado_cuenta',
    label: 'Estado de cuenta',
    required: false,
    canonicalAlias: 'ESTADO CUENTA',
    aliases: ['ESTADO CUENTA', 'ESTADO DE CUENTA', 'STATUS CUENTA', 'STATUS', 'ESTADO'],
  },
  {
    key: 'saldo_actual',
    label: 'Saldo actual',
    required: false,
    canonicalAlias: 'SALDO ACTUAL',
    aliases: ['SALDO ACTUAL', 'CUSTOMER BALANCE', 'BALANCE', 'SALDO'],
  },
  {
    key: 'monto_moroso',
    label: 'Monto moroso',
    required: false,
    canonicalAlias: 'MONTO MOROSO',
    aliases: ['MONTO MOROSO', 'DELINQUENT', 'MOROSO', 'DELINCUENCIA'],
  },
  {
    key: 'fecha_nacimiento',
    label: 'Fecha de nacimiento',
    required: false,
    canonicalAlias: 'BIRTH DAY',
    aliases: ['BIRTH DAY', 'BIRTHDAY', 'CUMPLEANOS', 'CUMPLEAÑOS', 'FECHA NACIMIENTO'],
  },
]

const ESTADO_OPERATIVO_MAP: Record<EstadoCuenta, string> = {
  actual: 'activo',
  inactivo: 'inactivo',
  cancelacion_total: 'cancelado',
}

// ─── Date/month helpers ───────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  'JANUARY': '01', 'FEBRUARY': '02', 'MARCH': '03', 'APRIL': '04',
  'MAY': '05', 'JUNE': '06', 'JULY': '07', 'AUGUST': '08',
  'SEPTEMBER': '09', 'OCTOBER': '10', 'NOVEMBER': '11', 'DECEMBER': '12',
  'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
  'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
  'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12',
}

// ─── Pure utility functions (unchanged) ──────────────────────────────────────

function limpiarTelefono(raw?: string): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, '')
  return d.length >= 7 ? d : null
}

function normalizarTelefono(raw?: string | null): string | null {
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, m, d, y] = slash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dash) {
    const [, d, m, y] = dash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

function parsearMonto(raw?: string): number {
  if (!raw) return 0
  const clean = raw.replace(/[^0-9.]/g, '')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

function normalizarHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[º°]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
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

function calcularMoroso(row: Record<string, string>, normalizedRow: Record<string, string>): number {
  const delinquentDirect = parsearMonto(obtenerCampo(row, normalizedRow, ['DELINQUENT', 'DELINCUENCIA', 'MOROSO', 'MOROSIDAD']))
  if (delinquentDirect > 0) return delinquentDirect
  return (
    parsearMonto(row['0-30 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['31-60 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['61-90 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD'])
  )
}

function calcularAtraso(row: Record<string, string>, normalizedRow: Record<string, string>): number {
  if (parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD']) > 0) return 91
  if (parsearMonto(row['61-90 DÍAS DE MOROSIDAD']) > 0) return 61
  if (parsearMonto(row['31-60 DÍAS DE MOROSIDAD']) > 0) return 31
  if (parsearMonto(row['0-30 DÍAS DE MOROSIDAD']) > 0) return 1
  const estado = obtenerCampo(row, normalizedRow, ['STATUS', 'ESTADO', 'Status', 'Estado']).toUpperCase()
  if (estado.includes('90')) return 91
  if (estado.includes('61')) return 61
  if (estado.includes('31')) return 31
  if (estado.includes('0 A 30') || estado.includes('0-30')) return 1
  if (estado.includes('ATRASO') || estado.includes('MOR') || estado.includes('DELINQUENT')) return 1
  return 0
}

function mapearEstadoMorosidad(
  row: Record<string, string>,
  normalizedRow: Record<string, string>,
  dias: number,
  moroso: number,
): string | null {
  const estadoRaw = obtenerCampo(row, normalizedRow, [
    'STATUS MOROSIDAD', 'ESTADO MOROSIDAD', 'ESTADO DE MOROSIDAD',
    'ESTADO ATRASO', 'MOROSIDAD', 'STATUS', 'ESTADO',
  ]).trim()
  const u = estadoRaw.toUpperCase()
  const hasMorosidadKeyword =
    u.includes('DIAS') || u.includes('ATRASO') || u.includes('DELINQUENT') ||
    u.includes('MORO') || u.includes('PURG') || u.includes('0-30') ||
    u.includes('31-60') || u.includes('61-90') || u.includes('90+') || u.includes('SOBRE 90')
  if (!hasMorosidadKeyword) {
    if (moroso <= 0) return null
    if (dias >= 91) return '91+'
    if (dias >= 61) return '61-90'
    if (dias >= 31) return '31-60'
    if (dias >= 1) return '0-30'
    return null
  }
  if (u.includes('PURG')) return null
  if (u.includes('ACTUAL')) return null
  if (u.includes('0 A 30') || u.includes('0-30')) return '0-30'
  if (u.includes('31 A 60') || u.includes('31-60')) return '31-60'
  if (u.includes('61 A 90') || u.includes('61-90')) return '61-90'
  if (u.includes('+90') || u.includes('90+') || u.includes('MAS DE 90') || u.includes('SOBRE 90')) return '91+'
  if (moroso <= 0) return null
  if (dias >= 91) return '91+'
  if (dias >= 61) return '61-90'
  if (dias >= 31) return '31-60'
  if (dias >= 1) return '0-30'
  return null
}

function mapearEstado(s?: string): EstadoCuenta {
  const u = (s ?? '').toUpperCase()
  if (u.includes('PURGED') || u.includes('CANCELACIÓN TOTAL') || u.includes('CANCELACION TOTAL') || u.includes('PURGADO')) return 'cancelacion_total'
  if (u.includes('INACTIVE') || u.includes('INACTIVO')) return 'inactivo'
  if (u.includes('DELINQUENT') || u.includes('ATRASO') || u.includes('DIAS') || u.includes('MORA')) return 'actual'
  if (u.includes('PAID IN FULL') || u.includes('PAGADO') || u.includes('ACTUAL')) return 'actual'
  return 'actual'
}

function parsearFila(row: Record<string, string>): ClienteImport | null {
  const normalizedRow = buildNormalizedRow(row)
  const hyciteId = obtenerCampo(row, normalizedRow, [
    '# DE CLIENTE', 'Numero de cuenta hycite', 'Numero de cuenta', 'Cuenta', 'Hycite ID',
    'HYCITE_ID', 'HYCITEID', 'Cuenta Hycite', 'Cuenta Financiera', 'CUSTOMER NO', 'Customer #',
    'CUSTOMER#', 'N.º DE CLIENTE', 'N° DE CLIENTE', 'Nº DE CLIENTE', 'N. DE CLIENTE',
    'NO. DE CLIENTE', 'NUMERO DE CLIENTE', 'N.º DE CLIEN', 'Nº DE CLIEN', 'N° DE CLIEN',
    'N.º DE CLIE', 'N.º DE CLI', 'CLIENTE #', 'CLIENTE',
  ]).trim()
  if (!hyciteId) return null
  const nivel = parseInt(obtenerCampo(row, normalizedRow, ['NIVEL', 'Nivel']).trim() || '1')

  const fullNombre = obtenerCampo(row, normalizedRow, ['CUSTOMER NAME', 'NOMBRE COMPLETO']).trim()
  let nombre = obtenerCampo(row, normalizedRow, ['NOMBRE_1', 'NOMBRE', 'Nombre', 'First Name', 'FIRST NAME']).trim() || null
  let apellido = obtenerCampo(row, normalizedRow, ['APELLIDO PATERNO', 'Apellido', 'Apellidos', 'Last Name', 'LAST NAME']).trim() || null

  if (fullNombre && !nombre) {
    const parts = fullNombre.split(' ')
    if (parts.length > 1) {
      nombre = parts[0]
      apellido = parts.slice(1).join(' ')
    } else {
      nombre = fullNombre
    }
  }

  const ap2 = obtenerCampo(row, normalizedRow, ['APELLIDO MATERNO']).trim()
  if (ap2) apellido = [apellido, ap2].filter(Boolean).join(' ')

  const ciudad = obtenerCampo(row, normalizedRow, ['CIUDAD', 'Ciudad']).trim() || null
  const estadoRegion = obtenerCampo(row, normalizedRow, ['ESTADO', 'Estado', 'Estado / Provincia', 'STATE']).trim() || null
  const codigoPostal = obtenerCampo(row, normalizedRow, ['ZIP CODE', 'ZIP', 'Codigo Postal', 'Codigo postal']).trim() || null
  const direccionRaw = obtenerCampo(row, normalizedRow, ['DIRECCIÓN', 'Direccion', 'Dirección']).replace(/\n/g, ', ').trim()
  const direccion = direccionRaw || [ciudad, estadoRegion, codigoPostal].filter(Boolean).join(', ') || null

  let fechaNacimiento: string | null = null
  const bdayRaw = obtenerCampo(row, normalizedRow, ['BIRTH DAY', 'CUMPLEAÑOS', 'FECHA NACIMIENTO']).trim()
  if (bdayRaw) {
    const parts = bdayRaw.split(/\s+/)
    if (parts.length === 2) {
      const mes = MONTH_MAP[parts[0].toUpperCase()]
      const dia = parts[1].padStart(2, '0')
      if (mes && dia) fechaNacimiento = `2000-${mes}-${dia}`
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(bdayRaw)) {
      fechaNacimiento = bdayRaw
    }
  }

  const montoMoroso =
    parsearMonto(obtenerCampo(row, normalizedRow, ['MONTO MOROSO', 'MOROSO'])) ||
    calcularMoroso(row, normalizedRow)
  const diasAtrasoRaw = parseInt(obtenerCampo(row, normalizedRow, ['DIAS ATRASO', 'DIAS DE ATRASO']).trim() || '0')
  const diasAtraso = diasAtrasoRaw > 0 ? diasAtrasoRaw : calcularAtraso(row, normalizedRow)

  return {
    hycite_id: hyciteId,
    tipo_cliente: obtenerCampo(row, normalizedRow, ['CLIENTE']).trim() || 'HC',
    nombre,
    apellido,
    email: limpiarEmail(obtenerCampo(row, normalizedRow, ['CORREO ELECTRÓNICO', 'Correo', 'Email', 'email', 'E-mail', 'CORREO ELECTRONICO'])),
    telefono: limpiarTelefono(obtenerCampo(row, normalizedRow, ['TELÉFONO MÓVIL', 'Telefono', 'Teléfono', 'Celular', 'Móvil', 'HOME PHONE', 'Mobile Phone', 'MOBILE PHONE', 'TELEFONO MOVIL'])),
    telefono_casa: limpiarTelefono(obtenerCampo(row, normalizedRow, ['TELÉFONO DE CASA', 'WORK PHONE', 'Home Phone', 'HOME PHONE', 'TELEFONO DE CASA'])),
    direccion,
    ciudad,
    estado_region: estadoRegion,
    codigo_postal: codigoPostal,
    saldo_actual: parsearMonto(obtenerCampo(row, normalizedRow, ['SALDO ACTUAL', 'CUSTOMER BALANCE', 'Balance', 'BALANCE', 'SALDO'])),
    monto_moroso: montoMoroso,
    dias_atraso: diasAtraso,
    estado_morosidad: mapearEstadoMorosidad(row, normalizedRow, diasAtraso, montoMoroso),
    nivel: isNaN(nivel) || nivel < 1 ? 1 : Math.min(nivel, 9),
    estado_cuenta: mapearEstado(obtenerCampo(row, normalizedRow, ['ESTADO CUENTA', 'ESTADO DE CUENTA', 'STATUS CUENTA', 'STATUS', 'ESTADO', 'Estado'])),
    elegible_addon: (() => {
      const v = obtenerCampo(row, normalizedRow, ['ISELIGIBLEFORADDON', 'IS ELIGIBLE FOR ADD ON', 'ELEGIBLE ADDON', 'ELEGIBLE']).trim().toUpperCase()
      if (v === 'NO' || v === 'FALSE' || v === '0') return false
      if (v === 'YES' || v === 'TRUE' || v === '1') return true
      return true
    })(),
    fecha_ultimo_pedido: parsearFecha(obtenerCampo(row, normalizedRow, ['ÚLTIMA FECHA DE COMPRA', 'FECHA DEL ÚLTIMO PEDIDO', 'FECHA DEL ULTIMO PEDIDO', 'FECHA DEL', 'FECHA DEL ÚLTI'])),
    ultima_fecha_pago: parsearFecha(obtenerCampo(row, normalizedRow, ['ULTIMA FECHA DE PAGO', 'ÚLTIMA FECHA DE PAGO', 'ultima fecha de pago', 'ULTIMA FECHA PAGO'])),
    origen: 'hycite_import',
    codigo_vendedor_hycite: obtenerCampo(row, normalizedRow, ['VENDEDOR', 'Entrepreneur', 'ENTREPRENEUR', 'EMPRENDEDORES', 'Vendedor']).trim() || null,
    codigo_dist_hycite: obtenerCampo(row, normalizedRow, ['DISTRIBUIDOR']).trim() || null,
    updated_at: new Date().toISOString(),
    fecha_nacimiento: fechaNacimiento,
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

// ─── Mapping utilities ────────────────────────────────────────────────────────

function autodetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  SYSTEM_FIELDS_DEF.forEach(field => {
    for (const header of headers) {
      if (!header.trim()) continue
      const normalizedHeader = normalizarHeader(header)
      const matched = field.aliases.some(alias => normalizarHeader(alias) === normalizedHeader)
      if (matched && !mapping[field.key]) {
        mapping[field.key] = header
        break
      }
    }
  })
  return mapping
}

function applyMapping(row: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const result = { ...row }
  SYSTEM_FIELDS_DEF.forEach(({ key, canonicalAlias }) => {
    const mappedCol = mapping[key]
    if (mappedCol && row[mappedCol] !== undefined && !(canonicalAlias in result)) {
      result[canonicalAlias] = row[mappedCol]
    }
  })
  return result
}

function downloadErrorCsv(errorRows: Array<{ hycite_id: string; nombre: string; error: string }>, fileName: string) {
  if (errorRows.length === 0) return
  const headers = ['hycite_id', 'nombre', 'error']
  const csv = [
    headers.join(','),
    ...errorRows.map(r =>
      headers.map(k => `"${((r as Record<string, string>)[k] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `errores_${fileName.replace(/\.[^.]+$/, '')}_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const WIZARD_LABELS = ['Archivo', 'Mapeo', 'Vista previa', 'Confirmar', 'Resultado']
const STEP_INDEX: Record<Step, number> = {
  upload: 0, mapping: 1, preview: 2, confirm: 3, importing: 3, result: 4,
}

function StepIndicator({ step }: { step: Step }) {
  const current = STEP_INDEX[step]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: '1.25rem' }}>
      {WIZARD_LABELS.map((label, idx) => {
        const done = idx < current
        const active = idx === current
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', flex: idx < WIZARD_LABELS.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
              <div style={{
                width: '1.75rem', height: '1.75rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 700,
                background: done ? '#10b981' : active ? 'var(--color-primary, #3b82f6)' : 'var(--color-surface)',
                border: `2px solid ${done ? '#10b981' : active ? 'var(--color-primary, #3b82f6)' : 'var(--color-border)'}`,
                color: done || active ? '#fff' : 'var(--color-text-muted)',
              }}>
                {done ? '✓' : idx + 1}
              </div>
              <span style={{ fontSize: '0.65rem', whiteSpace: 'nowrap', color: active ? 'var(--color-primary, #3b82f6)' : done ? '#10b981' : 'var(--color-text-muted)', fontWeight: active ? 700 : 400 }}>
                {label}
              </span>
            </div>
            {idx < WIZARD_LABELS.length - 1 && (
              <div style={{ flex: 1, height: '2px', background: idx < current ? '#10b981' : 'var(--color-border)', margin: '0 0.25rem', marginBottom: '1rem' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportacionesPage() {
  const { session } = useAuth()
  const { showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)

  // Wizard state
  const [step, setStep] = useState<Step>('upload')
  const [reportType, setReportType] = useState<ReportType>('customer_list')
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  // Raw data from file (before parsearFila)
  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})

  // Parsed clients (after parsearFila)
  const [clientes, setClientes] = useState<ClienteImport[]>([])
  const [previewKpis, setPreviewKpis] = useState<PreviewKpis | null>(null)
  const [kpisLoading, setKpisLoading] = useState(false)

  // Import result
  const [importados, setImportados] = useState(0)
  const [actualizados, setActualizados] = useState(0)
  const [errores, setErrores] = useState(0)
  const [errorRows, setErrorRows] = useState<Array<{ hycite_id: string; nombre: string; error: string }>>([])

  // History
  const [historial, setHistorial] = useState<Importacion[]>([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)

  // ── Role check ────────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true
    if (!configured || !session?.user.id) { setRole(null); return }
    setRoleLoading(true)
    const cargarRol = async () => {
      try {
        const { data } = await supabase.from('usuarios').select('rol').eq('id', session.user.id).maybeSingle()
        if (!active) return
        setRole((data as { rol?: string } | null)?.rol ?? null)
      } finally {
        if (active) setRoleLoading(false)
      }
    }
    cargarRol()
    return () => { active = false }
  }, [configured, session?.user.id])

  // ── History ───────────────────────────────────────────────────────────────

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

  // ── Derived ───────────────────────────────────────────────────────────────

  const mappingValid =
    !!columnMapping['hycite_id'] || (!!columnMapping['nombre'] && !!columnMapping['telefono'])

  const autoDetectedCount = SYSTEM_FIELDS_DEF.filter(f => !!columnMapping[f.key]).length

  // ── Step 1: File parsing → save raw + go to mapping ───────────────────────

  const procesarArchivo = useCallback((file: File) => {
    setParseError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary', raw: false, cellDates: false })
        const ws = wb.Sheets[wb.SheetNames[0]]

        const initialRaw = XLSX.utils.sheet_to_json<SheetRow>(ws, { header: 1, range: 0, defval: '', raw: false }).slice(0, 10)
        const isBirthdayReport = initialRaw.some(row =>
          row.some(cell => String(cell).toUpperCase().includes('CUSTOMER BIRTHDAYS')),
        )
        setReportType(isBirthdayReport ? 'birthday_report' : 'customer_list')

        const allRows = XLSX.utils.sheet_to_json<SheetRow>(ws, { header: 1, defval: '', raw: false })
        let headerIndex = -1
        const keywords = ['HYCITE', 'HYCITE ID', 'CLIENTE', 'N DE CLIENTE', 'CUSTOMER', 'NOMBRE', 'NAME', 'APELLIDO', 'LAST NAME', 'CORREO ELECTRONICO', 'ELECTRONICO', 'EMAIL', 'TELEFONO']
        for (let i = 0; i < Math.min(allRows.length, 25); i++) {
          const row = allRows[i]
          if (!row || row.length < 2) continue
          const rowStr = row.map(cell => normalizarHeader(String(cell ?? ''))).join('|')
          if (keywords.some(k => rowStr.includes(k))) { headerIndex = i; break }
        }
        if (headerIndex === -1 && isBirthdayReport) headerIndex = 7

        const raw: SheetRow[] = headerIndex === -1 ? allRows : allRows.slice(headerIndex)
        if (raw.length < 2) { setParseError('No se pudo detectar el formato de los datos.'); return }

        const seen = new Map<string, number>()
        const headers = raw[0].map(headerCell => {
          const s = String(headerCell || '').trim()
          const c = seen.get(s) ?? 0; seen.set(s, c + 1)
          return c === 0 ? s : `${s}_${c}`
        })
        const rows: Record<string, string>[] = raw.slice(1).map(row =>
          Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()]))
        )

        if (rows.length === 0) { setParseError('No se encontraron filas de datos.'); return }

        const visibleHeaders = headers.filter(h => h.trim())
        setRawHeaders(visibleHeaders)
        setRawRows(rows)
        setColumnMapping(autodetectMapping(headers))
        setStep('mapping')
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

  // ── Step 2: Apply mapping → parse rows → fetch KPIs → preview ─────────────

  const procesarConMapping = useCallback(async () => {
    const mappedRows = rawRows.map(row => applyMapping(row, columnMapping))
    const validos = mappedRows.map(parsearFila).filter((c): c is ClienteImport => c !== null)
    if (validos.length === 0) {
      showToast('No se encontraron registros válidos con el mapeo actual.', 'error')
      return
    }
    const uniq = new Map<string, ClienteImport>()
    validos.forEach(c => { uniq.set(c.hycite_id, c) })
    const uniqueClientes = Array.from(uniq.values())
    setClientes(uniqueClientes)
    setPreviewKpis(null)
    setStep('preview')
    setKpisLoading(true)

    const ids = uniqueClientes.map(c => c.hycite_id).filter(Boolean)
    let existentesCount = 0
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500)
      const { data } = await supabase.from('clientes').select('hycite_id').in('hycite_id', batch)
      existentesCount += data?.length ?? 0
    }
    setPreviewKpis({
      existentes: existentesCount,
      nuevos: uniqueClientes.length - existentesCount,
      conFechaNac: uniqueClientes.filter(c => c.fecha_nacimiento).length,
      conMoroso: uniqueClientes.filter(c => c.monto_moroso > 0).length,
      sinTelefono: uniqueClientes.filter(c => !c.telefono).length,
    })
    setKpisLoading(false)
  }, [rawRows, columnMapping, showToast])

  // ── Step 4 → import ───────────────────────────────────────────────────────

  const handleImportar = async () => {
    if (!session?.user.id || clientes.length === 0) return
    setStep('importing')
    let imp = 0, up = 0, err = 0
    const newErrorRows: Array<{ hycite_id: string; nombre: string; error: string }> = []

    for (let i = 0; i < clientes.length; i += 50) {
      const lote = clientes.slice(i, i + 50)
      const idsLote = lote.map(c => c.hycite_id)
      const cuentasLote = lote.map(c => c.hycite_id)
      const telsLote = lote.map(c => normalizarTelefono(c.telefono)).filter(Boolean) as string[]

      const { data: existentes } = await supabase
        .from('clientes')
        .select('id, hycite_id, numero_cuenta_financiera, fecha_nacimiento, nombre, apellido, telefono, vendedor_id')
        .or(`hycite_id.in.(${idsLote.join(',')}),numero_cuenta_financiera.in.(${cuentasLote.join(',')}),telefono.in.(${telsLote.join(',')})`)

      const mapId = new Map(existentes?.filter(e => e.hycite_id).map(e => [e.hycite_id, e]) || [])
      const mapCuenta = new Map(existentes?.filter(e => e.numero_cuenta_financiera).map(e => [e.numero_cuenta_financiera, e]) || [])
      const mapTel = new Map(existentes?.filter(e => e.telefono).map(e => [normalizarTelefono(e.telefono), e]) || [])

      const buildPayload = (c: ClienteImport) => {
        const telMatch = c.telefono ? mapTel.get(normalizarTelefono(c.telefono)) : null
        const exById = mapId.get(c.hycite_id) || mapCuenta.get(c.hycite_id) || null
        const exByTel = telMatch && !telMatch.hycite_id ? telMatch : null
        const ex = exById || exByTel

        const base = ex ? {
          ...c,
          id: ex.id,
          fecha_nacimiento: ex.fecha_nacimiento || c.fecha_nacimiento,
          nombre: ex.nombre || c.nombre,
          apellido: ex.apellido || c.apellido,
          telefono: ex.telefono || c.telefono,
          vendedor_id: ex.vendedor_id || session!.user.id,
          numero_cuenta_financiera: ex.numero_cuenta_financiera || c.hycite_id,
        } : { ...c, vendedor_id: session!.user.id, numero_cuenta_financiera: c.hycite_id }

        // Add estado_operativo only when estado_cuenta column was mapped
        if (columnMapping['estado_cuenta']) {
          return { ...base, estado_operativo: ESTADO_OPERATIVO_MAP[c.estado_cuenta] }
        }
        return base
      }

      const payload = lote.map(buildPayload)

      const { error } = await supabase
        .from('clientes')
        .upsert(payload, { onConflict: 'hycite_id' })
        .select('id, created_at, updated_at')

      if (error) {
        console.error('Batch Upsert Error:', error)
        for (const item of payload) {
          const { data: singleData, error: singleError } = await supabase
            .from('clientes')
            .upsert([item], { onConflict: 'hycite_id' })
            .select('id, created_at, updated_at')
          if (singleError) {
            console.error('Single Upsert Error:', singleError)
            err += 1
            const c = lote.find(cl => cl.hycite_id === (item as ClienteImport).hycite_id)
            newErrorRows.push({
              hycite_id: (item as ClienteImport).hycite_id ?? '',
              nombre: [c?.nombre, c?.apellido].filter(Boolean).join(' ') || '',
              error: singleError.message,
            })
          } else {
            const isNew = singleData?.[0]?.created_at === singleData?.[0]?.updated_at
            if (isNew) imp += 1; else up += 1
          }
        }
      } else {
        lote.forEach(c => {
          const matched =
            mapId.has(c.hycite_id) ||
            mapCuenta.has(c.hycite_id) ||
            (c.telefono && mapTel.has(normalizarTelefono(c.telefono)))
          if (matched) up += 1; else imp += 1
        })
      }
    }

    await supabase.from('importaciones_hycite').insert({
      importado_por: session!.user.id,
      tipo_cuenta: reportType === 'birthday_report' ? 'birthday_list' : 'customer_list',
      total_registros: clientes.length,
      registros_nuevos: imp,
      registros_actualizados: up,
      registros_error: err,
      archivo_nombre: fileName,
    })

    setErrorRows(newErrorRows)
    setImportados(imp)
    setActualizados(up)
    setErrores(err)
    setStep('result')
    if (err === 0) showToast(`✅ ${imp} nuevos, ${up} actualizados`)
    else showToast(`⚠️ ${imp} nuevos, ${up} actualizados, ${err} errores`, 'error')
    cargarHistorial()
  }

  const resetear = () => {
    setStep('upload')
    setClientes([])
    setFileName('')
    setParseError(null)
    setRawHeaders([])
    setRawRows([])
    setColumnMapping({})
    setPreviewKpis(null)
    setErrorRows([])
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-stack">
      {roleLoading ? (
        <div className="page">Cargando...</div>
      ) : role && role !== 'admin' && role !== 'distribuidor' ? (
        <div>
          <SectionHeader title="Importaciones" subtitle="Importaciones Hy-Cite" />
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Acceso restringido</p>
            <p style={{ fontSize: '0.9rem' }}>Solo administradores y distribuidores pueden usar este módulo.</p>
          </div>
        </div>
      ) : (
        <>
          <SectionHeader
            title="Importaciones Hy-Cite"
            subtitle={
              reportType === 'birthday_report'
                ? 'Importando Reporte de Cumpleaños'
                : 'Importa tu cartera de clientes desde el archivo CustomerList de Hy-Cite'
            }
          />

          <div className="card" style={{ padding: '1.5rem' }}>
            {/* Step indicator */}
            {step !== 'upload' && step !== 'importing' && (
              <StepIndicator step={step} />
            )}

            {/* ── Step 1: Upload ── */}
            {step === 'upload' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                  Soporta <strong>Customer List</strong> y <strong>Customer Birthdays</strong>. El sistema detectará el formato automáticamente.
                </p>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? 'var(--color-primary, #3b82f6)' : 'var(--color-border, #374151)'}`,
                    borderRadius: '0.75rem', padding: '3rem', textAlign: 'center', cursor: 'pointer',
                    background: dragOver ? 'rgba(59,130,246,0.05)' : 'var(--color-surface)', transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📂</div>
                  <p style={{ margin: 0, fontWeight: 600 }}>Arrastra el archivo aquí</p>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>o haz clic para seleccionar — .xls / .xlsx</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xls,.xlsx"
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

            {/* ── Step 2: Mapping ── */}
            {step === 'mapping' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  <span>📄 <strong>{fileName}</strong></span>
                  <span>·</span>
                  <span><strong>{rawRows.length}</strong> filas detectadas</span>
                  <span>·</span>
                  <span><strong>{rawHeaders.length}</strong> columnas</span>
                </div>

                <div style={{ padding: '0.65rem 1rem', background: autoDetectedCount >= SYSTEM_FIELDS_DEF.filter(f => f.required).length ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)', borderRadius: '0.5rem', fontSize: '0.8rem', border: `1px solid ${autoDetectedCount >= SYSTEM_FIELDS_DEF.filter(f => f.required).length ? '#6ee7b7' : '#fcd34d'}` }}>
                  {autoDetectedCount === SYSTEM_FIELDS_DEF.length
                    ? `✅ Todos los campos detectados automáticamente`
                    : `⚡ ${autoDetectedCount} de ${SYSTEM_FIELDS_DEF.length} campos detectados — revisa y ajusta el mapeo si es necesario`}
                </div>

                <div style={{ overflowX: 'auto', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface)' }}>
                        <th style={{ padding: '0.6rem 0.875rem', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: '45%' }}>Campo del sistema</th>
                        <th style={{ padding: '0.6rem 0.875rem', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Columna del archivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SYSTEM_FIELDS_DEF.map(field => {
                        const isMapped = !!columnMapping[field.key]
                        const isRequiredMissing = field.required && !isMapped
                        return (
                          <tr key={field.key} style={{ borderTop: '1px solid var(--color-border)', background: isRequiredMissing ? '#fef2f2' : 'transparent' }}>
                            <td style={{ padding: '0.5rem 0.875rem' }}>
                              <span>{field.label}</span>
                              {field.required && (
                                <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.25rem', padding: '0.1rem 0.3rem' }}>
                                  REQUERIDO
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '0.5rem 0.875rem' }}>
                              <select
                                value={columnMapping[field.key] ?? ''}
                                onChange={e => setColumnMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                                style={{
                                  width: '100%', padding: '0.35rem 0.5rem', borderRadius: '0.375rem',
                                  border: `1px solid ${isRequiredMissing ? '#fca5a5' : 'var(--color-border)'}`,
                                  background: 'var(--color-surface)', fontSize: '0.8rem',
                                  color: isRequiredMissing ? '#dc2626' : 'inherit',
                                }}
                              >
                                <option value="">— No mapear —</option>
                                {rawHeaders.map(h => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  * Se requiere <strong>ID Hy-Cite</strong> o bien <strong>Nombre + Teléfono</strong> para identificar cada registro.
                </p>

                {!mappingValid && (
                  <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#dc2626', fontSize: '0.875rem' }}>
                    Mapea el campo <strong>ID Hy-Cite</strong> o bien <strong>Nombre</strong> y <strong>Teléfono</strong> para continuar.
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <Button variant="ghost" type="button" onClick={resetear}>← Cancelar</Button>
                  <Button type="button" onClick={procesarConMapping} disabled={!mappingValid}>
                    Continuar →
                  </Button>
                </div>
              </div>
            )}

            {/* ── Step 3: Preview ── */}
            {step === 'preview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  📄 <strong>{fileName}</strong> · <strong>{clientes.length}</strong> registros únicos
                </div>

                {/* KPI cards */}
                {kpisLoading ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                    Analizando archivo contra base de datos...
                  </div>
                ) : previewKpis ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
                    {[
                      { label: 'Total', value: clientes.length, color: '#3b82f6', icon: '📋' },
                      { label: 'Nuevos', value: previewKpis.nuevos, color: '#10b981', icon: '✨' },
                      { label: 'Existentes', value: previewKpis.existentes, color: '#6366f1', icon: '🔄' },
                      { label: 'Con nacimiento', value: previewKpis.conFechaNac, color: '#ec4899', icon: '🎂' },
                      { label: 'Con morosidad', value: previewKpis.conMoroso, color: '#f59e0b', icon: '⚠️' },
                      { label: 'Sin teléfono', value: previewKpis.sinTelefono, color: previewKpis.sinTelefono > 0 ? '#dc2626' : '#6b7280', icon: '📵' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '0.75rem', background: 'var(--color-surface)', borderRadius: '0.5rem', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: '0.9rem', marginBottom: '0.15rem' }}>{s.icon}</div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Sample table */}
                <div style={{ overflowX: 'auto', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface)' }}>
                        {['# Cliente', 'Nombre', 'Teléfono', 'Estado', 'Saldo', 'Morosidad', 'Nacimiento'].map(h => (
                          <th key={h} style={{ padding: '0.45rem 0.65rem', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {clientes.slice(0, 15).map(c => {
                        const sinTelefono = !c.telefono
                        const sinNombre = !c.nombre
                        const conMoroso = c.monto_moroso > 0
                        const rowBg = sinNombre ? 'rgba(251,146,60,0.06)' : sinTelefono ? 'rgba(245,158,11,0.04)' : 'transparent'
                        return (
                          <tr key={c.hycite_id} style={{ borderTop: '1px solid var(--color-border)', background: rowBg }}>
                            <td style={{ padding: '0.4rem 0.65rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{c.hycite_id}</td>
                            <td style={{ padding: '0.4rem 0.65rem', color: sinNombre ? '#f59e0b' : 'inherit' }}>
                              {[c.nombre, c.apellido].filter(Boolean).join(' ') || <span style={{ color: '#f59e0b', fontStyle: 'italic' }}>sin nombre</span>}
                            </td>
                            <td style={{ padding: '0.4rem 0.65rem', color: sinTelefono ? '#dc2626' : 'inherit', fontFamily: sinTelefono ? 'inherit' : 'monospace', fontSize: sinTelefono ? '0.75rem' : '0.72rem' }}>
                              {c.telefono ?? <span style={{ fontStyle: 'italic' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.4rem 0.65rem' }}>{c.estado_cuenta}</td>
                            <td style={{ padding: '0.4rem 0.65rem' }}>${c.saldo_actual.toFixed(2)}</td>
                            <td style={{ padding: '0.4rem 0.65rem', color: conMoroso ? '#dc2626' : 'inherit' }}>{segmento(c.dias_atraso, c.monto_moroso)}</td>
                            <td style={{ padding: '0.4rem 0.65rem', color: c.fecha_nacimiento ? 'inherit' : 'var(--color-text-muted)' }}>
                              {c.fecha_nacimiento ?? '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {clientes.length > 15 && (
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    + {clientes.length - 15} registros más
                  </p>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <Button variant="ghost" type="button" onClick={() => setStep('mapping')}>← Mapeo</Button>
                  <Button type="button" onClick={() => setStep('confirm')}>Continuar →</Button>
                </div>
              </div>
            )}

            {/* ── Step 4: Confirm ── */}
            {step === 'confirm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Confirmar importación</h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
                  {[
                    { label: 'Total a importar', value: clientes.length, color: '#3b82f6' },
                    { label: 'Registros nuevos (est.)', value: previewKpis?.nuevos ?? '—', color: '#10b981' },
                    { label: 'A actualizar (est.)', value: previewKpis?.existentes ?? '—', color: '#6366f1' },
                    { label: 'Archivo', value: fileName, color: 'var(--color-text)', isText: true },
                  ].map(s => (
                    <div key={s.label} style={{ padding: '1rem', background: 'var(--color-surface)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: s.isText ? '0.8rem' : '1.5rem', fontWeight: 700, color: s.color, wordBreak: 'break-all' }}>{s.value}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Warnings */}
                {previewKpis && (previewKpis.sinTelefono > 0 || clientes.filter(c => !c.nombre).length > 0) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, color: '#92400e' }}>Advertencias</p>
                    {previewKpis.sinTelefono > 0 && (
                      <div style={{ padding: '0.6rem 0.875rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '0.5rem', fontSize: '0.8rem', color: '#92400e' }}>
                        ⚠️ {previewKpis.sinTelefono} registro{previewKpis.sinTelefono !== 1 ? 's' : ''} sin teléfono
                      </div>
                    )}
                    {clientes.filter(c => !c.nombre).length > 0 && (
                      <div style={{ padding: '0.6rem 0.875rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '0.5rem', fontSize: '0.8rem', color: '#92400e' }}>
                        ⚠️ {clientes.filter(c => !c.nombre).length} registro{clientes.filter(c => !c.nombre).length !== 1 ? 's' : ''} sin nombre
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <Button variant="ghost" type="button" onClick={() => setStep('preview')}>← Vista previa</Button>
                  <Button type="button" onClick={handleImportar}>
                    Importar {clientes.length} clientes
                  </Button>
                </div>
              </div>
            )}

            {/* ── Step: Importing (loading) ── */}
            {step === 'importing' && (
              <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⏳</div>
                <p style={{ fontWeight: 600, margin: 0 }}>Importando {clientes.length} clientes...</p>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Esto puede tardar unos momentos.</p>
              </div>
            )}

            {/* ── Step 5: Result ── */}
            {step === 'result' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>{errores === 0 ? '✅' : '⚠️'}</div>
                  <p style={{ fontWeight: 700, fontSize: '1.1rem', margin: 0 }}>
                    {errores === 0 ? 'Importación exitosa' : 'Completado con errores'}
                  </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.65rem' }}>
                  {[
                    { label: 'Total', value: clientes.length, color: '#3b82f6' },
                    { label: 'Nuevos', value: importados, color: '#10b981' },
                    { label: 'Actualizados', value: actualizados, color: '#6366f1' },
                    { label: 'Errores', value: errores, color: errores > 0 ? '#dc2626' : '#6b7280' },
                  ].map(s => (
                    <div key={s.label} style={{ padding: '1rem', background: 'var(--color-surface)', borderRadius: '0.5rem', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {errores > 0 && errorRows.length > 0 && (
                  <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.85rem', color: '#dc2626' }}>
                      {errores} registro{errores !== 1 ? 's' : ''} con error
                    </span>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => downloadErrorCsv(errorRows, fileName)}
                    >
                      ⬇ Descargar CSV de errores
                    </Button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <Button variant="ghost" type="button" onClick={resetear}>Nueva importación</Button>
                  <Button type="button" onClick={() => window.location.href = '/clientes'}>Ver clientes</Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Import history (unchanged) ── */}
          <div>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Historial de importaciones
            </h3>
            {loadingHistorial ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Cargando...</p>
            ) : historial.length === 0 ? (
              <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                No hay importaciones anteriores
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {historial.map(imp => (
                  <div key={imp.id} className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>{imp.archivo_nombre ?? 'Archivo sin nombre'}</p>
                      <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {new Date(imp.created_at).toLocaleString('es-MX')}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem' }}>
                      <span style={{ color: '#3b82f6' }}><strong>{imp.total_registros}</strong> total</span>
                      <span style={{ color: '#10b981' }}><strong>{imp.registros_nuevos}</strong> importados</span>
                      {imp.registros_error > 0 && (
                        <span style={{ color: '#dc2626' }}><strong>{imp.registros_error}</strong> errores</span>
                      )}
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
