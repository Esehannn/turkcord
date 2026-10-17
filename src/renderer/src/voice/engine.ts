import type { RealtimeChannel } from '@supabase/supabase-js'
import { coalesce } from '@/lib/coalesce'
import { isEffectId, playEffect, type EffectId } from '@/lib/sounds'
import { supabase } from '@/lib/supabase'
import { toast } from '@/stores/toast'
import { rtcConfig, relayServers, type IceServer } from './ice'
import { micErrorMessage, openMicrophone, type Microphone } from './mic'
import { applyVoiceState, trackVoice, untrackVoice, watchVoiceRoom } from './presence'
import { SfuError, SfuSession, type TrackName } from './sfu'
import { onVideoSignal, retryVideo, startVideo, stopVideo, syncVideoRoom } from './video'
import { voiceSounds } from './sounds'
import { micOpen, useVoice, volumeOf, type PeerState } from './store'

// Sesli sohbet: odanın sunucusu (Cloudflare Realtime SFU) üzerinden. Herkes Cloudflare'e tek bir bağlantı kurar,
// kendi sesini bir kez gönderir, odadakilerin sesini oradan çeker (bkz. sfu.ts). Kanaldakiler birbirine bağlanmaz;
// kimse başkasının IP adresini görmez. Bir sesi kimin çekebileceğini "oda" Edge Function'ı ve veritabanı denetler:
// yalnızca o kanalda oturumu olan, kanala erişimi olan kişi.
//
// Supabase yalnızca kimin kanalda olduğunu ("chan:{kanal}" presence) ve küçük olayları taşır. Olaylar (susturma
// durumu, ses efekti, görüntü istekleri) herkesin kendi konusundan gider: "sinyal:{kanal}:{kullanıcı}". Herkes
// yalnızca kendi konusuna yazabilir (veritabanı zorlar); bir olayın kimden geldiği mesajın içinden değil, geldiği
// konudan anlaşılır. Yalnızca kanalda görünen (katılımcı listesindeki) kişilerin konusu dinlenir ve yalnızca
// onların sesi çekilir.
//
// Biri ses oturumu açınca veritabanı "oda:{kanal}" konusuna duyurur; duyurulan kişi listede görünmüyorsa
// odadakiler uyarılır (listede görünmeden dinlemeye karşı).
//
// Kopmalar: bekçi (her 2 sn) her kişiden ses paketi gelip gelmediğine bakar. Susturulmuş birinden de saniyede
// onlarca paket gelir; 8 sn hiç gelmezse o kişinin sesi yeniden çekilir. Cloudflare bağlantısı koparsa oturum
// baştan kurulur ("Yeniden bağlanıyor…").
//
// Bireysel aramalar da aynı motoru kullanır: kanal özel mesajın kanalıdır, sunucu yoktur (serverId null).
// Görüntü (ekran paylaşımı, kamera) ayrı bir oturumdan gider ve yalnızca izlenince açılır; bkz. video.ts.

export const MAX_PARTICIPANTS = 10
const SPEAKING_THRESHOLD = 0.018
const SPEAKING_HOLD_MS = 350
// Bir kişiden bu kadar süre ses paketi gelmezse sesi yeniden çekilir.
const STALL_MS = 8000
// Cloudflare bağlantısı bu kadar süre kopuk kalırsa oturum baştan kurulur.
const LOST_MS = 5000
// Çekilemeyen ses (ör. kişi henüz yayınlamadı) giderek seyrelen aralıklarla yeniden denenir.
const PULL_RETRY_MAX_MS = 15_000
// Listede görünmeden bağlanan biri için uyarıdan önce beklenen süre (presence geç gelebilir).
const HIDDEN_GRACE_MS = 15_000
// "Duyamıyorum" denince oturum baştan kurulur: en fazla bu sıklıkla ve en az bu kadar yaşamış bir oturum için
// (yeni açılan oturumun yayını birkaç saniye içinde görünür olur).
const SELF_RESTART_MS = 15_000
const SELF_RESTART_MIN_AGE_MS = 5000
// Bir kişiye en fazla bu sıklıkla "duyamıyorum" denir.
const COMPLAIN_MS = 15_000

