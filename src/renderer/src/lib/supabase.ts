import { createClient, type SupportedStorage } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && publishableKey)

// "Beni hatırla" açıkken oturum kalıcı depoda tutulur: Electron'da işletim sisteminin şifrelemesiyle korunan
// dosya (bkz. src/main/authStorage.ts), tarayıcıda geliştirirken localStorage. Kapalıyken sadece bellekte
// tutulur; uygulama kapanınca oturum da kapanır.
const REMEMBER_KEY = 'turkcord-beni-hatirla'

export function getRememberMe(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'hayir'
  } catch {
    return true
  }
}

export function setRememberMe(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? 'evet' : 'hayir')
  } catch {
    // Tercih kaydedilemezse varsayılan (hatırla) geçerli olur.
  }
}

const browserStorage: SupportedStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
}
const persistent: SupportedStorage = window.turkcord?.authStorage ?? browserStorage
const memory = new Map<string, string>()

const storage: SupportedStorage = {
  getItem: (key) => (getRememberMe() ? persistent.getItem(key) : (memory.get(key) ?? null)),
  setItem: async (key, value) => {
    if (getRememberMe()) {
      await persistent.setItem(key, value)
    } else {
      memory.set(key, value)
      await persistent.removeItem(key)
    }
  },
  removeItem: async (key) => {
    memory.delete(key)
    await persistent.removeItem(key)
  },
}

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
