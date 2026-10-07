// Şifre kuralı. Uygulamadaki kopyası: src/shared/password.ts (ikisi aynı kalmalı).

export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 72

// Sık kullanılan ve tahmin edilmesi kolay şifreler (küçük harfle karşılaştırılır).
const COMMON = new Set([
  '12345678', '123456789', '1234567890', '11111111', '00000000', '87654321', '12341234',
  'password', 'password1', 'password123', 'qwerty123', 'qwertyui', 'asdfghjk', 'abc12345',
  'iloveyou', 'sifre123', 'şifre123', 'parola123', 'turkcord', 'turkcord1', 'turkcord123',
  'galatasaray', 'fenerbahce', 'besiktas', 'trabzonspor', 'istanbul34', 'ankara06', 'turkiye1',
  'a1234567', 'aa123456', 'q1w2e3r4', '1q2w3e4r', 'zxcvbnm1', 'deneme123', 'merhaba1',
])

export type PasswordProblem = 'too_short' | 'too_long' | 'needs_letter_and_digit' | 'too_common' | 'contains_username'

export function checkPassword(password: string, username = ''): PasswordProblem | null {
  if (password.length < MIN_PASSWORD) return 'too_short'
  if (password.length > MAX_PASSWORD) return 'too_long'
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) return 'needs_letter_and_digit'
  const lower = password.toLocaleLowerCase('tr-TR')
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'too_common'
  if (username.length >= 3 && lower.includes(username.toLocaleLowerCase('tr-TR'))) return 'contains_username'
  return null
}
