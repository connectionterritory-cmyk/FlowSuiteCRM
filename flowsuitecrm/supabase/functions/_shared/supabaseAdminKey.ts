export function getSupabaseAdminKey(): string {
  const secretKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacyKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    Deno.env.get('SERVICE_ROLE_KEY')

  let supabaseAdminKey: unknown = legacyKey

  if (secretKeysJson !== undefined) {
    let secretKeys: unknown
    try {
      secretKeys = JSON.parse(secretKeysJson)
    } catch {
      throw new Error('SUPABASE_SECRET_KEYS debe contener JSON válido')
    }

    if (
      !secretKeys ||
      typeof secretKeys !== 'object' ||
      Array.isArray(secretKeys) ||
      !Object.prototype.hasOwnProperty.call(secretKeys, 'default')
    ) {
      throw new Error('Falta default en SUPABASE_SECRET_KEYS')
    }

    supabaseAdminKey = (secretKeys as Record<string, unknown>).default
  }

  if (typeof supabaseAdminKey !== 'string' || !supabaseAdminKey.trim()) {
    throw new Error('Falta una clave administrativa de Supabase')
  }

  return supabaseAdminKey
}
