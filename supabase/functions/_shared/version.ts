// Uygulama sürümü karşılaştırma ("0.8.0" biçimi). Asgari sürüm kontrolünde kullanılır (bkz. turn/index.ts).

// "0.8.0" → [0, 8, 0]; tanınmayan biçimde null.
export function parseVersion(version: unknown): number[] | null {
  if (typeof version !== 'string') return null
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(version.trim())
  return match ? match.slice(1).map(Number) : null
}

// true: sürüm asgari sürümden eski değil. Sürüm okunamıyorsa eski sayılır; asgari sürüm okunamıyorsa (yanlış
// yazılmış ayar herkesi dışarıda bırakmasın diye) sınır yok sayılır.
export function versionAtLeast(version: unknown, minimum: unknown): boolean {
  const min = parseVersion(minimum)
  if (!min) return true
  const current = parseVersion(version)
  if (!current) return false
  for (let i = 0; i < 3; i++) if (current[i] !== min[i]) return current[i] > min[i]
  return true
}
