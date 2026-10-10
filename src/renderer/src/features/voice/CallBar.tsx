import { useEffect, useRef, useState } from 'react'
import { HeadphoneOff, Headphones, Mic, MicOff, Monitor, MonitorOff, MonitorUp, Phone, PhoneOff, Video, VideoOff, X } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { useProfile } from '@/data/queries'
import { clock } from '@/lib/files'
import { acceptCall, declineCall, hangUp, type ActiveCall } from '@/voice/call'
import { setDeafened, setMuted } from '@/voice/engine'
import { useUi } from '@/stores/ui'
import { useVoice } from '@/voice/store'
import { startCamera, stopCamera, stopScreen, unwatch, videoKey, watch } from '@/voice/video'
import { PingBadge } from './Ping'
import { useCameraFeeds, VideoView } from './VideoView'

// Görüşme süresi (saniye); arama başlamadıysa null.
export function useCallSeconds(call: ActiveCall | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  const startedAt = call?.startedAt ?? null
  useEffect(() => {
    if (!startedAt) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return startedAt ? Math.max(0, (now - startedAt) / 1000) : null
}

// Özel mesajın üstünde, arama sürerken görünen şerit: iki kişi, süre ve düğmeler.
export function CallBar({ call, me }: { call: ActiveCall; me: string }) {
  const mine = useProfile(me)
  const peer = useProfile(call.peerId)
  const speaking = useVoice((s) => s.speaking)
  const muted = useVoice((s) => s.muted)
  const deafened = useVoice((s) => s.deafened)
  const room = useVoice((s) => s.rooms[call.channelId])
  const peerState = useVoice((s) => s.peers[call.peerId])
  const link = useVoice((s) => s.links[call.peerId])
  const seconds = useCallSeconds(call)
  const localCamera = useVoice((s) => s.localCamera)
  const localScreen = useVoice((s) => s.localScreen)
  const openModal = useUi((s) => s.openModal)

  const peerName = peer?.display_name ?? 'Biri'
  const peerInRoom = room?.find((p) => p.userId === call.peerId)
  const incoming = call.direction === 'in' && call.status === 'ringing'

  let status: string
  if (call.status === 'ringing') status = call.direction === 'out' ? `${peerName} aranıyor…` : `${peerName} seni arıyor`
  else if (!peerInRoom || peerState !== 'connected') status = 'Bağlanıyor…'
  else status = clock(seconds ?? 0)

  const off = muted || deafened
  const active = call.status === 'active'

  // Karşı tarafın kamerası bu şerit görünürken izlenir; ekran paylaşımı başlayınca kendiliğinden açılır
  // (başka sohbete geçilince küçük oynatıcıda sürer, o yüzden burada bırakılmaz).
  useCameraFeeds(peerInRoom?.camera ? [call.peerId] : [], active)
  const peerScreen = active && !!peerInRoom?.screen
  useEffect(() => {
    if (peerScreen) watch(call.peerId, 'screen')
  }, [peerScreen, call.peerId])

  return (
    <>
    <div className="anim-fade flex shrink-0 items-center gap-4 border-b border-line bg-sidebar px-4 py-3">
      <div className="flex items-center -space-x-2">
        <Party name={mine?.display_name ?? 'Ben'} path={mine?.avatar_path} talking={call.status === 'active' && !!speaking[me] && !off} />
        <Party
          name={peerName}
          path={peer?.avatar_path}
          talking={call.status === 'active' && !!speaking[call.peerId] && !peerInRoom?.muted}
          dim={call.status === 'ringing' || !peerInRoom}
          ringing={call.status === 'ringing'}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-fg">{localCamera || peerInRoom?.camera ? 'Görüntülü arama' : 'Sesli arama'}</p>
        <p className="flex items-center gap-2 text-xs text-muted tabular-nums">
          {status}
          {call.status === 'active' && <PingBadge link={link} />}
          {peerInRoom?.muted && <MicOff className="size-3.5 text-accent" aria-label="Karşı tarafın mikrofonu kapalı" />}
        </p>
      </div>
      {incoming ? (
        <>
          <RoundButton label="Aç" tone="accept" onClick={() => void acceptCall()}>
            <Phone className="size-5" />
          </RoundButton>
          <RoundButton label="Reddet" tone="danger" onClick={() => void declineCall()}>
            <PhoneOff className="size-5" />
          </RoundButton>
        </>
      ) : (
        <>
          <RoundButton label={off ? 'Mikrofonu aç' : 'Mikrofonu kapat'} tone={off ? 'active' : 'plain'} onClick={() => setMuted(!(useVoice.getState().muted || useVoice.getState().deafened))}>
            {off ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </RoundButton>
          <RoundButton label={deafened ? 'Sesi aç' : 'Sağırlaştır'} tone={deafened ? 'active' : 'plain'} onClick={() => setDeafened(!useVoice.getState().deafened)}>
            {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
          </RoundButton>
          {active && (
            <>
              <RoundButton label={localCamera ? 'Kamerayı kapat' : 'Kamerayı aç'} tone={localCamera ? 'on' : 'plain'} onClick={() => (localCamera ? stopCamera() : void startCamera())}>
                {localCamera ? <Video className="size-5" /> : <VideoOff className="size-5" />}
              </RoundButton>
              <RoundButton
                label={localScreen ? 'Ekran paylaşımını durdur' : 'Ekranını paylaş'}
                tone={localScreen ? 'on' : 'plain'}
                onClick={() => (localScreen ? stopScreen() : openModal({ kind: 'share-screen' }))}
              >
                {localScreen ? <MonitorOff className="size-5" /> : <MonitorUp className="size-5" />}
              </RoundButton>
            </>
          )}
          <RoundButton label="Aramayı kapat" tone="danger" onClick={() => void hangUp()}>
            <PhoneOff className="size-5" />
          </RoundButton>
        </>
      )}
    </div>
    {active && <CallVideos peerId={call.peerId} peerName={peerName} />}
    </>
  )
}

// Aramadaki görüntüler: karşı tarafın ekranı ve kamerası, yanında kendi kameram. Hiçbiri yoksa yer kaplamaz.
function CallVideos({ peerId, peerName }: { peerId: string; peerName: string }) {
  const peerScreen = useVoice((s) => s.videos[videoKey(peerId, 'screen')])
  const peerCamera = useVoice((s) => s.videos[videoKey(peerId, 'camera')])
  const localCamera = useVoice((s) => s.localCamera)
  const localScreen = useVoice((s) => s.localScreen)
  if (!peerScreen && !peerCamera && !localCamera && !localScreen) return null
  return (
    <div className="flex h-[42vh] min-h-48 shrink-0 gap-2 border-b border-line bg-input p-2">
      {peerScreen && (
        <CallTile label={`${peerName} · ekran`} wide onClose={() => unwatch(peerId, 'screen')}>
          <VideoView stream={peerScreen} audio />
        </CallTile>
      )}
      {peerCamera && (
        <CallTile label={peerName}>
          <VideoView stream={peerCamera} fit="cover" />
        </CallTile>
      )}
      {localCamera && (
        <CallTile label="Sen">
          <VideoView stream={localCamera} mirror fit="cover" />
        </CallTile>
      )}
      {localScreen && !peerScreen && !peerCamera && !localCamera && (
        <div className="grid flex-1 place-items-center rounded-lg bg-sidebar text-sm font-semibold text-muted">
          <span className="flex items-center gap-2">
            <Monitor className="size-5" /> Ekranını paylaşıyorsun
          </span>
        </div>
      )}
    </div>
  )
}

// Çift tıklayınca tam ekran olur.
function CallTile({ label, wide = false, onClose, children }: { label: string; wide?: boolean; onClose?: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      onDoubleClick={() => void (document.fullscreenElement ? document.exitFullscreen() : ref.current?.requestFullscreen())?.catch(() => {})}
      className={`group relative min-w-0 overflow-hidden rounded-lg bg-black ${wide ? 'flex-[2]' : 'flex-1'}`}
    >
      {children}
      <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{label}</span>
      {onClose && (
        <button
          type="button"
          aria-label="İzlemeyi bırak"
          data-tip="İzlemeyi bırak"
          onClick={onClose}
          className="absolute top-2 right-2 hidden size-7 place-items-center rounded-md bg-black/55 text-white group-hover:grid hover:bg-black/75"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function Party({ name, path, talking, dim, ringing }: { name: string; path?: string | null; talking: boolean; dim?: boolean; ringing?: boolean }) {
  return (
    <span
      className={`flex shrink-0 rounded-full ${talking ? 'speaking-glow' : 'ring-2 ring-sidebar'} ${ringing ? 'anim-ring' : ''} ${
        dim ? 'opacity-60' : ''
      }`}
    >
      <Avatar name={name} path={path} size={44} />
    </span>
  )
}

const TONES = {
  plain: 'bg-hover text-fg hover:bg-selected',
  active: 'bg-accent-soft text-accent hover:bg-selected',
  danger: 'bg-accent text-on-accent hover:bg-accent-hover',
  on: 'bg-success text-white hover:opacity-90',
  accept: 'bg-success text-white hover:opacity-90',
}

export function RoundButton({
  label,
  tone,
  onClick,
  children,
  size = 'size-10',
}: {
  label: string
  tone: keyof typeof TONES
  onClick: () => void
  children: React.ReactNode
  size?: string
}) {
  return (
    <button
      type="button"
      data-tip={label}
      aria-label={label}
      onClick={onClick}
      className={`grid ${size} shrink-0 place-items-center rounded-full transition-colors ${TONES[tone]}`}
    >
      {children}
    </button>
  )
}
