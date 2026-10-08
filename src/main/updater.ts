import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { startedHidden } from './desktop'
import { isTrustedSender } from './security'

// Otomatik güncelleme: GitHub Releases'taki yeni sürüm indirilir ve kurulur. Sadece paketlenmiş uygulamada çalışır.
//
// Açılışta: uygulama önce güncelleme var mı diye bakar; varsa açılış ekranında indirip kurar ve yeniden
//   başlar (kullanıcı her zaman son sürümle girer). Windows açılışında tepside sessizce başladıysa
//   kendiliğinden yeniden başlamaz; aşağıdaki "çalışırken" yolu izlenir.
// Çalışırken: 4 saatte bir bakılır; yeni sürüm arka planda iner, arayüzde şerit çıkar. Kullanıcı
//   "Yeniden başlat" derse hemen, demezse uygulama kapanırken kurulur.

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

export type UpdateStage = {
  phase: 'checking' | 'downloading' | 'ready' | 'none' | 'error'
  // İndirme yüzdesi (0-100).
  percent: number
  version: string | null
  // Açılış ekranı indirme bitince kendiliğinden kurup yeniden başlatsın mı?
  autoInstall: boolean
}

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  let readyVersion: string | null = null
  let stage: UpdateStage = { phase: app.isPackaged ? 'checking' : 'none', percent: 0, version: null, autoInstall: !startedHidden() }

  const setStage = (patch: Partial<UpdateStage>): void => {
    stage = { ...stage, ...patch }
    getWindow()?.webContents.send('guncelleme:asama', stage)
  }

  ipcMain.handle('guncelleme:durum', (event) => (isTrustedSender(event) ? readyVersion : null))
  ipcMain.handle('guncelleme:asama-oku', (event) => (isTrustedSender(event) ? stage : null))
  ipcMain.handle('guncelleme:kur', (event) => {
    if (!isTrustedSender(event) || !readyVersion) return
    electronUpdater.autoUpdater.quitAndInstall(true, true)
  })

  if (!app.isPackaged) return

  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} }

  autoUpdater.on('update-available', (info) => setStage({ phase: 'downloading', percent: 0, version: info.version }))
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
    if (stage.phase === 'downloading' && percent !== stage.percent) setStage({ percent })
  })
  autoUpdater.on('update-not-available', () => {
    if (!readyVersion) setStage({ phase: 'none' })
  })
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version
    setStage({ phase: 'ready', percent: 100, version: info.version })
    getWindow()?.webContents.send('guncelleme:hazir', info.version)
  })
  autoUpdater.on('error', (error) => {
    console.warn('Güncelleme kontrolü başarısız:', error.message)
    if (!readyVersion) setStage({ phase: 'error' })
  })

  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, CHECK_EVERY_MS)
}
