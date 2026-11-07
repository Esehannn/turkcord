import { toast } from '@/stores/toast'
import { SfuSession, type LocalTrack, type TrackName } from './sfu'
import { useVoice } from './store'

// Görüntü (ekran paylaşımı ve kamera). Ses oturumuna dokunmaz: görüntü, Cloudflare'de ayrı bir oturumdan (SFU) gider.
// Böylece yayın ya da kamera açılıp kapanırken sesin bağlantısı yeniden pazarlık etmez, ses kopmaz.
//
// "Tıklayınca yükle": görüntü oturumu ancak biri bir şey izlemek ya da yayınlamak istediğinde açılır; iş bitince
// kapanır. Yayıncı da görüntüsünü ancak biri "izle" deyince Cloudflare'e gönderir; izleyen kalmayınca bırakır.
// İzleyen yokken hiç veri yüklenmez, ekran kartı boşuna kodlamaz.
//
// Akış: izleyen "izle" der → yayıncı görüntüsünü yayınlar ve ona "yayinda" der → izleyen görüntüyü Cloudflare'den
// çeker. İzleyen vazgeçince "birak", yayıncı yayını bitirince herkese "bitti" gönderir. Kimin ne paylaştığı ses
// durumu ile birlikte (presence + "durum" yayını) duyurulur. Bu olaylar ses olaylarıyla aynı yoldan (herkesin kendi
// konusu, olay "goruntu") gider; motoru engine.ts bağlar. Olayın kimden geldiğini konu belirler (sunucu doğrular).
// Görüntüyü kimin çekebileceğini "oda" Edge Function'ı denetler (aynı kanalda oturumu olan).
//
// Yalnızca kanalda görünen (katılımcı listesindeki) kişilerin olayları işlenir.
//
// Sağlamlık (bekçi, her 2 sn; yalnızca bir şey izlenirken ya da yayınlanırken çalışır):
//  - İzlenmek istenen ama gelmeyen görüntü, gelene kadar giderek seyrelen aralıklarla yeniden istenir
//    (yayın "açılmıyor" diye takılı kalmaz).
//  - Gelen görüntünün paketleri bir süre durursa (yayın donduysa) görüntü yeniden istenir.
//  - Biri listeden kısa süre düşerse (Supabase bağlantısı kopup geldi) yayın hemen kapatılmaz: izleyici yayını,
//    yayıncı da izleyicisini bir süre bekler. Kişi geri gelince kaldığı yerden sürer.
//  - Görüntü bağlantısı bir süre kopuk kalırsa oturum baştan kurulur.
//  - Yayıncının yükleme hızı seçilen kaliteye yetmiyorsa uyarılır.

export type VideoKind = 'screen' | 'camera'
export type ScreenQuality = '720p30' | '1080p30' | '720p60' | '1080p60'

export const SCREEN_QUALITIES: { value: ScreenQuality; label: string; hint: string }[] = [
  { value: '720p30', label: '720p · 30 kare', hint: 'Önerilen; bilgisayarı en az yoran' },
  { value: '1080p30', label: '1080p · 30 kare', hint: 'Daha net; yükleme hızı ister' },
  { value: '720p60', label: '720p · 60 kare', hint: 'Daha akıcı; işlemciyi yorar' },
  { value: '1080p60', label: '1080p · 60 kare', hint: 'En iyisi; güçlü bilgisayar ve hızlı internet ister' },
]

// Kanalda aynı anda en fazla bu kadar ekran paylaşılabilir (izleyenin indirmesi ve işlemcisi için).
export const MAX_SCREEN_SHARES = 2

