import { useUi } from '@/stores/ui'

// Masaüstü bildirimi, kısa bir "dıt" sesi, görev çubuğunda yanıp sönme ve okunmamış rozeti.

let audio: AudioContext | null = null

export function playPing(): void {
  if (!useUi.getState().sounds) return
  try {
    audio ??= new AudioContext()
    const now = audio.currentTime
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.09
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18)
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(start + 0.2)
    }
  } catch {
    // Ses çalınamazsa sessizce geç.
  }
}

export function showNotification(title: string, body: string, onClick?: () => void): void {
  const { notifications, status } = useUi.getState()
  window.turkcord?.flashWindow()
  if (status === 'dnd') return
  playPing()
  if (!notifications || !('Notification' in window) || Notification.permission === 'denied') return
  try {
    const n = new Notification(title, { body: body.slice(0, 160), silent: true })
    n.onclick = () => {
      window.focus()
      onClick?.()
    }
  } catch {
    // Bildirim gösterilemezse görmezden gel.
  }
}

let lastBadge = -1

export function setUnreadBadge(count: number): void {
  if (!window.turkcord || count === lastBadge) return
  lastBadge = count
  if (count <= 0) {
    window.turkcord.setBadge(0, null)
    return
  }
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#e30a17'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${count > 9 ? 16 : 20}px "Inter Variable", "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(count > 9 ? '9+' : String(count), size / 2, size / 2 + 1)
  window.turkcord.setBadge(count, canvas.toDataURL('image/png'))
}
