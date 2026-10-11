// Ses ve görüntü yalnızca Cloudflare'in aktarma (TURN) sunucusundan geçer; doğrudan (P2P) bağlantı kurulmaz.
// Böylece kanaldaki kişiler birbirinin IP adresini değil, Cloudflare'inkini görür. Aktarma bilgisi yoksa
// bağlantı hiç kurulmaz; doğrudan bağlantıya geri dönülmez.

export type IceServer = { urls: string[]; username: string; credential: string }

// Sunucudan gelen listeden yalnızca kimlik bilgisi olan TURN adreslerini bırakır. STUN alınmaz: tek işi kendi
// adresimi öğrenip karşıya bildirmektir.
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

// iceTransportPolicy 'relay': tarayıcı yerel ve genel adres adaylarını hiç üretmez, karşıya yalnızca aktarma adresi gider.
export function relayConfig(servers: IceServer[]): { iceServers: IceServer[]; iceTransportPolicy: 'relay' } {
  return { iceServers: servers, iceTransportPolicy: 'relay' }
}
