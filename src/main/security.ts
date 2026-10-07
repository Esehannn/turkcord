import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Uygulamanın kendi sayfası mı? (Geliştirmede Vite sunucusu, paketlenmişte yerel index.html.)
export function isTrustedUrl(url: string): boolean {
  if (!url) return false
  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  if (devUrl) {
    try {
      return new URL(url).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  const indexUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href
  return url.split('#')[0].split('?')[0] === indexUrl
}

// Dışarıda (varsayılan tarayıcıda) açılmasına izin verilen bağlantılar: sadece http/https.
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

// IPC mesajının uygulamanın kendi sayfasından geldiğini doğrular.
export function isTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  return !!frame && frame === event.sender.mainFrame && isTrustedUrl(frame.url)
}
