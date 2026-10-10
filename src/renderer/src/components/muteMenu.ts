import { Bell, BellOff, Clock, Moon, Sunrise } from 'lucide-react'
import { formatMessageTime, type MuteSpan } from '@/lib/format'
import { useUi } from '@/stores/ui'
import type { MenuItem } from './Menu'

const SPANS: { span: MuteSpan; label: string; icon: MenuItem['icon'] }[] = [
  { span: 'saat', label: '1 saat', icon: Clock },
  { span: 'sekiz-saat', label: '8 saat', icon: Moon },
  { span: 'yarin', label: 'Yarın sabaha kadar', icon: Sunrise },
  { span: 'suresiz', label: 'Ben açana kadar', icon: BellOff },
]

// Süre seçenekleri (alt menü ya da tek başına bir menü olarak kullanılır).
export function muteSpanItems(id: string): MenuItem[] {
  return SPANS.map(({ span, label, icon }) => ({ label, icon, onClick: () => useUi.getState().mute(id, span) }))
}

// Sağ tık menüsü satırı: sessizdeyse "sesini aç", değilse süre seçenekleri açan "sessize al".
export function muteMenuItem(id: string, labels: { on: string; off: string }): MenuItem {
  const { muted, unmute } = useUi.getState()
  if (muted.includes(id)) return { label: labels.off, icon: Bell, onClick: () => unmute(id) }
  return { label: labels.on, icon: BellOff, items: muteSpanItems(id) }
}

// Sessize alma simgesinin ipucu: "Sessize alındı" ya da "Sessize alındı · Bugün 18:30'a kadar".
export function muteHint(until: number | undefined): string {
  return until ? `Sessize alındı · ${formatMessageTime(new Date(until).toISOString())}'a kadar` : 'Sessize alındı'
}
