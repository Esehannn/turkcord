import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relayServers, rtcConfig } from '../src/renderer/src/voice/ice.ts'
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

test('bağlantı ayarı Cloudflare aktarmasını yedek olarak ekler', () => {
  const servers = relayServers([{ urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'k', credential: 's' }])
  assert.deepEqual(rtcConfig(servers), { iceServers: servers, iceTransportPolicy: 'all' })
})


test('görüntü kodeklerine başlangıç hızı yazılır; ses, rtx ve eski değer dokunulmaz/yenilenir', async () => {
  const { startBitrate } = await import('../src/renderer/src/voice/sdp.ts')
  const sdp = [
    'v=0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
    'a=rtpmap:96 VP8/90000',
    'a=rtpmap:97 rtx/90000',
    'a=fmtp:97 apt=96',
    'a=rtpmap:98 H264/90000',
    'a=fmtp:98 packetization-mode=1;x-google-start-bitrate=100',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10',
    '',
  ].join('\r\n')
  const lines = startBitrate(sdp, 3000).split('\r\n')
  assert.equal(lines[lines.indexOf('a=rtpmap:96 VP8/90000') + 1], 'a=fmtp:96 x-google-start-bitrate=3000')
  assert.ok(lines.includes('a=fmtp:97 apt=96'))
  assert.ok(lines.includes('a=fmtp:98 packetization-mode=1;x-google-start-bitrate=3000'))
  assert.ok(lines.includes('a=fmtp:111 minptime=10'))
  assert.equal(lines.length, sdp.split('\r\n').length + 1)
})

test('Cloudflare teklifinde BUNDLE grubu yoksa açık bölümlerle eklenir', async () => {
  const { fixOffer } = await import('../src/renderer/src/voice/sdp.ts')
  const offer = ['v=0', 's=-', 'm=video 0 X 96', 'a=mid:0', 'm=video 9 X 96', 'a=mid:1', 'm=audio 9 X 111', 'a=mid:2', ''].join('\r\n')
  assert.equal(fixOffer(offer).split('\r\n')[2], 'a=group:BUNDLE 1 2')
  const grouped = ['v=0', 'a=group:BUNDLE 0', 'm=audio 9 X 111', 'a=mid:0', ''].join('\r\n')
  assert.equal(fixOffer(grouped), grouped)
})
