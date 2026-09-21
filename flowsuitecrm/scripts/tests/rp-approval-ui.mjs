// Unit tests of the real page's decision handler and sales loader, with an isolated API/state adapter.
// No browser, credentials, network requests, or database writes.
// Run: node scripts/tests/rp-approval-ui.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/modules/ventas/VentasPage.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('VentasPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler
let loader
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'decidirAprobacionVenta') handler = node.initializer.getText(ast)
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadVentas') loader = node.initializer.arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(handler, 'Decision handler must exist in VentasPage')
assert.ok(loader, 'Sales loader must exist in VentasPage')
const javascript = ts.transpile(`const loadVentas = ${loader}; const decide = ${handler}`, { target: ts.ScriptTarget.ES2022 })

function setup({ rpcError, thrownError, refreshError, detailError, missingDetail, beforeDetail } = {}) {
  const pending = { id: 'order', estado_aprobacion: 'pendiente_aprobacion', cliente_id: null }
  const other = { id: 'other', estado_aprobacion: 'no_aplica', cliente_id: 'existing-client' }
  const state = { ventas: [pending, other], selected: pending, busy: false, calls: [], toasts: [], refreshed: [] }
  let result
  const context = vm.createContext({
    configured: true,
    currentRole: 'admin',
    hasDistribuidorScope: false,
    viewMode: 'seller',
    sessionUserId: 'user',
    distributionUserIds: [],
    setLoading: value => { state.loading = value },
    setError: value => { state.error = value },
    setDecisionSubmitting: value => { state.busy = value },
    setVentas: update => { state.ventas = typeof update === 'function' ? update(state.ventas) : update },
    setSelectedVenta: update => { state.selected = typeof update === 'function' ? update(state.selected) : update },
    showToast: (message, type) => state.toasts.push({ message, type }),
    loadOptions: async () => { state.refreshed.push('clientes') },
    loadVentaDetails: async id => { assert.equal(id, 'order'); state.refreshed.push('detalle') },
    supabase: {
      rpc: async (name, args) => {
        state.calls.push({ name, args })
        if (thrownError) throw thrownError
        result = { ...pending, estado_aprobacion: args.p_estado_aprobacion, cliente_id: args.p_estado_aprobacion === 'aprobada' ? 'new-client' : null }
        return { data: result, error: rpcError }
      },
      from: table => {
        assert.equal(table, 'ventas')
        const query = {
          select: () => query,
          order: () => query,
          then: resolve => {
            state.refreshed.push('ventas')
            return Promise.resolve({ data: refreshError ? null : [result ?? pending, other], error: refreshError }).then(resolve)
          },
          eq: (column, id) => { assert.equal(column, 'id'); assert.equal(id, 'order'); return query },
          maybeSingle: async () => {
            beforeDetail?.(state)
            return { data: missingDetail ? null : result, error: detailError }
          },
        }
        return query
      },
    },
  })
  vm.runInContext(javascript, context)
  return { state, context, decide: vm.runInContext('decide', context), loadVentas: vm.runInContext('loadVentas', context) }
}

for (const decision of ['aprobada', 'rechazada']) {
  test(`${decision}: uses only the decision RPC, refreshes clients/list/details and retains final state`, async () => {
    const { state, decide } = setup()
    const account = decision === 'aprobada' ? 'ACCOUNT' : null
    await decide('order', decision, account)
    assert.equal(state.calls.length, 1)
    assert.equal(state.calls[0].name, 'fn_aprobar_rechazar_venta')
    assert.equal(JSON.stringify(state.calls[0].args), JSON.stringify({ p_venta_id: 'order', p_estado_aprobacion: decision, p_numero_cuenta_financiera: account }))
    assert.deepEqual(state.refreshed.sort(), ['clientes', 'detalle', 'ventas'])
    assert.equal(state.selected.estado_aprobacion, decision)
    assert.equal(state.selected.cliente_id, decision === 'aprobada' ? 'new-client' : null)
    assert.equal(state.ventas[0].estado_aprobacion, decision)
    assert.equal(state.busy, false)
    assert.equal(state.toasts.at(-1).type, 'success')
  })
}

for (const options of [{ rpcError: { message: 'Rol no autorizado' } }, { thrownError: new Error('Network failure') }]) {
  test(`RPC failure leaves the order pending and releases controls: ${JSON.stringify(options)}`, async () => {
    const { state, decide } = setup(options)
    await decide('order', 'aprobada', 'ACCOUNT')
    assert.equal(state.selected.estado_aprobacion, 'pendiente_aprobacion')
    assert.equal(state.busy, false)
    assert.equal(state.refreshed.length, 0)
    assert.equal(state.toasts.at(-1).type, 'error')
  })
}

for (const options of [{ refreshError: { message: 'Refresh failed' } }, { detailError: { message: 'Detail failed' } }, { missingDetail: true }]) {
  test(`refresh failure cannot leave a confirmed order pending: ${JSON.stringify(options)}`, async () => {
    const { state, decide } = setup(options)
    await decide('order', 'aprobada', 'ACCOUNT')
    assert.equal(state.selected.estado_aprobacion, 'aprobada')
    assert.equal(state.selected.cliente_id, 'new-client')
    assert.equal(state.ventas.length, 2, 'a failed refresh must preserve the complete list')
    assert.equal(state.ventas[0].estado_aprobacion, 'aprobada')
    assert.equal(state.ventas[0].cliente_id, 'new-client')
    assert.equal(state.ventas[1].cliente_id, 'existing-client')
    assert.equal(state.busy, false)
    assert.match(state.toasts.at(-1).message, /Decisión guardada.*Recarga/)
    assert.equal(state.toasts.at(-1).type, 'error')
  })
}

test('a delayed response does not reopen a closed order or replace another selection', async () => {
  for (const selection of [null, { id: 'other-order' }]) {
    const { state, decide } = setup({ beforeDetail: state => { state.selected = selection } })
    await decide('order', 'rechazada', null)
    assert.equal(state.selected, selection)
  }
})

test('normal loading errors still clear rows and release loading state', async () => {
  const { state, loadVentas } = setup({ refreshError: { message: 'Read failed' } })
  await loadVentas()
  assert.equal(state.ventas.length, 0)
  assert.equal(state.loading, false)
  assert.equal(state.error, 'Read failed')
})

test('an empty distributor scope still clears rows even when preserving on errors', async () => {
  const { state, context, loadVentas } = setup()
  context.hasDistribuidorScope = true
  context.viewMode = 'distributor'
  await loadVentas({ preserveOnError: true })
  assert.equal(state.ventas.length, 0)
  assert.equal(state.loading, false)
})