// merhaba: konunun dinlendiğini karşıya bildirir; karşı taraf susturma durumunu hemen yollar.
// duyamiyorum: karşının sesi birkaç denemede çekilemedi; Cloudflare'deki yayını bozulmuş olabilir, o kendi oturumunu
// baştan kurar. yenilendi: oturumumu baştan kurdum; sesimi yeni oturumdan hemen yeniden çek.
type Signal = { type: 'merhaba' | 'duyamiyorum' | 'yenilendi'; to: string }

const signalTopic = (channelId: string, userId: string): string => `sinyal:${channelId}:${userId}`
// Aynı anda en fazla bu kadar kişinin konusu dinlenir (liste şişirilse bile kanal sayısı sınırlı kalır).
const MAX_LISTENING = 16
// Bir kişinin konusu dinlenemezse giderek seyrelen aralıklarla (2, 4, 8… sn; en fazla bu kadar) yeniden denenir.
const LISTEN_RETRY_MAX_MS = 60_000

// Çekilen bir ses: hangi transceiver'dan geldiği, çalan öğe ve son görülen paket sayısı.
type Remote = {
  mid: string
  audio: HTMLAudioElement
  stopMeter?: () => void
  packets: number
  changedAt: number
}

let me = ''
// Bağlı olunan oda bir özel mesaj araması mı?
let dmRoom = false
let mic: Microphone | null = null
let stopLocalMeter: (() => void) | undefined
let statsTimer: ReturnType<typeof setInterval> | undefined
// Kendi konum: bütün olaylarımı buraya yazarım.
let signal: RealtimeChannel | null = null
let signalReady = false
// Odanın duyuruları ("oda:{kanal}"; yalnızca veritabanı yazar).
let roomNews: RealtimeChannel | null = null
// Dinlediğim konular (kişi → kanal) ve dinlemesi kurulmuş olanlar.
const listening = new Map<string, RealtimeChannel>()
const listenRetries = new Map<string, number>()
let unwatch: (() => void) | null = null
// Aktarma (TURN) bilgisi: UDP'nin kapalı olduğu ağlarda Cloudflare'e aktarma üzerinden bağlanmak için. Sunucuda 24 saat
// geçerli; bir saatten eskiyse yenisi istenir. Alınamazsa doğrudan (Cloudflare'e) bağlanılır.
const RELAY_REFRESH_MS = 60 * 60 * 1000
const RELAY_VALID_MS = 23 * 60 * 60 * 1000
let relay: IceServer[] = []
let relayFetchedAt = 0
let relayTimer: ReturnType<typeof setInterval> | undefined
// Cloudflare'deki ses oturumum ve oradan çektiğim sesler.
let session: SfuSession | null = null
const remotes = new Map<string, Remote>()
const pulling = new Set<string>()
const pullRetries = new Map<string, { at: number; tries: number }>()
let lostSince = 0
let restartTimer: ReturnType<typeof setTimeout> | undefined
let restartTries = 0
let sessionOpenedAt = 0
let selfRestartAt = 0
const complained = new Map<string, number>()
let audioCtx: AudioContext | null = null
let joinToken = 0

function setState(partial: Partial<ReturnType<typeof useVoice.getState>>): void {
  useVoice.setState(partial)
}

function rtc(): RTCConfiguration {
  return rtcConfig(Date.now() - relayFetchedAt < RELAY_VALID_MS ? relay : [])
}

