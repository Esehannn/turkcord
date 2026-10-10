import { createRoot } from 'react-dom/client'
import './index.css'
import { applyAppearance } from './stores/ui'

applyAppearance()

const root = createRoot(document.getElementById('root')!)

// Açılıştaki küçük güncelleme penceresi aynı sayfayı "#guncelleme" ile açar. O pencerede uygulamanın kendisi
// (oturum, sunucu bağlantısı, sohbetler) yüklenmez; yalnızca güncelleme ekranı çizilir.
if (location.hash === '#guncelleme') {
  void import('./features/update/UpdateScreen').then(({ UpdateScreen }) => root.render(<UpdateScreen />))
} else {
  void import('./boot').then(({ Boot }) => root.render(<Boot />))
}
