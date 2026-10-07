import { useEffect, useMemo } from 'react'
import { useProfiles, useServers, useUnread } from '@/data/queries'
import { usePresenceSync, useRealtimeSync } from '@/data/realtime'
import { setUnreadBadge } from '@/lib/notify'
import { useUi } from '@/stores/ui'
import { Splash } from '@/components/Splash'
import { ChatView } from '@/features/chat/ChatView'
import { FriendsView } from '@/features/home/FriendsView'
import { HomeSidebar } from '@/features/home/HomeSidebar'
import { MemberList } from '@/features/servers/MemberList'
import { ServerSidebar } from '@/features/servers/ServerSidebar'
import { ModalHost } from './ModalHost'
import { ServerRail } from './ServerRail'
import { UserPanel } from './UserPanel'
import { EmptyState } from '@/components/ui'
import { Hash } from 'lucide-react'

export function MainLayout({ userId }: { userId: string }) {
  useRealtimeSync(userId)
  usePresenceSync(userId)
  const profiles = useProfiles()
  const servers = useServers()
  const unread = useUnread()
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const memberList = useUi((s) => s.memberList)

  // Bildirim izni bir kez istenir (Windows'ta genelde otomatik verilir).
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  }, [])

  // Görev çubuğu rozeti: okunmamış DM'ler ve etiketlenmeler.
  const badge = useMemo(() => {
    let total = 0
    for (const entry of unread.data?.values() ?? []) total += entry.server_id ? entry.mentions : entry.unread
    return total
  }, [unread.data])
  useEffect(() => setUnreadBadge(badge), [badge])

  // Silinen ya da ayrılınan sunucudaysak ana sayfaya dön.
  useEffect(() => {
    if (view.kind === 'server' && servers.data && !servers.data.some((s) => s.id === view.serverId)) {
      setView({ kind: 'home', tab: 'online' })
    }
  }, [servers.data, view, setView])

  if (profiles.isLoading || servers.isLoading) return <Splash />

  return (
    <div className="flex h-full">
      <ServerRail />
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar">
        <div className="min-h-0 flex-1">{view.kind === 'server' ? <ServerSidebar serverId={view.serverId} /> : <HomeSidebar />}</div>
        <UserPanel userId={userId} />
      </aside>
      <main className="flex min-w-0 flex-1 bg-chat">
        {view.kind === 'home' && <FriendsView />}
        {view.kind === 'dm' && <ChatView key={view.channelId} channelId={view.channelId} />}
        {view.kind === 'server' &&
          (view.channelId ? (
            <ChatView key={view.channelId} channelId={view.channelId} serverId={view.serverId} />
          ) : (
            <EmptyState icon={<Hash className="size-10" />} title="Bir kanal seç" text="Soldaki listeden bir yazı kanalı seç." />
          ))}
        {view.kind === 'server' && memberList && <MemberList serverId={view.serverId} />}
      </main>
      <ModalHost />
    </div>
  )
}
