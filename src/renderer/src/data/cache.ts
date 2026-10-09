import type { QueryClient } from '@tanstack/react-query'
import type { MessageRow, PollVoteRow, ReactionRow } from '@/lib/database.types'
import { keys, type ChatMessage, type MessagePages, type UnreadEntry } from './queries'

// Mesaj önbelleğini gerçek zamanlı olaylarla ve kullanıcının kendi işlemleriyle güncelleyen yardımcılar.

function mapAllMessageCaches(qc: QueryClient, fn: (data: MessagePages) => MessagePages): void {
  for (const [key, data] of qc.getQueriesData<MessagePages>({ queryKey: ['messages'] })) {
    if (data) qc.setQueryData(key, fn(data))
  }
}

export function addMessage(qc: QueryClient, row: MessageRow): void {
  qc.setQueryData<MessagePages>(keys.messages(row.channel_id), (data) => {
    if (!data) return data
    if (data.pages.some((page) => page.some((m) => m.id === row.id))) return data
    const message: ChatMessage = { ...row, reactions: [], votes: [] }
    const [first = [], ...rest] = data.pages
    const merged = [message, ...first].sort((a, b) => b.created_at.localeCompare(a.created_at))
    return { ...data, pages: [merged, ...rest] }
  })
}

export function updateMessage(qc: QueryClient, row: MessageRow): void {
  qc.setQueryData<MessagePages>(keys.messages(row.channel_id), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => page.map((m) => (m.id === row.id ? { ...m, ...row, reactions: m.reactions } : m))),
        }
      : data,
  )
}

export function removeMessage(qc: QueryClient, id: string): void {
  mapAllMessageCaches(qc, (data) => ({ ...data, pages: data.pages.map((page) => page.filter((m) => m.id !== id)) }))
}

export function addReaction(qc: QueryClient, row: Pick<ReactionRow, 'id' | 'message_id' | 'emoji' | 'user_id'>): void {
  mapAllMessageCaches(qc, (data) => ({
    ...data,
    pages: data.pages.map((page) =>
      page.map((m) =>
        m.id === row.message_id && !m.reactions.some((r) => r.id === row.id || (r.user_id === row.user_id && r.emoji === row.emoji))
          ? { ...m, reactions: [...m.reactions, { id: row.id, emoji: row.emoji, user_id: row.user_id }] }
          : m,
      ),
    ),
  }))
}

export function removeReaction(qc: QueryClient, match: (r: ChatMessage['reactions'][number]) => boolean): void {
  mapAllMessageCaches(qc, (data) => ({
    ...data,
    pages: data.pages.map((page) =>
      page.map((m) => (m.reactions.some(match) ? { ...m, reactions: m.reactions.filter((r) => !match(r)) } : m)),
    ),
  }))
}

// Anket oyu: kişinin oyu eklenir ya da değişir; option null ise geri alınır.
export function setVote(qc: QueryClient, vote: Pick<PollVoteRow, 'message_id' | 'user_id'> & { option: number | null }): void {
  mapAllMessageCaches(qc, (data) => ({
    ...data,
    pages: data.pages.map((page) =>
      page.map((m) => {
        if (m.id !== vote.message_id) return m
        const others = m.votes.filter((v) => v.user_id !== vote.user_id)
        return { ...m, votes: vote.option === null ? others : [...others, { user_id: vote.user_id, option: vote.option }] }
      }),
    ),
  }))
}

// Kanaldan çıkarken eski sayfalar bırakılır: bellekte sadece en yeni sayfa kalır.
export function trimMessages(qc: QueryClient, channelId: string): void {
  qc.setQueryData<MessagePages>(keys.messages(channelId), (data) =>
    data && data.pages.length > 1 ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
  )
}

export function findMessage(qc: QueryClient, id: string): ChatMessage | undefined {
  for (const [, data] of qc.getQueriesData<MessagePages>({ queryKey: ['messages'] })) {
    for (const page of data?.pages ?? []) {
      const found = page.find((m) => m.id === id)
      if (found) return found
    }
  }
  return undefined
}

export function bumpUnread(qc: QueryClient, channelId: string, serverId: string | null, mention: boolean): void {
  qc.setQueryData<Map<string, UnreadEntry>>(keys.unread, (map) => {
    const next = new Map(map ?? [])
    const current = next.get(channelId) ?? { channel_id: channelId, server_id: serverId, unread: 0, mentions: 0 }
    next.set(channelId, {
      ...current,
      unread: Math.min(current.unread + 1, 99),
      mentions: Math.min(current.mentions + (mention ? 1 : 0), 99),
    })
    return next
  })
}

export function clearUnread(qc: QueryClient, channelId: string): void {
  qc.setQueryData<Map<string, UnreadEntry>>(keys.unread, (map) => {
    if (!map?.has(channelId)) return map
    const next = new Map(map)
    next.delete(channelId)
    return next
  })
}
