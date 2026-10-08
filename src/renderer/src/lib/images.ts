import type { Attachment } from './database.types'
import { COMPRESSIBLE_IMAGES, MAX_FILE_BYTES, extensionOf, formatBytes, safeFileName } from './files'
import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase'

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

// Mesaj eki: görseller küçültülüp yüklenir; diğer dosyalar olduğu gibi (en fazla 25 MB) gider.
// `onProgress` 0-1 arası ilerleme bildirir.
export async function uploadAttachment(
  channelId: string,
  userId: string,
  file: File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<Attachment> {
  const name = file instanceof File ? file.name : ''
  if (COMPRESSIBLE_IMAGES.includes(file.type)) {
    const image = await prepareImage(file, 1600)
    const path = await upload('ekler', `${channelId}/${userId}/${randomName(image.ext)}`, image)
    onProgress?.(1)
    return { path, width: image.width, height: image.height, size: image.blob.size, type: image.type, name: name || undefined }
  }

  if (file.size > MAX_FILE_BYTES) throw new Error(`Dosya en fazla ${formatBytes(MAX_FILE_BYTES)} olabilir.`)
  if (file.size === 0) throw new Error('Boş dosya gönderilemez.')
  const safe = safeFileName(name || 'dosya')
  const ext = extensionOf(safe)
  const path = `${channelId}/${userId}/${randomName(ext || 'bin')}`
  // Tür bilinmiyorsa ya da tarayıcıda çalışabilecek bir türse düz ikili veri olarak saklanır.
  const type = file.type && !/html|javascript|xml/i.test(file.type) ? file.type : 'application/octet-stream'
  await uploadWithProgress(path, file, type, onProgress)
  return { path, size: file.size, type, name: name || safe }
}

// supabase-js ilerleme bildirmediği için büyük dosyalar doğrudan Storage API'sine XHR ile yüklenir.
async function uploadWithProgress(path: string, file: Blob, type: string, onProgress?: (fraction: number) => void): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Oturum bulunamadı. Yeniden giriş yap.')
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/ekler/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', SUPABASE_KEY)
    xhr.setRequestHeader('Content-Type', type)
    xhr.setRequestHeader('Cache-Control', 'max-age=31536000')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      reject(new Error(xhr.status === 413 ? `Dosya en fazla ${formatBytes(MAX_FILE_BYTES)} olabilir.` : 'Dosya yüklenemedi. Tekrar dene.'))
    }
    xhr.onerror = () => reject(new Error('Dosya yüklenemedi. İnternet bağlantını kontrol et.'))
    xhr.send(file)
  })
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

// İndirme bağlantısı: tarayıcı dosyayı göstermek yerine verilen adla kaydeder.
export async function downloadAttachmentUrl(path: string, name: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('ekler').createSignedUrl(path, 600, { download: name || true })
  return error || !data ? null : data.signedUrl
}
