// Unit tests of the real page's handlers/loaders, with an isolated API/state adapter.
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
let refreshEffect
const functions = {}
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('void loadVentas()')) {
    refreshEffect = node.arguments[0].getText(ast)
  }
  if (ts.isVariableDeclaration(node) && ['loadVentas', 'loadOptions', 'loadVentaDetails', 'handleRowClick', 'closeVentaDetails'].includes(node.name.getText(ast))) {
    const initializer = node.initializer
    functions[node.name.getText(ast)] = (ts.isCallExpression(initializer) ? initializer.arguments[0] : initializer).getText(ast)
  }
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
    ventasRequest: { current: 0 },
    optionsRequest: { current: 0 },
    detailsRequest: { current: 0 },
    decisionRequest: { current: 0 },
    selectedVentaId: { current: 'order' },
    activeLoaders: { current: null },
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
  context.activeLoaders.current = { loadVentas: vm.runInContext('loadVentas', context), loadOptions: context.loadOptions }
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

function setupDeferredDecisions() {
  const a = { id: 'A', estado_aprobacion: 'pendiente_aprobacion', cliente_id: null }
  const b = { id: 'B', estado_aprobacion: 'pendiente_aprobacion', cliente_id: null }
  const other = { id: 'other', estado_aprobacion: 'no_aplica', cliente_id: 'existing-client' }
  const state = { ventas: [a, b, other], selected: a, busy: false, toasts: [], refreshes: [], details: [] }
  const rpcCalls = []
  const context = vm.createContext({
    decisionRequest: { current: 0 },
    detailsRequest: { current: 0 },
    selectedVentaId: { current: 'A' },
    activeLoaders: { current: null },
    setDecisionSubmitting: value => { state.busy = value },
    setVentas: update => { state.ventas = typeof update === 'function' ? update(state.ventas) : update },
    setSelectedVenta: update => { state.selected = typeof update === 'function' ? update(state.selected) : update },
    showToast: (message, type) => state.toasts.push({ message, type }),
    loadVentaDetails: async id => { state.details.push(id) },
    supabase: {
      rpc: (_name, args) => new Promise(resolve => rpcCalls.push({ args, resolve })),
      from: table => {
        assert.equal(table, 'ventas')
        let ventaId
        const query = {
          select: () => query,
          eq: (column, id) => { assert.equal(column, 'id'); ventaId = id; return query },
          maybeSingle: async () => ({
            data: state.ventas.find(venta => venta.id === ventaId), error: null,
          }),
        }
        return query
      },
    },
  })
  context.activeLoaders.current = {
    loadVentas: async () => { state.refreshes.push('ventas') },
    loadOptions: async () => { state.refreshes.push('options') },
  }
  vm.runInContext(javascript, context)
  return { state, context, rpcCalls, decide: vm.runInContext('decide', context) }
}

test('a stale decision finishing after a newer one has no UI effects', async () => {
  const h = setupDeferredDecisions()
  const old = h.decide('A', 'rechazada', null)
  const current = h.decide('B', 'aprobada', 'ACCOUNT')
  assert.equal(h.rpcCalls.length, 2)
  h.context.selectedVentaId.current = 'B'
  h.state.selected = h.state.ventas[1]
  h.rpcCalls[1].resolve({ data: { ...h.state.ventas[1], estado_aprobacion: 'aprobada', cliente_id: 'new-client' }, error: null })
  await current
  const expected = JSON.stringify(h.state)
  assert.equal(h.state.busy, false)
  assert.equal(h.state.toasts.length, 1)
  h.rpcCalls[0].resolve({ data: { ...h.state.ventas[0], estado_aprobacion: 'rechazada' }, error: null })
  await old
  assert.equal(JSON.stringify(h.state), expected)
})

