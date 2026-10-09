import { useEffect, useMemo, useRef } from 'react'
import { WifiOff } from 'lucide-react'
import { useProfiles, useServers, useUnread } from '@/data/queries'
import { usePresenceSync, useRealtimeSync } from '@/data/realtime'
import { setUnreadBadge } from '@/lib/notify'
import { isMuted, useUi } from '@/stores/ui'
import { NotificationCards } from '@/components/NotificationCards'
import { Splash } from '@/components/Splash'
import { ChatView } from '@/features/chat/ChatView'
import { FriendsView } from '@/features/home/FriendsView'
import { HomeSidebar } from '@/features/home/HomeSidebar'
import { MemberList } from '@/features/servers/MemberList'
import { ServerSidebar } from '@/features/servers/ServerSidebar'
import { autoCleanupOldFiles } from '@/features/settings/AdminPanel'
import { ModalHost } from './ModalHost'
import { ServerRail } from './ServerRail'
import { UserPanel } from './UserPanel'
import { IncomingCall } from '@/features/voice/IncomingCall'
import { VoicePanel } from '@/features/voice/VoicePanel'
import { initCalls } from '@/voice/call'
import { leaveVoice } from '@/voice/engine'
import { startDesktopBridge } from '@/lib/desktop'
import { TeaGlass } from '@/components/TeaGlass'
import { Button, EmptyState } from '@/components/ui'

export function MainLayout({ userId }: { userId: string }) {
  useRealtimeSync(userId)
  usePresenceSync(userId)
  const profiles = useProfiles()
  const servers = useServers()
  const unread = useUnread()
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const memberList = useUi((s) => s.memberList)
  const muted = useUi((s) => s.muted)

  // Oturum kapanınca ses kanalından da çık.
  useEffect(() => () => void leaveVoice(false), [])

  // Bireysel aramalar: gelen aramayı dinle, çalan varsa göster.
  const profileMap = useRef(profiles.data)
  profileMap.current = profiles.data
  useEffect(() => initCalls(userId, (id) => profileMap.current?.get(id)?.display_name ?? 'Biri'), [userId])
  useEffect(() => startDesktopBridge(), [])

  // Yöneticinin uygulaması açıkken eski ve büyük dosya ekleri günde bir kez temizlenir (1 GB'lık alan dolmasın).
  const isAdmin = !!profiles.data?.get(userId)?.is_admin
  useEffect(() => {
    if (isAdmin) autoCleanupOldFiles()
  }, [isAdmin])

  // Bildirim izni bir kez istenir (Windows'ta genelde otomatik verilir).
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  }, [])

  // Görev çubuğu rozeti: okunmamış DM'ler ve etiketlenmeler.
  const badge = useMemo(() => {
    let total = 0
    for (const entry of unread.data?.values() ?? []) {
      // Sessize alınan özel mesajlar rozete girmez; etiketlenmeler her zaman sayılır.
      if (entry.server_id) total += entry.mentions
      else if (!isMuted(muted, entry.channel_id)) total += entry.unread
    }
    return total
  }, [muted, unread.data])
  useEffect(() => setUnreadBadge(badge), [badge])

  // Ctrl+K: hızlı geçiş (sohbete ya da kanala atla).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const ui = useUi.getState()
        if (ui.modal?.kind === 'quick-switch') ui.closeModal()
        else if (!ui.modal) ui.openModal({ kind: 'quick-switch' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Silinen ya da ayrılınan sunucudaysak ana sayfaya dön.
  useEffect(() => {
    if (view.kind === 'server' && servers.data && !servers.data.some((s) => s.id === view.serverId)) {
      setView({ kind: 'home', tab: 'online' })
    }
  }, [servers.data, view, setView])

  // İlk veriler gelene kadar arayüz kurulmaz. Yüklenemezse hata ekranı gösterilir ve seyrek aralıklarla
  // yeniden denenir. (Eskiden arayüz her hatada kurulup yıkılıyor, bu da saniyede onlarca isteğe yol açıyordu.)
  if (!profiles.data || !servers.data) {
    const failed = (profiles.isError && !profiles.data) || (servers.isError && !servers.data)
    if (!failed) return <Splash text="Sohbetler yükleniyor…" />
    return (
      <LoadError
        onRetry={() => {
          if (!profiles.data) void profiles.refetch()
          if (!servers.data) void servers.refetch()
        }}
      />
    )
  }

  return (
    <div className="flex h-full">
      <ServerRail />
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar">
        <div className="min-h-0 flex-1">{view.kind === 'server' ? <ServerSidebar serverId={view.serverId} /> : <HomeSidebar />}</div>
        <VoicePanel />
        <UserPanel userId={userId} />
      </aside>
      <main className="flex min-w-0 flex-1 bg-chat">
        {view.kind === 'home' && <FriendsView />}
        {view.kind === 'dm' && <ChatView key={view.channelId} channelId={view.channelId} />}
        {view.kind === 'server' &&
          (view.channelId ? (
            <ChatView key={view.channelId} channelId={view.channelId} serverId={view.serverId} />
          ) : (
            <EmptyState icon={<TeaGlass />} title="Bir kanal seç" text="Soldaki listeden bir yazı kanalı seç ya da Ctrl+K ile ara." />
          ))}
        {view.kind === 'server' && memberList && <MemberList serverId={view.serverId} />}
      </main>
      <ModalHost />
      <IncomingCall />
      <NotificationCards />
    </div>
  )
}

const RETRY_EVERY_MS = 15_000

// Sunucuya ulaşılamadı: kullanıcı beklerken 15 saniyede bir kendiliğinden yeniden denenir.
function LoadError({ onRetry }: { onRetry: () => void }) {
  const retry = useRef(onRetry)
  retry.current = onRetry
  useEffect(() => {
    const timer = setTimeout(() => retry.current(), RETRY_EVERY_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-chat p-8 text-center">
      <div className="grid size-24 place-items-center rounded-full bg-accent-soft text-accent">
        <WifiOff className="size-10" />
      </div>
      <p className="font-semibold text-fg">Sunucuya ulaşılamıyor</p>
      <p className="max-w-sm text-sm text-muted">İnternet bağlantını kontrol et. Birkaç saniyede bir kendiliğinden yeniden denenecek.</p>
      <Button onClick={onRetry}>Şimdi tekrar dene</Button>
    </div>
  )
}
