import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthValue {
  session: Session | null
  userId: string | null
  name: string
  loading: boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthValue>({
  session: null, userId: null, name: '', loading: true, signOut: async () => {}
})

export function AuthProvider ({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthValue>(() => ({
    session,
    userId: session?.user.id ?? null,
    name:
      (session?.user.user_metadata?.name as string | undefined) ||
      session?.user.email?.split('@')[0] ||
      '',
    loading,
    signOut: async () => { await supabase.auth.signOut() }
  }), [session, loading])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
