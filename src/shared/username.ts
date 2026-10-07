// Kullanıcı adı kuralları. Sunucudaki kopyası: supabase/functions/_shared/http.ts (ikisi aynı kalmalı).

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/

// Giriş için kullanılan iç e-posta. ".invalid" alan adı hiçbir zaman gerçek bir posta kutusuna gitmez.
export const EMAIL_DOMAIN = 'kullanici.turkcord.invalid'

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase()
}

export function isValidUsername(username: string): boolean {
  return (
    USERNAME_RE.test(username) && !username.startsWith('.') && !username.endsWith('.') && !username.includes('..')
  )
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${EMAIL_DOMAIN}`
}

// Kayıt formunda gösterilecek açıklama; geçerliyse null.
export function usernameProblem(username: string): string | null {
  if (username.length < 3) return 'Kullanıcı adı en az 3 karakter olmalı.'
  if (username.length > 20) return 'Kullanıcı adı en fazla 20 karakter olabilir.'
  if (!/^[a-z0-9_.]+$/.test(username)) return 'Sadece küçük harf (a-z), rakam, nokta ve alt çizgi kullanılabilir.'
  if (!isValidUsername(username)) return 'Nokta ile başlayamaz, bitemez ve art arda iki nokta olamaz.'
  return null
}
