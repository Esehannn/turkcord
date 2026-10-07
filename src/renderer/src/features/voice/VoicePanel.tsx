import { PhoneOff, Signal } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { useChannels, useServers } from '@/data/queries'
import { keyLabel } from '@/lib/keys'
import { useUi } from '@/stores/ui'
import { leaveVoice } from '@/voice/engine'
import { useVoice } from '@/voice/store'
import { linkTitle, pingClass } from './Ping'

// Ses kanalına bağlıyken kullanıcı panelinin üstünde görünen bağlantı kutusu.
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

  if (status === 'idle' || !channelId || !serverId) return null
  const channel = channels?.find((c) => c.id === channelId)
  const server = servers?.find((s) => s.id === serverId)

  const states = Object.values(peers)
  const trouble = states.some((s) => s === 'failed' || s === 'disconnected')
  const pending = status === 'connecting' || states.some((s) => s === 'new' || s === 'connecting')
  const label = status === 'connecting' ? 'Bağlanıyor…' : trouble ? 'Bağlantı sorunu' : pending ? 'Bağlanıyor…' : 'Ses bağlı'
  const color = trouble ? 'text-idle' : pending ? 'text-muted' : 'text-online'
  // Gösterilen ping: odadakilerle aramdaki en yüksek gecikme (sesi en geç giden kişi).
  const linkList = Object.values(links).filter((l) => l.ping !== null)
  const worst = linkList.length ? Math.max(...linkList.map((l) => l.ping!)) : null
  const relayed = linkList.some((l) => l.relay)
  const tooltip = linkList.length ? Object.values(links).map(linkTitle).join('\n') : 'Odada başka kimse yok'

  return (
    <div className="flex items-center gap-2 border-t border-line bg-sidebar px-3 py-2">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => setView({ kind: 'server', serverId, channelId: null })}
        title="Sunucuya git"
      >
        <span className={`flex items-center gap-1.5 text-sm font-semibold ${color}`}>
          <Signal className="size-4" />
          {label}
          {!trouble && !pending && worst !== null && (
            <span className={`text-xs font-medium tabular-nums ${pingClass(worst)}`} title={tooltip}>
              · {worst} ms{relayed ? ' ☁' : ''}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted">
          {channel?.name ?? 'Ses kanalı'} / {server?.name ?? ''}
        </span>
        {inputMode === 'bas-konus' && (
          <span className={`mt-0.5 block text-[11px] font-medium ${pttDown ? 'text-online' : 'text-faint'}`}>
            {pttDown ? 'Konuşuyorsun' : `Konuşmak için ${keyLabel(pttKey)} tuşuna basılı tut`}
          </span>
        )}
      </button>
      <IconButton label="Bağlantıyı kes" className="hover:text-accent" onClick={() => void leaveVoice()}>
        <PhoneOff className="size-[18px]" />
      </IconButton>
    </div>
  )
}
