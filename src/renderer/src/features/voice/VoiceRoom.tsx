import { useEffect, useState } from 'react'
import { HeadphoneOff, MicOff, Tv, Video } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Floating } from '@/components/Menu'
import { useProfiles } from '@/data/queries'
import { useUi } from '@/stores/ui'
import { setUserVolume } from '@/voice/engine'
import { watchVoiceRoom } from '@/voice/presence'
import { setStreamVolume, useVoice } from '@/voice/store'
import { PeerBadge } from './Ping'

// Ses kanalının altında o an kanalda olanlar. Konuşanın avatarı yeşil çerçeveyle parlar. Ekranını paylaşanın
// yanında "Katıl" düğmesi çıkar: kanala girer (girmemişsen) ve yayını açar.
export function VoiceRoom({ channelId, me, onWatch }: { channelId: string; me: string; onWatch: (userId: string) => void }) {
  const participants = useVoice((s) => s.rooms[channelId])
  const videos = useVoice((s) => s.videos)
  const speaking = useVoice((s) => s.speaking)
  const myChannel = useVoice((s) => s.channelId)
  const peers = useVoice((s) => s.peers)
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
        const connecting = inThisRoom && p.userId !== me && peers[p.userId] === 'connecting'
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
              <span className={`min-w-0 flex-1 truncate ${talking ? 'font-semibold text-fg' : ''} ${connecting || peers[p.userId] === 'lost' ? 'opacity-60' : ''}`}>
                {name}
              </span>
              {p.screen && p.userId === me && (
                <span
                  className="flex shrink-0 items-center gap-1 rounded bg-accent px-1.5 text-[10px] leading-[18px] font-bold tracking-wide text-on-accent"
                  data-tip={p.viewers ? `Ekranını paylaşıyorsun · ${p.viewers} kişi izliyor` : 'Ekranını paylaşıyorsun'}
                >
                  <Tv className="size-3" /> CANLI
                </span>
              )}
              {p.screen && p.userId !== me && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onWatch(p.userId)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.stopPropagation()
                    onWatch(p.userId)
                  }}
                  data-tip={
                    `${p.userId}:screen` in videos && inThisRoom
                      ? 'Yayını izliyorsun'
                      : inThisRoom
                        ? `Yayını izle${p.viewers ? ` · ${p.viewers} kişi izliyor` : ''}`
                        : 'Kanala gir ve yayını izle'
                  }
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-on-accent transition-colors outline-none hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <Tv className="size-3" /> {`${p.userId}:screen` in videos && inThisRoom ? 'İzleniyor' : 'Katıl'}
                </span>
              )}
              {p.camera && <Video className="size-3.5 shrink-0 text-muted" aria-label="Kamerası açık" />}
              {inThisRoom && p.userId !== me && p.legacy && (
                <span
                  className="shrink-0 rounded bg-hover px-1 text-[10px] leading-4 font-semibold tracking-wide text-muted"
                  data-tip="Eski sürüm kullanıyor. Birbirinizi duyabilmeniz için Turkcord'u güncellemesi gerekiyor."
                >
                  ESKİ
                </span>
              )}
              {inThisRoom && p.userId !== me && <PeerBadge state={peers[p.userId]} />}
              {(p.muted || p.deafened) && <MicOff className="size-3.5 shrink-0 text-accent" aria-label="Mikrofonu kapalı" />}
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
export function ParticipantMenu({ userId, isMe, x, y, onClose }: { userId: string; isMe: boolean; x: number; y: number; onClose: () => void }) {
  const volume = useVoice((s) => s.volumes[userId] ?? 1)
  const streamVolume = useVoice((s) => s.streamVolumes[userId] ?? 1)
  // Yayın sesi ayarı yalnızca o kişinin yayınını izlerken anlamlı.
  const watching = useVoice((s) => `${userId}:screen` in s.videos)
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
      {!isMe && watching && (
        <label className="mt-3 block">
          <span className="flex justify-between text-xs font-semibold text-muted">
            Yayın sesi <span>{Math.round(streamVolume * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(streamVolume * 100)}
            onChange={(e) => setStreamVolume(userId, Number(e.target.value) / 100)}
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