const QUALITY: Record<ScreenQuality, { width: number; height: number; fps: number; bitrate: number }> = {
  '720p30': { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  '1080p30': { width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  '720p60': { width: 1280, height: 720, fps: 60, bitrate: 4_000_000 },
  '1080p60': { width: 1920, height: 1080, fps: 60, bitrate: 7_000_000 },
}
const CAMERA = { width: 960, height: 540, fps: 30, bitrate: 900_000 }
const TICK_MS = 2000
// "izle" dedikten sonra görüntü gelmezse yeniden istenir: 4, 8, 16 sn… en fazla bu kadar arayla, vazgeçmeden.
const ASK_FIRST_MS = 4000
const ASK_MAX_MS = 20_000
// Gelen görüntünün paketleri bu kadar süre durursa (yayın dondu) görüntü yeniden istenir. Durağan bir ekranda bile
// tarayıcı saniyede bir yenileme karesi gönderir; bu süre boyunca hiç paket gelmemesi yayının koptuğunu gösterir.
const STALL_MS = 12_000
// Listeden düşen birini (yayıncı ya da izleyici) bu kadar süre bekle; geri gelmezse yayın bırakılır.
const ABSENT_GRACE_MS = 25_000
// Görüntü bağlantısı bu kadar süre kopuk kalırsa oturum baştan kurulur.
const LOST_MS = 5000
// Son izleyen de bırakınca yayın bu kadar süre sonra durur (hemen geri dönen için yeniden yayınlamamak adına).
const IDLE_PUBLISH_MS = 10_000
// Ne izlenen ne yayınlanan bir şey kalınca görüntü oturumu bu kadar süre sonra kapanır.
const IDLE_SESSION_MS = 20_000
// Yükleme hızı bu kadar süre art arda yetmezse yayıncı uyarılır (yayının ilk saniyelerindeki ısınma sayılmasın diye uzun).
const UPLINK_WARN_MS = 20_000

type Signal = { type: 'izle' | 'birak' | 'yayinda'; to: string; kind: VideoKind } | { type: 'bitti'; kind: VideoKind }

type Wiring = { me: string; channelId: string; send: (payload: unknown) => void; rtc: () => RTCConfiguration; onLocalChange: () => void }

let wiring: Wiring | null = null
let session: SfuSession | null = null
let opening: Promise<SfuSession | null> | null = null
let sessionIdle: ReturnType<typeof setTimeout> | undefined
let sessionDownSince = 0
let ticker: ReturnType<typeof setInterval> | undefined
// Benim yayınlarımı izleyenler ve yayının Cloudflare'e gönderilişi.
const watchers: Record<VideoKind, Set<string>> = { screen: new Set(), camera: new Set() }
const publishing: Partial<Record<VideoKind, Promise<boolean>>> = {}
const publishIdle: Partial<Record<VideoKind, ReturnType<typeof setTimeout>>> = {}
// Benim izlediklerim: `${yayıncı}:${tür}` → çekilen izler, görüntü izinin mid'i, ondan kurulan akış ve paket sayacı.
type Incoming = { mids: string[]; videoMid: string | null; stream: MediaStream; packets: number; changedAt: number }
const incoming = new Map<string, Incoming>()
// İzlemek isteyip henüz görüntüsü gelmeyenler: bir sonraki istek zamanı ve kaçıncı deneme.
const asks = new Map<string, { at: number; tries: number }>()
// Listeden düşenler (kişi → ilk görünmediği an). Bekleme süresi dolana kadar yayınları/izlemeleri sürer.
const absent = new Map<string, number>()
let screenBitrate = QUALITY['720p30'].bitrate
let screenFps = 30
let uplinkLimitedSince = 0
let uplinkOkSince = 0
let uplinkWarned = false

export const videoKey = (userId: string, kind: VideoKind): string => `${userId}:${kind}`

function splitKey(key: string): [string, VideoKind] {
  const split = key.lastIndexOf(':')
  return [key.slice(0, split), key.slice(split + 1) as VideoKind]
}

const trackNames = (kind: VideoKind): TrackName[] => (kind === 'screen' ? ['ekran', 'ekran-ses'] : ['kamera'])

function send(message: Signal): void {
  wiring?.send(message)
}

function localStream(kind: VideoKind): MediaStream | null {
  const state = useVoice.getState()
  return kind === 'screen' ? state.localScreen : state.localCamera
}

function setRemote(key: string, stream: MediaStream | null | undefined): void {
  useVoice.setState((s) => {
    const videos = { ...s.videos }
    if (stream === undefined) delete videos[key]
    else videos[key] = stream
    return { videos }
  })
}

// Ekranımı kaç kişi izliyor (kanaldakilere duyurulur).
export function viewerCount(): number {
  return localStream('screen') ? watchers.screen.size : 0
}

function watchersChanged(kind: VideoKind): void {
  if (kind === 'screen') wiring?.onLocalChange()
}

// ---------------------------------------------------------------------------
// Görüntü oturumu
// ---------------------------------------------------------------------------

function onTrack(userId: string, name: TrackName, track: MediaStreamTrack): void {
  const key = videoKey(userId, name === 'kamera' ? 'camera' : 'screen')
  const entry = incoming.get(key)
  if (!entry) return
  entry.stream.addTrack(track)
  if (track.kind === 'video') setRemote(key, entry.stream)
}

function onState(state: RTCPeerConnectionState): void {
  if (state === 'connected') sessionDownSince = 0
  else if (state === 'disconnected') sessionDownSince ||= Date.now()
  else if (state === 'failed') rebuildSession()
}

// Bağlantı koptu: oturum baştan kurulur; izlenenler yeniden istenir, izlenen yayınlar yeniden gönderilir.
function rebuildSession(): void {
  if (!session) return
  const dead = session
  session = null
  sessionDownSince = 0
  void dead.end()
  for (const key of [...incoming.keys()]) {
    incoming.delete(key)
    // Son kare ekranda kalır; yeni görüntü gelince değişir.
    const [userId, kind] = splitKey(key)
    request(userId, kind)
  }
  for (const kind of ['screen', 'camera'] as const) {
    delete publishing[kind]
    if (watchers[kind].size) void serve(kind)
  }
}

function ensureSession(): Promise<SfuSession | null> {
  clearTimeout(sessionIdle)
  if (session && !session.isClosed) return Promise.resolve(session)
  if (opening) return opening
  const w = wiring
  if (!w) return Promise.resolve(null)
  const next = new SfuSession('goruntu', w.channelId, w.rtc(), { onTrack, onState })
  opening = next
    .start(__APP_VERSION__)
    .then((result) => {
      if (result !== 'tamam' || wiring !== w) {
        void next.end()
        return null
      }
      session = next
      sessionDownSince = 0
      return next
    })
    .catch(() => {
      void next.end()
      return null
    })
    .finally(() => {
      opening = null
    })
  return opening
}

// Ne izlenen ne yayınlanan bir şey kaldıysa oturum bir süre sonra kapanır.
function maybeIdle(): void {
  clearTimeout(sessionIdle)
  sessionIdle = setTimeout(() => {
    if (busy() || !session) return
    void session.end()
    session = null
  }, IDLE_SESSION_MS)
}

function busy(): boolean {
  return incoming.size > 0 || asks.size > 0 || watchers.screen.size > 0 || watchers.camera.size > 0 || !!publishing.screen || !!publishing.camera
}

// ---------------------------------------------------------------------------
// Yayıncı tarafı
// ---------------------------------------------------------------------------

// Yayını (henüz gönderilmiyorsa) Cloudflare'e gönderir ve bekleyen izleyicilere "yayinda" der.
async function serve(kind: VideoKind): Promise<void> {
  clearTimeout(publishIdle[kind])
  const stream = localStream(kind)
  if (!wiring || !stream) return
  publishing[kind] ??= (async () => {
    const s = await ensureSession()
    if (!s || localStream(kind) !== stream) return false
    const [videoName, audioName] = trackNames(kind)
    const tracks: LocalTrack[] = []
    for (const track of stream.getVideoTracks()) {
      tracks.push({
        track,
        name: videoName,
        encodings: [{ maxBitrate: kind === 'screen' ? screenBitrate : CAMERA.bitrate, maxFramerate: kind === 'screen' ? screenFps : CAMERA.fps }],
      })
    }
    if (audioName) for (const track of stream.getAudioTracks()) tracks.push({ track, name: audioName, encodings: [{ maxBitrate: 128_000 }] })
    await s.publish(tracks)
    return true
  })().catch(() => false)
  const ok = await publishing[kind]
  if (!ok) {
    // Gönderilemedi; izleyici yeniden isteyince tekrar denenir.
    delete publishing[kind]
    return
  }
  for (const viewer of watchers[kind]) send({ type: 'yayinda', to: viewer, kind })
}

// Son izleyen de bırakınca yayın bir süre sonra durur.
function releaseIfUnwatched(kind: VideoKind): void {
  if (watchers[kind].size || !publishing[kind]) return
  clearTimeout(publishIdle[kind])
  publishIdle[kind] = setTimeout(() => void unpublish(kind), IDLE_PUBLISH_MS)
}

async function unpublish(kind: VideoKind): Promise<void> {
  clearTimeout(publishIdle[kind])
  const pending = publishing[kind]
  if (!pending) return
  delete publishing[kind]
  await pending
  if (session && !session.isClosed) await session.unpublish(trackNames(kind)).catch(() => {})
  maybeIdle()
}

function stopLocal(kind: VideoKind, announce = true): void {
  const stream = localStream(kind)
  if (!stream) return
  for (const track of stream.getTracks()) {
    track.onended = null
    track.stop()
  }
  watchers[kind].clear()
  void unpublish(kind)
  if (kind === 'screen') resetUplink()
  useVoice.setState(kind === 'screen' ? { localScreen: null } : { localCamera: null })
  if (announce && wiring) {
    send({ type: 'bitti', kind })
    wiring.onLocalChange()
  }
}

function publishLocal(kind: VideoKind, stream: MediaStream): void {
  // Paylaşılan pencere kapanırsa ya da kamera çıkarılırsa yayın kendiliğinden biter.
  for (const track of stream.getVideoTracks()) track.onended = () => stopLocal(kind)
  useVoice.setState(kind === 'screen' ? { localScreen: stream } : { localCamera: stream })
  wiring?.onLocalChange()
}

export async function startCamera(): Promise<void> {
  const state = useVoice.getState()
  if (!wiring || state.status !== 'connected' || state.localCamera) return
  const device = state.cameraDeviceId
  const video = { width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height }, frameRate: { ideal: CAMERA.fps, max: CAMERA.fps } }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: device && device !== 'default' ? { ...video, deviceId: { exact: device } } : video })
  } catch (first) {
    try {
      // Seçili kamera yoksa varsayılanla dene.
      if (!device || device === 'default') throw first
      stream = await navigator.mediaDevices.getUserMedia({ video })
    } catch (error) {
      toast.info(cameraErrorMessage(error))
      return
    }
  }
  if (!wiring || useVoice.getState().status !== 'connected') {
    for (const track of stream.getTracks()) track.stop()
    return
  }
  publishLocal('camera', stream)
}