// 'guncelle': sunucu bu sürüme artık bağlantı bilgisi vermiyor (asgari sürüm, bkz. supabase/functions/turn).
async function loadRelay(): Promise<'tamam' | 'guncelle'> {
  if (Date.now() - relayFetchedAt < RELAY_REFRESH_MS) return 'tamam'
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
    // Aktarma olmadan da (doğrudan Cloudflare'e) bağlanılabilir.
  }
  return 'tamam'
}

function askForUpdate(): void {
  window.turkcord?.checkForUpdate?.()
  toast.error('Sesli sohbet için Turkcord\'u güncellemen gerekiyor. Yeni sürüm indiriliyor; hazır olunca yeniden başlat.')
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

function setPeerState(userId: string, state: PeerState | null): void {
  if ((useVoice.getState().peers[userId] ?? null) === state) return
  useVoice.setState((s) => {
    const peersState = { ...s.peers }
    if (state) peersState[userId] = state
    else delete peersState[userId]
    return { peers: peersState }
  })
}

function isInRoom(userId: string): boolean {
  const { channelId, rooms } = useVoice.getState()
  return !!channelId && !!rooms[channelId]?.some((p) => p.userId === userId)
}

// ---------------------------------------------------------------------------
// Odadakilerin sesi
// ---------------------------------------------------------------------------

function onRemoteTrack(userId: string, name: TrackName, track: MediaStreamTrack, mid: string): void {
  if (name !== 'ses') return
  let remote = remotes.get(userId)
  if (remote && remote.mid !== mid) {
    releaseRemote(userId)
    remote = undefined
  }
  if (!remote) {
    remote = { mid, audio: new Audio(), packets: 0, changedAt: Date.now() }
    remote.audio.autoplay = true
    remotes.set(userId, remote)
  }
  const stream = new MediaStream([track])
  remote.audio.srcObject = stream
  applyOutput(remote.audio, userId)
  void remote.audio.play().catch(() => {})
  remote.stopMeter?.()
  remote.stopMeter = meter(stream, userId)
}

// Çalan öğeyi ve ölçeri bırakır (Cloudflare'deki iz ayrıca kapatılır).
function releaseRemote(userId: string): Remote | undefined {
  const remote = remotes.get(userId)
  if (!remote) return undefined
  remotes.delete(userId)
  remote.stopMeter?.()
  remote.audio.srcObject = null
  return remote
}

function dropRemote(userId: string): void {
  const remote = releaseRemote(userId)
  if (remote && session && !session.isClosed) void session.drop([remote.mid]).catch(() => {})
}

// Kişinin yeni bir oturumu var: eski izi bırakıp yenisini hemen çek.
function refreshRemote(userId: string): void {
  dropRemote(userId)
  pullRetries.delete(userId)
  setPeerState(userId, 'connecting')
  void syncAudio()
}

function schedulePullRetry(userId: string): void {
  const tries = (pullRetries.get(userId)?.tries ?? 0) + 1
  pullRetries.set(userId, { tries, at: Date.now() + Math.min(PULL_RETRY_MAX_MS, 1000 * 2 ** (tries - 1)) })
}

// Odada görünen herkesin sesini çeker; çıkanların sesini bırakır.
async function syncAudio(): Promise<void> {
  const current = session
  const { channelId, rooms, status } = useVoice.getState()
  if (!current?.id || current.isClosed || !channelId || status === 'idle') return
  const room = (rooms[channelId] ?? []).filter((p) => p.userId !== me && !p.legacy)
  const wanted = new Set(room.map((p) => p.userId))

  for (const userId of [...remotes.keys()]) {
    if (!wanted.has(userId)) {
      dropRemote(userId)
      setPeerState(userId, null)
    }
  }
  for (const userId of [...pullRetries.keys()]) if (!wanted.has(userId)) pullRetries.delete(userId)
  for (const userId of Object.keys(useVoice.getState().peers)) if (!wanted.has(userId)) setPeerState(userId, null)

  const now = Date.now()
  const asks = [...wanted].filter((u) => !remotes.has(u) && !pulling.has(u) && (pullRetries.get(u)?.at ?? 0) <= now)
  if (!asks.length) return
  for (const userId of asks) {
    pulling.add(userId)
    if (!useVoice.getState().peers[userId]) setPeerState(userId, 'connecting')
  }
  try {
    const results = await current.pull(asks.map((user) => ({ user, name: 'ses' as const })))
    for (const result of results) {
      if (result.mid && session === current) {
        if (!remotes.has(result.user)) {
          const audio = new Audio()
          audio.autoplay = true
          remotes.set(result.user, { mid: result.mid, audio, packets: 0, changedAt: Date.now() })
        }
        pullRetries.delete(result.user)
      } else {
        // not_found: kişi henüz yayınlamadı (girişi sürüyor) ya da çıktı; biraz sonra yeniden denenir.
        schedulePullRetry(result.user)
      }
    }
  } catch (error) {
    for (const userId of asks) schedulePullRetry(userId)
    if (error instanceof SfuError && (error.code === 'session_gone' || error.code === 'not_found')) restartSession()
  } finally {
    for (const userId of asks) pulling.delete(userId)
  }
}

// Bekçi: gecikmeyi okur, sesi gelmeyenleri yeniden çeker, kopmuş bağlantıyı baştan kurar.
async function watchdog(): Promise<void> {
  const current = session
  if (!current || current.isClosed || !current.id) return
  if (lostSince && Date.now() - lostSince > LOST_MS) {
    restartSession()
    return
  }
  const stats = await current.stats().catch(() => null)
  if (!stats || session !== current) return
  setState({ link: { ping: stats.ping, transport: stats.transport } })
  const now = Date.now()
  for (const [userId, remote] of [...remotes]) {
    const packets = stats.packets.get(remote.mid) ?? 0
    if (packets > remote.packets) {
      remote.packets = packets
      remote.changedAt = now
      setPeerState(userId, 'connected')
    } else if (now - remote.changedAt > STALL_MS) {
      // Sesi gelmiyor: izi bırakıp yeniden çek.
      setPeerState(userId, 'lost')
      dropRemote(userId)
      schedulePullRetry(userId)
    }
  }
  for (const [userId, retry] of pullRetries) {
    if (retry.tries < 2) continue
    // Sesi art arda çekilemiyor: Cloudflare'deki yayını bozulmuş olabilir, ona söyle; o oturumunu yeniler.
    if (now - (complained.get(userId) ?? 0) > COMPLAIN_MS) {
      complained.set(userId, now)
      send({ type: 'duyamiyorum', to: userId })
    }
    if (retry.tries >= 3) setPeerState(userId, 'lost')
  }
  void syncAudio()
}

function onSessionState(state: RTCPeerConnectionState): void {
  if (state === 'connected') {
    lostSince = 0
    restartTries = 0
    if (useVoice.getState().reconnecting) setState({ reconnecting: false })
  } else if (state === 'disconnected') {
    lostSince ||= Date.now()
  } else if (state === 'failed') {
    restartSession()
  }
}

async function openSession(channelId: string): Promise<'tamam' | 'guncelle'> {
  const track = mic?.stream.getAudioTracks()[0]
  if (!track) throw new SfuError('no_mic')
  const next = new SfuSession('ses', channelId, rtc(), { onTrack: onRemoteTrack, onState: onSessionState })
  session = next
  sessionOpenedAt = Date.now()
  try {
    return await next.start(__APP_VERSION__, [{ track, name: 'ses' }])
  } catch (error) {
    if (session === next) session = null
    void next.end()
    throw error
  }
}

// Cloudflare bağlantısı koptu: oturumu baştan kur ve herkesin sesini yeniden çek.
function restartSession(): void {
  const { channelId, status } = useVoice.getState()
  if (!channelId || status !== 'connected' || restartTimer) return
  const token = joinToken
  const old = session
  session = null
  lostSince = 0
  for (const userId of [...remotes.keys()]) {
    releaseRemote(userId)
    setPeerState(userId, 'connecting')
  }
  pullRetries.clear()
  void old?.end()
  setState({ reconnecting: true, link: null })
  const delay = restartTries === 0 ? 0 : Math.min(20_000, 1500 * 2 ** (restartTries - 1))
  restartTries++
  restartTimer = setTimeout(async () => {
    restartTimer = undefined
    if (token !== joinToken) return
    try {
      await loadRelay()
      const result = await openSession(channelId)
      if (token !== joinToken) return
      if (result === 'guncelle') {
        askForUpdate()
        void leaveVoice(false)
        return
      }
      // Odadakiler eski yayınımın durduğunu ancak birkaç saniye sonra anlardı; hemen haber ver.
      for (const userId of listening.keys()) send({ type: 'yenilendi', to: userId })
      void syncAudio()
    } catch {
      if (token === joinToken) restartSession()
    }
  }, delay)
}

// ---------------------------------------------------------------------------
// Olaylar (susturma durumu, efektler, görüntü istekleri)
// ---------------------------------------------------------------------------

// from: olayın geldiği konunun sahibi (sunucu doğrular); mesajın içindeki bir alana güvenilmez.
function onSignal(from: string, message: Signal): void {
  if (message?.to !== me || !isInRoom(from)) return
  if (message.type === 'merhaba') {
    // Karşı taraf beni dinlemeye başladı. Susturma durumumu presence'tan geç öğrenebilir; hemen bildir.
    stateBroadcaster.trigger()
    retryVideo(from)
  } else if (message.type === 'duyamiyorum') {
    const now = Date.now()
    if (!session || now - sessionOpenedAt < SELF_RESTART_MIN_AGE_MS || now - selfRestartAt < SELF_RESTART_MS) return
    selfRestartAt = now
    restartSession()
  } else if (message.type === 'yenilendi' && remotes.has(from)) {
    refreshRemote(from)
  }
}

function unlisten(userId: string): void {
  const channel = listening.get(userId)
  if (!channel) return
  listening.delete(userId)
  void supabase.removeChannel(channel)
}

// Bir katılımcının konusunu dinlemeye başlar; dinleme kurulunca ona "merhaba" denir.
function listen(channelId: string, userId: string): void {
  if (listening.has(userId) || listening.size >= MAX_LISTENING) return
  const token = joinToken
  const channel = supabase.channel(signalTopic(channelId, userId), { config: { private: true } })
  listening.set(userId, channel)
  channel
    .on('broadcast', { event: 'sinyal' }, ({ payload }) => onSignal(userId, payload as Signal))
    .on('broadcast', { event: 'efekt' }, ({ payload }) => onEffect(userId, payload))
    .on('broadcast', { event: 'durum' }, ({ payload }) => onPeerState(userId, payload))
    .on('broadcast', { event: 'goruntu' }, ({ payload }) => void onVideoSignal(userId, payload))
    .subscribe((status) => {
      if (token !== joinToken || listening.get(userId) !== channel) return
      if (status === 'SUBSCRIBED') {
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

// Yalnızca kanalda görünenlerin konusu dinlenir. Eski sürümdekiler (legacy) bu düzeni bilmez; dinlenmez.
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

// Kanaldan çıkanların sesini bırak, girenler için ses efekti çal.
let lastRoom = new Set<string>()
function onRoomChange(): void {
  const { channelId, rooms, status } = useVoice.getState()
  if (!channelId || status === 'idle') return
  const now = new Set((rooms[channelId] ?? []).map((p) => p.userId))
  syncListeners()
  syncVideoRoom()
  void syncAudio()
  if (status === 'connected') {
    for (const userId of now) if (!lastRoom.has(userId) && userId !== me) voiceSounds.join()
    for (const userId of lastRoom) if (!now.has(userId) && userId !== me) voiceSounds.leave()
    // Yeni gelen biri hemen çekilebilsin diye eski bekleme süresi silinir.
    for (const userId of now) if (!lastRoom.has(userId)) pullRetries.delete(userId)
  }
  lastRoom = now
}
useVoice.subscribe((state, prev) => {
  if (state.rooms !== prev.rooms) onRoomChange()
})

// Biri ses oturumu açtı (veritabanı duyurdu). Bir süre sonra hâlâ listede görünmüyorsa odadakiler uyarılır.
function onSessionNews(payload: unknown): void {
  const { user } = (payload ?? {}) as { user?: unknown }
  if (typeof user !== 'string' || user === me) return
  // Odadaki biri yeni oturum açtı (yeniden girdi ya da uygulamayı yeniden başlattı): eski yayını artık durdu, yenisini
  // beklemeden çek.
  if (remotes.has(user)) refreshRemote(user)
  const token = joinToken
  setTimeout(async () => {
    const { channelId, status } = useVoice.getState()
    if (token !== joinToken || !channelId || status !== 'connected' || isInRoom(user)) return
    const { data } = await supabase.from('profiles').select('display_name').eq('id', user).maybeSingle()
    if (token !== joinToken || isInRoom(user)) return
    toast.error(`${data?.display_name ?? 'Biri'} bu kanala listede görünmeden bağlandı. Konuşulanları duyabilir.`)
  }, HIDDEN_GRACE_MS)
}

// Susturma/sağırlaştırma durumunu kanaldakilere bildirir. İki yoldan gider:
//  - Anında: kendi konumdan yayın ("durum"). Sınırı yoktur; düğmeye hızlı basılsa bile en fazla
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

function joinFailed(token: number, message: string): void {
  if (token !== joinToken) return
  void leaveVoice(false)
  toast.error(message)
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
  setState({ status: 'connecting', channelId, serverId, speaking: {}, peers: {}, link: null, reconnecting: false, lastEffect: null })
  lastRoom = new Set()

  if ((await loadRelay()) === 'guncelle') {
    if (token === joinToken) {
      setState({ status: 'idle', channelId: null, serverId: null })
      askForUpdate()
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

  // Önce Cloudflare'deki oturum: açılamazsa kanala girilmiş gibi görünmeyiz.
  try {
    const result = await openSession(channelId)
    if (token !== joinToken) return
    if (result === 'guncelle') {
      void leaveVoice(false)
      askForUpdate()
      return
    }
  } catch (error) {
    const code = error instanceof SfuError ? error.code : ''
    joinFailed(
      token,
      code === 'forbidden'
        ? 'Bu kanala girme iznin yok.'
        : code === 'rate_limited'
          ? 'Çok sık girip çıktın. Biraz bekleyip tekrar dene.'
          : 'Ses sunucusuna (Cloudflare) ulaşılamadı. Biraz sonra tekrar dene.',
    )
    return
  }

  stopLocalMeter = localMeter()
  statsTimer = setInterval(() => void watchdog(), 2000)
  // Kanalda uzun süre kalınırsa yeniden bağlanırken kullanılacak aktarma bilgisi taze tutulur.
  relayTimer = setInterval(() => void loadRelay(), RELAY_REFRESH_MS)
  unwatch = watchVoiceRoom(channelId, userId, dmRoom)

  roomNews = supabase.channel(`oda:${channelId}`, { config: { private: true } })
  roomNews.on('broadcast', { event: 'oturum' }, ({ payload }) => onSessionNews(payload)).subscribe()

  // Kendi konum: yalnızca ben yazabilirim. Başkalarının konuları kanalda göründükçe dinlenir (bkz. syncListeners).
  const channel = supabase.channel(signalTopic(channelId, userId), { config: { private: true, broadcast: { self: false } } })
  signal = channel
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' && token === joinToken && !signalReady) {
      signalReady = true
      startVideo({
        me,
        channelId,
        send: (payload) => void signal?.send({ type: 'broadcast', event: 'goruntu', payload }),
        rtc,
        onLocalChange: publishState,
      })
      publishState()
      setState({ status: 'connected' })
      voiceSounds.join()
      syncListeners()
      void syncAudio()
      // Sunucudaki arkadaşlara "ses kanalına girdi" bildirimi gider (bireysel aramada gerekmez).
      // (İstek ancak beklenince gönderilir; sonucu önemli değil.)
      if (!dmRoom) void supabase.rpc('announce_voice_join', { p_channel: channelId }).then(() => undefined)
    }
    if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && token === joinToken && !signalReady) {
      joinFailed(token, 'Ses kanalına bağlanılamadı. İnternet bağlantını kontrol et.')
    }
  })
}

export async function leaveVoice(playSound = true): Promise<void> {
  const { channelId } = useVoice.getState()
  joinToken++
  stateBroadcaster.cancel()
  stopVideo()
  clearTimeout(restartTimer)
  restartTimer = undefined
  restartTries = 0
  lostSince = 0
  for (const userId of [...remotes.keys()]) releaseRemote(userId)
  pulling.clear()
  pullRetries.clear()
  complained.clear()
  void session?.end()
  session = null
  if (channelId) await untrackVoice(channelId).catch(() => {})
  unwatch?.()
  unwatch = null
  signalReady = false
  for (const userId of [...listening.keys()]) unlisten(userId)
  listenRetries.clear()
  if (signal) void supabase.removeChannel(signal)
  signal = null
  if (roomNews) void supabase.removeChannel(roomNews)
  roomNews = null
  stopLocalMeter?.()
  stopLocalMeter = undefined
  clearInterval(statsTimer)
  clearInterval(relayTimer)
  mic?.stop()
  mic = null
  lastRoom = new Set()
  lastHeardEffect.clear()
  setState({ status: 'idle', channelId: null, serverId: null, speaking: {}, peers: {}, link: null, reconnecting: false, lastEffect: null })
  if (channelId && playSound) voiceSounds.leave()
}

export function setMuted(muted: boolean): void {
  const { deafened } = useVoice.getState()
  // Sağırlaştırılmışken mikrofonu açmak sağırlaştırmayı da kaldırır.
  setState({ muted, deafened: muted ? deafened : false })
  applyMicrophone()
  for (const [userId, remote] of remotes) applyOutput(remote.audio, userId)
  publishState()
  toggleSound(muted ? voiceSounds.mute : voiceSounds.unmute)
}

export function setDeafened(deafened: boolean): void {
  setState({ deafened })
  applyMicrophone()
  for (const [userId, remote] of remotes) applyOutput(remote.audio, userId)
  publishState()
  toggleSound(deafened ? voiceSounds.mute : voiceSounds.unmute)
}

export function setUserVolume(userId: string, volume: number): void {
  const volumes = { ...useVoice.getState().volumes, [userId]: Math.min(1, Math.max(0, volume)) }
  useVoice.getState().setPrefs({ volumes })
  const remote = remotes.get(userId)
  if (remote) applyOutput(remote.audio, userId)
}

// Mikrofon, hoparlör ya da ses işleme ayarı değişince bağlantıyı koparmadan yeni hatta geç.
export async function applyDeviceChange(reopenMic = true): Promise<void> {
  for (const [userId, remote] of remotes) applyOutput(remote.audio, userId)
  if (!mic || !reopenMic) return
  const token = joinToken
  try {
    const next = await openMicrophone()
    if (token !== joinToken || !mic) {
      next.stop()
      return
    }
    const track = next.stream.getAudioTracks()[0]
    // Benim yayınladığım tek ses izi; çekilen izlerin göndericisi boştur.
    const sender = session?.pc.getSenders().find((s) => s.track?.kind === 'audio')
    await sender?.replaceTrack(track)
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
