import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterMentions, insertMention, mentionQuery } from '../src/renderer/src/lib/mentions.ts'

const people = [
  { id: '1', username: 'ayse', display_name: 'Ayşe Çelik' },
  { id: '2', username: 'veli', display_name: 'Veli Usta' },
  { id: '3', username: 'ismail', display_name: 'İsmail' },
  { id: '4', username: 'kral_ali', display_name: 'Ali' },
]

test('imlecin solundaki etiket bulunur', () => {
  assert.deepEqual(mentionQuery('selam @ay', 9), { start: 6, query: 'ay' })
  assert.deepEqual(mentionQuery('@', 1), { start: 0, query: '' })
  assert.equal(mentionQuery('mail@site', 9), null)
  assert.equal(mentionQuery('selam ay', 8), null)
})

test('kullanıcı adı ve görünen ada göre, Türkçe harflerle eşleşir', () => {
  assert.deepEqual(filterMentions(people, 'ay').map((p) => p.id), ['1'])
  assert.deepEqual(filterMentions(people, 'cel').map((p) => p.id), ['1'])
  assert.deepEqual(filterMentions(people, 'İs').map((p) => p.id), ['3'])
  assert.deepEqual(filterMentions(people, 'ali').map((p) => p.id), ['4'])
  assert.equal(filterMentions(people, '').length, 4)
})

test('seçilen kişi yazılan parçanın yerine konur', () => {
  assert.deepEqual(insertMention('selam @ay nasılsın', 6, 9, 'ayse'), { text: 'selam @ayse nasılsın', caret: 12 })
  assert.deepEqual(insertMention('@v', 0, 2, 'veli'), { text: '@veli ', caret: 6 })
})
