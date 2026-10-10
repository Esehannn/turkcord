import { useEffect, useState } from 'react'
import { AppWindow, Monitor } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Button, Spinner, Tabs } from '@/components/ui'
import { SCREEN_QUALITIES, startScreen, type ScreenQuality } from '@/voice/video'
import type { ScreenSource } from '../../../../preload/api'

const QUALITY_KEY = 'turkcord-yayin-kalitesi'
const AUDIO_KEY = 'turkcord-yayin-sesi'

function savedQuality(): ScreenQuality {
  const saved = localStorage.getItem(QUALITY_KEY)
  return SCREEN_QUALITIES.some((q) => q.value === saved) ? (saved as ScreenQuality) : '720p30'
}

// Ekran paylaşımı: hangi ekranın ya da pencerenin paylaşılacağı, kalite ve bilgisayar sesi seçilir.
// Kaynak listesi yalnızca bu pencere açılınca istenir.
export function ShareScreenModal({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [picked, setPicked] = useState<string | null>(null)
  const [quality, setQuality] = useState<ScreenQuality>(savedQuality)
  const [audio, setAudio] = useState(() => localStorage.getItem(AUDIO_KEY) !== 'kapali')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (window.turkcord?.screenSources() ?? Promise.resolve([])).then((list) => {
      if (!alive) return
      setSources(list)
      // Tek ekran varsa seçili gelir.
      const screens = list.filter((s) => s.screen)
      if (screens.length === 1) setPicked(screens[0].id)
    })
    return () => {
      alive = false
    }
  }, [])

  const visible = (sources ?? []).filter((s) => s.screen === (tab === 'screen'))

  async function start() {
    if (!picked || busy) return
    setBusy(true)
    localStorage.setItem(QUALITY_KEY, quality)
    localStorage.setItem(AUDIO_KEY, audio ? 'acik' : 'kapali')
    if (await startScreen(picked, quality, audio)) onClose()
    else setBusy(false)
  }

  return (
    <Modal
      title="Ekranını paylaş"
      subtitle="Kanaldakiler yayını yalnızca “İzle”ye basınca görür."
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={() => void start()} disabled={!picked} loading={busy}>
            Yayını başlat
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'screen', label: 'Ekranlar' },
            { value: 'window', label: 'Pencereler' },
          ]}
        />
        <div className="grid h-64 auto-rows-max grid-cols-3 content-start gap-3 overflow-y-auto pr-1 scroll-thin">
          {!sources && (
            <div className="col-span-3 grid h-full place-items-center text-muted">
              <Spinner />
            </div>
          )}
          {sources && visible.length === 0 && (
            <p className="col-span-3 grid h-full place-items-center text-sm text-muted">{tab === 'screen' ? 'Ekran bulunamadı.' : 'Açık pencere yok.'}</p>
          )}
          {visible.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => setPicked(source.id)}
              onDoubleClick={() => {
                setPicked(source.id)
                void start()
              }}
              className={`overflow-hidden rounded-lg border-2 text-left transition-colors ${
                picked === source.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-faint'
              }`}
            >
              <img src={source.thumbnail} alt="" draggable={false} className="aspect-video w-full bg-black object-contain" />
              <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-fg">
                {source.screen ? <Monitor className="size-3.5 shrink-0 text-faint" /> : <AppWindow className="size-3.5 shrink-0 text-faint" />}
                <span className="truncate">{source.name}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold tracking-wide text-muted uppercase">Kalite</span>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as ScreenQuality)}
              className="h-10 w-full rounded-md border border-line bg-input px-2 text-sm text-fg"
            >
              {SCREEN_QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
            <span className="block text-xs text-faint">{SCREEN_QUALITIES.find((q) => q.value === quality)?.hint}</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 self-start rounded-lg border border-line p-3">
            <span>
              <span className="block text-sm font-medium text-fg">Bilgisayar sesini de paylaş</span>
              <span className="block text-xs text-muted">Oyunun ya da videonun sesi yayına eklenir.</span>
            </span>
            <input type="checkbox" className="size-5 accent-accent" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
          </label>
        </div>
      </div>
    </Modal>
  )
}
