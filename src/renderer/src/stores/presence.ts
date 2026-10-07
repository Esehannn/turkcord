import { create } from 'zustand'

export type OnlineStatus = 'online' | 'idle' | 'dnd'

type PresenceState = {
  online: Record<string, OnlineStatus>
  typing: Record<string, Record<string, number>> // kanal -> kullanıcı -> son yazma zamanı
}

export const usePresence = create<PresenceState>(() => ({ online: {}, typing: {} }))

export function statusOf(userId: string): OnlineStatus | 'offline' {
  return usePresence.getState().online[userId] ?? 'offline'
}

export function useStatus(userId: string | null | undefined): OnlineStatus | 'offline' {
  return usePresence((s) => (userId ? (s.online[userId] ?? 'offline') : 'offline'))
}
