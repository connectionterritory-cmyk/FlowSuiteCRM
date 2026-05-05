/**
 * Importador híbrido Hy-Cite / Google Sheet para FlowSuiteCRM
 * -----------------------------------------------------------
 * Soporta dos formatos:
 *
 * 1) CustomerList clásico de Hy-Cite
 *    - Upsert en `clientes` por `hycite_id`
 *
 * 2) Hoja operativa tipo "Clientes_Oct2022"
 *    - Si "Estado Cuenta" contiene "Prospecto" o "Lead" -> `leads`
 *    - Todo lo demás -> `clientes`
 *    - Clientes con teléfono: upsert por `org_id,telefono`
 *    - Leads con teléfono: upsert por `telefono`
 *
 * Uso recomendado:
 *   npx ts-node tools/import_hycite.ts \
 *     --file="/ruta/archivo.xlsx" \
 *     --user="uuid-del-usuario" \
 *     [--org-id="uuid-org"] \
 *     [--owner-id="uuid-owner-para-leads"] \
 *     [--source-url="https://docs.google.com/spreadsheets/d/.../edit"] \
 *     [--dry-run="true"]
 */

import * as XLSX from 'xlsx'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY en .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

type EstadoCuenta = 'actual' | 'cancelacion_total' | 'cargo_de_vuelta' | 'inactivo'
type InputFormat = 'classic_hycite' | 'clientes_oct2022'

interface ClassicHyciteRow {
  '# DE CLIENTE'?: string
  'CLIENTE'?: string
  'NOMBRE'?: string
  'DIRECCIÓN'?: string
  'CIUDAD'?: string
  'ESTADO'?: string
  'CÓDIGO POSTAL'?: string
  'STATUS'?: string
  'NOMBRE_1'?: string
  'SEGUNDO NOMBRE'?: string
  'APELLIDO PATERNO'?: string
  'APELLIDO MATERNO'?: string
  'CORREO ELECTRÓNICO'?: string
  'TELÉFONO DE CASA'?: string
  'TELÉFONO DEL TRABAJO'?: string
  'TELÉFONO MÓVIL'?: string
  'DISTRIBUIDOR'?: string
  'VENDEDOR'?: string
  'NIVEL'?: string
  'CRÉDITO DISPONIBLE'?: string
  'MENSUALIDAD'?: string
  'FECHA DE CIERRE'?: string
  'FECHA DE ORDEN ORIGINAL'?: string
  'SALDO ACTUAL'?: string
  '0-30 DÍAS DE MOROSIDAD'?: string
  '31-60 DÍAS DE MOROSIDAD'?: string
  '61-90 DÍAS DE MOROSIDAD'?: string
  'SOBRE 90 DÍAS DE MOROSIDAD'?: string
  'ÚLTIMA FECHA DE COMPRA'?: string
  'ÚLTIMA FECHA DE PAGO'?: string
  [key: string]: unknown
}

type GenericRow = Record<string, unknown>

interface ClienteClassicPayload {
  org_id: string
  hycite_id: string
  numero_cuenta_financiera: string
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
  saldo_actual?: number
  monto_moroso?: number
  dias_atraso?: number
  nivel: number
  estado_cuenta: EstadoCuenta
  estado_operativo: 'activo' | 'inactivo' | 'cancelado'
  estado_cuenta_raw: string | null
  credito_disponible?: number
  pago_minimo_mensual?: number
  elegible_addon: boolean
  fecha_ultimo_pedido: string | null
  ultima_fecha_pago: string | null
  fecha_orden: string | null
  fecha_cierre: string | null
  origen: 'hycite_import'
  codigo_vendedor_hycite: string | null
  codigo_dist_hycite: string | null
  updated_at: string
}

interface ClienteSheetPayload {
  org_id: string
  tipo_cliente: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  telefono_casa: string | null
  email: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
  tipo_cuenta_hycite: string | null
  estado_cuenta: EstadoCuenta | null
  estado_cuenta_raw: string | null
  estado_operativo: 'activo' | 'inactivo' | 'cancelado' | null
  saldo_actual?: number
  credito_disponible?: number
  pago_minimo_mensual?: number
  factor_ingresos?: number
  fecha_orden: string | null
  fecha_cierre: string | null
  metodo_pago: string | null
  vendedor_hycite_nombre: string | null
  origen: 'hycite_import'
  fuente_import: 'google_sheet_clientes_oct2022'
  import_file_name: string
  import_drive_url: string | null
  updated_at: string
}

