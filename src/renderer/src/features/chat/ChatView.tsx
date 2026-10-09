import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, AtSign, Hash, Phone, Pin, Search, Upload, Users } from 'lucide-react'
import { Avatar, STATUS_LABEL } from '@/components/Avatar'
import { EmptyState, IconButton, Spinner } from '@/components/ui'
import { useActions } from '@/data/actions'
import { trimMessages } from '@/data/cache'
import {
  keys,
  useBlocks,
  useChannel,
  useDmRead,
  useDms,
  useMembers,
  useMessages,
  useProfiles,
  useServerRoles,
  type ChatMessage,
  type UnreadEntry,
} from '@/data/queries'
import { useTypingChannel } from '@/data/realtime'
import { CallBar } from '@/features/voice/CallBar'
import { formatDay, isSameDay, sameGroup } from '@/lib/format'
import { usePresence } from '@/stores/presence'
import { useSession } from '@/stores/session'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { startCall, useCall } from '@/voice/call'
import { PinsPanel, SearchPanel } from './ChannelPanel'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { TypingIndicator } from './TypingIndicator'

// Bu kadar yukarı kaydırılınca "en yeni mesajlara git" düğmesi belirir.
const JUMP_AFTER_PX = 400

// Bir mesaja atlarken en fazla bu kadar eski sayfa yüklenir (50'şer mesaj); daha eskisi "çok eski" sayılır.
const MAX_JUMP_PAGES = 20

// Okunmamış sayılan mesaj mı? (sunucudaki unread_counts ile aynı kural)
function countsAsUnread(message: ChatMessage, me: string): boolean {
  return message.author_id !== me && (message.kind !== 'call' || message.content === 'missed')
}

