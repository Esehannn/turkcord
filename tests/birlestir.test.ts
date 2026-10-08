import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coalesce } from '../src/renderer/src/lib/coalesce.ts'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('hızlı tetiklemeler birleşir, son durum mutlaka gönderilir', async () => {
  let state = 0
  const sent: number[] = []
  const { trigger } = coalesce(() => void sent.push(state), 40)

  // İlk tetikleme hemen gider; ardından gelen 20 hızlı değişiklik tek gönderimde birleşir.
  for (let i = 1; i <= 21; i++) {
    state = i
    trigger()
    if (i === 1) await wait(5)
  }
  await wait(120)
  assert.equal(sent[0], 1)
  assert.equal(sent.at(-1), 21)
  assert.ok(sent.length <= 3, `en fazla 3 gönderim beklenirdi, ${sent.length} oldu`)
})

test('gönderimler üst üste binmez; sürerken gelen değişiklik sonradan gider', async () => {
  let state = 'a'
  let active = 0
  let overlap = false
  const sent: string[] = []
  const { trigger } = coalesce(async () => {
    active++
    if (active > 1) overlap = true
    const snapshot = state
    await wait(30)
    sent.push(snapshot)
    active--
  }, 10)

  trigger()
  await wait(15)
  state = 'b'
  trigger()
  state = 'c'
  trigger()
  await wait(120)
  assert.equal(overlap, false)
  assert.deepEqual(sent, ['a', 'c'])
})

test('iptal edilince bekleyen gönderim yapılmaz', async () => {
  let count = 0
  const { trigger, cancel } = coalesce(() => void count++, 20)
  trigger()
  await wait(5)
  trigger()
  cancel()
  await wait(60)
  assert.equal(count, 1)
})