export function stopCamera(): void {
  stopLocal('camera')
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kamera bulunamadı.'
  if (name === 'NotReadableError') return 'Kamera başka bir uygulama tarafından kullanılıyor.'
  if (name === 'NotAllowedError') return 'Kameraya erişim izni yok. Windows ayarlarından kamera iznini kontrol et.'
  return 'Kamera açılamadı.'
}

// Kanalda başkalarının sürdürdüğü ekran paylaşımı sayısı.
function otherScreenShares(): number {
  const { channelId, rooms } = useVoice.getState()
  return (rooms[channelId ?? ''] ?? []).filter((p) => p.screen && p.userId !== wiring?.me).length
}

export function canShareScreen(): boolean {
  return otherScreenShares() < MAX_SCREEN_SHARES
}

// Seçilen ekranı ya da pencereyi paylaşır. Kaynak seçimi ana sürece bildirilir; Electron yakalamayı ona göre verir.
export async function startScreen(sourceId: string, quality: ScreenQuality, withAudio: boolean): Promise<boolean> {
  const state = useVoice.getState()
  if (!wiring || state.status !== 'connected') return false
  if (!canShareScreen()) {
    toast.info(`Bu kanalda aynı anda en fazla ${MAX_SCREEN_SHARES} ekran paylaşılabilir.`)
    return false
  }
  if (state.localScreen) stopLocal('screen', false)
  const q = QUALITY[quality]
  let stream: MediaStream
  try {
    if (!(await window.turkcord?.pickScreen(sourceId, withAudio))) throw new Error('kaynak seçilemedi')
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: q.width }, height: { max: q.height }, frameRate: { ideal: q.fps, max: q.fps } },
      // restrictOwnAudio: Turkcord'un kendi çaldığı sesler (karşı tarafın konuşması) yayına geri girmesin.
      audio: withAudio ? ({ restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints) : false,
    })
  } catch {
    toast.info('Ekran paylaşımı başlatılamadı.')
    return false
  }
  if (!wiring || useVoice.getState().status !== 'connected') {
    for (const track of stream.getTracks()) track.stop()
    return false
  }
  // Oyun ve video için akıcılık öncelikli: bant daralınca kare hızı değil netlik düşer.
  for (const track of stream.getVideoTracks()) track.contentHint = 'motion'
  screenBitrate = q.bitrate
  screenFps = q.fps
  resetUplink()
  publishLocal('screen', stream)
  return true
}

