/**
 * import_cumpleanos.js
 * FlowSuiteCRM - Importador de cumpleaños
 * Adaptado para formato: CUSTOMER NAME, BIRTH DAY = "April 19"
 */

const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const fs = require('fs')

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rxiarmbosgivaplygqug.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4aWFybWJvc2dpdmFwbHlncXVnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTMzNDY1MywiZXhwIjoyMDg2OTEwNjUzfQ.w0XQruUACWiK7eEjuEElxqAA4EravSTymINtZOhHArA'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const MESES = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
}

function normalizeText(input) {
  return input
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseBirthDay(input) {
  if (!input) return null
  
  const normalized = String(input).toLowerCase().trim()
  const match = normalized.match(/^(\w+)\s+(\d+)$/)
  
  if (!match) return null
  
  const mesNombre = match[1]
  const dia = parseInt(match[2], 10)
  const mes = MESES[mesNombre]
  
  if (!mes || dia < 1 || dia > 31 || mes < 1 || mes > 12) return null
  
  return { mes, dia }
}

function buildDate(year, month, day) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

async function loadClientes() {
  const { data, error } = await supabase
    .from('clientes')
    .select('id, nombre, apellido, telefono')

  if (error) {
    console.error('Error cargando clientes:', error.message)
    process.exit(1)
  }

  return data || []
}

function buildNameIndex(clientes) {
  const index = new Map()

  clientes.forEach((c) => {
    const nombre = (c.nombre || '').trim()
    const apellido = (c.apellido || '').trim()

    const candidates = new Set()
    if (nombre) candidates.add(normalizeText(nombre))
    if (apellido) candidates.add(normalizeText(apellido))
    if (nombre && apellido) {
      candidates.add(normalizeText(`${nombre} ${apellido}`))
      candidates.add(normalizeText(`${apellido} ${nombre}`))
    }

    candidates.forEach((key) => {
      if (!key) return
      const list = index.get(key) || []
      list.push(c.id)
      index.set(key, list)
    })
  })

  return index
}

async function readSpreadsheet(filePath) {
  const wb = XLSX.readFile(filePath, { raw: false, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })

  // Encontrar fila con headers
  let headerRowIdx = -1
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (row && row.includes && row.includes('CUSTOMER NAME')) {
      headerRowIdx = i
      break
    }
  }

  if (headerRowIdx === -1) {
    console.error('No se encontró header "CUSTOMER NAME"')
    process.exit(1)
  }

  const headers = raw[headerRowIdx]
  const dataRows = raw.slice(headerRowIdx + 1).filter(r => r && r.some(c => c))

  console.log('Headers:', headers)
  console.log('Filas de datos:', dataRows.length)

  const idxNombre = headers.indexOf('CUSTOMER NAME')
  const idxBirthDay = headers.indexOf('BIRTH DAY')

  if (idxNombre === -1 || idxBirthDay === -1) {
    console.error('Faltan columnas requeridas')
    process.exit(1)
  }

  return { dataRows, idxNombre, idxBirthDay }
}

async function main() {
  const filePath = process.argv[2]
  
  if (!filePath) {
    console.error('Usage: node import_cumpleanos.js <archivo.xlsx>')
    console.error('Ejemplo: node import_cumpleanos.js "customer_birthdays_abril.xlsx"')
    process.exit(1)
  }

  console.log('=== IMPORTADOR DE CUMPLEAÑOS ===')
  console.log('Archivo:', filePath)

  console.log('\nCargando clientes de Supabase...')
  const clientes = await loadClientes()
  console.log('Clientes cargados:', clientes.length)

  const index = buildNameIndex(clientes)

  console.log('\nLeyendo spreadsheet...')
  const { dataRows, idxNombre, idxBirthDay } = await readSpreadsheet(filePath)

  const updates = []
  const noEncontrados = []
  const duplicados = []
  const invalidos = []

  dataRows.forEach((row) => {
    const nombreRaw = String(row[idxNombre] || '').trim()
    const birthDayRaw = String(row[idxBirthDay] || '').trim()

    if (!nombreRaw || !birthDayRaw) return

    const parsed = parseBirthDay(birthDayRaw)
    if (!parsed) {
      invalidos.push({ nombre: nombreRaw, fecha: birthDayRaw })
      return
    }

    const fecha = buildDate(2000, parsed.mes, parsed.dia)

    // Buscar por nombre
    const key = normalizeText(nombreRaw)
    const ids = index.get(key) || []

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

  console.log('\n=== RESUMEN ===')
  console.log('Total filas:', dataRows.length)
  console.log('Actualizables:', updates.length)
  console.log('No encontrados:', noEncontrados.length)
  console.log('Duplicados:', duplicados.length)
  console.log('Fechas inválidas:', invalidos.length)

  if (updates.length > 0) {
    console.log('\nPrimeras 5 actualizaciones:')
    updates.slice(0, 5).forEach(u => {
      console.log(`- ID: ${u.id.substring(0,8)}... => ${u.fecha_nacimiento}`)
    })
  }

  if (noEncontrados.length > 0) {
    console.log('\nNo encontrados (primeros 15):')
    noEncontrados.slice(0, 15).forEach(n => console.log(`- ${n}`))
  }

  if (invalidos.length > 0) {
    console.log('\nFechas inválidas (primeros 5):')
    invalidos.slice(0, 5).forEach(f => console.log(`- ${f.nombre}: ${f.fecha}`))
  }

  if (updates.length === 0) {
    console.log('\nNo hay actualizaciones que hacer.')
    return
  }

  console.log('\n=== ACTUALIZANDO EN SUPABASE ===')
  const batchSize = 50
  let updated = 0

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize)
    const { error } = await supabase
      .from('clientes')
      .upsert(batch, { onConflict: 'id' })
      .select('id')

    if (error) {
      console.error(`Batch error:`, error.message)
      continue
    }

    updated += batch.length
    console.log(`Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} actualizados`)
  }

  console.log('\n=== COMPLETADO ===')
  console.log('Total actualizados:', updated)
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})