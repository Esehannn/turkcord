import { useQuery, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type {
  BlockRow,
  ChannelRow,
  FriendshipRow,
  MessageRow,
  ProfileRow,
  ReactionRow,
  ServerMemberRow,
  ServerRow,
} from '@/lib/database.types'

export const keys = {
  profiles: ['profiles'] as const,
  friendships: ['friendships'] as const,
  blocks: ['blocks'] as const,
  dms: ['dms'] as const,
  servers: ['servers'] as const,
  channels: (serverId: string) => ['channels', serverId] as const,
  channel: (channelId: string) => ['channel', channelId] as const,
  members: (serverId: string) => ['members', serverId] as const,
  messages: (channelId: string) => ['messages', channelId] as const,
  unread: ['unread'] as const,
}

function check<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

// Küçük, davetli bir topluluk olduğu için tüm profiller bir kerede yüklenir ve
// gerçek zamanlı güncellemelerle taze tutulur. İsim ve avatarlar her yerde buradan okunur.
export function useProfiles() {
  return useQuery({
    queryKey: keys.profiles,
    queryFn: async () => {
      const rows = check(await supabase.from('profiles').select('*').order('username').limit(2000))
      return new Map(rows.map((p) => [p.id, p]))
    },
    staleTime: 5 * 60_000,
  })
}

export function useProfile(userId: string | null | undefined): ProfileRow | undefined {
  const { data } = useProfiles()
  return userId ? data?.get(userId) : undefined
}

export function useFriendships() {
  return useQuery({
    queryKey: keys.friendships,
    queryFn: async (): Promise<FriendshipRow[]> =>
      check(await supabase.from('friendships').select('*').order('created_at', { ascending: false })),
  })
}

export function useBlocks() {
  return useQuery({
    queryKey: keys.blocks,
    queryFn: async (): Promise<BlockRow[]> => check(await supabase.from('blocks').select('*')),
  })
}

export type DmEntry = {
  channel_id: string
  user_id: string
  username: string
  display_name: string
  avatar_path: string | null
  custom_status: string | null
  last_message_at: string | null
}

export function useDms() {
  return useQuery({
    queryKey: keys.dms,
    queryFn: async (): Promise<DmEntry[]> => {
      const rows = check(await supabase.rpc('list_dms'))
      return [...rows].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
    },
  })
}

export function useServers() {
  return useQuery({
    queryKey: keys.servers,
    queryFn: async (): Promise<ServerRow[]> =>
      check(await supabase.from('servers').select('*').order('created_at', { ascending: true })),
  })
}

export function useChannels(serverId: string | null) {
  return useQuery({
    queryKey: keys.channels(serverId ?? ''),
    enabled: !!serverId,
    queryFn: async (): Promise<ChannelRow[]> =>
      check(
        await supabase
          .from('channels')
          .select('*')
          .eq('server_id', serverId!)
          .order('position', { ascending: true })
          .order('created_at', { ascending: true }),
      ),
  })
}

export function useChannel(channelId: string | null) {
  return useQuery({
    queryKey: keys.channel(channelId ?? ''),
    enabled: !!channelId,
    queryFn: async (): Promise<ChannelRow | null> =>
      check(await supabase.from('channels').select('*').eq('id', channelId!).maybeSingle()),
  })
}

export function useMembers(serverId: string | null) {
  return useQuery({
    queryKey: keys.members(serverId ?? ''),
    enabled: !!serverId,
    queryFn: async (): Promise<ServerMemberRow[]> =>
      check(await supabase.from('server_members').select('*').eq('server_id', serverId!)),
  })
}

export type UnreadEntry = { channel_id: string; server_id: string | null; unread: number; mentions: number }

export function useUnread() {
  return useQuery({
    queryKey: keys.unread,
    queryFn: async (): Promise<Map<string, UnreadEntry>> => {
      const rows = check(await supabase.rpc('unread_counts'))
      return new Map(rows.map((r) => [r.channel_id, r]))
    },
    refetchInterval: 5 * 60_000,
  })
}

// ---------------------------------------------------------------------------
// Mesajlar: en yeniden eskiye sayfalar halinde (50'şer) yüklenir.
// ---------------------------------------------------------------------------

export type ChatMessage = MessageRow & { reactions: Pick<ReactionRow, 'id' | 'emoji' | 'user_id'>[] }
export type MessagePages = InfiniteData<ChatMessage[], string | null>

export const PAGE_SIZE = 50

export function useMessages(channelId: string) {
  return useInfiniteQuery({
    queryKey: keys.messages(channelId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ChatMessage[]> => {
      let query = supabase
        .from('messages')
        .select('*, reactions:message_reactions(id, emoji, user_id)')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      if (pageParam) query = query.lt('created_at', pageParam)
      const rows = check(await query) as unknown as ChatMessage[]
      return rows
    },
    getNextPageParam: (lastPage) => (lastPage.length === PAGE_SIZE ? lastPage[lastPage.length - 1].created_at : null),
    staleTime: Infinity,
  })
}
