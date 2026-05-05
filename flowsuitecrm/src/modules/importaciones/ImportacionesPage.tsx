import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { useToast } from '../../components/useToast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/UsersProvider'
import { ImportRevisiones } from './ImportRevisiones'
import { ImportGeneral } from './ImportGeneral'

type EstadoCuenta = 'actual' | 'cancelacion_total' | 'inactivo'
type Step = 'upload' | 'mapping' | 'preview' | 'confirm' | 'importing' | 'result'
type ReportType = 'customer_list' | 'birthday_report'
type SheetCell = string | number | boolean | Date | null | undefined
type SheetRow = SheetCell[]

// Estados Hy-Cite que indican Cargo de Vuelta / DFP
const CARGO_VUELTA_ESTADOS = new Set([
  'CARGO DE VUELTA', 'CARGOS DE VUELTA', 'CARGO VUELTA',
  'RECOMPRADA', 'CUENTA RECOMPRADA', 'CUENTA DEVUELTA',
  'DFP', 'DISTRIBUTOR FINANCE', 'DISTRIBUTOR FINANCE PROGRAM',
  'DISTRIBUTOR FINANCING PROGRAM', 'DISTRIBUTOR FINANCING',
])

function isCargoVuelta(estadoRaw: string): boolean {
  if (!estadoRaw) return false
  const u = estadoRaw.trim().toUpperCase()
  return CARGO_VUELTA_ESTADOS.has(u) ||
    u.includes('CARGO DE VUELTA') ||
    u.includes('CARGO VUELTA') ||
    u.includes('RECOMPRADA') ||
    (u.includes('DFP') && u.length <= 6)
}

