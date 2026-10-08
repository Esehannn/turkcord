import { create } from 'zustand'
import type { CallRow } from '@/lib/database.types'
import { showNotification } from '@/lib/notify'
import { playSound, startRingback, startRingtone } from '@/lib/sounds'
import { supabase } from '@/lib/supabase'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { joinVoice, leaveVoice } from './engine'
import { useVoice } from './store'

// Bireysel arama: özel mesajdaki iki kişi arasında sesli görüşme.
// Çaldırma "calls" tablosundan geçer (iki taraf da değişiklik akışından haberdar olur); ses, ses
// kanallarıyla aynı motorla doğrudan (P2P) akar. Arayan hemen odaya girer, aranan açınca bağlanılır.

export type ActiveCall = {
  id: string
  channelId: string
  peerId: string
  direction: 'in' | 'out'
  status: 'ringing' | 'active'
  // Görüşmenin başladığı an (süre sayacı için).
  startedAt: number | null
}

export const useCall = create<{ call: ActiveCall | null }>(() => ({ call: null }))

const RING_SECONDS = 30
// Bu kadar eski "çalıyor" kayıtları dikkate alınmaz (arayanın uygulaması kapanmış olabilir).
const STALE_MS = 45_000
const PEER_GONE_MS = 8000

let me = ''
let peerName: (userId: string) => string = () => 'Biri'
let stopRing: (() => void) | null = null
let ringTimer: ReturnType<typeof setTimeout> | undefined
let goneTimer: ReturnType<typeof setTimeout> | undefined
let peerSeen = false

function silence(): void {
  stopRing?.()
  stopRing = null
  clearTimeout(ringTimer)
  clearTimeout(goneTimer)
  goneTimer = undefined
}

function clear(): void {
  silence()
  peerSeen = false
  useCall.setState({ call: null })
}

function current(): ActiveCall | null {
  return useCall.getState().call
}

async function rpcEnd(id: string): Promise<void> {
  await supabase.rpc('end_call', { p_call: id }).then(
    () => {},
    () => {},
  )
}

export async function startCall(channelId: string, peerId: string): Promise<void> {
  if (!me) return
  if (current()) {
    toast.info('Zaten bir aramadasın.')
    return
  }
  // Önce varsa bağlı olunan ses kanalından çık (çıkış, aşağıdaki "ses kapandı" kuralını tetiklemesin).
  if (useVoice.getState().channelId) await leaveVoice(false)

  const { data: id, error } = await supabase.rpc('start_call', { p_channel: channelId })
  if (error || !id) {
    toast.error(error ?? 'failed')
    return
  }
  useCall.setState({ call: { id, channelId, peerId, direction: 'out', status: 'ringing', startedAt: null } })
  stopRing = startRingback()
  ringTimer = setTimeout(() => {
    if (current()?.id === id && current()?.status === 'ringing') {
      toast.info(`${peerName(peerId)} cevap vermedi.`)
      void hangUp()
    }
  }, RING_SECONDS * 1000)

  await joinVoice(null, channelId, me)
  // Mikrofon açılamadıysa arama da iptal olur.
  if (current()?.id === id && useVoice.getState().status === 'idle') {
    clear()
    void rpcEnd(id)
  }
}

export async function acceptCall(): Promise<void> {
  const call = current()
  if (!call || call.direction !== 'in' || call.status !== 'ringing') return
  silence()
  if (useVoice.getState().channelId) await leaveVoice(false)
  const { error } = await supabase.rpc('answer_call', { p_call: call.id, p_accept: true })
  if (error) {
    clear()
    toast.info('Arama sona ermiş.')
    return
  }
  useCall.setState({ call: { ...call, status: 'active', startedAt: Date.now() } })
  useUi.getState().setView({ kind: 'dm', channelId: call.channelId })
  await joinVoice(null, call.channelId, me)
  if (current()?.id === call.id && useVoice.getState().status === 'idle') {
    clear()
    void rpcEnd(call.id)
  }
}

export async function declineCall(): Promise<void> {
  const call = current()
  if (!call || call.direction !== 'in') return
  clear()
  await supabase.rpc('answer_call', { p_call: call.id, p_accept: false }).then(
    () => {},
    () => {},
  )
}

