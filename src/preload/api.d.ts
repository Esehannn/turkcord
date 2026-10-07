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
}

declare global {
  interface Window {
    // Electron dışında (ör. tarayıcıda geliştirme) tanımlı olmayabilir.
    turkcord?: TurkcordApi
  }
}
