import type { RealtimeChannel } from '@supabase/supabase-js'
import { coalesce } from '@/lib/coalesce'
import { isEffectId, playEffect, type EffectId } from '@/lib/sounds'
import { supabase } from '@/lib/supabase'
import { toast } from '@/stores/toast'
import { relayConfig, relayServers, type IceServer } from './ice'
import { micErrorMessage, openMicrophone, type Microphone } from './mic'
import { applyVoiceState, trackVoice, untrackVoice, watchVoiceRoom } from './presence'
import { tuneOpus } from './sdp'
import { onVideoSignal, retryVideo, startVideo, stopVideo, syncVideoRoom } from './video'
import { voiceSounds } from './sounds'
import { micOpen, useVoice, volumeOf, type PeerLink } from './store'

// Sesli sohbet: kanaldaki herkes birbirine WebRTC ile bağlanır; ses uçtan uca şifreli (DTLS-SRTP) akar ama
// yalnızca Cloudflare'in aktarma (TURN) sunucusu üzerinden gider, doğrudan (P2P) bağlantı kurulmaz (bkz. ice.ts).
// Ses Supabase'den geçmez; Supabase sadece bağlantı kurulurken bilgi alışverişi (sinyal) ve kimin kanalda
// olduğunu göstermek için ("chan:{kanal}" presence) kullanılır.
//
// Sinyaller: herkes yalnızca kendi konusuna ("sinyal:{kanal}:{kullanıcı}") yazabilir, kanala erişimi olanlar
// dinleyebilir; kuralı veritabanı uygular. Bir sinyalin kimden geldiği mesajın içinden değil, geldiği konudan
// anlaşılır; yani kimse başkası adına sinyal, durum ya da efekt gönderemez.
//
// Bağlantı yalnızca kanalda görünen (katılımcı listesindeki) kişilerle kurulur: yalnızca listedekilerin konusu
// dinlenir, listeden çıkanın konusu bırakılır ve bağlantısı kapanır. Böylece kimse görünmeden dinleyemez.
//
// Her iki kişi arasında tek bağlantı olur: kullanıcı kimliği küçük olan teklif (offer) gönderir.
// Birinin konusunu dinlemeye başlayan ona "merhaba" der; böylece iki taraf da karşısının dinlediğini
// bilir ve teklif kaybolmaz.
//
// Bireysel aramalar da aynı motoru kullanır: kanal özel mesajın kanalıdır, sunucu yoktur (serverId null).
//
// Görüntü (ekran paylaşımı, kamera) bu ses bağlantılarından geçmez; ayrı bağlantılarla video.ts yönetir.

export const MAX_PARTICIPANTS = 10
const SPEAKING_THRESHOLD = 0.018
const SPEAKING_HOLD_MS = 350

type Signal =
  | { type: 'merhaba'; to: string }
  | { type: 'teklif'; to: string; sdp: string }
  | { type: 'cevap'; to: string; sdp: string }
  | { type: 'aday'; to: string; candidate: RTCIceCandidateInit }

const signalTopic = (channelId: string, userId: string): string => `sinyal:${channelId}:${userId}`
// Aynı anda en fazla bu kadar kişinin konusu dinlenir (liste şişirilse bile kanal sayısı sınırlı kalır).
const MAX_LISTENING = 16
// Bir kişinin konusu dinlenemezse giderek seyrelen aralıklarla (2, 4, 8… sn; en fazla bu kadar) yeniden denenir.
const LISTEN_RETRY_MAX_MS = 60_000

type Peer = {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  pending: RTCIceCandidateInit[]
  stopMeter?: () => void
}

