import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'

// Menüler ve küçük açılır kutular. Hepsi sayfanın en üstüne (body) çizilir; böylece içinde durdukları
// kaydırılabilir listenin sınırına takılıp kesilmezler.

export type MenuItem = { label: string; icon: LucideIcon; show?: boolean; danger?: boolean; onClick: () => void }

const EDGE = 8
// Başlık çubuğunun altında kalsın.
const TOP_EDGE = 40

function useDismiss(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
}

// Verilen noktada açılır; pencerenin dışına taşacaksa içeri kaydırılır.
export function Floating({ x, y, onClose, className = '', children }: { x: number; y: number; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useDismiss(onClose)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(TOP_EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    })
  }, [x, y])

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        // Olay, menüyü açan öğeye geri tırmanıp menüyü yeniden açmasın.
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
      />
      <div
        ref={ref}
        style={pos}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        className={`anim-pop fixed z-50 rounded-lg border border-line bg-elevated shadow-pop ${className}`}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

// Sağ tık menüsü.
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const visible = items.filter((item) => item.show !== false)
  if (visible.length === 0) return null
  return (
    <Floating x={x} y={y} onClose={onClose} className="w-52 p-1.5">
      <div role="menu">
        {visible.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose()
              item.onClick()
            }}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-hover ${
              item.danger ? 'text-accent' : 'text-fg'
            }`}
          >
            {item.label}
            <item.icon className="size-4" />
          </button>
        ))}
      </div>
    </Floating>
  )
}
