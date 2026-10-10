import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { BarChart3, File as FileIcon, Paperclip, Send, Smile, X } from 'lucide-react'
import { IconButton, Spinner } from '@/components/ui'
import { useActions } from '@/data/actions'
import type { ChatMessage } from '@/data/queries'
import type { Attachment } from '@/lib/database.types'
import { COMPRESSIBLE_IMAGES, MAX_FILE_BYTES, formatBytes } from '@/lib/files'
import { uploadAttachment } from '@/lib/images'
import { filterMentions, insertMention, mentionQuery, type MentionCandidate } from '@/lib/mentions'
import { Avatar } from '@/components/Avatar'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { EmojiPicker } from './EmojiPicker'

const MAX_LENGTH = 4000
const MAX_FILES = 4

// preview: görseller için küçük resim adresi; diğer dosyalarda yok.
type Pending = { id: string; file: File; preview: string | null }

type Props = {
  channelId: string
  userId: string
  placeholder: string
  disabledReason: string | null
  replyTo: ChatMessage | null
  replyName: string
  onCancelReply: () => void
  onEditLast: () => void
  onTyping: () => void
  // "@" yazınca önerilecek kişiler.
  mentionables: (MentionCandidate & { avatar_path: string | null })[]
  // Sohbete sürüklenip bırakılan dosyalar (ChatView'dan gelir).
  dropped: File[] | null
  onDroppedTaken: () => void
}

// Taslaklar kanal değiştirince kaybolmasın.
const drafts = new Map<string, string>()