let me = ''
// Bağlı olunan oda bir özel mesaj araması mı?
let dmRoom = false
let mic: Microphone | null = null
let stopLocalMeter: (() => void) | undefined
let statsTimer: ReturnType<typeof setInterval> | undefined
// Kendi konum: bütün sinyallerimi buraya yazarım.
let signal: RealtimeChannel | null = null
let signalReady = false
// Dinlediğim konular (kişi → kanal) ve dinlemesi kurulmuş olanlar.
const listening = new Map<string, RealtimeChannel>()
const hearing = new Set<string>()
const listenRetries = new Map<string, number>()
let unwatch: (() => void) | null = null
// Aktarma bilgisi sunucuda 24 saat geçerli. Bir saatten eskiyse yenisi istenir ki kurulan her bağlantının önünde
// uzun bir süre olsun; yenisi alınamazsa eldeki, ömrü dolana kadar kullanılır.
const RELAY_REFRESH_MS = 60 * 60 * 1000
const RELAY_VALID_MS = 23 * 60 * 60 * 1000
let relay: IceServer[] = []
let relayFetchedAt = 0
let relayTimer: ReturnType<typeof setInterval> | undefined
const peers = new Map<string, Peer>()
let audioCtx: AudioContext | null = null
let joinToken = 0

function setState(partial: Partial<ReturnType<typeof useVoice.getState>>): void {
  useVoice.setState(partial)
}

// 'yok': kullanılabilir aktarma bilgisi yok, bağlantı kurulmamalı. 'guncelle': sunucu bu sürüme artık aktarma
// bilgisi vermiyor (asgari sürüm, bkz. supabase/functions/turn); kullanıcı uygulamayı güncellemeli.
async function loadRelay(): Promise<'tamam' | 'yok' | 'guncelle'> {
  if (Date.now() - relayFetchedAt >= RELAY_REFRESH_MS) {
    try {
      const { data, error } = await supabase.functions.invoke<{ iceServers?: unknown; update?: unknown }>('turn', {
        body: { version: __APP_VERSION__ },
      })
      const servers = error ? [] : relayServers(data?.iceServers)
      if (servers.length) {
        relay = servers
        relayFetchedAt = Date.now()
      } else if (!error && data?.update === true) {
        return 'guncelle'
      }
    } catch {
      // Eldeki bilgi hâlâ geçerliyse onunla devam edilir.
    }
  }
  return relay.length > 0 && Date.now() - relayFetchedAt < RELAY_VALID_MS ? 'tamam' : 'yok'
}

// Ses seviyesini ölçüp "konuşuyor" bilgisini günceller.
function meter(stream: MediaStream, userId: string): () => void {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    let lastLoud = 0
    let speaking = false
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += ((v - 128) / 128) ** 2
      const rms = Math.sqrt(sum / data.length)
      const now = Date.now()
      if (rms > SPEAKING_THRESHOLD) lastLoud = now
      const next = now - lastLoud < SPEAKING_HOLD_MS
      if (next !== speaking) {
        speaking = next
        useVoice.setState((s) => ({ speaking: { ...s.speaking, [userId]: next } }))
      }
    }, 80)
    return () => {
      clearInterval(timer)
      source.disconnect()
      useVoice.setState((s) => {
        const copy = { ...s.speaking }
        delete copy[userId]
        return { speaking: copy }
      })
    }
  } catch {
    return () => {}
  }
}

function send(message: Signal): void {
  void signal?.send({ type: 'broadcast', event: 'sinyal', payload: message })
}

function applyOutput(audio: HTMLAudioElement, userId: string): void {
  const { deafened, outputDeviceId } = useVoice.getState()
  audio.muted = deafened
  audio.volume = Math.min(1, Math.max(0, volumeOf(userId)))
  const sink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (sink.setSinkId && outputDeviceId) void sink.setSinkId(outputDeviceId === 'default' ? '' : outputDeviceId).catch(() => {})
}

function setPeerState(userId: string, state: RTCPeerConnectionState | null): void {
  useVoice.setState((s) => {
    const peersState = { ...s.peers }
    if (state) peersState[userId] = state
    else delete peersState[userId]
    return { peers: peersState }
  })
}

