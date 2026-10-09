// Ön yükleme betiğinin arayüze açtığı köprünün tipi (window.turkcord).
export interface TurkcordApi {
  platform: string
  version: () => Promise<string | null>
  authStorage: {
    getItem: (key: string) => Promise<string | null>
    setItem: (key: string, value: string) => Promise<void>
    removeItem: (key: string) => Promise<void>
  }
  flashWindow: () => void
  setBadge: (count: number, dataUrl: string | null) => void
  // Bilgisayarın kaç saniyedir kullanılmadığı (Boşta durumu için).
  idleSeconds: () => Promise<number>
  // Otomatik güncelleme: indirilen yeni sürüm hazır olunca haber verir.
  updateReady: () => Promise<string | null>
  onUpdateReady: (callback: (version: string) => void) => () => void
  installUpdate: () => Promise<void>
  // Açılıştaki güncelleme denetiminin aşaması (denetleniyor, indiriliyor, hazır…).
  updateStage: () => Promise<UpdateStage | null>
  onUpdateStage: (callback: (stage: UpdateStage) => void) => () => void
  // Masaüstü: tepsiye küçültme, Windows ile başlatma, her yerde çalışan kısayollar.
  desktopSettings: () => Promise<DesktopSettings | null>
  setDesktopSettings: (patch: Partial<DesktopSettings>) => Promise<DesktopSettings | null>
  setShortcuts: (shortcuts: { mute: string | null; deafen: string | null }) => Promise<{ mute: boolean; deafen: boolean } | null>
  onShortcut: (callback: (command: 'mute' | 'deafen') => void) => () => void
  reportVoiceStatus: (status: { inVoice: boolean; muted: boolean; deafened: boolean }) => void
  // Başlık çubuğundaki Windows düğmelerinin rengi temaya ve vurgu rengine uyar.
  setTheme: (theme: 'light' | 'dark', accent?: string) => void
  // Gelen arama: pencere tepsideyse odağı çalmadan gösterir, görev çubuğunda yanıp söner.
  requestAttention: () => void
  // Bildirime tıklanınca pencereyi öne getirir.
  showWindow: () => void
}

export type DesktopSettings = { closeToTray: boolean; openAtLogin: boolean }

export type UpdateStage = {
  phase: 'checking' | 'downloading' | 'ready' | 'none' | 'error'
  // İndirme yüzdesi (0-100).
  percent: number
  version: string | null
  // İndirme bitince açılış ekranı kendiliğinden kurup yeniden başlatsın mı?
  autoInstall: boolean
}

declare global {
  interface Window {
    // Electron dışında (ör. tarayıcıda geliştirme) tanımlı olmayabilir.
    turkcord?: TurkcordApi
  }
}
