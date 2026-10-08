import { app, BrowserWindow, clipboard, Menu, nativeImage, session, shell } from 'electron'
import { join } from 'node:path'
import { registerAuthStorage } from './authStorage'
import { hideOnClose, setupDesktop, startedHidden } from './desktop'
import { registerWindowIpc, titleBarOverlay } from './windowIpc'
import { setupUpdater } from './updater'
import { isSafeExternalUrl, isTrustedUrl } from './security'

const APP_ID = 'com.turkcord.app'
const isDev = !app.isPackaged

// Aynı anda tek pencere: ikinci kez açılınca mevcut pencere öne gelir.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function iconPath(): string {
  return isDev ? join(__dirname, '../../resources/icon.png') : join(process.resourcesPath, 'icon.png')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    title: 'Turkcord',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(iconPath()),
    // Windows'ta gri sistem çubuğu yerine uygulamanın kendi başlık çubuğu; küçült/kapat düğmeleri yine Windows'un.
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay('light') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
  })

  // Windows açılışında başlatıldıysa tepside bekler.
  win.once('ready-to-show', () => {
    if (!startedHidden()) win.show()
  })
  hideOnClose(win)

  // Yeni pencere açılmaz; güvenli bağlantılar varsayılan tarayıcıda açılır.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Uygulama penceresi başka bir sayfaya yönlendirilemez.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault()
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
    }
  })

  win.webContents.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    if (params.linkURL && isSafeExternalUrl(params.linkURL)) {
      items.push({ label: 'Bağlantıyı aç', click: () => void shell.openExternal(params.linkURL) })
      items.push({ label: 'Bağlantıyı kopyala', click: () => clipboard.writeText(params.linkURL) })
      items.push({ type: 'separator' })
    }
    if (params.isEditable) {
      items.push(
        { label: 'Kes', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Kopyala', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Yapıştır', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Tümünü seç', role: 'selectAll' },
      )
    } else if (params.selectionText.trim()) {
      items.push({ label: 'Kopyala', role: 'copy' })
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function hardenSession(): void {
  const ses = session.defaultSession

  // Sadece gerekli izinler: mikrofon (sesli sohbet), bildirimler, panoya yazma.
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection'])
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = isTrustedUrl(webContents.getURL())
    if (permission === 'media') {
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      callback(trusted && types.every((t) => t === 'audio'))
      return
    }
    callback(trusted && allowed.has(permission))
  })
  ses.setPermissionCheckHandler((webContents, permission) => {
    return !!webContents && isTrustedUrl(webContents.getURL()) && allowed.has(permission)
  })
}

app.on('web-contents-created', (_event, contents) => {
  // <webview> etiketi kullanılmıyor; eklenmeye çalışılırsa engelle.
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

void app.whenReady().then(() => {
  app.setAppUserModelId(APP_ID)
  if (!isDev) Menu.setApplicationMenu(null)
  hardenSession()
  registerAuthStorage()
  registerWindowIpc(() => mainWindow)
  setupUpdater(() => mainWindow)
  setupDesktop(() => mainWindow, iconPath())
  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