interface LeadSheetPayload {
  org_id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  telefono_trabajo: string | null
  email: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
  fuente: string
  estado_pipeline: string
  owner_id: string | null
  run_id: string
  file_name_origen: string
  confianza_ocr: string
  fuente_import: 'google_sheet_clientes_oct2022'
  import_file_name: string
  import_drive_url: string | null
  notas_extraidas: string | null
}

function str(v: unknown): string {
  return String(v ?? '').trim()
}

function nullStr(v: unknown): string | null {
  const value = str(v)
  return value.length ? value : null
}

function normalizeHeader(value: string): string {
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

function cleanPhone(value: unknown): string | null {
  const digits = str(value).replace(/\D/g, '')
  return digits.length >= 7 ? digits.slice(-10) : null
}

function cleanEmail(value: unknown): string | null {
  const email = str(value).toLowerCase()
  return email.includes('@') ? email : null
}

function parseMoney(value: unknown): number | null {
  const raw = str(value)
  if (!raw) return null
  const normalized = raw.replace(/[^0-9.-]/g, '')
  if (!/[0-9]/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatValidDate(year: string, month: string, day: string): string | null {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null

  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null
  }

  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseDate(raw: unknown): string | null {
  const value = str(raw)
  if (!value) return null
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return formatValidDate(iso[1], iso[2], iso[3])

  const isoWithTime = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+\d{2}:\d{2}:\d{2}$/)
  if (isoWithTime) return formatValidDate(isoWithTime[1], isoWithTime[2], isoWithTime[3])

  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slash) {
    const [, m, d, yRaw] = slash
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw
    return formatValidDate(y, m, d)
  }

  const dash = value.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/)
  if (dash) {
    const [, d, m, yRaw] = dash
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw
    return formatValidDate(y, m, d)
  }

  return null
}

function splitName(fullName: string | null): { nombre: string | null; apellido: string | null } {
  if (!fullName) return { nombre: null, apellido: null }
  const parts = fullName.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { nombre: null, apellido: null }
  if (parts.length === 1) return { nombre: parts[0], apellido: null }
  return {
    nombre: parts[0] ?? null,
    apellido: parts.slice(1).join(' ') || null,
  }
}

function deriveClassicEstado(status: unknown): EstadoCuenta {
  const s = str(status).toUpperCase()
  if (s === 'PURGED' || s === 'PURGADO' || s.includes('CANCEL')) return 'cancelacion_total'
  if (s === 'INACTIVE' || s === 'INACTIVO') return 'inactivo'
  return 'actual'
}

function deriveSheetEstado(estadoCuentaRaw: unknown): EstadoCuenta | null {
  const value = str(estadoCuentaRaw).toLowerCase()
  if (!value) return null
  if (value.includes('cancel')) return 'cancelacion_total'
  if (value.includes('inactivo')) return 'inactivo'
  if (value.includes('actual') || value.includes('current')) return 'actual'
  return null
}

function deriveEstadoOperativo(estado: EstadoCuenta | null): 'activo' | 'inactivo' | 'cancelado' | null {
  if (!estado) return null
  if (estado === 'cancelacion_total') return 'cancelado'
  if (estado === 'inactivo') return 'inactivo'
  return 'activo'
}

function calculateClassicMoroso(row: ClassicHyciteRow): number {
  return (
    (parseMoney(row['0-30 DÍAS DE MOROSIDAD']) ?? 0) +
    (parseMoney(row['31-60 DÍAS DE MOROSIDAD']) ?? 0) +
    (parseMoney(row['61-90 DÍAS DE MOROSIDAD']) ?? 0) +
    (parseMoney(row['SOBRE 90 DÍAS DE MOROSIDAD']) ?? 0)
  )
}

function hasClassicMorosityBuckets(row: ClassicHyciteRow): boolean {
  return [
    row['0-30 DÍAS DE MOROSIDAD'],
    row['31-60 DÍAS DE MOROSIDAD'],
    row['61-90 DÍAS DE MOROSIDAD'],
    row['SOBRE 90 DÍAS DE MOROSIDAD'],
  ].some((value) => str(value).length > 0)
}

function calculateClassicDiasAtraso(row: ClassicHyciteRow): number {
  if ((parseMoney(row['SOBRE 90 DÍAS DE MOROSIDAD']) ?? 0) > 0) return 91
  if ((parseMoney(row['61-90 DÍAS DE MOROSIDAD']) ?? 0) > 0) return 61
  if ((parseMoney(row['31-60 DÍAS DE MOROSIDAD']) ?? 0) > 0) return 31
  if ((parseMoney(row['0-30 DÍAS DE MOROSIDAD']) ?? 0) > 0) return 1
  return 0
}