export function ChatView({ channelId, serverId }: { channelId: string; serverId?: string }) {
  const me = useSession((s) => s.session?.user.id) ?? ''
  const qc = useQueryClient()
  const { data: profiles } = useProfiles()
  const { data: channel } = useChannel(channelId)
  const { data: dms } = useDms()
  const { data: blocks = [] } = useBlocks()
  const { data: members = [] } = useMembers(serverId ?? null)
  const { data: roles = [] } = useServerRoles(serverId ?? null)
  const messages = useMessages(channelId)
  const actions = useActions()
  const memberList = useUi((s) => s.memberList)
  const setPrefs = useUi((s) => s.setPrefs)
  const openModal = useUi((s) => s.openModal)
  const sendTyping = useTypingChannel(channelId, me)
  const call = useCall((s) => s.call)

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dropped, setDropped] = useState<File[] | null>(null)
  const [panel, setPanel] = useState<'search' | 'pins' | null>(null)

  const myProfile = profiles?.get(me)
  const dm = dms?.find((d) => d.channel_id === channelId)
  const dmUser = dm ? profiles?.get(dm.user_id) : undefined
  const dmStatus = usePresence((s) => (dm ? (s.online[dm.user_id] ?? 'offline') : 'offline'))
  const role = members.find((m) => m.user_id === me)?.role
  const canModerate = role === 'owner' || role === 'admin'

  const iBlocked = !!dm && blocks.some((b) => b.blocked_id === dm.user_id)
  const disabledReason = iBlocked ? 'Bu kişiyi engelledin. Mesaj göndermek için önce engeli kaldır.' : null
  // Özel mesajda iki taraf da, sunucuda sahip ve yöneticiler mesaj sabitleyebilir.
  const canPin = dm ? !iBlocked : canModerate
  const { data: dmReadAt } = useDmRead(channelId, dm?.user_id)

  // Mesajlar en yeniden eskiye: [0] en yeni.
  const list = useMemo(() => messages.data?.pages.flat() ?? [], [messages.data])
  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list])

  // Kanal açılırken kaç okunmamış vardı? "Yeni mesajlar" çizgisi ilk okunmamışın üstüne konur.
  // (Aşağıdaki markRead sayacı sıfırlamadan önce okunur.)
  const [unreadAtOpen] = useState(() => qc.getQueryData<Map<string, UnreadEntry>>(keys.unread)?.get(channelId)?.unread ?? 0)
  const [dividerId, setDividerId] = useState<string | null | undefined>(unreadAtOpen > 0 ? undefined : null)
  useEffect(() => {
    if (dividerId !== undefined || list.length === 0) return
    let seen = 0
    for (const m of list) {
      if (!countsAsUnread(m, me)) continue
      seen++
      if (seen === unreadAtOpen) return setDividerId(m.id)
    }
    // İlk okunmamış henüz yüklenmedi (çok eski); çizgi gösterilmez.
    setDividerId(null)
  }, [dividerId, list, me, unreadAtOpen])

  // Kanal açıkken gelen mesajlar okunmuş sayılır.
  const newest = list[0]?.id
  useEffect(() => {
    if (document.hasFocus()) void actions.markRead(channelId)
    const onFocus = () => void actions.markRead(channelId)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [actions, channelId, newest])

  // Üyenin rol rengi (sohbette isim bu renkte görünür).
  const nameColors = useMemo(() => {
    const colorOf = new Map(roles.map((r) => [r.id, r.color]))
    const map = new Map<string, string>()
    for (const m of members) {
      const color = m.role_id ? colorOf.get(m.role_id) : undefined
      if (color) map.set(m.user_id, color)
    }
    return map
  }, [members, roles])

  const profileName = useCallback((id: string) => profiles?.get(id)?.display_name ?? 'Biri', [profiles])

  const editLast = useCallback(() => {
    const last = list.find((m) => m.author_id === me && m.kind === 'text' && m.content)
    if (last) setEditing(last.id)
  }, [list, me])

  // Yukarı kaydırınca eski mesajları yükle.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messages
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  // Kanaldan çıkınca yukarı kaydırırken yüklenen eski sayfalar bellekten atılır.
  useEffect(() => () => trimMessages(qc, channelId), [qc, channelId])

  // Bir mesaja git: henüz yüklenmediyse eski sayfalar yüklenir, sonra mesaj ortalanıp kısa süre vurgulanır.
  const pager = useRef({ hasNextPage, fetchNextPage })
  pager.current = { hasNextPage, fetchNextPage }
  const jumpTo = useCallback(async (id: string) => {
    const find = () => document.getElementById(`mesaj-${id}`)
    let more = pager.current.hasNextPage
    for (let i = 0; !find() && more && i < MAX_JUMP_PAGES; i++) {
      more = (await pager.current.fetchNextPage()).hasNextPage
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const el = find()
    if (!el) {
      toast.info('Mesaj bulunamadı; silinmiş ya da çok eski olabilir.')
      return
    }
    el.scrollIntoView({ block: 'center' })
    el.classList.remove('anim-flash')
    // Animasyonu baştan başlatmak için yeniden çizim beklenir.
    void el.offsetWidth
    el.classList.add('anim-flash')
  }, [])

  // Başka bir yerden gelen "şu mesaja git" isteği.
  const jump = useUi((s) => s.jump)
  useEffect(() => {
    if (!jump || jump.channelId !== channelId || messages.isLoading) return
    useUi.getState().setJump(null)
    void jumpTo(jump.messageId)
  }, [channelId, jump, jumpTo, messages.isLoading])

  // Ctrl+F: bu sohbette ara.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setPanel('search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // "Görüldü": özel mesajda en son mesaj benimse ve karşı taraf ondan sonra okuduysa.
  const last = list[0]
  const seenId = dm && last && last.author_id === me && last.kind !== 'call' && dmReadAt && dmReadAt >= last.created_at ? last.id : null

  // Yukarıdayken "en alta in" düğmesi ve o sırada gelen mesajların sayısı.
  // Liste column-reverse olduğu için en altta scrollTop 0'dır, yukarı çıktıkça eksiye gider.
  const scroller = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState(false)
  const [missed, setMissed] = useState(0)
  const awayRef = useRef(false)
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const next = Math.abs(el.scrollTop) > JUMP_AFTER_PX
    if (next === awayRef.current) return
    awayRef.current = next
    setAway(next)
    if (!next) setMissed(0)
  }, [])
  const toBottom = useCallback((smooth = true) => {
    scroller.current?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
  }, [])
  const lastNewest = useRef<string | undefined>(undefined)
  useEffect(() => {
    const first = list[0]
    if (!first || first.id === lastNewest.current) return
    const initial = lastNewest.current === undefined
    lastNewest.current = first.id
    if (initial) return
    // Kendi mesajım: her zaman en alta in. Başkasınınki: yukarıdaysam sayaç artar.
    if (first.author_id === me) toBottom(false)
    else if (awayRef.current) setMissed((n) => n + 1)
  }, [list, me, toBottom])

  // "@" ile etiketlenebilecekler: sunucu üyeleri ya da özel mesajdaki kişi.
  const mentionables = useMemo(() => {
    const ids = dm ? [dm.user_id] : members.map((m) => m.user_id)
    return ids
      .filter((id) => id !== me)
      .map((id) => profiles?.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
  }, [dm, members, me, profiles])

  const title = dm ? dm.display_name : (channel?.name ?? '')
  const placeholder = dm ? `@${dm.display_name} kişisine mesaj gönder` : `#${channel?.name ?? ''} kanalına mesaj gönder`
  const callHere = call?.channelId === channelId ? call : null
  const callPeer = useCallback(() => {
    if (dm) void startCall(channelId, dm.user_id)
  }, [channelId, dm])

  // Dosyayı sohbetin herhangi bir yerine sürükleyip bırakmak yeterli.
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const dragDepth = useRef(0)

  if (!myProfile) return null

  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e) || disabledReason) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        if (!disabledReason && e.dataTransfer.files.length) setDropped([...e.dataTransfer.files])
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        {dm ? (
          <button type="button" className="flex min-w-0 items-center gap-2" onClick={() => openModal({ kind: 'profile', userId: dm.user_id })}>
            <AtSign className="size-5 shrink-0 text-faint" />
            <span className="truncate font-semibold text-fg">{title}</span>
            <span className="truncate text-xs text-muted">{dmUser?.custom_status || STATUS_LABEL[dmStatus]}</span>
          </button>
        ) : (
          <>
            <Hash className="size-5 text-faint" />
            <span className="font-semibold text-fg">{title}</span>
            {channel?.topic && (
              <>
                <span className="mx-1 h-5 w-px bg-line" />
                <span className="truncate text-sm text-muted">{channel.topic}</span>
              </>
            )}
          </>
        )}
        <div className="flex-1" />
        <IconButton label="Bu sohbette ara (Ctrl+F)" onClick={() => setPanel(panel === 'search' ? null : 'search')}>
          <Search className={`size-5 ${panel === 'search' ? 'text-fg' : ''}`} />
        </IconButton>
        <IconButton label="Sabitlenmiş mesajlar" onClick={() => setPanel(panel === 'pins' ? null : 'pins')}>
          <Pin className={`size-5 ${panel === 'pins' ? 'text-fg' : ''}`} />
        </IconButton>
        {dm && !iBlocked && (
          <IconButton label={call ? 'Zaten bir aramadasın' : `${dm.display_name} kişisini ara`} disabled={!!call} onClick={callPeer}>
            <Phone className="size-5" />
          </IconButton>
        )}
        {serverId && (
          <IconButton label={memberList ? 'Üye listesini gizle' : 'Üye listesini göster'} onClick={() => setPrefs({ memberList: !memberList })}>
            <Users className={`size-5 ${memberList ? 'text-fg' : ''}`} />
          </IconButton>
        )}
      </header>

      {callHere && dm && <CallBar call={callHere} me={me} />}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* column-reverse: en yeni mesaj altta, yeni mesaj gelince kendiliğinden aşağıda kalır. */}
        <div ref={scroller} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto pb-4 scroll-thin">
          {messages.isLoading ? (
            <MessageSkeleton />
          ) : (
            <>
              {list.map((message, i) => {
                const older = list[i + 1]
                const grouped = sameGroup(older, message) && older?.kind === 'text' && message.kind !== 'poll' && dividerId !== message.id
                const replied = message.reply_to ? byId.get(message.reply_to) : undefined
                return (
                  <Fragment key={message.id}>
                    <MessageItem
                      message={message}
                      grouped={grouped}
                      me={myProfile}
                      author={message.author_id ? profiles?.get(message.author_id) : undefined}
                      replied={replied}
                      repliedAuthor={replied?.author_id ? profiles?.get(replied.author_id) : undefined}
                      canModerate={canModerate}
                      canPost={!disabledReason}
                      editing={editing === message.id}
                      onEdit={setEditing}
                      onReply={setReplyTo}
                      profileName={profileName}
                      nameColor={message.author_id ? nameColors.get(message.author_id) : undefined}
                      onCallBack={dm && !iBlocked && !call ? callPeer : undefined}
                      canPin={canPin}
                      seen={seenId === message.id}
                      onJumpTo={jumpTo}
                    />
                    {dividerId === message.id && <NewDivider />}
                    {(!older || !isSameDay(older.created_at, message.created_at)) && <DayDivider iso={message.created_at} />}
                  </Fragment>
                )
              })}
              {hasNextPage ? (
                <div ref={sentinel} className="grid h-16 shrink-0 place-items-center text-muted">
                  {isFetchingNextPage && <Spinner />}
                </div>
              ) : (
                <ChannelStart dmName={dm?.display_name} dmAvatar={dm?.avatar_path} channelName={channel?.name ?? ''} />
              )}
            </>
          )}
        </div>

        {panel === 'search' && <SearchPanel channelId={channelId} onJump={(m) => void jumpTo(m.id)} onClose={() => setPanel(null)} />}
        {panel === 'pins' && <PinsPanel channelId={channelId} canPin={canPin} onJump={(m) => void jumpTo(m.id)} onClose={() => setPanel(null)} />}

        {away && (
          <button
            type="button"
            onClick={() => toBottom()}
            className={`anim-pop absolute right-5 bottom-3 z-10 flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold shadow-pop transition-colors ${
              missed > 0 ? 'border-accent bg-accent text-on-accent hover:bg-accent-hover' : 'border-line bg-elevated text-fg hover:bg-hover'
            }`}
            title="En yeni mesajlara git"
          >
            {missed > 0 && <span>{missed > 99 ? '99+' : missed} yeni mesaj</span>}
            <ArrowDown className="size-4" />
          </button>
        )}
      </div>

      <TypingIndicator channelId={channelId} />
      <Composer
        channelId={channelId}
        userId={me}
        placeholder={placeholder}
        disabledReason={disabledReason}
        replyTo={replyTo}
        replyName={replyTo?.author_id ? profileName(replyTo.author_id) : ''}
        onCancelReply={() => setReplyTo(null)}
        onEditLast={editLast}
        onTyping={sendTyping}
        mentionables={mentionables}
        dropped={dropped}
        onDroppedTaken={() => setDropped(null)}
      />

      {dragging && (
        <div className="anim-fade pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/90">
          <div className="flex flex-col items-center gap-2 text-accent">
            <Upload className="size-10" />
            <p className="text-lg font-bold">Göndermek için bırak</p>
            <p className="text-sm">{dm ? `@${dm.display_name}` : `#${channel?.name ?? ''}`}</p>
          </div>
        </div>
      )}
    </section>
  )
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="mx-4 mt-5 mb-1 flex items-center gap-3 text-xs font-semibold text-faint compact:mt-3">
      <div className="h-px flex-1 bg-line" />
      {formatDay(iso)}
      <div className="h-px flex-1 bg-line" />
    </div>
  )
}

