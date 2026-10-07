import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

// Yeni sürüm indirilince en üstte çıkan şerit.
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const bridge = window.turkcord
    if (!bridge?.onUpdateReady) return
    void bridge.updateReady().then((v) => v && setVersion(v))
    return bridge.onUpdateReady(setVersion)
  }, [])

  if (!version || hidden) return null
  return (
    <div className="flex items-center justify-center gap-3 bg-accent px-4 py-1.5 text-sm font-medium text-white">
      <Download className="size-4" />
      <span>Turkcord {version} hazır.</span>
      <button
        type="button"
        onClick={() => void window.turkcord?.installUpdate()}
        className="rounded bg-white px-2.5 py-0.5 text-xs font-bold text-accent hover:bg-white/90"
      >
        Yeniden başlat ve güncelle
      </button>
      <button type="button" aria-label="Sonra" title="Sonra (kapatınca kurulur)" onClick={() => setHidden(true)} className="opacity-80 hover:opacity-100">
        <X className="size-4" />
      </button>
    </div>
  )
}
