import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { useToasts } from '@/stores/toast'

const ICON = { info: Info, success: CheckCircle2, error: TriangleAlert }
const TONE = { info: 'text-fg', success: 'text-success', error: 'text-accent' }

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.tone]
        return (
          <div
            key={t.id}
            className="anim-pop pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-elevated p-3 text-sm shadow-pop"
          >
            <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[t.tone]}`} />
            <p className="flex-1 text-fg">{t.text}</p>
            <button type="button" aria-label="Kapat" onClick={() => dismiss(t.id)} className="text-faint hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
