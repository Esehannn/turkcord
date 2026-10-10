import { app, ipcMain, nativeImage, powerMonitor, type BrowserWindow } from 'electron'
import { setTrayUnread } from './desktop'
import { isTrustedSender } from './security'

const BADGE_PREFIX = 'data:image/png;base64,'
export const TITLE_BAR_HEIGHT = 32

// Başlık çubuğundaki Windows düğmelerinin (küçült, büyüt, kapat) renkleri; arayüzdeki çubukla aynı.
// Çubuğun rengini arayüz bildirir: açık temada vurgu rengi (varsayılan kırmızı), koyu temada seçili tonun
// sol şerit rengi.
export function titleBarOverlay(theme: 'light' | 'dark', bar?: string): Electron.TitleBarOverlayOptions {
  return theme === 'dark'
    ? { color: bar ?? '#121214', symbolColor: '#f2f2f3', height: TITLE_BAR_HEIGHT }
    : { color: bar ?? '#e30a17', symbolColor: '#ffffff', height: TITLE_BAR_HEIGHT }
}

export function registerWindowIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('app:version', (event) => (isTrustedSender(event) ? app.getVersion() : null))
  ipcMain.handle('app:idle-seconds', (event) => (isTrustedSender(event) ? powerMonitor.getSystemIdleTime() : 0))

  // Pencere odakta değilken yeni mesaj gelince görev çubuğunda yanıp söner.
  ipcMain.on('window:flash', (event) => {
    const win = getWindow()
    if (!win || !isTrustedSender(event) || win.isFocused()) return
    win.flashFrame(true)
    win.once('focus', () => win.flashFrame(false))
  })

  // Görev çubuğu simgesinde okunmamış rozeti (Windows). Rozet resmini arayüz çizer.
  ipcMain.on('window:badge', (event, count: unknown, dataUrl: unknown) => {
    const win = getWindow()
    if (process.platform !== 'win32' || !win || !isTrustedSender(event) || typeof count !== 'number') return
    if (count <= 0 || typeof dataUrl !== 'string' || !dataUrl.startsWith(BADGE_PREFIX) || dataUrl.length > 20_000) {
      win.setOverlayIcon(null, '')
      setTrayUnread(0, null)
      return
    }
    const image = nativeImage.createFromDataURL(dataUrl)
    win.setOverlayIcon(image, `${count} okunmamış`)
    // Pencere tepsideyken de okunmamış olduğu görülsün.
    setTrayUnread(count, image)
  })

  // Tema ya da vurgu rengi değişince başlık çubuğu düğmelerinin rengi de değişir.
  ipcMain.on('pencere:tema', (event, theme: unknown, accent: unknown) => {
    const win = getWindow()
    if (process.platform !== 'win32' || !win || !isTrustedSender(event) || (theme !== 'light' && theme !== 'dark')) return
    const color = typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent) ? accent : undefined
    try {
      win.setTitleBarOverlay(titleBarOverlay(theme, color))
    } catch {
      // Başlık çubuğu özelleştirilmemişse (ör. başka platform) yok sayılır.
    }
  })

  // Gelen arama: pencere tepsideyse odağı çalmadan gösterilir ve görev çubuğunda yanıp söner.
  ipcMain.on('pencere:dikkat', (event) => {
    const win = getWindow()
    if (!win || !isTrustedSender(event)) return
    if (!win.isVisible()) win.showInactive()
    if (!win.isFocused()) {
      win.flashFrame(true)
      win.once('focus', () => win.flashFrame(false))
    }
  })

  // Bildirime tıklanınca pencere tepsiden de olsa öne gelir.
  ipcMain.on('pencere:goster', (event) => {
    const win = getWindow()
    if (!win || !isTrustedSender(event)) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}
