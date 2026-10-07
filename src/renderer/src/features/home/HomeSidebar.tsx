import { Users } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Badge } from '@/components/ui'
import { useDms, useFriendships, useUnread } from '@/data/queries'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'

export function HomeSidebar() {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const me = useSession((s) => s.session?.user.id)
  const { data: dms = [] } = useDms()
  const { data: unread } = useUnread()
  const { data: friendships = [] } = useFriendships()
  const pending = friendships.filter((f) => f.status === 'pending' && f.addressee_id === me).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b border-line px-3 font-semibold text-fg">Sohbetler</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2 scroll-thin">
        <button
          type="button"
          onClick={() => setView({ kind: 'home', tab: pending ? 'pending' : 'online' })}
          className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left font-medium transition-colors ${
            view.kind === 'home' ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg'
          }`}
        >
          <Users className="size-5" />
          <span className="flex-1">Arkadaşlar</span>
          <Badge count={pending} />
        </button>

        <p className="px-2.5 pt-4 pb-1 text-xs font-bold tracking-wide text-faint uppercase">Özel mesajlar</p>
        {dms.length === 0 && <p className="px-2.5 py-2 text-xs text-faint">Henüz özel mesajın yok. Arkadaşlarına yaz!</p>}
        {dms.map((dm) => {
          const active = view.kind === 'dm' && view.channelId === dm.channel_id
          const count = unread?.get(dm.channel_id)?.unread ?? 0
          return (
            <button
              key={dm.channel_id}
              type="button"
              onClick={() => setView({ kind: 'dm', channelId: dm.channel_id })}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                active ? 'bg-selected text-fg' : count ? 'text-fg hover:bg-hover' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              <Avatar name={dm.display_name} path={dm.avatar_path} userId={dm.user_id} size={32} showStatus />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${count ? 'font-bold' : 'font-medium'}`}>{dm.display_name}</span>
                {dm.custom_status && <span className="block truncate text-xs text-faint">{dm.custom_status}</span>}
              </span>
              <Badge count={count} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
