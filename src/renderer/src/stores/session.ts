import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type SessionState = {
  session: Session | null
  loading: boolean
}

export const useSession = create<SessionState>(() => ({ session: null, loading: true }))

let started = false

export function startSessionListener(): void {
  if (started) return
  started = true
  void supabase.auth.getSession().then(({ data }) => {
    useSession.setState({ session: data.session, loading: false })
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    useSession.setState({ session, loading: false })
  })
}

export function useUserId(): string {
  const id = useSession((s) => s.session?.user.id)
  if (!id) throw new Error('Oturum yok')
  return id
}
