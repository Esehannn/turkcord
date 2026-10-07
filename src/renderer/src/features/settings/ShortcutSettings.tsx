import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui'
import { acceleratorFrom, useShortcuts } from '@/lib/desktop'

// "Mikrofonu kapat/aç" ve "Sağırlaştır" kısayolları: Turkcord arkadayken (ör. oyunda) de çalışır.
export function ShortcutSettings() {
  const shortcuts = useShortcuts()
  const [capturing, setCapturing] = useState<'mute' | 'deafen' | null>(null)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setCapturing(null)
        return
      }
      const accelerator = acceleratorFrom(e)
      if (!accelerator) return // değiştirici tuşlar basılırken bekle
      shortcuts.set({ [capturing]: accelerator })
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, shortcuts])

  if (!window.turkcord?.setShortcuts) return null

  const rows = [
    ['mute', 'Mikrofonu kapat / aç'],
    ['deafen', 'Sağırlaştır / aç'],
  ] as const

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold tracking-wide text-muted uppercase">Kısayollar</p>
      <div className="divide-y divide-line rounded-lg border border-line">
        {rows.map(([key, label]) => (
          <div key={key} className="flex items-center gap-3 p-3">
            <span className="flex-1">
              <span className="block text-sm text-fg">{label}</span>
              {shortcuts.failed[key] && <span className="block text-xs text-accent">Bu kısayolu başka bir uygulama kullanıyor, başka bir tane seç.</span>}
            </span>
            <Button variant="secondary" className="min-w-36" onClick={() => setCapturing(key)}>
              {capturing === key ? 'Tuşlara bas…' : (shortcuts[key]?.replace(/\+/g, ' + ') ?? 'Yok')}
            </Button>
            <IconButton label="Kısayolu kaldır" disabled={!shortcuts[key]} onClick={() => shortcuts.set({ [key]: null })}>
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
      </div>
      <p className="text-xs text-faint">Turkcord arkadayken, oyunun içindeyken bile çalışır. Örneğin Ctrl + Shift + M.</p>
    </div>
  )
}