interface ClienteImport {
  org_id: string | null
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
  estado_cuenta?: EstadoCuenta | null
  elegible_addon: boolean
  fecha_ultimo_pedido: string | null
  ultima_fecha_pago: string | null
  origen: 'hycite_import'
  codigo_vendedor_hycite: string | null
  codigo_dist_hycite: string | null
  updated_at: string
  fecha_nacimiento?: string | null
  estado_operativo?: string | null
  estado_cuenta_raw?: string | null
  // Cargo de Vuelta
  es_cargo_vuelta?: boolean
  monto_cargo_vuelta?: number | null
  fecha_cargo_vuelta_import?: string | null
  dias_vencido_import?: number | null
  numero_cuenta_hycite_import?: string | null
  numero_orden_hycite_import?: string | null
  notas_cargo_vuelta?: string | null
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
  cargoVuelta: number
  cargoVueltaConMonto: number
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
      '# DE CLIENTE', 'HYCITE ID', 'HYCITEID', 'CUSTOMER NO', 'CUSTOMER_NO', 'CUSTOMER #', 'CUSTOMER#', 'CUSTOMER ID',
      'CUSTOMER NUMBER', 'EXTERNAL ID', 'EXTERNAL_ID', 'ID CLIENTE', 'ID DE CLIENTE', 'N DE CLIENTE', 'NO DE CLIENTE',
      'NUMERO DE CLIENTE', '. DE CLIENTE', '.° DE CLIENTE', 'DE CLIENTE', 'CUENTA', 'CUENTA HYCITE', 'CUENTA FINANCIERA', 'N DE CLIEN', 'N DE CLI', 'CLIENTE #',
    ],
  },
  {
    key: 'nombre',
    label: 'Nombre',
    required: false,
    canonicalAlias: 'NOMBRE',
    aliases: ['NOMBRE', 'NOMBRE 1', 'NOMBRE1', 'CUSTOMER NAME', 'FULL NAME', 'FULL_NAME', 'NOMBRE COMPLETO', 'FIRST NAME', 'FIRST_NAME', 'NAME'],
  },
  {
    key: 'apellido',
    label: 'Apellido',
    required: false,
    canonicalAlias: 'APELLIDO PATERNO',
    aliases: ['APELLIDO PATERNO', 'APELLIDO', 'APELLIDOS', 'LAST NAME', 'LAST_NAME', 'APELLIDO MATERNO', 'SURNAME', 'SECOND LAST NAME'],
  },
  {
    key: 'telefono',
    label: 'Teléfono (móvil)',
    required: false,
    canonicalAlias: 'TELÉFONO MÓVIL',
    aliases: ['TELEFONO MOVIL', 'CELULAR', 'MOVIL', 'MOBILE PHONE', 'MOBILE', 'TELEFONO', 'PHONE', 'TEL', 'PRIMARY PHONE', 'PRIMARY_PHONE', 'MOBILE NO'],
  },
  {
    key: 'telefono_casa',
    label: 'Teléfono (casa/trabajo)',
    required: false,
    canonicalAlias: 'TELÉFONO CASA',
    aliases: ['TELEFONO CASA', 'HOME PHONE', 'WORK PHONE', 'TELEFONO DE CASA', 'TEL CASA', 'HOME_PHONE', 'WORK_PHONE', 'FIXED PHONE'],
  },
  {
    key: 'email',
    label: 'Email',
    required: false,
    canonicalAlias: 'CORREO ELECTRÓNICO',
    aliases: ['CORREO ELECTRONICO', 'EMAIL', 'E-MAIL', 'EMAIL ADDRESS', 'CORREO'],
  },
  {
    key: 'direccion',
    label: 'Dirección',
    required: false,
    canonicalAlias: 'DIRECCIÓN',
    aliases: ['DIRECCION', 'DIRECCION 1', 'ADDRESS', 'STREET', 'DIRECTION', 'DOMICILIO'],
  },
  {
    key: 'ciudad',
    label: 'Ciudad',
    required: false,
    canonicalAlias: 'CIUDAD',
    aliases: ['CIUDAD', 'CITY', 'TOWN', 'LOCALIDAD', 'MUNICIPIO'],
  },
  {
    key: 'estado_region',
    label: 'Estado / Prov (Dirección)',
    required: false,
    canonicalAlias: 'ESTADO / PROVINCIA',
    aliases: ['ESTADO / PROVINCIA', 'PROVINCIA', 'REGION', 'DEPARTAMENTO'],
  },
  {
    key: 'codigo_postal',
    label: 'Código Postal',
    required: false,
    canonicalAlias: 'CÓDIGO POSTAL',
    aliases: ['CODIGO POSTAL', 'ZIP CODE', 'ZIP', 'POSTAL CODE', 'ZIPCODE', 'CP'],
  },
  {
    key: 'estado_cuenta',
    label: 'Estado de cuenta / Morosidad',
    required: false,
    canonicalAlias: 'ESTADO CUENTA',
    // 'ESTADO' se asume como estado de cuenta si contiene palabras clave de morosidad
    aliases: ['ESTADO CUENTA', 'ESTADO DE CUENTA', 'STATUS CUENTA', 'STATUS', 'ESTADO_CUENTA', 'ACCOUNT STATUS', 'ESTADO'],
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
    aliases: ['MONTO MOROSO', 'DELINQUENT', 'MOROSO', 'DELINCUENCIA', 'CANTIDAD MOROSA'],
  },
  {
    key: 'dias_atraso',
    label: 'Días de atraso',
    required: false,
    canonicalAlias: 'DÍAS ATRASO',
    aliases: ['DIAS ATRASO', 'DIAS DE ATRASO', 'DAYS PAST DUE', 'DPD', 'ATRASO', 'DAYS LATE'],
  },
  {
    key: 'codigo_vendedor_hycite',
    label: 'Emprendedores',
    required: false,
    canonicalAlias: 'EMPRENDEDORES',
    aliases: ['EMPRENDEDORES', 'EMPRENDEDOR', 'ENTREPRENEUR', 'ENTREPRENEURS', 'VENDEDOR'],
  },
  {
    key: 'fecha_nacimiento',
    label: 'Fecha de nacimiento',
    required: false,
    canonicalAlias: 'BIRTH DAY',
    aliases: [
      'BIRTH DAY', 'BIRTHDAY', 'BIRTH DATE', 'BIRTHDAY TEXT', 'BIRTHDAY_TEXT', 'BIRTHDAY MMDD', 'BIRTHDAY_MMDD',
      'BIRTH_MONTH', 'BIRTH MONTH', 'BIRTH_DAY', 'BIRTH DAY', 'DOB', 'CUMPLEANOS', 'CUMPLEAÑOS',
      'FECHA NACIMIENTO', 'FECHA DE NACIMIENTO',
    ],
  },
  {
    key: 'monto_cargo_vuelta',
    label: 'Monto cargo de vuelta',
    required: false,
    canonicalAlias: 'MONTO CARGO DE VUELTA',
    aliases: [
      'MONTO CARGO DE VUELTA', 'MONTO CARGO VUELTA', 'MONTO DEVUELTO', 'AMOUNT CHARGED BACK',
      'CHARGEBACK AMOUNT', 'CARGO VUELTA MONTO', 'MONTO DFP',
    ],
  },
  {
    key: 'fecha_cargo_vuelta',
    label: 'Fecha Cargo de Vuelta',
    required: false,
    canonicalAlias: 'FECHA CARGO DE VUELTA',
    aliases: [
      'FECHA CARGO DE VUELTA', 'FECHA CARGO VUELTA', 'FECHA DFP', 'CHARGEBACK DATE',
      'FECHA DEVOLUCION', 'FECHA DEVOLUCION HYCITE',
    ],
  },
  {
    key: 'dias_vencido',
    label: 'Días Vencido',
    required: false,
    canonicalAlias: 'DIAS VENCIDO',
    aliases: [
      'DIAS VENCIDO', 'DÍAS VENCIDO', 'DAYS OVERDUE', 'DAYS PAST DUE CARGO', 'DIAS VENCIDOS',
    ],
  },
  {
    key: 'numero_cuenta_hycite',
    label: 'Número Cuenta Hy-Cite',
    required: false,
    canonicalAlias: 'NUMERO CUENTA HYCITE',
    aliases: [
      'NUMERO CUENTA HYCITE', 'NÚMERO CUENTA HYCITE', 'ACCOUNT NUMBER', 'CUENTA HYCITE',
      'HYCITE ACCOUNT', 'HYCITE ACCOUNT NO', 'ACCOUNT NO',
    ],
  },
  {
    key: 'numero_orden_hycite',
    label: 'Número Orden Hy-Cite',
    required: false,
    canonicalAlias: 'NUMERO ORDEN HYCITE',
    aliases: [
      'NUMERO ORDEN HYCITE', 'NÚMERO ORDEN HYCITE', 'ORDER NUMBER', 'ORDEN HYCITE',
      'HYCITE ORDER', 'HYCITE ORDER NO', 'ORDER NO',
    ],
  },
  {
    key: 'notas_cargo_vuelta',
    label: 'Notas (Cargo de Vuelta)',
    required: false,
    canonicalAlias: 'NOTAS',
    aliases: [
      'NOTAS', 'NOTES', 'NOTA', 'COMENTARIOS', 'OBSERVATIONS', 'OBSERVACIONES',
    ],
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
  const isoWithTime = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+\d{2}:\d{2}:\d{2}$/)
  if (isoWithTime) return `${isoWithTime[1]}-${isoWithTime[2]}-${isoWithTime[3]}`
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
    .replace(/\ufeff/g, '')
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
  const morosidad = parseMorosidadDesdeEstado(estado)
  if (morosidad) return morosidad.dias_atraso
  return 0
}

