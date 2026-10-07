import { create } from 'zustand'
import { blocksTyping } from '@/lib/keys'
import { setDeafened, setMuted, setPushToTalk } from '@/voice/engine'
import { useVoice } from '@/voice/store'

// Her yerde (oyun içinde de) çalışan kısayollar ve masaüstü köprüsü.

type Shortcuts = { mute: string | null; deafen: string | null }
type ShortcutState = Shortcuts & {
  // Windows'ta başka bir uygulama aynı kısayolu aldıysa kaydedilemez.
  failed: { mute: boolean; deafen: boolean }
  set: (patch: Partial<Shortcuts>) => void
}

const KEY = 'turkcord-kisayollar'
const defaults: Shortcuts = { mute: 'Ctrl+Shift+M', deafen: 'Ctrl+Shift+D' }

function read(): Shortcuts {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Shortcuts>
    return { mute: saved.mute !== undefined ? saved.mute : defaults.mute, deafen: saved.deafen !== undefined ? saved.deafen : defaults.deafen }
  } catch {
    return defaults
  }
}

export const useShortcuts = create<ShortcutState>((set, get) => ({
  ...read(),
  failed: { mute: false, deafen: false },
  set: (patch) => {
    set(patch)
    const { mute, deafen } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ mute, deafen }))
    } catch {
      // Bu oturumla sınırlı kalır.
    }
    void syncShortcuts()
  },
}))

async function syncShortcuts(): Promise<void> {
  const bridge = window.turkcord
  if (!bridge?.setShortcuts) return
  const { mute, deafen } = useShortcuts.getState()
  const result = await bridge.setShortcuts({ mute, deafen })
  if (result) useShortcuts.setState({ failed: { mute: !result.mute, deafen: !result.deafen } })
}

// KeyboardEvent → Electron kısayol metni ("Ctrl+Shift+M"). Geçersizse null.
export function acceleratorFrom(e: KeyboardEvent): string | null {
  let key: string | null = null
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code
  else if (/^Numpad\d$/.test(e.code)) key = `Num${e.code.slice(6)}`
  if (!key) return null
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean)
  // Tek harf her yazıda tetiklenir; F tuşları dışında en az bir değiştirici tuş gerekir.
  if (mods.length === 0 && !key.startsWith('F')) return null
  return [...mods, key].join('+')
}

// Uygulama açıkken bir kez çağrılır; kapatma fonksiyonu döner.
export function startDesktopBridge(): () => void {
  const bridge = window.turkcord
  const cleanups: (() => void)[] = []

  void syncShortcuts()
  if (bridge?.onShortcut) {
    cleanups.push(
      bridge.onShortcut((command) => {
        const { muted, deafened } = useVoice.getState()
        if (command === 'mute') setMuted(!muted)
        else setDeafened(!deafened)
      }),
    )
  }

  // Tepsi menüsü ve simge ipucu için ses durumunu ana sürece bildir.
  if (bridge?.reportVoiceStatus) {
    const report = () => {
      const { status, muted, deafened } = useVoice.getState()
      bridge.reportVoiceStatus({ inVoice: status !== 'idle', muted, deafened })
    }
    report()
    cleanups.push(
      useVoice.subscribe((s, prev) => {
        if (s.status !== prev.status || s.muted !== prev.muted || s.deafened !== prev.deafened) report()
      }),
    )
  }

  // Bas-konuş (pencere öndeyken).
  const down = (e: KeyboardEvent) => {
    const { inputMode, pttKey } = useVoice.getState()
    if (inputMode !== 'bas-konus' || e.code !== pttKey || blocksTyping(e.code, e.target)) return
    setPushToTalk(true)
  }
  const up = (e: KeyboardEvent) => {
    if (e.code === useVoice.getState().pttKey) setPushToTalk(false)
  }
  const release = () => setPushToTalk(false)
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', release)
  cleanups.push(() => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', release)
  })

  return () => cleanups.forEach((fn) => fn())
}
