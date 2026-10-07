// Klavye tuş kodlarını (KeyboardEvent.code) okunur hale getirir.
const NAMES: Record<string, string> = {
  Space: 'Boşluk',
  Backquote: '"',
  CapsLock: 'Caps Lock',
  Tab: 'Tab',
  ShiftLeft: 'Sol Shift',
  ShiftRight: 'Sağ Shift',
  ControlLeft: 'Sol Ctrl',
  ControlRight: 'Sağ Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Geri',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
}

export function keyLabel(code: string): string {
  if (NAMES[code]) return NAMES[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  if (/^F\d+$/.test(code)) return code
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code
  return code
}

// Harf, rakam ya da boşluk tuşu yazı alanındayken bas-konuş sayılmaz (yazı yazmayı bozmasın).
export function blocksTyping(code: string, target: EventTarget | null): boolean {
  if (!/^(Key|Digit)|^Space$/.test(code)) return false
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}
