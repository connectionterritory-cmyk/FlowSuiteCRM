import assert from 'node:assert/strict'
import test from 'node:test'
import { countFollowUpActions, excludeContactsCoveredByTasks } from '../../src/modules/hoy/followUpCounts.ts'

const today = '2026-09-17'
const contact = { id: 'contact-1', is_cliente: false, next_action: 'Llamada', next_action_date: today }
const task = {
  contacto_tipo: 'lead' as const, contacto_id: contact.id,
  tipo: 'llamada', fecha_vencimiento: today, estado: 'pendiente',
}

test('a task and its contact cache count once, today and overdue', () => {
  assert.deepEqual(countFollowUpActions([contact], [task], today), { today: 1, overdue: 0 })
  assert.deepEqual(countFollowUpActions([contact], [task], '2026-09-18'), { today: 0, overdue: 1 })
})

test('two independent tasks with the same signature are both counted', () => {
  assert.deepEqual(countFollowUpActions([contact], [task, { ...task }], today), { today: 2, overdue: 0 })
})

test('same date does not merge different actions or different contacts', () => {
  for (const independent of [
    { ...contact, next_action: 'Visita' },
    { ...contact, next_action: 'Llamar para confirmar pedido' },
    { ...contact, id: 'contact-2' },
    { ...contact, is_cliente: true },
    { ...contact, next_action: null },
  ]) {
    assert.deepEqual(countFollowUpActions([independent], [task], today), { today: 2, overdue: 0 })
  }
})

test('matching client task uses client identity and normalized persisted label', () => {
  assert.deepEqual(countFollowUpActions(
    [{ ...contact, is_cliente: true, next_action: ' LLAMADA ' }],
    [{ ...task, contacto_tipo: 'cliente' }], today
  ), { today: 1, overdue: 0 })
})

test('same contact and label with different dates remain separate actions', () => {
  const yesterday = '2026-09-16'
  assert.deepEqual(countFollowUpActions(
    [contact],
    [task, { ...task, fecha_vencimiento: yesterday }],
    today
  ), { today: 1, overdue: 1 })
})

test('tasks that are not pendiente are ignored entirely', () => {
  assert.deepEqual(countFollowUpActions([], [{ ...task, estado: 'completada' }], today), { today: 0, overdue: 0 })
})

test('contacts without a next_action_date are ignored', () => {
  assert.deepEqual(countFollowUpActions([{ ...contact, next_action_date: null }], [], today), { today: 0, overdue: 0 })
})

test('a manual next_action with no matching task is counted on its own', () => {
  assert.deepEqual(countFollowUpActions([contact], [], today), { today: 1, overdue: 0 })
})

test('excludeContactsCoveredByTasks drops the contact already shown as a task card (Rosa Cruz case)', () => {
  assert.deepEqual(excludeContactsCoveredByTasks([contact], [task]), [])
})

test('excludeContactsCoveredByTasks keeps contacts with no matching task', () => {
  const other = { ...contact, id: 'contact-2', next_action: 'Visita' }
  assert.deepEqual(excludeContactsCoveredByTasks([contact, other], []), [contact, other])
})

test('excludeContactsCoveredByTasks only drops the exact match, not unrelated contacts', () => {
  const other = { ...contact, id: 'contact-2' }
  assert.deepEqual(excludeContactsCoveredByTasks([contact, other], [task]), [other])
})
