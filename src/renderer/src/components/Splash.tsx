import { Logo } from './Logo'
import { Spinner } from './ui'

export function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-chat">
      <Logo size={72} className="animate-pulse" />
      <div className="flex items-center gap-2 text-muted">
        <Spinner className="size-4" />
        <span>Çay demleniyor…</span>
      </div>
    </div>
  )
}
