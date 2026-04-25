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
  const scopedIds = Array.from(new Set([
    ...(distributionUserIds ?? []),
    ...(sessionUserId ? [sessionUserId] : []),
  ]))

  if (sessionUserId && (isVendedorScope || isSellerView)) {
    if (includeOwner && typeof (query as any).or === 'function') {
      return (query as any).or(`vendedor_id.eq.${sessionUserId},owner_id.eq.${sessionUserId}`)
    }
    if (typeof (query as any).eq === 'function') {
      return (query as any).eq('vendedor_id', sessionUserId)
    }
    return query
  }

  if (hasDistribuidorScope && scopedIds.length > 0 && role !== 'supervisor_telemercadeo') {
    if (includeOwner && typeof (query as any).or === 'function') {
      const ids = scopedIds.join(',')
      return (query as any).or(`vendedor_id.in.(${ids}),owner_id.in.(${ids})`)
    }
    if (typeof (query as any).in === 'function') {
      return (query as any).in('vendedor_id', scopedIds)
    }
  }

  return query
}
