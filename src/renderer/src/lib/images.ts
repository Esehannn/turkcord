import { supabase } from './supabase'

// Görseller yüklenmeden önce küçültülür ve WebP'ye çevrilir; ücretsiz 1 GB depolama alanı uzun süre yeter.
// Hareketli GIF'ler bozulmasın diye olduğu gibi yüklenir (boyut sınırı içindeyse).

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_GIF = 8 * 1024 * 1024

export type PreparedImage = { blob: Blob; width: number; height: number; ext: 'webp' | 'gif'; type: string }

export async function prepareImage(file: Blob, maxSide: number, square = false): Promise<PreparedImage> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Sadece PNG, JPEG, WebP ya da GIF yüklenebilir.')

  const bitmap = await createImageBitmap(file)
  try {
    if (file.type === 'image/gif' && !square) {
      if (file.size > MAX_GIF) throw new Error('GIF en fazla 8 MB olabilir.')
      return { blob: file, width: bitmap.width, height: bitmap.height, ext: 'gif', type: 'image/gif' }
    }

    let sx = 0
    let sy = 0
    let sw = bitmap.width
    let sh = bitmap.height
    if (square) {
      const side = Math.min(sw, sh)
      sx = (sw - side) / 2
      sy = (sh - side) / 2
      sw = side
      sh = side
    }
    const scale = Math.min(1, maxSide / Math.max(sw, sh))
    const width = Math.max(1, Math.round(sw * scale))
    const height = Math.max(1, Math.round(sh * scale))

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Görsel işlenemedi.')
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
    return { blob, width, height, ext: 'webp', type: 'image/webp' }
  } finally {
    bitmap.close()
  }
}

function randomName(ext: string): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`
}

async function upload(bucket: 'gorseller' | 'ekler', path: string, image: PreparedImage): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, image.blob, {
    contentType: image.type,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw error
  return path
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const image = await prepareImage(file, 256, true)
  return upload('gorseller', `u/${userId}/${randomName(image.ext)}`, image)
}

export async function uploadServerIcon(serverId: string, file: File): Promise<string> {
  const image = await prepareImage(file, 256, true)
  return upload('gorseller', `s/${serverId}/${randomName(image.ext)}`, image)
}

export async function uploadAttachment(channelId: string, userId: string, file: Blob) {
  const image = await prepareImage(file, 1600)
  const path = await upload('ekler', `${channelId}/${userId}/${randomName(image.ext)}`, image)
  return { path, width: image.width, height: image.height, size: image.blob.size, type: image.type }
}

export async function removeImage(bucket: 'gorseller' | 'ekler', path: string | null | undefined): Promise<void> {
  if (!path) return
  await supabase.storage.from(bucket).remove([path])
}

// Gizli eklerin geçici bağlantıları önbelleklenir (1 saat geçerli, 50 dakikada yenilenir).
const signed = new Map<string, { url: string; expires: number }>()

export async function signedAttachmentUrl(path: string): Promise<string | null> {
  const cached = signed.get(path)
  if (cached && cached.expires > Date.now()) return cached.url
  const { data, error } = await supabase.storage.from('ekler').createSignedUrl(path, 3600)
  if (error || !data) return null
  signed.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60_000 })
  return data.signedUrl
}
