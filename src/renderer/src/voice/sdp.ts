// Opus ses kodeği ayarları. Tarayıcının varsayılanı ~32 kbps; konuşma için 64 kbps daha net ve doğal duyulur.
// useinbandfec: paket kaybında sesi onarır, usedtx: sessizken neredeyse hiç veri göndermez.
const OPUS_PARAMS: Record<string, string> = {
  maxaveragebitrate: '64000',
  useinbandfec: '1',
  usedtx: '1',
  stereo: '0',
}

export function tuneOpus(sdp: string): string {
  const payload = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1]
  if (!payload) return sdp
  const fmtp = new RegExp(`^a=fmtp:${payload} (.*)$`, 'm')
  const match = fmtp.exec(sdp)
  if (!match) return sdp.replace(new RegExp(`(a=rtpmap:${payload} opus/48000[^\\r\\n]*)`, 'i'), `$1\r\na=fmtp:${payload} ${serialize({}, OPUS_PARAMS)}`)
  const current = Object.fromEntries(
    match[1]
      .trim()
      .split(';')
      .filter(Boolean)
      .map((pair) => {
        const [key, ...rest] = pair.split('=')
        return [key.trim(), rest.join('=').trim()]
      }),
  )
  return sdp.replace(fmtp, `a=fmtp:${payload} ${serialize(current, OPUS_PARAMS)}`)
}

function serialize(current: Record<string, string>, extra: Record<string, string>): string {
  return Object.entries({ ...current, ...extra })
    .map(([k, v]) => `${k}=${v}`)
    .join(';')
}