function calculateDiasAtrasoFromEstado(value: unknown): number {
  const estado = normalizeHeader(str(value))
  if (!estado || estado === 'ACTUAL') return 0
  if (estado.includes('61 A 90') || estado.includes('61 90')) return 61
  if (estado.includes('31 A 60') || estado.includes('31 60')) return 31
  if (estado.includes('0 A 30') || estado.includes('0 30')) return 1
  if (estado.includes('90')) return 91
  return 0
}

function parseClassicRow(row: ClassicHyciteRow, orgId: string, lineNum: number): ClienteClassicPayload | null {
  const normalized = buildNormalizedRow(row)
  const hyciteId = str(lookup(row, normalized, [
    '# DE CLIENTE',
    'N.° de cliente',
    'N° de cliente',
    'No de cliente',
    'Numero de Cliente',
    'Número de Cliente',
    'Numero de Cuenta HyCite',
    'Número de Cuenta HyCite',
  ]))
  if (!hyciteId) {
    console.warn(`  ⚠️ Línea ${lineNum}: sin # DE CLIENTE, omitida`)
    return null
  }

  let nombre = nullStr(lookup(row, normalized, ['NOMBRE_1', 'Nombre', 'NOMBRE']))
  const apellidoPaterno = str(row['APELLIDO PATERNO'])
  const apellidoMaterno = str(row['APELLIDO MATERNO'])
  const apellidoLegacy = [apellidoPaterno, apellidoMaterno].filter(Boolean).join(' ') || null
  let apellido = nullStr(lookup(row, normalized, ['Apellido', 'APELLIDO'])) ?? apellidoLegacy

  if (!nombre && str(row['NOMBRE'])) {
    const parts = str(row['NOMBRE']).split(/\s+/).filter(Boolean)
    nombre = parts[0] || null
    apellido = apellido || parts.slice(1).join(' ') || null
  }

  const estadoRaw = lookup(row, normalized, ['STATUS', 'Estado', 'ESTADO'])
  const moroso = parseMoney(lookup(row, normalized, ['Moroso', 'MOROSO']))
  const estadoCuenta = deriveClassicEstado(estadoRaw)
  const saldoActual = parseMoney(lookup(row, normalized, ['SALDO ACTUAL', 'Saldo', 'Balance']))
  const creditoDisponible = parseMoney(lookup(row, normalized, ['CRÉDITO DISPONIBLE', 'Credito Disponible']))
  const pagoMinimoMensual = parseMoney(lookup(row, normalized, ['MENSUALIDAD', 'Mensualidad']))
  const hasMorosityBuckets = hasClassicMorosityBuckets(row)
  const diasAtraso = hasMorosityBuckets
    ? calculateClassicDiasAtraso(row)
    : calculateDiasAtrasoFromEstado(estadoRaw)

  return {
    org_id: orgId,
    hycite_id: hyciteId,
    numero_cuenta_financiera: hyciteId,
    tipo_cliente: str(lookup(row, normalized, ['CLIENTE', 'Cliente', 'Financiera'])) || 'HC',
    nombre,
    apellido,
    email: cleanEmail(lookup(row, normalized, ['CORREO ELECTRÓNICO', 'Correo electrónico', 'Email', 'email'])),
    telefono: cleanPhone(lookup(row, normalized, ['TELÉFONO MÓVIL', 'Teléfono móvil', 'Tel Móvil', 'Movil', 'Móvil'])),
    telefono_casa: cleanPhone(lookup(row, normalized, ['TELÉFONO DE CASA', 'Teléfono de casa', 'Tel Casa', 'Unnamed: 5'])),
    direccion: nullStr(str(lookup(row, normalized, ['DIRECCIÓN', 'Dirección', 'Direccion'])).replace(/\n/g, ', ')),
    ciudad: nullStr(lookup(row, normalized, ['CIUDAD', 'Ciudad'])),
    estado_region: nullStr(lookup(row, normalized, ['Estado Region', 'Estado Región'])),
    codigo_postal: nullStr(lookup(row, normalized, ['CÓDIGO POSTAL', 'Código Postal', 'ZIP'])),
    ...(saldoActual !== null ? { saldo_actual: saldoActual } : {}),
    ...(hasMorosityBuckets
      ? { monto_moroso: calculateClassicMoroso(row), dias_atraso: diasAtraso }
      : moroso !== null
        ? { monto_moroso: moroso, dias_atraso: diasAtraso }
        : {}),
    nivel: Math.min(Math.max(parseInt(str(lookup(row, normalized, ['NIVEL', 'Nivel'])) || '1', 10) || 1, 1), 9),
    estado_cuenta: estadoCuenta,
    estado_operativo: deriveEstadoOperativo(estadoCuenta) ?? 'activo',
    estado_cuenta_raw: nullStr(estadoRaw),
    ...(creditoDisponible !== null ? { credito_disponible: creditoDisponible } : {}),
    ...(pagoMinimoMensual !== null ? { pago_minimo_mensual: pagoMinimoMensual } : {}),
    elegible_addon: !['NO', 'FALSE', '0'].includes(normalizeHeader(str(lookup(row, normalized, ['IsEligibleForAddOn', 'Elegible para Agregado'])))),
    fecha_ultimo_pedido: parseDate(lookup(row, normalized, ['ÚLTIMA FECHA DE COMPRA', 'Fecha del último pedido', 'Fecha del ultimo pedido'])),
    ultima_fecha_pago: parseDate(lookup(row, normalized, ['ÚLTIMA FECHA DE PAGO'])),
    fecha_orden: parseDate(lookup(row, normalized, ['FECHA DE ORDEN ORIGINAL'])),
    fecha_cierre: parseDate(lookup(row, normalized, ['FECHA DE CIERRE'])),
    origen: 'hycite_import',
    codigo_vendedor_hycite: nullStr(lookup(row, normalized, ['VENDEDOR', 'Vendedor', 'Emprendedores'])),
    codigo_dist_hycite: nullStr(lookup(row, normalized, ['DISTRIBUIDOR', 'Distribuidor'])),
    updated_at: new Date().toISOString(),
  }
}

