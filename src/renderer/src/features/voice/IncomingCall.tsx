import { Phone, PhoneOff } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { useProfile } from '@/data/queries'
import { useUi } from '@/stores/ui'
import { acceptCall, declineCall, useCall } from '@/voice/call'
import { RoundButton } from './CallBar'

// Gelen arama kartı: hangi ekranda olursan ol sağ üstte belirir, melodi çalar.
export function IncomingCall() {
  const call = useCall((s) => s.call)
  const peer = useProfile(call?.peerId)
  const setView = useUi((s) => s.setView)
  if (!call || call.direction !== 'in' || call.status !== 'ringing') return null
  const name = peer?.display_name ?? 'Biri'

  return (
    <div
      role="alertdialog"
      aria-label={`${name} seni arıyor`}
      className="anim-slide fixed top-12 right-4 z-[70] w-80 overflow-hidden rounded-xl border border-line bg-elevated shadow-pop"
    >
      <div className="h-1.5 bg-accent" />
      <div className="flex flex-col items-center gap-1 px-5 pt-5 pb-4 text-center">
        <span className="anim-ring rounded-full">
          <Avatar name={name} path={peer?.avatar_path} size={72} />
        </span>
        <p className="mt-3 text-lg font-bold text-fg">{name}</p>
        <p className="text-sm text-muted">seni arıyor…</p>
        <div className="mt-4 flex items-center gap-8">
          <div className="flex flex-col items-center gap-1">
            <RoundButton label="Reddet" tone="danger" size="size-12" onClick={() => void declineCall()}>
              <PhoneOff className="size-6" />
            </RoundButton>
            <span className="text-xs font-medium text-muted">Reddet</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <RoundButton label="Aç" tone="accept" size="size-12" onClick={() => void acceptCall()}>
              <Phone className="size-6" />
            </RoundButton>
            <span className="text-xs font-medium text-muted">Aç</span>
          </div>
        </div>
        <button type="button" onClick={() => setView({ kind: 'dm', channelId: call.channelId })} className="mt-3 text-xs text-faint hover:text-fg hover:underline">
          Sohbete git
        </button>
      </div>
    </div>
  )
}
