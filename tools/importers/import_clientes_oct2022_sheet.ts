/**
 * Importador para hoja "Clientes Oct2022-B" -> FlowSuiteCRM
 * ---------------------------------------------------------
 * Formato esperado:
 *   Nombre | Dirección | Ciudad | Estado | ZIP | Tel Casa | Tel Trabajo |
 *   Tel Móvil | Email | Tipo Cuenta | Estado Cuenta | Saldo Actual |
 *   Crédito Disponible | Emprendedor
 *
 * Regla de negocio:
 * - Si "Estado Cuenta" contiene "Prospecto" o "Lead" => va a leads
 * - Todo lo demás => va a clientes
 *
 * Uso:
 *   npx ts-node tools/importers/import_clientes_oct2022_sheet.ts \
 *     --file="/ruta/Clientes_Oct2022_Folder3.xlsx" \
 *     --org-id="00000000-0000-0000-0000-000000000001" \
 *     --source-url="https://docs.google.com/spreadsheets/d/.../edit" \
 *     --owner-id="uuid-opcional-para-leads" \
 *     --dry-run="true"
 *
 * Requiere:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_KEY)
 */

import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY en .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type SheetRow = {
  Nombre?: string
  Dirección?: string
  Ciudad?: string
  Estado?: string
  ZIP?: string
  'Tel Casa'?: string
  'Tel Trabajo'?: string
  'Tel Móvil'?: string
  Email?: string
  'Tipo Cuenta'?: string
  'Estado Cuenta'?: string
  'Saldo Actual'?: string
  'Crédito Disponible'?: string
  Emprendedor?: string
  [key: string]: unknown
}

type ClientePayload = {
  org_id: string
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
  estado_cuenta_raw: string | null
  estado_operativo: 'activo' | 'inactivo' | 'cancelado' | null
  saldo_actual: number
  credito_disponible: number | null
  vendedor_hycite_nombre: string | null
  origen: 'hycite_import'
  fuente_import: 'google_sheet_clientes_oct2022'
  import_file_name: string
  import_drive_url: string | null
  updated_at: string
}

type LeadPayload = {
  org_id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
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
}

function str(value: unknown): string {
  return String(value ?? '').trim()
}

