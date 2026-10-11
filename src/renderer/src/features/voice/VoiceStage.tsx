import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Headphones,
  HeadphoneOff,
  LayoutGrid,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  X,
} from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { TeaGlass } from '@/components/TeaGlass'
import { Button, EmptyState, Spinner } from '@/components/ui'
import { useChannels, useProfiles } from '@/data/queries'
import { useUi } from '@/stores/ui'
import { joinVoice, leaveVoice, MAX_PARTICIPANTS, setDeafened, setMuted } from '@/voice/engine'
import { watchVoiceRoom } from '@/voice/presence'
import { useVoice, type VoiceParticipant } from '@/voice/store'
import { startCamera, stopCamera, stopScreen, unwatch, videoKey, watch } from '@/voice/video'
import { Elapsed, roomSince } from './Elapsed'
import { PingBadge } from './Ping'
import { useCameraFeeds, VideoView } from './VideoView'
import { ParticipantMenu } from './VoiceRoom'

// Ses odası: ses kanalına tıklayınca ortada açılır. Kanaldakiler karolarla görünür; konuşanın çerçevesi yanar,
// kamerası açık olanın görüntüsü karosunda oynar, ekran paylaşımları ayrı karolardır ("İzle"ye basınca gelir).
// Bir karoya tıklayınca o büyür (odak), diğerleri altta şeride dizilir; çift tıklayınca tam ekran olur.
// Kanala girmeden de kimlerin içeride olduğuna bakılabilir; görüntü izlemek için kanalda olmak gerekir.

type Tile = { key: string; kind: 'person' | 'screen'; person: VoiceParticipant }