export function Composer({
  channelId,
  userId,
  placeholder,
  disabledReason,
  replyTo,
  replyName,
  onCancelReply,
  onEditLast,
  onTyping,
  mentionables,
  dropped,
  onDroppedTaken,
}: Props) {
  const [text, setText] = useState(() => drafts.get(channelId) ?? '')
  const [files, setFiles] = useState<Pending[]>([])
  const [sending, setSending] = useState(false)
  // Yükleme ilerlemesi (0-1); dosya yokken null.
  const [progress, setProgress] = useState<number | null>(null)
  // Emoji kutusu açıksa onu açan düğmenin ekrandaki yeri.
  const [picker, setPicker] = useState<DOMRect | null>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const actions = useActions()
  const openModal = useUi((s) => s.openModal)

  useEffect(() => {
    drafts.set(channelId, text)
  }, [channelId, text])

  useEffect(() => {
    inputRef.current?.focus()
  }, [channelId, replyTo])

  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), [files])

  useEffect(() => {
    if (!dropped) return
    addFiles(dropped)
    onDroppedTaken()
    inputRef.current?.focus()
    // Sadece yeni dosya bırakılınca çalışır.
  }, [dropped])

  // Yazı kutusu içeriğe göre büyür.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [text])

  function addFiles(list: FileList | File[]) {
    const all = [...list]
    // Görseller yüklenirken küçültülür; diğer dosyalar olduğu gibi gider ve boyut sınırına tabidir.
    const ok = all.filter((f) => COMPRESSIBLE_IMAGES.includes(f.type) || (f.size > 0 && f.size <= MAX_FILE_BYTES))
    if (ok.length < all.length) toast.info(`Bir dosya en fazla ${formatBytes(MAX_FILE_BYTES)} olabilir.`)
    setFiles((current) => {
      const room = MAX_FILES - current.length
      if (ok.length > room) toast.info(`Bir mesajda en fazla ${MAX_FILES} dosya olabilir.`)
      return [
        ...current,
        ...ok.slice(0, Math.max(0, room)).map((file) => ({
          id: crypto.randomUUID(),
          file,
          preview: COMPRESSIBLE_IMAGES.includes(file.type) ? URL.createObjectURL(file) : null,
        })),
      ]
    })
  }

  async function send() {
    const content = text.trim()
    if ((!content && files.length === 0) || sending || disabledReason) return
    if (content.length > MAX_LENGTH) {
      toast.info(`Mesaj en fazla ${MAX_LENGTH} karakter olabilir.`)
      return
    }
    setSending(true)
    try {
      const attachments: Attachment[] = []
      if (files.length) setProgress(0)
      for (const [i, f] of files.entries()) {
        attachments.push(await uploadAttachment(channelId, userId, f.file, (fraction) => setProgress((i + fraction) / files.length)))
      }
      await actions.sendMessage(channelId, content, replyTo?.id ?? null, attachments)
      setText('')
      drafts.delete(channelId)
      setFiles([])
      onCancelReply()
    } catch (error) {
      // Kendi yazdığımız hatalar (ör. "Dosya en fazla 25 MB olabilir") olduğu gibi gösterilir.
      if (error instanceof Error && error.name === 'Error' && !('code' in error)) toast.info(error.message)
      else if (error instanceof Error && !('code' in error)) toast.error(error)
    } finally {
      setSending(false)
      setProgress(null)
      inputRef.current?.focus()
    }
  }

  const suggestions = mention ? filterMentions(mentionables, mention.query) : []

  function updateMention(value: string, caret: number) {
    const next = mentionQuery(value, caret)
    setMention(next)
    if (next?.query !== mention?.query) setMentionIndex(0)
  }

  function pickMention(candidate: MentionCandidate) {
    const el = inputRef.current
    if (!el || !mention) return
    const result = insertMention(text, mention.start, el.selectionStart, candidate.username)
    setText(result.text)
    setMention(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.caret, result.caret)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0 && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setMentionIndex((i) => (i + step + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(suggestions[Math.min(mentionIndex, suggestions.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    } else if (e.key === 'ArrowUp' && !text) {
      e.preventDefault()
      onEditLast()
    } else if (e.key === 'Escape' && replyTo) {
      onCancelReply()
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files]
    if (pasted.length) {
      e.preventDefault()
      addFiles(pasted)
    }
  }

  if (disabledReason) {
    return (
      <div className="px-4 pb-6">
        <div className="rounded-lg bg-input px-4 py-3 text-sm text-muted">{disabledReason}</div>
      </div>
    )
  }

  return (
    <div className="px-4 pb-6">
      {replyTo && (
        <div className="flex items-center justify-between rounded-t-lg bg-sidebar px-3 py-1.5 text-xs text-muted">
          <span>
            <span className="font-semibold text-fg">{replyName}</span> kişisine yanıt veriyorsun
          </span>
          <IconButton label="Yanıtı iptal et" className="size-6" onClick={onCancelReply}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="relative">
          <div className="anim-pop absolute right-0 bottom-1 left-0 z-20 overflow-hidden rounded-lg border border-line bg-elevated py-1 shadow-pop" role="listbox">
            <p className="px-3 py-1 text-[11px] font-bold tracking-wide text-faint uppercase">Kişiler</p>
            {suggestions.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMention(c)
                }}
                onMouseEnter={() => setMentionIndex(i)}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${i === mentionIndex ? 'bg-selected' : ''}`}
              >
                <Avatar name={c.display_name} path={mentionables.find((m) => m.id === c.id)?.avatar_path} size={24} />
                <span className="truncate text-sm font-medium text-fg">{c.display_name}</span>
                <span className="truncate text-xs text-faint">@{c.username}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={`overflow-hidden bg-input ring-accent/50 focus-within:ring-1 ${replyTo ? 'rounded-b-lg' : 'rounded-lg'}`}>
        {progress !== null && (
          <div className="h-1 bg-line" role="progressbar" aria-label="Dosya yükleniyor" aria-valuenow={Math.round(progress * 100)}>
            <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {files.length > 0 && (
          <div className="flex gap-3 overflow-x-auto border-b border-line p-3 scroll-thin">
            {files.map((f) => (
              <div
                key={f.id}
                className={`relative h-24 shrink-0 overflow-hidden rounded-md bg-sidebar ${f.preview ? 'w-24' : 'flex w-44 flex-col justify-center gap-1 px-3'}`}
              >
                {f.preview ? (
                  <img src={f.preview} alt="" className="size-full object-cover" />
                ) : (
                  <>
                    <FileIcon className="size-6 text-accent" />
                    <span className="truncate pr-5 text-xs font-semibold text-fg" data-tip={f.file.name}>
                      {f.file.name}
                    </span>
                    <span className="text-[11px] text-faint">{formatBytes(f.file.size)}</span>
                  </>
                )}
                <button
                  type="button"
                  aria-label="Dosyayı kaldır"
                  disabled={sending}
                  onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white hover:bg-accent"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 px-2">
          <IconButton
            label={`Dosya ekle (en fazla ${formatBytes(MAX_FILE_BYTES)})`}
            className="mb-1.5"
            onClick={() => fileRef.current?.click()}
            disabled={files.length >= MAX_FILES || sending}
          >
            <Paperclip className="size-5" />
          </IconButton>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={MAX_LENGTH + 100}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value)
              updateMention(e.target.value, e.target.selectionStart)
              if (e.target.value) onTyping()
            }}
            onSelect={(e) => updateMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="max-h-[40vh] flex-1 resize-none bg-transparent py-3 text-[length:var(--tc-chat-font)] text-fg outline-none placeholder:text-faint"
          />
          {text.length > MAX_LENGTH - 300 && (
            <span className={`mb-3 text-xs ${text.length > MAX_LENGTH ? 'text-accent' : 'text-faint'}`}>{MAX_LENGTH - text.length}</span>
          )}
          <IconButton label="Anket oluştur" className="mb-1.5" disabled={sending} onClick={() => openModal({ kind: 'create-poll', channelId })}>
            <BarChart3 className="size-5" />
          </IconButton>
          <IconButton label="Emoji" className={`mb-1.5 ${picker ? 'bg-selected text-fg' : ''}`} onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
            <Smile className="size-5" />
          </IconButton>
          {picker && (
            <EmojiPicker
              anchor={picker}
              onPick={(emoji) => {
                setText((t) => t + emoji)
                setPicker(null)
                inputRef.current?.focus()
              }}
              onClose={() => setPicker(null)}
            />
          )}
          <IconButton
            label="Gönder"
            className="mb-1.5 text-accent hover:text-accent"
            disabled={sending || (!text.trim() && files.length === 0)}
            onClick={() => void send()}
          >
            {sending ? <Spinner className="size-4" /> : <Send className="size-5" />}
          </IconButton>
        </div>
      </div>
    </div>
  )
}
