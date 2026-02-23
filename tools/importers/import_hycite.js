const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()
const fs = require('fs')
const path = require('path')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k,...v] = a.replace(/^--/,'').split('='); return [k, v.join('=')] }))
const filePath = args['file']
const userId = args['user']

if (!filePath || !userId) { console.error('❌ Falta --file y --user'); process.exit(1) }
if (!fs.existsSync(filePath)) { console.error('❌ Archivo no encontrado:', filePath); process.exit(1) }

function limpiarTelefono(raw) { if (!raw) return null; const d = String(raw).replace(/\D/g,''); return d.length >= 7 ? d : null }
function limpiarEmail(raw) { if (!raw) return null; const e = raw.trim().toLowerCase(); return e.includes('@') ? e : null }
function parsearFecha(raw) { if (!raw) return null; const s = String(raw).trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; return null }
function parsearMonto(raw) { if (!raw) return 0; const n = parseFloat(String(raw).replace(/[$,\s]/g,'')); return isNaN(n) ? 0 : Math.abs(n) }
function parsearNivel(raw) { const n = parseInt(raw||'1'); if (isNaN(n)||n<1) return 1; return Math.min(n,9) }
function mapearEstado(s) { const u = String(s||'').toUpperCase(); if (u==='PURGED') return 'cancelacion_total'; return 'actual' }
function calcularMoroso(row) { return parsearMonto(row['0-30 DÍAS DE MOROSIDAD'])+parsearMonto(row['31-60 DÍAS DE MOROSIDAD'])+parsearMonto(row['61-90 DÍAS DE MOROSIDAD'])+parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD']) }
function calcularAtraso(row) { if (parsearMonto(row['SOBRE 90 DÍAS DE MOROSIDAD'])>0) return 91; if (parsearMonto(row['61-90 DÍAS DE MOROSIDAD'])>0) return 61; if (parsearMonto(row['31-60 DÍAS DE MOROSIDAD'])>0) return 31; if (parsearMonto(row['0-30 DÍAS DE MOROSIDAD'])>0) return 1; return 0 }

async function main() {
  console.log('\n🚀 FlowSuiteCRM — Importador Hy-Cite')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📂 Archivo:', path.basename(filePath))
  console.log('👤 Usuario:', userId)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const wb = XLSX.readFile(filePath, { raw: false, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })

  const seen = new Map()
  const headers = raw[0].map(h => { const c = seen.get(h)??0; seen.set(h,c+1); return c===0?h:`${h}_${c}` })
  const rows = raw.slice(1).map(row => Object.fromEntries(headers.map((h,i) => [h, String(row[i]??'').trim()])))

  console.log(`📊 Filas en Excel: ${rows.length}`)

  const validos = []
  rows.forEach((row, idx) => {
    const id = String(row['# DE CLIENTE']||'').trim()
    if (!id) return
    const nombre = String(row['NOMBRE_1']||row['NOMBRE']||'').trim()||null
    const ap1 = String(row['APELLIDO PATERNO']||'').trim()
    const ap2 = String(row['APELLIDO MATERNO']||'').trim()
    const apellido = [ap1,ap2].filter(Boolean).join(' ')||null
    validos.push({
      hycite_id: id,
      tipo_cliente: String(row['CLIENTE']||'HC').trim(),
      nombre, apellido,
      email: limpiarEmail(row['CORREO ELECTRÓNICO']),
      telefono: limpiarTelefono(row['TELÉFONO MÓVIL']),
      telefono_casa: limpiarTelefono(row['TELÉFONO DE CASA']),
      direccion: String(row['DIRECCIÓN']||'').replace(/\n/g,', ')||null,
      saldo_actual: parsearMonto(row['SALDO ACTUAL']),
      monto_moroso: calcularMoroso(row),
      dias_atraso: calcularAtraso(row),
      nivel: parsearNivel(row['NIVEL']),
      estado_cuenta: mapearEstado(row['STATUS']),
      elegible_addon: true,
      fecha_ultimo_pedido: parsearFecha(row['ÚLTIMA FECHA DE COMPRA']),
      origen: 'hycite_import',
      codigo_vendedor_hycite: String(row['VENDEDOR']||'').trim()||null,
      codigo_dist_hycite: String(row['DISTRIBUIDOR']||'').trim()||null,
      updated_at: new Date().toISOString()
    })
  })

  console.log(`✅ Válidos: ${validos.length}`)
  console.log('\n📋 Preview primeros 3:')
  validos.slice(0,3).forEach((c,i) => console.log(`  [${i+1}] ${c.hycite_id} | ${c.nombre} ${c.apellido} | ${c.estado_cuenta} | $${c.saldo_actual}`))

  console.log('\n📤 Importando...\n')
  let procesados = 0, errores = 0
  for (let i = 0; i < validos.length; i += 50) {
    const lote = validos.slice(i, i+50)
    const { data, error } = await supabase.from('clientes').upsert(lote, { onConflict: 'hycite_id' }).select('id')
    if (error) { console.error(`  ❌ Lote ${Math.floor(i/50)+1}:`, error.message); errores += lote.length }
    else { console.log(`  ✅ Lote ${Math.floor(i/50)+1}: ${data?.length??0} registros`); procesados += data?.length??0 }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 RESUMEN')
  console.log(`Total    : ${rows.length}`)
  console.log(`Importados: ${procesados}`)
  console.log(`Errores  : ${errores}`)
  console.log(errores===0 ? '\n✅ Importación exitosa\n' : '\n⚠️ Completado con errores\n')
}

main().catch(err => { console.error('💥 Error fatal:', err.message); process.exit(1) })
