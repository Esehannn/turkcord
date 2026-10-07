import { app, globalShortcut, ipcMain, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTrustedSender } from './security'

// Masaüstü özellikleri: sistem tepsisi, Windows ile başlatma ve her yerde çalışan kısayollar.

export type DesktopSettings = { closeToTray: boolean; openAtLogin: boolean }
type Shortcuts = { mute: string | null; deafen: string | null }
type VoiceStatus = { inVoice: boolean; muted: boolean; deafened: boolean }

const HIDDEN_ARG = '--gizli'
const settingsFile = () => join(app.getPath('userData'), 'masaustu-ayarlari.json')

let settings: DesktopSettings = { closeToTray: true, openAtLogin: false }
let tray: Tray | null = null
let quitting = false
let voice: VoiceStatus = { inVoice: false, muted: false, deafened: false }

function loadSettings(): void {
  try {
    const saved = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<DesktopSettings>
    if (typeof saved.closeToTray === 'boolean') settings.closeToTray = saved.closeToTray
  } catch {
    // İlk açılış: varsayılanlar.
  }
  settings.openAtLogin = app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin
}

function saveSettings(): void {
  try {
    writeFileSync(settingsFile(), JSON.stringify({ closeToTray: settings.closeToTray }))
  } catch {
    // Kaydedilemezse bu oturumla sınırlı kalır.
  }
}

// Windows açılışında başlatıldıysa pencere gösterilmez, tepside bekler.
export function startedHidden(): boolean {
  return process.argv.includes(HIDDEN_ARG)
}

export function isQuitting(): boolean {
  return quitting
}

function showWindow(getWindow: () => BrowserWindow | null): void {
  const win = getWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function sendCommand(getWindow: () => BrowserWindow | null, command: 'mute' | 'deafen'): void {
  getWindow()?.webContents.send('kisayol:basildi', command)
}

function refreshTray(getWindow: () => BrowserWindow | null): void {
  if (!tray) return
  tray.setToolTip(voice.inVoice ? `Turkcord — sesli sohbette${voice.muted ? ' (mikrofon kapalı)' : ''}` : 'Turkcord')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Turkcord'u aç", click: () => showWindow(getWindow) },
      { type: 'separator' },
      { label: 'Mikrofonu kapat', type: 'checkbox', checked: voice.muted, click: () => sendCommand(getWindow, 'mute') },
      { label: 'Sağırlaştır', type: 'checkbox', checked: voice.deafened, click: () => sendCommand(getWindow, 'deafen') },
      { type: 'separator' },
      {
        label: 'Windows açılınca başlat',
        type: 'checkbox',
        checked: settings.openAtLogin,
        click: (item) => setOpenAtLogin(item.checked),
      },
      { label: 'Çıkış', click: () => app.quit() },
    ]),
  )
}

function setOpenAtLogin(value: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: value, args: [HIDDEN_ARG] })
  settings.openAtLogin = value
}

function registerShortcuts(shortcuts: Shortcuts, getWindow: () => BrowserWindow | null): Record<keyof Shortcuts, boolean> {
  globalShortcut.unregisterAll()
  const result = { mute: true, deafen: true }
  for (const key of ['mute', 'deafen'] as const) {
    const accelerator = shortcuts[key]
    if (!accelerator) continue
    try {
      result[key] = globalShortcut.register(accelerator, () => sendCommand(getWindow, key))
    } catch {
      result[key] = false
    }
  }
  return result
}

// Kısayol metni güvenli mi? (Ctrl+Shift+M gibi; arayüzden gelen her şey kabul edilmez.)
function validAccelerator(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && /^((Ctrl|Alt|Shift)\+){0,3}([A-Z0-9]|F\d{1,2}|Num\d)$/.test(value)
}

export function setupDesktop(getWindow: () => BrowserWindow | null, iconPath: string): void {
  loadSettings()

  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.on('click', () => showWindow(getWindow))
  refreshTray(getWindow)

  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())

  ipcMain.handle('masaustu:ayarlar', (event) => (isTrustedSender(event) ? { ...settings } : null))
  ipcMain.handle('masaustu:ayarla', (event, patch: unknown) => {
    if (!isTrustedSender(event) || typeof patch !== 'object' || !patch) return null
    const p = patch as Partial<DesktopSettings>
    if (typeof p.closeToTray === 'boolean') settings.closeToTray = p.closeToTray
    if (typeof p.openAtLogin === 'boolean') setOpenAtLogin(p.openAtLogin)
    saveSettings()
    refreshTray(getWindow)
    return { ...settings }
  })
  ipcMain.handle('kisayol:ayarla', (event, shortcuts: unknown) => {
    if (!isTrustedSender(event) || typeof shortcuts !== 'object' || !shortcuts) return null
    const s = shortcuts as Record<string, unknown>
    return registerShortcuts(
      { mute: validAccelerator(s.mute) ? s.mute : null, deafen: validAccelerator(s.deafen) ? s.deafen : null },
      getWindow,
    )
  })
  ipcMain.on('ses:durum', (event, status: unknown) => {
    if (!isTrustedSender(event) || typeof status !== 'object' || !status) return
    const s = status as Record<string, unknown>
    voice = { inVoice: s.inVoice === true, muted: s.muted === true, deafened: s.deafened === true }
    refreshTray(getWindow)
  })
}

// Pencere kapatılınca uygulama kapanmasın, tepsiye insin (ayar açıksa).
export function hideOnClose(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (quitting || !settings.closeToTray || !tray) return
    event.preventDefault()
    win.hide()
  })
}
