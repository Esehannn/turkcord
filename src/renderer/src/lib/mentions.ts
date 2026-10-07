// "@" ile etiketleme için otomatik tamamlama yardımcıları.

export type MentionCandidate = { id: string; username: string; display_name: string }

// İmlecin hemen solunda yazılmakta olan "@ali" gibi bir etiket var mı?
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|[\s(])@([A-Za-z0-9_.]{0,20})$/.exec(before)
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

// Türkçe harfleri sadeleştirir: "Ayşe Çelik" → "ayse celik".
function fold(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function filterMentions(candidates: MentionCandidate[], query: string, limit = 8): MentionCandidate[] {
  const q = fold(query)
  const scored: { c: MentionCandidate; score: number }[] = []
  for (const c of candidates) {
    const user = fold(c.username)
    const name = fold(c.display_name)
    let score = -1
    if (!q) score = 0
    else if (user.startsWith(q)) score = 3
    else if (name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) score = 2
    else if (user.includes(q) || name.includes(q)) score = 1
    if (score >= 0) scored.push({ c, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.c.display_name.localeCompare(b.c.display_name, 'tr'))
    .slice(0, limit)
    .map((s) => s.c)
}

// Seçilen kişiyi metne yerleştirir; yeni metin ve imlecin yeni yerini döner.
export function insertMention(text: string, start: number, caret: number, username: string): { text: string; caret: number } {
  const insert = `@${username} `
  const after = text.slice(caret).replace(/^[A-Za-z0-9_.]*/, '').replace(/^ /, '')
  return { text: text.slice(0, start) + insert + after, caret: start + insert.length }
}
