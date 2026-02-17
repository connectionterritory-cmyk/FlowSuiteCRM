import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext({
  session: null,
  user: null,
  loading: true,
  error: null,
  signIn: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!supabase) {
      setError('Faltan variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo(() => {
    return {
      session,
      user: session?.user ?? null,
      loading,
      error,
      signIn: async (email, password) => {
        if (!supabase) return { error: 'Supabase no configurado' }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        return { error: signInError?.message ?? null }
      },
      signOut: async () => {
        if (!supabase) return
        await supabase.auth.signOut()
      },
    }
  }, [session, loading, error])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
