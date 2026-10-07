// Davet koduyla kayıt.
// Kullanıcıyı Auth admin API ile oluşturur; e-posta doğrulaması gerekmez çünkü hiç e-posta gönderilmez.
// Asıl güvenlik kontrolü veritabanındaki tetikleyicide (davet kodu geçersizse kullanıcı oluşmaz);
// buradaki ön kontrol sadece anlaşılır hata mesajı vermek için.
import {
  adminClient,
  clientIp,
  corsHeaders,
  isValidUsername,
  json,
  readJson,
  usernameToEmail,
  withinRateLimit,
} from '../_shared/http.ts'
import { checkPassword } from '../_shared/password.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const body = await readJson(req)
  if (!body) return json(400, { error: 'invalid_input' })

  const username = String(body.username ?? '').trim().toLowerCase()
  const displayName = String(body.display_name ?? '').trim()
  const password = String(body.password ?? '')
  const inviteCode = String(body.invite_code ?? '').trim()

  if (!isValidUsername(username)) return json(400, { error: 'invalid_username' })
  if (displayName.length > 32) return json(400, { error: 'invalid_display_name' })
  const passwordProblem = checkPassword(password, username)
  if (passwordProblem) return json(400, { error: 'weak_password', reason: passwordProblem })
  if (!inviteCode || inviteCode.length > 32) return json(400, { error: 'invalid_invite' })

  const admin = adminClient()

  // Davet kodunu deneme-yanılmayla bulmayı ve toplu kayıt denemelerini engeller.
  const ipAllowed = await withinRateLimit(admin, `kayit:ip:${clientIp(req)}`, 10, 3600)
  const globalAllowed = ipAllowed && (await withinRateLimit(admin, 'kayit:tum', 200, 3600))
  if (!ipAllowed || !globalAllowed) return json(429, { error: 'rate_limited' })

  const { data: check, error: checkError } = await admin.rpc('check_registration', {
    p_username: username,
    p_code: inviteCode,
  })
  if (checkError) {
    console.error('check_registration', checkError.message)
    return json(500, { error: 'server_error' })
  }
  if (check !== 'ok') return json(400, { error: check })

  const { error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName || username, invite_code: inviteCode },
  })

  if (error) {
    console.error('createUser', error.message)
    if (/already|exists|registered/i.test(error.message)) return json(400, { error: 'username_taken' })
    if (/password/i.test(error.message)) return json(400, { error: 'weak_password' })
    // Ön kontrolden sonra kod başkası tarafından kullanıldıysa tetikleyici kaydı reddeder.
    return json(400, { error: 'registration_failed' })
  }

  return json(200, { ok: true })
})
