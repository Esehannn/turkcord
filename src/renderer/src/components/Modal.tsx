import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { create } from 'zustand'
import { Button, IconButton } from './ui'

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'max-w-md',
  bare = false,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
  // Başlıksız ve boşluksuz: içerik pencerenin kenarlarına kadar uzanır (ör. profil kartının üst şeridi).
  bare?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal className={`anim-pop w-full ${width} overflow-hidden rounded-xl bg-elevated shadow-pop`}>
        {bare ? (
          <div className="relative max-h-[80vh] overflow-y-auto scroll-thin">
            <IconButton label="Kapat" onClick={onClose} className="absolute top-2.5 right-2.5 z-10 bg-black/25 text-white hover:bg-black/40 hover:text-white">
              <X className="size-5" />
            </IconButton>
            {children}
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 px-5 pt-5">
              <div>
                <h2 className="text-lg font-bold text-fg">{title}</h2>
                {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
              </div>
              <IconButton label="Kapat" onClick={onClose}>
                <X className="size-5" />
              </IconButton>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
          </>
        )}
        {footer && <div className="flex justify-end gap-2 bg-sidebar px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

// Onay penceresi: await confirmDialog({...}) ile kullanılır.
type ConfirmRequest = {
  title: string
  text: string
  confirmLabel?: string
  resolve: (ok: boolean) => void
}

const useConfirm = create<{ request: ConfirmRequest | null }>(() => ({ request: null }))

export function confirmDialog(options: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ request: { ...options, resolve } }))
}

export function ConfirmHost() {
  const request = useConfirm((s) => s.request)
  if (!request) return null
  const close = (ok: boolean) => {
    request.resolve(ok)
    useConfirm.setState({ request: null })
  }
  return (
    <Modal
      title={request.title}
      onClose={() => close(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Vazgeç
          </Button>
          <Button onClick={() => close(true)} autoFocus>
            {request.confirmLabel ?? 'Onayla'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{request.text}</p>
    </Modal>
  )
}
