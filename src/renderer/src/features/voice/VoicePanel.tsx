import { useEffect, useState } from 'react'
import { Megaphone, PhoneOff, Signal } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { useChannels, useProfile, useProfiles, useServers } from '@/data/queries'
import { clock } from '@/lib/files'
import { keyLabel } from '@/lib/keys'
import { EFFECTS, type EffectId } from '@/lib/sounds'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { hangUp, useCall } from '@/voice/call'
import { leaveVoice, sendEffect } from '@/voice/engine'
import { useVoice } from '@/voice/store'
import { useCallSeconds } from './CallBar'
import { linkTitle, pingClass } from './Ping'

// Ses kanalına ya da bir aramaya bağlıyken kullanıcı panelinin üstünde görünen bağlantı kutusu.
export function VoicePanel() {
  const status = useVoice((s) => s.status)
  const channelId = useVoice((s) => s.channelId)
  const serverId = useVoice((s) => s.serverId)
  const peers = useVoice((s) => s.peers)
  const links = useVoice((s) => s.links)
  const inputMode = useVoice((s) => s.inputMode)
  const pttKey = useVoice((s) => s.pttKey)
  const pttDown = useVoice((s) => s.pttDown)
  const { data: channels } = useChannels(serverId)
  const { data: servers } = useServers()
  const setView = useUi((s) => s.setView)
  const call = useCall((s) => s.call)
  const callPeer = useProfile(call?.peerId)
  const callSeconds = useCallSeconds(call)
  const [board, setBoard] = useState(false)

  if (status === 'idle' || !channelId) return null
  const inCall = !serverId
  const channel = channels?.find((c) => c.id === channelId)
  const server = servers?.find((s) => s.id === serverId)

  const states = Object.values(peers)
  const trouble = states.some((s) => s === 'failed' || s === 'disconnected')
  const pending = status === 'connecting' || states.some((s) => s === 'new' || s === 'connecting')
  const ringing = inCall && call?.status === 'ringing'
  const label = ringing
    ? 'Aranıyor…'
    : status === 'connecting'
      ? 'Bağlanıyor…'
      : trouble
        ? 'Bağlantı sorunu'
        : pending
          ? 'Bağlanıyor…'
          : inCall
            ? `Aramada · ${clock(callSeconds ?? 0)}`
            : 'Ses bağlı'
  const color = trouble ? 'text-idle' : pending || ringing ? 'text-muted' : 'text-online'
  // Gösterilen ping: odadakilerle aramdaki en yüksek gecikme (sesi en geç giden kişi).
  const linkList = Object.values(links).filter((l) => l.ping !== null)
  const worst = linkList.length ? Math.max(...linkList.map((l) => l.ping!)) : null
  const relayed = linkList.some((l) => l.relay)
  const tooltip = linkList.length ? Object.values(links).map(linkTitle).join('\n') : 'Odada başka kimse yok'

  return (
    <div className="relative border-t border-line bg-sidebar">
      <EffectToast />
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setView(serverId ? { kind: 'server', serverId, channelId: null } : { kind: 'dm', channelId })}
          title={inCall ? 'Sohbete git' : 'Sunucuya git'}
        >
          <span className={`flex items-center gap-1.5 text-sm font-semibold tabular-nums ${color}`}>
            <Signal className="size-4" />
            {label}
            {!trouble && !pending && !ringing && worst !== null && (
              <span className={`text-xs font-medium ${pingClass(worst)}`} title={tooltip}>
                · {worst} ms{relayed ? ' ☁' : ''}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted">
            {inCall ? (callPeer?.display_name ?? 'Sesli arama') : `${channel?.name ?? 'Ses kanalı'} / ${server?.name ?? ''}`}
          </span>
          {inputMode === 'bas-konus' && (
            <span className={`mt-0.5 block text-[11px] font-medium ${pttDown ? 'text-online' : 'text-faint'}`}>
              {pttDown ? 'Konuşuyorsun' : `Konuşmak için ${keyLabel(pttKey)} tuşuna basılı tut`}
            </span>
          )}
        </button>
        {status === 'connected' && !ringing && (
          <IconButton label="Ses efektleri" className={board ? 'bg-selected text-fg' : ''} onClick={() => setBoard((v) => !v)}>
            <Megaphone className="size-[18px]" />
          </IconButton>
        )}
        <IconButton label={inCall ? 'Aramayı kapat' : 'Bağlantıyı kes'} className="hover:text-accent" onClick={() => void (inCall && call ? hangUp() : leaveVoice())}>
          <PhoneOff className="size-[18px]" />
        </IconButton>
      </div>
      {board && <Soundboard onClose={() => setBoard(false)} />}
    </div>
  )
}

// Ses efekti paneli: basılan efekt kanaldaki herkeste çalar.
function Soundboard({ onClose }: { onClose: () => void }) {
  const enabled = useUi((s) => s.effects)
  const openModal = useUi((s) => s.openModal)

  function play(id: EffectId) {
    if (!sendEffect(id)) toast.info('Efektler arasında biraz bekle.')
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="anim-pop absolute right-2 bottom-full left-2 z-40 mb-2 rounded-lg border border-line bg-elevated p-2 shadow-pop">
        <p className="px-1 pb-1.5 text-[11px] font-bold tracking-wide text-faint uppercase">Ses efektleri</p>
        <div className="grid grid-cols-3 gap-1">
          {EFFECTS.map((effect) => (
            <button
              key={effect.id}
              type="button"
              onClick={() => play(effect.id)}
              className="flex flex-col items-center gap-0.5 rounded-md bg-input px-1 py-2 transition-colors hover:bg-selected active:scale-95"
            >
              <span className="text-xl leading-none">{effect.emoji}</span>
              <span className="w-full truncate text-center text-[11px] font-medium text-fg">{effect.label}</span>
            </button>
          ))}
        </div>
        {!enabled && (
          <button
            type="button"
            onClick={() => {
              onClose()
              openModal({ kind: 'settings', tab: 'notifications' })
            }}
            className="mt-2 w-full rounded-md bg-accent-soft px-2 py-1.5 text-left text-xs text-accent"
          >
            Ses efektlerini kapattın: bastıkların başkalarında çalar ama sen duymazsın. Açmak için tıkla.
          </button>
        )}
      </div>
    </>
  )
}

// Kanalda biri efekt bastığında kısa süre kimin bastığını gösterir.
function EffectToast() {
  const last = useVoice((s) => s.lastEffect)
  const { data: profiles } = useProfiles()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!last) return
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), 2200)
    return () => clearTimeout(timer)
  }, [last])

  if (!last || !visible) return null
  const effect = EFFECTS.find((e) => e.id === last.id)
  return (
    <div key={last.at} className="anim-pop flex items-center gap-1.5 border-b border-line px-3 py-1 text-xs text-muted">
      <span className="text-sm">{effect?.emoji}</span>
      <span className="truncate">
        <span className="font-semibold text-fg">{profiles?.get(last.userId)?.display_name ?? 'Biri'}</span> · {effect?.label}
      </span>
    </div>
  )
}
