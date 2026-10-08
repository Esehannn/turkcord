import { useEffect } from 'react'
import { Logo, Wordmark } from '@/components/Logo'
import { ConfirmHost } from '@/components/Modal'
import { TitleBar } from '@/components/TitleBar'
import { Toaster } from '@/components/Toaster'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Splash } from '@/components/Splash'
import { AuthScreen } from '@/features/auth/AuthScreen'
import { MainLayout } from '@/features/layout/MainLayout'
import { isConfigured } from '@/lib/supabase'
import { startSessionListener, useSession } from '@/stores/session'

export function App() {
  const session = useSession((s) => s.session)
  const loading = useSession((s) => s.loading)

  useEffect(() => {
    if (isConfigured) startSessionListener()
  }, [])

  let screen
  if (!isConfigured) screen = <MissingConfig />
  else if (loading) screen = <Splash />
  else if (!session) screen = <AuthScreen />
  else screen = <MainLayout key={session.user.id} userId={session.user.id} />

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <UpdateBanner />
      <div className="min-h-0 flex-1">{screen}</div>
      <ConfirmHost />
      <Toaster />
    </div>
  )
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
