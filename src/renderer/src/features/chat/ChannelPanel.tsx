import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pin, PinOff, Search, X } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { IconButton, Spinner } from '@/components/ui'
import { useActions } from '@/data/actions'
import { SEARCH_LIMIT, searchMessages, usePins, useProfiles } from '@/data/queries'
import type { MessageRow } from '@/lib/database.types'
import { fileKind } from '@/lib/files'
import { formatMessageTime } from '@/lib/format'
import { snippet, splitHighlight } from '@/lib/search'
import { toast } from '@/stores/toast'

const MIN_QUERY = 2
const SEARCH_DELAY_MS = 350

// Sohbet başlığının altında açılan kutu: kanalda arama ya da sabitlenmiş mesajlar.
// İçerik ancak kutu açılınca yüklenir.
function Panel({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="anim-pop absolute top-2 right-3 z-20 flex max-h-[75%] w-[26rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-line bg-elevated shadow-pop">
      <div className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-fg">{title}</div>
        <IconButton label="Kapat" className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {children}
    </div>
  )
}

function bodyText(message: MessageRow): string {
  if (message.kind === 'poll') return `📊 ${message.content}`
  if (message.content) return message.content
  const first = message.attachments[0]
  if (!first) return ''
  return fileKind(first) === 'image' ? '🖼️ Görsel' : `📎 ${first.name ?? 'Dosya'}`
}

function Row({ message, query, onJump, action }: { message: MessageRow; query?: string; onJump: (message: MessageRow) => void; action?: ReactNode }) {
  const { data: profiles } = useProfiles()
  const author = message.author_id ? profiles?.get(message.author_id) : undefined
  const name = author?.display_name ?? 'Silinmiş kullanıcı'
  const text = bodyText(message)
  return (
    <div className="group relative">
      <button type="button" onClick={() => onJump(message)} className="flex w-full gap-2.5 rounded-md px-2 py-2 text-left hover:bg-hover">
        <Avatar name={name} path={author?.avatar_path} size={28} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-fg">{name}</span>
            <span className="shrink-0 text-[11px] text-faint">{formatMessageTime(message.created_at)}</span>
          </span>
          <span className="line-clamp-3 text-sm break-words text-muted">
            {query
              ? splitHighlight(snippet(text, query), query).map((part, i) =>
                  part.hit ? (
                    <mark key={i} className="rounded bg-accent-soft px-0.5 font-semibold text-fg">
                      {part.text}
                    </mark>
                  ) : (
                    part.text
                  ),
                )
              : snippet(text, '', 90)}
          </span>
        </span>
      </button>
      {action && <div className="absolute top-1.5 right-1.5 hidden group-hover:block">{action}</div>}
    </div>
  )
}

export function SearchPanel({ channelId, onJump, onClose }: { channelId: string; onJump: (message: MessageRow) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MessageRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  // Yazmayı bırakınca aranır; eski bir isteğin geç gelen cevabı yenisinin üstüne yazmaz.
  useEffect(() => {
    const text = query.trim()
    if (text.length < MIN_QUERY) {
      setResults(null)
      setLoading(false)
      return
    }
    let stale = false
    setLoading(true)
    const timer = setTimeout(() => {
      searchMessages(channelId, text)
        .then((rows) => !stale && setResults(rows))
        .catch((error) => !stale && toast.error(error))
        .finally(() => !stale && setLoading(false))
    }, SEARCH_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [channelId, query])

  return (
    <Panel
      onClose={onClose}
      title={
        <>
          <Search className="size-4 shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Bu sohbette ara"
            className="h-8 min-w-0 flex-1 bg-transparent font-normal text-fg outline-none placeholder:text-faint"
          />
          {loading && <Spinner className="size-4 text-faint" />}
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 scroll-thin">
        {results === null ? (
          <p className="px-3 py-5 text-center text-sm text-muted">Aramak için en az {MIN_QUERY} harf yaz.</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-5 text-center text-sm text-muted">Sonuç bulunamadı.</p>
        ) : (
          <>
            {results.map((m) => (
              <Row key={m.id} message={m} query={query} onJump={onJump} />
            ))}
            {results.length >= SEARCH_LIMIT && <p className="px-3 py-2 text-center text-xs text-faint">En yeni {SEARCH_LIMIT} sonuç gösteriliyor. Daraltmak için daha fazla yaz.</p>}
          </>
        )}
      </div>
    </Panel>
  )
}

export function PinsPanel({ channelId, canPin, onJump, onClose }: { channelId: string; canPin: boolean; onJump: (message: MessageRow) => void; onClose: () => void }) {
  const pins = usePins(channelId, true)
  const actions = useActions()
  return (
    <Panel
      onClose={onClose}
      title={
        <>
          <Pin className="size-4 shrink-0 text-faint" /> Sabitlenmiş mesajlar
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 scroll-thin">
        {pins.isLoading ? (
          <div className="grid place-items-center py-6 text-muted">
            <Spinner />
          </div>
        ) : !pins.data?.length ? (
          <p className="px-3 py-5 text-center text-sm text-muted">
            Burada henüz sabitlenmiş mesaj yok.{canPin ? ' Bir mesaja sağ tıklayıp "Sabitle" diyebilirsin.' : ''}
          </p>
        ) : (
          pins.data.map((m) => (
            <Row
              key={m.id}
              message={m}
              onJump={onJump}
              action={
                canPin ? (
                  <IconButton label="Sabitlemeyi kaldır" className="size-7 bg-elevated shadow-pop" onClick={() => void actions.setPinned(m, false).catch(() => undefined)}>
                    <PinOff className="size-3.5" />
                  </IconButton>
                ) : undefined
              }
            />
          ))
        )}
      </div>
    </Panel>
  )
}
