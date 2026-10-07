import { useEffect, useState } from 'react'
import { useProfiles } from '@/data/queries'
import { usePresence } from '@/stores/presence'

const VISIBLE_MS = 6000

export function TypingIndicator({ channelId }: { channelId: string }) {
  const typing = usePresence((s) => s.typing[channelId])
  const { data: profiles } = useProfiles()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!typing) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [typing])

  const names = Object.entries(typing ?? {})
    .filter(([, at]) => now - at < VISIBLE_MS)
    .map(([id]) => profiles?.get(id)?.display_name ?? 'Biri')

  let text = ''
  if (names.length === 1) text = `${names[0]} yazıyor…`
  else if (names.length === 2) text = `${names[0]} ve ${names[1]} yazıyor…`
  else if (names.length > 2) text = 'Birkaç kişi yazıyor…'

  return (
    <div className="h-5 px-5 text-xs text-muted" aria-live="polite">
      {text && (
        <span className="flex items-center gap-1.5">
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </span>
          <span className="font-medium">{text}</span>
        </span>
      )}
    </div>
  )
}
