import { create } from 'zustand'
import type { MessageRow } from '@/lib/database.types'
import { muteDeadline, type MuteSpan } from '@/lib/format'
import type { Ringtone } from '@/lib/sounds'

export type Theme = 'light' | 'dark'
// Koyu temanın tonu: klasik (gri), gece (lacivertimsi), siyah (tam siyah).
export const DARK_TONES = [
  { id: 'klasik', label: 'Koyu', rail: '#121214', sidebar: '#1b1b1f', chat: '#232328' },
  { id: 'gece', label: 'Gece', rail: '#0c1120', sidebar: '#131a2b', chat: '#192135' },
  { id: 'siyah', label: 'Tam siyah', rail: '#000000', sidebar: '#0b0b0c', chat: '#000000' },
] as const
export type DarkTone = (typeof DARK_TONES)[number]['id']
export type ChatFont = 'small' | 'normal' | 'large'

// Vurgu rengi: düğmeler, seçili öğeler ve (açık temada) sol şerit ile başlık çubuğu bu renkte olur.
export const ACCENTS = [
  { id: 'kirmizi', label: 'Kırmızı', color: '#e30a17' },
  { id: 'turuncu', label: 'Turuncu', color: '#d9540b' },
  { id: 'yesil', label: 'Yeşil', color: '#1f8a4c' },
  { id: 'turkuaz', label: 'Turkuaz', color: '#0e8f9e' },
  { id: 'lacivert', label: 'Lacivert', color: '#2456c9' },
  { id: 'mor', label: 'Mor', color: '#7a3fd1' },
] as const
export type Accent = (typeof ACCENTS)[number]['id']
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible'
export type FriendsTab = 'online' | 'all' | 'pending' | 'blocked' | 'add'

export type View =
  | { kind: 'home'; tab: FriendsTab }
  | { kind: 'dm'; channelId: string }
  // voiceId: ortada sohbet yerine bu ses kanalının odası gösterilir.
  | { kind: 'server'; serverId: string; channelId: string | null; voiceId?: string | null }

export type Modal =
  | { kind: 'create-server' }
  | { kind: 'invite'; serverId: string }
  | { kind: 'create-channel'; serverId: string }
  | { kind: 'channel-settings'; channelId: string }
  | { kind: 'server-settings'; serverId: string }
  | { kind: 'settings'; tab?: 'profile' | 'voice' | 'appearance' | 'notifications' | 'account' | 'admin' }
  | { kind: 'profile'; userId: string }
  | { kind: 'forward'; message: Pick<MessageRow, 'id' | 'content' | 'attachments'> }
  | { kind: 'create-poll'; channelId: string }
  | { kind: 'quick-switch' }
  | null

// Bir mesaja atlama isteği (arama sonucu, sabitlenmiş mesaj); ilgili sohbet bunu görünce mesajı bulup gösterir.
export type Jump = { channelId: string; messageId: string; createdAt: string }