function createPeer(userId: string): Peer {
  const pc = new RTCPeerConnection(relayConfig(relay))
  const audio = new Audio()
  audio.autoplay = true
  const peer: Peer = { pc, audio, pending: [] }
  peers.set(userId, peer)
  setPeerState(userId, pc.connectionState)

  if (mic) for (const track of mic.stream.getTracks()) pc.addTrack(track, mic.stream)

  pc.onicecandidate = (event) => {
    if (event.candidate) send({ type: 'aday', to: userId, candidate: event.candidate.toJSON() })
  }
  pc.ontrack = (event) => {
    const [stream] = event.streams
    if (!stream) return
    audio.srcObject = stream
    applyOutput(audio, userId)
    void audio.play().catch(() => {})
    peer.stopMeter?.()
    peer.stopMeter = meter(stream, userId)
  }
  pc.onconnectionstatechange = () => {
    setPeerState(userId, pc.connectionState)
    if (pc.connectionState === 'failed') {
      // Bağlantı koptu: baştan kur. Teklifi yine kimliği küçük olan gönderir.
      closePeer(userId)
      setTimeout(() => {
        if (signal && isInRoom(userId)) {
          if (me < userId) void offer(userId)
          else send({ type: 'merhaba', to: userId })
        }
      }, 1500)
    }
  }
  return peer
}

function closePeer(userId: string): void {
  const peer = peers.get(userId)
  if (!peer) return
  peers.delete(userId)
  peer.stopMeter?.()
  peer.pc.onicecandidate = null
  peer.pc.ontrack = null
  peer.pc.onconnectionstatechange = null
  peer.pc.close()
  peer.audio.srcObject = null
  setPeerState(userId, null)
}

function isInRoom(userId: string): boolean {
  const { channelId, rooms } = useVoice.getState()
  return !!channelId && !!rooms[channelId]?.some((p) => p.userId === userId)
}

// Bağlantı var ama kopmuşsa (karşı taraf kapattıysa) önce temizlenir ki yenisi kurulabilsin.
function dropIfDead(userId: string): void {
  const state = peers.get(userId)?.pc.connectionState
  if (state === 'disconnected' || state === 'failed' || state === 'closed') closePeer(userId)
}

async function offer(userId: string): Promise<void> {
  dropIfDead(userId)
  // Karşı tarafı henüz dinleyemiyorsam cevabı kaçırırım; dinleme kurulunca "merhaba" ile yeniden denenir.
  if (peers.has(userId) || !mic || !hearing.has(userId)) return
  const peer = createPeer(userId)
  const description = await peer.pc.createOffer()
  description.sdp = tuneOpus(description.sdp ?? '')
  await peer.pc.setLocalDescription(description)
  send({ type: 'teklif', to: userId, sdp: description.sdp })
}

async function flushCandidates(peer: Peer): Promise<void> {
  for (const candidate of peer.pending.splice(0)) {
    await peer.pc.addIceCandidate(candidate).catch(() => {})
  }
}

// from: sinyalin geldiği konunun sahibi (sunucu doğrular); mesajın içindeki bir alana güvenilmez.
async function onSignal(from: string, message: Signal): Promise<void> {
  if (message?.to !== me || !isInRoom(from)) return
  try {
    switch (message.type) {
      case 'merhaba':
        // Karşı taraf beni dinlemeye başladı. Susturma durumumu presence'tan geç öğrenebilir; hemen bildir.
        stateBroadcaster.trigger()
        retryVideo(from)
        if (me < from) await offer(from)
        else {
          // Teklifi o gönderecek; onu dinlediğimi bilmiyor olabilir.
          dropIfDead(from)
          if (!peers.has(from)) send({ type: 'merhaba', to: from })
        }
        break
      case 'teklif': {
        retryVideo(from)
        closePeer(from)
        const peer = createPeer(from)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp })
        await flushCandidates(peer)
        const answer = await peer.pc.createAnswer()
        answer.sdp = tuneOpus(answer.sdp ?? '')
        await peer.pc.setLocalDescription(answer)
        send({ type: 'cevap', to: from, sdp: answer.sdp })
        break
      }
      case 'cevap': {
        const peer = peers.get(from)
        if (!peer || peer.pc.signalingState !== 'have-local-offer') return
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
        await flushCandidates(peer)
        break
      }
      case 'aday': {
        const peer = peers.get(from)
        if (!peer) return
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.candidate).catch(() => {})
        else peer.pending.push(message.candidate)
        break
      }
    }
  } catch (error) {
    console.warn('Ses sinyali işlenemedi', error)
  }
}

