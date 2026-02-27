/**
 * import_cumpleanos.ts
 * FlowSuiteCRM - Importador de cumpleanos (mes/dia) a fecha_nacimiento
 *
 * Uso:
 *   npx ts-node tools/importers/import_cumpleanos.ts \
 *     --file="/ruta/al/Cumpleanos-Table 1.csv" \
 *     --preview=true
 *
 * Requiere .env con:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

type ClienteRow = {
  id: string
  nombre: string | null
  apellido: string | null
}

type UpdateRow = {
  id: string
  fecha_nacimiento: string
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=')
      return [k, v.join('=')]
    })
  )

  return {
    file: args['file'] as string | undefined,
    preview: (args['preview'] ?? 'true') === 'true',
    report: (args['report'] as string | undefined) ?? '',
  }
}

function normalizeText(input: string) {
  return input
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeHeader(input: string) {
  return normalizeText(input).replace(/[^a-z0-9]+/g, '')
}

function findHeaderIndex(headers: string[], keys: string[]) {
  for (const key of keys) {
    const idx = headers.indexOf(key)
    if (idx !== -1) return idx
  }
  return -1
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  const test = new Date(Date.UTC(year, month - 1, day))
  if (test.getUTCFullYear() !== year) return null
  if (test.getUTCMonth() !== month - 1) return null
  if (test.getUTCDate() !== day) return null
  return `${year}-${pad2(month)}-${pad2(day)}`
}

async function loadClientes(): Promise<ClienteRow[]> {
  const { data, error } = await supabase
    .from('clientes')
    .select('id,nombre,apellido')

  if (error) {
    console.error('Failed to load clientes:', error.message)
    process.exit(1)
  }

  return (data ?? []) as ClienteRow[]
}

function buildNameIndex(clientes: ClienteRow[]) {
  const index = new Map<string, string[]>()

  clientes.forEach((c) => {
    const nombre = c.nombre?.trim() ?? ''
    const apellido = c.apellido?.trim() ?? ''

    const candidates = new Set<string>()
    if (nombre) candidates.add(normalizeText(nombre))
    if (nombre && apellido) {
      candidates.add(normalizeText(`${nombre} ${apellido}`))
    }

    candidates.forEach((key) => {
      if (!key) return
      const list = index.get(key) ?? []
      list.push(c.id)
      index.set(key, list)
    })
  })

  return index
}

async function readSpreadsheet(filePath: string) {
  const xlsxModule = await import('xlsx')
  const XLSX = (xlsxModule as unknown as { default?: typeof xlsxModule }).default ?? xlsxModule
  const wb = XLSX.readFile(filePath, { raw: false, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (raw.length < 2) {
    console.error('Spreadsheet has no data rows')
    process.exit(1)
  }

  const headerRow = raw[0] as string[]
  const headers = headerRow.map((h) => normalizeHeader(String(h)))

  const idxMes = findHeaderIndex(headers, ['mes'])
  const idxDia = findHeaderIndex(headers, ['dia', 'daa', 'da'])
  const idxTipo = findHeaderIndex(headers, ['tipo'])
  const idxNombre = findHeaderIndex(headers, ['nombre'])

  if (idxMes === -1 || idxDia === -1 || idxNombre === -1) {
    console.error('Required headers not found. Need Mes, Dia, Nombre')
    console.error('Headers found:', headers.join(', '))
    process.exit(1)
  }

  const rows = raw.slice(1).map((row) => row as string[])

  return { rows, idxMes, idxDia, idxTipo, idxNombre }
}

function buildReportCsv(rows: Array<Record<string, string>>) {
  const headers = ['status', 'nombre', 'id', 'fecha_nacimiento', 'ids']
  const lines = [headers.join(',')]

  rows.forEach((row) => {
    const values = headers.map((h) => {
      const raw = row[h] ?? ''
      const escaped = raw.replace(/"/g, '""')
      return `"${escaped}"`
    })
    lines.push(values.join(','))
  })

  return `${lines.join('\n')}\n`
}

async function previewOrUpdate(filePath: string, preview: boolean, reportPath: string) {
  console.log('Loading clientes...')
  const clientes = await loadClientes()
  const index = buildNameIndex(clientes)

  console.log('Reading spreadsheet...')
  const { rows, idxMes, idxDia, idxTipo, idxNombre } = await readSpreadsheet(filePath)

  const updates: UpdateRow[] = []
  const noEncontrados: string[] = []
  const duplicados: { nombre: string; ids: string[] }[] = []
  const invalidos: { nombre: string; mes: string; dia: string }[] = []
  let procesadas = 0

  rows.forEach((row, i) => {
    const mesRaw = String(row[idxMes] ?? '').trim()
    const diaRaw = String(row[idxDia] ?? '').trim()
    const nombreRaw = String(row[idxNombre] ?? '').trim()

    if (!nombreRaw || !mesRaw || !diaRaw) return

    procesadas += 1

    const mes = parseInt(mesRaw, 10)
    const dia = parseInt(diaRaw, 10)
    const fecha = buildDate(2000, mes, dia)

    if (!fecha) {
      invalidos.push({ nombre: nombreRaw, mes: mesRaw, dia: diaRaw })
      return
    }

    const key = normalizeText(nombreRaw)
    const ids = index.get(key) ?? []

    if (ids.length === 0) {
      noEncontrados.push(nombreRaw)
      return
    }

    if (ids.length > 1) {
      duplicados.push({ nombre: nombreRaw, ids })
      return
    }

    updates.push({ id: ids[0], fecha_nacimiento: fecha })
  })

  console.log('Preview summary')
  console.log('Rows in file:', rows.length)
  console.log('Rows processed:', procesadas)
  console.log('Updates:', updates.length)
  console.log('Not found:', noEncontrados.length)
  console.log('Duplicates:', duplicados.length)
  console.log('Invalid dates:', invalidos.length)

  if (procesadas === 0 && rows.length > 0) {
    const sample = rows[0] ?? []
    console.log('\nSample raw row:', sample)
  }

  console.log('\nSample updates:')
  updates.slice(0, 5).forEach((u) => {
    console.log(`- ${u.id} => ${u.fecha_nacimiento}`)
  })

  if (noEncontrados.length > 0) {
    console.log('\nNot found (first 20):')
    noEncontrados.slice(0, 20).forEach((n) => console.log(`- ${n}`))
  }

  if (duplicados.length > 0) {
    console.log('\nDuplicates (first 10):')
    duplicados.slice(0, 10).forEach((d) => console.log(`- ${d.nombre} => ${d.ids.join(', ')}`))
  }

  if (invalidos.length > 0) {
    console.log('\nInvalid dates (first 10):')
    invalidos.slice(0, 10).forEach((d) => console.log(`- ${d.nombre}: ${d.mes}/${d.dia}`))
  }

  if (reportPath) {
    const reportRows: Array<Record<string, string>> = []

    updates.forEach((u) => {
      reportRows.push({
        status: 'actualizable',
        nombre: '',
        id: u.id,
        fecha_nacimiento: u.fecha_nacimiento,
        ids: '',
      })
    })

    noEncontrados.forEach((n) => {
      reportRows.push({
        status: 'no_encontrado',
        nombre: n,
        id: '',
        fecha_nacimiento: '',
        ids: '',
      })
    })

    duplicados.forEach((d) => {
      reportRows.push({
        status: 'duplicado',
        nombre: d.nombre,
        id: '',
        fecha_nacimiento: '',
        ids: d.ids.join('|'),
      })
    })

    const csv = buildReportCsv(reportRows)
    fs.writeFileSync(reportPath, csv, 'utf8')
    console.log(`\nReport saved: ${reportPath}`)
  }

  if (preview) return

  const batchSize = 100
  let updated = 0
  let errors = 0

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize)
    const { data, error } = await supabase
      .from('clientes')
      .upsert(batch, { onConflict: 'id' })
      .select('id')

    if (error) {
      console.error(`Batch ${i / batchSize + 1} failed:`, error.message)
      errors += batch.length
      continue
    }

    updated += data?.length ?? 0
    console.log(`Batch ${i / batchSize + 1}: ${data?.length ?? 0} updated`)
  }

  console.log('Update complete')
  console.log('Updated:', updated)
  console.log('Errors:', errors)
}

async function main() {
  const args = parseArgs()
  if (!args.file) {
    console.error('Usage: --file="/ruta/al/Cumpleanos-Table 1.csv" --preview=true')
    process.exit(1)
  }

  await previewOrUpdate(args.file, args.preview, args.report)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
