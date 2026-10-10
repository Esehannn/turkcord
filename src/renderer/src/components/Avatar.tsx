import { publicImageUrl } from '@/lib/supabase'
import { initials } from '@/lib/format'
import { useStatus } from '@/stores/presence'

// İsimden sabit bir renk seçilir; avatarı olmayanlar ayırt edilebilsin.
const COLORS = ['#e30a17', '#b3121d', '#d9480f', '#2b8a3e', '#1971c2', '#6741d9', '#c2255c', '#0c8599', '#5c940d']

export function colorFor(seed: string): string {
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

const STATUS_COLOR = {
  online: 'bg-online',
  idle: 'bg-idle',
  dnd: 'bg-dnd',
  offline: 'bg-offline',
} as const

export const STATUS_LABEL = {
  online: 'Çevrimiçi',
  idle: 'Boşta',
  dnd: 'Rahatsız Etmeyin',
  offline: 'Çevrimdışı',
} as const

type AvatarProps = {
  name: string
  path?: string | null
  size?: number
  userId?: string | null
  showStatus?: boolean
  ringClass?: string
}

export function Avatar({ name, path, size = 40, userId, showStatus = false, ringClass = 'ring-sidebar' }: AvatarProps) {
  const url = publicImageUrl(path)
  const status = useStatus(showStatus ? userId : null)
  const dot = Math.max(10, Math.round(size * 0.32))
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className="size-full rounded-full object-cover" draggable={false} />
      ) : (
        <span
          className="grid size-full place-items-center rounded-full font-semibold text-white"
          style={{ background: colorFor(name), fontSize: Math.max(10, size * 0.38) }}
        >
          {initials(name)}
        </span>
      )}
      {showStatus && (
        <span
          data-tip={STATUS_LABEL[status]}
          className={`absolute right-0 bottom-0 rounded-full ring-[3px] ${ringClass} ${STATUS_COLOR[status]}`}
          style={{ width: dot, height: dot }}
        />
      )}
    </span>
  )
}

export function StatusDot({ status }: { status: keyof typeof STATUS_COLOR }) {
  return <span className={`inline-block size-2.5 rounded-full ${STATUS_COLOR[status]}`} />
}
