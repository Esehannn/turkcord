import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useVoice, type VoiceParticipant } from './store'

// Ses kanallarında kimin olduğu "chan:{kanal}" konusundaki presence ile izlenir.
// Aynı kanalı birden çok yer izleyebilir (kenar çubuğu, bağlı olduğum kanal); bu yüzden sayaçlı tutulur.
// Bireysel aramalarda konu "ara:{kanal}"dır: özel mesajda "chan:{kanal}" zaten "yazıyor…" için açıktır.

type Entry = { channel: RealtimeChannel; refs: number; ready: Promise<void> }
const entries = new Map<string, Entry>()

type Meta = { muted?: boolean; deafened?: boolean }

function ensure(channelId: string, userId: string, dm: boolean): Entry {
  const existing = entries.get(channelId)
  if (existing) return existing

  const channel = supabase.channel(`${dm ? 'ara' : 'chan'}:${channelId}`, { config: { private: true, presence: { key: userId } } })
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => (resolveReady = resolve))

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<Meta>()
      const list: VoiceParticipant[] = Object.entries(state)
        .map(([key, metas]) => {
          const meta = metas[metas.length - 1] ?? {}
          return { userId: key, muted: !!meta.muted, deafened: !!meta.deafened }
        })
      useVoice.setState((s) => ({ rooms: { ...s.rooms, [channelId]: list } }))
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') resolveReady()
    })

  const entry: Entry = { channel, refs: 0, ready }
  entries.set(channelId, entry)
  return entry
}

// İzlemeyi başlatır; dönen fonksiyon izlemeyi bırakır.
export function watchVoiceRoom(channelId: string, userId: string, dm = false): () => void {
  const entry = ensure(channelId, userId, dm)
  entry.refs++
  return () => {
    entry.refs--
    if (entry.refs > 0) return
    entries.delete(channelId)
    void supabase.removeChannel(entry.channel)
    useVoice.setState((s) => {
      const rooms = { ...s.rooms }
      delete rooms[channelId]
      return { rooms }
    })
  }
}

export async function trackVoice(channelId: string, userId: string, meta: Meta, dm = false): Promise<void> {
  const entry = ensure(channelId, userId, dm)
  await entry.ready
  await entry.channel.track(meta)
}

export async function untrackVoice(channelId: string): Promise<void> {
  const entry = entries.get(channelId)
  if (entry) await entry.channel.untrack()
}
