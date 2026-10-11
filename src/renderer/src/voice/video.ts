import { toast } from '@/stores/toast'
import { useVoice } from './store'

// Görüntü (ekran paylaşımı ve kamera). Ses bağlantısına dokunmaz: her görüntü, onu izleyen her kişi için ayrı ve
// tek yönlü bir WebRTC bağlantısından gider. Böylece yayın ya da kamera açılıp kapanırken ses kopmaz ve
// izlemeyene hiç veri gönderilmez. Bu bağlantılar da ses gibi yalnızca Cloudflare aktarma sunucusundan geçer.
//
// Akış: izleyen "izle" der → yayıncı o kişi için bağlantı kurup "teklif" gönderir → izleyen "cevap" verir.
// İzleyen vazgeçince "birak", yayıncı yayını bitirince "bitti" gönderir. Kimin ne paylaştığı ses durumu ile
// birlikte (presence + "durum" yayını) duyurulur; bu sinyaller yalnızca bağlantıyı kurmak içindir.
// Sinyaller ses sinyalleriyle aynı yoldan (herkesin kendi konusu, olay "goruntu") gider; motoru engine.ts bağlar.
// Sinyalin kimden geldiğini konu belirler (sunucu doğrular), mesajın içinde gönderen yazmaz.
//
// Görüntü yalnızca kanalda görünen (katılımcı listesindeki) kişiye gönderilir: listede olmayan birinin sinyali
// işlenmez.

export type VideoKind = 'screen' | 'camera'
export type ScreenQuality = '720p30' | '1080p30' | '720p60' | '1080p60'

export const SCREEN_QUALITIES: { value: ScreenQuality; label: string; hint: string }[] = [
  { value: '720p30', label: '720p · 30 kare', hint: 'Önerilen; bilgisayarı en az yoran' },
  { value: '1080p30', label: '1080p · 30 kare', hint: 'Daha net; yükleme hızı ister' },
  { value: '720p60', label: '720p · 60 kare', hint: 'Daha akıcı; işlemciyi yorar' },
  { value: '1080p60', label: '1080p · 60 kare', hint: 'En iyisi; güçlü bilgisayar ve hızlı internet ister' },
]

// Kanalda aynı anda en fazla bu kadar ekran paylaşılabilir (her izleyiciye ayrı akış gittiği için).
export const MAX_SCREEN_SHARES = 2

