import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { CallRow, ChannelRow, FriendshipRow, MessageRow, ProfileRow, ReactionRow, ServerMemberRow } from '@/lib/database.types'
import { fileKind } from '@/lib/files'
import { mentionsUser } from '@/lib/markdown'
import { showNotification } from '@/lib/notify'
import { usePresence, type OnlineStatus } from '@/stores/presence'
import { useUi } from '@/stores/ui'
import { onCallRow } from '@/voice/call'
import { addMessage, addReaction, bumpUnread, removeMessage, removeReaction, updateMessage } from './cache'
import { keys } from './queries'

const IDLE_AFTER_SECONDS = 10 * 60

// Kullanıcının şu an bu kanala bakıp bakmadığı (pencere odakta ve kanal açık).
export function isViewingChannel(channelId: string): boolean {
  const view = useUi.getState().view
  const open =
    (view.kind === 'dm' && view.channelId === channelId) || (view.kind === 'server' && view.channelId === channelId)
  return open && document.hasFocus()
}

async function channelInfo(qc: ReturnType<typeof useQueryClient>, channelId: string): Promise<ChannelRow | null> {
  const cached = qc.getQueryData<ChannelRow | null>(keys.channel(channelId))
  if (cached) return cached
  for (const [, list] of qc.getQueriesData<ChannelRow[]>({ queryKey: ['channels'] })) {
    const found = list?.find((c) => c.id === channelId)
    if (found) return found
  }
  const { data } = await supabase.from('channels').select('*').eq('id', channelId).maybeSingle()
  if (data) qc.setQueryData(keys.channel(channelId), data)
  return data
}

function attachmentText(row: MessageRow): string {
  const first = row.attachments[0]
  if (!first) return ''
  const kind = fileKind(first)
  if (kind === 'image') return '🖼️ Görsel gönderdi'
  return `📎 ${first.name ?? 'Dosya'} gönderdi`
}

// Veritabanı değişikliklerini dinler. Her kullanıcı sadece görmeye yetkili olduğu satırları alır (RLS).
export function useRealtimeSync(userId: string): void {
  const qc = useQueryClient()

  useEffect(() => {
    let wasDisconnected = false

    const onMessage = async (row: MessageRow) => {
      addMessage(qc, row)
      const channel = await channelInfo(qc, row.channel_id)
      if (channel?.kind === 'dm') void qc.invalidateQueries({ queryKey: keys.dms })
      if (row.author_id === userId) return
      // Arama kayıtlarından sadece cevapsız aramalar bildirilir.
      const isCall = row.kind === 'call'
      if (isCall && row.content !== 'missed') return
      if (isViewingChannel(row.channel_id)) return

      const profiles = qc.getQueryData<Map<string, ProfileRow>>(keys.profiles)
      const me = profiles?.get(userId)
      const mentioned = !isCall && !!me && mentionsUser(row.content, me.username)
      bumpUnread(qc, row.channel_id, channel?.server_id ?? null, mentioned)

      const author = row.author_id ? profiles?.get(row.author_id) : undefined
      const name = author?.display_name ?? 'Biri'
      const avatar = { name, path: author?.avatar_path }
      const body = row.content || attachmentText(row)
      const onClick = () => {
        if (!channel) return
        useUi
          .getState()
          .setView(
            channel.kind === 'dm' || !channel.server_id
              ? { kind: 'dm', channelId: row.channel_id }
              : { kind: 'server', serverId: channel.server_id, channelId: row.channel_id },
          )
      }

      if (channel?.kind === 'dm') {
        showNotification(
          isCall
            ? { title: 'Cevapsız arama', body: `${name} seni aradı.`, sound: 'message', avatar, onClick }
            : { title: name, body, sound: 'message', avatar, onClick },
        )
      } else if (mentioned) {
        showNotification({ title: `${name} seni etiketledi`, body, sound: 'mention', avatar, onClick })
      } else if (useUi.getState().notifyAll) {
        showNotification({ title: `${name} · #${channel?.name ?? 'kanal'}`, body, sound: 'channel', avatar, onClick })
      }
    }

    const channel: RealtimeChannel = supabase
      .channel(`db:${userId}`, { config: { private: true } })
      .on<MessageRow>('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        void onMessage(p.new)
      })
      .on<MessageRow>('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) =>
        updateMessage(qc, p.new),
      )
      .on<MessageRow>('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => {
        if (p.old.id) removeMessage(qc, p.old.id)
      })
      .on<ReactionRow>('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (p) =>
        addReaction(qc, p.new),
      )
      .on<ReactionRow>('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (p) => {
        const id = p.old.id
        if (id) removeReaction(qc, (r) => r.id === id)
      })
      .on<FriendshipRow>('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, (p) => {
        void qc.invalidateQueries({ queryKey: keys.friendships })
        if (p.eventType === 'INSERT' && p.new.addressee_id === userId) {
          const from = qc.getQueryData<Map<string, ProfileRow>>(keys.profiles)?.get(p.new.requester_id)
          const name = from?.display_name ?? 'Biri'
          showNotification({
            title: 'Arkadaşlık isteği',
            body: `${name} sana arkadaşlık isteği gönderdi.`,
            sound: 'friend',
            avatar: { name, path: from?.avatar_path },
            onClick: () => useUi.getState().setView({ kind: 'home', tab: 'pending' }),
          })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servers' }, () => {
        void qc.invalidateQueries({ queryKey: keys.servers })
      })
      .on<ServerMemberRow>('postgres_changes', { event: '*', schema: 'public', table: 'server_members' }, (p) => {
        const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<ServerMemberRow>
        if (row.server_id) void qc.invalidateQueries({ queryKey: keys.members(row.server_id) })
        if (row.user_id === userId) {
          void qc.invalidateQueries({ queryKey: keys.servers })
          void qc.invalidateQueries({ queryKey: keys.unread })
          const view = useUi.getState().view
          if (p.eventType === 'DELETE' && view.kind === 'server' && view.serverId === row.server_id) {
            useUi.getState().setView({ kind: 'home', tab: 'online' })
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_roles' }, (p) => {
        const row = (p.eventType === 'DELETE' ? p.old : p.new) as { server_id?: string }
        void qc.invalidateQueries({ queryKey: row.server_id ? keys.roles(row.server_id) : ['roles'] })
        // Silinen rol üyelerden de kalkar.
        if (p.eventType === 'DELETE') void qc.invalidateQueries({ queryKey: ['members'] })
      })
      .on<ChannelRow>('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, (p) => {
        const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<ChannelRow>
        if (row.server_id) void qc.invalidateQueries({ queryKey: keys.channels(row.server_id) })
        else void qc.invalidateQueries({ queryKey: ['channels'] })
        if (row.id) void qc.invalidateQueries({ queryKey: keys.channel(row.id) })
        const view = useUi.getState().view
        if (p.eventType === 'DELETE' && view.kind === 'server' && view.channelId === row.id) {
          useUi.getState().setView({ ...view, channelId: null })
        }
      })
      .on<CallRow>('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, (p) => {
        if (p.eventType !== 'DELETE') onCallRow(p.new)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_members' }, () => {
        void qc.invalidateQueries({ queryKey: keys.dms })
      })
      .on<ProfileRow>('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (p) => {
        if (p.eventType === 'DELETE') {
          void qc.invalidateQueries({ queryKey: keys.profiles })
          return
        }
        qc.setQueryData<Map<string, ProfileRow>>(keys.profiles, (map) => {
          const next = new Map(map ?? [])
          next.set(p.new.id, p.new)
          return next
        })
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && wasDisconnected) {
          // Bağlantı koptuysa kaçırılan olayları telafi etmek için verileri yenile.
          void qc.invalidateQueries()
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') wasDisconnected = true
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [qc, userId])
}

