import { Modal } from '@/components/Modal'
import { useShortcuts } from '@/lib/desktop'

const ROWS: [keys: string[], label: string][] = [
  [['Ctrl', 'K'], 'Hızlı geçiş: sohbete, kanala ya da sunucuya atla'],
  [['Ctrl', 'F'], 'Açık sohbette ara'],
  [['Ctrl', '/'], 'Bu listeyi aç'],
  [['Enter'], 'Mesajı gönder'],
  [['Shift', 'Enter'], 'Mesajda alt satıra geç'],
  [['↑'], 'Yazı kutusu boşken son mesajını düzenle'],
  [['Ctrl', 'V'], 'Panodaki görseli ya da dosyayı ekle'],
  [['Esc'], 'Açık pencereyi, menüyü ya da yanıtı kapat'],
  [['Çift tık'], 'Ses odasında bir görüntüyü tam ekran yap'],
]

// Klavye kısayolları (Ctrl+/).
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const global = useShortcuts()
  const rows = [...ROWS]
  // Her yerde çalışan (oyundayken de) kısayollar ayarlardan atanır.
  if (global.mute) rows.push([global.mute.split('+'), 'Mikrofonu kapat / aç (her yerde)'])
  if (global.deafen) rows.push([global.deafen.split('+'), 'Sağırlaştır / aç (her yerde)'])
  return (
    <Modal title="Klavye kısayolları" onClose={onClose}>
      <ul className="divide-y divide-line">
        {rows.map(([keys, label]) => (
          <li key={label} className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-fg">{label}</span>
            <span className="flex shrink-0 gap-1">
              {keys.map((k) => (
                <kbd key={k} className="rounded-md border border-line bg-input px-1.5 py-0.5 text-xs font-semibold text-muted">
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">Mikrofon ve sağırlaştırma kısayolları Ayarlar → Ses ve Mikrofon bölümünden atanır.</p>
    </Modal>
  )
}