function buildNormalizedRow(row: GenericRow): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  Object.entries(row).forEach(([key, value]) => {
    const normalized = normalizeHeader(key)
    if (!(normalized in result)) result[normalized] = value
  })
  return result
}

function lookup(row: GenericRow, normalized: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && str(row[alias])) return row[alias]
    const normalizedValue = normalized[normalizeHeader(alias)]
    if (normalizedValue !== undefined && normalizedValue !== null && str(normalizedValue)) return normalizedValue
  }
  return undefined
}

function isLeadRow(row: GenericRow, normalized: Record<string, unknown>): boolean {
  const estadoCuenta = str(lookup(row, normalized, ['Estado Cuenta', 'ESTADO CUENTA', 'Estado de Cuenta']))
    .toLowerCase()
  return estadoCuenta.includes('prospecto') || estadoCuenta.includes('lead')
}

function preferredPhone(row: GenericRow, normalized: Record<string, unknown>): string | null {
  return (
    cleanPhone(lookup(row, normalized, ['Tel Móvil', 'TELÉFONO MÓVIL', 'Telefono movil', 'Celular', 'Mobile'])) ??
    cleanPhone(lookup(row, normalized, ['Tel Casa', 'TELÉFONO DE CASA', 'Telefono casa', 'Home Phone'])) ??
    cleanPhone(lookup(row, normalized, ['Tel Trabajo', 'TELÉFONO DEL TRABAJO', 'Telefono trabajo', 'Work Phone']))
  )
}

function toSheetClientePayload(
  row: GenericRow,
  normalized: Record<string, unknown>,
  orgId: string,
  importFileName: string,
  sourceUrl: string | null,
): ClienteSheetPayload {
  const fullName = nullStr(lookup(row, normalized, ['Nombre', 'NOMBRE']))
  const { nombre, apellido } = splitName(fullName)
  const estadoCuentaRaw = nullStr(lookup(row, normalized, ['Estado Cuenta', 'ESTADO CUENTA', 'Estado de Cuenta']))
  const estadoCuenta = deriveSheetEstado(estadoCuentaRaw)
  const saldoActual = parseMoney(lookup(row, normalized, ['Saldo Actual', 'SALDO ACTUAL']))
  const creditoDisponible = parseMoney(lookup(row, normalized, ['Crédito Disponible', 'CREDITO DISPONIBLE']))
  const pagoMinimoMensual = parseMoney(lookup(row, normalized, ['Pago Mínimo Mensual', 'Pago Minimo Mensual', 'Mensualidad', 'MENSUALIDAD']))
  const factorIngresos = parseMoney(lookup(row, normalized, ['Factor Ingresos', 'Factor de Ingresos', 'FACTOR INGRESOS']))

  return {
    org_id: orgId,
    tipo_cliente: 'HC',
    nombre,
    apellido,
    telefono: preferredPhone(row, normalized),
    telefono_casa: cleanPhone(lookup(row, normalized, ['Tel Casa', 'TELÉFONO DE CASA'])),
    email: cleanEmail(lookup(row, normalized, ['Email', 'EMAIL', 'Correo Electrónico'])),
    direccion: nullStr(lookup(row, normalized, ['Dirección', 'DIRECCIÓN', 'Direccion'])),
    ciudad: nullStr(lookup(row, normalized, ['Ciudad', 'CIUDAD'])),
    estado_region: nullStr(lookup(row, normalized, ['Estado', 'ESTADO'])),
    codigo_postal: nullStr(lookup(row, normalized, ['ZIP', 'Código Postal', 'CÓDIGO POSTAL'])),
    tipo_cuenta_hycite: nullStr(lookup(row, normalized, ['Tipo Cuenta', 'TIPO CUENTA'])),
    estado_cuenta: estadoCuenta,
    estado_cuenta_raw: estadoCuentaRaw,
    estado_operativo: deriveEstadoOperativo(estadoCuenta),
    ...(saldoActual !== null ? { saldo_actual: saldoActual } : {}),
    ...(creditoDisponible !== null ? { credito_disponible: creditoDisponible } : {}),
    ...(pagoMinimoMensual !== null ? { pago_minimo_mensual: pagoMinimoMensual } : {}),
    ...(factorIngresos !== null ? { factor_ingresos: factorIngresos } : {}),
    fecha_orden: parseDate(lookup(row, normalized, ['Fecha Orden', 'Fecha de Orden', 'Fecha de Orden Original', 'FECHA DE ORDEN ORIGINAL'])),
    fecha_cierre: parseDate(lookup(row, normalized, ['Fecha Cierre', 'Fecha de Cierre', 'FECHA DE CIERRE'])),
    metodo_pago: nullStr(lookup(row, normalized, ['Método Pago', 'Metodo Pago', 'Método de Pago', 'Metodo de Pago'])),
    vendedor_hycite_nombre: nullStr(lookup(row, normalized, ['Emprendedor', 'EMPRENDEDOR', 'EMPRENDEDORES'])),
    origen: 'hycite_import',
    fuente_import: 'google_sheet_clientes_oct2022',
    import_file_name: importFileName,
    import_drive_url: sourceUrl,
    updated_at: new Date().toISOString(),
  }
}

