// Yönetici işlemleri: şifre sıfırlama, hesabı askıya alma, hesabı silme, kullanıcı durumlarını listeleme.
// Ücretsiz Supabase arkadaşlara e-posta gönderemediği için "şifremi unuttum" yerine yönetici yeni şifre belirler.
import { adminClient, corsHeaders, json, readJson } from '../_shared/http.ts'
import { checkPassword } from '../_shared/password.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FOREVER = '876000h' // ~100 yıl

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'unauthorized' })

  const admin = adminClient()
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError || !auth.user) return json(401, { error: 'unauthorized' })

  const { data: me, error: meError } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (meError) {
    console.error('profiles', meError.message)
    return json(500, { error: 'server_error' })
  }
  if (!me?.is_admin) return json(403, { error: 'forbidden' })

  const body = await readJson(req)
  if (!body) return json(400, { error: 'invalid_input' })
  const action = String(body.action ?? '')

  if (action === 'list_users') {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 })
    if (error) return json(500, { error: 'server_error' })
    return json(200, {
      users: data.users.map((u) => ({
        id: u.id,
        banned_until: (u as { banned_until?: string | null }).banned_until ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: u.created_at,
      })),
    })
  }

  const userId = String(body.user_id ?? '')
  if (!UUID_RE.test(userId)) return json(400, { error: 'invalid_input' })
  if (userId === auth.user.id) return json(400, { error: 'self' })

  switch (action) {
    case 'reset_password': {
      const password = String(body.password ?? '')
      const problem = checkPassword(password)
      if (problem) return json(400, { error: 'weak_password', reason: problem })
      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) return json(400, { error: 'failed' })
      return json(200, { ok: true })
    }
    case 'set_banned': {
      const banned = body.banned === true
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: banned ? FOREVER : 'none' })
      if (error) return json(400, { error: 'failed' })
      return json(200, { ok: true })
    }
    case 'delete_user': {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) return json(400, { error: 'failed' })
      return json(200, { ok: true })
    }
    default:
      return json(400, { error: 'invalid_action' })
  }
})
