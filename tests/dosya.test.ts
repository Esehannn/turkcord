import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callText, clock, fileKind, formatBytes, formatDuration, parseCall, safeFileName } from '../src/renderer/src/lib/files.ts'

test('dosya boyutu', () => {
  assert.equal(formatBytes(12), '12 B')
  assert.equal(formatBytes(820 * 1024), '820 KB')
  assert.equal(formatBytes(1.4 * 1024 * 1024), '1,4 MB')
  assert.equal(formatBytes(25 * 1024 * 1024), '25 MB')
})

test('ek türü', () => {
  assert.equal(fileKind({ path: 'k/u/a.webp', type: 'image/webp' }), 'image')
  // Eski mesajlarda tür ve ad yok; hepsi görseldi.
  assert.equal(fileKind({ path: 'k/u/a.webp' }), 'image')
  assert.equal(fileKind({ path: 'k/u/x.pdf', type: 'application/pdf', name: 'rapor.pdf' }), 'file')
  assert.equal(fileKind({ path: 'k/u/x.mp3', type: 'audio/mpeg', name: 'şarkı.mp3' }), 'audio')
  assert.equal(fileKind({ path: 'k/u/x.mp4', type: 'video/mp4', name: 'klip.mp4' }), 'video')
  assert.equal(fileKind({ path: 'k/u/x.avi', type: 'video/x-msvideo', name: 'klip.avi' }), 'file')
  // SVG betik taşıyabildiği için görsel olarak gösterilmez.
  assert.equal(fileKind({ path: 'k/u/x.svg', type: 'image/svg+xml', name: 'logo.svg' }), 'file')
  assert.equal(fileKind({ path: 'k/u/x.zip', name: 'arşiv.zip' }), 'file')
})

test('güvenli dosya adı', () => {
  assert.equal(safeFileName('Ödev Raporu (son).PDF'), 'Odev-Raporu-son.pdf')
  assert.equal(safeFileName('../../etc/passwd'), 'etc-passwd')
  assert.equal(safeFileName('ışık.txt'), 'isik.txt')
  assert.equal(safeFileName('???'), 'dosya')
})

test('arama kaydı', () => {
  assert.deepEqual(parseCall('missed'), { status: 'missed', seconds: null })
  assert.deepEqual(parseCall('declined'), { status: 'declined', seconds: null })
  assert.deepEqual(parseCall('ended:187'), { status: 'ended', seconds: 187 })
  assert.deepEqual(parseCall('ended'), { status: 'ended', seconds: null })
  assert.equal(callText('missed', false), 'Cevapsız arama')
  assert.equal(callText('missed', true), 'Cevaplanmayan arama')
  assert.equal(callText('ended:187', true), 'Sesli arama · 3 dk 7 sn')
})

test('süre', () => {
  assert.equal(formatDuration(42), '42 sn')
  assert.equal(formatDuration(120), '2 dk')
  assert.equal(formatDuration(3725), '1 sa 2 dk')
  assert.equal(clock(187), '03:07')
  assert.equal(clock(3765), '1:02:45')
})
