import { create } from 'zustand'
import { useUi } from '@/stores/ui'
import { playSound, type NotifySound } from './sounds'

// Bildirimler: ses, uygulama içi bildirim kartı (pencere öndeyken), masaüstü bildirimi (pencere
// arkadayken), görev çubuğunda yanıp sönme ve okunmamış rozeti.

export type Banner = {
  id: number
  title: string
  body: string
  // Kartta gösterilecek kişi (avatar için).
  avatar?: { name: string; path?: string | null }
  onClick?: () => void
}

type BannerState = { banners: Banner[]; dismiss: (id: number) => void }

export const useBanners = create<BannerState>((set, get) => ({
  banners: [],
  dismiss: (id) => set({ banners: get().banners.filter((b) => b.id !== id) }),
}))

const BANNER_MS = 6000
let nextBanner = 1

function pushBanner(banner: Omit<Banner, 'id'>): void {
  const id = nextBanner++
  useBanners.setState((s) => ({ banners: [...s.banners.slice(-2), { ...banner, id }] }))
  setTimeout(() => useBanners.getState().dismiss(id), BANNER_MS)
}

export type NotifyOptions = {
  title: string
  body: string
  // Çalınacak ses; null verilirse ses çalınmaz (ör. arama melodisi ayrıca çalıyorsa).
  sound?: NotifySound | null
  // Pencere öndeyken uygulama içi kart gösterilsin mi? (varsayılan: evet)
  banner?: boolean
  avatar?: Banner['avatar']
  onClick?: () => void
}

export function showNotification({ title, body, sound = 'message', banner = true, avatar, onClick }: NotifyOptions): void {
  const { notifications, banners, status } = useUi.getState()
  window.turkcord?.flashWindow()
  if (status === 'dnd') return
  if (sound) playSound(sound)

  const text = body.slice(0, 160)
  if (document.hasFocus()) {
    if (banner && banners) pushBanner({ title, body: text, avatar, onClick })
    return
  }
  if (!notifications || !('Notification' in window) || Notification.permission === 'denied') return
  try {
    const n = new Notification(title, { body: text, silent: true })
    n.onclick = () => {
      window.turkcord?.showWindow?.()
      window.focus()
      onClick?.()
    }
  } catch {
    // Bildirim gösterilemezse görmezden gel.
  }
}

let lastBadge = -1

export function setUnreadBadge(count: number): void {
  if (count === lastBadge) return
  lastBadge = count
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) Turkcord` : 'Turkcord'
  if (!window.turkcord) return
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
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--tc-accent').trim() || '#e30a17'
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