type Prefs = {
  theme: Theme
  darkTone: DarkTone
  status: PresenceStatus
  notifications: boolean
  sounds: boolean
  memberList: boolean
  // Bildirim ve efekt seslerinin seviyesi (0-1).
  volume: number
  // Uygulama açıkken sağ üstte beliren bildirim kartları.
  banners: boolean
  // Sunucu kanallarındaki her mesajda (etiket olmasa da) bildir.
  notifyAll: boolean
  // Ses kanalındaki ses efektlerini duy.
  effects: boolean
  ringtone: Ringtone
  accent: Accent
  // Sohbetteki yazı boyutu.
  chatFont: ChatFont
  // Sıkışık görünüm: mesaj grupları arasındaki boşluk azalır.
  compact: boolean
  // Sessize alınan kanal, özel mesaj ve sunucuların kimlikleri.
  muted: string[]
  // Süreli sessize alınanların biteceği an (ms). Burada kaydı olmayan sessize alma süresizdir.
  mutedUntil: Record<string, number>
  // Bir arkadaş ses kanalına girince bildir.
  voiceJoins: boolean
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

const defaultPrefs: Prefs = {
  theme: 'light',
  darkTone: 'klasik',
  status: 'online',
  notifications: true,
  sounds: true,
  memberList: true,
  volume: 0.8,
  banners: true,
  notifyAll: false,
  effects: true,
  ringtone: 'mehter',
  accent: 'kirmizi',
  chatFont: 'normal',
  compact: false,
  muted: [],
  mutedUntil: {},
  voiceJoins: true,
}
const PREF_KEYS = Object.keys(defaultPrefs) as (keyof Prefs)[]

type UiState = Prefs & {
  view: View
  modal: Modal
  jump: Jump | null
  setJump: (jump: Jump | null) => void
  mute: (id: string, span: MuteSpan) => void
  unmute: (id: string) => void
  setView: (view: View) => void
  openModal: (modal: Modal) => void
  closeModal: () => void
  setPrefs: (prefs: Partial<Prefs>) => void
}

export const useUi = create<UiState>((set, get) => ({
  ...readJson<Prefs>(PREFS_KEY, defaultPrefs),
  view: readJson<{ view: View }>(VIEW_KEY, { view: { kind: 'home', tab: 'online' } }).view,
  modal: null,
  jump: null,
  setJump: (jump) => set({ jump }),
  mute: (id, span) => {
    const { muted, mutedUntil } = get()
    const until = { ...mutedUntil }
    const deadline = muteDeadline(span)
    if (deadline) until[id] = deadline
    else delete until[id]
    get().setPrefs({ muted: muted.includes(id) ? muted : [...muted, id], mutedUntil: until })
    scheduleMuteExpiry()
  },
  unmute: (id) => {
    const { muted, mutedUntil } = get()
    const until = { ...mutedUntil }
    delete until[id]
    get().setPrefs({ muted: muted.filter((m) => m !== id), mutedUntil: until })
  },
  setView: (view) => {
    set({ view })
    writeJson(VIEW_KEY, { view })
  },
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setPrefs: (prefs) => {
    set(prefs)
    const state = get()
    writeJson(PREFS_KEY, Object.fromEntries(PREF_KEYS.map((key) => [key, state[key]])))
    if (prefs.theme || prefs.darkTone || prefs.accent || prefs.chatFont || prefs.compact !== undefined) applyAppearance()
  },
}))

// Süresi dolan sessize almaları kaldırır ve bir sonraki bitiş anı için tek bir zamanlayıcı kurar.
let muteTimer: ReturnType<typeof setTimeout> | undefined
export function scheduleMuteExpiry(): void {
  clearTimeout(muteTimer)
  const { muted, mutedUntil, setPrefs } = useUi.getState()
  const now = Date.now()
  const expired = Object.keys(mutedUntil).filter((id) => mutedUntil[id] <= now)
  if (expired.length) {
    setPrefs({
      muted: muted.filter((id) => !expired.includes(id)),
      mutedUntil: Object.fromEntries(Object.entries(mutedUntil).filter(([id]) => !expired.includes(id))),
    })
  }
  const next = Math.min(...Object.values(useUi.getState().mutedUntil))
  // setTimeout en fazla ~24 gün bekleyebilir; daha uzun süreler yeniden kurulur.
  if (Number.isFinite(next)) muteTimer = setTimeout(scheduleMuteExpiry, Math.min(next - now + 500, 2 ** 31 - 1))
}

// Bu kanal (ya da bulunduğu sunucu) sessize alınmış mı?
export function isMuted(muted: string[], channelId: string, serverId?: string | null): boolean {
  return muted.includes(channelId) || (!!serverId && muted.includes(serverId))
}

// Tema, vurgu rengi ve yazı boyutunu sayfaya (ve başlık çubuğundaki Windows düğmelerine) uygular.
export function applyAppearance(): void {
  const { theme, darkTone, accent, chatFont, compact } = useUi.getState()
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.tone = darkTone
  root.dataset.accent = accent
  root.dataset.chatFont = chatFont
  root.dataset.density = compact ? 'compact' : 'normal'
  // Başlık çubuğundaki Windows düğmelerinin zemini: açık temada vurgu rengi, koyu temada sol şeridin rengi.
  const bar = theme === 'dark' ? DARK_TONES.find((t) => t.id === darkTone)?.rail : ACCENTS.find((a) => a.id === accent)?.color
  window.turkcord?.setTheme?.(theme, bar)
}
