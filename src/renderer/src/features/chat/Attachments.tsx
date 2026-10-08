import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, File as FileIcon, FileArchive, FileAudio, FileText, FileVideo, ImageOff, Play, X } from 'lucide-react'
import { IconButton, Spinner } from '@/components/ui'
import type { Attachment } from '@/lib/database.types'
import { extensionOf, fileKind, formatBytes } from '@/lib/files'
import { downloadAttachmentUrl, signedAttachmentUrl } from '@/lib/images'
import { toast } from '@/stores/toast'

// Mesaj ekleri: görseller küçük resim + büyütme, ses ve video tıklanınca açılan oynatıcı, diğerleri indirilebilir dosya kartı.

function useSignedUrl(path: string): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ url: string | null; missing: boolean }>({ url: null, missing: false })
  useEffect(() => {
    let alive = true
    void signedAttachmentUrl(path).then((url) => alive && setState({ url, missing: !url }))
    return () => {
      alive = false
    }
  }, [path])
  return state
}

// Dosyayı varsayılan tarayıcıda indirir (uygulama penceresi dışarıya açılan bağlantıları tarayıcıya yollar).
async function download(attachment: Attachment): Promise<void> {
  const url = await downloadAttachmentUrl(attachment.path, attachment.name ?? '')
  if (!url) {
    toast.info('Dosya artık yok (silinmiş ya da süresi dolmuş olabilir).')
    return
  }
  window.open(url, '_blank', 'noopener')
}

export function Attachments({ items }: { items: Attachment[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap items-start gap-2">
      {items.map((a) => {
        const kind = fileKind(a)
        if (kind === 'image') return <ImageAttachment key={a.path} attachment={a} />
        if (kind === 'audio') return <MediaAttachment key={a.path} attachment={a} video={false} />
        if (kind === 'video') return <MediaAttachment key={a.path} attachment={a} video />
        return <FileCard key={a.path} attachment={a} />
      })}
    </div>
  )
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const { url, missing } = useSignedUrl(attachment.path)
  const [open, setOpen] = useState(false)
  const { width, height } = attachment

  const maxW = 400
  const maxH = 300
  const scale = width && height ? Math.min(1, maxW / width, maxH / height) : 1
  const style = width && height ? { width: Math.round(width * scale), height: Math.round(height * scale) } : { width: 240, height: 160 }

  if (missing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-input px-3 py-2 text-sm text-faint">
        <ImageOff className="size-4" /> Görsel artık yok
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        className={`overflow-hidden rounded-lg bg-input transition-opacity hover:opacity-90 ${url ? '' : 'skeleton'}`}
        style={style}
      >
        {url && <img src={url} alt="Gönderilen görsel" className="size-full object-cover" loading="lazy" draggable={false} />}
      </button>
      {open && url && <Lightbox url={url} attachment={attachment} onClose={() => setOpen(false)} />}
    </>
  )
}

function Lightbox({ url, attachment, onClose }: { url: string; attachment: Attachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 flex flex-col bg-black/85" onClick={onClose}>
      <div className="flex shrink-0 items-center justify-end gap-1 px-4 pt-10 pb-2" onClick={(e) => e.stopPropagation()}>
        <span className="mr-auto truncate text-sm text-white/70">{attachment.name ?? ''}</span>
        <IconButton label="İndir" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => void download(attachment)}>
          <Download className="size-5" />
        </IconButton>
        <IconButton label="Kapat (Esc)" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center p-6 pt-2">
        <img
          src={url}
          alt="Gönderilen görsel"
          className="anim-pop max-h-full max-w-full rounded-lg object-contain shadow-pop"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>,
    document.body,
  )
}

function iconFor(attachment: Attachment) {
  const type = attachment.type ?? ''
  const ext = extensionOf(attachment.name ?? attachment.path)
  if (type.startsWith('audio/')) return FileAudio
  if (type.startsWith('video/')) return FileVideo
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return FileArchive
  if (type.startsWith('text/') || ['pdf', 'doc', 'docx', 'txt', 'md', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext)) return FileText
  return FileIcon
}

function FileCard({ attachment }: { attachment: Attachment }) {
  const [busy, setBusy] = useState(false)
  const Icon = iconFor(attachment)
  const ext = extensionOf(attachment.name ?? attachment.path).toUpperCase()

  async function onDownload() {
    setBusy(true)
    try {
      await download(attachment)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-80 max-w-full items-center gap-3 rounded-lg border border-line bg-sidebar p-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="selectable truncate text-sm font-semibold text-fg" title={attachment.name}>
          {attachment.name ?? 'Dosya'}
        </p>
        <p className="text-xs text-faint">{[ext, attachment.size ? formatBytes(attachment.size) : ''].filter(Boolean).join(' · ')}</p>
      </div>
      <IconButton label="İndir" onClick={() => void onDownload()} disabled={busy}>
        {busy ? <Spinner className="size-4" /> : <Download className="size-5" />}
      </IconButton>
    </div>
  )
}

// Ses ve video: oynatıcı ancak tıklanınca oluşturulur. Böylece çok dosyalı bir kanalda her dosya için
// bellekte bir oynatıcı tutulmaz ve dosyalar boşuna indirilmeye başlanmaz.
function MediaAttachment({ attachment, video }: { attachment: Attachment; video: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  const Icon = video ? FileVideo : FileAudio

  async function open() {
    setLoading(true)
    const signed = await signedAttachmentUrl(attachment.path)
    setLoading(false)
    if (signed) setUrl(signed)
    else setMissing(true)
  }

  if (missing) return <FileCard attachment={attachment} />
  return (
    <div className={`max-w-full overflow-hidden rounded-lg border border-line bg-sidebar ${video && url ? 'w-[420px]' : 'w-80'}`}>
      {url &&
        (video ? (
          <video src={url} controls autoPlay preload="metadata" className="max-h-80 w-full bg-black" />
        ) : (
          <div className="px-3 pt-3">
            <audio src={url} controls autoPlay preload="metadata" className="h-9 w-full" />
          </div>
        ))}
      <div className="flex items-center gap-3 p-3">
        {!url && (
          <button
            type="button"
            onClick={() => void open()}
            disabled={loading}
            aria-label={video ? 'Videoyu oynat' : 'Sesi oynat'}
            title={video ? 'Videoyu oynat' : 'Sesi oynat'}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-hover"
          >
            {loading ? <Spinner className="size-4" /> : <Play className="size-5 translate-x-px" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="selectable truncate text-sm font-semibold text-fg" title={attachment.name}>
            {attachment.name ?? (video ? 'Video' : 'Ses')}
          </p>
          <p className="flex items-center gap-1 text-xs text-faint">
            <Icon className="size-3.5" />
            {[video ? 'Video' : 'Ses', attachment.size ? formatBytes(attachment.size) : ''].filter(Boolean).join(' · ')}
          </p>
        </div>
        <IconButton label="İndir" onClick={() => void download(attachment)}>
          <Download className="size-5" />
        </IconButton>
      </div>
    </div>
  )
}
