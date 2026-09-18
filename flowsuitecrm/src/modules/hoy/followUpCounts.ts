import { TAREA_TIPO_OPTIONS } from '../citas/citaOptions.ts'

// These are persisted cache labels, not translated UI labels. Keep the identity
// contract shared with CitaModal and HoyPage's syncTaskContactCache.
export const TASK_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TAREA_TIPO_OPTIONS.map(({ value, label }) => [value, label])
)

type ContactAction = {
  id: string
  is_cliente?: boolean
  next_action: string | null
  next_action_date: string | null
}

type FollowUpTask = {
  contacto_tipo: 'lead' | 'cliente'
  contacto_id: string
  tipo: string
  fecha_vencimiento: string
  estado: string
}

function cacheKey(type: string, id: string, date: string, label: string) {
  return JSON.stringify([type, id, date, label.trim().toLowerCase()])
}

function buildTaskCacheKeys(tasks: readonly FollowUpTask[]): Set<string> {
  const keys = new Set<string>()
  for (const task of tasks) {
    if (task.estado !== 'pendiente') continue
    const label = TASK_TYPE_LABELS[task.tipo]
    if (label) {
      keys.add(cacheKey(task.contacto_tipo, task.contacto_id, task.fecha_vencimiento, label))
    }
  }
  return keys
}

// Legacy next_action has no source task ID. Match only the full cache
// signature used by the writers; date alone never establishes identity.
// A manual action with the exact same signature is indistinguishable until
// explicit source identity is persisted by all next_action writers.
function isContactActionCoveredByTask(contact: ContactAction, taskCacheKeys: Set<string>): boolean {
  if (!contact.next_action_date || contact.next_action == null) return false
  return taskCacheKeys.has(cacheKey(
    contact.is_cliente ? 'cliente' : 'lead',
    contact.id,
    contact.next_action_date,
    contact.next_action
  ))
}

export function countFollowUpActions(
  contacts: readonly ContactAction[],
  tasks: readonly FollowUpTask[],
  today: string
) {
  const counts = { overdue: 0, today: 0 }
  const taskCacheKeys = buildTaskCacheKeys(tasks)
  const countDate = (date: string) => {
    if (date < today) counts.overdue++
    else if (date === today) counts.today++
  }

  for (const task of tasks) {
    if (task.estado !== 'pendiente') continue
    // Every task is an independent action, even with identical contact/date/type.
    countDate(task.fecha_vencimiento)
  }

  for (const contact of contacts) {
    if (!contact.next_action_date) continue
    if (!isContactActionCoveredByTask(contact, taskCacheKeys)) countDate(contact.next_action_date)
  }

  return counts
}

// Leads/clientes cuya next_action ya está representada por una tarjeta de tarea
// estructurada (misma firma que countFollowUpActions usa para no contarla dos veces).
// Úsalo para no repetir la misma acción en dos secciones distintas de Hoy.
export function excludeContactsCoveredByTasks<T extends ContactAction>(
  contacts: readonly T[],
  tasks: readonly FollowUpTask[]
): T[] {
  const taskCacheKeys = buildTaskCacheKeys(tasks)
  return contacts.filter((contact) => !isContactActionCoveredByTask(contact, taskCacheKeys))
}
