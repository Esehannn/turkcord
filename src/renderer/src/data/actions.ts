import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Attachment, MessageRow, ReactionRow } from '@/lib/database.types'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { addMessage, addReaction, clearUnread, removeMessage, removeReaction, updateMessage } from './cache'
import { keys } from './queries'

// Hata varsa fırlatır; yoksa veriyi döner (dönüş değeri olmayan fonksiyonlarda null gelir).
function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

// Kullanıcı işlemleri. Hata olursa Türkçe bir bildirim gösterilir ve hata yeniden fırlatılır.
export function useActions() {
  const qc = useQueryClient()

  return useMemo(() => {
    async function run<T>(fn: () => Promise<T>, success?: string): Promise<T> {
      try {
        const result = await fn()
        if (success) toast.success(success)
        return result
      } catch (error) {
        toast.error(error)
        throw error
      }
    }

    const invalidate = (...queryKeys: readonly (readonly unknown[])[]) =>
      Promise.all(queryKeys.map((queryKey) => qc.invalidateQueries({ queryKey })))

    return {
      // Arkadaşlık
      sendFriendRequest: (username: string) =>
        run(async () => {
          const result = unwrap(await supabase.rpc('send_friend_request', { p_username: username }))
          await invalidate(keys.friendships)
          toast.success(result === 'accepted' ? 'Artık arkadaşsınız!' : 'Arkadaşlık isteği gönderildi.')
          return result
        }),
      respondFriendRequest: (id: string, accept: boolean) =>
        run(async () => {
          unwrap(await supabase.rpc('respond_friend_request', { p_request: id, p_accept: accept }))
          await invalidate(keys.friendships)
        }),
      removeFriend: (userId: string) =>
        run(async () => {
          unwrap(await supabase.rpc('remove_friend', { p_user: userId }))
          await invalidate(keys.friendships)
        }),
      blockUser: (userId: string) =>
        run(async () => {
          unwrap(await supabase.rpc('block_user', { p_user: userId }))
          await invalidate(keys.friendships, keys.blocks)
        }, 'Kullanıcı engellendi.'),
      unblockUser: (userId: string) =>
        run(async () => {
          unwrap(await supabase.rpc('unblock_user', { p_user: userId }))
          await invalidate(keys.blocks)
        }, 'Engel kaldırıldı.'),

      // DM
      openDm: (userId: string) =>
        run(async () => {
          const channelId = unwrap(await supabase.rpc('get_or_create_dm', { p_user: userId }))
          await invalidate(keys.dms)
          useUi.getState().setView({ kind: 'dm', channelId })
          return channelId
        }),

      // Sunucular
      createServer: (name: string) =>
        run(async () => {
          const id = unwrap(await supabase.rpc('create_server', { p_name: name }))
          await invalidate(keys.servers)
          useUi.getState().setView({ kind: 'server', serverId: id, channelId: null })
          return id
        }, 'Sunucu oluşturuldu.'),
      joinServer: (code: string) =>
        run(async () => {
          const id = unwrap(await supabase.rpc('join_server', { p_code: code }))
          await invalidate(keys.servers, keys.unread)
          useUi.getState().setView({ kind: 'server', serverId: id, channelId: null })
          return id
        }, 'Sunucuya katıldın.'),
      updateServer: (id: string, patch: { name?: string; icon_path?: string | null }) =>
        run(async () => {
          unwrap(await supabase.from('servers').update(patch).eq('id', id))
          await invalidate(keys.servers)
        }),
      deleteServer: (id: string) =>
        run(async () => {
          unwrap(await supabase.from('servers').delete().eq('id', id))
          useUi.getState().setView({ kind: 'home', tab: 'online' })
          await invalidate(keys.servers, keys.unread)
        }, 'Sunucu silindi.'),
      leaveServer: (id: string) =>
        run(async () => {
          unwrap(await supabase.rpc('leave_server', { p_server: id }))
          useUi.getState().setView({ kind: 'home', tab: 'online' })
          await invalidate(keys.servers, keys.unread)
        }, 'Sunucudan ayrıldın.'),
      kickMember: (serverId: string, userId: string) =>
        run(async () => {
          unwrap(await supabase.rpc('kick_member', { p_server: serverId, p_user: userId }))
          await invalidate(keys.members(serverId))
        }, 'Üye sunucudan atıldı.'),
      setMemberRole: (serverId: string, userId: string, role: 'admin' | 'member') =>
        run(async () => {
          unwrap(await supabase.rpc('set_member_role', { p_server: serverId, p_user: userId, p_role: role }))
          await invalidate(keys.members(serverId))
        }),
      createRole: (serverId: string, name: string, color: string) =>
        run(async () => {
          unwrap(await supabase.rpc('create_server_role', { p_server: serverId, p_name: name, p_color: color }))
          await invalidate(keys.roles(serverId))
        }),
      updateRole: (serverId: string, roleId: string, name: string, color: string, position: number) =>
        run(async () => {
          unwrap(await supabase.rpc('update_server_role', { p_role: roleId, p_name: name, p_color: color, p_position: position }))
          await invalidate(keys.roles(serverId))
        }),
      deleteRole: (serverId: string, roleId: string) =>
        run(async () => {
          unwrap(await supabase.rpc('delete_server_role', { p_role: roleId }))
          await invalidate(keys.roles(serverId), keys.members(serverId))
        }),
      setMemberServerRole: (serverId: string, userId: string, roleId: string | null) =>
        run(async () => {
          unwrap(await supabase.rpc('set_member_server_role', { p_server: serverId, p_user: userId, p_role: roleId }))
          await invalidate(keys.members(serverId))
        }),
      createInvite: (serverId: string, maxUses: number | null, expiresHours: number | null) =>
        run(async () =>
          unwrap(
            await supabase.rpc('create_server_invite', {
              p_server: serverId,
              p_max_uses: maxUses,
              p_expires_hours: expiresHours,
            }),
          ),
        ),

      // Kanallar
      createChannel: (serverId: string, name: string, kind: 'text' | 'voice') =>
        run(async () => {
          const id = unwrap(await supabase.rpc('create_channel', { p_server: serverId, p_name: name, p_kind: kind }))
          await invalidate(keys.channels(serverId))
          return id
        }),
      updateChannel: (serverId: string, channelId: string, name: string, topic: string | null) =>
        run(async () => {
          unwrap(await supabase.rpc('update_channel', { p_channel: channelId, p_name: name, p_topic: topic }))
          await invalidate(keys.channels(serverId), keys.channel(channelId))
        }, 'Kanal güncellendi.'),
      deleteChannel: (serverId: string, channelId: string) =>
        run(async () => {
          unwrap(await supabase.rpc('delete_channel', { p_channel: channelId }))
          await invalidate(keys.channels(serverId), keys.unread)
        }, 'Kanal silindi.'),

      // Mesajlar
      sendMessage: (channelId: string, content: string, replyTo: string | null, attachments: Attachment[] = []) =>
        run(async () => {
          const row = unwrap(
            await supabase
              .from('messages')
              .insert({ channel_id: channelId, content, reply_to: replyTo, attachments })
              .select('*')
              .single(),
          ) as MessageRow
          addMessage(qc, row)
          return row
        }),
      editMessage: (id: string, content: string) =>
        run(async () => {
          const row = unwrap(await supabase.from('messages').update({ content }).eq('id', id).select('*').single()) as MessageRow
          updateMessage(qc, row)
        }),
      deleteMessage: (id: string) =>
        run(async () => {
          unwrap(await supabase.from('messages').delete().eq('id', id))
          removeMessage(qc, id)
        }),
      toggleReaction: (messageId: string, emoji: string, userId: string, existingId: string | undefined) =>
        run(async () => {
          if (existingId) {
            removeReaction(qc, (r) => r.id === existingId)
            unwrap(await supabase.from('message_reactions').delete().eq('id', existingId))
          } else {
            const row = unwrap(
              await supabase.from('message_reactions').insert({ message_id: messageId, emoji }).select('id, message_id, emoji, user_id').single(),
            ) as ReactionRow
            addReaction(qc, { ...row, user_id: row.user_id ?? userId })
          }
        }),
      markRead: async (channelId: string) => {
        clearUnread(qc, channelId)
        await supabase.rpc('mark_channel_read', { p_channel: channelId })
      },

      // Profil
      updateProfile: (userId: string, patch: { display_name?: string; avatar_path?: string | null; custom_status?: string | null }) =>
        run(async () => {
          unwrap(await supabase.from('profiles').update(patch).eq('id', userId))
          await invalidate(keys.profiles)
        }, 'Profil güncellendi.'),
    }
  }, [qc])
}
