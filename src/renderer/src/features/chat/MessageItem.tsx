import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Check, CheckCheck, Copy, CornerUpLeft, Forward, Pencil, Phone, PhoneMissed, PhoneOff, Pin, PinOff, SmilePlus, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { ContextMenu, type MenuItem } from '@/components/Menu'
import { confirmDialog } from '@/components/Modal'
import { IconButton, TextArea } from '@/components/ui'
import { useActions } from '@/data/actions'
import type { ChatMessage } from '@/data/queries'
import type { ProfileRow } from '@/lib/database.types'
import { callText, fileKind, parseCall } from '@/lib/files'
import { formatMessageTime, formatTime } from '@/lib/format'
import { mentionsUser } from '@/lib/markdown'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { Attachments } from './Attachments'
import { EmojiPicker, QUICK_REACTIONS } from './EmojiPicker'
import { MessageContent } from './MessageContent'
import { PollMessage } from './Poll'

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
  // Özel mesajda arama kaydının yanındaki "Geri ara" düğmesi.
  onCallBack?: () => void
  // Bu sohbette mesaj sabitleyebilir miyim? (özel mesajda herkes, sunucuda sahip ve yöneticiler)
  canPin: boolean
  // Özel mesajda karşı taraf bu (son) mesajımı okudu.
  seen?: boolean
  // Yanıtlanan mesaja git (henüz yüklenmemişse yükleyip gösterir).
  onJumpTo: (id: string) => void
}

