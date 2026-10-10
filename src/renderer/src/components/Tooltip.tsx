import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Uygulamanın kendi ipuçları: `data-tip` taşıyan bir öğenin üstünde kısa süre durunca temaya uyan küçük bir
// etiket çıkar (Windows'un gri, gecikmeli kutusu yerine). `data-tip-side="right"` etiketi sağa açar.
// Tek bir dinleyici bütün uygulamaya yeter; öğelere ayrı ayrı bağlanmaz.

const DELAY_MS = 350
const GAP = 8

type Tip = { text: string; rect: DOMRect; side: 'top' | 'right' }

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: Element | null = null

    const hide = () => {
      clearTimeout(timer)
      current = null
      setTip(null)
      setPos(null)
    }
    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null
      if (el === current) return
      hide()
      const text = el?.getAttribute('data-tip')
      if (!el || !text) return
      current = el
      timer = setTimeout(() => {
        if (!el.isConnected) return
        setTip({ text, rect: el.getBoundingClientRect(), side: el.getAttribute('data-tip-side') === 'right' ? 'right' : 'top' })
      }, DELAY_MS)
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('wheel', hide, { capture: true, passive: true })
    window.addEventListener('blur', hide)
    document.documentElement.addEventListener('mouseleave', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('wheel', hide, { capture: true })
      window.removeEventListener('blur', hide)
      document.documentElement.removeEventListener('mouseleave', hide)
    }
  }, [])

  // Etiketin boyutu ölçülür; üstte yer yoksa alta, kenarlarda içeri kaydırılır.
  useLayoutEffect(() => {
    const el = ref.current
    if (!tip || !el) return
    const { width, height } = el.getBoundingClientRect()
    const { rect } = tip
    let left = tip.side === 'right' ? rect.right + GAP : rect.left + rect.width / 2 - width / 2
    let top = tip.side === 'right' ? rect.top + rect.height / 2 - height / 2 : rect.top - height - GAP
    if (tip.side === 'top' && top < 36) top = rect.bottom + GAP
    left = Math.max(6, Math.min(left, window.innerWidth - width - 6))
    top = Math.max(6, Math.min(top, window.innerHeight - height - 6))
    setPos({ left, top })
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
      className="anim-fade pointer-events-none fixed z-[90] max-w-xs rounded-md bg-tip px-2 py-1 text-xs font-semibold whitespace-pre-line text-tip-text shadow-pop"
    >
      {tip.text}
    </div>,
    document.body,
  )
}
