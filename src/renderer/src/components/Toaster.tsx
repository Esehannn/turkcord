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
            className={`anim-pop pointer-events-auto flex gap-3 rounded-lg border border-line bg-elevated p-3 text-sm shadow-pop ${t.action ? 'items-center' : 'items-start'}`}
          >
            <Icon className={`size-4 shrink-0 ${TONE[t.tone]} ${t.action ? '' : 'mt-0.5'}`} />
            <p className="flex-1 text-fg">{t.text}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  dismiss(t.id)
                  t.action?.run()
                }}
                className="h-7 shrink-0 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover"
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Kapat" onClick={() => dismiss(t.id)} className="shrink-0 text-faint hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
