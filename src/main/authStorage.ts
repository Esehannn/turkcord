import { app, ipcMain, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTrustedSender } from './security'

// Oturum anahtarları tarayıcı deposunda değil, Windows'un kullanıcıya özel şifrelemesiyle
// (DPAPI, Electron safeStorage) korunan bir dosyada tutulur.

const MAX_KEY = 200
const MAX_VALUE = 64 * 1024

let cache: Record<string, string> | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'oturum.bin')
}

function load(): Record<string, string> {
  if (cache) return cache
  cache = {}
  try {
    if (existsSync(filePath())) {
      const raw = readFileSync(filePath())
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
      const parsed: unknown = JSON.parse(json)
      if (parsed && typeof parsed === 'object') cache = parsed as Record<string, string>
    }
  } catch (error) {
    console.warn('Oturum dosyası okunamadı, yeniden giriş gerekecek.', error)
    cache = {}
  }
  return cache
}

function persist(): void {
  const json = JSON.stringify(cache ?? {})
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('İşletim sistemi şifrelemesi kullanılamıyor; oturum şifrelenmeden saklanıyor.')
  }
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')
  const tmp = `${filePath()}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, filePath())
}

function validKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY
}

export function registerAuthStorage(): void {
  ipcMain.handle('auth-storage:get', (event, key: unknown) => {
    if (!isTrustedSender(event) || !validKey(key)) return null
    return load()[key] ?? null
  })

  ipcMain.handle('auth-storage:set', (event, key: unknown, value: unknown) => {
    if (!isTrustedSender(event) || !validKey(key) || typeof value !== 'string' || value.length > MAX_VALUE) return
    load()[key] = value
    persist()
  })

  ipcMain.handle('auth-storage:remove', (event, key: unknown) => {
    if (!isTrustedSender(event) || !validKey(key)) return
    delete load()[key]
    persist()
  })
}
