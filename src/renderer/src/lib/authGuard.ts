import { toast } from '@/stores/toast'
import { supabase } from './supabase'

// Sunucu "oturum geçersiz" (401) derse: önce oturumu yenilemeyi dener; yenilenemiyorsa (şifre sıfırlanmış,
// hesap askıya alınmış ya da silinmiş) bu bilgisayardaki oturumu kapatır ve giriş ekranına döner.
// Böylece geçersiz bir oturumla sunucuya boşuna istek gönderilmeye devam edilmez.

const CHECK_EVERY_MS = 30_000
let checking = false
let lastCheck = 0

export function isAuthError(error: unknown): boolean {
  const e = (error ?? {}) as { status?: number; code?: string; message?: string }
  return e.status === 401 || /^PGRST30[0-3]$/.test(e.code ?? '') || /\bjwt\b|invalid (api key|token)|unauthorized/i.test(e.message ?? '')
}

export async function handleAuthError(error: unknown): Promise<void> {
  if (!isAuthError(error) || checking || Date.now() - lastCheck < CHECK_EVERY_MS) return
  checking = true
  lastCheck = Date.now()
  try {
    const { error: refreshError } = await supabase.auth.refreshSession()
    // Sadece sunucu açıkça reddettiyse çıkış yapılır; internet yoksa ya da sunucu meşgulse oturum korunur.
    const status = (refreshError as { status?: number } | null)?.status ?? 0
    if (refreshError && status >= 400 && status < 500 && status !== 429) {
      await supabase.auth.signOut({ scope: 'local' })
      toast.info('Oturumun sona ermiş. Yeniden giriş yap.')
    }
  } catch {
    // Yenileme denenemedi; bir sonraki hatada yeniden denenir.
  } finally {
    checking = false
  }
}
