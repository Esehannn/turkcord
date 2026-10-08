// Dosya ekleri ve arama kayıtları için küçük, bağımsız yardımcılar (testleri var).

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const COMPRESSIBLE_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// "1,4 MB", "820 KB", "12 B"
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const text = value >= 100 || unit === 0 ? Math.round(value).toString() : value.toFixed(1).replace('.', ',').replace(/,0$/, '')
  return `${text} ${units[unit]}`
}

export type FileKind = 'image' | 'audio' | 'video' | 'file'

const EXTENSIONS: Record<string, FileKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  mp3: 'audio',
  ogg: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
}

export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

// Ek nasıl gösterilecek? Tür bilgisi yoksa (eski mesajlar) uzantıya bakılır; o da yoksa görsel sayılır.
export function fileKind(attachment: { path: string; type?: string; name?: string }): FileKind {
  const type = attachment.type ?? ''
  // SVG betik taşıyabilir; görsel olarak gösterilmez, dosya olarak indirilir.
  if (type === 'image/svg+xml') return 'file'
  if (type.startsWith('image/')) return COMPRESSIBLE_IMAGES.includes(type) ? 'image' : 'file'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return EXTENSIONS[extensionOf(attachment.name ?? attachment.path)] === 'video' ? 'video' : 'file'
  if (type) return 'file'
  return EXTENSIONS[extensionOf(attachment.name ?? attachment.path)] ?? (attachment.name ? 'file' : 'image')
}

// Depolama yolunda güvenli bir dosya adı: harf, rakam, tire, alt çizgi ve nokta.
export function safeFileName(name: string): string {
  const ext = extensionOf(name)
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'dosya'}${ext ? `.${ext}` : ''}`
}

export type CallSummary = { status: 'missed' | 'declined' | 'ended'; seconds: number | null }

// Arama mesajının içeriği: "missed", "declined", "ended" ya da "ended:<saniye>".
export function parseCall(content: string): CallSummary {
  if (content === 'missed' || content === 'declined') return { status: content, seconds: null }
  const match = /^ended(?::(\d{1,7}))?$/.exec(content)
  return { status: 'ended', seconds: match?.[1] ? Number(match[1]) : null }
}

// "42 sn", "3 dk 5 sn", "1 sa 12 dk"
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} sn`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m} dk ${s % 60} sn` : `${m} dk`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} sa ${m % 60} dk` : `${h} sa`
}

// Sohbet listesinde ve bildirimde görünen kısa metin.
export function callText(content: string, mine: boolean): string {
  const call = parseCall(content)
  if (call.status === 'missed') return mine ? 'Cevaplanmayan arama' : 'Cevapsız arama'
  if (call.status === 'declined') return 'Reddedilen arama'
  return call.seconds !== null ? `Sesli arama · ${formatDuration(call.seconds)}` : 'Sesli arama'
}

// Saat gibi akan süre: "03:07", "1:02:45"
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}