function toSheetLeadPayload(
  row: GenericRow,
  normalized: Record<string, unknown>,
  orgId: string,
  importFileName: string,
  sourceUrl: string | null,
  runId: string,
  ownerId: string | null,
): LeadSheetPayload {
  const fullName = nullStr(lookup(row, normalized, ['Nombre', 'NOMBRE']))
  const { nombre, apellido } = splitName(fullName)
  const tipoCuenta = nullStr(lookup(row, normalized, ['Tipo Cuenta', 'TIPO CUENTA']))
  const estadoCuenta = nullStr(lookup(row, normalized, ['Estado Cuenta', 'ESTADO CUENTA']))
  const emprendedor = nullStr(lookup(row, normalized, ['Emprendedor', 'EMPRENDEDOR']))
  const notas = [tipoCuenta && `Tipo Cuenta: ${tipoCuenta}`, estadoCuenta && `Estado Cuenta: ${estadoCuenta}`, emprendedor && `Emprendedor: ${emprendedor}`]
    .filter(Boolean)
    .join(' | ') || null

  return {
    org_id: orgId,
    nombre,
    apellido,
    telefono: preferredPhone(row, normalized),
    telefono_trabajo: cleanPhone(lookup(row, normalized, ['Tel Trabajo', 'TELÉFONO DEL TRABAJO'])),
    email: cleanEmail(lookup(row, normalized, ['Email', 'EMAIL', 'Correo Electrónico'])),
    direccion: nullStr(lookup(row, normalized, ['Dirección', 'DIRECCIÓN', 'Direccion'])),
    ciudad: nullStr(lookup(row, normalized, ['Ciudad', 'CIUDAD'])),
    estado_region: nullStr(lookup(row, normalized, ['Estado', 'ESTADO'])),
    codigo_postal: nullStr(lookup(row, normalized, ['ZIP', 'Código Postal', 'CÓDIGO POSTAL'])),
    fuente: 'Import Google Sheet Oct2022',
    estado_pipeline: 'nuevo',
    owner_id: ownerId,
    run_id: runId,
    file_name_origen: importFileName,
    confianza_ocr: 'alta',
    fuente_import: 'google_sheet_clientes_oct2022',
    import_file_name: importFileName,
    import_drive_url: sourceUrl,
    notas_extraidas: notas,
  }
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((header) => {
    const clean = str(header)
    const count = seen.get(clean) ?? 0
    seen.set(clean, count + 1)
    return count === 0 ? clean : `${clean}_${count}`
  })
}

