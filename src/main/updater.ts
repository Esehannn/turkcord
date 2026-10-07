import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { isTrustedSender } from './security'

// Otomatik güncelleme: GitHub Releases'taki yeni sürüm arka planda indirilir.
// İnince arayüze haber verilir; kullanıcı "Yeniden başlat" derse hemen, demezse uygulama
// kapanırken kurulur. Sadece paketlenmiş uygulamada çalışır.

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  let readyVersion: string | null = null

  ipcMain.handle('guncelleme:durum', (event) => (isTrustedSender(event) ? readyVersion : null))
  ipcMain.handle('guncelleme:kur', (event) => {
    if (!isTrustedSender(event) || !readyVersion) return
    electronUpdater.autoUpdater.quitAndInstall(true, true)
  })

  if (!app.isPackaged) return

  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} }

  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version
    getWindow()?.webContents.send('guncelleme:hazir', info.version)
  })
  autoUpdater.on('error', (error) => console.warn('Güncelleme kontrolü başarısız:', error.message))

  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, 10_000)
  setInterval(check, CHECK_EVERY_MS)
}