// Odada olduğu halde sağlıklı bir bağlantım olmayan kişiyle el sıkışmayı yeniden başlatır.
// Teklifi her zaman kimliği küçük olan gönderir; diğeri "merhaba" ile onu dürter.
function reconnect(userId: string): void {
  if (!signal || useVoice.getState().status !== 'connected' || !isInRoom(userId)) return
  dropIfDead(userId)
  if (peers.has(userId)) return
  if (me < userId) void offer(userId)
  else send({ type: 'merhaba', to: userId })
}

function unlisten(userId: string): void {
  const channel = listening.get(userId)
  if (!channel) return
  listening.delete(userId)
  hearing.delete(userId)
  void supabase.removeChannel(channel)
}

// Bir katılımcının konusunu dinlemeye başlar; dinleme kurulunca ona "merhaba" denir.
function listen(channelId: string, userId: string): void {
  if (listening.has(userId) || listening.size >= MAX_LISTENING) return
  const token = joinToken
  const channel = supabase.channel(signalTopic(channelId, userId), { config: { private: true } })
  listening.set(userId, channel)
  channel
    .on('broadcast', { event: 'sinyal' }, ({ payload }) => void onSignal(userId, payload as Signal))
    .on('broadcast', { event: 'efekt' }, ({ payload }) => onEffect(userId, payload))
    .on('broadcast', { event: 'durum' }, ({ payload }) => onPeerState(userId, payload))
    .on('broadcast', { event: 'goruntu' }, ({ payload }) => void onVideoSignal(userId, payload))
    .subscribe((status) => {
      if (token !== joinToken || listening.get(userId) !== channel) return
      if (status === 'SUBSCRIBED') {
        hearing.add(userId)
        listenRetries.delete(userId)
        send({ type: 'merhaba', to: userId })
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        unlisten(userId)
        const tries = (listenRetries.get(userId) ?? 0) + 1
        listenRetries.set(userId, tries)
        setTimeout(() => {
          if (token !== joinToken || !signalReady || !isInRoom(userId)) return
          listen(channelId, userId)
        }, Math.min(LISTEN_RETRY_MAX_MS, 2000 * 2 ** (tries - 1)))
      }
    })
}

// Yalnızca kanalda görünenlerin konusu dinlenir. Eski sürümdekiler (legacy) bu konuları bilmez; dinlenmez.
function syncListeners(): void {
  const { channelId, rooms } = useVoice.getState()
  if (!channelId || !signalReady) return
  const room = rooms[channelId] ?? []
  const now = new Set(room.map((p) => p.userId))
  for (const userId of [...listening.keys()]) if (!now.has(userId)) unlisten(userId)
  for (const userId of [...listenRetries.keys()]) if (!now.has(userId)) listenRetries.delete(userId)
  // Yeniden deneme sırası bekleyenlere dokunulmaz; zamanlayıcısı kendisi dener.
  for (const p of room) if (p.userId !== me && !p.legacy && !listenRetries.has(p.userId)) listen(channelId, p.userId)
}

// Kanaldan çıkanların bağlantısını kapat, girenler için ses efekti çal.
let lastRoom = new Set<string>()
function onRoomChange(): void {
  const { channelId, rooms, status } = useVoice.getState()
  if (!channelId || status === 'idle') return
  const now = new Set((rooms[channelId] ?? []).map((p) => p.userId))
  // Kanalda görünmeyen biriyle bağlantı tutulmaz.
  for (const userId of [...peers.keys()]) if (!now.has(userId)) closePeer(userId)
  syncListeners()
  syncVideoRoom()
  if (status === 'connected') {
    for (const userId of now) if (!lastRoom.has(userId) && userId !== me) voiceSounds.join()
    for (const userId of lastRoom) if (!now.has(userId) && userId !== me) voiceSounds.leave()
    // Odada görünen ama bağlı olmadığım biri varsa (ör. bağlantısı bir an koptuysa) yeniden bağlan.
    for (const userId of now) if (!lastRoom.has(userId) && userId !== me) setTimeout(() => reconnect(userId), 1200)
  }
  lastRoom = now
}
useVoice.subscribe((state, prev) => {
  if (state.rooms !== prev.rooms) onRoomChange()
})

