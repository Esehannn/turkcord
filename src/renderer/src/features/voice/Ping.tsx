import { WifiOff } from 'lucide-react'
import type { PeerLink, PeerState } from '@/voice/store'

// Gecikme rengi: 80 ms altı iyi, 150 ms altı idare eder, üstü kötü.
export function pingClass(ping: number): string {
  return ping < 80 ? 'text-online' : ping < 150 ? 'text-idle' : 'text-accent'
}

function transportLabel(transport: string | null): string | null {
  if (!transport) return null
  if (transport.startsWith('aktarma')) return 'aktarma sunucusu üzerinden'
  return `doğrudan (${transport.toUpperCase()})`
}

export function linkTitle(link: PeerLink | null): string {
  if (!link) return 'Cloudflare ses sunucusuna bağlanılıyor'
  const parts = ['Cloudflare ses sunucusu', link.ping !== null ? `${link.ping} ms` : null, transportLabel(link.transport)]
  return parts.filter(Boolean).join(' · ')
}

// Bağlantı kalitesi: üç çubuk, gecikmeye göre dolar ve renklenir.
export function SignalBars({ ping, className = '' }: { ping: number | null; className?: string }) {
  const level = ping === null ? 0 : ping < 80 ? 3 : ping < 150 ? 2 : 1
  return (
    <svg viewBox="0 0 16 16" className={`size-4 shrink-0 ${className}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 5}
          y={10 - i * 3.5}
          width={3.5}
          height={4.5 + i * 3.5}
          rx={1}
          fill="currentColor"
          className="transition-opacity duration-300"
          opacity={i < level ? 1 : 0.25}
        />
      ))}
    </svg>
  )
}

// Cloudflare'e olan gecikmem (odadaki herkesin sesi aynı yoldan geçer).
export function PingBadge({ link }: { link: PeerLink | null }) {
  if (!link || link.ping === null) return null
  return (
    <span className={`flex shrink-0 items-center gap-1 text-[11px] font-medium tabular-nums ${pingClass(link.ping)}`} data-tip={linkTitle(link)}>
      <SignalBars ping={link.ping} className="size-3" />
      {link.ping} ms
    </span>
  )
}

// Bir kişinin sesi gelmiyorsa (uygulama yeniden çekiyor) küçük bir uyarı.
export function PeerBadge({ state }: { state: PeerState | undefined }) {
  if (state !== 'lost') return null
  return (
    <span className="anim-fade flex shrink-0 items-center text-accent" data-tip="Sesi gelmiyor; yeniden bağlanılıyor">
      <WifiOff className="size-3.5" aria-label="Sesi gelmiyor" />
    </span>
  )
}
