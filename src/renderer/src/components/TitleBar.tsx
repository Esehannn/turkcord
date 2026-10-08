import { Logo } from './Logo'

// Windows'un gri sistem çubuğu yerine uygulamanın kendi başlık çubuğu. Küçült/büyüt/kapat düğmelerini
// yine Windows çizer (sağ üstte); bu şerit pencereyi sürüklemeye yarar ve temaya uyar.
export function TitleBar() {
  if (window.turkcord?.platform !== 'win32') return null
  return (
    <header className="titlebar flex h-8 shrink-0 items-center gap-2 bg-rail pl-3 text-rail-text select-none">
      <Logo size={18} variant="mark" />
      <span className="text-xs font-bold tracking-wide">Turkcord</span>
    </header>
  )
}