// Susturma/sağırlaştırma durumunu kanaldakilere bildirir. İki yoldan gider:
//  - Anında: ses sinyal kanalında yayın ("durum"). Sınırı yoktur; düğmeye hızlı basılsa bile en fazla
//    150 ms'de bir ve her zaman en son durum gönderilir.
//  - Seyrek: presence kaydı (kanala sonradan bakanlar için). Supabase 30 saniyede 5 presence çağrısından
//    fazlasına izin vermediği için burada seyreltilir (bkz. presence.ts).
const stateBroadcaster = coalesce(() => {
  const { channelId, status, muted, deafened, localScreen, localCamera } = useVoice.getState()
  if (!channelId || status !== 'connected' || !signal) return
  void signal.send({
    type: 'broadcast',
    event: 'durum',
    payload: { muted, deafened, screen: !!localScreen, camera: !!localCamera, at: Date.now() },
  })
}, 150)

function publishState(): void {
  const { channelId, muted, deafened, localScreen, localCamera } = useVoice.getState()
  if (!channelId) return
  void trackVoice(channelId, me, { muted, deafened, screen: !!localScreen, camera: !!localCamera }, dmRoom)
  stateBroadcaster.trigger()
}

function onPeerState(from: string, payload: unknown): void {
  const { muted, deafened, screen, camera, at } = (payload ?? {}) as Record<string, unknown>
  const { channelId } = useVoice.getState()
  if (!channelId || typeof at !== 'number') return
  applyVoiceState(channelId, from, { muted: muted === true, deafened: deafened === true, screen: screen === true, camera: camera === true, at })
}

// Aç/kapa sesleri üst üste binmesin: hızlı tıklamalarda sadece aralıklı olanlar çalar.
let lastToggleSound = 0
function toggleSound(play: () => void): void {
  const now = Date.now()
  if (now - lastToggleSound < 180) return
  lastToggleSound = now
  play()
}

function applyMicrophone(): void {
  mic?.setEnabled(micOpen(useVoice.getState()))
}

// Kendi "konuşuyor" göstergem ses kapısına göre (kapı kapalıysa karşıya ses gitmiyor demektir).
function localMeter(): () => void {
  let speaking = false
  const timer = setInterval(() => {
    const next = !!mic && mic.level().open
    if (next !== speaking) {
      speaking = next
      useVoice.setState((s) => ({ speaking: { ...s.speaking, [me]: next } }))
    }
  }, 80)
  return () => {
    clearInterval(timer)
    useVoice.setState((s) => {
      const copy = { ...s.speaking }
      delete copy[me]
      return { speaking: copy }
    })
  }
}

// Her bağlantının gecikmesi (ping).
type PairStats = { currentRoundTripTime?: number }
async function readLink(pc: RTCPeerConnection): Promise<PeerLink | null> {
  const stats = await pc.getStats()
  let pair: PairStats | undefined
  stats.forEach((report: { type: string; id: string; selectedCandidatePairId?: string }) => {
    if (report.type === 'transport' && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId)
  })
  if (!pair) {
    stats.forEach((report: { type: string; state?: string; nominated?: boolean }) => {
      if (!pair && report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) pair = report as unknown as PairStats
    })
  }
  if (!pair) return null
  return { ping: pair.currentRoundTripTime !== undefined ? Math.round(pair.currentRoundTripTime * 1000) : null }
}

async function refreshLinks(): Promise<void> {
  const links: Record<string, PeerLink> = {}
  for (const [userId, peer] of peers) {
    if (peer.pc.connectionState !== 'connected') continue
    const link = await readLink(peer.pc).catch(() => null)
    if (link) links[userId] = link
  }
  useVoice.setState({ links })
}

// ---------------------------------------------------------------------------
// Dışarıya açılan işlemler
// ---------------------------------------------------------------------------

// Ses efektleri: sesin kendisi gitmez, sadece "şu efekti çal" sinyali gider; herkes kendi bilgisayarında çalar.
const EFFECT_COOLDOWN_MS = 1500
let lastSentEffect = 0
const lastHeardEffect = new Map<string, number>()