function detectFormat(headers: string[]): InputFormat {
  const normalized = headers.map(normalizeHeader)

  const classicScore = normalized.filter((header) =>
    ['# DE CLIENTE', 'N.° DE CLIENTE', 'NUMERO DE CUENTA HYCITE', 'STATUS', 'APELLIDO PATERNO', 'TELÉFONO MÓVIL', 'MOVIL', 'MOROSO', 'VENDEDOR', 'EMPRENDEDORES', 'DISTRIBUIDOR']
      .map(normalizeHeader)
      .includes(header)
  ).length

  const sheetScore = normalized.filter((header) =>
    ['NOMBRE', 'DIRECCIÓN', 'CIUDAD', 'ESTADO', 'ZIP', 'TEL CASA', 'TEL MÓVIL', 'ESTADO CUENTA', 'TIPO CUENTA', 'CRÉDITO DISPONIBLE', 'EMPRENDEDOR']
      .map(normalizeHeader)
      .includes(header)
  ).length

  if (sheetScore >= 4 && sheetScore >= classicScore) return 'clientes_oct2022'
  return 'classic_hycite'
}

function readRows(filePath: string): { format: InputFormat; headers: string[]; rows: GenericRow[] } {
  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false })
  const parsedSheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false })

    if (raw.length < 2) return null

    const headers = uniqueHeaders((raw[0] as string[]).map((value) => str(value)))
    const rows = raw
      .slice(1)
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, str((row as string[])[index] ?? '')])))
      .filter((row) => Object.values(row).some((value) => str(value).length > 0))

    if (rows.length === 0) return null
    return {
      format: detectFormat(headers),
      headers,
      rows,
    }
  }).filter((sheet): sheet is { format: InputFormat; headers: string[]; rows: GenericRow[] } => sheet !== null)

  if (parsedSheets.length === 0) {
    throw new Error('El archivo no tiene suficientes filas para importar.')
  }

  const formats = new Set(parsedSheets.map((sheet) => sheet.format))
  if (formats.size > 1) {
    throw new Error('El archivo mezcla formatos de importación distintos en varias hojas.')
  }

  const headers: string[] = []
  const seenHeaders = new Set<string>()
  parsedSheets.forEach((sheet) => {
    sheet.headers.forEach((header) => {
      const normalized = normalizeHeader(header)
      if (!header || seenHeaders.has(normalized)) return
      headers.push(header)
      seenHeaders.add(normalized)
    })
  })

  return {
    format: parsedSheets[0].format,
    headers,
    rows: parsedSheets.flatMap((sheet) => sheet.rows),
  }
}

async function resolveOrgId(userId: string, explicitOrgId: string | null): Promise<string | null> {
  if (explicitOrgId) return explicitOrgId
  const { data, error } = await supabase
    .from('usuarios')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo resolver org_id del usuario: ${error.message}`)
  return (data as { org_id?: string | null } | null)?.org_id ?? null
}

function dedupeByKey<T>(rows: T[], buildKey: (row: T) => string | null): T[] {
  const map = new Map<string, T>()
  const noKeyRows: T[] = []

  rows.forEach((row) => {
    const key = buildKey(row)
    if (!key) {
      noKeyRows.push(row)
      return
    }
    map.set(key, row)
  })

  return [...map.values(), ...noKeyRows]
}

function removeNilFields<T extends Record<string, unknown>>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<T>
}

function cleanPayloads<T extends Record<string, unknown>>(rows: T[]): Array<Partial<T>> {
  return rows.map(removeNilFields)
}

function groupPayloadsByKeySet<T extends Record<string, unknown>>(rows: T[]): Array<Array<Partial<T>>> {
  const groups = new Map<string, Array<Partial<T>>>()

  cleanPayloads(rows).forEach((row) => {
    const key = Object.keys(row).sort().join('|')
    const current = groups.get(key) ?? []
    current.push(row)
    groups.set(key, current)
  })

  return [...groups.values()]
}

async function upsertClassicClientes(rows: ClienteClassicPayload[]) {
  const BATCH_SIZE = 50
  let processed = 0
  let errors = 0

  for (const group of groupPayloadsByKeySet(rows)) {
    for (let i = 0; i < group.length; i += BATCH_SIZE) {
      const batch = group.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('clientes')
        .upsert(batch, { onConflict: 'hycite_id' })
        .select('id')

      if (error) {
        console.error(`  ❌ Lote clásico ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
        errors += batch.length
      } else {
        processed += data?.length ?? batch.length
      }
    }
  }

  return { processed, errors }
}

