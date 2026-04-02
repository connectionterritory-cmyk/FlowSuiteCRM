import { useEffect, useState } from 'react'
import { isMissingLeadAddressColumnError, LEADS_SEARCH_BASE_SELECT, LEADS_SEARCH_EXTENDED_SELECT } from '../lib/leadsSchema'
import { supabase } from '../lib/supabase/client'
import { applyContactScope } from '../lib/contactSearch'

type LeadSearchOptions = {
  enabled?: boolean
  minLength?: number
  limit?: number
  debounceMs?: number
  role: string | null
  viewMode?: string | null
  sessionUserId?: string | null
  hasDistribuidorScope?: boolean
  distributionUserIds?: string[]
}

export type LeadSearchRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  direccion?: string | null
  apartamento?: string | null
  ciudad?: string | null
  estado_region?: string | null
  codigo_postal?: string | null
}

export function useLeadSearch(term: string, options: LeadSearchOptions) {
  const [results, setResults] = useState<LeadSearchRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const {
      enabled = true,
      minLength = 2,
      limit = 10,
      debounceMs = 300,
      role,
      viewMode,
      sessionUserId,
      hasDistribuidorScope,
      distributionUserIds,
    } = options
    const trimmed = term.trim()

    if (!enabled || trimmed.length < minLength) {
      const timeoutId = window.setTimeout(() => {
        setResults([])
        setLoading(false)
      }, 0)
      return () => window.clearTimeout(timeoutId)
    }

    let active = true
    const handle = window.setTimeout(async () => {
      setLoading(true)
      const searchValue = `%${trimmed}%`
      const buildLeadSearchQuery = (selectClause: string) => {
        let query = supabase
          .from('leads')
          .select(selectClause)
          .is('deleted_at', null)
          .or(`nombre.ilike.${searchValue},apellido.ilike.${searchValue},telefono.ilike.${searchValue}`)
          .limit(limit)
        query = applyContactScope(query, {
          role,
          viewMode,
          sessionUserId,
          hasDistribuidorScope,
          distributionUserIds,
          includeOwner: true,
        })
        return query
      }

      let { data, error } = await buildLeadSearchQuery(LEADS_SEARCH_EXTENDED_SELECT)
      if (error && isMissingLeadAddressColumnError(error.message)) {
        ;({ data, error } = await buildLeadSearchQuery(LEADS_SEARCH_BASE_SELECT))
      }
      if (!active) return
      if (error) {
        setResults([])
      } else {
        setResults(((data as LeadSearchRow[] | null) ?? []).slice(0, limit))
      }
      setLoading(false)
    }, debounceMs)

    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [
    term,
    options.enabled,
    options.minLength,
    options.limit,
    options.debounceMs,
    options.role,
    options.viewMode,
    options.sessionUserId,
    options.hasDistribuidorScope,
    options.distributionUserIds,
  ])

  return { results, loading }
}