function nullStr(value: unknown): string | null {
  const v = str(value)
  return v.length ? v : null
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
  const normalized = raw.replace(/[$,\s]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function splitName(fullName: string | null): { nombre: string | null; apellido: string | null } {
  if (!fullName) return { nombre: null, apellido: null }

  const parts = fullName.split(/\s+/).filter(Boolean)
  if (!parts.length) return { nombre: null, apellido: null }
  if (parts.length === 1) return { nombre: parts[0], apellido: null }

  return {
    nombre: parts[0] ?? null,
    apellido: parts.slice(1).join(' ') || null,
  }
}

function isLeadRow(row: SheetRow): boolean {
  const estadoCuenta = str(row['Estado Cuenta']).toLowerCase()
  return estadoCuenta.includes('prospecto') || estadoCuenta.includes('lead')
}

function deriveEstadoOperativo(value: unknown): 'activo' | 'inactivo' | 'cancelado' | null {
  const estado = str(value).toLowerCase()
  if (!estado) return null
  if (estado.includes('cancel')) return 'cancelado'
  if (estado.includes('inactivo')) return 'inactivo'
  if (estado.includes('actual')) return 'activo'
  return null
}

function preferredPhone(row: SheetRow): string | null {
  return (
    cleanPhone(row['Tel Móvil']) ??
    cleanPhone(row['Tel Casa']) ??
    cleanPhone(row['Tel Trabajo'])
  )
}

function toClientePayload(
  row: SheetRow,
  orgId: string,
  importFileName: string,
  importDriveUrl: string | null,
): ClientePayload {
  const { nombre, apellido } = splitName(nullStr(row.Nombre))
  return {
    org_id: orgId,
    nombre,
    apellido,
    telefono: preferredPhone(row),
    telefono_casa: cleanPhone(row['Tel Casa']),
    email: cleanEmail(row.Email),
    direccion: nullStr(row.Dirección),
    ciudad: nullStr(row.Ciudad),
    estado_region: nullStr(row.Estado),
    codigo_postal: nullStr(row.ZIP),
    tipo_cuenta_hycite: nullStr(row['Tipo Cuenta']),
    estado_cuenta_raw: nullStr(row['Estado Cuenta']),
    estado_operativo: deriveEstadoOperativo(row['Estado Cuenta']),
    saldo_actual: parseMoney(row['Saldo Actual']) ?? 0,
    credito_disponible: parseMoney(row['Crédito Disponible']),
    vendedor_hycite_nombre: nullStr(row.Emprendedor),
    origen: 'hycite_import',
    fuente_import: 'google_sheet_clientes_oct2022',
    import_file_name: importFileName,
    import_drive_url: importDriveUrl,
    updated_at: new Date().toISOString(),
  }
}

function toLeadPayload(
  row: SheetRow,
  orgId: string,
  ownerId: string | null,
  importFileName: string,
  importDriveUrl: string | null,
  runId: string,
): LeadPayload {
  const { nombre, apellido } = splitName(nullStr(row.Nombre))
  return {
    org_id: orgId,
    nombre,
    apellido,
    telefono: preferredPhone(row),
    email: cleanEmail(row.Email),
    direccion: nullStr(row.Dirección),
    ciudad: nullStr(row.Ciudad),
    estado_region: nullStr(row.Estado),
    codigo_postal: nullStr(row.ZIP),
    fuente: 'Import Google Sheet Oct2022',
    estado_pipeline: 'nuevo',
    owner_id: ownerId,
    run_id: runId,
    file_name_origen: importFileName,
    confianza_ocr: 'alta',
    fuente_import: 'google_sheet_clientes_oct2022',
    import_file_name: importFileName,
    import_drive_url: importDriveUrl,
  }
}

async function upsertClientes(rows: ClientePayload[]) {
  const withPhone = rows.filter((row) => row.telefono)
  const withoutPhone = rows.filter((row) => !row.telefono)

  let processed = 0
  let errors = 0

  if (withPhone.length) {
    const { data, error } = await supabase
      .from('clientes')
      .upsert(withPhone, { onConflict: 'org_id,telefono' })
      .select('id')

    if (error) {
      console.error('Error upsert clientes con teléfono:', error.message)
      errors += withPhone.length
    } else {
      processed += data?.length ?? withPhone.length
    }
  }

  if (withoutPhone.length) {
    const { data, error } = await supabase
      .from('clientes')
      .insert(withoutPhone)
      .select('id')

    if (error) {
      console.error('Error insert clientes sin teléfono:', error.message)
      errors += withoutPhone.length
    } else {
      processed += data?.length ?? withoutPhone.length
    }
  }

  return { processed, errors }
}

async function upsertLeads(rows: LeadPayload[]) {
  const withPhone = rows.filter((row) => row.telefono)
  const withoutPhone = rows.filter((row) => !row.telefono)

  let processed = 0
  let errors = 0

  if (withPhone.length) {
    const { data, error } = await supabase
      .from('leads')
      // TODO: unique index leads(org_id, telefono) must exist in DB for this to work
      .upsert(withPhone, { onConflict: 'org_id,telefono' })
      .select('id')

    if (error) {
      console.error('Error upsert leads con teléfono:', error.message)
      errors += withPhone.length
    } else {
      processed += data?.length ?? withPhone.length
    }
  }

  if (withoutPhone.length) {
    const { data, error } = await supabase
      .from('leads')
      .insert(withoutPhone)
      .select('id')

    if (error) {
      console.error('Error insert leads sin teléfono:', error.message)
      errors += withoutPhone.length
    } else {
      processed += data?.length ?? withoutPhone.length
    }
  }

  return { processed, errors }
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, '').split('=')
      return [key, rest.join('=')]
    }),
  )

  const filePath = args['file']
  const orgId = args['org-id']
  const sourceUrl = args['source-url'] || null
  const ownerId = args['owner-id'] || null
  const dryRun = String(args['dry-run'] || '').toLowerCase() === 'true'

  if (!filePath || !orgId) {
    console.error(
      'Uso: npx ts-node tools/importers/import_clientes_oct2022_sheet.ts ' +
      '--file="/ruta/archivo.xlsx" --org-id="uuid-org" [--source-url="..."] [--owner-id="uuid"] [--dry-run="true"]',
    )
    process.exit(1)
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`)
    process.exit(1)
  }

  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<SheetRow>(firstSheet, { defval: '' })
  const importFileName = path.basename(filePath)
  const runId = `sheet-oct2022-${new Date().toISOString()}`

  const clientes: ClientePayload[] = []
  const leads: LeadPayload[] = []

  for (const row of rows) {
    const hasAnyData = Object.values(row).some((value) => str(value).length > 0)
    if (!hasAnyData) continue

    if (isLeadRow(row)) {
      leads.push(toLeadPayload(row, orgId, ownerId, importFileName, sourceUrl, runId))
    } else {
      clientes.push(toClientePayload(row, orgId, importFileName, sourceUrl))
    }
  }

  console.log('\nImportador Google Sheet Oct2022 -> FlowSuiteCRM')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Archivo           : ${importFileName}`)
  console.log(`Org ID            : ${orgId}`)
  console.log(`Source URL        : ${sourceUrl ?? '-'}`)
  console.log(`Owner ID leads    : ${ownerId ?? '-'}`)
  console.log(`Dry run           : ${dryRun ? 'sí' : 'no'}`)
  console.log(`Filas leídas      : ${rows.length}`)
  console.log(`Clientes detectados: ${clientes.length}`)
  console.log(`Leads detectados  : ${leads.length}`)

  if (clientes.length) {
    console.log('\nPreview clientes:')
    clientes.slice(0, 3).forEach((row, index) => {
      console.log(`  [${index + 1}] ${row.nombre ?? '-'} ${row.apellido ?? ''} | ${row.telefono ?? '-'} | ${row.estado_cuenta_raw ?? '-'}`)
    })
  }

  if (leads.length) {
    console.log('\nPreview leads:')
    leads.slice(0, 3).forEach((row, index) => {
      console.log(`  [${index + 1}] ${row.nombre ?? '-'} ${row.apellido ?? ''} | ${row.telefono ?? '-'} | ${row.fuente}`)
    })
  }

  if (dryRun) {
    console.log('\nDry run: no se escribió nada en Supabase.')
    return
  }

  const clienteResult = await upsertClientes(clientes)
  const leadResult = await upsertLeads(leads)

  console.log('\nResumen')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Clientes procesados: ${clienteResult.processed}`)
  console.log(`Clientes error     : ${clienteResult.errors}`)
  console.log(`Leads procesados   : ${leadResult.processed}`)
  console.log(`Leads error        : ${leadResult.errors}`)
}

main().catch((error) => {
  console.error('Error fatal:', error)
  process.exit(1)
})
