import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tuneOpus } from '../src/renderer/src/voice/sdp.ts'

const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  '',
].join('\r\n')

test('Opus bit hızı 64 kbps yapılır, mevcut ayarlar korunur', () => {
  const tuned = tuneOpus(SDP)
  const line = tuned.split('\r\n').find((l) => l.startsWith('a=fmtp:111'))
  assert.ok(line)
  assert.match(line, /minptime=10/)
  assert.match(line, /maxaveragebitrate=64000/)
  assert.match(line, /useinbandfec=1/)
  assert.match(line, /usedtx=1/)
  assert.equal((line.match(/useinbandfec/g) ?? []).length, 1)
})

test('fmtp satırı yoksa eklenir', () => {
  const tuned = tuneOpus('a=rtpmap:109 opus/48000/2\r\n')
  assert.match(tuned, /a=fmtp:109 maxaveragebitrate=64000/)
})

test('Opus yoksa SDP değişmez', () => {
  const sdp = 'a=rtpmap:0 PCMU/8000\r\n'
  assert.equal(tuneOpus(sdp), sdp)
})
