/**
 * import_hycite.ts  (v2 — basado en formato REAL de Hy-Cite)
 * FlowSuiteCRM — Importador CustomerList XLS
 * -------------------------------------------------------
 * Columnas REALES del archivo CustomerList-CAIM0001-YYYYMMDD.xls:
 *
 *  # DE CLIENTE | CLIENTE | NOMBRE (completo) | DIRECCIÓN | CIUDAD |
 *  ESTADO | CÓDIGO POSTAL | STATUS | NOMBRE (first) | SEGUNDO NOMBRE |
 *  APELLIDO PATERNO | APELLIDO MATERNO | CORREO ELECTRÓNICO |
 *  TELÉFONO DE CASA | TELÉFONO DEL TRABAJO | TELÉFONO MÓVIL |
 *  DISTRIBUIDOR | VENDEDOR | NIVEL | LÍMITE DE CRÉDITO |
 *  FECHA AUMENTADA | AUMENTADO EN | CRÉDITO DISPONIBLE | MENSUALIDAD |
 *  FECHA DE CIERRE | SALDO ACTUAL | CANTIDAD ACTUAL |
 *  0-30 DÍAS DE MOROSIDAD | 31-60 DÍAS DE MOROSIDAD |
 *  61-90 DÍAS DE MOROSIDAD | SOBRE 90 DÍAS DE MOROSIDAD |
 *  FECHA DE ORDEN ORIGINAL | ÚLTIMA FECHA DE COMPRA |
 *  ÚLTIMA FECHA DE PAGO | PEDIDOS
 *
 * STATUS values: CURRENT | PURGED | DEL0TO30 | DEL31TO60 | DEL61TO90 | DELOV90
 *
 * Uso:
 *   npx ts-node tools/import_hycite.ts \
 *     --file="tools/CustomerList-CAIM0001-20260222.xls" \
 *     --user="uuid-del-admin-en-supabase"
 *
 * Instalar dependencias:
 *   npm install xlsx @supabase/supabase-js dotenv
 *   npm install -D ts-node @types/node typescript
 *
 * .env:
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY=eyJ...   ← SERVICE KEY, nunca anon key
 */

import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config()

// ─── SUPABASE ─────────────────────────────────────────────
const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌  Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY en .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ─── TIPOS ────────────────────────────────────────────────

type EstadoCuenta = 'actual' | 'cancelacion_total' | 'cargo_de_vuelta' | 'inactivo'

// Fila tal como viene del XLS (ya mapeada con headers únicos)
interface HyciteRow {
  '# DE CLIENTE'?:               string
  'CLIENTE'?:                    string   // HC, etc.
  'NOMBRE'?:                     string   // nombre completo (col 2)
  'DIRECCIÓN'?:                  string
  'CIUDAD'?:                     string
  'ESTADO'?:                     string   // CA, FL, TX…
  'CÓDIGO POSTAL'?:              string
  'STATUS'?:                     string   // CURRENT | PURGED | DEL0TO30 …
  'NOMBRE_1'?:                   string   // primer nombre (col 8, renombrada)
  'SEGUNDO NOMBRE'?:             string
  'APELLIDO PATERNO'?:           string
  'APELLIDO MATERNO'?:           string
  'CORREO ELECTRÓNICO'?:         string
  'TELÉFONO DE CASA'?:           string
  'TELÉFONO DEL TRABAJO'?:       string
  'TELÉFONO MÓVIL'?:             string
  'DISTRIBUIDOR'?:               string
  'VENDEDOR'?:                   string
  'NIVEL'?:                      string
  'LÍMITE DE CRÉDITO'?:          string
  'CRÉDITO DISPONIBLE'?:         string
  'MENSUALIDAD'?:                string
  'FECHA DE CIERRE'?:            string
  'SALDO ACTUAL'?:               string
  'CANTIDAD ACTUAL'?:            string
  '0-30 DÍAS DE MOROSIDAD'?:     string
  '31-60 DÍAS DE MOROSIDAD'?:    string
  '61-90 DÍAS DE MOROSIDAD'?:    string
  'SOBRE 90 DÍAS DE MOROSIDAD'?: string
  'ÚLTIMA FECHA DE COMPRA'?:     string
  'ÚLTIMA FECHA DE PAGO'?:       string
  'PEDIDOS'?:                    string
  [key: string]: unknown
}

// Lo que se hace upsert en Supabase
interface ClienteUpsert {
  hycite_id:              string
  tipo_cliente:           string
  nombre:                 string | null
  apellido:               string | null
  email:                  string | null
  telefono:               string | null
  telefono_casa:          string | null
  direccion:              string | null
  saldo_actual:           number
  monto_moroso:           number
  dias_atraso:            number
  nivel:                  number
  estado_cuenta:          EstadoCuenta
  elegible_addon:         boolean
  fecha_ultimo_pedido:    string | null
  origen:                 'hycite_import'
  codigo_vendedor_hycite: string | null
  codigo_dist_hycite:     string | null
  updated_at:             string
}

// ─── HELPERS ──────────────────────────────────────────────