// Aramayı kapat (çalarken arayan vazgeçerse karşı tarafta "cevapsız arama" olur).
export async function hangUp(): Promise<void> {
  const call = current()
  if (!call) return
  clear()
  playSound('hangup')
  await Promise.all([rpcEnd(call.id), leaveVoice(false)])
}

// Veritabanından gelen arama olayları (yeni arama, cevaplandı, kapandı).
export function onCallRow(row: CallRow): void {
  if (!me) return
  const call = current()

  if (!call) {
    const fresh = Date.now() - new Date(row.created_at).getTime() < STALE_MS
    if (row.status !== 'ringing' || row.callee_id !== me || !fresh) return
    useCall.setState({
      call: { id: row.id, channelId: row.channel_id, peerId: row.caller_id, direction: 'in', status: 'ringing', startedAt: null },
    })
    const dnd = useUi.getState().status === 'dnd'
    if (!dnd) stopRing = startRingtone()
    window.turkcord?.requestAttention?.()
    showNotification({
      title: 'Gelen arama',
      body: `${peerName(row.caller_id)} seni arıyor.`,
      sound: null,
      banner: false,
      onClick: () => useUi.getState().setView({ kind: 'dm', channelId: row.channel_id }),
    })
    // Arayan kapatma haberi gönderemeden koparsa ekran sonsuza kadar çalmasın.
    ringTimer = setTimeout(() => {
      if (current()?.id === row.id && current()?.status === 'ringing') clear()
    }, (RING_SECONDS + 10) * 1000)
    return
  }

  if (row.id !== call.id) return

  switch (row.status) {
    case 'accepted':
      if (call.status === 'ringing') {
        silence()
        useCall.setState({ call: { ...call, status: 'active', startedAt: Date.now() } })
      }
      break
    case 'declined':
      clear()
      if (call.direction === 'out') {
        playSound('hangup')
        toast.info(`${peerName(call.peerId)} aramayı reddetti.`)
        void leaveVoice(false)
      }
      break
    case 'missed':
    case 'ended':
      clear()
      playSound('hangup')
      if (useVoice.getState().channelId === call.channelId) void leaveVoice(false)
      break
  }
}

// Uygulama açılırken çağrılır: kullanıcıyı tanıtır ve o an çalan bir arama varsa gösterir.
export function initCalls(userId: string, nameOf: (userId: string) => string): () => void {
  me = userId
  peerName = nameOf

  void supabase
    .from('calls')
    .select('*')
    .eq('callee_id', userId)
    .eq('status', 'ringing')
    .order('created_at', { ascending: false })
    .limit(1)
    .then(({ data }) => {
      if (data?.[0]) onCallRow(data[0])
    })

  const unsubscribe = useVoice.subscribe((state, prev) => {
    const call = current()
    if (!call) return

    // Ses bağlantısı kapandıysa (kapat düğmesi, başka kanala geçme, mikrofon hatası) arama da biter.
    if (prev.status !== 'idle' && state.status === 'idle' && (call.status === 'active' || call.direction === 'out')) {
      clear()
      void rpcEnd(call.id)
      return
    }

    // Karşı taraf odadan düştüyse (internet kesildi, uygulama kapandı) kısa bir süre bekleyip kapat.
    if (call.status !== 'active' || state.rooms === prev.rooms) return
    const present = !!state.rooms[call.channelId]?.some((p) => p.userId === call.peerId)
    if (present) {
      peerSeen = true
      clearTimeout(goneTimer)
      goneTimer = undefined
    } else if (peerSeen && !goneTimer) {
      goneTimer = setTimeout(() => {
        goneTimer = undefined
        if (current()?.id === call.id) {
          toast.info('Karşı tarafın bağlantısı koptu.')
          void hangUp()
        }
      }, PEER_GONE_MS)
    }
  })

  return () => {
    unsubscribe()
    const call = current()
    clear()
    if (call && (call.status === 'active' || call.direction === 'out')) void rpcEnd(call.id)
    me = ''
  }
}
