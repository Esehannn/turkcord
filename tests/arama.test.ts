import { test } from 'node:test'
import assert from 'node:assert/strict'
import { likePattern, matchScore, snippet, splitHighlight, tallyVotes } from '../src/renderer/src/lib/search.ts'

test('arama kalıbı özel karakterleri etkisizleştirir', () => {
  assert.equal(likePattern('  çay  '), '%çay%')
  assert.equal(likePattern('%100'), '%\\%100%')
  assert.equal(likePattern('a_b\\c'), '%a\\_b\\\\c%')
})

test('eşleşme vurgulanır', () => {
  assert.deepEqual(splitHighlight('Çay demle, çay iç', 'çay'), [
    { text: 'Çay', hit: true },
    { text: ' demle, ', hit: false },
    { text: 'çay', hit: true },
    { text: ' iç', hit: false },
  ])
  assert.deepEqual(splitHighlight('merhaba', ''), [{ text: 'merhaba', hit: false }])
  assert.deepEqual(splitHighlight('merhaba', 'yok'), [{ text: 'merhaba', hit: false }])
  // Türkçe büyük/küçük harf: "IŞIK" ile "ışık" eşleşir.
  assert.equal(splitHighlight('IŞIK açık', 'ışık')[0].hit, true)
})

test('uzun mesajdan alıntı', () => {
  assert.equal(snippet('kısa  mesaj\nburada', 'mesaj'), 'kısa mesaj burada')
  const long = `${'a'.repeat(200)} hedef ${'b'.repeat(200)}`
  const cut = snippet(long, 'hedef', 20)
  assert.ok(cut.startsWith('…') && cut.endsWith('…'))
  assert.ok(cut.includes('hedef'))
  assert.ok(cut.length <= 42)
})

test('hızlı geçiş sıralaması', () => {
  assert.equal(matchScore('genel', 'gen'), 3)
  assert.equal(matchScore('oyun-sohbet', 'soh'), 2)
  assert.equal(matchScore('Ali Kurucu', 'kur'), 2)
  assert.equal(matchScore('sohbet', 'hbe'), 1)
  assert.equal(matchScore('sohbet', 'xyz'), 0)
  assert.equal(matchScore('İstanbul', 'ist'), 3)
  assert.equal(matchScore('herhangi', ''), 1)
})

test('anket sonuçları', () => {
  assert.deepEqual(tallyVotes(3, [{ option: 0 }, { option: 2 }, { option: 2 }, { option: 9 }]), {
    counts: [1, 0, 2],
    total: 3,
    percents: [33, 0, 67],
  })
  assert.deepEqual(tallyVotes(2, []), { counts: [0, 0], total: 0, percents: [0, 0] })
})