export function stopScreen(): void {
  stopLocal('screen')
}

function resetUplink(): void {
  uplinkLimitedSince = 0
  uplinkOkSince = 0
  uplinkWarned = false
  if (useVoice.getState().uplinkLimited) useVoice.setState({ uplinkLimited: false })
}

// Yayınımın görüntüsü internetim yüzünden kısılıyor mu? (Tarayıcı bunu "qualityLimitationReason" ile bildirir.)
async function checkUplink(s: SfuSession): Promise<void> {
  const report = await s.pc.getStats().catch(() => null)
  if (!report) return
  let limited = false
  report.forEach((r: { type: string; kind?: string; qualityLimitationReason?: string; bytesSent?: number }) => {
    if (r.type === 'outbound-rtp' && r.kind === 'video' && r.qualityLimitationReason === 'bandwidth' && (r.bytesSent ?? 0) > 0) limited = true
  })
  // Kameram da bu oturumdan gider; ekran paylaşmıyorsam uyarı gerekmez.
  if (!localStream('screen') || !publishing.screen) return resetUplink()
  const now = Date.now()
  if (limited) {
    uplinkOkSince = 0
    uplinkLimitedSince ||= now
    if (now - uplinkLimitedSince >= UPLINK_WARN_MS && !useVoice.getState().uplinkLimited) {
      useVoice.setState({ uplinkLimited: true })
      if (!uplinkWarned) {
        uplinkWarned = true
        toast.info('İnternetinin yükleme hızı bu yayın kalitesine yetmiyor; yayın bulanıklaşabilir ya da takılabilir. Paylaşımı daha düşük kaliteyle yeniden başlatmayı dene.')
      }
    }
  } else {
    uplinkLimitedSince = 0
    uplinkOkSince ||= now
    if (now - uplinkOkSince >= UPLINK_WARN_MS && useVoice.getState().uplinkLimited) useVoice.setState({ uplinkLimited: false })
  }
}

