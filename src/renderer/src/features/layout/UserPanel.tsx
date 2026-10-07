import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Avatar, StatusDot } from '@/components/Avatar'
import { IconButton } from '@/components/ui'
import { useProfile } from '@/data/queries'
import { useUi, type PresenceStatus } from '@/stores/ui'

const STATUS_OPTIONS: { value: PresenceStatus; label: string; hint: string; dot: 'online' | 'idle' | 'dnd' | 'offline' }[] = [
  { value: 'online', label: 'Çevrimiçi', hint: 'Herkes seni çevrimiçi görür', dot: 'online' },
  { value: 'idle', label: 'Boşta', hint: '10 dakika işlem yapmayınca otomatik', dot: 'idle' },
  { value: 'dnd', label: 'Rahatsız Etmeyin', hint: 'Bildirimler ve sesler kapanır', dot: 'dnd' },
  { value: 'invisible', label: 'Görünmez', hint: 'Çevrimdışı görünürsün ama her şeyi kullanırsın', dot: 'offline' },
]

export function UserPanel({ userId }: { userId: string }) {
  const profile = useProfile(userId)
  const status = useUi((s) => s.status)
  const setPrefs = useUi((s) => s.setPrefs)
  const openModal = useUi((s) => s.openModal)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!profile) return null
  const current = STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[0]

  return (
    <div className="relative flex h-14 items-center gap-2 border-t border-line bg-sidebar px-2">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left hover:bg-hover"
        title="Durumunu değiştir"
      >
        <Avatar name={profile.display_name} path={profile.avatar_path} userId={userId} size={34} showStatus />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-fg">{profile.display_name}</span>
          <span className="block truncate text-xs text-muted">{profile.custom_status || current.label}</span>
        </span>
      </button>
      <IconButton label="Ayarlar" onClick={() => openModal({ kind: 'settings' })}>
        <Settings className="size-[18px]" />
      </IconButton>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div className="absolute bottom-16 left-2 z-40 w-64 rounded-lg border border-line bg-elevated p-1.5 shadow-pop">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  setPrefs({ status: o.value })
                  setMenuOpen(false)
                }}
                className={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-hover ${
                  o.value === status ? 'bg-selected' : ''
                }`}
              >
                <span className="mt-1.5">
                  <StatusDot status={o.dot} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-fg">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
