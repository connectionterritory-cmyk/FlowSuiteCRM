// ── Selects por nivel de complejidad ────────────────────────────────────────

/** Columnas canónicas completas (incluye referidor + soft-delete + dirección) */
export const LEADS_EXTENDED_SELECT =
  'id, nombre, apellido, email, telefono, direccion, apartamento, ciudad, estado_region, codigo_postal, fecha_nacimiento, fuente, programa_id, referidor_tipo, referidor_id, embajador_id, referido_por_cliente_id, owner_id, vendedor_id, estado_pipeline, next_action, next_action_date, estado_civil, nombre_conyuge, telefono_conyuge, situacion_laboral, ninos_en_casa, cantidad_ninos, tiene_productos_rp, tipo_vivienda, created_at, updated_at, deleted_at, deleted_by, deleted_reason, persona_id'

/** Sin campos de dirección (fallback si la migración de dirección no está aplicada) */
export const LEADS_BASE_SELECT =
  'id, nombre, apellido, email, telefono, fecha_nacimiento, fuente, programa_id, referidor_tipo, referidor_id, embajador_id, referido_por_cliente_id, owner_id, vendedor_id, estado_pipeline, next_action, next_action_date, estado_civil, nombre_conyuge, telefono_conyuge, situacion_laboral, ninos_en_casa, cantidad_ninos, tiene_productos_rp, tipo_vivienda, created_at, updated_at, deleted_at, deleted_by, deleted_reason, persona_id'

/** Sin referidor ni dirección (fallback si migración 0069 no está aplicada) */
export const LEADS_COMPAT_SELECT =
  'id, nombre, apellido, email, telefono, fecha_nacimiento, fuente, programa_id, embajador_id, owner_id, vendedor_id, estado_pipeline, next_action, next_action_date, estado_civil, nombre_conyuge, telefono_conyuge, situacion_laboral, ninos_en_casa, cantidad_ninos, tiene_productos_rp, tipo_vivienda, created_at, updated_at, deleted_at'

/** Mínimo absoluto para emergencias (columnas que existen desde migración inicial) */
export const LEADS_MINIMAL_SELECT =
  'id, nombre, apellido, email, telefono, fuente, embajador_id, owner_id, estado_pipeline, next_action, next_action_date, created_at, updated_at'

export const LEADS_SEARCH_BASE_SELECT = 'id, nombre, apellido, telefono, vendedor_id, owner_id'

export const LEADS_SEARCH_EXTENDED_SELECT =
  'id, nombre, apellido, telefono, direccion, apartamento, ciudad, estado_region, codigo_postal, vendedor_id, owner_id'

// ── Detectores de columnas faltantes ─────────────────────────────────────────

const MISSING_ADDRESS_COLUMNS = ['direccion', 'apartamento', 'ciudad', 'estado_region', 'codigo_postal']
const MISSING_REFERIDOR_COLUMNS = ['referidor_tipo', 'referidor_id', 'referido_por_cliente_id']
const MISSING_SOFTDELETE_COLUMNS = ['deleted_at', 'deleted_by', 'deleted_reason']

function isMissingColumn(message: string, columns: string[]): boolean {
  const lower = message.toLowerCase()
  return columns.some(
    (column) =>
      lower.includes(`column leads.${column} does not exist`) ||
      lower.includes(`column "${column}" does not exist`) ||
      lower.includes(`column leads."${column}" does not exist`) ||
      lower.includes(`"${column}" of relation "leads" does not exist`) ||
      (lower.includes('schema cache') && lower.includes(column)),
  )
}

/** Error por columnas de dirección faltantes (migración de dirección no aplicada) */
export function isMissingLeadAddressColumnError(message?: string | null): boolean {
  if (!message) return false
  return isMissingColumn(message, MISSING_ADDRESS_COLUMNS)
}

/** Error por columnas de referidor faltantes (migración 0069 no aplicada) */
export function isMissingLeadReferidorColumnError(message?: string | null): boolean {
  if (!message) return false
  return isMissingColumn(message, MISSING_REFERIDOR_COLUMNS)
}

/** Cualquier error de columna faltante en leads */
export function isMissingLeadColumnError(message?: string | null): boolean {
  if (!message) return false
  return (
    isMissingColumn(message, MISSING_ADDRESS_COLUMNS) ||
    isMissingColumn(message, MISSING_REFERIDOR_COLUMNS) ||
    isMissingColumn(message, MISSING_SOFTDELETE_COLUMNS)
  )
}
