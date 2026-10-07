import { useEffect, useState } from 'react'
import { ChevronDown, Hash, LogOut, Plus, Settings, Trash2, UserPlus, Volume2 } from 'lucide-react'
import { confirmDialog } from '@/components/Modal'
import { Badge, IconButton } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useChannels, useMembers, useServers, useUnread } from '@/data/queries'
import type { ChannelRow } from '@/lib/database.types'
import { initials } from '@/lib/format'
import { publicImageUrl } from '@/lib/supabase'
import { useSession } from '@/stores/session'
import { joinVoice } from '@/voice/engine'
import { useVoice } from '@/voice/store'
import { VoiceRoom } from '@/features/voice/VoiceRoom'
import { useUi } from '@/stores/ui'
import { rememberChannel } from '@/features/layout/ServerRail'

export function ServerSidebar({ serverId }: { serverId: string }) {
  const me = useSession((s) => s.session?.user.id)
  const { data: servers } = useServers()
  const server = servers?.find((s) => s.id === serverId)
  const { data: channels = [] } = useChannels(serverId)
  const { data: members = [] } = useMembers(serverId)
  const { data: unread } = useUnread()
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const openModal = useUi((s) => s.openModal)
  const actions = useActions()
  const [menuOpen, setMenuOpen] = useState(false)
  const voiceChannel = useVoice((s) => (s.status !== 'idle' ? s.channelId : null))

  const role = members.find((m) => m.user_id === me)?.role ?? 'member'
  const canManage = role === 'owner' || role === 'admin'
  const activeChannel = view.kind === 'server' ? view.channelId : null
  const text = channels.filter((c) => c.kind === 'text')
  const voice = channels.filter((c) => c.kind === 'voice')

  // Kanal seçili değilse ya da silindiyse ilk yazı kanalını aç.
  useEffect(() => {
    if (view.kind !== 'server' || channels.length === 0) return
    if (!activeChannel || !channels.some((c) => c.id === activeChannel && c.kind === 'text')) {
      const first = text[0]
      if (first) setView({ kind: 'server', serverId, channelId: first.id })
    }
  }, [activeChannel, channels, serverId, setView, text, view.kind])

  useEffect(() => {
    if (activeChannel) rememberChannel(serverId, activeChannel)
  }, [activeChannel, serverId])

  if (!server) return null

  const menu = [
    { label: 'Arkadaş davet et', icon: UserPlus, onClick: () => openModal({ kind: 'invite', serverId }), show: true },
    { label: 'Kanal oluştur', icon: Plus, onClick: () => openModal({ kind: 'create-channel', serverId }), show: canManage },
    { label: 'Sunucu ayarları', icon: Settings, onClick: () => openModal({ kind: 'server-settings', serverId }), show: canManage },
    {
      label: 'Sunucudan ayrıl',
      icon: LogOut,
      danger: true,
      show: role !== 'owner',
      onClick: async () => {
        if (await confirmDialog({ title: 'Sunucudan ayrıl', text: `"${server.name}" sunucusundan ayrılmak istediğine emin misin?`, confirmLabel: 'Ayrıl' }))
          void actions.leaveServer(serverId)
      },
    },
    {
      label: 'Sunucuyu sil',
      icon: Trash2,
      danger: true,
      show: role === 'owner',
      onClick: async () => {
        if (
          await confirmDialog({
            title: 'Sunucuyu sil',
            text: `"${server.name}" ve içindeki tüm kanallar ile mesajlar kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
            confirmLabel: 'Kalıcı olarak sil',
          })
        )
          void actions.deleteServer(serverId)
      },
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-12 w-full items-center gap-2 border-b border-line px-3 text-left font-semibold text-fg hover:bg-hover"
        >
          <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent text-[10px] font-bold text-white">
            {server.icon_path ? <img src={publicImageUrl(server.icon_path) ?? ''} alt="" className="size-full object-cover" /> : initials(server.name)}
          </span>
          <span className="flex-1 truncate">{server.name}</span>
          <ChevronDown className={`size-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="anim-pop absolute top-12 right-2 left-2 z-40 rounded-lg border border-line bg-elevated p-1.5 shadow-pop">
              {menu
                .filter((m) => m.show)
                .map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      void m.onClick()
                    }}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium hover:bg-hover ${
                      m.danger ? 'text-accent' : 'text-fg'
                    }`}
                  >
                    {m.label}
                    <m.icon className="size-4" />
                  </button>
                ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3 scroll-thin">
        <ChannelGroup title="Yazı kanalları" canAdd={canManage} onAdd={() => openModal({ kind: 'create-channel', serverId })}>
          {text.map((c) => {
            const entry = unread?.get(c.id)
            return (
              <ChannelButton
                key={c.id}
                channel={c}
                active={c.id === activeChannel}
                unread={!!entry?.unread}
                mentions={entry?.mentions ?? 0}
                canManage={canManage}
                onClick={() => setView({ kind: 'server', serverId, channelId: c.id })}
                onSettings={() => openModal({ kind: 'channel-settings', channelId: c.id })}
              />
            )
          })}
        </ChannelGroup>
        <ChannelGroup title="Ses kanalları" canAdd={canManage} onAdd={() => openModal({ kind: 'create-channel', serverId })}>
          {voice.map((c) => (
            <div key={c.id}>
              <ChannelButton
                channel={c}
                active={voiceChannel === c.id}
                unread={false}
                mentions={0}
                canManage={canManage}
                onClick={() => me && void joinVoice(serverId, c.id, me)}
                onSettings={() => openModal({ kind: 'channel-settings', channelId: c.id })}
              />
              {me && <VoiceRoom channelId={c.id} me={me} />}
            </div>
          ))}
        </ChannelGroup>
      </div>
    </div>
  )
}

function ChannelGroup({ title, canAdd, onAdd, children }: { title: string; canAdd: boolean; onAdd: () => void; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between px-1.5 pb-1">
        <span className="text-xs font-bold tracking-wide text-faint uppercase">{title}</span>
        {canAdd && (
          <IconButton label="Kanal oluştur" className="size-5" onClick={onAdd}>
            <Plus className="size-4" />
          </IconButton>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}

function ChannelButton({
  channel,
  active,
  unread,
  mentions,
  canManage,
  onClick,
  onSettings,
}: {
  channel: ChannelRow
  active: boolean
  unread: boolean
  mentions: number
  canManage: boolean
  onClick: () => void
  onSettings: () => void
}) {
  const Icon = channel.kind === 'voice' ? Volume2 : Hash
  return (
    <div
      className={`group relative flex items-center rounded-md transition-colors ${
        active ? 'bg-selected text-fg' : unread ? 'text-fg hover:bg-hover' : 'text-muted hover:bg-hover hover:text-fg'
      }`}
    >
      {unread && !active && <span className="absolute -left-2 h-2 w-1 rounded-r-full bg-fg" />}
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
        <Icon className="size-[18px] shrink-0 opacity-70" />
        <span className={`truncate text-[15px] ${unread ? 'font-semibold' : 'font-medium'}`}>{channel.name}</span>
      </button>
      <Badge count={mentions} className="mr-1" />
      {canManage && (
        <IconButton label="Kanal ayarları" className="mr-1 size-6 opacity-0 group-hover:opacity-100" onClick={onSettings}>
          <Settings className="size-3.5" />
        </IconButton>
      )}
    </div>
  )
}
