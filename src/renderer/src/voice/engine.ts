import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { toast } from '@/stores/toast'
import { trackVoice, untrackVoice, watchVoiceRoom } from './presence'
import { tuneOpus } from './sdp'
import { voiceSounds } from './sounds'
import { useVoice, volumeOf } from './store'

// Sesli sohbet: kanaldaki herkes birbirine doğrudan (P2P, WebRTC) bağlanır. Ses Supabase'den geçmez;
// Supabase sadece bağlantı kurulurken bilgi alışverişi ("ses:{kanal}" yayını) ve kimin kanalda
// olduğunu göstermek için ("chan:{kanal}" presence) kullanılır.
//
// Her iki kişi arasında tek bağlantı olur: kullanıcı kimliği küçük olan teklif (offer) gönderir.
// Yeni gelen "hazir" yayınlar, kanaldakiler "merhaba" ile cevap verir; böylece iki taraf da
// karşısının dinlemeye başladığını bilir ve teklif kaybolmaz.

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
let localStream: MediaStream | null = null
let stopLocalMeter: (() => void) | undefined
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

function microphoneConstraints(): MediaTrackConstraints {
  const { inputDeviceId, noiseSuppression, echoCancellation } = useVoice.getState()
  return {
    deviceId: inputDeviceId && inputDeviceId !== 'default' ? { ideal: inputDeviceId } : undefined,
    echoCancellation,
    noiseSuppression,
    autoGainControl: true,
    channelCount: 1,
  }
}

function micError(error: unknown): string {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Mikrofon izni yok. Windows Ayarları > Gizlilik > Mikrofon bölümünden masaüstü uygulamalarına izin ver.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Mikrofon bulunamadı. Takılı olduğundan emin ol.'
  if (name === 'NotReadableError') return 'Mikrofon başka bir uygulama tarafından kullanılıyor olabilir.'
  return 'Mikrofon açılamadı.'
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
      const state = useVoice.getState()
      const silenced = userId === me ? state.muted || state.deafened : false
      const now = Date.now()
      if (rms > SPEAKING_THRESHOLD && !silenced) lastLoud = now
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

  for (const track of localStream?.getTracks() ?? []) pc.addTrack(track, localStream!)

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

async function offer(userId: string): Promise<void> {
  if (peers.has(userId) || !localStream) return
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
  }
  lastRoom = now
}
useVoice.subscribe((state, prev) => {
  if (state.rooms !== prev.rooms) onRoomChange()
})

function publishState(): void {
  const { channelId, muted, deafened } = useVoice.getState()
  if (channelId) void trackVoice(channelId, me, { muted, deafened })
}

function applyMicrophone(): void {
  const { muted, deafened } = useVoice.getState()
  for (const track of localStream?.getAudioTracks() ?? []) track.enabled = !muted && !deafened
}

// ---------------------------------------------------------------------------
// Dışarıya açılan işlemler
// ---------------------------------------------------------------------------

export async function joinVoice(serverId: string, channelId: string, userId: string): Promise<void> {
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
  setState({ status: 'connecting', channelId, serverId, speaking: {}, peers: {} })
  lastRoom = new Set()

  try {
    await loadIceServers()
    localStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false })
  } catch (error) {
    if (token === joinToken) {
      setState({ status: 'idle', channelId: null, serverId: null })
      toast.error(micError(error))
    }
    return
  }
  if (token !== joinToken) {
    localStream.getTracks().forEach((t) => t.stop())
    return
  }

  applyMicrophone()
  stopLocalMeter = meter(localStream, userId)
  unwatch = watchVoiceRoom(channelId, userId)

  const channel = supabase.channel(`ses:${channelId}`, { config: { private: true, broadcast: { self: false } } })
  signal = channel
  channel
    .on('broadcast', { event: 'sinyal' }, ({ payload }) => void onSignal(payload as Signal))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && token === joinToken) {
        send({ type: 'hazir', from: me })
        publishState()
        setState({ status: 'connected' })
        voiceSounds.join()
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
  for (const userId of [...peers.keys()]) closePeer(userId)
  if (channelId) await untrackVoice(channelId).catch(() => {})
  unwatch?.()
  unwatch = null
  if (signal) void supabase.removeChannel(signal)
  signal = null
  stopLocalMeter?.()
  stopLocalMeter = undefined
  localStream?.getTracks().forEach((t) => t.stop())
  localStream = null
  lastRoom = new Set()
  setState({ status: 'idle', channelId: null, serverId: null, speaking: {}, peers: {} })
  if (channelId && playSound) voiceSounds.leave()
}

export function setMuted(muted: boolean): void {
  const { deafened } = useVoice.getState()
  // Sağırlaştırılmışken mikrofonu açmak sağırlaştırmayı da kaldırır.
  setState({ muted, deafened: muted ? deafened : false })
  applyMicrophone()
  for (const [userId, peer] of peers) applyOutput(peer.audio, userId)
  publishState()
  if (muted) voiceSounds.mute()
  else voiceSounds.unmute()
}

export function setDeafened(deafened: boolean): void {
  setState({ deafened })
  applyMicrophone()
  for (const [userId, peer] of peers) applyOutput(peer.audio, userId)
  publishState()
  if (deafened) voiceSounds.mute()
  else voiceSounds.unmute()
}

export function setUserVolume(userId: string, volume: number): void {
  const volumes = { ...useVoice.getState().volumes, [userId]: Math.min(1, Math.max(0, volume)) }
  useVoice.getState().setPrefs({ volumes })
  const peer = peers.get(userId)
  if (peer) applyOutput(peer.audio, userId)
}

// Mikrofon ya da hoparlör değişince bağlantıyı koparmadan yeni cihaza geç.
export async function applyDeviceChange(): Promise<void> {
  for (const [userId, peer] of peers) applyOutput(peer.audio, userId)
  if (!localStream) return
  try {
    const next = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false })
    const track = next.getAudioTracks()[0]
    for (const peer of peers.values()) {
      const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'audio')
      await sender?.replaceTrack(track)
    }
    localStream.getTracks().forEach((t) => t.stop())
    localStream = next
    applyMicrophone()
    stopLocalMeter?.()
    stopLocalMeter = meter(next, me)
  } catch (error) {
    toast.error(micError(error))
  }
}

// Uygulama kapanırken kanaldan düzgün çık.
window.addEventListener('beforeunload', () => {
  if (useVoice.getState().channelId) void leaveVoice(false)
})
