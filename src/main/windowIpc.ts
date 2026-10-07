import { app, ipcMain, nativeImage, powerMonitor, type BrowserWindow } from 'electron'
import { isTrustedSender } from './security'

const BADGE_PREFIX = 'data:image/png;base64,'

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
      return
    }
    win.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `${count} okunmamış`)
  })
}
