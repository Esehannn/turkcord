// Mesaj biçimlendirme: metni güvenli parçalara ayırır. HTML asla üretilmez; arayüz bu parçaları
// React öğelerine çevirir, böylece mesajlardan betik çalıştırılamaz.
// Desteklenenler: **kalın**, *italik*, ~~üstü çizili~~, ||spoiler||, `kod`, ```kod bloğu```,
// http(s) bağlantıları ve @kullanıcı etiketleri.

export type Token =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'code'; v: string }
  | { t: 'codeblock'; v: string }
  | { t: 'link'; v: string }
  | { t: 'mention'; v: string }
  | { t: 'bold' | 'italic' | 'strike' | 'spoiler'; c: Token[] }

const CODE_BLOCK = /```(?:[a-zA-Z0-9+#-]*\n)?([\s\S]*?)```/g

const INLINE = new RegExp(
  [
    '`(?<code>[^`\\n]+)`',
    '\\*\\*(?<bold>[\\s\\S]+?)\\*\\*',
    '~~(?<strike>[\\s\\S]+?)~~',
    '\\|\\|(?<spoiler>[\\s\\S]+?)\\|\\|',
    '\\*(?<italic>[^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*',
    '(?<link>https?:\\/\\/[^\\s<>"]*[^\\s<>".,:;\'!?)\\]])',
    '(?<![\\w@.])@(?<mention>[A-Za-z0-9_.]{3,20})',
    '(?<br>\\n)',
  ].join('|'),
  'g',
)

const MAX_DEPTH = 4

function pushText(out: Token[], text: string): void {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.t === 'text') last.v += text
  else out.push({ t: 'text', v: text })
}

function parseInline(text: string, depth: number): Token[] {
  const out: Token[] = []
  if (depth > MAX_DEPTH) {
    pushText(out, text)
    return out
  }
  const re = new RegExp(INLINE.source, 'g')
  let index = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    pushText(out, text.slice(index, m.index))
    const g = m.groups ?? {}
    if (g.code !== undefined) out.push({ t: 'code', v: g.code })
    else if (g.bold !== undefined) out.push({ t: 'bold', c: parseInline(g.bold, depth + 1) })
    else if (g.strike !== undefined) out.push({ t: 'strike', c: parseInline(g.strike, depth + 1) })
    else if (g.spoiler !== undefined) out.push({ t: 'spoiler', c: parseInline(g.spoiler, depth + 1) })
    else if (g.italic !== undefined) out.push({ t: 'italic', c: parseInline(g.italic, depth + 1) })
    else if (g.link !== undefined) out.push({ t: 'link', v: g.link })
    else if (g.mention !== undefined) out.push({ t: 'mention', v: g.mention.toLowerCase() })
    else if (g.br !== undefined) out.push({ t: 'br' })
    index = m.index + m[0].length
  }
  pushText(out, text.slice(index))
  return out
}

export function parseMessage(content: string): Token[] {
  const out: Token[] = []
  let index = 0
  const re = new RegExp(CODE_BLOCK.source, 'g')
  for (let m = re.exec(content); m; m = re.exec(content)) {
    out.push(...parseInline(content.slice(index, m.index), 0))
    out.push({ t: 'codeblock', v: m[1].replace(/\n$/, '') })
    index = m.index + m[0].length
  }
  out.push(...parseInline(content.slice(index), 0))
  return out
}

// Sadece birkaç emojiden oluşan mesajlar büyük gösterilir.
export function isEmojiOnly(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed || trimmed.length > 32) return false
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator}|‍|️|\s)+$/u.test(trimmed)) {
    return false
  }
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(trimmed) && !/^[\d#*\s]+$/.test(trimmed)
}

export function mentionsUser(content: string, username: string): boolean {
  if (!username) return false
  return parseMessage(content).some(function walk(token: Token): boolean {
    if (token.t === 'mention') return token.v === username
    if ('c' in token) return token.c.some(walk)
    return false
  })
}
