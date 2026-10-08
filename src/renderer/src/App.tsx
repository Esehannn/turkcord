import { useEffect, useState } from 'react'
import { Logo, Wordmark } from '@/components/Logo'
import { ConfirmHost } from '@/components/Modal'
import { TitleBar } from '@/components/TitleBar'
import { Toaster } from '@/components/Toaster'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Splash } from '@/components/Splash'
import { AuthScreen } from '@/features/auth/AuthScreen'
import { MainLayout } from '@/features/layout/MainLayout'
import { isConfigured } from '@/lib/supabase'
import type { UpdateStage } from '../../preload/api'
import { startSessionListener, useSession } from '@/stores/session'

export function App() {
  const session = useSession((s) => s.session)
  const loading = useSession((s) => s.loading)

  useEffect(() => {
    if (isConfigured) startSessionListener()
  }, [])

  const update = useStartupUpdate()

  let screen
  if (!isConfigured) screen = <MissingConfig />
  else if (loading) screen = <Splash text="Oturum açılıyor…" />
  else if (!session) screen = <AuthScreen />
  else screen = <MainLayout key={session.user.id} userId={session.user.id} />

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <UpdateBanner />
      <div className="relative min-h-0 flex-1">
        {screen}
        {/* Denetim sürerken uygulama arkada yüklenmeye devam eder; açılış ekranı üstünü örter. */}
        {update && <div className="absolute inset-0 z-[80]">{update}</div>}
      </div>
      <ConfirmHost />
      <Toaster />
    </div>
  )
}

// Güncelleme denetimi bu kadar sürerse (ör. internet yavaş) beklemeden uygulamaya geçilir.
const CHECK_TIMEOUT_MS = 6_000

// Açılışta güncelleme denetimi: yeni sürüm varsa açılış ekranında indirilir, kurulur ve uygulama yeniden başlar.
// Gösterilecek bir şey varsa açılış ekranını, yoksa (denetim bitti ya da atlandı) null döner.
function useStartupUpdate() {
  const bridge = window.turkcord
  const [stage, setStage] = useState<UpdateStage | null>(null)
  // Electron dışında (tarayıcıda geliştirme) denetim yoktur.
  const [done, setDone] = useState(!bridge?.updateStage)

  useEffect(() => {
    if (!bridge?.updateStage) return
    void bridge.updateStage().then((s) => (s ? setStage(s) : setDone(true)))
    return bridge.onUpdateStage(setStage)
  }, [bridge])

  const phase = stage?.phase
  useEffect(() => {
    if (done || !stage) return
    if (phase === 'none' || phase === 'error' || (phase === 'ready' && !stage.autoInstall)) return setDone(true)
    if (phase === 'checking') {
      const timer = setTimeout(() => setDone(true), CHECK_TIMEOUT_MS)
      return () => clearTimeout(timer)
    }
    if (phase === 'ready') {
      // "Kuruluyor" yazısı bir an görünsün, sonra uygulama kapanıp yeni sürümle açılır.
      const timer = setTimeout(() => void bridge?.installUpdate(), 900)
      return () => clearTimeout(timer)
    }
  }, [bridge, done, phase, stage])

  if (done) return null
  if (phase === 'downloading') {
    return (
      <Splash text={`Güncelleme indiriliyor… %${stage!.percent}${stage!.version ? ` (${stage!.version})` : ''}`} progress={stage!.percent}>
        <button type="button" onClick={() => setDone(true)} className="text-faint hover:text-fg hover:underline">
          Şimdilik atla, arka planda insin
        </button>
      </Splash>
    )
  }
  if (phase === 'ready') return <Splash text="Güncelleme kuruluyor, Turkcord yeniden başlayacak…" progress={100} />
  return <Splash text="Güncellemeler denetleniyor…" />
}

function MissingConfig() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <Logo size={64} />
      <h1 className="text-2xl">
        <Wordmark />
      </h1>
      <p className="max-w-md text-sm text-muted">
        Sunucu ayarları eksik. Proje kökündeki <code className="rounded bg-input px-1">.env.example</code> dosyasını{' '}
        <code className="rounded bg-input px-1">.env</code> olarak kopyalayıp Supabase adresini ve herkese açık anahtarı yaz.
      </p>
    </div>
  )
}
