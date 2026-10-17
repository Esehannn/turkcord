// Ses odası sunucusu (Cloudflare Realtime SFU) ile uygulama arasındaki tek kapı.
// Herkes Cloudflare'e tek bir bağlantı (oturum) kurar, kendi sesini bir kez gönderir ve odadakilerin sesini oradan
// çeker. Cloudflare'in uygulama anahtarı yalnızca burada durur; uygulama başkasının oturum kimliğini hiç görmez,
// kişiyi kullanıcı kimliğiyle ister, buradaki kayıt (private.voice_sessions) oturumu bulur.
//
// Kurallar (veritabanı fonksiyonları zorlar, bkz. migrations/20261017000000_ses_odasi_sfu.sql):
//  - Oturum yalnızca sese girebildiği kanalda açılır (sunucuda ses kanalı, özel mesajda iki taraf).
//  - Bir şeyi çekebilmek için çekenin o kanalda kayıtlı oturumu olmalı; çekilen de aynı kanalda olmalı.
//  - Görüntü oturumu yalnızca o kanalın sesindeyken açılır.
//
// Gizli bilgiler Supabase > Edge Functions > Secrets: CLOUDFLARE_SFU_APP_ID, CLOUDFLARE_SFU_APP_TOKEN
// Asgari sürüm (MIN_APP_VERSION) turn fonksiyonundaki gibi uygulanır.
import { adminClient, corsHeaders, json, readJson, withinRateLimit } from '../_shared/http.ts'
import { versionAtLeast } from '../_shared/version.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_RE = /^[0-9a-f]{32,128}$/
const MID_RE = /^[0-9]{1,4}$/
const MAX_SDP = 64 * 1024
// Oturum türüne göre yayınlanabilecek izler. Çekilecek izin hangi oturumda olduğu da buradan bulunur.
const TRACKS: Record<string, 'ses' | 'goruntu'> = { ses: 'ses', ekran: 'goruntu', 'ekran-ses': 'goruntu', kamera: 'goruntu' }
const MAX_TRACKS = 20

type Kind = 'ses' | 'goruntu'
type CfTrack = { location?: string; mid?: string; trackName?: string; sessionId?: string; errorCode?: string; errorDescription?: string }
type CfResponse = {
  sessionId?: string
  sessionDescription?: { type: 'offer' | 'answer'; sdp: string }
  requiresImmediateRenegotiation?: boolean
  tracks?: CfTrack[]
  errorCode?: string
  errorDescription?: string
}

class Fail extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

