import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relayConfig, relayServers } from '../src/renderer/src/voice/ice.ts'
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

test('ICE listesinden yalnızca kimlik bilgili TURN adresleri kalır', () => {
  const servers = relayServers([
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
    {
      urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
      username: 'kullanici',
      credential: 'sifre',
    },
    { urls: 'turn:turn.cloudflare.com:80?transport=tcp', username: 'kullanici', credential: 'sifre' },
    // Kimlik bilgisi olmayan TURN adresi işe yaramaz.
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp'] },
  ])
  assert.deepEqual(servers, [
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'kullanici', credential: 'sifre' },
    { urls: ['turn:turn.cloudflare.com:80?transport=tcp'], username: 'kullanici', credential: 'sifre' },
  ])
})

test('TURN yoksa liste boştur (doğrudan bağlantıya dönülmez)', () => {
  assert.deepEqual(relayServers([{ urls: ['stun:stun.cloudflare.com:3478'] }]), [])
  assert.deepEqual(relayServers([]), [])
  assert.deepEqual(relayServers(undefined), [])
  assert.deepEqual(relayServers([null, 'turn:turn.cloudflare.com:3478', { urls: 5, username: 'k', credential: 's' }]), [])
})

test('bağlantı ayarı yalnızca aktarmaya izin verir', () => {
  const servers = relayServers([{ urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'k', credential: 's' }])
  assert.deepEqual(relayConfig(servers), { iceServers: servers, iceTransportPolicy: 'relay' })
})
