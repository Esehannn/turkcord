// Veritabanı ve sunucu hatalarını kullanıcıya gösterilecek Türkçe mesajlara çevirir.

const MESSAGES: Record<string, string> = {
  invalid_invite: 'Davet kodu geçersiz, süresi dolmuş ya da kullanım hakkı bitmiş.',
  invalid_username: 'Kullanıcı adı geçersiz.',
  username_taken: 'Bu kullanıcı adı alınmış.',
  weak_password: 'Şifre yeterince güçlü değil.',
  invalid_display_name: 'Görünen ad en fazla 32 karakter olabilir.',
  rate_limited: 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.',
  registration_failed: 'Kayıt tamamlanamadı. Davet kodunu kontrol edip tekrar dene.',
  forbidden: 'Bunu yapmaya yetkin yok.',
  invalid_input: 'Girilen bilgiler geçersiz.',
  not_found: 'Bulunamadı.',
  user_not_found: 'Bu kullanıcı adıyla kimse bulunamadı.',
  self: 'Bunu kendine yapamazsın.',
  already_friends: 'Zaten arkadaşsınız.',
  already_sent: 'Bu kişiye zaten istek gönderdin.',
  blocked: 'Bu kişiyle etkileşim kurulamıyor (engelleme var).',
  limit_reached: 'Sınıra ulaştın.',
  owner_cannot_leave: 'Sunucunun sahibi sunucudan ayrılamaz; önce sunucuyu silmelisin.',
  last_admin: 'Son yöneticinin yetkisi alınamaz.',
  invalid_attachments: 'Ek dosya geçersiz.',
  busy: 'Bu sohbette zaten çalan bir arama var.',
  server_error: 'Sunucuda bir sorun oluştu. Biraz sonra tekrar dene.',
  failed: 'İşlem başarısız oldu.',
}

const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, 'Kullanıcı adı ya da şifre hatalı.'],
  [/user is banned|banned/i, 'Bu hesap askıya alınmış. Yöneticiyle konuş.'],
  [/rate limit|too many/i, 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.'],
  [/password should|weak password/i, 'Şifre yeterince güçlü değil.'],
  [/failed to fetch|network/i, 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol et.'],
  [/row-level security|permission denied/i, 'Bunu yapmaya yetkin yok.'],
]

export function errorMessage(error: unknown): string {
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : ''

  const code = /turkcord:([a-z_]+)/.exec(raw)?.[1] ?? (MESSAGES[raw] ? raw : undefined)
  if (code && MESSAGES[code]) return MESSAGES[code]

  for (const [pattern, message] of AUTH_MESSAGES) {
    if (pattern.test(raw)) return message
  }
  return 'Bir şeyler ters gitti. Tekrar dene.'
}

// Edge Function hatalarının gövdesindeki { error } kodunu okur.
export async function functionErrorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; reason?: string }
      return body.error ?? null
    } catch {
      return null
    }
  }
  return null
}
