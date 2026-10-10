import { desktopCapturer, ipcMain, type Session } from 'electron'
import { isTrustedSender, isTrustedUrl } from './security'

// Ekran paylaşımı. Hangi ekranın ya da pencerenin paylaşılacağını uygulamanın kendi seçim penceresi sorar:
//   1. Arayüz kaynak listesini ister ("ekran:kaynaklar"): ad ve küçük önizleme.
//   2. Kullanıcı birini seçer; arayüz seçimi bildirir ("ekran:sec").
//   3. Arayüz getDisplayMedia çağırır; aşağıdaki işleyici yalnızca az önce seçilen kaynağı verir.
// Seçim yapılmadan gelen yakalama isteği reddedilir; yani sayfa kullanıcıya sormadan ekranı alamaz.

export type ScreenSource = { id: string; name: string; screen: boolean; thumbnail: string }

const SOURCE_ID = /^(screen|window):\d+:\d+$/
// Seçim ile yakalama isteği arasında en fazla bu kadar süre geçebilir.
const CHOICE_TTL_MS = 15_000

export function setupScreenCapture(ses: Session): void {
  let choice: { id: string; audio: boolean; at: number } | null = null

  ipcMain.handle('ekran:kaynaklar', async (event): Promise<ScreenSource[]> => {
    if (!isTrustedSender(event)) return []
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
    return sources
      .filter((s) => !s.thumbnail.isEmpty())
      .map((s) => ({
        id: s.id,
        name: s.name.slice(0, 120),
        screen: s.id.startsWith('screen:'),
        thumbnail: `data:image/jpeg;base64,${s.thumbnail.toJPEG(72).toString('base64')}`,
      }))
  })

  ipcMain.handle('ekran:sec', (event, id: unknown, audio: unknown): boolean => {
    if (!isTrustedSender(event) || typeof id !== 'string' || !SOURCE_ID.test(id)) return false
    choice = { id, audio: audio === true, at: Date.now() }
    return true
  })

  ses.setDisplayMediaRequestHandler((request, callback) => {
    const picked = choice
    choice = null
    // Boş yanıt isteği reddeder (arayüzde getDisplayMedia hata verir).
    const deny = () => {
      try {
        callback({})
      } catch {
        // Electron bazı sürümlerde boş yanıtta hata fırlatır; istek yine reddedilmiş olur.
      }
    }
    if (!picked || Date.now() - picked.at > CHOICE_TTL_MS || !request.frame || !isTrustedUrl(request.frame.url)) return deny()
    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const source = sources.find((s) => s.id === picked.id)
        if (!source) return deny()
        // loopback: bilgisayarın çaldığı ses (oyun, video) de paylaşılır.
        callback(picked.audio ? { video: source, audio: 'loopback' } : { video: source })
      })
      .catch(deny)
  })
}
