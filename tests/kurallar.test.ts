import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkPassword } from '../src/shared/password.ts'
import { isValidUsername, usernameProblem, usernameToEmail } from '../src/shared/username.ts'
import { formatMessageTime, normalizeChannelName, sameGroup } from '../src/renderer/src/lib/format.ts'
import { versionAtLeast } from '../supabase/functions/_shared/version.ts'

test('şifre kuralları', () => {
  assert.equal(checkPassword('kisa1'), 'too_short')
  assert.equal(checkPassword('sadeceharf'), 'needs_letter_and_digit')
  assert.equal(checkPassword('12345678'), 'needs_letter_and_digit')
  assert.equal(checkPassword('Sifre123'), 'too_common')
  assert.equal(checkPassword('veli2026x', 'veli'), 'contains_username')
  assert.equal(checkPassword('Çaycı-Hüseyin-42', 'veli'), null)
})

test('uygulamadaki ve sunucudaki şifre kuralı aynı', () => {
  const body = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').split('\n').slice(2).join('\n')
  const app = body('../src/shared/password.ts').split('export const PASSWORD_MESSAGES')[0]
  const server = body('../supabase/functions/_shared/password.ts')
  assert.equal(app.trim(), server.trim())
})

test('kullanıcı adı kuralları', () => {
  assert.equal(isValidUsername('veli_34'), true)
  assert.equal(isValidUsername('ali.can'), true)
  assert.equal(isValidUsername('.ali'), false)
  assert.equal(isValidUsername('ali..can'), false)
  assert.equal(isValidUsername('Ali'), false)
  assert.equal(isValidUsername('ab'), false)
  assert.match(usernameProblem('ğğğ') ?? '', /küçük harf/)
  assert.equal(usernameToEmail(' Veli '), 'veli@kullanici.turkcord.invalid')
})

test('asgari sürüm karşılaştırması', () => {
  assert.equal(versionAtLeast('0.8.0', '0.8.0'), true)
  assert.equal(versionAtLeast('0.8.1', '0.8.0'), true)
  assert.equal(versionAtLeast('0.10.0', '0.9.9'), true)
  assert.equal(versionAtLeast('1.0.0', '0.99.99'), true)
  assert.equal(versionAtLeast('0.7.9', '0.8.0'), false)
  assert.equal(versionAtLeast('0.7.10', '0.8.0'), false)
  // Sürümünü bildirmeyen ya da bozuk bildiren eski sayılır.
  assert.equal(versionAtLeast(undefined, '0.8.0'), false)
  assert.equal(versionAtLeast('9.9', '0.8.0'), false)
  assert.equal(versionAtLeast('9.9.9-beta', '0.8.0'), false)
  // Asgari sürüm yanlış yazılmışsa kimse dışarıda kalmaz.
  assert.equal(versionAtLeast('0.1.0', 'sekiz'), true)
  assert.equal(versionAtLeast(undefined, ''), true)
})

test('saat biçimi', () => {
  const now = new Date(2026, 9, 7, 20, 0)
  assert.match(formatMessageTime(new Date(2026, 9, 7, 14, 32).toISOString(), now), /^Bugün 14:32$/)
  assert.match(formatMessageTime(new Date(2026, 9, 6, 9, 5).toISOString(), now), /^Dün 09:05$/)
  assert.match(formatMessageTime(new Date(2026, 9, 1, 9, 5).toISOString(), now), /^01\.10\.2026 09:05$/)
})

test('mesaj gruplama', () => {
  const a = { author_id: 'x', created_at: new Date(2026, 9, 7, 10, 0).toISOString() }
  assert.equal(sameGroup(a, { author_id: 'x', created_at: new Date(2026, 9, 7, 10, 5).toISOString() }), true)
  assert.equal(sameGroup(a, { author_id: 'x', created_at: new Date(2026, 9, 7, 10, 9).toISOString() }), false)
  assert.equal(sameGroup(a, { author_id: 'y', created_at: new Date(2026, 9, 7, 10, 1).toISOString() }), false)
})

test('kanal adı', () => {
  assert.equal(normalizeChannelName('  Oyun Saati! '), 'oyun-saati')
  assert.equal(normalizeChannelName('İSTANBUL Çay'), 'istanbul-çay')
})
