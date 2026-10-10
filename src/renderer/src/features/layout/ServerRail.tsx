import { useState, type MouseEvent } from 'react'
import { Plus, UserPlus } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ContextMenu } from '@/components/Menu'
import { muteMenuItem } from '@/components/muteMenu'
import { useServers, useUnread } from '@/data/queries'
import { initials } from '@/lib/format'
import { publicImageUrl } from '@/lib/supabase'
import { useUi } from '@/stores/ui'
import type { ReactNode } from 'react'

export function ServerRail() {
  const { data: servers = [] } = useServers()
  const { data: unread } = useUnread()
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const openModal = useUi((s) => s.openModal)
  const muted = useUi((s) => s.muted)
  const [menu, setMenu] = useState<{ x: number; y: number; serverId: string } | null>(null)

  let dmUnread = 0
  const serverState = new Map<string, { unread: boolean; mentions: number }>()
  for (const entry of unread?.values() ?? []) {
    // Sessize alınanlar okunmamış olarak görünmez; etiketlenmeler yine sayılır.
    const quiet = muted.includes(entry.channel_id) || (!!entry.server_id && muted.includes(entry.server_id))
    if (!entry.server_id) {
      if (!quiet) dmUnread += entry.unread
      continue
    }
    const s = serverState.get(entry.server_id) ?? { unread: false, mentions: 0 }
    serverState.set(entry.server_id, { unread: s.unread || (!quiet && entry.unread > 0), mentions: s.mentions + entry.mentions })
  }

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-3 scroll-thin" aria-label="Sunucular">
      <RailItem
        label="Ana Sayfa"
        active={view.kind !== 'server'}
        badge={dmUnread}
        onClick={() => setView({ kind: 'home', tab: 'online' })}
      >
        <Logo size={48} variant="mark" className="p-1.5" />
      </RailItem>
      <div className="h-0.5 w-8 rounded-full bg-rail-item" />
      {servers.map((server) => {
        const state = serverState.get(server.id)
        const icon = publicImageUrl(server.icon_path)
        return (
          <RailItem
            key={server.id}
            label={server.name}
            active={view.kind === 'server' && view.serverId === server.id}
            unread={state?.unread}
            badge={state?.mentions ?? 0}
            onClick={() => setView({ kind: 'server', serverId: server.id, channelId: rememberedChannel(server.id) })}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, serverId: server.id })
            }}
          >
            {icon ? (
              <img src={icon} alt="" className="size-full object-cover" draggable={false} />
            ) : (
              <span className="text-sm font-bold">{initials(server.name)}</span>
            )}
          </RailItem>
        )
      })}
      <RailItem label="Sunucu oluştur ya da katıl" onClick={() => openModal({ kind: 'create-server' })}>
        <Plus className="size-6" />
      </RailItem>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            muteMenuItem(menu.serverId, { on: 'Sunucuyu sessize al', off: 'Sunucunun sesini aç' }),
            { label: 'Arkadaş davet et', icon: UserPlus, onClick: () => openModal({ kind: 'invite', serverId: menu.serverId }) },
          ]}
        />
      )}
    </nav>
  )
}

function RailItem({
  label,
  active = false,
  unread = false,
  badge = 0,
  onClick,
  onContextMenu,
  children,
}: {
  label: string
  active?: boolean
  unread?: boolean
  badge?: number
  onClick: () => void
  onContextMenu?: (e: MouseEvent) => void
  children: ReactNode
}) {
  return (
    <div className="group relative flex w-full justify-center">
      <span
        className={`absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-rail-text transition-all ${
          active ? 'h-10' : unread ? 'h-2' : 'h-0 group-hover:h-5'
        }`}
      />
      <button
        type="button"
        data-tip={label}
        data-tip-side="right"
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={`grid size-12 place-items-center overflow-hidden transition-all ${
          active
            ? 'rounded-2xl bg-rail-active text-rail-active-text'
            : 'rounded-3xl bg-rail-item text-rail-text hover:rounded-2xl hover:bg-rail-item-hover'
        }`}
      >
        {children}
      </button>
      {badge > 0 && (
        <span
          key={badge}
          className="anim-bump pointer-events-none absolute right-2.5 bottom-0 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-accent ring-4 ring-rail dark:bg-accent dark:text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
  )
}

// Her sunucuda en son açılan kanal hatırlanır.
const LAST_CHANNEL_KEY = 'turkcord-son-kanallar'

export function rememberedChannel(serverId: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_CHANNEL_KEY) ?? '{}') as Record<string, string>
    return map[serverId] ?? null
  } catch {
    return null
  }
}

export function rememberChannel(serverId: string, channelId: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_CHANNEL_KEY) ?? '{}') as Record<string, string>
    map[serverId] = channelId
    localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify(map))
  } catch {
    // önemli değil
  }
}
