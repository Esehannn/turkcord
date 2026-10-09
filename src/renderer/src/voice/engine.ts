import type { RealtimeChannel } from '@supabase/supabase-js'
import { coalesce } from '@/lib/coalesce'
import { isEffectId, playEffect, type EffectId } from '@/lib/sounds'
import { supabase } from '@/lib/supabase'
import { toast } from '@/stores/toast'
import { micErrorMessage, openMicrophone, type Microphone } from './mic'
import { applyVoiceState, trackVoice, untrackVoice, watchVoiceRoom } from './presence'
import { tuneOpus } from './sdp'
import { voiceSounds } from './sounds'
import { micOpen, useVoice, volumeOf, type PeerLink } from './store'

// Sesli sohbet: kanaldaki herkes birbirine doğrudan (P2P, WebRTC) bağlanır. Ses Supabase'den geçmez;
// Supabase sadece bağlantı kurulurken bilgi alışverişi ("ses:{kanal}" yayını) ve kimin kanalda
// olduğunu göstermek için ("chan:{kanal}" presence) kullanılır.
//
// Her iki kişi arasında tek bağlantı olur: kullanıcı kimliği küçük olan teklif (offer) gönderir.
// Yeni gelen "hazir" yayınlar, kanaldakiler "merhaba" ile cevap verir; böylece iki taraf da
// karşısının dinlemeye başladığını bilir ve teklif kaybolmaz.
//
// Bireysel aramalar da aynı motoru kullanır: kanal özel mesajın kanalıdır, sunucu yoktur (serverId null).

export const MAX_PARTICIPANTS = 10
const SPEAKING_THRESHOLD = 0.018
const SPEAKING_HOLD_MS = 350

type Signal =
  | { type: 'hazir'; from: string }
  | { type: 'merhaba'; from: string; to: string }
  | { type: 'teklif'; from: string; to: string; sdp: string }
  | { type: 'cevap'; from: string; to: string; sdp: string }
  | { type: 'aday'; from: string; to: string; candidate: RTCIceCandidateInit }

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
let signal: RealtimeChannel | null = null
let unwatch: (() => void) | null = null
let iceServers: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]
let iceFetchedAt = 0
const peers = new Map<string, Peer>()
let audioCtx: AudioContext | null = null
let joinToken = 0

function setState(partial: Partial<ReturnType<typeof useVoice.getState>>): void {
  useVoice.setState(partial)
}

