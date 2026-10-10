import { Maximize2, X } from 'lucide-react'
import { useProfiles } from '@/data/queries'
import { useUi } from '@/stores/ui'
import { useVoice } from '@/voice/store'
import { unwatch } from '@/voice/video'
import { rememberedChannel } from '@/features/layout/ServerRail'
import { VideoView } from './VideoView'

// Küçük oynatıcı: bir ekran paylaşımı izlenirken başka bir kanala ya da sohbete geçilirse yayın sağ altta
// küçük pencerede (yazı kutusunun üstünde) sürer. Tıklayınca ses odasına (ya da aramanın olduğu sohbete) döner.
export function MiniPlayer() {
  const videos = useVoice((s) => s.videos)
  const channelId = useVoice((s) => s.channelId)
  const serverId = useVoice((s) => s.serverId)
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const { data: profiles } = useProfiles()

  const key = Object.keys(videos).find((k) => k.endsWith(':screen') && videos[k])
  if (!key || !channelId) return null
  // Yayının zaten gösterildiği ekrandaysak gerek yok.
  const visible = serverId ? view.kind === 'server' && view.voiceId === channelId : view.kind === 'dm' && view.channelId === channelId
  if (visible) return null

  const userId = key.slice(0, key.lastIndexOf(':'))
  const name = profiles?.get(userId)?.display_name ?? 'Biri'
  const open = () => setView(serverId ? { kind: 'server', serverId, channelId: rememberedChannel(serverId), voiceId: channelId } : { kind: 'dm', channelId })

  return (
    <div className="anim-pop group fixed right-4 bottom-24 z-40 aspect-video w-80 overflow-hidden rounded-xl border border-line bg-black shadow-pop">
      <button type="button" onClick={open} aria-label="Yayına dön" className="block size-full">
        <VideoView stream={videos[key]!} audio />
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-5 pb-1.5 text-xs font-semibold text-white">
        {name} · ekran
      </div>
      <div className="absolute top-2 right-2 hidden gap-1 group-hover:flex">
        <button type="button" aria-label="Yayına dön" data-tip="Yayına dön" onClick={open} className="grid size-7 place-items-center rounded-md bg-black/55 text-white hover:bg-black/75">
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="İzlemeyi bırak"
          data-tip="İzlemeyi bırak"
          onClick={() => unwatch(userId, 'screen')}
          className="grid size-7 place-items-center rounded-md bg-black/55 text-white hover:bg-black/75"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