test('a context change makes an in-flight decision completely inert', async () => {
  const h = setupDeferredDecisions()
  const old = h.decide('A', 'aprobada', 'ACCOUNT')
  assert.equal(h.state.busy, true)
  // This models the scope effect cleanup: it invalidates outstanding decisions,
  // while the replacement scope owns its own loading state.
  h.context.decisionRequest.current += 1
  h.context.selectedVentaId.current = 'other'
  h.state.selected = h.state.ventas[2]
  h.state.busy = false
  const expected = JSON.stringify(h.state)
  h.rpcCalls[0].resolve({ data: { ...h.state.ventas[0], estado_aprobacion: 'aprobada', cliente_id: 'new-client' }, error: null })
  await old
  assert.equal(JSON.stringify(h.state), expected)
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

// Deferred queries exercise the actual component functions, including selection and
// close handlers. Each batch can finish independently, without timers or network.
function setupRaces() {
  const state = { ventas: [{ id: 'A' }, { id: 'B' }], items: [], transactions: [] }
  const requests = []
  const context = vm.createContext({
    configured: true, currentRole: 'admin', currentOrgId: 'org',
    activeLoaders: { current: null },
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    hasDistribuidorScope: false, viewMode: 'seller', sessionUserId: 'user',
    distributionUserIds: [], decisionSubmitting: false,
    ventas: state.ventas,
    ventasRequest: { current: 0 }, optionsRequest: { current: 0 },
    detailsRequest: { current: 0 }, decisionRequest: { current: 0 }, selectedVentaId: { current: null },
    supabase: {
      from: table => {
        let resolve
        const promise = new Promise(done => { resolve = done })
        const request = { table, filters: [], resolve }
        requests.push(request)
        const query = {
          select: () => query, order: () => query, is: () => query,
          eq: (...filter) => { request.filters.push(filter); return query },
          in: (...filter) => { request.filters.push(filter); return query },
          or: () => query,
          then: (yes, no) => promise.then(yes, no),
        }
        return query
      },
    },
  })
  for (const [setter, key] of Object.entries({
    setVentas: 'ventas', setSelectedVenta: 'selected',
    setSelectedVentaItems: 'items', setSelectedVentaTransacciones: 'transactions',
    setClientes: 'clientes', setProductos: 'productos', setLeads: 'leads',
    setLoading: 'loading', setLoadingOptions: 'loadingOptions', setError: 'error',
    setDecisionSubmitting: 'decisionSubmitting',
  })) context[setter] = value => { state[key] = typeof value === 'function' ? value(state[key]) : value }
  vm.runInContext(ts.transpile(Object.entries(functions).map(([name, body]) => `const ${name} = ${body}`).join('\n'), {
    target: ts.ScriptTarget.ES2022,
  }), context)
  const api = Object.fromEntries(Object.keys(functions).map(name => [name, vm.runInContext(name, context)]))
  api.refreshEffect = vm.runInContext(ts.transpile(`(${refreshEffect})`, { target: ts.ScriptTarget.ES2022 }), context)
  const finish = (batch, label, error = null) => batch.forEach(request => request.resolve({
    data: error ? null : [{ id: `${label}:${request.table}` }], error,
  }))
  return { state, context, requests, finish, ...api }
}

test('A: selecting B clears A details; late A results cannot overwrite B', async () => {
  const h = setupRaces()
  h.state.items = [{ id: 'previous' }]
  h.state.transactions = [{ id: 'previous' }]
  const a = h.handleRowClick({ id: 'A' })
  const old = h.requests.splice(0)
  const b = h.handleRowClick({ id: 'B' })
  assert.equal(h.state.selected.id, 'B')
  assert.equal(h.state.items.length, 0)
  assert.equal(h.state.transactions.length, 0)
  h.finish(h.requests.splice(0), 'B')
  await b
  h.finish(old, 'A')
  await a
  assert.equal(h.state.items[0].id, 'B:venta_items')
  assert.equal(h.state.transactions[0].id, 'B:venta_transacciones')
})

test('closing/reopening the same order invalidates old details and ignores unrelated refreshes', async () => {
  const h = setupRaces()
  const old = h.handleRowClick({ id: 'A' })
  const batch = h.requests.splice(0)
  h.closeVentaDetails()
  h.finish(batch, 'closed')
  await old
  assert.equal(h.state.selected, null)
  assert.equal(h.state.items.length, 0)
  const reopened = h.handleRowClick({ id: 'A' })
  const first = h.requests.splice(0)
  const latest = h.loadVentaDetails('A')
  await h.loadVentaDetails('B')
  h.finish(h.requests.splice(0), 'latest')
  await latest
  h.finish(first, 'obsolete')
  await reopened
  assert.equal(h.state.items[0].id, 'latest:venta_items')
  assert.equal(h.state.transactions[0].id, 'latest:venta_transacciones')
})

for (const loaderName of ['loadVentas', 'loadOptions']) {
  for (const oldError of [null, { message: 'obsolete failure' }]) {
    test(`B: ${loaderName} ignores late results/errors: ${JSON.stringify(oldError)}`, async () => {
      const h = setupRaces()
      const old = h[loaderName]()
      const batch = h.requests.splice(0)
      const latest = h[loaderName]()
      h.finish(h.requests.splice(0), 'latest')
      await latest
      const expected = JSON.stringify(h.state)
      h.finish(batch, 'obsolete', oldError)
      assert.equal(await old, undefined, 'stale errors must not escape into decision handler')
      assert.equal(JSON.stringify(h.state), expected)
    })
  }

  test(`${loaderName}: stale completion cannot release current loading state`, async () => {
    const h = setupRaces()
    const old = h[loaderName]()
    const batch = h.requests.splice(0)
    const latest = h[loaderName]()
    h.finish(batch, 'obsolete')
    await old
    assert.equal(h.state[loaderName === 'loadVentas' ? 'loading' : 'loadingOptions'], true)
    h.finish(h.requests.splice(0), 'latest')
    await latest
    assert.equal(h.state[loaderName === 'loadVentas' ? 'loading' : 'loadingOptions'], false)
  })

  test(`${loaderName}: an empty new scope invalidates an older populated response`, async () => {
    const h = setupRaces()
    const old = h[loaderName]()
    const batch = h.requests.splice(0)
    h.context.hasDistribuidorScope = true
    h.context.viewMode = 'distributor'
    await h[loaderName]()
    h.finish(batch, 'obsolete')
    await old
    for (const key of loaderName === 'loadVentas' ? ['ventas'] : ['clientes', 'productos', 'leads']) {
      assert.equal(h.state[key].length, 0)
    }
  })
}

test('C: late pre-approval read cannot undo RPC confirmation after refresh failure', async () => {
  const h = setup({ refreshError: { message: 'Refresh failed' } })
  const normalFrom = h.context.supabase.from
  let resolveOld
  const oldResponse = new Promise(resolve => { resolveOld = resolve })
  h.context.supabase.from = () => {
    const query = { select: () => query, order: () => oldResponse }
    return query
  }
  const old = h.loadVentas()
  h.context.supabase.from = normalFrom
  await h.decide('order', 'aprobada', 'ACCOUNT')
  resolveOld({ data: [{ id: 'order', estado_aprobacion: 'pendiente_aprobacion' }], error: null })
  await old
  assert.equal(h.state.ventas.length, 2)
  assert.equal(h.state.ventas[0].estado_aprobacion, 'aprobada')
  assert.equal(h.state.selected.estado_aprobacion, 'aprobada')
  assert.equal(h.state.error, 'Refresh failed')
  assert.ok(h.state.refreshed.includes('clientes'))
})

test('decision refresh uses the current scope loaders after an in-flight RPC', async () => {
  const h = setup()
  const called = []
  const rpc = h.context.supabase.rpc
  h.context.supabase.rpc = async (...args) => {
    h.context.activeLoaders.current = {
      loadVentas: async options => { assert.equal(options.preserveOnError, true); called.push('ventas') },
      loadOptions: async () => { called.push('clientes') },
    }
    return rpc(...args)
  }
  await h.decide('order', 'aprobada', 'ACCOUNT')
  assert.deepEqual(called, ['ventas', 'clientes'])
  assert.equal(h.state.selected.estado_aprobacion, 'aprobada')
})

test('effect cleanup invalidates all pending reads before the next scope refresh or unmount', async () => {
  const h = setupRaces()
  const cleanup = h.refreshEffect()
  assert.ok(h.context.activeLoaders.current)
  const reads = [h.loadVentas(), h.loadOptions(), h.handleRowClick({ id: 'A' })]
  const expected = JSON.stringify(h.state)
  cleanup()
  assert.equal(h.context.activeLoaders.current, null)
  h.finish(h.requests, 'obsolete')
  await Promise.all(reads)
  assert.equal(JSON.stringify(h.state), expected)
})