async function upsertSheetClientes(rows: ClienteSheetPayload[]) {
  const withPhoneGroups = groupPayloadsByKeySet(rows.filter((row) => row.telefono))
  const withoutPhoneGroups = groupPayloadsByKeySet(rows.filter((row) => !row.telefono))

  let processed = 0
  let errors = 0

  for (const group of withPhoneGroups) {
    const { data, error } = await supabase
      .from('clientes')
      .upsert(group, { onConflict: 'org_id,telefono' })
      .select('id')

    if (error) {
      console.error(`  ❌ Clientes con teléfono: ${error.message}`)
      errors += group.length
    } else {
      processed += data?.length ?? group.length
    }
  }

  for (const group of withoutPhoneGroups) {
    const { data, error } = await supabase
      .from('clientes')
      .insert(group)
      .select('id')

    if (error) {
      console.error(`  ❌ Clientes sin teléfono: ${error.message}`)
      errors += group.length
    } else {
      processed += data?.length ?? group.length
    }
  }

  return { processed, errors }
}

async function upsertSheetLeads(rows: LeadSheetPayload[]) {
  const withPhoneGroups = groupPayloadsByKeySet(rows.filter((row) => row.telefono))
  const withoutPhoneGroups = groupPayloadsByKeySet(rows.filter((row) => !row.telefono))

  let processed = 0
  let errors = 0

  for (const group of withPhoneGroups) {
    const { data, error } = await supabase
      .from('leads')
      .upsert(group, { onConflict: 'telefono' })
      .select('id')

    if (error) {
      console.error(`  ❌ Leads con teléfono: ${error.message}`)
      errors += group.length
    } else {
      processed += data?.length ?? group.length
    }
  }

  for (const group of withoutPhoneGroups) {
    const { data, error } = await supabase
      .from('leads')
      .insert(group)
      .select('id')

    if (error) {
      console.error(`  ❌ Leads sin teléfono: ${error.message}`)
      errors += group.length
    } else {
      processed += data?.length ?? group.length
    }
  }

  return { processed, errors }
}

async function registrarLog(params: {
  importado_por: string
  tipo_cuenta: string
  total_registros: number
  registros_nuevos: number
  registros_error: number
  archivo_nombre: string
}) {
  const { error } = await supabase.from('importaciones_hycite').insert({
    importado_por: params.importado_por,
    tipo_cuenta: params.tipo_cuenta,
    total_registros: params.total_registros,
    registros_nuevos: params.registros_nuevos,
    registros_actualizados: 0,
    registros_error: params.registros_error,
    archivo_nombre: params.archivo_nombre,
  })

  if (error) {
    console.warn(`⚠️ No se pudo guardar log de importación: ${error.message}`)
  }
}

function parseArgs(): Record<string, string> {
  return Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, '').split('=')
      return [key, rest.join('=')]
    }),
  )
}