export function VoiceStage({ serverId, channelId, me }: { serverId: string; channelId: string; me: string }) {
  const { data: channels } = useChannels(serverId)
  const participants = useVoice((s) => s.rooms[channelId]) ?? []
  const inRoom = useVoice((s) => s.status !== 'idle' && s.channelId === channelId)
  const connecting = useVoice((s) => s.status === 'connecting' && s.channelId === channelId)
  const muted = useVoice((s) => s.muted)
  const deafened = useVoice((s) => s.deafened)
  const localCamera = useVoice((s) => s.localCamera)
  const localScreen = useVoice((s) => s.localScreen)
  const videos = useVoice((s) => s.videos)
  const setView = useUi((s) => s.setView)
  const openModal = useUi((s) => s.openModal)
  const textChannel = useUi((s) => (s.view.kind === 'server' ? s.view.channelId : null))
  const [menu, setMenu] = useState<{ userId: string; x: number; y: number } | null>(null)
  // Büyütülen karo (odak); yoksa hepsi eşit ızgarada durur.
  const [focus, setFocus] = useState<string | null>(null)

  useEffect(() => watchVoiceRoom(channelId, me), [channelId, me])

  // Kameralar bu ekran açıkken kendiliğinden izlenir.
  useCameraFeeds(
    participants.filter((p) => p.camera && p.userId !== me).map((p) => p.userId),
    inRoom,
  )

  const tiles: Tile[] = [
    ...participants.filter((p) => p.screen).map((p): Tile => ({ key: videoKey(p.userId, 'screen'), kind: 'screen', person: p })),
    ...participants.map((p): Tile => ({ key: p.userId, kind: 'person', person: p })),
  ]
  const focused = tiles.find((t) => t.key === focus) ?? null

  // İzlemeye başlanan ekran kendiliğinden büyür.
  const watched = Object.keys(videos).filter((k) => k.endsWith(':screen'))
  const lastWatched = useRef<string[]>([])
  useEffect(() => {
    const fresh = watched.find((k) => !lastWatched.current.includes(k))
    lastWatched.current = watched
    if (fresh) setFocus(fresh)
  }, [watched.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const columns = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : tiles.length <= 9 ? 3 : 4
  const tile = (t: Tile, shape: 'grid' | 'strip' | 'fill' = 'grid') => (
    <StageTile
      key={t.key}
      tile={t}
      me={me}
      inRoom={inRoom}
      shape={shape}
      onFocus={() => setFocus(focus === t.key ? null : t.key)}
      onMenu={(x, y) => setMenu({ userId: t.person.userId, x, y })}
    />
  )

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
        <div className="ml-auto flex items-center gap-1">
          {focused && (
            <Button variant="ghost" className="h-8 px-2.5" onClick={() => setFocus(null)}>
              <LayoutGrid className="size-4" /> Izgara
            </Button>
          )}
          <Button variant="ghost" className="h-8 px-2.5" onClick={backToChat}>
            <MessageSquare className="size-4" /> Sohbete dön
          </Button>
        </div>
      </header>

      {participants.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyState icon={<TeaGlass />} title="Kanalda kimse yok" text="İlk giren sen ol; arkadaşların girdiğinde burada görünürler." />
        </div>
      ) : focused ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="min-h-0 flex-1">{tile(focused, 'fill')}</div>
          {tiles.length > 1 && (
            <div className="flex h-24 shrink-0 justify-center gap-2 overflow-x-auto scroll-thin">
              {tiles.filter((t) => t.key !== focused.key).map((t) => tile(t, 'strip'))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-y-auto p-6 scroll-thin">
          <div
            className="m-auto grid w-full gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, maxWidth: columns === 1 ? '36rem' : columns === 2 ? '56rem' : '72rem' }}
          >
            {tiles.map((t) => tile(t))}
          </div>
        </div>
      )}

      <footer className="flex h-20 shrink-0 items-center justify-center gap-3 border-t border-line">
        {inRoom ? (
          <>
            <StageButton label={muted || deafened ? 'Mikrofonu aç' : 'Mikrofonu kapat'} off={muted || deafened} onClick={() => setMuted(!(useVoice.getState().muted || useVoice.getState().deafened))}>
              {muted || deafened ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </StageButton>
            <StageButton label={deafened ? 'Sesi aç' : 'Sağırlaştır (kimseyi duyma)'} off={deafened} onClick={() => setDeafened(!useVoice.getState().deafened)}>
              {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
            </StageButton>
            <StageButton label={localCamera ? 'Kamerayı kapat' : 'Kamerayı aç'} on={!!localCamera} onClick={() => (localCamera ? stopCamera() : void startCamera())}>
              {localCamera ? <Video className="size-5" /> : <VideoOff className="size-5" />}
            </StageButton>
            <StageButton
              label={localScreen ? 'Ekran paylaşımını durdur' : 'Ekranını paylaş'}
              on={!!localScreen}
              onClick={() => (localScreen ? stopScreen() : openModal({ kind: 'share-screen' }))}
            >
              {localScreen ? <MonitorOff className="size-5" /> : <MonitorUp className="size-5" />}
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

// Tek karo: bir kişi (avatar ya da kamera görüntüsü) ya da bir ekran paylaşımı.
function StageTile({
  tile,
  me,
  inRoom,
  shape,
  onFocus,
  onMenu,
}: {
  tile: Tile
  me: string
  inRoom: boolean
  // grid: ızgaradaki karo; fill: büyütülmüş (alanı doldurur); strip: alt şeritteki küçük hali (yalnızca görüntü ve ad).
  shape: 'grid' | 'strip' | 'fill'
  onFocus: () => void
  onMenu: (x: number, y: number) => void
}) {
  const { person: p, kind } = tile
  const compact = shape === 'strip'
  const mine = p.userId === me
  const { data: profiles } = useProfiles()
  const profile = profiles?.get(p.userId)
  const name = profile?.display_name ?? 'Biri'
  const talking = useVoice((s) => inRoom && !!s.speaking[p.userId]) && !p.muted && !p.deafened
  const waiting = useVoice((s) => inRoom && !mine && !!s.peers[p.userId] && s.peers[p.userId] !== 'connected')
  const link = useVoice((s) => s.links[p.userId])
  const remote = useVoice((s) => s.videos[videoKey(p.userId, kind === 'screen' ? 'screen' : 'camera')])
  const local = useVoice((s) => (kind === 'screen' ? s.localScreen : s.localCamera))
  const ref = useRef<HTMLDivElement>(null)

  const stream = mine ? local : (remote ?? null)
  // undefined: izleme istenmedi; null: istendi, görüntü bekleniyor.
  const requested = remote !== undefined
  // Ad şeridi görüntünün üstündeyse koyu zeminli ve beyaz yazılıdır; avatarlı karoda temanın yazı rengini kullanır.
  const onVideo = !!stream && !(kind === 'screen' && mine)
  const fullscreen = () => void (document.fullscreenElement ? document.exitFullscreen() : ref.current?.requestFullscreen())?.catch(() => {})

  let body: ReactNode
  if (kind === 'screen') {
    if (mine) {
      body = (
        <Panel icon={<Monitor className={compact ? 'size-5' : 'size-9'} />} title={compact ? '' : 'Ekranını paylaşıyorsun'}>
          {!compact && (
            <Button
              variant="secondary"
              className="h-8"
              onClick={(e) => {
                e.stopPropagation()
                stopScreen()
              }}
            >
              <MonitorOff className="size-4" /> Paylaşımı durdur
            </Button>
          )}
        </Panel>
      )
    } else if (stream) {
      body = <VideoView stream={stream} audio />
    } else if (requested) {
      body = <Panel icon={<Spinner />} title={compact ? '' : 'Yayına bağlanılıyor…'} />
    } else {
      body = (
        <Panel icon={<Monitor className={compact ? 'size-5' : 'size-9'} />} title={compact ? '' : `${name} ekranını paylaşıyor`}>
          {!compact && (
            <Button
              className="h-8"
              disabled={!inRoom}
              data-tip={inRoom ? undefined : 'İzlemek için önce kanala katıl'}
              onClick={(e) => {
                e.stopPropagation()
                watch(p.userId, 'screen')
              }}
            >
              İzle
            </Button>
          )}
        </Panel>
      )
    }
  } else if (stream) {
    body = <VideoView stream={stream} mirror={mine} fit="cover" />
  } else {
    body = (
      <div className="grid size-full place-items-center bg-sidebar">
        <span className={`flex rounded-full ${talking ? 'speaking-glow' : ''} ${waiting ? 'opacity-60' : ''}`}>
          <Avatar name={name} path={profile?.avatar_path} size={compact ? 40 : 88} />
        </span>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onFocus}
      onDoubleClick={fullscreen}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-sidebar ${talking ? 'border-online' : 'border-line'} ${
        shape === 'strip' ? 'aspect-video h-full shrink-0' : shape === 'fill' ? 'size-full' : 'aspect-video w-full'
      } [&:fullscreen]:rounded-none [&:fullscreen]:border-0`}
    >
      {body}

      {/* Ad şeridi */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-2.5 pb-1.5 ${
          onVideo ? 'bg-gradient-to-t from-black/70 to-transparent pt-5 text-white' : 'text-fg'
        }`}
      >
        {kind === 'screen' && <Monitor className="size-3.5 shrink-0" />}
        <span className={`truncate font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>{kind === 'screen' && !compact ? `${name} · ekran` : name}</span>
        {kind === 'person' && p.muted && <MicOff className="size-3.5 shrink-0 text-accent" aria-label="Mikrofonu kapalı" />}
        {kind === 'person' && p.deafened && <HeadphoneOff className="size-3.5 shrink-0 text-accent" aria-label="Sağırlaştırılmış" />}
        {!compact && kind === 'person' && (
          <span className={`pointer-events-auto ml-auto flex shrink-0 items-center gap-2 text-xs ${onVideo ? 'text-white/80' : 'text-muted'}`}>
            {inRoom && !mine && p.legacy ? (
              <span data-tip="Birbirinizi duyabilmeniz için Turkcord'u güncellemesi gerekiyor.">Eski sürüm</span>
            ) : waiting ? (
              'Bağlanıyor…'
            ) : (
              p.since !== undefined && <Elapsed since={p.since} className="tabular-nums" />
            )}
            {inRoom && !mine && !waiting && <PingBadge link={link} />}
          </span>
        )}
      </div>

      {/* Üstüne gelince çıkan düğmeler */}
      {!compact && (
        <div className="absolute top-2 right-2 hidden gap-1 group-hover:flex">
          {stream && (
            <TileButton label="Tam ekran" onClick={fullscreen}>
              <Maximize className="size-4" />
            </TileButton>
          )}
          {kind === 'screen' && !mine && requested && (
            <TileButton label="İzlemeyi bırak" onClick={() => unwatch(p.userId, 'screen')}>
              <X className="size-4" />
            </TileButton>
          )}
          {kind === 'person' && (
            <TileButton
              label="Ses seviyesi ve profil"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                onMenu(rect.right - 224, rect.bottom + 6)
              }}
            >
              <MoreHorizontal className="size-4" />
            </TileButton>
          )}
        </div>
      )}
    </div>
  )
}

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 bg-input p-3 text-center text-muted">
      {icon}
      {title && <p className="text-sm font-semibold text-fg">{title}</p>}
      {children}
    </div>
  )
}

function TileButton({ label, onClick, children }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="grid size-8 place-items-center rounded-md bg-black/55 text-white transition-colors hover:bg-black/75"
    >
      {children}
    </button>
  )
}

// off: kapalı (mikrofon kapalı gibi, uyarı tonu); on: açık bir paylaşım (vurgulu).
function StageButton({ label, off = false, on = false, onClick, children }: { label: string; off?: boolean; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      onClick={onClick}
      className={`grid size-12 place-items-center rounded-full transition-colors ${
        on ? 'bg-success text-white hover:opacity-90' : off ? 'bg-accent-soft text-accent hover:bg-selected' : 'bg-input text-fg hover:bg-selected'
      }`}
    >
      {children}
    </button>
  )
}
