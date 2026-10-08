// Veritabanı tipleri (supabase/migrations ile birebir aynı tutulmalı).
// Şema değişince güncelleyin; ileride `supabase gen types` çıktısıyla değiştirilebilir.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>, Relationships = []> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: Relationships
}

export type ProfileRow = {
  id: string
  username: string
  display_name: string
  avatar_path: string | null
  custom_status: string | null
  is_admin: boolean
  created_at: string
}

export type FriendshipRow = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
  responded_at: string | null
}

export type BlockRow = {
  blocker_id: string
  blocked_id: string
  created_at: string
}

export type ServerRow = {
  id: string
  name: string
  icon_path: string | null
  owner_id: string
  created_at: string
}

export type MemberRole = 'owner' | 'admin' | 'member'

export type ServerMemberRow = {
  server_id: string
  user_id: string
  role: MemberRole
  // Sunucuya özel, adlı ve renkli rol (görünüş için).
  role_id: string | null
  joined_at: string
}

export type ServerRoleRow = {
  id: string
  server_id: string
  name: string
  color: string
  position: number
  created_at: string
}

export type ChannelKind = 'text' | 'voice' | 'dm'

export type ChannelRow = {
  id: string
  server_id: string | null
  kind: ChannelKind
  name: string | null
  topic: string | null
  position: number
  dm_key: string | null
  created_at: string
}

export type DmMemberRow = {
  channel_id: string
  user_id: string
  created_at: string
}

export type ServerInviteRow = {
  code: string
  server_id: string
  created_by: string | null
  max_uses: number | null
  uses: number
  expires_at: string | null
  created_at: string
}

export type Attachment = {
  path: string
  width?: number
  height?: number
  size?: number
  name?: string
  type?: string
}

// text: normal mesaj. call: sistemin eklediği arama kaydı (içerik: missed | declined | ended:<saniye>).
export type MessageKind = 'text' | 'call'

export type MessageRow = {
  id: string
  channel_id: string
  author_id: string | null
  kind: MessageKind
  content: string
  attachments: Attachment[]
  reply_to: string | null
  edited_at: string | null
  created_at: string
}

export type ReactionRow = {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended'

export type CallRow = {
  id: string
  channel_id: string
  caller_id: string
  callee_id: string
  status: CallStatus
  created_at: string
  answered_at: string | null
  ended_at: string | null
}

export type ChannelReadRow = {
  user_id: string
  channel_id: string
  last_read_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        never,
        { display_name?: string; avatar_path?: string | null; custom_status?: string | null },
        []
      >
      friendships: Table<FriendshipRow, never, never>
      blocks: Table<BlockRow, never, never>
      servers: Table<ServerRow, never, { name?: string; icon_path?: string | null }>
      server_members: Table<
        ServerMemberRow,
        never,
        never,
        [
          {
            foreignKeyName: 'server_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      >
      server_roles: Table<ServerRoleRow, never, never>
      channels: Table<ChannelRow, never, never>
      dm_members: Table<DmMemberRow, never, never>
      server_invites: Table<ServerInviteRow, never, never>
      messages: Table<
        MessageRow,
        { channel_id: string; content?: string; attachments?: Attachment[]; reply_to?: string | null },
        { content?: string },
        [
          {
            foreignKeyName: 'messages_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      >
      message_reactions: Table<
        ReactionRow,
        { message_id: string; emoji: string },
        never,
        [
          {
            foreignKeyName: 'message_reactions_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          },
        ]
      >
      channel_reads: Table<ChannelReadRow, never, never>
      calls: Table<CallRow, never, never>
    }
    Views: { [_ in never]: never }
    Functions: {
      admin_create_invite: { Args: { p_max_uses?: number; p_expires_hours?: number | null; p_note?: string | null }; Returns: string }
      admin_list_invites: {
        Args: Record<string, never>
        Returns: {
          id: string
          code: string
          note: string | null
          max_uses: number
          uses: number
          expires_at: string | null
          revoked_at: string | null
          created_at: string
          created_by_username: string | null
          used_by: string[]
        }[]
      }
      admin_revoke_invite: { Args: { p_id: string }; Returns: undefined }
      admin_set_admin: { Args: { p_user: string; p_value: boolean }; Returns: undefined }
      mark_channel_read: { Args: { p_channel: string }; Returns: undefined }
      unread_counts: {
        Args: Record<string, never>
        Returns: { channel_id: string; server_id: string | null; unread: number; mentions: number }[]
      }
      send_friend_request: { Args: { p_username: string }; Returns: 'sent' | 'accepted' }
      respond_friend_request: { Args: { p_request: string; p_accept: boolean }; Returns: undefined }
      remove_friend: { Args: { p_user: string }; Returns: undefined }
      block_user: { Args: { p_user: string }; Returns: undefined }
      unblock_user: { Args: { p_user: string }; Returns: undefined }
      get_or_create_dm: { Args: { p_user: string }; Returns: string }
      list_dms: {
        Args: Record<string, never>
        Returns: {
          channel_id: string
          user_id: string
          username: string
          display_name: string
          avatar_path: string | null
          custom_status: string | null
          last_message_at: string | null
        }[]
      }
      create_server: { Args: { p_name: string }; Returns: string }
      leave_server: { Args: { p_server: string }; Returns: undefined }
      kick_member: { Args: { p_server: string; p_user: string }; Returns: undefined }
      set_member_role: { Args: { p_server: string; p_user: string; p_role: 'admin' | 'member' }; Returns: undefined }
      create_server_role: { Args: { p_server: string; p_name: string; p_color: string }; Returns: string }
      update_server_role: { Args: { p_role: string; p_name: string; p_color: string; p_position: number }; Returns: undefined }
      delete_server_role: { Args: { p_role: string }; Returns: undefined }
      set_member_server_role: { Args: { p_server: string; p_user: string; p_role: string | null }; Returns: undefined }
      create_channel: { Args: { p_server: string; p_name: string; p_kind: 'text' | 'voice' }; Returns: string }
      update_channel: { Args: { p_channel: string; p_name: string; p_topic: string | null }; Returns: undefined }
      delete_channel: { Args: { p_channel: string }; Returns: undefined }
      create_server_invite: {
        Args: { p_server: string; p_max_uses?: number | null; p_expires_hours?: number | null }
        Returns: string
      }
      revoke_server_invite: { Args: { p_code: string }; Returns: undefined }
      preview_server_invite: {
        Args: { p_code: string }
        Returns: { server_id: string; name: string; icon_path: string | null; member_count: number; already_member: boolean }[]
      }
      join_server: { Args: { p_code: string }; Returns: string }
      start_call: { Args: { p_channel: string }; Returns: string }
      answer_call: { Args: { p_call: string; p_accept: boolean }; Returns: undefined }
      end_call: { Args: { p_call: string }; Returns: undefined }
      admin_storage_usage: { Args: Record<string, never>; Returns: { bucket: string; files: number; bytes: number }[] }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
