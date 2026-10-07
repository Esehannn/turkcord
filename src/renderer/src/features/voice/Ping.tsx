import type { PeerLink } from '@/voice/store'

// Gecikme rengi: 80 ms altı iyi, 150 ms altı idare eder, üstü kötü.
export function pingClass(ping: number): string {
  return ping < 80 ? 'text-online' : ping < 150 ? 'text-idle' : 'text-accent'
}

export function linkTitle(link: PeerLink): string {
  const via = link.relay ? 'Cloudflare aktarma sunucusu üzerinden' : 'Doğrudan bağlantı'
  return link.ping !== null ? `${via}, gecikme ${link.ping} ms` : via
}

// Bir kişiyle aramdaki gecikme.
export function PingBadge({ link }: { link: PeerLink | undefined }) {
  if (!link || link.ping === null) return null
  return (
    <span className={`shrink-0 text-[11px] font-medium tabular-nums ${pingClass(link.ping)}`} title={linkTitle(link)}>
      {link.ping} ms
    </span>
  )
}
