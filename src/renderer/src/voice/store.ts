import { create } from 'zustand'

export type VoiceParticipant = { userId: string; muted: boolean; deafened: boolean }
export type VoiceStatus = 'idle' | 'connecting' | 'connected'
// kapali: işlem yok, standart: tarayıcının gürültü engellemesi, guclu: yapay zekâ (RNNoise).
export type NoiseMode = 'kapali' | 'standart' | 'guclu'
// ses: konuşunca açılır, bas-konus: tuşa basılı tutunca açılır.
export type InputMode = 'ses' | 'bas-konus'
export type PeerLink = { ping: number | null; relay: boolean }

type VoicePrefs = {
  inputDeviceId: string
  outputDeviceId: string
  noiseMode: NoiseMode
  echoCancellation: boolean
  // Giriş hassasiyeti: otomatikse eşik kullanılmaz; değilse bu dB değerinin altı iletilmez.
  autoGate: boolean
  gateDb: number
  inputMode: InputMode
  // Bas-konuş tuşu (KeyboardEvent.code).
  pttKey: string
  // Kişi başı ses seviyesi (0-1). Kayıt yoksa 1.
  volumes: Record<string, number>
}

type VoiceState = VoicePrefs & {
  status: VoiceStatus
  channelId: string | null
  serverId: string | null
  muted: boolean
  deafened: boolean
  // Bas-konuş tuşu basılı mı?
  pttDown: boolean
  // Benim kanalımda kim konuşuyor (yerelde ölçülür).
  speaking: Record<string, boolean>
  // Her ses kanalında kimler var (presence).
  rooms: Record<string, VoiceParticipant[]>
  // Kişi başı bağlantı durumu ve gecikme.
  peers: Record<string, RTCPeerConnectionState>
  links: Record<string, PeerLink>
  setPrefs: (prefs: Partial<VoicePrefs>) => void
}

const PREFS_KEY = 'turkcord-ses-tercihleri'
const PREF_KEYS = [
  'inputDeviceId',
  'outputDeviceId',
  'noiseMode',
  'echoCancellation',
  'autoGate',
  'gateDb',
  'inputMode',
  'pttKey',
  'volumes',
] as const satisfies readonly (keyof VoicePrefs)[]

const defaults: VoicePrefs = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  noiseMode: 'guclu',
  echoCancellation: true,
  autoGate: true,
  gateDb: -50,
  inputMode: 'ses',
  pttKey: 'Backquote',
  volumes: {},
}

function readPrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Partial<VoicePrefs> & { noiseSuppression?: boolean }
    // 0.3 ve öncesi: gürültü engelleme açık/kapalıydı.
    if (!saved.noiseMode && saved.noiseSuppression === false) saved.noiseMode = 'kapali'
    const prefs = { ...defaults }
    for (const key of PREF_KEYS) if (saved[key] !== undefined) Object.assign(prefs, { [key]: saved[key] })
    return prefs
  } catch {
    return defaults
  }
}

export const useVoice = create<VoiceState>((set, get) => ({
  ...readPrefs(),
  status: 'idle',
  channelId: null,
  serverId: null,
  muted: false,
  deafened: false,
  pttDown: false,
  speaking: {},
  rooms: {},
  peers: {},
  links: {},
  setPrefs: (prefs) => {
    set(prefs)
    const state = get()
    const saved = Object.fromEntries(PREF_KEYS.map((key) => [key, state[key]]))
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(saved))
    } catch {
      // Tercih bu oturumla sınırlı kalır.
    }
  },
}))

export function volumeOf(userId: string): number {
  return useVoice.getState().volumes[userId] ?? 1
}

// Mikrofon şu an ses iletiyor mu? (susturma, sağırlaştırma ve bas-konuş birlikte)
export function micOpen(state: Pick<VoiceState, 'muted' | 'deafened' | 'inputMode' | 'pttDown'>): boolean {
  if (state.muted || state.deafened) return false
  return state.inputMode !== 'bas-konus' || state.pttDown
}
