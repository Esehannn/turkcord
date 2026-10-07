import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ImagePlus, Send, Smile, X } from 'lucide-react'
import { IconButton, Spinner } from '@/components/ui'
import { useActions } from '@/data/actions'
import type { ChatMessage } from '@/data/queries'
import type { Attachment } from '@/lib/database.types'
import { IMAGE_TYPES, uploadAttachment } from '@/lib/images'
import { toast } from '@/stores/toast'
import { EmojiPicker } from './EmojiPicker'

const MAX_LENGTH = 4000
const MAX_FILES = 4

type Pending = { id: string; file: File; preview: string }

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
}

// Taslaklar kanal değiştirince kaybolmasın.
const drafts = new Map<string, string>()

export function Composer({ channelId, userId, placeholder, disabledReason, replyTo, replyName, onCancelReply, onEditLast, onTyping }: Props) {
  const [text, setText] = useState(() => drafts.get(channelId) ?? '')
  const [files, setFiles] = useState<Pending[]>([])
  const [sending, setSending] = useState(false)
  const [picker, setPicker] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const actions = useActions()

  useEffect(() => {
    drafts.set(channelId, text)
  }, [channelId, text])

  useEffect(() => {
    inputRef.current?.focus()
  }, [channelId, replyTo])

  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.preview)), [files])

  // Yazı kutusu içeriğe göre büyür.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [text])

  function addFiles(list: FileList | File[]) {
    const images = [...list].filter((f) => IMAGE_TYPES.includes(f.type))
    if (images.length < [...list].length) toast.info('Şimdilik sadece görsel gönderilebiliyor.')
    setFiles((current) => {
      const room = MAX_FILES - current.length
      if (images.length > room) toast.info(`Bir mesajda en fazla ${MAX_FILES} görsel olabilir.`)
      return [
        ...current,
        ...images.slice(0, Math.max(0, room)).map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) })),
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
      for (const f of files) attachments.push(await uploadAttachment(channelId, userId, f.file))
      await actions.sendMessage(channelId, content, replyTo?.id ?? null, attachments)
      setText('')
      drafts.delete(channelId)
      setFiles([])
      onCancelReply()
    } catch (error) {
      if (error instanceof Error && !('code' in error)) toast.error(error)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
      <div
        className={`bg-input ring-accent/50 focus-within:ring-1 ${replyTo ? 'rounded-b-lg' : 'rounded-lg'}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
      >
        {files.length > 0 && (
          <div className="flex gap-3 overflow-x-auto border-b border-line p-3 scroll-thin">
            {files.map((f) => (
              <div key={f.id} className="relative size-24 shrink-0 overflow-hidden rounded-md bg-sidebar">
                <img src={f.preview} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  aria-label="Görseli kaldır"
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
          <IconButton label="Görsel ekle" className="mb-1.5" onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_FILES}>
            <ImagePlus className="size-5" />
          </IconButton>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(',')}
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
              if (e.target.value) onTyping()
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="max-h-[40vh] flex-1 resize-none bg-transparent py-3 text-[15px] text-fg outline-none placeholder:text-faint"
          />
          {text.length > MAX_LENGTH - 300 && (
            <span className={`mb-3 text-xs ${text.length > MAX_LENGTH ? 'text-accent' : 'text-faint'}`}>{MAX_LENGTH - text.length}</span>
          )}
          <div className="relative mb-1.5">
            <IconButton label="Emoji" onClick={() => setPicker((v) => !v)}>
              <Smile className="size-5" />
            </IconButton>
            {picker && (
              <EmojiPicker
                onPick={(emoji) => {
                  setText((t) => t + emoji)
                  setPicker(false)
                  inputRef.current?.focus()
                }}
                onClose={() => setPicker(false)}
              />
            )}
          </div>
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