function showEffect(userId: string, id: EffectId): void {
  useVoice.setState({ lastEffect: { userId, id, at: Date.now() } })
  if (!useVoice.getState().deafened) playEffect(id)
}

function onEffect(from: string, payload: unknown): void {
  const { id } = (payload ?? {}) as { id?: unknown }
  if (!isEffectId(id) || !isInRoom(from)) return
  const now = Date.now()
  if (now - (lastHeardEffect.get(from) ?? 0) < EFFECT_COOLDOWN_MS - 300) return
  lastHeardEffect.set(from, now)
  showEffect(from, id)
}

// true: gönderildi; false: bekleme süresi dolmadı ya da kanalda değilim.
export function sendEffect(id: EffectId): boolean {
  if (!signal || useVoice.getState().status !== 'connected') return false
  const now = Date.now()
  if (now - lastSentEffect < EFFECT_COOLDOWN_MS) return false
  lastSentEffect = now
  void signal.send({ type: 'broadcast', event: 'efekt', payload: { id } })
  showEffect(me, id)
  return true
}

export async function joinVoice(serverId: string | null, channelId: string, userId: string): Promise<void> {
  const current = useVoice.getState()
  if (current.channelId === channelId && current.status !== 'idle') return
  if (current.channelId) await leaveVoice(false)

  const room = current.rooms[channelId] ?? []
  if (room.length >= MAX_PARTICIPANTS && !room.some((p) => p.userId === userId)) {
    toast.info(`Bu ses kanalı dolu (en fazla ${MAX_PARTICIPANTS} kişi).`)
    return
  }

  const token = ++joinToken
  me = userId
  dmRoom = serverId === null
  setState({ status: 'connecting', channelId, serverId, speaking: {}, peers: {}, links: {}, lastEffect: null })
  lastRoom = new Set()

  // Aktarma sunucusu yoksa kanala girilmez: doğrudan bağlantı IP adresini karşıya gösterirdi.
  const relayState = await loadRelay()
  if (relayState !== 'tamam') {
    if (token === joinToken) {
      setState({ status: 'idle', channelId: null, serverId: null })
      if (relayState === 'guncelle') {
        window.turkcord?.checkForUpdate?.()
        toast.error('Sesli sohbet için Turkcord\'u güncellemen gerekiyor. Yeni sürüm indiriliyor; hazır olunca yeniden başlat.')
      } else toast.error('Ses sunucusuna (Cloudflare) ulaşılamadı. Biraz sonra tekrar dene.')
    }
    return
  }
  if (token !== joinToken) return

  try {
    mic = await openMicrophone()
  } catch (error) {
    if (token === joinToken) {
      setState({ status: 'idle', channelId: null, serverId: null })
      toast.error(micErrorMessage(error))
    }
    return
  }
  if (token !== joinToken) {
    mic.stop()
    mic = null
    return
  }
  if (mic.fellBack) toast.info('Seçtiğin mikrofon bulunamadı, varsayılan mikrofon kullanılıyor.')

  applyMicrophone()
  stopLocalMeter = localMeter()
  statsTimer = setInterval(() => void refreshLinks(), 2000)
  // Kanalda uzun süre kalınırsa sonradan kurulacak bağlantılar için aktarma bilgisi taze tutulur.
  relayTimer = setInterval(() => void loadRelay(), RELAY_REFRESH_MS)
  unwatch = watchVoiceRoom(channelId, userId, dmRoom)

  // Kendi konum: yalnızca ben yazabilirim. Başkalarının konuları kanalda göründükçe dinlenir (bkz. syncListeners).
  const channel = supabase.channel(signalTopic(channelId, userId), { config: { private: true, broadcast: { self: false } } })
  signal = channel
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' && token === joinToken) {
      signalReady = true
      startVideo({
        me,
        send: (payload) => void signal?.send({ type: 'broadcast', event: 'goruntu', payload }),
        rtc: () => relayConfig(relay),
        onLocalChange: publishState,
      })
      publishState()
      setState({ status: 'connected' })
      voiceSounds.join()
      syncListeners()
      // Sunucudaki arkadaşlara "ses kanalına girdi" bildirimi gider (bireysel aramada gerekmez).
      // (İstek ancak beklenince gönderilir; sonucu önemli değil.)
      if (!dmRoom) void supabase.rpc('announce_voice_join', { p_channel: channelId }).then(() => undefined)
    }
    if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && token === joinToken) {
      toast.error('Ses kanalına bağlanılamadı. İnternet bağlantını kontrol et.')
      void leaveVoice(false)
    }
  })
}

