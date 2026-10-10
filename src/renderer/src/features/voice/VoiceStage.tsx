import { useEffect, useState } from 'react'
import { Headphones, HeadphoneOff, MessageSquare, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { TeaGlass } from '@/components/TeaGlass'
import { Button, EmptyState } from '@/components/ui'
import { useChannels, useProfiles } from '@/data/queries'
import { useUi } from '@/stores/ui'
import { joinVoice, leaveVoice, MAX_PARTICIPANTS, setDeafened, setMuted } from '@/voice/engine'
import { watchVoiceRoom } from '@/voice/presence'
import { useVoice } from '@/voice/store'
import { Elapsed, roomSince } from './Elapsed'
import { PingBadge } from './Ping'
import { ParticipantMenu } from './VoiceRoom'

// Ses odası: ses kanalına tıklayınca ortada açılır. Kanaldakiler büyük kartlarla görünür; konuşanın çerçevesi
// yanar, susturulan işaretlenir, ping ve seste geçen süre kartta yazar. Kanala girmeden de bakılabilir.
export function VoiceStage({ serverId, channelId, me }: { serverId: string; channelId: string; me: string }) {
  const { data: channels } = useChannels(serverId)
  const { data: profiles } = useProfiles()
  const participants = useVoice((s) => s.rooms[channelId]) ?? []
  const inRoom = useVoice((s) => s.status !== 'idle' && s.channelId === channelId)
  const connecting = useVoice((s) => s.status === 'connecting' && s.channelId === channelId)
  const speaking = useVoice((s) => s.speaking)
  const peers = useVoice((s) => s.peers)
  const links = useVoice((s) => s.links)
  const muted = useVoice((s) => s.muted)
  const deafened = useVoice((s) => s.deafened)
  const setView = useUi((s) => s.setView)
  const textChannel = useUi((s) => (s.view.kind === 'server' ? s.view.channelId : null))
  const [menu, setMenu] = useState<{ userId: string; x: number; y: number } | null>(null)

  useEffect(() => watchVoiceRoom(channelId, me), [channelId, me])

  const channel = channels?.find((c) => c.id === channelId && c.kind === 'voice')
  const backToChat = () => setView({ kind: 'server', serverId, channelId: textChannel })
  if (channels && !channel) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <EmptyState icon={<TeaGlass />} title="Bu ses kanalı artık yok" text="Soldaki listeden başka bir kanal seç." />
      </div>
    )
  }

  const since = roomSince(participants)
  const full = participants.length >= MAX_PARTICIPANTS

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <Volume2 className="size-5 shrink-0 text-faint" />
        <h1 className="truncate font-semibold text-fg">{channel?.name ?? 'Ses kanalı'}</h1>
        {participants.length > 0 && (
          <span className="shrink-0 border-l border-line pl-3 text-sm text-muted">
            {participants.length} kişi
            {since !== undefined && (
              <>
                {' · '}
                <Elapsed since={since} />
              </>
            )}
          </span>
        )}
        <Button variant="ghost" className="ml-auto h-8 px-2.5" onClick={backToChat}>
          <MessageSquare className="size-4" /> Sohbete dön
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-y-auto p-6 scroll-thin">
        {participants.length === 0 ? (
          <div className="flex-1">
            <EmptyState icon={<TeaGlass />} title="Kanalda kimse yok" text="İlk giren sen ol; arkadaşların girdiğinde burada görünürler." />
          </div>
        ) : (
          <ul className="m-auto flex w-full max-w-4xl flex-wrap justify-center gap-4">
            {participants.map((p) => {
              const profile = profiles?.get(p.userId)
              const name = profile?.display_name ?? 'Biri'
              const talking = inRoom && !!speaking[p.userId] && !p.muted && !p.deafened
              const waiting = inRoom && p.userId !== me && !!peers[p.userId] && peers[p.userId] !== 'connected'
              return (
                <li key={p.userId}>
                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setMenu({ userId: p.userId, x: rect.left + rect.width / 2 - 112, y: rect.bottom - 12 })
                    }}
                    className={`flex w-48 flex-col items-center gap-3 rounded-2xl border bg-sidebar px-4 pt-6 pb-4 transition-colors hover:bg-hover ${
                      talking ? 'border-online' : 'border-line'
                    }`}
                  >
                    <span className={`flex rounded-full ${talking ? 'speaking-glow' : ''} ${waiting ? 'opacity-60' : ''}`}>
                      <Avatar name={name} path={profile?.avatar_path} size={88} />
                    </span>
                    <span className="flex w-full items-center justify-center gap-1.5">
                      <span className="truncate font-semibold text-fg">{name}</span>
                      {p.muted && <MicOff className="size-4 shrink-0 text-accent" aria-label="Mikrofonu kapalı" />}
                      {p.deafened && <HeadphoneOff className="size-4 shrink-0 text-accent" aria-label="Sağırlaştırılmış" />}
                    </span>
                    <span className="flex h-4 items-center gap-2 text-xs text-muted">
                      {waiting ? (
                        'Bağlanıyor…'
                      ) : (
                        <>
                          {p.since !== undefined && <Elapsed since={p.since} className="tabular-nums" />}
                          {inRoom && p.userId !== me && <PingBadge link={links[p.userId]} />}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <footer className="flex h-20 shrink-0 items-center justify-center gap-3 border-t border-line">
        {inRoom ? (
          <>
            <StageButton label={muted || deafened ? 'Mikrofonu aç' : 'Mikrofonu kapat'} off={muted || deafened} onClick={() => setMuted(!(useVoice.getState().muted || useVoice.getState().deafened))}>
              {muted || deafened ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </StageButton>
            <StageButton label={deafened ? 'Sesi aç' : 'Sağırlaştır (kimseyi duyma)'} off={deafened} onClick={() => setDeafened(!useVoice.getState().deafened)}>
              {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
            </StageButton>
            <button
              type="button"
              aria-label="Bağlantıyı kes"
              data-tip="Bağlantıyı kes"
              onClick={() => void leaveVoice()}
              className="grid size-12 place-items-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-hover"
            >
              <PhoneOff className="size-5" />
            </button>
          </>
        ) : (
          <Button className="h-10 px-5" disabled={full} loading={connecting} onClick={() => void joinVoice(serverId, channelId, me)}>
            <Volume2 className="size-4" /> {full ? 'Kanal dolu' : 'Kanala katıl'}
          </Button>
        )}
      </footer>

      {menu && <ParticipantMenu userId={menu.userId} isMe={menu.userId === me} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}

function StageButton({ label, off, onClick, children }: { label: string; off: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      onClick={onClick}
      className={`grid size-12 place-items-center rounded-full transition-colors ${
        off ? 'bg-accent-soft text-accent hover:bg-selected' : 'bg-input text-fg hover:bg-selected'
      }`}
    >
      {children}
    </button>
  )
}
