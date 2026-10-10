import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { isTrustedSender } from './security'

// Otomatik güncelleme: GitHub Releases'taki yeni sürüm indirilir ve kurulur. Sadece paketlenmiş uygulamada çalışır.
//
// Açılışta: uygulamanın kendisi açılmadan önce küçük bir güncelleme penceresi çıkar ve yeni sürüm var mı diye
//   bakar. Varsa orada indirilir, kurulur ve uygulama yeni sürümle yeniden başlar; yoksa (ya da denetim
//   yapılamadıysa) pencere kapanır ve uygulama açılır. Windows açılışında tepside sessizce başladıysa bu
//   pencere gösterilmez; aşağıdaki "çalışırken" yolu izlenir.
// Çalışırken: 4 saatte bir bakılır; yeni sürüm arka planda iner, arayüzde şerit çıkar. Kullanıcı
//   "Yeniden başlat" derse hemen, demezse uygulama kapanırken kurulur.

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
// Denetim bu kadar sürerse (ör. internet yok ya da yavaş) beklemeden uygulama açılır.
const CHECK_TIMEOUT_MS = 10_000

export type UpdateStage = {
  phase: 'checking' | 'downloading' | 'ready' | 'none' | 'error'
  // İndirme yüzdesi (0-100).
  percent: number
  version: string | null
}

// interactive: açılışta güncelleme penceresi gösteriliyor mu? Dönen söz, uygulama açılabilir olunca çözülür
// (güncelleme kurulacaksa hiç çözülmez; uygulama kapanıp yeni sürümle açılır).
export function setupUpdater(getWindow: () => BrowserWindow | null, interactive: boolean): Promise<void> {
  let readyVersion: string | null = null
  let stage: UpdateStage = { phase: interactive ? 'checking' : 'none', percent: 0, version: null }
  let starting = interactive
  let openApp: () => void = () => {}
  const startup = new Promise<void>((resolve) => (openApp = resolve))
  let checkTimer: ReturnType<typeof setTimeout> | undefined

  const setStage = (patch: Partial<UpdateStage>): void => {
    stage = { ...stage, ...patch }
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('guncelleme:asama', stage)
  }
  // Açılış aşamasını bitirir: güncelleme penceresi kapanır, uygulama açılır.
  const finishStartup = (): void => {
    if (!starting) return
    starting = false
    clearTimeout(checkTimer)
    openApp()
  }

  ipcMain.handle('guncelleme:durum', (event) => (isTrustedSender(event) ? readyVersion : null))
  ipcMain.handle('guncelleme:asama-oku', (event) => (isTrustedSender(event) ? stage : null))
  ipcMain.handle('guncelleme:kur', (event) => {
    if (!isTrustedSender(event) || !readyVersion) return
    electronUpdater.autoUpdater.quitAndInstall(true, true)
  })
  // "Şimdilik atla": indirme arka planda sürer, uygulama hemen açılır.
  ipcMain.on('guncelleme:atla', (event) => {
    if (isTrustedSender(event)) finishStartup()
  })

  if (!app.isPackaged) {
    // Geliştirmede güncelleme yoktur; TURKCORD_GUNCELLEME_DENEME=1 ile açılış penceresinin aşamaları denenir.
    if (interactive) simulate(setStage, finishStartup)
    else openApp()
    return startup
  }
  if (!interactive) openApp()

  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} }

  autoUpdater.on('update-available', (info) => {
    // İndirme başladı: artık süre sınırı yok, pencere indirmeyi gösterir.
    clearTimeout(checkTimer)
    setStage({ phase: 'downloading', percent: 0, version: info.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
    if (stage.phase === 'downloading' && percent !== stage.percent) setStage({ percent })
  })
  autoUpdater.on('update-not-available', () => {
    if (!readyVersion) setStage({ phase: 'none' })
    finishStartup()
  })
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version
    setStage({ phase: 'ready', percent: 100, version: info.version })
    if (starting) {
      // "Kuruluyor" yazısı bir an görünsün, sonra uygulama kapanıp yeni sürümle açılır.
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 900)
      return
    }
    getWindow()?.webContents.send('guncelleme:hazir', info.version)
  })
  autoUpdater.on('error', (error) => {
    console.warn('Güncelleme kontrolü başarısız:', error.message)
    if (!readyVersion) setStage({ phase: 'error' })
    finishStartup()
  })

  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  if (starting) checkTimer = setTimeout(finishStartup, CHECK_TIMEOUT_MS)
  check()
  setInterval(check, CHECK_EVERY_MS)
  return startup
}

// Geliştirme denemesi: denetim → indirme → kurulum yazıları sırayla gösterilir, sonra uygulama açılır.
function simulate(setStage: (patch: Partial<UpdateStage>) => void, done: () => void): void {
  let percent = 0
  setTimeout(() => {
    setStage({ phase: 'downloading', percent: 0, version: '9.9.9' })
    const timer = setInterval(() => {
      percent += 4
      setStage({ percent: Math.min(100, percent) })
      if (percent < 100) return
      clearInterval(timer)
      setStage({ phase: 'ready' })
      setTimeout(done, 1200)
    }, 120)
  }, 1500)
}
