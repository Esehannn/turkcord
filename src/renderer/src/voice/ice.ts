// Ses ve görüntü yalnızca Cloudflare'e gider: odanın sunucusuna (SFU) doğrudan, UDP kapalıysa Cloudflare'in aktarma
// (TURN) sunucusu üzerinden. Kanaldakiler birbirine bağlanmaz; kimse başkasının IP adresini görmez, adresi yalnızca
// Cloudflare görür. Bağlantı bilgisi (SDP) de yalnızca "oda" Edge Function'ı üzerinden Cloudflare'e gider.

export type IceServer = { urls: string[]; username: string; credential: string }

// Sunucudan gelen listeden yalnızca kimlik bilgisi olan TURN adreslerini bırakır.
export function relayServers(list: unknown): IceServer[] {
  if (!Array.isArray(list)) return []
  const servers: IceServer[] = []
  for (const item of list as ({ urls?: unknown; username?: unknown; credential?: unknown } | null)[]) {
    if (!item || typeof item.username !== 'string' || typeof item.credential !== 'string') continue
    const urls = (Array.isArray(item.urls) ? item.urls : [item.urls]).filter((url): url is string => typeof url === 'string' && /^turns?:/i.test(url))
    if (urls.length) servers.push({ urls, username: item.username, credential: item.credential })
  }
  return servers
}

// Karşı taraf her zaman Cloudflare olduğu için doğrudan bağlantıya izin verilir; aktarma yedektir.
export function rtcConfig(servers: IceServer[]): { iceServers: IceServer[]; iceTransportPolicy: 'all' } {
  return { iceServers: servers, iceTransportPolicy: 'all' }
}