// Çevrimiçi durumu: herkes "online" kanalına kendi durumunu bildirir. Görünmez seçilirse bildirilmez.
export function usePresenceSync(userId: string): void {
  const status = useUi((s) => s.status)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const idleRef = useRef(false)

  useEffect(() => {
    const channel = supabase.channel('online', { config: { private: true, presence: { key: userId } } })
    channelRef.current = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ status: OnlineStatus }>()
        const online: Record<string, OnlineStatus> = {}
        for (const [key, metas] of Object.entries(state)) {
          const meta = metas[metas.length - 1]
          if (meta?.status) online[key] = meta.status
        }
        usePresence.setState({ online })
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') void track()
      })

    async function track() {
      const chosen = useUi.getState().status
      if (chosen === 'invisible') {
        await channel.untrack()
        return
      }
      const effective: OnlineStatus = chosen === 'online' && idleRef.current ? 'idle' : chosen
      await channel.track({ status: effective })
    }

    const interval = setInterval(async () => {
      const seconds = (await window.turkcord?.idleSeconds?.()) ?? 0
      const idle = seconds >= IDLE_AFTER_SECONDS
      if (idle !== idleRef.current) {
        idleRef.current = idle
        void track()
      }
    }, 30_000)

    return () => {
      clearInterval(interval)
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [userId])

  // Durum değişince yeniden bildir (ilk bildirim kanala katılınca yapılır).
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const channel = channelRef.current
    if (!channel) return
    if (status === 'invisible') void channel.untrack()
    else void channel.track({ status: status === 'online' && idleRef.current ? 'idle' : status })
  }, [status])
}

// "Yazıyor..." göstergesi için kanal başına kısa ömürlü yayın kanalı.
export function useTypingChannel(channelId: string, userId: string): () => void {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastSent = useRef(0)

  useEffect(() => {
    const channel = supabase.channel(`chan:${channelId}`, { config: { private: true, broadcast: { self: false } } })
    channelRef.current = channel
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const from = (payload as { user_id?: string }).user_id
        if (!from || from === userId) return
        usePresence.setState((s) => ({
          typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [from]: Date.now() } },
        }))
      })
      .subscribe()

    return () => {
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [channelId, userId])

  return () => {
    const now = Date.now()
    if (now - lastSent.current < 3000) return
    lastSent.current = now
    void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId } })
  }
}
