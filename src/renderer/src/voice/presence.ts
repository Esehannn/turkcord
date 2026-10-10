import type { RealtimeChannel } from '@supabase/supabase-js'
import { coalesce } from '@/lib/coalesce'
import { supabase } from '@/lib/supabase'
import { useVoice, type VoiceParticipant } from './store'

// Ses kanallarında kimin olduğu "chan:{kanal}" konusundaki presence ile izlenir.
// Aynı kanalı birden çok yer izleyebilir (kenar çubuğu, bağlı olduğum kanal); bu yüzden sayaçlı tutulur.
// Bireysel aramalarda konu "ara:{kanal}"dır: özel mesajda "chan:{kanal}" zaten "yazıyor…" için açıktır.
//
// ÖNEMLİ: Supabase Realtime bir kanalda istemci başına 30 saniyede en fazla 5 presence çağrısına (track/untrack)
// izin verir; aşılırsa kanalı kapatır ve o kişi başkalarına kanaldan çıkmış görünür. Bu yüzden presence
// sadece "kanaldayım" bilgisi için kullanılır ve en fazla TRACK_EVERY_MS'de bir güncellenir. Susturma ve
// sağırlaştırma gibi sık değişen durumlar anında, sınırı olmayan yayın (broadcast) ile gider (bkz. engine.ts);
// buradaki `applyVoiceState` o yayını listeye işler. Presence'taki kopya, kanala sonradan bakanlar içindir.

export type VoiceFlags = { muted: boolean; deafened: boolean; at: number }
// since: kanala giriş anı; "seste geçen süre" bundan hesaplanır.
type Meta = Partial<VoiceFlags> & { since?: number }

const TRACK_EVERY_MS = 12_000
const MAX_REVIVES = 5

type Entry = {
  channel: RealtimeChannel
  refs: number
  ready: Promise<void>
  dm: boolean
  // En son bildirmek istediğim durum (kanaldaysam); bağlantı yeniden kurulunca tekrar bildirilir.
  meta: (VoiceFlags & { since: number }) | null
  // Presence güncellemelerini seyrelten zamanlayıcı.
  pacer: ReturnType<typeof coalesce>
  // Art arda kaç kez yeniden bağlanmak gerekti (sonsuz döngüye girmemek için).
  revived: number
  // Presence'tan gelen son liste ve yayınla gelen daha taze durumlar.
  present: Map<string, Meta>
  fresh: Map<string, VoiceFlags>
}
const entries = new Map<string, Entry>()

// Listeyi kurar: kimin kanalda olduğu presence'tan, susturma durumu en taze kaynaktan gelir.
function publish(channelId: string, entry: Entry): void {
  const list: VoiceParticipant[] = [...entry.present].map(([userId, meta]) => {
    const live = entry.fresh.get(userId)
    const best = live && live.at >= (meta.at ?? 0) ? live : meta
    return { userId, muted: !!best.muted, deafened: !!best.deafened, since: typeof meta.since === 'number' ? meta.since : undefined }
  })
  useVoice.setState((s) => ({ rooms: { ...s.rooms, [channelId]: list } }))
}

// Yayınla gelen (ya da benim az önce değiştirdiğim) susturma durumunu hemen listeye yansıtır.
export function applyVoiceState(channelId: string, userId: string, flags: VoiceFlags): void {
  const entry = entries.get(channelId)
  if (!entry) return
  if ((entry.fresh.get(userId)?.at ?? 0) > flags.at) return
  entry.fresh.set(userId, flags)
  if (entry.present.has(userId)) publish(channelId, entry)
}

// Sunucu kanalı kapattıysa (hız sınırı, bağlantı kopması) kanal baştan kurulur; yoksa sen kendi ekranında
// bağlı görünürken başkaları seni kanaldan çıkmış sanar.
function revive(channelId: string, userId: string, dead: Entry): void {
  if (entries.get(channelId) !== dead) return
  entries.delete(channelId)
  dead.pacer.cancel()
  void supabase.removeChannel(dead.channel)
  if (dead.refs <= 0 || dead.revived >= MAX_REVIVES) return
  setTimeout(
    () => {
      if (entries.has(channelId) || dead.refs <= 0) return
      const fresh = ensure(channelId, userId, dead.dm)
      fresh.refs = dead.refs
      fresh.revived = dead.revived + 1
      fresh.meta = dead.meta
      fresh.fresh = dead.fresh
      if (fresh.meta) void fresh.ready.then(() => fresh.pacer.trigger())
    },
    1000 * (dead.revived + 1),
  )
}

function ensure(channelId: string, userId: string, dm: boolean): Entry {
  const existing = entries.get(channelId)
  if (existing) return existing

  const channel = supabase.channel(`${dm ? 'ara' : 'chan'}:${channelId}`, { config: { private: true, presence: { key: userId } } })
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => (resolveReady = resolve))

  const entry: Entry = {
    channel,
    refs: 0,
    ready,
    dm,
    meta: null,
    pacer: coalesce(async () => {
      if (entry.meta && entries.get(channelId) === entry) await channel.track({ ...entry.meta })
    }, TRACK_EVERY_MS),
    revived: 0,
    present: new Map(),
    fresh: new Map(),
  }

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<Meta>()
      entry.present = new Map(Object.entries(state).map(([key, metas]) => [key, metas[metas.length - 1] ?? {}]))
      // Kanaldan çıkanların eski durumları tutulmaz.
      for (const id of entry.fresh.keys()) if (!entry.present.has(id)) entry.fresh.delete(id)
      publish(channelId, entry)
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        resolveReady()
        // Sağlıklı kalırsa sayaç sıfırlanır.
        setTimeout(() => entries.get(channelId) === entry && (entry.revived = 0), 30_000)
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        revive(channelId, userId, entry)
      }
    })

  entries.set(channelId, entry)
  return entry
}

// İzlemeyi başlatır; dönen fonksiyon izlemeyi bırakır.
export function watchVoiceRoom(channelId: string, userId: string, dm = false): () => void {
  const entry = ensure(channelId, userId, dm)
  entry.refs++
  return () => {
    // Kanal bu arada yeniden kurulmuş olabilir; güncel kayıt üzerinden say.
    const current = entries.get(channelId) ?? entry
    current.refs--
    if (current.refs > 0) return
    current.pacer.cancel()
    if (entries.get(channelId) === current) {
      entries.delete(channelId)
      void supabase.removeChannel(current.channel)
    }
    useVoice.setState((s) => {
      const rooms = { ...s.rooms }
      delete rooms[channelId]
      return { rooms }
    })
  }
}

// "Kanaldayım" bilgisini ve susturma durumumu bildirir. Kendi ekranımda hemen görünür; sunucuya presence
// güncellemesi ise seyrek gider (en fazla TRACK_EVERY_MS'de bir, her zaman en son durumla).
export async function trackVoice(channelId: string, userId: string, flags: { muted: boolean; deafened: boolean }, dm = false): Promise<void> {
  const entry = ensure(channelId, userId, dm)
  // Kanala ilk giriş hemen bildirilir; sonraki durum değişiklikleri seyreltilir.
  const joining = entry.meta === null
  entry.meta = { ...flags, at: Date.now(), since: entry.meta?.since ?? Date.now() }
  applyVoiceState(channelId, userId, entry.meta)
  await entry.ready
  const current = entries.get(channelId) ?? entry
  if (joining) current.pacer.flush()
  else current.pacer.trigger()
}

export async function untrackVoice(channelId: string): Promise<void> {
  const entry = entries.get(channelId)
  if (!entry) return
  entry.meta = null
  entry.pacer.cancel()
  await entry.channel.untrack()
}
