export const LEADS_BASE_SELECT =
  'id, nombre, apellido, email, telefono, fecha_nacimiento, fuente, programa_id, embajador_id, referido_por_cliente_id, owner_id, vendedor_id, estado_pipeline, next_action, next_action_date, estado_civil, nombre_conyuge, telefono_conyuge, situacion_laboral, ninos_en_casa, cantidad_ninos, tiene_productos_rp, tipo_vivienda, created_at, updated_at, deleted_at, deleted_by, deleted_reason'

export const LEADS_EXTENDED_SELECT =
  'id, nombre, apellido, email, telefono, direccion, apartamento, ciudad, estado_region, codigo_postal, fecha_nacimiento, fuente, programa_id, embajador_id, referido_por_cliente_id, owner_id, vendedor_id, estado_pipeline, next_action, next_action_date, estado_civil, nombre_conyuge, telefono_conyuge, situacion_laboral, ninos_en_casa, cantidad_ninos, tiene_productos_rp, tipo_vivienda, created_at, updated_at, deleted_at, deleted_by, deleted_reason'

export const LEADS_SEARCH_BASE_SELECT = 'id, nombre, apellido, telefono, vendedor_id, owner_id'

export const LEADS_SEARCH_EXTENDED_SELECT =
  'id, nombre, apellido, telefono, direccion, ciudad, estado_region, codigo_postal, vendedor_id, owner_id'

const MISSING_LEADS_COLUMNS = ['direccion', 'apartamento', 'ciudad', 'estado_region', 'codigo_postal']

export function isMissingLeadAddressColumnError(message?: string | null) {
  if (!message) return false
  const lower = message.toLowerCase()
  return MISSING_LEADS_COLUMNS.some(
    (column) =>
      lower.includes(`column leads.${column} does not exist`) ||
      lower.includes(`column "${column}" does not exist`) ||
      lower.includes(`column leads."${column}" does not exist`) ||
      lower.includes(`"${column}" of relation "leads" does not exist`) ||
      lower.includes(`schema cache`) && lower.includes(column),
  )
}