// ---------------------------------------------------------------------------
// İzleyici tarafı
// ---------------------------------------------------------------------------

// "izle" gönderir ve görüntü gelmezse bir sonraki isteği zamanlar (bekçi gönderir).
function request(userId: string, kind: VideoKind): void {
  if (!wiring) return
  const key = videoKey(userId, kind)
  send({ type: 'izle', to: userId, kind })
  const tries = (asks.get(key)?.tries ?? 0) + 1
  asks.set(key, { tries, at: Date.now() + Math.min(ASK_MAX_MS, ASK_FIRST_MS * 2 ** (tries - 1)) })
  ensureTicker()
}

// Bir kişinin ekranını ya da kamerasını izlemeye başlar. Görüntü gelene kadar `videos[anahtar]` null kalır.
export function watch(userId: string, kind: VideoKind): void {
  const key = videoKey(userId, kind)
  if (!wiring || userId === wiring.me || key in useVoice.getState().videos) return
  setRemote(key, null)
  asks.delete(key)
  request(userId, kind)
  // Yayıncı hazırlanırken görüntü oturumum da açılsın; "yayinda" gelince hemen çekilir.
  void ensureSession()
}

// Kanala girilirken "izle" denirse (kenar çubuğundaki "İzle", "yayın açtı" bildirimi) bağlantı kurulunca izlenir.
export function watchWhenReady(channelId: string, userId: string): void {
  const ready = (): boolean => {
    const s = useVoice.getState()
    return !!wiring && s.channelId === channelId && s.status === 'connected'
  }
  if (ready()) return watch(userId, 'screen')
  const stop = useVoice.subscribe(() => {
    if (!ready()) return
    stop()
    clearTimeout(timer)
    watch(userId, 'screen')
  })
  const timer = setTimeout(stop, 30_000)
}