// Yanıtlanan mesajın tek satırlık özeti.
export function previewText(message: ChatMessage, mine: boolean): string {
  if (message.kind === 'call') return `📞 ${callText(message.content, mine)}`
  if (message.kind === 'poll') return `📊 ${message.content}`
  if (message.content) return message.content
  const first = message.attachments[0]
  if (!first) return ''
  return fileKind(first) === 'image' ? '🖼️ Görsel' : `📎 ${first.name ?? 'Dosya'}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    toast.info('Kopyalanamadı.')
    return false
  }
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
  onCallBack,
  canPin,
  seen,
  onJumpTo,
}: Props) {
  const actions = useActions()
  const openModal = useUi((s) => s.openModal)
  const [picker, setPicker] = useState(false)
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; selection: string } | null>(null)
  // Az önce gelen mesaj hafif bir animasyonla belirir (eski mesajlar yüklenirken değil).
  const [fresh] = useState(() => Date.now() - new Date(message.created_at).getTime() < 4000)
  const mine = message.author_id === me.id
  const isText = message.kind === 'text'
  const mentioned = !mine && isText && mentionsUser(message.content, me.username)
  const name = author?.display_name ?? 'Silinmiş kullanıcı'
  const showHeader = !grouped || !!message.reply_to

  if (message.kind === 'call') {
    return <CallMessage message={message} mine={mine} name={name} fresh={fresh} onCallBack={onCallBack} />
  }

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

  const copy = async (text = message.content) => {
    if (!(await copyText(text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Sağ tık menüsü. Bağlantıların üzerinde Windows'un kendi menüsü (aç / kopyala) açılır.
  const onContextMenu = (e: MouseEvent) => {
    if (editing || (e.target as HTMLElement).closest('a, input, textarea')) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, selection: window.getSelection()?.toString().trim() ?? '' })
  }

  const menuItems: MenuItem[] = menu
    ? [
        { label: 'Seçimi kopyala', icon: Copy, show: !!menu.selection, onClick: () => void copy(menu.selection) },
        { label: 'Metni kopyala', icon: Copy, show: !!message.content, onClick: () => void copy() },
        { label: 'Yanıtla', icon: CornerUpLeft, show: canPost, onClick: () => onReply(message) },
        { label: 'İlet', icon: Forward, show: isText, onClick: () => openModal({ kind: 'forward', message }) },
        {
          label: message.pinned_at ? 'Sabitlemeyi kaldır' : 'Sabitle',
          icon: message.pinned_at ? PinOff : Pin,
          show: canPin,
          onClick: () => void actions.setPinned(message, !message.pinned_at).catch(() => undefined),
        },
        { label: 'Düzenle', icon: Pencil, show: canPost && mine && isText && !!message.content, onClick: () => onEdit(message.id) },
        { label: 'Sil', icon: Trash2, show: mine || canModerate, danger: true, onClick: () => void remove() },
      ]
    : []

  return (
    <div
      id={`mesaj-${message.id}`}
      onContextMenu={onContextMenu}
      className={`group relative px-4 ${showHeader ? 'mt-3 pt-1 compact:mt-1' : ''} py-0.5 ${fresh ? 'anim-msg' : ''} ${
        mentioned ? 'border-l-2 border-accent bg-mention' : `border-l-2 border-transparent hover:bg-hover ${menu ? 'bg-hover' : ''}`
      }`}
    >
      {message.reply_to && (
        <button
          type="button"
          onClick={() => message.reply_to && onJumpTo(message.reply_to)}
          className="mb-0.5 ml-12 flex max-w-full items-center gap-1.5 text-xs text-muted hover:text-fg"
        >
          <CornerUpLeft className="size-3.5 shrink-0" />
          {replied ? (
            <>
              <span className="font-semibold">{repliedAuthor?.display_name ?? 'Silinmiş kullanıcı'}</span>
              <span className="truncate">{previewText(replied, replied.author_id === me.id)}</span>
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

          {(message.forwarded || message.pinned_at) && (
            <p className="flex items-center gap-3 text-[11px] font-medium text-faint">
              {message.forwarded && (
                <span className="flex items-center gap-1">
                  <Forward className="size-3" /> İletildi
                </span>
              )}
              {message.pinned_at && (
                <span className="flex items-center gap-1 text-accent">
                  <Pin className="size-3" /> Sabitlendi
                </span>
              )}
            </p>
          )}

          {message.kind === 'poll' ? (
            <PollMessage message={message} me={me.id} canVote={canPost} profileName={profileName} />
          ) : editing ? (
            <EditBox message={message} onDone={() => onEdit(null)} />
          ) : (
            message.content && (
              <div className="flex flex-wrap items-baseline gap-x-1">
                <MessageContent content={message.content} me={me.username} />
                {message.edited_at && <span className="text-[11px] text-faint">(düzenlendi)</span>}
              </div>
            )
          )}

          <Attachments items={message.attachments} />

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

          {seen && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-faint">
              <CheckCheck className="size-3.5 text-accent" /> Görüldü
            </p>
          )}
        </div>
      </div>

      {!editing && (canPost || !!message.content) && (
        <div className="absolute -top-4 right-4 hidden items-center rounded-md border border-line bg-elevated shadow-pop group-hover:flex">
          {canPost &&
            QUICK_REACTIONS.slice(0, 4).map((emoji) => (
              <button key={emoji} type="button" onClick={() => react(emoji)} className="grid size-8 place-items-center text-base hover:bg-hover">
                {emoji}
              </button>
            ))}
          {canPost && (
            <div className="relative">
              <IconButton label="Tepki ekle" onClick={() => setPicker(true)}>
                <SmilePlus className="size-4" />
              </IconButton>
              {picker && <EmojiPicker onPick={react} onClose={() => setPicker(false)} />}
            </div>
          )}
          {canPost && (
            <IconButton label="Yanıtla" onClick={() => onReply(message)}>
              <CornerUpLeft className="size-4" />
            </IconButton>
          )}
          {message.content && (
            <IconButton label={copied ? 'Kopyalandı' : 'Metni kopyala'} onClick={() => void copy()}>
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </IconButton>
          )}
          {canPost && mine && isText && message.content && (
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
})

// Arama kaydı: sohbetin ortasında, ince bir bilgi satırı.
function CallMessage({ message, mine, name, fresh, onCallBack }: { message: ChatMessage; mine: boolean; name: string; fresh: boolean; onCallBack?: () => void }) {
  const call = parseCall(message.content)
  const missed = call.status !== 'ended'
  const Icon = call.status === 'missed' ? PhoneMissed : call.status === 'declined' ? PhoneOff : Phone
  let detail: ReactNode = callText(message.content, mine)
  if (call.status === 'missed' && !mine) detail = <><strong className="font-semibold">{name}</strong> seni aradı</>
  return (
    <div id={`mesaj-${message.id}`} className={`mx-4 mt-3 flex items-center gap-3 rounded-lg border border-line bg-sidebar px-3 py-2 ${fresh ? 'anim-msg' : ''}`}>
      <span className={`grid size-8 shrink-0 place-items-center rounded-full ${missed ? 'bg-accent-soft text-accent' : 'bg-hover text-success'}`}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-sm text-fg">{detail}</span>
      <span className="shrink-0 text-xs text-faint">{formatMessageTime(message.created_at)}</span>
      {onCallBack && missed && !mine && (
        <button type="button" onClick={onCallBack} className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-bold text-on-accent hover:bg-accent-hover">
          Geri ara
        </button>
      )}
    </div>
  )
}

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
