import { useEffect, useState } from 'react'
import { HeadphoneOff, MicOff } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { useProfiles } from '@/data/queries'
import { useUi } from '@/stores/ui'
import { setUserVolume } from '@/voice/engine'
import { watchVoiceRoom } from '@/voice/presence'
import { useVoice } from '@/voice/store'

// Ses kanalının altında o an kanalda olanlar. Konuşanın avatarı yeşil çerçeveyle parlar.
export function VoiceRoom({ channelId, me }: { channelId: string; me: string }) {
  const participants = useVoice((s) => s.rooms[channelId])
  const speaking = useVoice((s) => s.speaking)
  const myChannel = useVoice((s) => s.channelId)
  const peers = useVoice((s) => s.peers)
  const { data: profiles } = useProfiles()
  const [menu, setMenu] = useState<string | null>(null)

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
          <li key={p.userId} className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === p.userId ? null : p.userId)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-muted hover:bg-hover hover:text-fg"
            >
              <span className={`rounded-full ring-2 transition-shadow ${talking ? 'ring-online' : 'ring-transparent'}`}>
                <Avatar name={name} path={profile?.avatar_path} size={22} />
              </span>
              <span className={`min-w-0 flex-1 truncate ${talking ? 'font-semibold text-fg' : ''} ${connecting ? 'opacity-60' : ''}`}>
                {name}
              </span>
              {p.muted && <MicOff className="size-3.5 shrink-0 text-accent" aria-label="Mikrofonu kapalı" />}
              {p.deafened && <HeadphoneOff className="size-3.5 shrink-0 text-accent" aria-label="Sağırlaştırılmış" />}
            </button>
            {menu === p.userId && <ParticipantMenu userId={p.userId} isMe={p.userId === me} onClose={() => setMenu(null)} />}
          </li>
        )
      })}
    </ul>
  )
}

function ParticipantMenu({ userId, isMe, onClose }: { userId: string; isMe: boolean; onClose: () => void }) {
  const volume = useVoice((s) => s.volumes[userId] ?? 1)
  const openModal = useUi((s) => s.openModal)
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute top-full left-0 z-40 mt-1 w-56 rounded-lg border border-line bg-elevated p-3 shadow-pop">
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
              className="mt-2 w-full accent-[#e30a17]"
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
      </div>
    </>
  )
}
