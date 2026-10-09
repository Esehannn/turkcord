import { contextBridge, ipcRenderer } from 'electron'
import type { TurkcordApi, UpdateStage } from './api'

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
  updateStage: () => ipcRenderer.invoke('guncelleme:asama-oku'),
  onUpdateStage: (callback) => {
    const listener = (_event: unknown, stage: unknown) => {
      if (stage && typeof stage === 'object' && typeof (stage as { phase?: unknown }).phase === 'string') callback(stage as UpdateStage)
    }
    ipcRenderer.on('guncelleme:asama', listener)
    return () => ipcRenderer.removeListener('guncelleme:asama', listener)
  },
  desktopSettings: () => ipcRenderer.invoke('masaustu:ayarlar'),
  setDesktopSettings: (patch) => ipcRenderer.invoke('masaustu:ayarla', patch),
  setShortcuts: (shortcuts) => ipcRenderer.invoke('kisayol:ayarla', shortcuts),
  onShortcut: (callback) => {
    const listener = (_event: unknown, command: unknown) => {
      if (command === 'mute' || command === 'deafen') callback(command)
    }
    ipcRenderer.on('kisayol:basildi', listener)
    return () => ipcRenderer.removeListener('kisayol:basildi', listener)
  },
  reportVoiceStatus: (status) => ipcRenderer.send('ses:durum', status),
  setTheme: (theme, accent) => ipcRenderer.send('pencere:tema', theme, accent),
  requestAttention: () => ipcRenderer.send('pencere:dikkat'),
  showWindow: () => ipcRenderer.send('pencere:goster'),
}

contextBridge.exposeInMainWorld('turkcord', api)