function str(v: unknown): string {
  return String(v ?? '').trim()
}

function limpiarTelefono(raw: string | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 7 ? digits : null
}

function limpiarEmail(raw: string | undefined): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  return e.includes('@') ? e : null
}

function parsearFecha(raw: string | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  // Hy-Cite exporta YYYY-MM-DD directamente
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // Por si acaso MM/DD/YYYY
  const p = s.split('/')
  if (p.length === 3) {
    const year = p[2].length === 2 ? `20${p[2]}` : p[2]
    return `${year}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`
  }
  return null
}

function parsearMonto(raw: string | undefined): number {
  if (!raw) return 0
  const n = parseFloat(raw.replace(/[$,\s]/g, ''))
  return isNaN(n) ? 0 : Math.abs(n)
}

function parsearNivel(raw: string | undefined): number {
  const n = parseInt(raw ?? '1')
  if (isNaN(n) || n < 1) return 1
  return Math.min(n, 9)
}

/**
 * STATUS de Hy-Cite → EstadoCuenta
 * CURRENT   → actual
 * DEL0TO30  → actual  (moroso pero no cancelado)
 * DEL31TO60 → actual
 * DEL61TO90 → actual
 * DELOV90   → actual
 * PURGED    → cancelacion_total
 */
function mapearEstado(status: string | undefined): EstadoCuenta {
  const s = str(status).toUpperCase()
  if (s === 'PURGED')   return 'cancelacion_total'
  if (s === 'INACTIVE') return 'inactivo'
  return 'actual'
}

/**
 * Monto moroso total = suma de los 4 buckets de morosidad
 */