function parseMorosidadDesdeEstado(estadoRaw: string): { dias_atraso: number; estado_morosidad: string } | null {
  const u = (estadoRaw ?? '').toUpperCase()
  if (u.includes('+90') || u.includes('90+') || u.includes('MAS DE 90') || u.includes('SOBRE 90')) {
    return { dias_atraso: 91, estado_morosidad: '91+' }
  }
  if (u.includes('61 A 90') || u.includes('61-90') || u.includes('DE 61 A 90')) {
    return { dias_atraso: 61, estado_morosidad: '61-90' }
  }
  if (u.includes('31 A 60') || u.includes('31-60') || u.includes('DE 31 A 60')) {
    return { dias_atraso: 31, estado_morosidad: '31-60' }
  }
  if (u.includes('0 A 30') || u.includes('0-30') || u.includes('DE 0 A 30')) {
    return { dias_atraso: 1, estado_morosidad: '0-30' }
  }
  if (u.includes('ATRASO') || u.includes('MOR') || u.includes('DELINQUENT')) {
    return { dias_atraso: 1, estado_morosidad: '0-30' }
  }
  return null
}

function parseEstadoCuentaDesdeEstado(estadoRaw: string): EstadoCuenta | null {
  const u = (estadoRaw ?? '').toUpperCase()
  // Si el valor es de morosidad, no tocar estado_cuenta
  if (parseMorosidadDesdeEstado(u)) return null
  if (u.includes('PURGED') || u.includes('PURGADO') || u.includes('CANCELACIÓN TOTAL') || u.includes('CANCELACION TOTAL') || u.includes('CANCELADO')) {
    return 'cancelacion_total'
  }
  if (u.includes('INACTIVE') || u.includes('INACTIVO')) return 'inactivo'
  if (u.includes('PAID IN FULL') || u.includes('PAGADO') || u.includes('ACTUAL') || u.includes('CURRENT')) return 'actual'
  return null
}

function isLikelyEstadoRegion(value: string): boolean {
  const v = (value ?? '').trim()
  if (!v) return false
  if (parseMorosidadDesdeEstado(v)) return false
  if (parseEstadoCuentaDesdeEstado(v)) return false
  if (/^[A-Z]{2}$/.test(v.toUpperCase())) return true
  if (/^[A-Z\\s.]+$/.test(v.toUpperCase()) && v.length <= 20) return true
  return false
}

