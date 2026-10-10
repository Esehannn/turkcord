import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elapsedLabel, muteDeadline } from '../src/renderer/src/lib/format.ts'

test('geçen süre dakika ve saat olarak yazılır', () => {
  assert.equal(elapsedLabel(0), 'şimdi')
  assert.equal(elapsedLabel(59_000), 'şimdi')
  assert.equal(elapsedLabel(60_000), '1 dk')
  assert.equal(elapsedLabel(42 * 60_000 + 30_000), '42 dk')
  assert.equal(elapsedLabel(60 * 60_000), '1 sa')
  assert.equal(elapsedLabel(65 * 60_000), '1 sa 5 dk')
  assert.equal(elapsedLabel(25 * 60 * 60_000), '25 sa')
})

test('saatler uyuşmazsa (karşı tarafın saati ileride) süre eksiye düşmez', () => {
  assert.equal(elapsedLabel(-5_000), 'şimdi')
})

test('sessize alma süreleri', () => {
  const now = new Date(2026, 9, 11, 22, 30)
  assert.equal(muteDeadline('saat', now), now.getTime() + 3_600_000)
  assert.equal(muteDeadline('sekiz-saat', now), now.getTime() + 8 * 3_600_000)
  assert.equal(muteDeadline('suresiz', now), null)
})

test('"yarın sabaha kadar" ertesi gün 08.00\'de biter', () => {
  assert.equal(muteDeadline('yarin', new Date(2026, 9, 11, 22, 30)), new Date(2026, 9, 12, 8).getTime())
  // Gece yarısından sonra da "yarın" bir sonraki takvim günüdür.
  assert.equal(muteDeadline('yarin', new Date(2026, 9, 12, 1, 0)), new Date(2026, 9, 13, 8).getTime())
  // Ay sonunda bir sonraki aya geçer.
  assert.equal(muteDeadline('yarin', new Date(2026, 9, 31, 12)), new Date(2026, 10, 1, 8).getTime())
})