// Karşı taraf beni dinlemeye yeni başladıysa, ondan istediğim ama henüz gelmeyen görüntüler hemen yeniden istenir
// (ilk istek o dinlemeye başlamadan gitmiş olabilir).
export function retryVideo(userId: string): void {
  const { videos } = useVoice.getState()
  for (const kind of ['screen', 'camera'] as const) {
    const key = videoKey(userId, kind)
    if (key in videos && !incoming.has(key)) {
      asks.delete(key)
      request(userId, kind)
    }
  }
}

export function unwatch(userId: string, kind: VideoKind): void {
  const key = videoKey(userId, kind)
  if (!(key in useVoice.getState().videos)) return
  dropIncoming(key)
  if (wiring) send({ type: 'birak', to: userId, kind })
}

function dropIncoming(key: string): void {
  asks.delete(key)
  const entry = incoming.get(key)
  incoming.delete(key)
  if (entry?.mids.length && session && !session.isClosed) void session.drop(entry.mids).catch(() => {})
  setRemote(key, undefined)
  maybeIdle()
}

const SCREEN_AUDIO_RETRY_MS = 4000
const SCREEN_AUDIO_TRIES = 30

// Ekran paylaşımının sesini, görüntü izlendiği sürece (en fazla ~2 dakika) aralıklarla yeniden ister.
async function pullScreenAudio(from: string, entry: Incoming): Promise<void> {
  const key = videoKey(from, 'screen')
  for (let i = 0; i < SCREEN_AUDIO_TRIES; i++) {
    await new Promise((r) => setTimeout(r, SCREEN_AUDIO_RETRY_MS))
    if (incoming.get(key) !== entry || !session || session.isClosed) return
    const [result] = await session.pull([{ user: from, name: 'ekran-ses' }]).catch(() => [])
    if (incoming.get(key) !== entry) {
      if (result?.mid) void session?.drop([result.mid]).catch(() => {})
      return
    }
    if (result?.mid) {
      entry.mids.push(result.mid)
      return
    }
    if (result?.error !== 'not_found') return
  }
}

