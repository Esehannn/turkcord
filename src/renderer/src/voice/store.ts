import { create } from 'zustand'

export type VoiceParticipant = { userId: string; muted: boolean; deafened: boolean }
export type VoiceStatus = 'idle' | 'connecting' | 'connected'

type VoicePrefs = {
  inputDeviceId: string
  outputDeviceId: string
  noiseSuppression: boolean
  echoCancellation: boolean
  // Kişi başı ses seviyesi (0-1). Kayıt yoksa 1.
  volumes: Record<string, number>
}

type VoiceState = VoicePrefs & {
  status: VoiceStatus
  channelId: string | null
  serverId: string | null
  muted: boolean
  deafened: boolean
  // Benim kanalımda kim konuşuyor (yerelde ölçülür).
  speaking: Record<string, boolean>
  // Her ses kanalında kimler var (presence).
  rooms: Record<string, VoiceParticipant[]>
  // Kişi başı bağlantı durumu.
  peers: Record<string, RTCPeerConnectionState>
  setPrefs: (prefs: Partial<VoicePrefs>) => void
}

const PREFS_KEY = 'turkcord-ses-tercihleri'

const defaults: VoicePrefs = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  noiseSuppression: true,
  echoCancellation: true,
  volumes: {},
}

function readPrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<VoicePrefs>) } : defaults
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
  speaking: {},
  rooms: {},
  peers: {},
  setPrefs: (prefs) => {
    set(prefs)
    const { inputDeviceId, outputDeviceId, noiseSuppression, echoCancellation, volumes } = { ...get(), ...prefs }
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ inputDeviceId, outputDeviceId, noiseSuppression, echoCancellation, volumes }),
      )
    } catch {
      // Tercih bu oturumla sınırlı kalır.
    }
  },
}))

export function volumeOf(userId: string): number {
  return useVoice.getState().volumes[userId] ?? 1
}
