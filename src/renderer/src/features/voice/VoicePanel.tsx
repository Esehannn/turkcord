import { PhoneOff, Signal } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { useChannels, useServers } from '@/data/queries'
import { useUi } from '@/stores/ui'
import { leaveVoice } from '@/voice/engine'
import { useVoice } from '@/voice/store'

// Ses kanalına bağlıyken kullanıcı panelinin üstünde görünen bağlantı kutusu.
export function VoicePanel() {
  const status = useVoice((s) => s.status)
  const channelId = useVoice((s) => s.channelId)
  const serverId = useVoice((s) => s.serverId)
  const peers = useVoice((s) => s.peers)
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
        </span>
        <span className="block truncate text-xs text-muted">
          {channel?.name ?? 'Ses kanalı'} / {server?.name ?? ''}
        </span>
      </button>
      <IconButton label="Bağlantıyı kes" className="hover:text-accent" onClick={() => void leaveVoice()}>
        <PhoneOff className="size-[18px]" />
      </IconButton>
    </div>
  )
}
