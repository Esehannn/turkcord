// Sesli sohbet için ICE sunucuları.
// Ses ve görüntü yalnızca Cloudflare'in aktarma (TURN) sunucusundan geçer; bu fonksiyon onun kısa ömürlü
// kimlik bilgisini üretir. Üretilemezse (anahtar tanımlı değil, istek sınırı, Cloudflare hatası) boş liste
// döner ve uygulama bağlanmaz; başka bir sunucuya ya da doğrudan bağlantıya geri dönülmez.
// Gizli bilgiler Supabase > Edge Functions > Secrets: CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN
//
// Asgari sürüm (isteğe bağlı gizli ayar MIN_APP_VERSION, ör. "0.8.0"): daha eski ya da sürümünü bildirmeyen
// uygulamaya aktarma bilgisi verilmez ve güncellemesi istenir. Sürümü uygulama kendi bildirdiği için bu,
// değiştirilmiş bir istemciyi durdurmaz; güncellemeyi erteleyen kullanıcıyı günceller.
import { adminClient, corsHeaders, json, readJson, withinRateLimit } from '../_shared/http.ts'
import { versionAtLeast } from '../_shared/version.ts'

const NONE = { iceServers: [], turn: false }
// Uygulama bilgiyi saatte bir yeniler; süre, kanalda kesintisiz geçebilecek en uzun vakitten uzun olmalı.
const TTL_SECONDS = 24 * 60 * 60

type IceServer = { urls: string | string[]; username?: string; credential?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'unauthorized' })
  const admin = adminClient()
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError || !auth.user) return json(401, { error: 'unauthorized' })

  const minVersion = Deno.env.get('MIN_APP_VERSION')
  if (minVersion && !versionAtLeast((await readJson(req))?.version, minVersion)) return json(200, { ...NONE, update: true })

  const keyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID')
  const apiToken = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN')
  if (!keyId || !apiToken) return json(200, NONE)

  // Ücretsiz kotayı korumak için kişi başı saatte 30 istek.
  if (!(await withinRateLimit(admin, `turn:${auth.user.id}`, 30, 3600))) {
    return json(200, NONE)
  }

  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    })
    if (!res.ok) {
      console.error('cloudflare turn', res.status)
      return json(200, NONE)
    }
    const data = (await res.json()) as { iceServers?: IceServer | IceServer[] }
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : []
    // 53 numaralı port tarayıcılarda engelli; o adresler sadece zaman aşımına yol açar.
    // Yalnızca TURN adresleri: STUN'un tek işi kişinin kendi adresini öğrenip karşıya bildirmesidir.
    const iceServers = list
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => /^turns?:/i.test(u) && !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0)
    return json(200, { iceServers, turn: iceServers.length > 0 })
  } catch (error) {
    console.error('cloudflare turn', error)
    return json(200, NONE)
  }
})
