import { X } from 'lucide-react'
import { useBanners } from '@/lib/notify'
import { Avatar } from './Avatar'

// Pencere öndeyken gelen bildirimler: sağ üstte, tıklanınca ilgili sohbete götüren kartlar.
export function NotificationCards() {
  const banners = useBanners((s) => s.banners)
  const dismiss = useBanners((s) => s.dismiss)
  if (banners.length === 0) return null
  return (
    <div className="pointer-events-none fixed top-12 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {banners.map((b) => (
        <div
          key={b.id}
          className="anim-slide pointer-events-auto flex items-start gap-3 rounded-lg border border-line border-l-4 border-l-accent bg-elevated p-3 shadow-pop"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
            onClick={() => {
              dismiss(b.id)
              b.onClick?.()
            }}
          >
            {b.avatar && <Avatar name={b.avatar.name} path={b.avatar.path} size={36} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-fg">{b.title}</span>
              <span className="line-clamp-2 block text-sm break-words text-muted">{b.body}</span>
            </span>
          </button>
          <button type="button" aria-label="Kapat" onClick={() => dismiss(b.id)} className="text-faint hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
