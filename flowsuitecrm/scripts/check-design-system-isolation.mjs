// Verifica, sobre el build de producción (dist/), que el Design System Phase 0 no afecta
// globalmente a las páginas existentes. Ejecutar después de `npm run build`.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')
const fail = []

if (!existsSync(dist)) {
  console.error('dist/ no existe: ejecuta `npm run build` primero.')
  process.exit(2)
}

const assets = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.css'))
const css = assets.map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n')

// Clases definidas en el CSS legacy (fuente).
const legacy = ['src/index.css', 'src/components/MessageModal.css']
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n')
const classesIn = (text) => new Set([...text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))
const legacyClasses = classesIn(legacy)
// Se ignoran valores numéricos (".25rem") y extensiones de archivo dentro de url(...).
const extra = [...classesIn(css)].filter((c) => !legacyClasses.has(c) && !/^\d/.test(c))

// Las utilidades del DS aparecen como `.tw\:...`, que el regex captura como la clase "tw".
const unexpected = extra.filter((c) => c !== 'tw')
if (unexpected.length) {
  // Tolerar nombres que provengan de CSS de dependencias: se reportan para revisión humana.
  fail.push(`Clases nuevas fuera del prefijo tw: ${unexpected.slice(0, 15).join(', ')}`)
}

if (/margin:0;padding:0;border:0 solid/.test(css)) fail.push('Se detectó el preflight de Tailwind (reset global).')
if (!/\.tw\\:/.test(css)) fail.push('No se encontraron utilidades tw: (¿se eliminó el Design System?).')
if (existsSync(join(dist, 'design-system.html'))) fail.push('design-system.html no debe publicarse en producción.')

const layers = [...new Set([...css.matchAll(/@layer ([a-z, ]+)[;{]/g)].map((m) => m[1].trim()))]
const allowedLayers = new Set(['properties', 'theme', 'utilities'])
for (const layer of layers) if (!allowedLayers.has(layer)) fail.push(`@layer inesperado: ${layer}`)

if (fail.length) {
  console.error('FAIL\n- ' + fail.join('\n- '))
  process.exit(1)
}
console.log(`OK: ${extra.length ? 'solo clases tw:' : 'sin clases nuevas'}; sin preflight; layers=${layers.join('|')}; design-system.html no publicado.`)
