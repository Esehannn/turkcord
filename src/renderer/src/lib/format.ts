// Tarih ve saat biçimleri (Türkçe).

const time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' })
const date = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const longDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function isSameDay(a: string | Date, b: string | Date): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b))
}

export function formatTime(iso: string): string {
  return time.format(new Date(iso))
}

// "Bugün 14:32", "Dün 09:05" ya da "05.10.2026 18:00"
export function formatMessageTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (diffDays === 0) return `Bugün ${time.format(d)}`
  if (diffDays === 1) return `Dün ${time.format(d)}`
  return `${date.format(d)} ${time.format(d)}`
}

// Gün ayracı: "7 Ekim 2026"
export function formatDay(iso: string): string {
  return longDate.format(new Date(iso))
}

// Aynı kişinin art arda (7 dakika içinde) attığı mesajlar tek grupta gösterilir.
export function sameGroup(
  prev: { author_id: string | null; created_at: string } | undefined,
  next: { author_id: string | null; created_at: string },
): boolean {
  if (!prev || prev.author_id !== next.author_id) return false
  if (!isSameDay(prev.created_at, next.created_at)) return false
  return new Date(next.created_at).getTime() - new Date(prev.created_at).getTime() < 7 * 60_000
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('tr-TR')
  return (parts[0][0] + parts[1][0]).toLocaleUpperCase('tr-TR')
}

// Kanal adı: küçük harf, boşluk yerine tire (Türkçe karakterler korunur).
export function normalizeChannelName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-+/g, '-')
    .slice(0, 32)
}