export async function main() {
  const args = parseArgs()
  const filePath = args['file']
  const userId = args['user']
  const explicitOrgId = args['org-id'] || null
  const sourceUrl = args['source-url'] || null
  const ownerId = args['owner-id'] || userId || null
  const dryRun = String(args['dry-run'] || '').toLowerCase() === 'true'

  if (!filePath || !userId) {
    console.error(
      '\n❌ Uso:\n' +
      '   npx ts-node tools/import_hycite.ts \\\n' +
      '     --file="/ruta/archivo.xlsx" \\\n' +
      '     --user="uuid-del-usuario" \\\n' +
      '     [--org-id="uuid-org"] \\\n' +
      '     [--source-url="https://docs.google.com/spreadsheets/d/.../edit"] \\\n' +
      '     [--owner-id="uuid-owner-para-leads"] \\\n' +
      '     [--dry-run="true"]\n',
    )
    process.exit(1)
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Archivo no encontrado: ${filePath}`)
    process.exit(1)
  }

  const fileName = path.basename(filePath)
  const orgId = await resolveOrgId(userId, explicitOrgId)
  const { format, rows } = readRows(filePath)

  console.log('\n🚀 FlowSuiteCRM — Importador híbrido Hy-Cite')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`📂 Archivo    : ${fileName}`)
  console.log(`👤 Usuario    : ${userId}`)
  console.log(`🏢 Org ID     : ${orgId ?? '-'}`)
  console.log(`🧭 Formato    : ${format}`)
  console.log(`🧪 Dry run    : ${dryRun ? 'sí' : 'no'}`)
  console.log(`🕐 Iniciado   : ${new Date().toLocaleString()}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (format === 'classic_hycite') {
    if (!orgId) {
      console.error('❌ Para importar CustomerList Hy-Cite se requiere org_id resoluble desde el usuario o por --org-id.')
      process.exit(1)
    }

    const clientes = rows
      .map((row, index) => parseClassicRow(row as ClassicHyciteRow, orgId, index + 2))
      .filter((row): row is ClienteClassicPayload => row !== null)
    const clientesUnicos = dedupeByKey(clientes, (row) => `hycite:${row.hycite_id}`)

    console.log(`📊 Filas leídas       : ${rows.length}`)
    console.log(`✅ Clientes válidos   : ${clientesUnicos.length}`)
    console.log(`🧹 Duplicados internos: ${clientes.length - clientesUnicos.length}`)

    if (clientesUnicos.length === 0) {
      console.error('❌ No hay registros válidos para importar.')
      process.exit(1)
    }

    console.log('\n📋 Preview clásico (primeros 3):')
    clientesUnicos.slice(0, 3).forEach((cliente, index) => {
      console.log(
        `  [${index + 1}] ${cliente.hycite_id} | ${cliente.nombre ?? '-'} ${cliente.apellido ?? ''} | ` +
        `${cliente.estado_cuenta} | Saldo: $${cliente.saldo_actual} | Moroso: $${cliente.monto_moroso}`,
      )
    })

    if (dryRun) {
      console.log('\n🧪 Dry run: no se escribió nada en Supabase.\n')
      return
    }

    const result = await upsertClassicClientes(clientesUnicos)
    await registrarLog({
      importado_por: userId,
      tipo_cuenta: 'customer_list',
      total_registros: rows.length,
      registros_nuevos: result.processed,
      registros_error: result.errors,
      archivo_nombre: fileName,
    })

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📋 RESUMEN CLÁSICO')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`Total en archivo : ${rows.length}`)
    console.log(`Importados       : ${result.processed}`)
    console.log(`Errores          : ${result.errors}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    return
  }

  if (!orgId) {
    console.error('❌ Para importar la hoja Clientes_Oct2022 se requiere org_id resoluble desde el usuario o por --org-id.')
    process.exit(1)
  }

  const runId = `sheet-oct2022-${new Date().toISOString()}`
  const rawClientes: ClienteSheetPayload[] = []
  const rawLeads: LeadSheetPayload[] = []

  rows.forEach((row) => {
    const normalized = buildNormalizedRow(row)
    if (isLeadRow(row, normalized)) {
      rawLeads.push(toSheetLeadPayload(row, normalized, orgId, fileName, sourceUrl, runId, ownerId))
    } else {
      rawClientes.push(toSheetClientePayload(row, normalized, orgId, fileName, sourceUrl))
    }
  })

  const clientes = dedupeByKey(rawClientes, (row) =>
    row.telefono
      ? `cliente-phone:${row.org_id}:${row.telefono}`
      : [row.nombre, row.apellido, row.email, row.direccion].filter(Boolean).join('|').toLowerCase() || null,
  )

  const leads = dedupeByKey(rawLeads, (row) =>
    row.telefono
      ? `lead-phone:${row.telefono}`
      : [row.nombre, row.apellido, row.email, row.direccion].filter(Boolean).join('|').toLowerCase() || null,
  )

  console.log(`📊 Filas leídas        : ${rows.length}`)
  console.log(`👥 Clientes detectados : ${clientes.length}`)
  console.log(`🎯 Leads detectados    : ${leads.length}`)
  console.log(`🧹 Duplicados internos : ${(rawClientes.length - clientes.length) + (rawLeads.length - leads.length)}`)

  if (clientes.length) {
    console.log('\n📋 Preview clientes (primeros 3):')
    clientes.slice(0, 3).forEach((cliente, index) => {
      console.log(
        `  [${index + 1}] ${cliente.nombre ?? '-'} ${cliente.apellido ?? ''} | ` +
        `${cliente.telefono ?? '-'} | ${cliente.estado_cuenta_raw ?? '-'}`,
      )
    })
  }

  if (leads.length) {
    console.log('\n📋 Preview leads (primeros 3):')
    leads.slice(0, 3).forEach((lead, index) => {
      console.log(
        `  [${index + 1}] ${lead.nombre ?? '-'} ${lead.apellido ?? ''} | ` +
        `${lead.telefono ?? '-'} | ${lead.notas_extraidas ?? '-'}`,
      )
    })
  }

  if (dryRun) {
    console.log('\n🧪 Dry run: no se escribió nada en Supabase.\n')
    return
  }

  const clienteResult = await upsertSheetClientes(clientes)
  const leadResult = await upsertSheetLeads(leads)

  await registrarLog({
    importado_por: userId,
    tipo_cuenta: 'clientes_oct2022_sheet',
    total_registros: rows.length,
    registros_nuevos: clienteResult.processed + leadResult.processed,
    registros_error: clienteResult.errors + leadResult.errors,
    archivo_nombre: fileName,
  })

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 RESUMEN HOJA CLIENTES_OCT2022')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Clientes procesados : ${clienteResult.processed}`)
  console.log(`Clientes error      : ${clienteResult.errors}`)
  console.log(`Leads procesados    : ${leadResult.processed}`)
  console.log(`Leads error         : ${leadResult.errors}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\n💥 Error fatal:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
