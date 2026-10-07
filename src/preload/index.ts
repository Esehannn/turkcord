import { contextBridge, ipcRenderer } from 'electron'
import type { TurkcordApi } from './api'

// Arayüze açılan küçük ve sınırlı köprü. Node.js veya Electron'un kendisi arayüze açılmaz.
const api: TurkcordApi = {
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),
  authStorage: {
    getItem: (key) => ipcRenderer.invoke('auth-storage:get', key),
    setItem: (key, value) => ipcRenderer.invoke('auth-storage:set', key, value),
    removeItem: (key) => ipcRenderer.invoke('auth-storage:remove', key),
  },
  flashWindow: () => ipcRenderer.send('window:flash'),
  setBadge: (count, dataUrl) => ipcRenderer.send('window:badge', count, dataUrl),
  idleSeconds: () => ipcRenderer.invoke('app:idle-seconds'),
  updateReady: () => ipcRenderer.invoke('guncelleme:durum'),
  onUpdateReady: (callback) => {
    const listener = (_event: unknown, version: unknown) => {
      if (typeof version === 'string') callback(version)
    }
    ipcRenderer.on('guncelleme:hazir', listener)
    return () => ipcRenderer.removeListener('guncelleme:hazir', listener)
  },
  installUpdate: () => ipcRenderer.invoke('guncelleme:kur'),
}

contextBridge.exposeInMainWorld('turkcord', api)
