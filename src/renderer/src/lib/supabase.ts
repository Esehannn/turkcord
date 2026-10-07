import { createClient, type SupportedStorage } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && publishableKey)

// Electron'da oturum, işletim sisteminin şifrelemesiyle korunan dosyada tutulur (bkz. src/main/authStorage.ts).
// Tarayıcıda geliştirme yaparken localStorage'a düşer.
const storage: SupportedStorage | undefined = window.turkcord?.authStorage

export const supabase = createClient<Database>(url ?? 'http://localhost', publishableKey ?? 'missing-key', {
  auth: {
    storage,
    storageKey: 'turkcord-oturum',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

export const SUPABASE_URL = url ?? ''

export function publicImageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from('gorseller').getPublicUrl(path).data.publicUrl
}