// Yayıncı "yayinda" dedi: görüntüyü Cloudflare'den çek.
async function pull(from: string, kind: VideoKind): Promise<void> {
  const key = videoKey(from, kind)
  if (!(key in useVoice.getState().videos)) return
  const s = await ensureSession()
  if (!s || !(key in useVoice.getState().videos)) return
  const old = incoming.get(key)
  if (old?.mids.length) await s.drop(old.mids).catch(() => {})
  const entry: Incoming = { mids: [], videoMid: null, stream: new MediaStream(), packets: 0, changedAt: Date.now() }
  incoming.set(key, entry)
  try {
    const results = await s.pull(trackNames(kind).map((name) => ({ user: from, name })))
    entry.mids = results.flatMap((r) => (r.mid ? [r.mid] : []))
    entry.videoMid = results.find((r) => r.mid && r.name !== 'ekran-ses')?.mid ?? null
    entry.changedAt = Date.now()
    // Görüntü izi yoksa (yayın tam o an bitti ya da henüz hazır değil) biraz sonra yeniden istenir.
    if (!entry.videoMid) throw new Error('görüntü yok')
    asks.delete(key)
    // Paylaşılan ekranda henüz ses çalmıyorsa Cloudflare o izi tanımaz; ses başlayınca çekilsin diye yeniden denenir.
    if (results.some((r) => r.name === 'ekran-ses' && r.error === 'not_found')) void pullScreenAudio(from, entry)
  } catch {
    if (incoming.get(key) !== entry || !(key in useVoice.getState().videos)) return
    if (entry.mids.length) void s.drop(entry.mids).catch(() => {})
    incoming.delete(key)
    const tries = asks.get(key)?.tries ?? 1
    asks.set(key, { tries, at: Date.now() + 3000 })
    ensureTicker()
  }
}

// ---------------------------------------------------------------------------
// Bekçi
// ---------------------------------------------------------------------------

function ensureTicker(): void {
  if (!ticker && wiring) ticker = setInterval(() => void tick(), TICK_MS)
}

async function tick(): Promise<void> {
  if (!wiring) return
  const now = Date.now()
  const { channelId, rooms, videos } = useVoice.getState()
  const room = new Map((rooms[channelId ?? ''] ?? []).map((p) => [p.userId, p]))

  // Listeden düşüp geri gelmeyenler: izleyiciyse bırakılır, yayıncıysa izlemesi biter.
  for (const [userId, since] of [...absent]) {
    if (room.has(userId)) {
      absent.delete(userId)
      continue
    }
    if (now - since < ABSENT_GRACE_MS) continue
    absent.delete(userId)
    for (const kind of ['screen', 'camera'] as const) {
      if (watchers[kind].delete(userId)) {
        releaseIfUnwatched(kind)
        watchersChanged(kind)
      }
      if (videoKey(userId, kind) in videos) dropIncoming(videoKey(userId, kind))
    }
  }

  // Görüntü bağlantısı uzun süre kopuk: baştan kur.
  if (session && sessionDownSince && now - sessionDownSince > LOST_MS) rebuildSession()

  // Görüntüsü gelmeyenler yeniden istenir (yayıncı listede görünmüyorsa beklenir).
  for (const [key, ask] of asks) {
    if (incoming.has(key) || now < ask.at) continue
    if (!(key in videos)) {
      asks.delete(key)
      continue
    }
    const [userId, kind] = splitKey(key)
    if (room.has(userId)) request(userId, kind)
  }

  const s = session
  if (s && !s.isClosed && (incoming.size || publishing.screen)) {
    const stats = await s.stats().catch(() => null)
    if (stats && session === s) {
      for (const [key, entry] of [...incoming]) {
        if (!entry.videoMid) continue
        const packets = stats.packets.get(entry.videoMid) ?? 0
        if (packets > entry.packets) {
          entry.packets = packets
          entry.changedAt = now
        } else if (now - entry.changedAt > STALL_MS) {
          // Yayın dondu: izi bırakıp yeniden iste (son kare ekranda kalır).
          const [userId, kind] = splitKey(key)
          incoming.delete(key)
          void s.drop(entry.mids).catch(() => {})
          asks.delete(key)
          if (room.has(userId)) request(userId, kind)
          else asks.set(key, { tries: 1, at: now })
        }
      }
    }
    if (publishing.screen) await checkUplink(s)
  }

  if (!busy() && !absent.size) {
    clearInterval(ticker)
    ticker = undefined
  }
}

