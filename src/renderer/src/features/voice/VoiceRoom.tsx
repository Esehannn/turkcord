import { useEffect, useState } from 'react'
import { HeadphoneOff, MicOff } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Floating } from '@/components/Menu'
import { useProfiles } from '@/data/queries'
import { useUi } from '@/stores/ui'
import { setUserVolume } from '@/voice/engine'
import { watchVoiceRoom } from '@/voice/presence'
import { useVoice } from '@/voice/store'
import { PingBadge } from './Ping'

// Ses kanalının altında o an kanalda olanlar. Konuşanın avatarı yeşil çerçeveyle parlar.
export function VoiceRoom({ channelId, me }: { channelId: string; me: string }) {
  const participants = useVoice((s) => s.rooms[channelId])
  const speaking = useVoice((s) => s.speaking)
  const myChannel = useVoice((s) => s.channelId)
  const peers = useVoice((s) => s.peers)
  const links = useVoice((s) => s.links)
  const { data: profiles } = useProfiles()
  const [menu, setMenu] = useState<{ userId: string; x: number; y: number } | null>(null)

  useEffect(() => watchVoiceRoom(channelId, me), [channelId, me])

  if (!participants?.length) return null
  const inThisRoom = myChannel === channelId

  return (
    <ul className="mt-0.5 mb-1 ml-6 space-y-0.5">
      {participants.map((p) => {
        const profile = profiles?.get(p.userId)
        const name = profile?.display_name ?? 'Biri'
        const talking = inThisRoom && !!speaking[p.userId] && !p.muted && !p.deafened
        const connecting = inThisRoom && p.userId !== me && peers[p.userId] && peers[p.userId] !== 'connected'
        return (
          <li key={p.userId}>
            <button
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setMenu({ userId: p.userId, x: rect.left, y: rect.bottom + 4 })
              }}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-muted hover:bg-hover hover:text-fg"
            >
              <span className={`flex shrink-0 rounded-full ${talking ? 'speaking-glow' : ''}`}>
                <Avatar name={name} path={profile?.avatar_path} size={22} />
              </span>
              <span className={`min-w-0 flex-1 truncate ${talking ? 'font-semibold text-fg' : ''} ${connecting ? 'opacity-60' : ''}`}>
                {name}
              </span>
              {inThisRoom && p.userId !== me && <PingBadge link={links[p.userId]} />}
              {p.muted && <MicOff className="size-3.5 shrink-0 text-accent" aria-label="Mikrofonu kapalı" />}
              {p.deafened && <HeadphoneOff className="size-3.5 shrink-0 text-accent" aria-label="Sağırlaştırılmış" />}
            </button>
            {menu?.userId === p.userId && <ParticipantMenu userId={p.userId} isMe={p.userId === me} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
          </li>
        )
      })}
    </ul>
  )
}

// Kanal listesinin dışına (sayfanın üstüne) çizilir; yoksa dar listenin kenarında kesilirdi.
function ParticipantMenu({ userId, isMe, x, y, onClose }: { userId: string; isMe: boolean; x: number; y: number; onClose: () => void }) {
  const volume = useVoice((s) => s.volumes[userId] ?? 1)
  const openModal = useUi((s) => s.openModal)
  return (
    <Floating x={x} y={y} onClose={onClose} className="w-56 p-3">
      {!isMe && (
        <label className="block">
          <span className="flex justify-between text-xs font-semibold text-muted">
            Ses seviyesi <span>{Math.round(volume * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => setUserVolume(userId, Number(e.target.value) / 100)}
            className="mt-2 w-full accent-accent"
          />
        </label>
      )}
      <button
        type="button"
        onClick={() => {
          onClose()
          openModal({ kind: 'profile', userId })
        }}
        className={`w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-hover ${isMe ? '' : 'mt-2'}`}
      >
        Profili gör
      </button>
    </Floating>
  )
}
