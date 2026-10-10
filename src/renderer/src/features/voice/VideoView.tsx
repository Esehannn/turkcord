import { useEffect, useRef } from 'react'
import { useVoice } from '@/voice/store'
import { unwatch, watch } from '@/voice/video'

// Bir görüntü akışını gösterir. audio: akıştaki ses de çalınsın mı (ekran paylaşımındaki bilgisayar sesi);
// sağırlaştırılmışken o da susar. mirror: kendi kameram ayna gibi gösterilir.
export function VideoView({
  stream,
  audio = false,
  mirror = false,
  fit = 'contain',
  className = '',
}: {
  stream: MediaStream
  audio?: boolean
  mirror?: boolean
  fit?: 'contain' | 'cover'
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const deafened = useVoice((s) => s.deafened)
  const outputDeviceId = useVoice((s) => s.outputDeviceId)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])

  // Ses, sesli sohbetle aynı hoparlörden çıkar.
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (audio && el?.setSinkId) void el.setSinkId(outputDeviceId === 'default' ? '' : outputDeviceId).catch(() => {})
  }, [audio, outputDeviceId])

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={!audio || deafened}
      className={`size-full bg-black ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${mirror ? '-scale-x-100' : ''} ${className}`}
    />
  )
}

// Verilen kişilerin kameralarını izler; listeden çıkanı ve bileşen kapanınca hepsini bırakır.
// Kameralar yalnızca onları gösteren ekran açıkken izlenir (arka planda boşuna görüntü çözülmez).
export function useCameraFeeds(userIds: string[], enabled: boolean): void {
  const watching = useRef(new Set<string>())
  const wanted = enabled ? userIds.join(',') : ''

  useEffect(() => {
    const next = new Set(wanted ? wanted.split(',') : [])
    for (const id of watching.current) {
      if (!next.has(id)) {
        unwatch(id, 'camera')
        watching.current.delete(id)
      }
    }
    for (const id of next) {
      if (!watching.current.has(id)) {
        watch(id, 'camera')
        watching.current.add(id)
      }
    }
  }, [wanted])

  useEffect(() => {
    const set = watching.current
    return () => {
      for (const id of set) unwatch(id, 'camera')
      set.clear()
    }
  }, [])
}
