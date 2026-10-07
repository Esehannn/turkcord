import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isEmojiOnly, mentionsUser, parseMessage } from '../src/renderer/src/lib/markdown.ts'

test('düz metin tek parça kalır', () => {
  assert.deepEqual(parseMessage('Selam millet'), [{ t: 'text', v: 'Selam millet' }])
})

test('HTML etiketleri metin olarak kalır, çalıştırılmaz', () => {
  assert.deepEqual(parseMessage('<img src=x onerror=alert(1)>'), [{ t: 'text', v: '<img src=x onerror=alert(1)>' }])
})

test('kalın, italik, üstü çizili ve spoiler', () => {
  assert.deepEqual(parseMessage('**çay** *simit* ~~kahve~~ ||sır||'), [
    { t: 'bold', c: [{ t: 'text', v: 'çay' }] },
    { t: 'text', v: ' ' },
    { t: 'italic', c: [{ t: 'text', v: 'simit' }] },
    { t: 'text', v: ' ' },
    { t: 'strike', c: [{ t: 'text', v: 'kahve' }] },
    { t: 'text', v: ' ' },
    { t: 'spoiler', c: [{ t: 'text', v: 'sır' }] },
  ])
})

test('iç içe biçim', () => {
  assert.deepEqual(parseMessage('**kalın *ve italik* yazı**'), [
    {
      t: 'bold',
      c: [{ t: 'text', v: 'kalın ' }, { t: 'italic', c: [{ t: 'text', v: 've italik' }] }, { t: 'text', v: ' yazı' }],
    },
  ])
})

test('kod içindeki işaretler biçimlendirilmez', () => {
  assert.deepEqual(parseMessage('`**x**` ve ```\nconst a = *b*\n```'), [
    { t: 'code', v: '**x**' },
    { t: 'text', v: ' ve ' },
    { t: 'codeblock', v: 'const a = *b*' },
  ])
})

test('bağlantılar sondaki noktalama olmadan yakalanır', () => {
  assert.deepEqual(parseMessage('bak: https://ornek.com/a?b=1.'), [
    { t: 'text', v: 'bak: ' },
    { t: 'link', v: 'https://ornek.com/a?b=1' },
    { t: 'text', v: '.' },
  ])
})

test('javascript: bağlantıları bağlantı sayılmaz', () => {
  assert.deepEqual(parseMessage('javascript:alert(1)'), [{ t: 'text', v: 'javascript:alert(1)' }])
})

test('etiketler küçük harfe çevrilir, e-posta adresleri etiket sayılmaz', () => {
  assert.deepEqual(parseMessage('@Veli bak, ali@site.com'), [
    { t: 'mention', v: 'veli' },
    { t: 'text', v: ' bak, ali@site.com' },
  ])
  assert.equal(mentionsUser('selam @veli', 'veli'), true)
  assert.equal(mentionsUser('selam @velican', 'veli'), false)
  assert.equal(mentionsUser('`@veli`', 'veli'), false)
})

test('satır sonları korunur', () => {
  assert.deepEqual(parseMessage('a\nb'), [{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }])
})

test('çok derin iç içe biçim düz metne döner', () => {
  const deep = '**'.repeat(20) + 'x' + '**'.repeat(20)
  assert.doesNotThrow(() => parseMessage(deep))
})

test('sadece emoji içeren mesajlar', () => {
  assert.equal(isEmojiOnly('☕'), true)
  assert.equal(isEmojiOnly('🇹🇷 ☕'), true)
  assert.equal(isEmojiOnly('çay ☕'), false)
  assert.equal(isEmojiOnly('123'), false)
  assert.equal(isEmojiOnly(''), false)
})