const QUALITY: Record<ScreenQuality, { width: number; height: number; fps: number; bitrate: number }> = {
  '720p30': { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  '1080p30': { width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  '720p60': { width: 1280, height: 720, fps: 60, bitrate: 4_000_000 },
  '1080p60': { width: 1920, height: 1080, fps: 60, bitrate: 7_000_000 },
}
const CAMERA = { width: 960, height: 540, fps: 30, bitrate: 900_000 }
// "izle" dedikten sonra bu sürede teklif gelmezse bir kez daha istenir.
const RETRY_MS = 6000

type Signal =
  | { type: 'izle' | 'birak'; to: string; kind: VideoKind }
  | { type: 'teklif' | 'cevap'; to: string; kind: VideoKind; sdp: string }
  // rol: adayı gönderenin o bağlantıdaki rolü.
  | { type: 'aday'; to: string; kind: VideoKind; rol: 'yayinci' | 'izleyici'; candidate: RTCIceCandidateInit }
  | { type: 'bitti'; kind: VideoKind }

type Link = { pc: RTCPeerConnection; pending: RTCIceCandidateInit[] }
// rtc: bağlantı ayarı; sesle aynı, yani görüntü de yalnızca aktarma sunucusundan geçer (bkz. ice.ts).
type Wiring = { me: string; send: (payload: unknown) => void; rtc: () => RTCConfiguration; onLocalChange: () => void }

let wiring: Wiring | null = null
// Benim gönderdiklerim: `${izleyen}:${tür}` → bağlantı. Benim izlediklerim: `${yayıncı}:${tür}` → bağlantı.
const outgoing = new Map<string, Link>()
const incoming = new Map<string, Link>()
let screenBitrate = QUALITY['720p30'].bitrate
let screenFps = 30

export const videoKey = (userId: string, kind: VideoKind): string => `${userId}:${kind}`

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

function closeLink(map: Map<string, Link>, key: string): void {
  const link = map.get(key)
  if (!link) return
  map.delete(key)
  link.pc.onicecandidate = null
  link.pc.ontrack = null
  link.pc.onconnectionstatechange = null
  link.pc.close()
}

// ---------------------------------------------------------------------------
// Yayıncı tarafı
// ---------------------------------------------------------------------------

// Bir izleyici için bağlantı kurar ve teklif gönderir.
async function serve(viewer: string, kind: VideoKind): Promise<void> {
  const stream = localStream(kind)
  if (!wiring || !stream) return
  const key = videoKey(viewer, kind)
  closeLink(outgoing, key)
  const pc = new RTCPeerConnection(wiring.rtc())
  const link: Link = { pc, pending: [] }
  outgoing.set(key, link)

  for (const track of stream.getTracks()) {
    const video = track.kind === 'video'
    pc.addTransceiver(track, {
      direction: 'sendonly',
      streams: [stream],
      sendEncodings: video
        ? [{ maxBitrate: kind === 'screen' ? screenBitrate : CAMERA.bitrate, maxFramerate: kind === 'screen' ? screenFps : CAMERA.fps }]
        : [{ maxBitrate: 128_000 }],
    })
  }
  pc.onicecandidate = (event) => {
    if (event.candidate) send({ type: 'aday', to: viewer, kind, rol: 'yayinci', candidate: event.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => {
    // İzleyici koptuysa bağlantı bırakılır; hâlâ izlemek istiyorsa yeniden "izle" der.
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closeLink(outgoing, key)
  }
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  if (outgoing.get(key) === link) send({ type: 'teklif', to: viewer, kind, sdp: offer.sdp ?? '' })
}

function stopLocal(kind: VideoKind, announce = true): void {
  const stream = localStream(kind)
  if (!stream) return
  for (const track of stream.getTracks()) {
    track.onended = null
    track.stop()
  }
  for (const key of [...outgoing.keys()]) if (key.endsWith(`:${kind}`)) closeLink(outgoing, key)
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
  publishLocal('screen', stream)
  return true
}

export function stopScreen(): void {
  stopLocal('screen')
}

// ---------------------------------------------------------------------------
// İzleyici tarafı
// ---------------------------------------------------------------------------

const pendingRetries = new Map<string, ReturnType<typeof setTimeout>>()

function request(userId: string, kind: VideoKind): void {
  if (!wiring) return
  const key = videoKey(userId, kind)
  send({ type: 'izle', to: userId, kind })
  // Teklif gelmezse (ör. yayıncı sinyali kaçırdıysa) bir kez daha istenir.
  clearTimeout(pendingRetries.get(key))
  pendingRetries.set(
    key,
    setTimeout(() => {
      if (wiring && key in useVoice.getState().videos && !incoming.has(key)) send({ type: 'izle', to: userId, kind })
    }, RETRY_MS),
  )
}

// Bir kişinin ekranını ya da kamerasını izlemeye başlar. Görüntü gelene kadar `videos[anahtar]` null kalır.
export function watch(userId: string, kind: VideoKind): void {
  const key = videoKey(userId, kind)
  if (!wiring || userId === wiring.me || key in useVoice.getState().videos) return
  setRemote(key, null)
  request(userId, kind)
}

// Karşı taraf beni dinlemeye yeni başladıysa, ondan istediğim ama henüz gelmeyen görüntüler yeniden istenir
// (ilk istek o dinlemeye başlamadan gitmiş olabilir).
export function retryVideo(userId: string): void {
  const { videos } = useVoice.getState()
  for (const kind of ['screen', 'camera'] as const) {
    const key = videoKey(userId, kind)
    if (key in videos && !incoming.has(key)) request(userId, kind)
  }
}

export function unwatch(userId: string, kind: VideoKind): void {
  const key = videoKey(userId, kind)
  if (!(key in useVoice.getState().videos)) return
  dropIncoming(key)
  if (wiring) send({ type: 'birak', to: userId, kind })
}

function dropIncoming(key: string): void {
  clearTimeout(pendingRetries.get(key))
  pendingRetries.delete(key)
  closeLink(incoming, key)
  setRemote(key, undefined)
}

async function accept(from: string, kind: VideoKind, sdp: string): Promise<void> {
  const key = videoKey(from, kind)
  // İstemediğim bir görüntü kabul edilmez.
  if (!wiring || !(key in useVoice.getState().videos)) return
  clearTimeout(pendingRetries.get(key))
  pendingRetries.delete(key)
  closeLink(incoming, key)
  const pc = new RTCPeerConnection(wiring.rtc())
  const link: Link = { pc, pending: [] }
  incoming.set(key, link)

  pc.ontrack = (event) => {
    const [stream] = event.streams
    if (stream && incoming.get(key) === link) setRemote(key, stream)
  }
  pc.onicecandidate = (event) => {
    if (event.candidate) send({ type: 'aday', to: from, kind, rol: 'izleyici', candidate: event.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== 'failed' || incoming.get(key) !== link) return
    // Bağlantı koptu: görüntü hâlâ isteniyorsa baştan kurulur.
    closeLink(incoming, key)
    if (key in useVoice.getState().videos) {
      setRemote(key, null)
      request(from, kind)
    }
  }
  await pc.setRemoteDescription({ type: 'offer', sdp })
  for (const candidate of link.pending.splice(0)) await pc.addIceCandidate(candidate).catch(() => {})
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  if (incoming.get(key) === link) send({ type: 'cevap', to: from, kind, sdp: answer.sdp ?? '' })
}

// ---------------------------------------------------------------------------
// Motorla bağlantı (engine.ts çağırır)
// ---------------------------------------------------------------------------

const KINDS: readonly unknown[] = ['screen', 'camera']

function inRoom(userId: string): boolean {
  const { channelId, rooms } = useVoice.getState()
  return !!channelId && !!rooms[channelId]?.some((p) => p.userId === userId)
}

// from: sinyalin geldiği konunun sahibi (sunucu doğrular).
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
        await serve(from, kind)
        break
      case 'birak':
        closeLink(outgoing, videoKey(from, kind))
        break
      case 'teklif':
        if (typeof message.sdp === 'string') await accept(from, kind, message.sdp)
        break
      case 'cevap': {
        const link = outgoing.get(videoKey(from, kind))
        if (!link || link.pc.signalingState !== 'have-local-offer' || typeof message.sdp !== 'string') return
        await link.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
        for (const candidate of link.pending.splice(0)) await link.pc.addIceCandidate(candidate).catch(() => {})
        break
      }
      case 'aday': {
        // Aday yayıncıdan geldiyse ben izleyiciyim (ve tersi).
        const link = (message.rol === 'yayinci' ? incoming : outgoing).get(videoKey(from, kind))
        if (!link || !message.candidate) return
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(message.candidate).catch(() => {})
        else link.pending.push(message.candidate)
        break
      }
      case 'bitti':
        if (videoKey(from, kind) in useVoice.getState().videos) dropIncoming(videoKey(from, kind))
        break
    }
  } catch (error) {
    console.warn('Görüntü sinyali işlenemedi', error)
  }
}

export function startVideo(next: Wiring): void {
  wiring = next
}

// Kanaldan çıkanlarla ilgili bütün görüntü bağlantıları kapanır; paylaşımı bitenlerin görüntüsü bırakılır.
export function syncVideoRoom(): void {
  if (!wiring) return
  const { channelId, rooms, videos } = useVoice.getState()
  const room = new Map((rooms[channelId ?? ''] ?? []).map((p) => [p.userId, p]))
  for (const key of [...outgoing.keys()]) if (!room.has(key.slice(0, key.lastIndexOf(':')))) closeLink(outgoing, key)
  for (const key of Object.keys(videos)) {
    const split = key.lastIndexOf(':')
    const person = room.get(key.slice(0, split))
    const kind = key.slice(split + 1) as VideoKind
    if (!person || (kind === 'screen' ? person.screen === false : person.camera === false)) dropIncoming(key)
  }
}

export function stopVideo(): void {
  stopLocal('screen', false)
  stopLocal('camera', false)
  for (const key of [...outgoing.keys()]) closeLink(outgoing, key)
  for (const key of [...incoming.keys()]) closeLink(incoming, key)
  for (const timer of pendingRetries.values()) clearTimeout(timer)
  pendingRetries.clear()
  wiring = null
  useVoice.setState({ videos: {}, localScreen: null, localCamera: null })
}
