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
type ReportType = 'customer_list' | 'birthday_report'

const MONTH_MAP: Record<string, string> = {
  'JANUARY': '01', 'FEBRUARY': '02', 'MARCH': '03', 'APRIL': '04',
  'MAY': '05', 'JUNE': '06', 'JULY': '07', 'AUGUST': '08',
  'SEPTEMBER': '09', 'OCTOBER': '10', 'NOVEMBER': '11', 'DECEMBER': '12',
  'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
  'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
  'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
}

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
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // MM/DD/YYYY or M/D/YYYY (US format from Numbers/Excel)
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, m, d, y] = slash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // DD-MM-YYYY
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dash) {
    const [, d, m, y] = dash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

function parsearMonto(raw?: string): number {
  if (!raw) return 0
  // Eliminar todo excepto números y punto decimal
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
  // Primero intentamos el campo directo de "Delinquent" (portal search)
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
  // Primero revisamos si vienen los campos de morosidad individuales
  if (parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD']) > 0) return 91
  if (parsearMonto(row['61-90 DÍAS DE MOROSIDAD']) > 0) return 61
  if (parsearMonto(row['31-60 DÍAS DE MOROSIDAD']) > 0) return 31
  if (parsearMonto(row['0-30 DÍAS DE MOROSIDAD']) > 0) return 1

  // Si no, intentamos parsear el campo "Estado" para el portal de búsqueda
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
    'STATUS MOROSIDAD',
    'ESTADO MOROSIDAD',
    'ESTADO DE MOROSIDAD',
    'ESTADO ATRASO',
    'MOROSIDAD',
    'STATUS',
    'ESTADO',
  ]).trim()
  const u = estadoRaw.toUpperCase()
  const hasMorosidadKeyword =
    u.includes('DIAS') ||
    u.includes('ATRASO') ||
    u.includes('DELINQUENT') ||
    u.includes('MORO') ||
    u.includes('PURG') ||
    u.includes('0-30') ||
    u.includes('31-60') ||
    u.includes('61-90') ||
    u.includes('90+') ||
    u.includes('SOBRE 90')
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
  if (u.includes('+90') || u.includes('90+') || u.includes('MAS DE 90') || u.includes('SOBRE 90')) {
    return '91+'
  }

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
    '# DE CLIENTE',
    'Numero de cuenta hycite',
    'Numero de cuenta',
    'Cuenta',
    'Hycite ID',
    'HYCITE_ID',
    'HYCITEID',
    'Cuenta Hycite',
    'Cuenta Financiera',
    'CUSTOMER NO',
    'Customer #',
    'CUSTOMER#',
    'N.º DE CLIENTE',
    'N° DE CLIENTE',
    'Nº DE CLIENTE',
    'N. DE CLIENTE',
    'NO. DE CLIENTE',
    'NUMERO DE CLIENTE',
    'N.º DE CLIEN',
    'Nº DE CLIEN',
    'N° DE CLIEN',
    'N.º DE CLIE',
    'N.º DE CLI',
    'CLIENTE #',
    'CLIENTE'
  ]).trim()
  if (!hyciteId) return null
  const nivel = parseInt(obtenerCampo(row, normalizedRow, ['NIVEL', 'Nivel']).trim() || '1')

  // Nombres
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

  // Fecha de Nacimiento (Cumpleaños)
  let fechaNacimiento: string | null = null
  const bdayRaw = obtenerCampo(row, normalizedRow, ['BIRTH DAY', 'CUMPLEAÑOS', 'FECHA NACIMIENTO']).trim()
  if (bdayRaw) {
    const parts = bdayRaw.split(/\s+/)
    if (parts.length === 2) {
      const mes = MONTH_MAP[parts[0].toUpperCase()]
      const dia = parts[1].padStart(2, '0')
      if (mes && dia) {
        fechaNacimiento = `2000-${mes}-${dia}`
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(bdayRaw)) {
      fechaNacimiento = bdayRaw
    }
  }

  const montoMoroso = parsearMonto(obtenerCampo(row, normalizedRow, ['MONTO MOROSO', 'MOROSO'])) ||
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
      return true // default when column absent
    })(),
    fecha_ultimo_pedido: parsearFecha(obtenerCampo(row, normalizedRow, ['ÚLTIMA FECHA DE COMPRA', 'FECHA DEL ÚLTIMO PEDIDO', 'FECHA DEL ULTIMO PEDIDO', 'FECHA DEL', 'FECHA DEL ÚLTI'])),
    ultima_fecha_pago: parsearFecha(
      obtenerCampo(row, normalizedRow, ['ULTIMA FECHA DE PAGO', 'ÚLTIMA FECHA DE PAGO', 'ultima fecha de pago', 'ULTIMA FECHA PAGO']),
    ),
    origen: 'hycite_import',
    codigo_vendedor_hycite: obtenerCampo(row, normalizedRow, ['VENDEDOR', 'Entrepreneur', 'ENTREPRENEUR', 'EMPRENDEDORES', 'Vendedor']).trim() || null,
    codigo_dist_hycite: obtenerCampo(row, normalizedRow, ['DISTRIBUIDOR']).trim() || null,
    updated_at: new Date().toISOString(),
    fecha_nacimiento: fechaNacimiento
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
  const [reportType, setReportType] = useState<ReportType>('customer_list')
  const [fileName, setFileName] = useState('')
  const [clientes, setClientes] = useState<ClienteImport[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importados, setImportados] = useState(0)
  const [actualizados, setActualizados] = useState(0)
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

        // Detección automática de tipo de reporte
        const initialRaw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, range: 0, defval: '', raw: false }).slice(0, 10)
        const isBirthdayReport = initialRaw.some(row => row.some(cell => String(cell).toUpperCase().includes('CUSTOMER BIRTHDAYS')))

        const effectiveReportType = isBirthdayReport ? 'birthday_report' : 'customer_list'
        setReportType(effectiveReportType)

        // Búsqueda robusta de la fila de encabezados
        const allRows = XLSX.utils.sheet_to_json<any[][]>(ws, { header: 1, defval: '', raw: false })
        let headerIndex = -1

        // Palabras clave que identifican la fila de encabezados
        const keywords = [
          'HYCITE',
          'HYCITE ID',
          'CLIENTE',
          'N DE CLIENTE',
          'CUSTOMER',
          'NOMBRE',
          'NAME',
          'APELLIDO',
          'LAST NAME',
          'CORREO ELECTRONICO',
          'ELECTRONICO',
          'EMAIL',
          'TELEFONO',
        ]

        for (let i = 0; i < Math.min(allRows.length, 25); i++) {
          const row = allRows[i]
          if (!row || row.length < 2) continue
          const rowStr = row.map(cell => normalizarHeader(String(cell ?? ''))).join('|')
          if (keywords.some(k => rowStr.includes(k))) {
            headerIndex = i
            break
          }
        }

        // Fallback para reporte de cumpleaños si la búsqueda por palabras clave falla
        if (headerIndex === -1 && isBirthdayReport) {
          headerIndex = 7
        }

        const raw: any[][] = headerIndex === -1 ? allRows : allRows.slice(headerIndex)

        if (raw.length < 2) { setParseError('No se pudo detectar el formato de los datos.'); return }

        const seen = new Map<string, number>()
        const headers = (raw[0] as any[]).map(h => {
          const s = String(h || '').trim()
          const c = seen.get(s) ?? 0; seen.set(s, c + 1)
          return c === 0 ? s : `${s}_${c}`
        })
        const rows: Record<string, string>[] = raw.slice(1).map(row =>
          Object.fromEntries(headers.map((h, i) => [h, String((row as any[])[i] ?? '').trim()]))
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
    let imp = 0, up = 0, err = 0

    // Smart Update / Upsert logic
    for (let i = 0; i < clientes.length; i += 50) {
      const lote = clientes.slice(i, i + 50)
      const idsLote = lote.map(c => c.hycite_id)
      const cuentasLote = lote.map(c => c.hycite_id)
      const telsLote = lote
        .map(c => normalizarTelefono(c.telefono))
        .filter(Boolean) as string[]

      // Obtener datos existentes para Smart Update (por ID o por Teléfono)
      const { data: existentes } = await supabase
        .from('clientes')
        .select('id, hycite_id, numero_cuenta_financiera, fecha_nacimiento, nombre, apellido, telefono, vendedor_id')
        .or(`hycite_id.in.(${idsLote.join(',')}),numero_cuenta_financiera.in.(${cuentasLote.join(',')}),telefono.in.(${telsLote.join(',')})`)

      // Mapas para búsqueda rápida
      const mapId = new Map(existentes?.filter(e => e.hycite_id).map(e => [e.hycite_id, e]) || [])
      const mapCuenta = new Map(
        existentes?.filter(e => e.numero_cuenta_financiera).map(e => [e.numero_cuenta_financiera, e]) || [],
      )
      const mapTel = new Map(
        existentes?.filter(e => e.telefono).map(e => [normalizarTelefono(e.telefono), e]) || [],
      )

      const buildPayload = (c: ClienteImport) => {
        const telMatch = c.telefono ? mapTel.get(normalizarTelefono(c.telefono)) : null
        const exById = mapId.get(c.hycite_id) || mapCuenta.get(c.hycite_id) || null
        const exByTel = telMatch && !telMatch.hycite_id ? telMatch : null
        const ex = exById || exByTel

        if (ex) {
          return {
            ...c, // Nuevos datos de Hycite (incluye saldo, moroso, atraso)
            id: ex.id, // ID real de Supabase
            // Smart Update: Mantener lo de CRM si ya existe, enriquecer con lo nuevo si falta
            fecha_nacimiento: ex.fecha_nacimiento || c.fecha_nacimiento,
            nombre: ex.nombre || c.nombre,
            apellido: ex.apellido || c.apellido,
            telefono: ex.telefono || c.telefono,
            vendedor_id: ex.vendedor_id || session.user.id,
            numero_cuenta_financiera: ex.numero_cuenta_financiera || c.hycite_id,
          }
        }
        return { ...c, vendedor_id: session.user.id, numero_cuenta_financiera: c.hycite_id }
      }

      const payload = lote.map(buildPayload)

      // onConflict:'hycite_id' ensures re-imports update instead of duplicating.
      // For records where we already resolved the Supabase id (ex.id), the PK
      // takes precedence; for new records, the hycite_id unique constraint resolves.
      const { error } = await supabase
        .from('clientes')
        .upsert(payload, { onConflict: 'hycite_id' })
        .select('id, created_at, updated_at')

      if (error) {
        console.error('Batch Upsert Error:', error)
        // Retry one-by-one to avoid losing the whole batch on a single bad row
        for (const item of payload) {
          const { data: singleData, error: singleError } = await supabase
            .from('clientes')
            .upsert([item], { onConflict: 'hycite_id' })
            .select('id, created_at, updated_at')
          if (singleError) {
            console.error('Single Upsert Error:', singleError)
            err += 1
          } else {
            const isNew = singleData?.[0]?.created_at === singleData?.[0]?.updated_at
            if (isNew) imp += 1
            else up += 1
          }
        }
      } else {
        // Conteo del lote exitoso
        lote.forEach(c => {
          const matched =
            mapId.has(c.hycite_id) ||
            mapCuenta.has(c.hycite_id) ||
            (c.telefono && mapTel.has(normalizarTelefono(c.telefono)))
          if (matched) up += 1
          else imp += 1
        })
      }
    }

    await supabase.from('importaciones_hycite').insert({
      importado_por: session.user.id,
      tipo_cuenta: reportType === 'birthday_report' ? 'birthday_list' : 'customer_list',
      total_registros: clientes.length,
      registros_nuevos: imp,
      registros_actualizados: up,
      registros_error: err,
      archivo_nombre: fileName,
    })

    setImportados(imp); setActualizados(up); setErrores(err); setStep('done')
    if (err === 0) showToast(`✅ ${imp} nuevos, ${up} actualizados`)
    else showToast(`⚠️ ${imp} nuevos, ${up} actualizados, ${err} errores`, 'error')
    cargarHistorial() // Refetch history
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
          <SectionHeader
            title="Importaciones Hy-Cite"
            subtitle={reportType === 'birthday_report' ? "Importando Reporte de Cumpleaños" : "Importa tu cartera de clientes desde el archivo CustomerList de Hy-Cite"}
          />
          <div className="card" style={{ padding: '1.5rem' }}>
            {step === 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                  Soporta <strong>Customer List</strong> y <strong>Customer Birthdays</strong>. El sistema detectará el formato automáticamente.
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
                  {[{ label: 'Total', value: clientes.length, color: '#3b82f6' }, { label: 'Importados', value: importados, color: '#10b981' }, { label: 'Actualizados', value: actualizados, color: '#3b82f6' }, { label: 'Errores', value: errores, color: errores > 0 ? '#dc2626' : '#6b7280' }].map(s => (
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
