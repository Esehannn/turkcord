import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CornerUpLeft, Pencil, SmilePlus, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { confirmDialog } from '@/components/Modal'
import { IconButton, TextArea } from '@/components/ui'
import { useActions } from '@/data/actions'
import type { ChatMessage } from '@/data/queries'
import type { ProfileRow } from '@/lib/database.types'
import { formatMessageTime, formatTime } from '@/lib/format'
import { signedAttachmentUrl } from '@/lib/images'
import { mentionsUser } from '@/lib/markdown'
import { useUi } from '@/stores/ui'
import { EmojiPicker, QUICK_REACTIONS } from './EmojiPicker'
import { MessageContent } from './MessageContent'

type Props = {
  message: ChatMessage
  grouped: boolean
  me: ProfileRow
  author: ProfileRow | undefined
  replied: ChatMessage | undefined
  repliedAuthor: ProfileRow | undefined
  canModerate: boolean
  canPost: boolean
  editing: boolean
  onEdit: (id: string | null) => void
  onReply: (message: ChatMessage) => void
  profileName: (id: string) => string
  // Yazarın sunucu rolünün rengi.
  nameColor?: string
}

export const MessageItem = memo(function MessageItem({
  message,
  grouped,
  me,
  author,
  replied,
  repliedAuthor,
  canModerate,
  canPost,
  editing,
  onEdit,
  onReply,
  profileName,
  nameColor,
}: Props) {
  const actions = useActions()
  const openModal = useUi((s) => s.openModal)
  const [picker, setPicker] = useState(false)
  const mine = message.author_id === me.id
  const mentioned = !mine && mentionsUser(message.content, me.username)
  const name = author?.display_name ?? 'Silinmiş kullanıcı'
  const showHeader = !grouped || !!message.reply_to

  const reactionGroups = groupReactions(message.reactions, me.id)

  const react = (emoji: string) => {
    setPicker(false)
    const existing = message.reactions.find((r) => r.emoji === emoji && r.user_id === me.id)
    void actions.toggleReaction(message.id, emoji, me.id, existing?.id)
  }

  const remove = async () => {
    if (await confirmDialog({ title: 'Mesajı sil', text: 'Bu mesaj herkes için silinecek.', confirmLabel: 'Sil' })) {
      void actions.deleteMessage(message.id)
    }
  }

  return (
    <div
      id={`mesaj-${message.id}`}
      className={`group relative px-4 ${showHeader ? 'mt-3 pt-1' : ''} py-0.5 ${
        mentioned ? 'border-l-2 border-accent bg-mention' : 'border-l-2 border-transparent hover:bg-hover'
      }`}
    >
      {message.reply_to && (
        <button
          type="button"
          onClick={() => document.getElementById(`mesaj-${message.reply_to}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="mb-0.5 ml-12 flex max-w-full items-center gap-1.5 text-xs text-muted hover:text-fg"
        >
          <CornerUpLeft className="size-3.5 shrink-0" />
          {replied ? (
            <>
              <span className="font-semibold">{repliedAuthor?.display_name ?? 'Silinmiş kullanıcı'}</span>
              <span className="truncate">{replied.content || '📎 Görsel'}</span>
            </>
          ) : (
            <span className="italic">Yanıtlanan mesaj yüklenmedi ya da silindi</span>
          )}
        </button>
      )}

      <div className="flex gap-3">
        <div className="w-10 shrink-0">
          {showHeader ? (
            <button type="button" onClick={() => author && openModal({ kind: 'profile', userId: author.id })}>
              <Avatar name={name} path={author?.avatar_path} size={40} />
            </button>
          ) : (
            <span className="block pt-1 text-right text-[10px] text-faint opacity-0 group-hover:opacity-100">
              {formatTime(message.created_at)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {showHeader && (
            <div className="flex items-baseline gap-2">
              <button
                type="button"
                onClick={() => author && openModal({ kind: 'profile', userId: author.id })}
                className="font-semibold text-fg hover:underline"
                style={nameColor ? { color: nameColor } : undefined}
              >
                {name}
              </button>
              <span className="text-xs text-faint">{formatMessageTime(message.created_at)}</span>
            </div>
          )}

          {editing ? (
            <EditBox message={message} onDone={() => onEdit(null)} />
          ) : (
            message.content && (
              <div className="flex flex-wrap items-baseline gap-x-1">
                <MessageContent content={message.content} me={me.username} />
                {message.edited_at && <span className="text-[11px] text-faint">(düzenlendi)</span>}
              </div>
            )
          )}

          {message.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {message.attachments.map((a) => (
                <AttachmentImage key={a.path} path={a.path} width={a.width} height={a.height} />
              ))}
            </div>
          )}

          {reactionGroups.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {reactionGroups.map((g) => (
                <button
                  key={g.emoji}
                  type="button"
                  disabled={!canPost}
                  title={g.users.map(profileName).join(', ')}
                  onClick={() => react(g.emoji)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors ${
                    g.mine ? 'border-accent bg-accent-soft text-fg' : 'border-line bg-input text-muted hover:border-faint'
                  }`}
                >
                  <span>{g.emoji}</span>
                  <span className="text-xs font-semibold">{g.users.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!editing && canPost && (
        <div className="absolute -top-4 right-4 hidden items-center rounded-md border border-line bg-elevated shadow-pop group-hover:flex">
          {QUICK_REACTIONS.slice(0, 4).map((emoji) => (
            <button key={emoji} type="button" onClick={() => react(emoji)} className="grid size-8 place-items-center text-base hover:bg-hover">
              {emoji}
            </button>
          ))}
          <div className="relative">
            <IconButton label="Tepki ekle" onClick={() => setPicker(true)}>
              <SmilePlus className="size-4" />
            </IconButton>
            {picker && <EmojiPicker onPick={react} onClose={() => setPicker(false)} />}
          </div>
          <IconButton label="Yanıtla" onClick={() => onReply(message)}>
            <CornerUpLeft className="size-4" />
          </IconButton>
          {mine && (
            <IconButton label="Düzenle" onClick={() => onEdit(message.id)}>
              <Pencil className="size-4" />
            </IconButton>
          )}
          {(mine || canModerate) && (
            <IconButton label="Sil" className="hover:text-accent" onClick={() => void remove()}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      )}
    </div>
  )
})

function groupReactions(reactions: ChatMessage['reactions'], me: string) {
  const map = new Map<string, { emoji: string; users: string[]; mine: boolean }>()
  for (const r of reactions) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, users: [], mine: false }
    g.users.push(r.user_id)
    if (r.user_id === me) g.mine = true
    map.set(r.emoji, g)
  }
  return [...map.values()]
}

function EditBox({ message, onDone }: { message: ChatMessage; onDone: () => void }) {
  const [value, setValue] = useState(message.content)
  const ref = useRef<HTMLTextAreaElement>(null)
  const actions = useActions()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const save = async () => {
    const text = value.trim()
    if (!text && message.attachments.length === 0) return
    if (text !== message.content) {
      try {
        await actions.editMessage(message.id, text)
      } catch {
        return
      }
    }
    onDone()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') onDone()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void save()
    }
  }

  return (
    <div className="mt-1">
      <TextArea ref={ref} rows={Math.min(8, value.split('\n').length + 1)} value={value} maxLength={4000} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} />
      <p className="mt-1 text-xs text-faint">
        Kaydetmek için <kbd className="font-semibold">Enter</kbd>, vazgeçmek için <kbd className="font-semibold">Esc</kbd>
      </p>
    </div>
  )
}

function AttachmentImage({ path, width, height }: { path: string; width?: number; height?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    void signedAttachmentUrl(path).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [path])

  const maxW = 400
  const maxH = 300
  const scale = width && height ? Math.min(1, maxW / width, maxH / height) : 1
  const style = width && height ? { width: Math.round(width * scale), height: Math.round(height * scale) } : { width: 240, height: 160 }

  return (
    <>
      <button type="button" onClick={() => url && setOpen(true)} className="overflow-hidden rounded-lg bg-input" style={style}>
        {url && <img src={url} alt="Gönderilen görsel" className="size-full object-cover" loading="lazy" draggable={false} />}
      </button>
      {open && url && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-8" onClick={() => setOpen(false)}>
          <img src={url} alt="Gönderilen görsel" className="max-h-full max-w-full rounded-lg shadow-pop" />
        </div>
      )}
    </>
  )
}
