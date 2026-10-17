import { functionErrorCode } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { tuneOpus } from './sdp'

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

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('oda', { body })
  if (error) throw new SfuError((await functionErrorCode(error)) ?? 'failed')
  return data as T
}

export class SfuSession {
  readonly pc: RTCPeerConnection
  id: string | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
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

  // Sıradaki işlem öncekinin bitmesini bekler (biri hata verse bile sıra bozulmaz).
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (this.closed) throw new SfuError('closed')
      return task()
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

  publish(tracks: LocalTrack[]): Promise<void> {
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
      if (result.sdp) await this.pc.setRemoteDescription({ type: 'answer', sdp: tuneOpus(result.sdp) })
    })
  }

  // Yayınlanan izi bırakır (ör. ekran paylaşımı bitti).
  unpublish(names: TrackName[]): Promise<void> {
    const mids = names.map((n) => this.locals.get(n)).filter((m): m is string => !!m)
    for (const name of names) this.locals.delete(name)
    return this.closeMids(mids)
  }

  isPublished(name: TrackName): boolean {
    return this.locals.has(name)
  }

  // İzleri çeker. Sonuçta her iz için ya mid ya hata (not_found: o kişi henüz yayınlamamış) vardır.
  pull(asks: { user: string; name: TrackName }[]): Promise<PullResult[]> {
    return this.run(async () => {
      if (!asks.length) return []
      await this.settled()
      const result = await call<{ tracks: PullResult[]; sdp?: string }>({ action: 'pull', session: this.id, tracks: asks })
      const tracks = result.tracks ?? []
      // ontrack, uzak teklif işlenirken gelir; kimin olduğu ondan önce bilinmeli.
      for (const t of tracks) if (t.mid) this.remotes.set(t.mid, { user: t.user, name: t.name })
      if (result.sdp) {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: result.sdp })
        await this.pc.setLocalDescription(await this.pc.createAnswer())
        await call({ action: 'renegotiate', session: this.id, sdp: this.pc.localDescription?.sdp })
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
