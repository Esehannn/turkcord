import { functionErrorCode } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { fixOffer, startBitrate, tuneOpus } from './sdp'

// Cloudflare Realtime SFU (ses odası sunucusu) ile tek bir oturum: tek RTCPeerConnection, üzerinden hem yayınlanan
// hem çekilen izler geçer. Cloudflare'le doğrudan değil, "oda" Edge Function'ı üzerinden konuşulur; uygulama
// anahtarı orada durur ve kimin neyi çekebileceğini o (veritabanıyla) denetler.
//
// Bağlantı yalnızca Cloudflare'e kurulur; kanaldakiler birbirine bağlanmaz, kimse başkasının IP adresini görmez.
// Bütün pazarlıklar (yayınla, çek, kapat) sırayla yapılır; aynı anda iki teklif olmaz.

export type SfuKind = 'ses' | 'goruntu'
// Yayınlanan izlerin adları (oturum türüne göre; bkz. supabase/functions/oda).
export type TrackName = 'ses' | 'ekran' | 'ekran-ses' | 'kamera'
export type PullResult = { user: string; name: TrackName; mid?: string; error?: string }
export type LocalTrack = { track: MediaStreamTrack; name: TrackName; encodings?: RTCRtpEncodingParameters[] }

type Remote = { user: string; name: TrackName }
type Handlers = {
  // Çekilen bir iz geldi (mid'i değişmeden aynı transceiver'dan gelir).
  onTrack: (user: string, name: TrackName, track: MediaStreamTrack, mid: string) => void
  onState: (state: RTCPeerConnectionState) => void
}

export class SfuError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

// Bir istek en fazla bu kadar sürer. Sunucuda bir istek iki buçuk dakika askıda kaldığında oturumun bütün
// sırası (yayınla, çek) onu bekliyor, yayın hiç açılmıyordu; süre dolunca hata sayılır ve oturum baştan kurulur.
const CALL_TIMEOUT_MS = 15_000

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('oda', { body, timeout: CALL_TIMEOUT_MS })
  if (error) throw new SfuError((await functionErrorCode(error)) ?? 'failed')
  return data as T
}

export class SfuSession {
  readonly pc: RTCPeerConnection
  id: string | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  // Bir pazarlık yarım kaldı (Cloudflare cevap bekliyor); oturum baştan kurulmalı.
  broken = false
  private pullFailures = 0
  // Çekilen izler: mid → kim, hangi iz.
  private readonly remotes = new Map<string, Remote>()
  // Yayınlanan izler: ad → mid.
  private readonly locals = new Map<TrackName, string>()

  constructor(
    readonly kind: SfuKind,
    readonly channelId: string,
    rtc: RTCConfiguration,
    private readonly handlers: Handlers,
  ) {
    this.pc = new RTCPeerConnection({ ...rtc, bundlePolicy: 'max-bundle' })
    this.pc.ontrack = (event) => {
      const mid = event.transceiver.mid
      const remote = mid ? this.remotes.get(mid) : undefined
      if (remote && mid) this.handlers.onTrack(remote.user, remote.name, event.track, mid)
    }
    this.pc.onconnectionstatechange = () => {
      if (!this.closed) this.handlers.onState(this.pc.connectionState)
    }
  }

  get isClosed(): boolean {
    return this.closed
  }

