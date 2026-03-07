/**
 * import_leads_ba_insurance.ts
 * FlowSuiteCRM - Importador de leads (BA Insurance)
 *
 * Uso:
 *   npx ts-node tools/importers/import_leads_ba_insurance.ts \
 *     --file="/ruta/BA_Insurance_leads.xlsx" \
 *     --default-owner="uuid-opcional"
 *
 * Dependencias:
 *   npm install xlsx @supabase/supabase-js dotenv
 *   npm install -D ts-node @types/node typescript
 *
 * .env:
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY=eyJ...   (service key)
 */

import xlsxPkg from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

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
  'REFERENCIA EXTERNA'?: string
  'Nombre'?: string
  'Apellido'?: string
  'Codigo_Postal'?: string
  'Fecha_Nacimiento'?: string
  'Telefono_Celular'?: string
  'Email'?: string
  'Fuente'?: string
  'owner_id'?: string
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

function limpiarEmail(raw: string): string | null {
  if (!raw) return null
  const email = raw.trim().toLowerCase()
  return email.includes('@') ? email : null
}

function parseFecha(raw: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const parts = s.split('/')
  if (parts.length === 3) {
    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2]
    return `${year}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
  }
  return null
}

async function main() {
  const filePath = getArgValue('--file')
  const defaultOwner = getArgValue('--default-owner')

  if (!filePath) {
    console.error('Missing --file argument')
    process.exit(1)
  }

  const { readFile, utils } = xlsxPkg as unknown as { readFile: (path: string) => unknown; utils: { sheet_to_json: (sheet: unknown, opts: { defval: string }) => LeadRow[] } }
  const workbook = readFile(filePath) as { SheetNames: string[]; Sheets: Record<string, unknown> }
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = utils.sheet_to_json(sheet, { defval: '' }) as LeadRow[]

  const payloads = rows
    .map((row) => {
      const nombre = str(row['Nombre']) || null
      const apellido = str(row['Apellido']) || null
      const telefono = limpiarTelefono(str(row['Telefono_Celular']))
      const email = limpiarEmail(str(row['Email']))
      const fechaNacimiento = parseFecha(str(row['Fecha_Nacimiento']))
      const fuente = str(row['Fuente']) || 'BA INSURANCE'
      const ownerId = str(row['owner_id']) || defaultOwner || null

      if (!nombre && !apellido && !telefono && !email) return null

      return {
        nombre,
        apellido,
        email,
        telefono,
        fuente,
        fecha_nacimiento: fechaNacimiento,
        owner_id: ownerId,
        vendedor_id: ownerId,
        estado_pipeline: 'nuevo',
      }
    })
    .filter(Boolean) as Array<Record<string, string | null>>

  if (payloads.length === 0) {
    console.log('No valid rows to import')
    return
  }

  let inserted = 0
  let skipped = 0
  for (const lead of payloads) {
    const { error } = await supabase.from('leads').insert(lead)
    if (error) {
      const message = error.message.toLowerCase()
      if (message.includes('leads_telefono_unique') || message.includes('duplicate key')) {
        skipped += 1
        continue
      }
      console.error('Insert error:', error.message)
      process.exit(1)
    }
    inserted += 1
  }

  console.log(`Done. Imported ${inserted} leads. Skipped ${skipped} duplicates.`)
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
