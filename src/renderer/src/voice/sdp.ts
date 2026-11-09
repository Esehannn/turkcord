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

// Görüntünün başlangıç hızı (kbps). Tarayıcı yeni bir bağlantıya ~300 kbps ile başlayıp yavaşça yükselir; ekran
// paylaşımı bu yüzden ilk ~20 sn 360p'de kalıyordu. Cloudflare'in cevabındaki görüntü kodeklerine yazılınca tarayıcı
// tahminine buradan başlar (yetmezse yine düşürür). Ölçüm: 1080p60 yayında 720p'ye 2. saniyede çıkıyor.
const VIDEO_CODEC = /^a=rtpmap:(\d+) (VP8|VP9|H264|H265|AV1)\/90000/gim

export function startBitrate(sdp: string, kbps: number): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n'
  const value = `x-google-start-bitrate=${Math.round(kbps)}`
  for (const [, payload] of sdp.matchAll(VIDEO_CODEC)) {
    const fmtp = new RegExp(`^(a=fmtp:${payload} )([^\\r\\n]*)$`, 'm')
    if (fmtp.test(sdp)) {
      sdp = sdp.replace(fmtp, (_, head: string, params: string) =>
        head + [...params.split(';').filter((p) => p && !p.trim().startsWith('x-google-start-bitrate=')), value].join(';'),
      )
    } else {
      sdp = sdp.replace(new RegExp(`^(a=rtpmap:${payload} [^\\r\\n]*)$`, 'm'), `$1${eol}a=fmtp:${payload} ${value}`)
    }
  }
  return sdp
}

// Cloudflare'in yeniden pazarlık teklifinde BUNDLE grubu yoksa açık (portu 0 olmayan) bölümlerle eklenir: bağlantımız
// "max-bundle" ile kurulu ve tarayıcı grupsuz teklifi reddeder. (Grubun başındaki izi kapattığımız bir oturuma
// gelen teklifi ise tarayıcı hiçbir şekilde kabul etmiyor; o durumda oturum baştan kurulur, bkz. video.ts.)
export function fixOffer(sdp: string): string {
  if (/^a=group:BUNDLE/m.test(sdp)) return sdp
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(eol)
  const first = lines.findIndex((l) => l.startsWith('m='))
  if (first < 0) return sdp
  const mids: string[] = []
  let open = false
  for (const line of lines.slice(first)) {
    if (line.startsWith('m=')) open = line.split(' ')[1] !== '0'
    else if (open && line.startsWith('a=mid:')) mids.push(line.slice(6).trim())
  }
  if (!mids.length) return sdp
  lines.splice(first, 0, `a=group:BUNDLE ${mids.join(' ')}`)
  return lines.join(eol)
}