export async function leaveVoice(playSound = true): Promise<void> {
  const { channelId } = useVoice.getState()
  joinToken++
  stateBroadcaster.cancel()
  stopVideo()
  for (const userId of [...peers.keys()]) closePeer(userId)
  if (channelId) await untrackVoice(channelId).catch(() => {})
  unwatch?.()
  unwatch = null
  signalReady = false
  for (const userId of [...listening.keys()]) unlisten(userId)
  listenRetries.clear()
  if (signal) void supabase.removeChannel(signal)
  signal = null
  stopLocalMeter?.()
  stopLocalMeter = undefined
  clearInterval(statsTimer)
  clearInterval(relayTimer)
  mic?.stop()
  mic = null
  lastRoom = new Set()
  lastHeardEffect.clear()
  setState({ status: 'idle', channelId: null, serverId: null, speaking: {}, peers: {}, links: {}, lastEffect: null })
  if (channelId && playSound) voiceSounds.leave()
}

export function setMuted(muted: boolean): void {
  const { deafened } = useVoice.getState()
  // Sağırlaştırılmışken mikrofonu açmak sağırlaştırmayı da kaldırır.
  setState({ muted, deafened: muted ? deafened : false })
  applyMicrophone()
  for (const [userId, peer] of peers) applyOutput(peer.audio, userId)
  publishState()
  toggleSound(muted ? voiceSounds.mute : voiceSounds.unmute)
}

export function setDeafened(deafened: boolean): void {
  setState({ deafened })
  applyMicrophone()
  for (const [userId, peer] of peers) applyOutput(peer.audio, userId)
  publishState()
  toggleSound(deafened ? voiceSounds.mute : voiceSounds.unmute)
}

export function setUserVolume(userId: string, volume: number): void {
  const volumes = { ...useVoice.getState().volumes, [userId]: Math.min(1, Math.max(0, volume)) }
  useVoice.getState().setPrefs({ volumes })
  const peer = peers.get(userId)
  if (peer) applyOutput(peer.audio, userId)
}

// Mikrofon, hoparlör ya da ses işleme ayarı değişince bağlantıyı koparmadan yeni hatta geç.
export async function applyDeviceChange(reopenMic = true): Promise<void> {
  for (const [userId, peer] of peers) applyOutput(peer.audio, userId)
  if (!mic || !reopenMic) return
  const token = joinToken
  try {
    const next = await openMicrophone()
    if (token !== joinToken || !mic) {
      next.stop()
      return
    }
    const track = next.stream.getAudioTracks()[0]
    for (const peer of peers.values()) {
      const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'audio')
      await sender?.replaceTrack(track)
    }
    mic.stop()
    mic = next
    applyMicrophone()
    if (next.fellBack) toast.info('Seçtiğin mikrofon bulunamadı, varsayılan mikrofon kullanılıyor.')
  } catch (error) {
    toast.error(micErrorMessage(error))
  }
}

// Bas-konuş tuşu basıldı/bırakıldı.
export function setPushToTalk(down: boolean): void {
  const state = useVoice.getState()
  if (state.pttDown === down) return
  setState({ pttDown: down })
  applyMicrophone()
  if (state.status === 'connected' && state.inputMode === 'bas-konus' && !state.muted && !state.deafened) {
    if (down) voiceSounds.pttOn()
    else voiceSounds.pttOff()
  }
}

// Ses modu değişince (ör. bas-konuş açılınca) mikrofonu hemen ona göre ayarla.
useVoice.subscribe((state, prev) => {
  if (state.inputMode !== prev.inputMode) applyMicrophone()
})

// Uygulama kapanırken kanaldan düzgün çık.
window.addEventListener('beforeunload', () => {
  if (useVoice.getState().channelId) void leaveVoice(false)
})