function sfu(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<CfResponse> {
  const appId = Deno.env.get('CLOUDFLARE_SFU_APP_ID')
  const token = Deno.env.get('CLOUDFLARE_SFU_APP_TOKEN')
  if (!appId || !token) throw new Fail(503, 'sfu_unavailable')
  return fetch(`https://rtc.live.cloudflare.com/v1/apps/${appId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => {
    const data = (await res.json().catch(() => ({}))) as CfResponse
    // 410: oturum kapanmış (bağlantı koptu); uygulama baştan kurar.
    if (res.status === 410) throw new Fail(410, 'session_gone')
    if (!res.ok || data.errorCode) {
      console.error('cloudflare sfu', path.replace(/[0-9a-f]{32,}/g, '…'), res.status, data.errorCode, data.errorDescription)
      throw new Fail(502, 'sfu_error')
    }
    return data
  })
}

function sdpOf(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SDP || !value.startsWith('v=0')) throw new Fail(400, 'invalid_input')
  return value
}

// Yayınlanacak izler: [{ mid, name }]; ad oturum türüne uygun olmalı.
function localTracks(value: unknown, kind: Kind): { location: 'local'; mid: string; trackName: string }[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) throw new Fail(400, 'invalid_input')
  return value.map((item) => {
    const { mid, name } = (item ?? {}) as { mid?: unknown; name?: unknown }
    if (typeof mid !== 'string' || !MID_RE.test(mid) || typeof name !== 'string' || TRACKS[name] !== kind) throw new Fail(400, 'invalid_input')
    return { location: 'local', mid, trackName: name }
  })
}

function description(type: 'offer' | 'answer', sdp: string) {
  return { sessionDescription: { type, sdp } }
}

async function handle(userId: string, body: Record<string, unknown>): Promise<unknown> {
  const admin = adminClient()
  const action = String(body.action ?? '')

  // Oturum bu kişinin mi ve kanala erişimi sürüyor mu? Türünü döner.
  const ownSession = async (): Promise<{ session: string; kind: Kind }> => {
    const session = body.session
    if (typeof session !== 'string' || !SESSION_RE.test(session)) throw new Fail(400, 'invalid_input')
    const { data, error } = await admin.rpc('sfu_session', { p_user: userId, p_session: session })
    if (error) throw error.message.includes('turkcord:not_found') ? new Fail(404, 'not_found') : new Fail(500, 'server_error')
    const row = (data as { kind: Kind }[] | null)?.[0]
    if (!row) throw new Fail(404, 'not_found')
    return { session, kind: row.kind }
  }

  if (action === 'start') {
    const channel = body.channel
    const kind = body.kind
    if (typeof channel !== 'string' || !UUID_RE.test(channel) || (kind !== 'ses' && kind !== 'goruntu')) throw new Fail(400, 'invalid_input')
    const minVersion = Deno.env.get('MIN_APP_VERSION')
    if (minVersion && !versionAtLeast(body.version, minVersion)) return { update: true }
    // Yayınlanacak iz yoksa (yalnızca izlemek için açılan görüntü oturumu) teklif de gerekmez.
    const tracks = body.tracks === undefined ? null : localTracks(body.tracks, kind)
    const offer = tracks ? sdpOf(body.sdp) : null

    const created = await sfu('/sessions/new', 'POST')
    const session = created.sessionId
    if (!session || !SESSION_RE.test(session)) throw new Fail(502, 'sfu_error')
    const { error } = await admin.rpc('sfu_register', { p_user: userId, p_channel: channel, p_kind: kind, p_session: session })
    if (error) throw error.message.includes('turkcord:forbidden') ? new Fail(403, 'forbidden') : new Fail(500, 'server_error')

    if (!tracks || !offer) return { session }
    const pushed = await sfu(`/sessions/${session}/tracks/new`, 'POST', { ...description('offer', offer), tracks })
    if (pushed.tracks?.some((t) => t.errorCode)) throw new Fail(502, 'sfu_error')
    return { session, sdp: pushed.sessionDescription?.sdp }
  }

  if (action === 'publish') {
    const { session, kind } = await ownSession()
    const tracks = localTracks(body.tracks, kind)
    const pushed = await sfu(`/sessions/${session}/tracks/new`, 'POST', { ...description('offer', sdpOf(body.sdp)), tracks })
    if (pushed.tracks?.some((t) => t.errorCode)) throw new Fail(502, 'sfu_error')
    return { sdp: pushed.sessionDescription?.sdp }
  }

  if (action === 'pull') {
    // Ses oturumu yalnızca ses, görüntü oturumu yalnızca ekran ve kamera çeker.
    const { session, kind } = await ownSession()
    const wanted = body.tracks
    if (!Array.isArray(wanted) || wanted.length === 0 || wanted.length > MAX_TRACKS) throw new Fail(400, 'invalid_input')
    const asks = wanted.map((item) => {
      const { user, name } = (item ?? {}) as { user?: unknown; name?: unknown }
      if (typeof user !== 'string' || !UUID_RE.test(user) || typeof name !== 'string' || TRACKS[name] !== kind) throw new Fail(400, 'invalid_input')
      return { user: user.toLowerCase(), name }
    })
    const users = [...new Set(asks.map((a) => a.user))]
    const { data, error } = await admin.rpc('sfu_targets', { p_user: userId, p_session: session, p_users: users })
    if (error) throw error.message.includes('turkcord:not_found') ? new Fail(404, 'not_found') : new Fail(500, 'server_error')
    const sessions = new Map(((data ?? []) as { user_id: string; kind: Kind; session_id: string }[]).map((r) => [`${r.user_id}:${r.kind}`, r.session_id]))

    const results: { user: string; name: string; mid?: string; error?: string }[] = []
    const remote: { location: 'remote'; sessionId: string; trackName: string }[] = []
    const order: number[] = []
    for (const ask of asks) {
      const target = sessions.get(`${ask.user}:${TRACKS[ask.name]}`)
      results.push({ ...ask, ...(target ? {} : { error: 'not_found' }) })
      if (target) {
        order.push(results.length - 1)
        remote.push({ location: 'remote', sessionId: target, trackName: ask.name })
      }
    }
    if (remote.length === 0) return { tracks: results }

    const pulled = await sfu(`/sessions/${session}/tracks/new`, 'POST', { tracks: remote })
    // Cloudflare sonuçları istek sırasıyla döner; oturum kimlikleri uygulamaya gönderilmez.
    order.forEach((index, i) => {
      const track = pulled.tracks?.[i]
      if (track?.errorCode) console.error('cloudflare sfu pull', track.errorCode, track.errorDescription)
      if (!track || track.errorCode || !track.mid) results[index].error = track?.errorCode === 'not_found_track_error' ? 'not_found' : 'failed'
      else results[index].mid = track.mid
    })
    return {
      tracks: results,
      sdp: pulled.requiresImmediateRenegotiation ? pulled.sessionDescription?.sdp : undefined,
    }
  }

  if (action === 'renegotiate') {
    const { session } = await ownSession()
    await sfu(`/sessions/${session}/renegotiate`, 'PUT', description('answer', sdpOf(body.sdp)))
    return {}
  }

  if (action === 'close') {
    const { session } = await ownSession()
    const mids = body.mids
    if (!Array.isArray(mids) || mids.length === 0 || mids.length > MAX_TRACKS || mids.some((m) => typeof m !== 'string' || !MID_RE.test(m))) {
      throw new Fail(400, 'invalid_input')
    }
    const closed = await sfu(`/sessions/${session}/tracks/close`, 'PUT', {
      ...description('offer', sdpOf(body.sdp)),
      tracks: (mids as string[]).map((mid) => ({ mid })),
      force: false,
    })
    return { sdp: closed.sessionDescription?.sdp }
  }

  if (action === 'end') {
    const session = body.session
    if (typeof session !== 'string' || !SESSION_RE.test(session)) throw new Fail(400, 'invalid_input')
    // Cloudflare'deki oturum, bağlantı kapanınca kendiliğinden biter; burada yalnızca kayıt silinir.
    const { error } = await admin.rpc('sfu_unregister', { p_user: userId, p_session: session })
    if (error) throw new Fail(500, 'server_error')
    return {}
  }

  throw new Fail(400, 'invalid_input')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'unauthorized' })
  const admin = adminClient()
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError || !auth.user) return json(401, { error: 'unauthorized' })

  const body = await readJson(req)
  if (!body) return json(400, { error: 'invalid_input' })

  // Bir giriş: oturum + izleri çekme + yenileme; 10 kişilik odada yeniden bağlanmalarla birlikte bolca yeter.
  if (!(await withinRateLimit(admin, `oda:${auth.user.id}`, 900, 3600))) return json(429, { error: 'rate_limited' })

  try {
    return json(200, await handle(auth.user.id, body))
  } catch (error) {
    if (error instanceof Fail) return json(error.status, { error: error.code })
    console.error('oda', error)
    return json(500, { error: 'server_error' })
  }
})