  // Yayın varsa bağlantı kurulana kadar bekler. Cloudflare, yayıncının ilk paketleri gelmeden yapılan yeni bir
  // pazarlıkta yayını hiç tanımayabiliyor (sonra çekenlere "iz yok" der); bu yüzden önce bağlantı kurulur.
  private async settled(): Promise<void> {
    if (!this.locals.size || this.pc.connectionState === 'connected') return
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.pc.removeEventListener('connectionstatechange', check)
        resolve()
      }
      const check = () => {
        if (this.closed || ['connected', 'failed', 'closed'].includes(this.pc.connectionState)) done()
      }
      const timer = setTimeout(done, 10_000)
      this.pc.addEventListener('connectionstatechange', check)
    })
  }

  // Sıradaki işlem öncekinin bitmesini bekler (biri hata verse bile sıra bozulmaz). Oturum şu durumlarda bozuk sayılır
  // ve baştan kurulmalıdır:
  //  - Bir işlem pazarlığın ortasında hata verdi (teklif gitti, cevap gelmedi ya da istek zaman aşımına uğradı):
  //    bağlantı yarım kaldı, bundan sonraki her pazarlık reddedilir.
  //  - Cloudflare oturumu kapatmış (session_gone) ya da sunucudaki kaydı yok (not_found). Cloudflare, bağlantısı hiç
  //    kurulmamış bir oturumu 5-15 sn içinde kapatıyor: "İzle"ye basılıp yayın gecikince izleyicinin oturumu
  //    ölüyor, uygulama da ölü oturumdan sonsuza kadar çekmeye çalışıyordu.
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.closed) throw new SfuError('closed')
      if (this.broken) throw new SfuError('broken')
      try {
        return await task()
      } catch (error) {
        const gone = error instanceof SfuError && (error.code === 'session_gone' || error.code === 'not_found')
        if (!this.closed && (gone || this.pc.signalingState !== 'stable')) this.broken = true
        throw error
      }
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private addLocal(tracks: LocalTrack[]): RTCRtpTransceiver[] {
    return tracks.map(({ track, encodings }) =>
      this.pc.addTransceiver(track, { direction: 'sendonly', ...(encodings ? { sendEncodings: encodings } : {}) }),
    )
  }

  // Oturumu açar; izler verilirse aynı anda yayınlar. 'guncelle': sunucu bu sürüme artık izin vermiyor.
  start(version: string, tracks: LocalTrack[] = []): Promise<'tamam' | 'guncelle'> {
    return this.run(async () => {
      const transceivers = this.addLocal(tracks)
      let sdp: string | undefined
      if (tracks.length) {
        await this.pc.setLocalDescription(await this.pc.createOffer())
        sdp = this.pc.localDescription?.sdp
      }
      const result = await call<{ session?: string; sdp?: string; update?: boolean }>({
        action: 'start',
        channel: this.channelId,
        kind: this.kind,
        version,
        ...(tracks.length ? { sdp, tracks: tracks.map((t, i) => ({ mid: transceivers[i].mid, name: t.name })) } : {}),
      })
      if (result.update) return 'guncelle'
      if (!result.session) throw new SfuError('failed')
      this.id = result.session
      if (this.closed) {
        void this.end()
        throw new SfuError('closed')
      }
      tracks.forEach((t, i) => this.locals.set(t.name, transceivers[i].mid ?? ''))
      if (result.sdp) await this.pc.setRemoteDescription({ type: 'answer', sdp: tuneOpus(result.sdp) })
      return 'tamam'
    })
  }

  // startKbps: görüntü bu hızla başlar (bkz. sdp.ts startBitrate); verilmezse tarayıcının varsayılanı.
  publish(tracks: LocalTrack[], startKbps?: number): Promise<void> {
    return this.run(async () => {
      await this.settled()
      const transceivers = this.addLocal(tracks)
      await this.pc.setLocalDescription(await this.pc.createOffer())
      const result = await call<{ sdp?: string }>({
        action: 'publish',
        session: this.id,
        sdp: this.pc.localDescription?.sdp,
        tracks: tracks.map((t, i) => ({ mid: transceivers[i].mid, name: t.name })),
      })
      tracks.forEach((t, i) => this.locals.set(t.name, transceivers[i].mid ?? ''))
      if (result.sdp) {
        const sdp = tuneOpus(result.sdp)
        await this.pc.setRemoteDescription({ type: 'answer', sdp: startKbps ? startBitrate(sdp, startKbps) : sdp })
      }
    })
  }

  // Yayınlanan izi bırakır (ör. ekran paylaşımı bitti).
  unpublish(names: TrackName[]): Promise<void> {
    const mids = names.map((n) => this.locals.get(n)).filter((m): m is string => !!m)
    for (const name of names) this.locals.delete(name)
    return this.closeMids(mids)
  }

  // Yayınlanan izin mid'i (yayınlanmadıysa undefined).
  localMid(name: TrackName): string | undefined {
    return this.locals.get(name)
  }

  // İzleri çeker. Sonuçta her iz için ya mid ya hata (not_found: o kişi henüz yayınlamamış) vardır.
  pull(asks: { user: string; name: TrackName }[]): Promise<PullResult[]> {
    return this.run(async () => {
      if (!asks.length) return []
      await this.settled()
      let result: { tracks: PullResult[]; sdp?: string }
      try {
        result = await call<{ tracks: PullResult[]; sdp?: string }>({ action: 'pull', session: this.id, tracks: asks })
        this.pullFailures = 0
      } catch (error) {
        // Cloudflare çekmeyi art arda reddediyor (ör. oturum bir cevap bekliyor): oturum baştan kurulmalı.
        if (error instanceof SfuError && error.code === 'sfu_error' && ++this.pullFailures >= 2) this.broken = true
        throw error
      }
      const tracks = result.tracks ?? []
      // ontrack, uzak teklif işlenirken gelir; kimin olduğu ondan önce bilinmeli.
      for (const t of tracks) if (t.mid) this.remotes.set(t.mid, { user: t.user, name: t.name })
      if (result.sdp) {
        try {
          // Kapattığımız izlerin bölümleri teklifte reddedilmiş sayılır (bkz. fixOffer).
          await this.pc.setRemoteDescription({ type: 'offer', sdp: fixOffer(result.sdp) })
          await this.pc.setLocalDescription(await this.pc.createAnswer())
          await call({ action: 'renegotiate', session: this.id, sdp: this.pc.localDescription?.sdp })
        } catch (error) {
          // Cloudflare cevap bekler hâlde kaldı: bu oturumdan artık bir şey çekilemez, baştan kurulmalı.
          this.broken = true
          console.warn('Cloudflare pazarlığı başarısız', this.kind, error)
          throw new SfuError('broken')
        }
      }
      return tracks
    })
  }

  // Çekilen izleri bırakır.
  drop(mids: string[]): Promise<void> {
    for (const mid of mids) this.remotes.delete(mid)
    return this.closeMids(mids)
  }

  private closeMids(mids: string[]): Promise<void> {
    if (!mids.length) return Promise.resolve()
    return this.run(async () => {
      const stopping = this.pc.getTransceivers().filter((t) => t.mid !== null && mids.includes(t.mid) && t.currentDirection !== 'stopped')
      if (!stopping.length) return
      for (const t of stopping) t.stop()
      await this.pc.setLocalDescription(await this.pc.createOffer())
      const result = await call<{ sdp?: string }>({ action: 'close', session: this.id, sdp: this.pc.localDescription?.sdp, mids })
      if (result.sdp) await this.pc.setRemoteDescription({ type: 'answer', sdp: result.sdp })
    })
  }

  // Gelen izlerin paket sayıları (mid → paket) ve bağlantının gecikmesi.
  async stats(): Promise<{ packets: Map<string, number>; ping: number | null; transport: string | null }> {
    const report = await this.pc.getStats()
    const packets = new Map<string, number>()
    let pairId: string | undefined
    report.forEach((r: { type: string; mid?: string; packetsReceived?: number; selectedCandidatePairId?: string }) => {
      if (r.type === 'inbound-rtp' && r.mid) packets.set(r.mid, r.packetsReceived ?? 0)
      if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId
    })
    const pair = pairId ? (report.get(pairId) as { currentRoundTripTime?: number; localCandidateId?: string } | undefined) : undefined
    const local = pair?.localCandidateId
      ? (report.get(pair.localCandidateId) as { candidateType?: string; protocol?: string; relayProtocol?: string } | undefined)
      : undefined
    const transport = local ? (local.candidateType === 'relay' ? `aktarma/${local.relayProtocol ?? local.protocol}` : (local.protocol ?? null)) : null
    return { packets, ping: pair?.currentRoundTripTime !== undefined ? Math.round(pair.currentRoundTripTime * 1000) : null, transport }
  }

  // Bağlantıyı kapatır ve sunucudaki kaydı siler. Cloudflare'deki oturum bağlantı kapanınca kendiliğinden biter.
  end(): Promise<void> {
    this.closed = true
    this.pc.ontrack = null
    this.pc.onconnectionstatechange = null
    this.pc.close()
    this.remotes.clear()
    this.locals.clear()
    const id = this.id
    this.id = null
    return id ? call({ action: 'end', session: id }).then(() => undefined, () => undefined) : Promise.resolve()
  }
}
