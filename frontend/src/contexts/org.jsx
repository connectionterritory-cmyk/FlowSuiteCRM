import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from './auth'

const OrgContext = createContext({
  orgId: null,
  orgName: null,
  role: null,
  branding: null,
  loading: true,
  error: null,
})

export function OrgProvider({ children }) {
  const { user } = useAuth()
  const [orgId, setOrgId] = useState(null)
  const [orgName, setOrgName] = useState(null)
  const [role, setRole] = useState(null)
  const [branding, setBranding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const loadMemberships = async () => {
      if (!supabase || !user) {
        setLoading(false)
        return
      }

      setLoading(true)
      const { data, error: membershipsError } = await supabase
        .from('memberships')
        .select('org_id, role, organizations(name)')
        .eq('user_id', user.id)

      if (membershipsError) {
        setError(membershipsError.message)
        setLoading(false)
        return
      }

      const primary = data?.[0]
      setOrgId(primary?.org_id ?? null)
      setRole(primary?.role ?? null)
      setOrgName(primary?.organizations?.name ?? 'FlowSuiteCRM')

      if (primary?.org_id) {
        const { data: brandingData, error: brandingError } = await supabase
          .from('org_branding')
          .select('logo_url, org_name, primary_color, secondary_color')
          .eq('org_id', primary.org_id)
          .maybeSingle()

        if (brandingError) {
          setBranding(null)
        } else {
          setBranding(brandingData)
          if (brandingData?.org_name) {
            setOrgName(brandingData.org_name)
          }
        }
      }

      setLoading(false)
    }

    loadMemberships()
  }, [user])

  const value = useMemo(() => {
    return {
      orgId,
      orgName,
      role,
      branding,
      loading,
      error,
    }
  }, [orgId, orgName, role, branding, loading, error])

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg() {
  return useContext(OrgContext)
}
