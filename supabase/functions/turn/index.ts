// Sesli sohbet için ICE sunucuları.
// Cloudflare TURN anahtarı tanımlıysa kısa ömürlü TURN bilgisi üretir (doğrudan bağlantı kurulamayan
// hatlar için yedek). Tanımlı değilse sadece ücretsiz STUN sunucularını döner.
// Gizli bilgiler Supabase > Edge Functions > Secrets: CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN
import { adminClient, corsHeaders, json, withinRateLimit } from '../_shared/http.ts'

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]
const TTL_SECONDS = 12 * 60 * 60

type IceServer = { urls: string | string[]; username?: string; credential?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'unauthorized' })
  const admin = adminClient()
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError || !auth.user) return json(401, { error: 'unauthorized' })

  const keyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID')
  const apiToken = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN')
  if (!keyId || !apiToken) return json(200, { iceServers: STUN, turn: false })

  // Ücretsiz kotayı korumak için kişi başı saatte 30 istek.
  if (!(await withinRateLimit(admin, `turn:${auth.user.id}`, 30, 3600))) {
    return json(200, { iceServers: STUN, turn: false })
  }

  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    })
    if (!res.ok) {
      console.error('cloudflare turn', res.status)
      return json(200, { iceServers: STUN, turn: false })
    }
    const data = (await res.json()) as { iceServers?: IceServer | IceServer[] }
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : []
    // 53 numaralı port tarayıcılarda engelli; o adresler sadece zaman aşımına yol açar.
    const iceServers = list
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0)
    return json(200, { iceServers: iceServers.length ? iceServers : STUN, turn: iceServers.length > 0 })
  } catch (error) {
    console.error('cloudflare turn', error)
    return json(200, { iceServers: STUN, turn: false })
  }
})
