import type { ReactNode } from 'react'
import { Logo } from './Logo'

// Açılış ve yükleme ekranı: logodaki yıldız döner, altında o an ne yapıldığı yazar
// ("Güncellemeler denetleniyor…", "Güncelleme indiriliyor…", "Sohbetler yükleniyor…").
export function Splash({ text = 'Yükleniyor…', progress, children }: { text?: string; progress?: number; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-chat" role="status" aria-live="polite">
      <Logo size={96} spin />
      <p className="text-sm font-medium text-muted">{text}</p>
      <div className="h-1.5 w-56 overflow-hidden rounded-full bg-input" style={{ visibility: progress === undefined ? 'hidden' : 'visible' }}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, progress ?? 0))}%` }} />
      </div>
      <div className="h-6 text-xs">{children}</div>
    </div>
  )
}