function calcularMoroso(row: HyciteRow): number {
  return (
    parsearMonto(row['0-30 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['31-60 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['61-90 DÍAS DE MOROSIDAD']) +
    parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD'])
  )
}

/**
 * Días de atraso: el bucket más alto con valor > 0
 */
function calcularDiasAtraso(row: HyciteRow): number {
  if (parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD']) > 0) return 91
  if (parsearMonto(row['61-90 DÍAS DE MOROSIDAD'])    > 0) return 61
  if (parsearMonto(row['31-60 DÍAS DE MOROSIDAD'])    > 0) return 31
  if (parsearMonto(row['0-30 DÍAS DE MOROSIDAD'])     > 0) return 1
  return 0
}

// ─── PARSEAR FILA ─────────────────────────────────────────

function parsearFila(row: HyciteRow, lineNum: number): ClienteUpsert | null {
  const hyciteId = str(row['# DE CLIENTE'])
  if (!hyciteId) {
    console.warn(`  ⚠️  Línea ${lineNum}: sin # DE CLIENTE, omitida`)
    return null
  }

  // Nombre: col 8 (NOMBRE_1 por duplicado de headers) = primer nombre
  // Apellido: APELLIDO PATERNO + APELLIDO MATERNO
  let nombre   = str(row['NOMBRE_1']) || null
  const ap1    = str(row['APELLIDO PATERNO'])
  const ap2    = str(row['APELLIDO MATERNO'])
  let apellido = [ap1, ap2].filter(Boolean).join(' ') || null

  // Fallback: dividir NOMBRE completo
  if (!nombre && str(row['NOMBRE'])) {
    const parts = str(row['NOMBRE']).split(' ')
    nombre   = parts[0] || null
    apellido = apellido || parts.slice(1).join(' ') || null
  }

  return {
    hycite_id:              hyciteId,
    tipo_cliente:           str(row['CLIENTE']) || 'HC',
    nombre,
    apellido,
    email:                  limpiarEmail(row['CORREO ELECTRÓNICO']),
    telefono:               limpiarTelefono(row['TELÉFONO MÓVIL']),
    telefono_casa:          limpiarTelefono(row['TELÉFONO DE CASA']),
    direccion:              str(row['DIRECCIÓN']).replace(/\n/g, ', ') || null,
    saldo_actual:           parsearMonto(row['SALDO ACTUAL']),
    monto_moroso:           calcularMoroso(row),
    dias_atraso:            calcularDiasAtraso(row),
    nivel:                  parsearNivel(row['NIVEL']),
    estado_cuenta:          mapearEstado(row['STATUS']),
    elegible_addon:         true,
    fecha_ultimo_pedido:    parsearFecha(row['ÚLTIMA FECHA DE COMPRA']),
    origen:                 'hycite_import',
    codigo_vendedor_hycite: str(row['VENDEDOR']) || null,
    codigo_dist_hycite:     str(row['DISTRIBUIDOR']) || null,
    updated_at:             new Date().toISOString(),
  }
}

// ─── UPSERT EN LOTES ──────────────────────────────────────

const LOTE_SIZE = 50

async function importarLote(
  clientes: ClienteUpsert[],
  loteNum: number
): Promise<{ procesados: number; errores: number }> {
  const { data, error } = await supabase
    .from('clientes')
    .upsert(clientes, { onConflict: 'hycite_id' })
    .select('id')

  if (error) {
    console.error(`  ❌ Lote ${loteNum}: ${error.message}`)
    return { procesados: 0, errores: clientes.length }
  }

  console.log(`  ✅ Lote ${loteNum}: ${data?.length ?? 0} registros`)
  return { procesados: data?.length ?? 0, errores: 0 }
}

// ─── LOG DE IMPORTACIÓN ───────────────────────────────────

async function registrarLog(p: {
  importado_por: string; tipo_cuenta: string
  total_registros: number; registros_nuevos: number
  registros_error: number; archivo_nombre: string
}) {
  const { error } = await supabase.from('importaciones_hycite').insert({
    importado_por:          p.importado_por,
    tipo_cuenta:            p.tipo_cuenta,
    total_registros:        p.total_registros,
    registros_nuevos:       p.registros_nuevos,
    registros_actualizados: 0,
    registros_error:        p.registros_error,
    archivo_nombre:         p.archivo_nombre,
  })
  if (error) console.warn('⚠️  Log no guardado:', error.message)
}

// ─── MAIN ─────────────────────────────────────────────────

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
      const [k, ...v] = a.replace(/^--/, '').split('=')
      return [k, v.join('=')]
    })
  )

  const filePath = args['file']
  const userId   = args['user']

  if (!filePath || !userId) {
    console.error(
      '\n❌ Uso:\n' +
      '   npx ts-node tools/import_hycite.ts \\\n' +
      '     --file="tools/CustomerList-CAIM0001-20260222.xls" \\\n' +
      '     --user="uuid-del-admin"\n'
    )
    process.exit(1)
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Archivo no encontrado: ${filePath}`)
    process.exit(1)
  }

  const fileName = path.basename(filePath)
  console.log('\n🚀 FlowSuiteCRM — Importador Hy-Cite CustomerList')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`📂 Archivo   : ${fileName}`)
  console.log(`👤 Usuario   : ${userId}`)
  console.log(`🕐 Iniciado  : ${new Date().toLocaleString()}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Leer archivo (xlsx soporta .xls BIFF8 nativamente)
  const wb    = XLSX.readFile(filePath, { raw: false, cellDates: false })
  const ws    = wb.Sheets[wb.SheetNames[0]]
  const raw   = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false })

  if (raw.length < 2) {
    console.error('❌ El archivo no tiene datos.')
    process.exit(1)
  }

  // Hacer únicos los headers duplicados (ej: NOMBRE aparece 2 veces)
  const seen   = new Map<string, number>()
  const headers = (raw[0] as string[]).map(h => {
    const count = seen.get(h) ?? 0
    seen.set(h, count + 1)
    return count === 0 ? h : `${h}_${count}`
  })

  // Convertir filas a objetos
  const dataRows: HyciteRow[] = raw.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, String((row as string[])[i] ?? '').trim()]))
  ) as HyciteRow[]

  console.log(`📊 Filas en Excel       : ${dataRows.length}`)

  // Parsear
  const validos:   ClienteUpsert[] = []
  let omitidas = 0

  dataRows.forEach((row, idx) => {
    const c = parsearFila(row, idx + 2)
    if (c) validos.push(c)
    else omitidas++
  })

  console.log(`✅ Registros válidos    : ${validos.length}`)
  console.log(`⚠️  Filas omitidas      : ${omitidas}`)

  if (validos.length === 0) {
    console.error('\n❌ No hay registros válidos.')
    process.exit(1)
  }

  // Preview
  console.log('\n📋 Preview (primeros 3):')
  validos.slice(0, 3).forEach((c, i) => {
    console.log(
      `  [${i+1}] ${c.hycite_id} | ${c.nombre} ${c.apellido} | ` +
      `${c.estado_cuenta} | Saldo: $${c.saldo_actual} | ` +
      `Moroso: $${c.monto_moroso} | Atraso: ${c.dias_atraso}d`
    )
  })

  console.log(`\n📤 Importando en lotes de ${LOTE_SIZE}...\n`)

  let totalProcesados = 0
  let totalErrores    = 0

  for (let i = 0; i < validos.length; i += LOTE_SIZE) {
    const res = await importarLote(validos.slice(i, i + LOTE_SIZE), Math.floor(i/LOTE_SIZE)+1)
    totalProcesados += res.procesados
    totalErrores    += res.errores
  }

  await registrarLog({
    importado_por:    userId,
    tipo_cuenta:      'customer_list',
    total_registros:  dataRows.length,
    registros_nuevos: totalProcesados,
    registros_error:  totalErrores + omitidas,
    archivo_nombre:   fileName,
  })

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 RESUMEN')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Total en Excel    : ${dataRows.length}`)
  console.log(`Importados        : ${totalProcesados}`)
  console.log(`Omitidos          : ${omitidas}`)
  console.log(`Errores Supabase  : ${totalErrores}`)
  console.log(`Finalizado        : ${new Date().toLocaleString()}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(totalErrores === 0 ? '\n✅ Importación exitosa\n' : '\n⚠️  Completado con errores\n')
}

main().catch(err => {
  console.error('\n💥 Error fatal:', err.message ?? err)
  process.exit(1)
})
