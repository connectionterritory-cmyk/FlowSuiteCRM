type ContactScopeOptions = {
  role: string | null
  viewMode?: string | null
  sessionUserId?: string | null
  hasDistribuidorScope?: boolean
  distributionUserIds?: string[]
  includeOwner?: boolean
}

export function applyContactScope<T>(query: T, options: ContactScopeOptions): T {
  const { role, viewMode, sessionUserId, hasDistribuidorScope, distributionUserIds, includeOwner } = options
  const isSellerView = role === 'distribuidor' && viewMode === 'seller'
  const isVendedorScope =
    !!role && role !== 'admin' && role !== 'distribuidor' && role !== 'supervisor_telemercadeo' && role !== 'telemercadeo'

  if (sessionUserId && (isVendedorScope || isSellerView)) {
    if (includeOwner && typeof (query as any).or === 'function') {
      return (query as any).or(`vendedor_id.eq.${sessionUserId},owner_id.eq.${sessionUserId}`)
    }
    if (typeof (query as any).eq === 'function') {
      return (query as any).eq('vendedor_id', sessionUserId)
    }
    return query
  }

  if (hasDistribuidorScope && distributionUserIds && distributionUserIds.length > 0 && role !== 'supervisor_telemercadeo') {
    if (typeof (query as any).in === 'function') {
      return (query as any).in('vendedor_id', distributionUserIds)
    }
  }

  return query
}
