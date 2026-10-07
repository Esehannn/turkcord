import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, Hash, Users } from 'lucide-react'
import { Avatar, STATUS_LABEL } from '@/components/Avatar'
import { EmptyState, IconButton, Spinner } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useBlocks, useChannel, useDms, useMembers, useMessages, useProfiles, useServerRoles, type ChatMessage } from '@/data/queries'
import { useTypingChannel } from '@/data/realtime'
import { formatDay, isSameDay, sameGroup } from '@/lib/format'
import { usePresence } from '@/stores/presence'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { TypingIndicator } from './TypingIndicator'

export function ChatView({ channelId, serverId }: { channelId: string; serverId?: string }) {
  const me = useSession((s) => s.session?.user.id) ?? ''
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

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const myProfile = profiles?.get(me)
  const dm = dms?.find((d) => d.channel_id === channelId)
  const dmUser = dm ? profiles?.get(dm.user_id) : undefined
  const dmStatus = usePresence((s) => (dm ? (s.online[dm.user_id] ?? 'offline') : 'offline'))
  const role = members.find((m) => m.user_id === me)?.role
  const canModerate = role === 'owner' || role === 'admin'

  const iBlocked = !!dm && blocks.some((b) => b.blocked_id === dm.user_id)
  const disabledReason = iBlocked ? 'Bu kişiyi engelledin. Mesaj göndermek için önce engeli kaldır.' : null

  // Mesajlar en yeniden eskiye: [0] en yeni.
  const list = useMemo(() => messages.data?.pages.flat() ?? [], [messages.data])
  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list])

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
    const last = list.find((m) => m.author_id === me && m.content)
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

  if (!myProfile) return null

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        {dm ? (
          <button type="button" className="flex items-center gap-2" onClick={() => openModal({ kind: 'profile', userId: dm.user_id })}>
            <AtSign className="size-5 text-faint" />
            <span className="font-semibold text-fg">{title}</span>
            <span className="text-xs text-muted">{dmUser?.custom_status || STATUS_LABEL[dmStatus]}</span>
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
        {serverId && (
          <IconButton label={memberList ? 'Üye listesini gizle' : 'Üye listesini göster'} onClick={() => setPrefs({ memberList: !memberList })}>
            <Users className={`size-5 ${memberList ? 'text-fg' : ''}`} />
          </IconButton>
        )}
      </header>

      {/* column-reverse: en yeni mesaj altta, yeni mesaj gelince kendiliğinden aşağıda kalır. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto pb-4 scroll-thin">
        {messages.isLoading ? (
          <div className="grid flex-1 place-items-center text-muted">
            <Spinner />
          </div>
        ) : (
          <>
            {list.map((message, i) => {
              const older = list[i + 1]
              const grouped = sameGroup(older, message)
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
                  />
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
      />
    </section>
  )
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="mx-4 mt-5 mb-1 flex items-center gap-3 text-xs font-semibold text-faint">
      <div className="h-px flex-1 bg-line" />
      {formatDay(iso)}
      <div className="h-px flex-1 bg-line" />
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