async function loadIceServers(): Promise<void> {
  if (Date.now() - iceFetchedAt < 6 * 60 * 60 * 1000) return
  try {
    const { data, error } = await supabase.functions.invoke<{ iceServers: RTCIceServer[] }>('turn')
    if (!error && data?.iceServers?.length) {
      iceServers = data.iceServers
      iceFetchedAt = Date.now()
    }
  } catch {
    // STUN ile devam edilir.
  }
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
  const pc = new RTCPeerConnection({ iceServers })
  const audio = new Audio()
  audio.autoplay = true
  const peer: Peer = { pc, audio, pending: [] }
  peers.set(userId, peer)
  setPeerState(userId, pc.connectionState)

  if (mic) for (const track of mic.stream.getTracks()) pc.addTrack(track, mic.stream)

  pc.onicecandidate = (event) => {
    if (event.candidate) send({ type: 'aday', from: me, to: userId, candidate: event.candidate.toJSON() })
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
          else send({ type: 'merhaba', from: me, to: userId })
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
  if (peers.has(userId) || !mic) return
  const peer = createPeer(userId)
  const description = await peer.pc.createOffer()
  description.sdp = tuneOpus(description.sdp ?? '')
  await peer.pc.setLocalDescription(description)
  send({ type: 'teklif', from: me, to: userId, sdp: description.sdp })
}

async function flushCandidates(peer: Peer): Promise<void> {
  for (const candidate of peer.pending.splice(0)) {
    await peer.pc.addIceCandidate(candidate).catch(() => {})
  }
}

async function onSignal(message: Signal): Promise<void> {
  if (message.from === me) return
  if ('to' in message && message.to !== me) return
  try {
    switch (message.type) {
      case 'hazir':
        send({ type: 'merhaba', from: me, to: message.from })
        // Yeni gelen, susturma durumumu presence'tan geç öğrenebilir; hemen bildir.
        stateBroadcaster.trigger()
        if (me < message.from) await offer(message.from)
        break
      case 'merhaba':
        if (me < message.from) await offer(message.from)
        break
      case 'teklif': {
        closePeer(message.from)
        const peer = createPeer(message.from)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp })
        await flushCandidates(peer)
        const answer = await peer.pc.createAnswer()
        answer.sdp = tuneOpus(answer.sdp ?? '')
        await peer.pc.setLocalDescription(answer)
        send({ type: 'cevap', from: me, to: message.from, sdp: answer.sdp })
        break
      }
      case 'cevap': {
        const peer = peers.get(message.from)
        if (!peer || peer.pc.signalingState !== 'have-local-offer') return
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
        await flushCandidates(peer)
        break
      }
      case 'aday': {
        const peer = peers.get(message.from)
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
  else send({ type: 'merhaba', from: me, to: userId })
}

// Kanaldan çıkanların bağlantısını kapat, girenler için ses efekti çal.
let lastRoom = new Set<string>()
function onRoomChange(): void {
  const { channelId, rooms, status } = useVoice.getState()
  if (!channelId || status === 'idle') return
  const now = new Set((rooms[channelId] ?? []).map((p) => p.userId))
  // Sadece çıktığı görülenlerin bağlantısı kapanır; yeni gelenin presence bilgisi sinyalden geç gelebilir.
  for (const userId of [...peers.keys()]) if (lastRoom.has(userId) && !now.has(userId)) closePeer(userId)
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
  const { channelId, status, muted, deafened } = useVoice.getState()
  if (!channelId || status !== 'connected' || !signal) return
  void signal.send({ type: 'broadcast', event: 'durum', payload: { from: me, muted, deafened, at: Date.now() } })
}, 150)

function publishState(): void {
  const { channelId, muted, deafened } = useVoice.getState()
  if (!channelId) return
  void trackVoice(channelId, me, { muted, deafened }, dmRoom)
  stateBroadcaster.trigger()
}

function onPeerState(payload: unknown): void {
  const { from, muted, deafened, at } = (payload ?? {}) as { from?: unknown; muted?: unknown; deafened?: unknown; at?: unknown }
  const { channelId } = useVoice.getState()
  if (!channelId || typeof from !== 'string' || from === me || typeof at !== 'number') return
  applyVoiceState(channelId, from, { muted: muted === true, deafened: deafened === true, at })
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

// Her bağlantının gecikmesi (ping) ve doğrudan mı yoksa aktarma sunucusu üzerinden mi gittiği.
type PairStats = { currentRoundTripTime?: number; localCandidateId?: string; remoteCandidateId?: string }
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
  const local = pair.localCandidateId ? stats.get(pair.localCandidateId) : undefined
  const remote = pair.remoteCandidateId ? stats.get(pair.remoteCandidateId) : undefined
  return {
    ping: pair.currentRoundTripTime !== undefined ? Math.round(pair.currentRoundTripTime * 1000) : null,
    relay: local?.candidateType === 'relay' || remote?.candidateType === 'relay',
  }
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

function onEffect(payload: unknown): void {
  const { from, id } = (payload ?? {}) as { from?: unknown; id?: unknown }
  if (typeof from !== 'string' || from === me || !isEffectId(id) || !isInRoom(from)) return
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
  void signal.send({ type: 'broadcast', event: 'efekt', payload: { from: me, id } })
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

  try {
    await loadIceServers()
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
  unwatch = watchVoiceRoom(channelId, userId, dmRoom)

  const channel = supabase.channel(`ses:${channelId}`, { config: { private: true, broadcast: { self: false } } })
  signal = channel
  channel
    .on('broadcast', { event: 'sinyal' }, ({ payload }) => void onSignal(payload as Signal))
    .on('broadcast', { event: 'efekt' }, ({ payload }) => onEffect(payload))
    .on('broadcast', { event: 'durum' }, ({ payload }) => onPeerState(payload))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && token === joinToken) {
        send({ type: 'hazir', from: me })
        publishState()
        setState({ status: 'connected' })
        voiceSounds.join()
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
  for (const userId of [...peers.keys()]) closePeer(userId)
  if (channelId) await untrackVoice(channelId).catch(() => {})
  unwatch?.()
  unwatch = null
  if (signal) void supabase.removeChannel(signal)
  signal = null
  stopLocalMeter?.()
  stopLocalMeter = undefined
  clearInterval(statsTimer)
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