function obtenerEstadoRegion(row: Record<string, string>, normalizedRow: Record<string, string>): string | null {
  const alias = ['ESTADO / PROVINCIA', 'Estado / Provincia', 'STATE', 'ESTADO', 'Estado', 'REGION', 'PROVINCIA']
  for (const a of alias) {
    const val = obtenerCampo(row, normalizedRow, [a]).trim()
    if (val && isLikelyEstadoRegion(val)) return val
  }
  return null
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
  const morosidadFromEstado = parseMorosidadDesdeEstado(u)
  if (morosidadFromEstado) return morosidadFromEstado.estado_morosidad
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

function bucketMorosidadDesdeDias(dias: number): string | null {
  if (dias >= 91) return '91+'
  if (dias >= 61) return '61-90'
  if (dias >= 31) return '31-60'
  if (dias >= 1) return '0-30'
  return null
}

function parsearFila(row: Record<string, string>): ClienteImport | null {
  const normalizedRow = buildNormalizedRow(row)

  // Priorizamos los campos que el usuario mapeó (usando canonicalAlias)
  // hycite_id
  const hyciteId = obtenerCampo(row, normalizedRow, [
    '# DE CLIENTE', 'HYCITE ID', 'HYCITEID', 'Cuenta', 'ID Cliente',
    'N.º DE CLIENTE', 'NUMERO DE CLIENTE', 'CUSTOMER NO', 'CUSTOMER#',
  ]).trim()
  if (!hyciteId) return null

  const nivel = parseInt(obtenerCampo(row, normalizedRow, ['NIVEL', 'Nivel']).trim() || '1')

  // Nombres y Apellidos
  let nombre = obtenerCampo(row, normalizedRow, ['NOMBRE', 'NOMBRE COMPLETO', 'CUSTOMER NAME', 'Nombre', 'First Name']).trim() || null
  let apellido = obtenerCampo(row, normalizedRow, ['APELLIDO PATERNO', 'Apellido', 'Apellidos', 'Last Name']).trim() || null

  // Mejora: Si el nombre tiene espacios y no hay apellido mapeado/presente, dividirlo
  if (nombre && !apellido) {
    const parts = nombre.trim().split(/\s+/)
    if (parts.length > 1) {
      nombre = parts[0]
      apellido = parts.slice(1).join(' ')
    }
  }

  // Apellido materno (si existe columna separada)
  const ap2 = obtenerCampo(row, normalizedRow, ['APELLIDO MATERNO']).trim()
  if (ap2) apellido = [apellido, ap2].filter(Boolean).join(' ')

  // Dirección y Componentes
  const ciudad = obtenerCampo(row, normalizedRow, ['CIUDAD', 'Ciudad', 'City']).trim() || null
  const estadoRegion = obtenerCampo(row, normalizedRow, ['ESTADO / PROVINCIA', 'Estado / Provincia']).trim() || obtenerEstadoRegion(row, normalizedRow)
  const codigoPostal = obtenerCampo(row, normalizedRow, ['CÓDIGO POSTAL', 'Codigo Postal', 'Zip Code', 'Zip']).trim() || null
  const direccionRaw = obtenerCampo(row, normalizedRow, ['DIRECCIÓN', 'Direccion', 'Address']).replace(/\n/g, ', ').trim()

  // Si no hay dirección explícita, construimos una básica
  const direccion = direccionRaw || [ciudad, estadoRegion, codigoPostal].filter(Boolean).join(', ') || null

  // Fechas (Nacimiento)
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
    } else {
      const mmdd = bdayRaw.match(/^(\d{1,2})[\/-](\d{1,2})$/)
      if (mmdd) {
        const [, m, d] = mmdd
        fechaNacimiento = `2000-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      }
    }
  }

  const montoMoroso =
    parsearMonto(obtenerCampo(row, normalizedRow, ['MONTO MOROSO', 'MOROSO', 'DELINQUENT'])) ||
    calcularMoroso(row, normalizedRow)

  const diasAtrasoRaw = parseInt(obtenerCampo(row, normalizedRow, ['DÍAS ATRASO', 'DIAS ATRASO', 'DAYS PAST DUE']).trim() || '0')
  const diasAtraso = diasAtrasoRaw > 0 ? diasAtrasoRaw : calcularAtraso(row, normalizedRow)

  const estadoRaw = obtenerCampo(row, normalizedRow, ['ESTADO CUENTA', 'STATUS CUENTA', 'Status', 'Estado de cuenta']).trim()
  const estadoCuenta = parseEstadoCuentaDesdeEstado(estadoRaw)

  const estadoMorosidadRaw = mapearEstadoMorosidad(row, normalizedRow, diasAtraso, montoMoroso)
  const estadoMorosidadBucket = bucketMorosidadDesdeDias(diasAtraso)
  const estadoMorosidad = estadoMorosidadBucket ?? estadoMorosidadRaw
  const estadoMorosidadFinal = estadoMorosidadRaw && estadoMorosidadBucket && estadoMorosidadRaw !== estadoMorosidadBucket
    ? estadoMorosidadBucket
    : estadoMorosidad

    const telMovil = limpiarTelefono(obtenerCampo(row, normalizedRow, ['TELÉFONO MÓVIL', 'Celular', 'Mobile', 'Telefono']))
    const telCasa = limpiarTelefono(obtenerCampo(row, normalizedRow, ['TELÉFONO CASA', 'Home Phone', 'Tel Casa']))

    // ── Cargo de Vuelta detection ──────────────────────────────────────────
    const estadoRawCompleto = obtenerCampo(row, normalizedRow, [
      'ESTADO CUENTA', 'ESTADO DE CUENTA', 'STATUS CUENTA', 'STATUS', 'ESTADO_CUENTA', 'ACCOUNT STATUS', 'ESTADO',
    ]).trim()
    const esCargoVuelta = isCargoVuelta(estadoRawCompleto)

    const montoCargoVueltaRaw = obtenerCampo(row, normalizedRow, [
      'MONTO CARGO DE VUELTA', 'MONTO CARGO VUELTA', 'MONTO DEVUELTO', 'AMOUNT CHARGED BACK',
      'CHARGEBACK AMOUNT', 'CARGO VUELTA MONTO', 'MONTO DFP',
    ]).trim()
    const montoCargoVuelta = montoCargoVueltaRaw ? parsearMonto(montoCargoVueltaRaw) : null

    const fechaCargoVueltaRaw = obtenerCampo(row, normalizedRow, [
      'FECHA CARGO DE VUELTA', 'FECHA CARGO VUELTA', 'FECHA DFP', 'CHARGEBACK DATE',
      'FECHA DEVOLUCION', 'FECHA DEVOLUCION HYCITE',
    ]).trim()
    const fechaCargoVuelta = fechaCargoVueltaRaw ? parsearFecha(fechaCargoVueltaRaw) : null

    const diasVencidoRaw = obtenerCampo(row, normalizedRow, [
      'DIAS VENCIDO', 'DÍAS VENCIDO', 'DAYS OVERDUE', 'DAYS PAST DUE CARGO', 'DIAS VENCIDOS',
    ]).trim()
    const diasVencido = diasVencidoRaw ? (parseInt(diasVencidoRaw) || null) : null

    const numeroCuentaHycite = obtenerCampo(row, normalizedRow, [
      'NUMERO CUENTA HYCITE', 'NÚMERO CUENTA HYCITE', 'ACCOUNT NUMBER', 'CUENTA HYCITE',
      'HYCITE ACCOUNT', 'HYCITE ACCOUNT NO', 'ACCOUNT NO',
    ]).trim() || null

    const numeroOrdenHycite = obtenerCampo(row, normalizedRow, [
      'NUMERO ORDEN HYCITE', 'NÚMERO ORDEN HYCITE', 'ORDER NUMBER', 'ORDEN HYCITE',
      'HYCITE ORDER', 'HYCITE ORDER NO', 'ORDER NO',
    ]).trim() || null

    const notasCargoVuelta = obtenerCampo(row, normalizedRow, [
      'NOTAS', 'NOTES', 'NOTA', 'COMENTARIOS', 'OBSERVATIONS', 'OBSERVACIONES',
    ]).trim() || null

    return {
      org_id: null,
      hycite_id: hyciteId,
      tipo_cliente: obtenerCampo(row, normalizedRow, ['CLIENTE']).trim() || 'HC',
      nombre,
      apellido,
      email: limpiarEmail(obtenerCampo(row, normalizedRow, ['CORREO ELECTRÓNICO', 'Email', 'Correo'])),
      telefono: telMovil || telCasa || null,
      telefono_casa: telCasa || null,
      direccion,
      ciudad,
    estado_region: estadoRegion,
    codigo_postal: codigoPostal,
    saldo_actual: parsearMonto(obtenerCampo(row, normalizedRow, ['SALDO ACTUAL', 'BALANCE', 'Saldo'])),
    monto_moroso: montoMoroso,
    dias_atraso: diasAtraso,
    estado_morosidad: estadoMorosidadFinal,
    nivel: isNaN(nivel) || nivel < 1 ? 1 : Math.min(nivel, 9),
    estado_cuenta: estadoCuenta,
    elegible_addon: (() => {
      const v = obtenerCampo(row, normalizedRow, ['ISELIGIBLEFORADDON', 'ELEGIBLE']).trim().toUpperCase()
      if (v === 'NO' || v === 'FALSE' || v === '0') return false
      return true
    })(),
    fecha_ultimo_pedido: parsearFecha(obtenerCampo(row, normalizedRow, ['ÚLTIMA FECHA DE COMPRA', 'FECHA ÚLTIMO PEDIDO'])),
    ultima_fecha_pago: parsearFecha(obtenerCampo(row, normalizedRow, ['ÚLTIMA FECHA DE PAGO', 'FECHA ÚLTIMO PAGO'])),
    origen: 'hycite_import',
    codigo_vendedor_hycite: obtenerCampo(row, normalizedRow, ['EMPRENDEDORES', 'VENDEDOR', 'Entrepreneur']).trim() || null,
    codigo_dist_hycite: obtenerCampo(row, normalizedRow, ['DISTRIBUIDOR']).trim() || null,
    updated_at: new Date().toISOString(),
    fecha_nacimiento: fechaNacimiento,
    estado_cuenta_raw: estadoRawCompleto || null,
    es_cargo_vuelta: esCargoVuelta,
    monto_cargo_vuelta: montoCargoVuelta,
    fecha_cargo_vuelta_import: fechaCargoVuelta,
    dias_vencido_import: diasVencido,
    numero_cuenta_hycite_import: numeroCuentaHycite,
    numero_orden_hycite_import: numeroOrdenHycite,
    notas_cargo_vuelta: notasCargoVuelta,
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
      const matched = field.aliases.some(alias => {
        const normalizedAlias = normalizarHeader(alias)
        if (normalizedAlias === normalizedHeader) return true
        if (normalizedAlias.length >= 4 && normalizedHeader.includes(normalizedAlias)) return true
        if (normalizedHeader.length >= 4 && normalizedAlias.includes(normalizedHeader)) return true
        return false
      })
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
  const { currentUser } = useUsers()
  const org_id = currentUser?.org_id
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
  const [cvDetectados, setCvDetectados] = useState(0)
  const [cvCasosCreados, setCvCasosCreados] = useState(0)
  const [cvPendientesMonto, setCvPendientesMonto] = useState(0)

  // Tab
  const [activeTab, setActiveTab] = useState<'hycite' | 'general' | 'revisiones'>('hycite')
  const [pendingRevisiones, setPendingRevisiones] = useState(0)

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

  const refrescarContador = useCallback(async () => {
    if (!configured || !org_id) return
    const { count } = await supabase
      .from('import_revisiones')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org_id)
      .eq('revisado', false)
    setPendingRevisiones(count ?? 0)
  }, [configured, org_id])

  useEffect(() => { refrescarContador() }, [refrescarContador])

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
        const worksheetRows = wb.SheetNames.map(sheetName =>
          XLSX.utils.sheet_to_json<SheetRow>(wb.Sheets[sheetName], { header: 1, defval: '', raw: false }),
        ).filter(rows => rows.length > 0)

        const initialRaw = worksheetRows.flatMap(rows => rows.slice(0, 10))
        const isBirthdayReport = initialRaw.some(row =>
          row.some(cell => String(cell).toUpperCase().includes('CUSTOMER BIRTHDAYS')),
        )
        setReportType(isBirthdayReport ? 'birthday_report' : 'customer_list')

        const keywords = ['HYCITE', 'HYCITE ID', 'CLIENTE', 'N DE CLIENTE', 'CUSTOMER', 'NOMBRE', 'NAME', 'APELLIDO', 'LAST', 'FIRST', 'CORREO ELECTRONICO', 'ELECTRONICO', 'EMAIL', 'PHONE', 'TELEFONO', 'BIRTH', 'BIRTHDAY', 'DOB']
        const aliasSet = new Set(
          SYSTEM_FIELDS_DEF.flatMap(field => field.aliases.map(alias => normalizarHeader(alias)))
        )

        const parseWorksheetRows = (allRows: SheetRow[]) => {
          let headerIndex = -1
          let bestMatchCount = 0
          let bestRowIndex = -1

          for (let i = 0; i < Math.min(allRows.length, 25); i++) {
            const row = allRows[i]
            if (!row || row.length < 2) continue
            const normalizedCells = row.map(cell => normalizarHeader(String(cell ?? '')))
            const rowStr = normalizedCells.join('|')
            if (keywords.some(k => rowStr.includes(k))) {
              headerIndex = i
              break
            }
            const matchCount = normalizedCells.filter(cell => aliasSet.has(cell)).length
            if (matchCount > bestMatchCount) {
              bestMatchCount = matchCount
              bestRowIndex = i
            }
          }
          if (headerIndex === -1 && bestMatchCount >= 2) headerIndex = bestRowIndex
          if (headerIndex === -1 && isBirthdayReport) headerIndex = 7

          const raw: SheetRow[] = headerIndex === -1 ? allRows : allRows.slice(headerIndex)
          if (raw.length < 2) return { headers: [] as string[], rows: [] as Record<string, string>[] }

          const seen = new Map<string, number>()
          const headers = raw[0].map(headerCell => {
            const s = String(headerCell || '').trim()
            const c = seen.get(s) ?? 0; seen.set(s, c + 1)
            return c === 0 ? s : `${s}_${c}`
          })
          const rows: Record<string, string>[] = raw.slice(1).map(row =>
            Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()]))
          ).filter(row => Object.values(row).some(value => value.trim()))

          return { headers, rows }
        }

        const parsedSheets = worksheetRows.map(parseWorksheetRows).filter(sheet => sheet.rows.length > 0)
        if (parsedSheets.length === 0) {
          setParseError('No se pudo detectar el formato de los datos.')
          return
        }

        const headers: string[] = []
        const seenHeaders = new Set<string>()
        parsedSheets.forEach(sheet => {
          sheet.headers.forEach(header => {
            const normalized = normalizarHeader(header)
            if (!header.trim() || seenHeaders.has(normalized)) return
            headers.push(header)
            seenHeaders.add(normalized)
          })
        })
        const rows = parsedSheets.flatMap(sheet => sheet.rows)

        if (rows.length === 0) {
          setParseError('No se encontraron filas de datos.')
          return
        }

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
    if (!org_id) {
      showToast('No se pudo determinar la organización del usuario actual.', 'error')
      return
    }
    const mappedRows = rawRows.map(row => applyMapping(row, columnMapping))
    const validos = mappedRows
      .map(parsearFila)
      .filter((c): c is ClienteImport => c !== null)
      .map((c) => ({ ...c, org_id }))
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
    const cvTotal = uniqueClientes.filter(c => c.es_cargo_vuelta).length
    const cvConMonto = uniqueClientes.filter(c => c.es_cargo_vuelta && c.monto_cargo_vuelta && c.monto_cargo_vuelta > 0).length
    setPreviewKpis({
      existentes: existentesCount,
      nuevos: uniqueClientes.length - existentesCount,
      conFechaNac: uniqueClientes.filter(c => c.fecha_nacimiento).length,
      conMoroso: uniqueClientes.filter(c => c.monto_moroso > 0).length,
      sinTelefono: uniqueClientes.filter(c => !c.telefono).length,
      cargoVuelta: cvTotal,
      cargoVueltaConMonto: cvConMonto,
    })
    setKpisLoading(false)
  }, [rawRows, columnMapping, org_id, showToast])

  // ── Step 4 → import ───────────────────────────────────────────────────────

  const handleImportar = async () => {
    if (!session?.user.id || !org_id || clientes.length === 0) return
    setStep('importing')
    let imp = 0, up = 0, err = 0
    let cvDet = 0, cvCre = 0, cvPend = 0
    const newErrorRows: Array<{ hycite_id: string; nombre: string; error: string }> = []

    for (let i = 0; i < clientes.length; i += 50) {
      const lote = clientes.slice(i, i + 50)
      const idsLote = lote.map(c => c.hycite_id)
      const cuentasLote = lote.map(c => c.hycite_id)
      const telsLote = lote.map(c => normalizarTelefono(c.telefono)).filter(Boolean) as string[]
      const filtrosExistentes = [
        `hycite_id.in.(${idsLote.join(',')})`,
        `numero_cuenta_financiera.in.(${cuentasLote.join(',')})`,
        ...(telsLote.length > 0 ? [`telefono.in.(${telsLote.join(',')})`] : []),
      ]

      const { data: existentes } = await supabase
        .from('clientes')
        .select('id, hycite_id, numero_cuenta_financiera, fecha_nacimiento, nombre, apellido, telefono, telefono_casa, email, direccion, ciudad, estado_region, codigo_postal, fecha_ultimo_pedido, ultima_fecha_pago, codigo_vendedor_hycite, codigo_dist_hycite, vendedor_id, estado_cuenta, estado_cuenta_raw')
        .or(filtrosExistentes.join(','))

      const mapId = new Map(existentes?.filter(e => e.hycite_id).map(e => [e.hycite_id, e]) || [])
      const mapCuenta = new Map(existentes?.filter(e => e.numero_cuenta_financiera).map(e => [e.numero_cuenta_financiera, e]) || [])
      const mapTel = new Map(existentes?.filter(e => e.telefono).map(e => [normalizarTelefono(e.telefono), e]) || [])

      const buildPayload = (c: ClienteImport) => {
        const clienteDbFields = { ...c }
        delete clienteDbFields.es_cargo_vuelta
        delete clienteDbFields.monto_cargo_vuelta
        delete clienteDbFields.fecha_cargo_vuelta_import
        delete clienteDbFields.dias_vencido_import
        delete clienteDbFields.numero_cuenta_hycite_import
        delete clienteDbFields.numero_orden_hycite_import
        delete clienteDbFields.notas_cargo_vuelta

        const telMatch = c.telefono ? mapTel.get(normalizarTelefono(c.telefono)) : null
        const exById = mapId.get(c.hycite_id) || mapCuenta.get(c.hycite_id) || null
        const exByTel = telMatch && !telMatch.hycite_id ? telMatch : null
        const ex = exById || exByTel

        const pickIfDifferent = (incoming: string | null | undefined, existing: string | null | undefined, normalize?: (v: string) => string) => {
          if (!incoming) return existing ?? null
          const inc = incoming.trim()
          if (!inc) return existing ?? null
          if (!existing) return inc
          const norm = normalize ?? ((v: string) => v.trim().toLowerCase())
          return norm(inc) === norm(existing) ? existing : inc
        }

        const pickTelefono = (incoming: string | null | undefined, existing: string | null | undefined) => {
          if (!incoming) return existing ?? null
          const inc = normalizarTelefono(incoming)
          if (!inc) return existing ?? null
          if (!existing) return inc
          const exn = normalizarTelefono(existing)
          return exn === inc ? existing : inc
        }

        const base = ex ? {
          ...clienteDbFields,
          org_id,
          id: ex.id,
          // Preserve preferred fields
          fecha_nacimiento: ex.fecha_nacimiento || c.fecha_nacimiento,
          nombre: ex.nombre || c.nombre,
          apellido: ex.apellido || c.apellido,
          vendedor_id: ex.vendedor_id || session!.user.id,
          numero_cuenta_financiera: ex.numero_cuenta_financiera || c.hycite_id,
          // Update if incoming non-empty and different
          telefono: pickTelefono(c.telefono, ex.telefono),
          telefono_casa: pickTelefono(c.telefono_casa, ex.telefono_casa),
          email: pickIfDifferent(c.email, ex.email, (v) => v.trim().toLowerCase()),
          direccion: pickIfDifferent(c.direccion, ex.direccion),
          ciudad: pickIfDifferent(c.ciudad, ex.ciudad),
          estado_region: pickIfDifferent(c.estado_region, ex.estado_region, (v) => v.trim().toUpperCase()),
          codigo_postal: pickIfDifferent(c.codigo_postal, ex.codigo_postal, (v) => v.replace(/\s+/g, '').toUpperCase()),
          // Always refresh from import
          saldo_actual: c.saldo_actual,
          monto_moroso: c.monto_moroso,
          dias_atraso: c.dias_atraso,
          estado_morosidad: c.estado_morosidad,
          // Refresh only if incoming non-empty
          fecha_ultimo_pedido: c.fecha_ultimo_pedido || ex.fecha_ultimo_pedido || null,
          ultima_fecha_pago: c.ultima_fecha_pago || ex.ultima_fecha_pago || null,
          codigo_vendedor_hycite: c.codigo_vendedor_hycite || ex.codigo_vendedor_hycite || null,
          codigo_dist_hycite: c.codigo_dist_hycite || ex.codigo_dist_hycite || null,
          estado_cuenta_raw: c.estado_cuenta_raw || ex.estado_cuenta_raw || null,
        } : {
          ...clienteDbFields,
          org_id,
          vendedor_id: session!.user.id,
          numero_cuenta_financiera: c.hycite_id,
        }

        if (ex?.estado_cuenta && base.estado_cuenta === 'cancelacion_total' && ex.estado_cuenta !== 'cancelacion_total') {
          base.estado_cuenta = ex.estado_cuenta
        }
        if (base.estado_cuenta == null) delete base.estado_cuenta

        // Add estado_operativo only when estado_cuenta column was mapped
        if (columnMapping['estado_cuenta'] && base.estado_cuenta != null) {
          return { ...base, estado_operativo: ESTADO_OPERATIVO_MAP[base.estado_cuenta] }
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

      // ── Cargo de Vuelta: llamar RPC para clientes CV del lote ─────────────
      // Solo si el upsert del lote no falló completamente (err parciales se manejan individualmente)
      for (const c of lote) {
        if (!c.es_cargo_vuelta) continue
        cvDet += 1

        // Buscar el cliente_id desde la DB (necesario para la RPC)
        const { data: cData } = await supabase
          .from('clientes')
          .select('id')
          .eq('hycite_id', c.hycite_id)
          .eq('org_id', org_id)
          .maybeSingle()

        if (!cData?.id) continue

        const montoCV = c.monto_cargo_vuelta && c.monto_cargo_vuelta > 0 ? c.monto_cargo_vuelta : null

        if (montoCV === null) {
          // Sin monto: no crear caso — dejar como pendiente
          cvPend += 1
          continue
        }

        const { error: rpcErr } = await supabase.rpc('fn_abrir_o_actualizar_cargo_vuelta_case', {
          p_cliente_id: cData.id,
          p_monto_cargo_vuelta: montoCV,
          p_fecha_cargo_vuelta: c.fecha_cargo_vuelta_import ?? null,
          p_dias_vencido: c.dias_vencido_import ?? null,
          p_numero_cuenta_hycite: c.numero_cuenta_hycite_import ?? null,
          p_numero_orden_hycite: c.numero_orden_hycite_import ?? null,
          p_notas: c.notas_cargo_vuelta ?? null,
        })

        if (rpcErr) {
          console.error('[CV RPC]', c.hycite_id, rpcErr.message)
          newErrorRows.push({
            hycite_id: c.hycite_id,
            nombre: [c.nombre, c.apellido].filter(Boolean).join(' ') || '',
            error: `Cargo vuelta: ${rpcErr.message}`,
          })
        } else {
          cvCre += 1
        }
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
    setCvDetectados(cvDet)
    setCvCasosCreados(cvCre)
    setCvPendientesMonto(cvPend)
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
    setCvDetectados(0)
    setCvCasosCreados(0)
    setCvPendientesMonto(0)
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
            title="Importaciones"
            subtitle="Hy-Cite · Revisiones OCR"
          />

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--color-border)', marginBottom: '0.25rem' }}>
            {([
              { key: 'hycite', label: 'Excel / Hy-Cite' },
              { key: 'general', label: 'General / Google Sheets' },
              { key: 'revisiones', label: `Revisiones OCR${pendingRevisiones > 0 ? ` (${pendingRevisiones})` : ''}` },
            ] as { key: 'hycite' | 'general' | 'revisiones'; label: string }[]).map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'none',
                  border: 'none',
                  borderBottom: `2px solid ${activeTab === t.key ? 'var(--color-primary, #3b82f6)' : 'transparent'}`,
                  marginBottom: '-2px',
                  fontWeight: activeTab === t.key ? 700 : 400,
                  fontSize: '0.875rem',
                  color: activeTab === t.key ? 'var(--color-primary, #3b82f6)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* OCR Review tab */}
          {activeTab === 'revisiones' && <ImportRevisiones onRefreshCount={refrescarContador} />}

          {/* General import tab */}
          {activeTab === 'general' && <ImportGeneral />}

          {/* Hy-Cite wizard tab */}
          {activeTab === 'hycite' && (<><div className="card" style={{ padding: '1.5rem' }}>
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
                      ...(previewKpis.cargoVuelta > 0 ? [
                        { label: 'Cargo de Vuelta', value: previewKpis.cargoVuelta, color: '#7c3aed', icon: '↩️' },
                        { label: 'CV con monto', value: previewKpis.cargoVueltaConMonto, color: '#059669', icon: '💵' },
                        { label: 'CV sin monto', value: previewKpis.cargoVuelta - previewKpis.cargoVueltaConMonto, color: previewKpis.cargoVuelta - previewKpis.cargoVueltaConMonto > 0 ? '#d97706' : '#6b7280', icon: '⏳' },
                      ] : []),
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
                        {['# Cliente', 'Nombre', 'Teléfono', 'Región', 'Estado', 'Saldo', 'Morosidad', 'Nacimiento'].map(h => (
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
                            <td style={{ padding: '0.4rem 0.65rem', color: c.estado_region ? 'inherit' : 'var(--color-text-muted)' }}>{c.estado_region ?? '—'}</td>
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

                {cvDetectados > 0 && (
                  <div style={{ padding: '0.85rem 1rem', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '0.5rem' }}>
                    <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 700, color: '#7c3aed' }}>↩️ Resumen Cargo de Vuelta</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                      {[
                        { label: 'Detectados', value: cvDetectados, color: '#7c3aed' },
                        { label: 'Casos creados/actualizados', value: cvCasosCreados, color: '#059669' },
                        { label: 'Pendientes de monto', value: cvPendientesMonto, color: cvPendientesMonto > 0 ? '#d97706' : '#6b7280' },
                      ].map(s => (
                        <div key={s.label} style={{ padding: '0.55rem 0.65rem', background: 'var(--color-surface)', borderRadius: '0.4rem', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    {cvPendientesMonto > 0 && (
                      <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#d97706' }}>
                        ⚠️ {cvPendientesMonto} cliente{cvPendientesMonto !== 1 ? 's' : ''} con estado Cargo de Vuelta importado{cvPendientesMonto !== 1 ? 's' : ''} sin "Monto cargo de vuelta". Captura el monto desde Clientes o Cartera.
                      </p>
                    )}
                  </div>
                )}

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

          {/* ── Import history ── */}
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
        </>
      )}
    </div>
  )
}