// ---------------------------------------------------------------------------
// Motorla bağlantı (engine.ts çağırır)
// ---------------------------------------------------------------------------

const KINDS: readonly unknown[] = ['screen', 'camera']

function inRoom(userId: string): boolean {
  const { channelId, rooms } = useVoice.getState()
  return !!channelId && !!rooms[channelId]?.some((p) => p.userId === userId)
}

// from: olayın geldiği konunun sahibi (sunucu doğrular).
export async function onVideoSignal(from: string, payload: unknown): Promise<void> {
  const message = (payload ?? {}) as Partial<Signal> & { to?: unknown }
  if (!wiring || from === wiring.me || !KINDS.includes(message.kind)) return
  // "bitti" herkese duyurulur; diğerleri yalnızca bana yazılmışsa işlenir.
  if (message.type !== 'bitti' && message.to !== wiring.me) return
  // Kanalda görünmeyen birine görüntü gönderilmez, ondan görüntü alınmaz.
  if (!inRoom(from)) return
  const kind = message.kind as VideoKind
  try {
    switch (message.type) {
      case 'izle':
        if (!localStream(kind)) return
        if (!watchers[kind].has(from)) {
          watchers[kind].add(from)
          watchersChanged(kind)
        }
        ensureTicker()
        await serve(kind)
        break
      case 'birak':
        if (watchers[kind].delete(from)) watchersChanged(kind)
        releaseIfUnwatched(kind)
        break
      case 'yayinda':
        await pull(from, kind)
        break
      case 'bitti':
        if (videoKey(from, kind) in useVoice.getState().videos) dropIncoming(videoKey(from, kind))
        break
    }
  } catch (error) {
    console.warn('Görüntü olayı işlenemedi', error)
  }
}

export function startVideo(next: Wiring): void {
  wiring = next
}

// Paylaşımı bitenlerin görüntüsü bırakılır. Kanaldan çıkan biri hemen bırakılmaz: listeden kısa süre düşmüş
// olabilir (bağlantısı kopup geldi); bekçi bekleme süresi dolunca bırakır.
export function syncVideoRoom(): void {
  if (!wiring) return
  const { channelId, rooms, videos } = useVoice.getState()
  const room = new Map((rooms[channelId ?? ''] ?? []).map((p) => [p.userId, p]))
  const now = Date.now()
  const missing = (userId: string): void => {
    if (!absent.has(userId)) absent.set(userId, now)
    ensureTicker()
  }
  for (const kind of ['screen', 'camera'] as const) {
    for (const viewer of watchers[kind]) if (!room.has(viewer)) missing(viewer)
  }
  for (const key of Object.keys(videos)) {
    const [userId, kind] = splitKey(key)
    const person = room.get(userId)
    if (!person) {
      missing(userId)
      continue
    }
    if (absent.delete(userId) && !incoming.has(key)) {
      // Geri geldi: görüntüsü kopmuşsa hemen yeniden iste.
      asks.delete(key)
      request(userId, kind)
    }
    if (kind === 'screen' ? person.screen === false : person.camera === false) dropIncoming(key)
  }
  for (const userId of [...absent.keys()]) if (room.has(userId)) absent.delete(userId)
}

export function stopVideo(): void {
  stopLocal('screen', false)
  stopLocal('camera', false)
  asks.clear()
  absent.clear()
  clearInterval(ticker)
  ticker = undefined
  for (const kind of ['screen', 'camera'] as const) {
    clearTimeout(publishIdle[kind])
    delete publishing[kind]
    watchers[kind].clear()
  }
  clearTimeout(sessionIdle)
  incoming.clear()
  void session?.end()
  session = null
  sessionDownSince = 0
  opening = null
  wiring = null
  useVoice.setState({ videos: {}, localScreen: null, localCamera: null })
}
