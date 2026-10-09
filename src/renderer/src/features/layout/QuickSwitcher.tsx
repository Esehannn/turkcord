import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Search } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { useActions } from '@/data/actions'
import { useAllChannels, useDms, useServers } from '@/data/queries'
import { initials } from '@/lib/format'
import { matchScore } from '@/lib/search'
import type { MessageRow } from '@/lib/database.types'
import { useSession } from '@/stores/session'
import { useUi, type View } from '@/stores/ui'

// Gidilebilecek yer: özel mesaj, sunucudaki yazı kanalı ya da sunucunun kendisi.
export type Destination = {
  key: string
  label: string
  sub: string
  icon: ReactNode
  view: View
  // Mesaj gönderilebilen yerlerde kanal kimliği (sunucunun kendisinde yok).
  channelId: string | null
}

const MAX_RESULTS = 8

// Hızlı geçiş ve mesaj iletme aynı listeyi kullanır. Kanallar ancak pencere açılınca yüklenir.
export function useDestinations(query: string, withServers: boolean): Destination[] {
  const { data: dms = [] } = useDms()
  const { data: servers = [] } = useServers()
  const { data: channels = [] } = useAllChannels(true)

  const all = useMemo(() => {
    const serverName = new Map(servers.map((s) => [s.id, s.name]))
    const list: Destination[] = dms.map((dm) => ({
      key: `dm:${dm.channel_id}`,
      label: dm.display_name,
      sub: `@${dm.username}`,
      icon: <Avatar name={dm.display_name} path={dm.avatar_path} size={24} />,
      view: { kind: 'dm', channelId: dm.channel_id },
      channelId: dm.channel_id,
    }))
    for (const c of channels) {
      if (c.kind !== 'text' || !c.server_id) continue
      list.push({
        key: `ch:${c.id}`,
        label: c.name ?? 'kanal',
        sub: serverName.get(c.server_id) ?? '',
        icon: <Hash className="size-5 text-faint" />,
        view: { kind: 'server', serverId: c.server_id, channelId: c.id },
        channelId: c.id,
      })
    }
    if (withServers) {
      for (const s of servers) {
        list.push({
          key: `srv:${s.id}`,
          label: s.name,
          sub: 'Sunucu',
          icon: <span className="grid size-6 place-items-center rounded-md bg-accent text-[10px] font-bold text-white">{initials(s.name)}</span>,
          view: { kind: 'server', serverId: s.id, channelId: null },
          channelId: null,
        })
      }
    }
    return list
  }, [channels, dms, servers, withServers])

  return useMemo(
    () =>
      all
        .map((item, order) => ({ item, order, score: Math.max(matchScore(item.label, query), query.trim() ? matchScore(item.sub.replace(/^@/, ''), query) - 1 : 0) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, MAX_RESULTS)
        .map((r) => r.item),
    [all, query],
  )
}

// Arama kutusu + sonuç listesi; ok tuşları ve Enter ile kullanılır.
function Picker({ title, placeholder, withServers, onPick, onClose }: { title: string; placeholder: string; withServers: boolean; onPick: (d: Destination) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = useDestinations(query, withServers)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => setIndex(0), [query])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') return onClose()
    if (results.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onPick(results[Math.min(index, results.length - 1)])
    }
  }

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 flex justify-center bg-black/55 px-4 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal aria-label={title} className="anim-pop h-fit w-full max-w-lg overflow-hidden rounded-xl bg-elevated shadow-pop" onKeyDown={onKeyDown}>
        <p className="px-4 pt-3 text-xs font-bold tracking-wide text-faint uppercase">{title}</p>
        <div className="flex items-center gap-2 px-4 py-2">
          <Search className="size-5 shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="h-10 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint"
          />
        </div>
        <div className="border-t border-line p-1.5" role="listbox">
          {results.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">Eşleşen bir sohbet ya da kanal yok.</p>}
          {results.map((d, i) => (
            <button
              key={d.key}
              type="button"
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onPick(d)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${i === index ? 'bg-selected' : ''}`}
            >
              <span className="grid size-6 shrink-0 place-items-center">{d.icon}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{d.label}</span>
              <span className="shrink-0 truncate text-xs text-faint">{d.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Ctrl+K: yazmaya başla, sohbete ya da kanala atla.
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const setView = useUi((s) => s.setView)
  return (
    <Picker
      title="Hızlı geçiş"
      placeholder="Nereye gitmek istiyorsun?"
      withServers
      onClose={onClose}
      onPick={(d) => {
        setView(d.view)
        onClose()
      }}
    />
  )
}

// Mesajı başka bir sohbete ya da kanala iletir.
export function ForwardModal({ message, onClose }: { message: Pick<MessageRow, 'id' | 'content' | 'attachments'>; onClose: () => void }) {
  const me = useSession((s) => s.session?.user.id) ?? ''
  const actions = useActions()
  const setView = useUi((s) => s.setView)
  const busy = useRef(false)
  return (
    <Picker
      title="Mesajı ilet"
      placeholder="Kime ya da hangi kanala?"
      withServers={false}
      onClose={onClose}
      onPick={(d) => {
        if (!d.channelId || busy.current) return
        busy.current = true
        actions
          .forwardMessage(message, d.channelId, me)
          .then(() => {
            setView(d.view)
            onClose()
          })
          .catch(() => (busy.current = false))
      }}
    />
  )
}
