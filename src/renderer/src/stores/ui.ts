import { create } from 'zustand'

export type Theme = 'light' | 'dark'
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible'
export type FriendsTab = 'online' | 'all' | 'pending' | 'blocked' | 'add'

export type View =
  | { kind: 'home'; tab: FriendsTab }
  | { kind: 'dm'; channelId: string }
  | { kind: 'server'; serverId: string; channelId: string | null }

export type Modal =
  | { kind: 'create-server' }
  | { kind: 'invite'; serverId: string }
  | { kind: 'create-channel'; serverId: string }
  | { kind: 'channel-settings'; channelId: string }
  | { kind: 'server-settings'; serverId: string }
  | { kind: 'settings'; tab?: 'profile' | 'voice' | 'appearance' | 'notifications' | 'account' | 'admin' }
  | { kind: 'profile'; userId: string }
  | null

type Prefs = {
  theme: Theme
  status: PresenceStatus
  notifications: boolean
  sounds: boolean
  memberList: boolean
}

const PREFS_KEY = 'turkcord-tercihler'
const VIEW_KEY = 'turkcord-son-gorunum'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Depolama kullanılamıyorsa tercih sadece bu oturumda geçerli olur.
  }
}

const defaultPrefs: Prefs = { theme: 'light', status: 'online', notifications: true, sounds: true, memberList: true }

type UiState = Prefs & {
  view: View
  modal: Modal
  setView: (view: View) => void
  openModal: (modal: Modal) => void
  closeModal: () => void
  setPrefs: (prefs: Partial<Prefs>) => void
}

export const useUi = create<UiState>((set, get) => ({
  ...readJson<Prefs>(PREFS_KEY, defaultPrefs),
  view: readJson<{ view: View }>(VIEW_KEY, { view: { kind: 'home', tab: 'online' } }).view,
  modal: null,
  setView: (view) => {
    set({ view })
    writeJson(VIEW_KEY, { view })
  },
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setPrefs: (prefs) => {
    set(prefs)
    const { theme, status, notifications, sounds, memberList } = { ...get(), ...prefs }
    writeJson(PREFS_KEY, { theme, status, notifications, sounds, memberList })
    if (prefs.theme) applyTheme(prefs.theme)
  },
}))

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}
