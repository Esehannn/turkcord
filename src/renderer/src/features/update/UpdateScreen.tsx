import { useEffect, useState } from 'react'
import { Splash } from '@/components/Splash'
import type { UpdateStage } from '../../../../preload/api'

// Açılıştaki küçük güncelleme penceresinin içeriği. Uygulama açılmadan önce yeni sürüm denetlenir; varsa burada
// indirilir ve kurulur, sonra Turkcord yeni sürümle açılır. Aşamaları ana süreç bildirir (main/updater.ts).
export function UpdateScreen() {
  const [stage, setStage] = useState<UpdateStage | null>(null)

  useEffect(() => {
    const bridge = window.turkcord
    if (!bridge) return
    void bridge.updateStage().then((s) => s && setStage(s))
    return bridge.onUpdateStage(setStage)
  }, [])

  const phase = stage?.phase ?? 'checking'
  let text = 'Güncellemeler denetleniyor…'
  if (phase === 'downloading') text = `Güncelleme indiriliyor… %${stage!.percent}`
  else if (phase === 'ready') text = 'Güncelleme kuruluyor…'
  else if (phase === 'none' || phase === 'error') text = 'Turkcord açılıyor…'

  return (
    <div className="update-window h-full">
      <Splash text={text} progress={phase === 'downloading' ? stage!.percent : phase === 'ready' ? 100 : undefined}>
        {phase === 'downloading' && (
          <button type="button" onClick={() => window.turkcord?.skipUpdate()} className="text-faint hover:text-fg hover:underline">
            Şimdilik atla, arka planda insin
          </button>
        )}
        {phase === 'ready' && stage?.version && <span className="text-faint">Turkcord {stage.version} ile yeniden başlayacak</span>}
      </Splash>
    </div>
  )
}
