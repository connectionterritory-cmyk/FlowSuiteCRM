/**
 * report_leads_duplicates.ts
 * FlowSuiteCRM - Reporte de duplicados por telefono
 *
 * Uso:
 *   npx ts-node tools/importers/report_leads_duplicates.ts \
 *     --file="/ruta/Prospectos BA Insurance.xlsx" \
 *     --out="/ruta/reporte_duplicados.csv"
 *
 * Dependencias:
 *   npm install xlsx @supabase/supabase-js dotenv
 *   npm install -D ts-node @types/node typescript
 */

import xlsxPkg from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

type LeadRow = {
  'Nombre'?: string
  'Apellido'?: string
  'Telefono_Celular'?: string
  'Fuente'?: string
  [key: string]: unknown
}

function getArgValue(flag: string): string | null {
  const idx = process.argv.findIndex((arg) => arg === flag)
  if (idx === -1) return null
  return process.argv[idx + 1] ?? null
}

function str(value: unknown): string {
  return String(value ?? '').trim()
}

function limpiarTelefono(raw: string): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 7 ? digits : null
}

async function main() {
  const filePath = getArgValue('--file')
  const outPath = getArgValue('--out') ?? 'tools/importers/ba_insurance_duplicados.csv'

  if (!filePath) {
    console.error('Missing --file argument')
    process.exit(1)
  }

  const { readFile, utils } = xlsxPkg as unknown as {
    readFile: (path: string) => { SheetNames: string[]; Sheets: Record<string, unknown> }
    utils: { sheet_to_json: (sheet: unknown, opts: { defval: string }) => LeadRow[] }
  }

  const workbook = readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = utils.sheet_to_json(sheet, { defval: '' }) as LeadRow[]

  const phoneMap = new Map<string, { count: number; names: string[]; fuente: string }>()
  for (const row of rows) {
    const telefono = limpiarTelefono(str(row['Telefono_Celular']))
    if (!telefono) continue
    const nombre = [str(row['Nombre']), str(row['Apellido'])].filter(Boolean).join(' ').trim()
    const fuente = str(row['Fuente'])
    const current = phoneMap.get(telefono)
    if (current) {
      current.count += 1
      if (nombre) current.names.push(nombre)
    } else {
      phoneMap.set(telefono, { count: 1, names: nombre ? [nombre] : [], fuente })
    }
  }

  const phones = Array.from(phoneMap.keys())
  const dbMap = new Map<string, { id: string; fuente: string | null; created_at: string | null; nombre: string | null; apellido: string | null }>()

  const batchSize = 200
  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize)
    const { data, error } = await supabase
      .from('leads')
      .select('id, telefono, fuente, created_at, nombre, apellido')
      .in('telefono', batch)
    if (error) {
      console.error('Query error:', error.message)
      process.exit(1)
    }
    for (const row of data ?? []) {
      if (row.telefono) {
        dbMap.set(row.telefono, {
          id: row.id,
          fuente: row.fuente,
          created_at: row.created_at,
          nombre: row.nombre,
          apellido: row.apellido,
        })
      }
    }
  }

  const reportRows: string[] = []
  reportRows.push([
    'telefono',
    'count_in_file',
    'nombres_en_file',
    'fuente_en_file',
    'lead_id_db',
    'fuente_db',
    'created_at_db',
    'nombre_db',
    'apellido_db',
  ].join(','))

  let totalReport = 0
  let fileDuplicates = 0
  let dbSourceMismatch = 0

  for (const [telefono, info] of phoneMap.entries()) {
    const db = dbMap.get(telefono)
    const isFileDup = info.count > 1
    const fuenteDb = db?.fuente ?? ''
    const fuenteFile = info.fuente
    const isSourceMismatch = Boolean(fuenteDb) && fuenteDb.toLowerCase() !== 'ba insurance'

    if (isFileDup || isSourceMismatch) {
      totalReport += 1
      if (isFileDup) fileDuplicates += 1
      if (isSourceMismatch) dbSourceMismatch += 1
      reportRows.push([
        telefono,
        String(info.count),
        `"${info.names.join(' | ')}"`,
        `"${fuenteFile}"`,
        db?.id ?? '',
        `"${fuenteDb ?? ''}"`,
        db?.created_at ?? '',
        `"${db?.nombre ?? ''}"`,
        `"${db?.apellido ?? ''}"`,
      ].join(','))
    }
  }

  fs.writeFileSync(outPath, reportRows.join('\n'), 'utf8')

  console.log(`Report saved to: ${outPath}`)
  console.log(`Total rows in report: ${totalReport}`)
  console.log(`Duplicates in file: ${fileDuplicates}`)
  console.log(`Existing leads with different fuente: ${dbSourceMismatch}`)
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
