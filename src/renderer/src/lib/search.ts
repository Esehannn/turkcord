// Arama için küçük, bağımsız yardımcılar (testleri var): mesaj arama kalıbı, eşleşmeyi vurgulama
// ve hızlı geçişteki (Ctrl+K) sıralama.

const lower = (text: string) => text.toLocaleLowerCase('tr-TR')

// Kullanıcının yazdığını SQL "ilike" kalıbına çevirir; %, _ ve \ özel anlamını yitirir.
export function likePattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

export type Part = { text: string; hit: boolean }

// Metni, aranan kelimenin geçtiği yerler işaretli parçalara böler (büyük/küçük harf ayırmadan).
export function splitHighlight(text: string, query: string): Part[] {
  const needle = lower(query.trim())
  if (!needle) return [{ text, hit: false }]
  const haystack = lower(text)
  // Küçük harfe çevirince uzunluk değişirse (ör. "İ") konumlar kayar; o durumda vurgulama yapılmaz.
  if (haystack.length !== text.length) return [{ text, hit: false }]
  const parts: Part[] = []
  let index = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, index)) {
    if (at > index) parts.push({ text: text.slice(index, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    index = at + needle.length
  }
  if (index < text.length) parts.push({ text: text.slice(index), hit: false })
  return parts
}

// Uzun mesajdan, eşleşmenin çevresini gösteren kısa bir alıntı çıkarır.
export function snippet(text: string, query: string, radius = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= radius * 2) return flat
  const at = lower(flat).indexOf(lower(query.trim()))
  const start = Math.max(0, (at === -1 ? 0 : at) - radius)
  const end = Math.min(flat.length, start + radius * 2)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

// Hızlı geçişte bir adın aramaya ne kadar uyduğu: 3 baştan, 2 kelime başından, 1 içinde, 0 uymuyor.
export function matchScore(name: string, query: string): number {
  const needle = lower(query.trim())
  if (!needle) return 1
  const haystack = lower(name)
  if (haystack.startsWith(needle)) return 3
  const at = haystack.indexOf(needle)
  if (at === -1) return 0
  return /[\s\-_.#@]/.test(haystack[at - 1]) ? 2 : 1
}

export type PollTally = { counts: number[]; total: number; percents: number[] }

// Anket sonuçları: seçenek başına oy sayısı ve yüzdesi.
export function tallyVotes(optionCount: number, votes: { option: number }[]): PollTally {
  const counts = Array.from({ length: optionCount }, () => 0)
  for (const vote of votes) if (vote.option >= 0 && vote.option < optionCount) counts[vote.option]++
  const total = counts.reduce((sum, n) => sum + n, 0)
  return { counts, total, percents: counts.map((n) => (total ? Math.round((n / total) * 100) : 0)) }
}
