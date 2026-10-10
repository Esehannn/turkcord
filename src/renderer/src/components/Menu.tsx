import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'

// Menüler ve küçük açılır kutular. Hepsi sayfanın en üstüne (body) çizilir; böylece içinde durdukları
// kaydırılabilir listenin sınırına takılıp kesilmezler.

// items verilirse tıklayınca alt menü açılır (ör. "Sessize al" → süre seçenekleri).
export type MenuItem = { label: string; icon: LucideIcon; show?: boolean; danger?: boolean; onClick?: () => void; items?: MenuItem[] }

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
// above: kutu noktanın üstüne açılır (alt kenarı y'ye gelir); üstte yer yoksa flipY verilmişse oradan aşağı açılır.
// align 'end': sağ kenarı x'e gelir.
export function Floating({
  x,
  y,
  onClose,
  above = false,
  flipY,
  align = 'start',
  className = '',
  children,
}: {
  x: number
  y: number
  onClose: () => void
  above?: boolean
  flipY?: number
  align?: 'start' | 'end'
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useDismiss(onClose)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = align === 'end' ? x - width : x
    let top = above ? y - height : y
    if (above && top < TOP_EDGE && flipY !== undefined) top = flipY
    setPos({
      left: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
      top: Math.max(TOP_EDGE, Math.min(top, window.innerHeight - height - EDGE)),
    })
  }, [x, y, above, flipY, align, children])

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
        // Yeri ölçülene kadar görünmez; yanlış yerde bir an belirip zıplamaz.
        style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
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
  // Açık alt menü (varsa); menünün içeriği onunla değişir.
  const [sub, setSub] = useState<MenuItem | null>(null)
  const visible = (sub?.items ?? items).filter((item) => item.show !== false)
  if (visible.length === 0) return null
  return (
    <Floating x={x} y={y} onClose={onClose} className="w-56 p-1.5">
      <div role="menu">
        {sub && (
          <button
            type="button"
            onClick={() => setSub(null)}
            className="mb-1 flex w-full items-center gap-1.5 rounded-md border-b border-line px-1.5 pt-1 pb-2 text-xs font-bold tracking-wide text-faint uppercase hover:text-fg"
          >
            <ChevronLeft className="size-3.5" />
            {sub.label}
          </button>
        )}
        {visible.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              if (item.items) return setSub(item)
              onClose()
              item.onClick?.()
            }}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-hover ${
              item.danger ? 'text-accent' : 'text-fg'
            }`}
          >
            {item.label}
            {item.items ? <ChevronRight className="size-4 text-faint" /> : <item.icon className="size-4" />}
          </button>
        ))}
      </div>
    </Floating>
  )
}
