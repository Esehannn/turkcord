// Edge Function'lar için ortak yardımcılar.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Service role ile çalışan istemci: RLS'i atlar, sadece sunucu tarafında kullanılır.
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tanımlı değil')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Uygulamada da aynı kural var (src/shared/username.ts): kullanıcı adı -> giriş için kullanılan iç e-posta.
// ".invalid" alan adı hiçbir zaman gerçek bir posta kutusuna gitmez; e-posta hiç gönderilmez.
export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/
export const EMAIL_DOMAIN = 'kullanici.turkcord.invalid'

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username) && !username.startsWith('.') && !username.endsWith('.') && !username.includes('..')
}

export function usernameToEmail(username: string): string {
  return `${username}@${EMAIL_DOMAIN}`
}

// İstemcinin IP adresi (Supabase önündeki vekil sunucu ekler). Bulunamazsa ortak bir anahtar kullanılır.
export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'bilinmiyor'
}

// true: devam edilebilir, false: sınır aşıldı. Veritabanı hatasında güvenli tarafta kalıp reddeder.
export async function withinRateLimit(
  admin: SupabaseClient,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc('hit_rate_limit', {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  })
  if (error) {
    console.error('hit_rate_limit', error.message)
    return false
  }
  return data === true
}