// Kanalı açtığında okumadığın mesajların başladığı yer.
function NewDivider() {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 text-xs font-bold text-accent" role="separator" aria-label="Yeni mesajlar">
      <div className="h-px flex-1 bg-accent" />
      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] tracking-wide text-on-accent uppercase">Yeni mesajlar</span>
    </div>
  )
}

// Mesajlar yüklenirken görünen gri yer tutucular.
const SKELETON_ROWS = [72, 44, 88, 36, 64, 52, 80, 40]
function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-5 px-4 pt-4" aria-hidden>
      {SKELETON_ROWS.map((width, i) => (
        <div key={i} className="flex gap-3">
          <div className="skeleton size-10 shrink-0" style={{ borderRadius: 9999 }} />
          <div className="flex-1 space-y-2 pt-1">
            <div className="skeleton h-3 w-28" />
            <div className="skeleton h-3" style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ChannelStart({ dmName, dmAvatar, channelName }: { dmName?: string; dmAvatar?: string | null; channelName: string }) {
  if (dmName) {
    return (
      <div className="px-4 pt-8 pb-2">
        <Avatar name={dmName} path={dmAvatar} size={72} />
        <h2 className="mt-3 text-2xl font-bold text-fg">{dmName}</h2>
        <p className="text-sm text-muted">{dmName} ile özel sohbetinin başlangıcı. Çaylar senden!</p>
      </div>
    )
  }
  return (
    <div className="px-4 pt-8 pb-2">
      <div className="grid size-16 place-items-center rounded-full bg-accent-soft">
        <Hash className="size-9 text-accent" />
      </div>
      <h2 className="mt-3 text-2xl font-bold text-fg">#{channelName} kanalına hoş geldin!</h2>
      <p className="text-sm text-muted">Burası #{channelName} kanalının başlangıcı.</p>
    </div>
  )
}

export function NoChannel() {
  return <EmptyState icon={<Hash className="size-10" />} title="Kanal bulunamadı" />
}
